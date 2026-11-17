// clients.mjs — thin, zero-dependency provider clients.
//
// Each client satisfies panelist's adapter shape
//   { model, complete({ prompt, maxTokens }) -> { ok, text, model, usage } }
// and offers NO tools to the model: a reader can only read. Keys come from
// environment variables only and travel in a request header, never in a URL
// or a log line. A missing key is reported as `skipped`, never thrown. A 429
// or 5xx is retried with backoff (see MAX_RETRIES); a call that still fails
// is returned as ok:false, so the run reports that reader and carries on.
//
// Library callers can inject any client of the same shape instead.

export const KEY_ENV = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  google: "GEMINI_API_KEY",
};

const TIMEOUT_MS = 180_000;

/**
 * Retry policy for one provider call. A 429 or 5xx is retried at most
 * MAX_RETRIES times, so a call makes at most MAX_RETRIES + 1 HTTP attempts.
 * Any other status, and a transport error (including the timeout), is not
 * retried. The wait honours `Retry-After` (seconds or an HTTP date) when the
 * response carries one, and is otherwise exponential: 1 s, then 2 s. A
 * `Retry-After` longer than MAX_RETRY_AFTER_MS gives up instead of waiting.
 */
export const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;

export const isRetryableStatus = (status) => status === 429 || (status >= 500 && status <= 599);

/** `Retry-After` in milliseconds, or null when absent or unreadable. */
export function retryAfterMs(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const at = Date.parse(s);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(url, headers, body, provider, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, retryAfter: res.headers?.get?.("retry-after") ?? null, reason: `${provider} HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true, json: JSON.parse(text) };
  } catch (err) {
    return { ok: false, reason: `${provider} transport error: ${err?.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST with bounded retry. Never throws. The result carries `retries`: the
 * number of failed attempts that were retried, so spend can count them.
 */
async function post(url, headers, body, provider, { fetch: fetchImpl = globalThis.fetch, sleep = defaultSleep } = {}) {
  let retries = 0;
  for (;;) {
    const r = await attempt(url, headers, body, provider, fetchImpl);
    if (r.ok || !isRetryableStatus(r.status)) return { ...r, retries };
    if (retries >= MAX_RETRIES) return { ...r, retries, reason: `${r.reason} (gave up after ${retries} retries)` };
    const hinted = retryAfterMs(r.retryAfter);
    if (hinted != null && hinted > MAX_RETRY_AFTER_MS) {
      return { ...r, retries, reason: `${r.reason} (Retry-After ${Math.round(hinted / 1000)} s is over ${MAX_RETRY_AFTER_MS / 1000} s; not retried)` };
    }
    await sleep(hinted ?? BASE_DELAY_MS * 2 ** retries);
    retries += 1;
  }
}

/** `retries` on a successful reply, only when there were any. */
const retried = (r) => (r.retries ? { retries: r.retries } : {});

/** A failed call, as a client returns it: no `status`/`retryAfter` internals. */
const failure = (r) => ({ ok: false, reason: r.reason, ...retried(r) });

export function anthropicClient(model, apiKey, opts = {}) {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return {
    model,
    async complete({ prompt, maxTokens }) {
      const r = await post(
        "https://api.anthropic.com/v1/messages",
        headers,
        { model, max_tokens: maxTokens ?? 4096, messages: [{ role: "user", content: prompt }] },
        "anthropic",
        opts,
      );
      if (!r.ok) return failure(r);
      const text = (r.json.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const u = r.json.usage ?? {};
      return { ok: true, text, model, usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens }, ...retried(r) };
    },
    /** Provider token count (free endpoint). Used only when explicitly requested. */
    async countTokens(text) {
      const r = await post(
        "https://api.anthropic.com/v1/messages/count_tokens",
        headers,
        { model, messages: [{ role: "user", content: text }] },
        "anthropic",
        opts,
      );
      if (!r.ok) throw new Error(r.reason);
      return r.json.input_tokens;
    },
  };
}

function chatCompletionsClient(provider, url, model, apiKey, opts = {}) {
  return {
    model,
    async complete({ prompt, maxTokens }) {
      const r = await post(
        url,
        { authorization: `Bearer ${apiKey}` },
        { model, max_completion_tokens: maxTokens ?? 4096, messages: [{ role: "user", content: prompt }] },
        provider,
        opts,
      );
      if (!r.ok) return failure(r);
      const text = r.json.choices?.[0]?.message?.content ?? "";
      const u = r.json.usage ?? {};
      return { ok: true, text, model, usage: { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens }, ...retried(r) };
    },
  };
}

export const openaiClient = (model, key, opts) => chatCompletionsClient("openai", "https://api.openai.com/v1/chat/completions", model, key, opts);
export const xaiClient = (model, key, opts) => chatCompletionsClient("xai", "https://api.x.ai/v1/chat/completions", model, key, opts);

export function googleClient(model, apiKey, opts = {}) {
  return {
    model,
    async complete({ prompt, maxTokens }) {
      const r = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": apiKey },
        { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens ?? 4096 } },
        "google",
        opts,
      );
      if (!r.ok) return failure(r);
      const text = (r.json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const u = r.json.usageMetadata ?? {};
      return { ok: true, text, model, usage: { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount }, ...retried(r) };
    },
  };
}

const FACTORIES = { anthropic: anthropicClient, openai: openaiClient, xai: xaiClient, google: googleClient };

/**
 * Build a client for a parsed model spec, or report why it is skipped.
 * @param {{provider: string, model: string}} spec
 * @param {object} env  typically process.env
 * @param {{fetch?: function, sleep?: function}} [opts]  transport overrides (tests)
 * @returns {{client: object} | {skipped: string}}
 */
export function clientFor(spec, env, opts) {
  const factory = FACTORIES[spec.provider];
  if (!factory) return { skipped: `unknown provider for model ${spec.model}; prefix it as anthropic:, openai:, xai: or google:` };
  const keyName = KEY_ENV[spec.provider];
  const key = env[keyName] || (spec.provider === "google" ? env.GOOGLE_API_KEY : undefined);
  if (!key) return { skipped: `${keyName} is not set` };
  return { client: factory(spec.model, key, opts) };
}
