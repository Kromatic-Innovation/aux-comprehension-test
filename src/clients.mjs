// clients.mjs — thin, zero-dependency provider clients.
//
// Each client satisfies panelist's adapter shape
//   { model, complete({ prompt, maxTokens }) -> { ok, text, model, usage } }
// and offers NO tools to the model: a reader can only read. Keys come from
// environment variables only and travel in a request header, never in a URL
// or a log line. A missing key is reported as `skipped`, never thrown.
//
// Library callers can inject any client of the same shape instead.

export const KEY_ENV = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  google: "GEMINI_API_KEY",
};

const TIMEOUT_MS = 180_000;

async function post(url, headers, body, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, reason: `${provider} HTTP ${res.status}: ${text.slice(0, 300)}` };
    return { ok: true, json: JSON.parse(text) };
  } catch (err) {
    return { ok: false, reason: `${provider} transport error: ${err?.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

export function anthropicClient(model, apiKey) {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return {
    model,
    async complete({ prompt, maxTokens }) {
      const r = await post(
        "https://api.anthropic.com/v1/messages",
        headers,
        { model, max_tokens: maxTokens ?? 4096, messages: [{ role: "user", content: prompt }] },
        "anthropic",
      );
      if (!r.ok) return r;
      const text = (r.json.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      const u = r.json.usage ?? {};
      return { ok: true, text, model, usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens } };
    },
    /** Provider token count (free endpoint). Used only when explicitly requested. */
    async countTokens(text) {
      const r = await post(
        "https://api.anthropic.com/v1/messages/count_tokens",
        headers,
        { model, messages: [{ role: "user", content: text }] },
        "anthropic",
      );
      if (!r.ok) throw new Error(r.reason);
      return r.json.input_tokens;
    },
  };
}

function chatCompletionsClient(provider, url, model, apiKey) {
  return {
    model,
    async complete({ prompt, maxTokens }) {
      const r = await post(
        url,
        { authorization: `Bearer ${apiKey}` },
        { model, max_completion_tokens: maxTokens ?? 4096, messages: [{ role: "user", content: prompt }] },
        provider,
      );
      if (!r.ok) return r;
      const text = r.json.choices?.[0]?.message?.content ?? "";
      const u = r.json.usage ?? {};
      return { ok: true, text, model, usage: { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens } };
    },
  };
}

export const openaiClient = (model, key) => chatCompletionsClient("openai", "https://api.openai.com/v1/chat/completions", model, key);
export const xaiClient = (model, key) => chatCompletionsClient("xai", "https://api.x.ai/v1/chat/completions", model, key);

export function googleClient(model, apiKey) {
  return {
    model,
    async complete({ prompt, maxTokens }) {
      const r = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": apiKey },
        { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens ?? 4096 } },
        "google",
      );
      if (!r.ok) return r;
      const text = (r.json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const u = r.json.usageMetadata ?? {};
      return { ok: true, text, model, usage: { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount } };
    },
  };
}

const FACTORIES = { anthropic: anthropicClient, openai: openaiClient, xai: xaiClient, google: googleClient };

/**
 * Build a client for a parsed model spec, or report why it is skipped.
 * @param {{provider: string, model: string}} spec
 * @param {object} env  typically process.env
 * @returns {{client: object} | {skipped: string}}
 */
export function clientFor(spec, env) {
  const factory = FACTORIES[spec.provider];
  if (!factory) return { skipped: `unknown provider for model ${spec.model}; prefix it as anthropic:, openai:, xai: or google:` };
  const keyName = KEY_ENV[spec.provider];
  const key = env[keyName] || (spec.provider === "google" ? env.GOOGLE_API_KEY : undefined);
  if (!key) return { skipped: `${keyName} is not set` };
  return { client: factory(spec.model, key) };
}
