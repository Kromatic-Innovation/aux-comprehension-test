// Provider handling: a missing key is skipped and reported, never a failure;
// clients send keys in headers only and offer no tools. No network: fetch is
// stubbed in every case.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runMini } from "./_mini.mjs";
import { miniReader } from "./_mini.mjs";
import { resetRegistry, artifactFromPrompt, fixture, fixtureJson, TEST_PRICES } from "./_mock.mjs";
import { run } from "../src/run.mjs";
import { renderVerdictMd } from "../src/render.mjs";
import { clientFor, anthropicClient, openaiClient, googleClient, MAX_RETRIES, retryAfterMs, isRetryableStatus } from "../src/clients.mjs";
import { parseModelSpec, buildPanel } from "../src/reader.mjs";

beforeEach(resetRegistry);

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network is not allowed in tests");
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a missing provider key skips that provider's readers and reports it; the run still completes", async () => {
  const res = await runMini({ models: ["claude-haiku-4-5", "gpt-5"], missing: ["openai"] });
  assert.equal(res.status, "completed");
  assert.equal(res.skipped.length, 2, "both gpt-5 readers are skipped");
  for (const s of res.skipped) {
    assert.equal(s.model, "gpt-5");
    assert.match(s.reason, /OPENAI_API_KEY is not set/);
  }
  assert.equal(res.readers.every((r) => r.status === "ok"), true);
  // Not a failure — but a single-provider panel cannot pass.
  assert.equal(res.grade.verdict, "conditional");
  assert.ok(res.grade.withheldPass.some((w) => /single-provider/.test(w)));
});

test("a missing judge key is skipped and reported", async () => {
  const res = await runMini({ judge: "gpt-5", missing: ["openai"], models: ["claude-haiku-4-5", "claude-sonnet-4-6"] });
  assert.match(res.judge.skipped, /OPENAI_API_KEY/);
  assert.equal(res.judge.model, null);
});

test("no reader key at all refuses the run (nothing to run), it does not crash", async () => {
  await assert.rejects(runMini({ missing: ["anthropic", "openai"] }), (err) => err.code === "REFUSED" && /no reader can run/.test(err.message));
});

test("clientFor reports a missing key by variable name without calling anything", () => {
  assert.deepEqual(clientFor({ provider: "openai", model: "gpt-5" }, {}), { skipped: "OPENAI_API_KEY is not set" });
  assert.deepEqual(clientFor({ provider: "anthropic", model: "claude-haiku-4-5" }, {}), { skipped: "ANTHROPIC_API_KEY is not set" });
  assert.match(clientFor({ provider: "mystery", model: "m" }, {}).skipped, /unknown provider/);
  assert.ok(clientFor({ provider: "google", model: "gemini-x" }, { GOOGLE_API_KEY: "k" }).client);
});

function capture(responseJson) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify(responseJson) };
  };
  return calls;
}

test("anthropic client: key in a header, no tools offered, usage read back", async () => {
  const calls = capture({ content: [{ type: "text", text: "hi" }], usage: { input_tokens: 7, output_tokens: 2 } });
  const res = await anthropicClient("claude-haiku-4-5", "SECRET").complete({ prompt: "p", maxTokens: 10, tools: [] });
  assert.deepEqual(res, { ok: true, text: "hi", model: "claude-haiku-4-5", usage: { inputTokens: 7, outputTokens: 2 } });
  assert.equal(calls[0].init.headers["x-api-key"], "SECRET");
  assert.ok(!calls[0].url.includes("SECRET"));
  assert.ok(!JSON.stringify(calls[0].body).includes("SECRET"));
  assert.equal("tools" in calls[0].body, false);
});

test("openai client: bearer header, no tools offered", async () => {
  const calls = capture({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
  const res = await openaiClient("gpt-5", "SECRET").complete({ prompt: "p", maxTokens: 10 });
  assert.equal(res.text, "ok");
  assert.equal(calls[0].init.headers.authorization, "Bearer SECRET");
  assert.equal("tools" in calls[0].body, false);
});

test("google client: key in a header, never in the URL", async () => {
  const calls = capture({ candidates: [{ content: { parts: [{ text: "g" }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
  await googleClient("gemini-x", "SECRET").complete({ prompt: "p" });
  assert.ok(!calls[0].url.includes("SECRET"));
  assert.equal(calls[0].init.headers["x-goog-api-key"], "SECRET");
});

test("an HTTP error is returned as ok:false, not thrown", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  const res = await openaiClient("gpt-5", "k", { sleep: async () => {} }).complete({ prompt: "p" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /HTTP 429/);
});

// --- Retry with backoff on 429 / 5xx. A scripted fetch, no network. -------

/** A fetch that replays `script` (one entry per attempt) and records each call. */
function scriptedFetch(script) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    const { status, body = "", headers = {} } = typeof next === "function" ? next(url) : next;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  };
  return { fetch, calls };
}
const recordSleep = () => {
  const waits = [];
  return { sleep: async (ms) => void waits.push(ms), waits };
};
const OPENAI_OK = { status: 200, body: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } } };

test("a 429 followed by success is retried and succeeds, honouring Retry-After", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 429, body: "slow down", headers: { "retry-after": "3" } }, OPENAI_OK]);
  const { sleep, waits } = recordSleep();
  const res = await openaiClient("gpt-5", "k", { fetch, sleep }).complete({ prompt: "p" });
  assert.equal(res.ok, true);
  assert.equal(res.text, "ok");
  assert.equal(res.retries, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [3000]);
});

test("without Retry-After the backoff is exponential: 1 s, then 2 s", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 500 }, { status: 502 }, OPENAI_OK]);
  const { sleep, waits } = recordSleep();
  const res = await openaiClient("gpt-5", "k", { fetch, sleep }).complete({ prompt: "p" });
  assert.equal(res.ok, true);
  assert.equal(res.retries, 2);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test("three 5xx in a row give up after 2 retries", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 503, body: "unavailable" }]);
  const { sleep } = recordSleep();
  const res = await anthropicClient("claude-haiku-4-5", "k", { fetch, sleep }).complete({ prompt: "p" });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 1 + MAX_RETRIES);
  assert.equal(MAX_RETRIES, 2);
  assert.equal(res.retries, 2);
  assert.match(res.reason, /HTTP 503.*gave up after 2 retries/);
});

test("a 400 is not retried", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 400, body: "bad request" }, OPENAI_OK]);
  const { sleep, waits } = recordSleep();
  const res = await googleClient("gemini-x", "k", { fetch, sleep }).complete({ prompt: "p" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /HTTP 400/);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
  assert.equal("retries" in res, false);
});

test("a transport error is not retried", async () => {
  let n = 0;
  const fetch = async () => {
    n += 1;
    throw new Error("socket hang up");
  };
  const res = await openaiClient("gpt-5", "k", { fetch, sleep: async () => assert.fail("slept") }).complete({ prompt: "p" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /transport error: socket hang up/);
  assert.equal(n, 1);
});

test("a Retry-After over 60 s gives up instead of waiting", async () => {
  const { fetch, calls } = scriptedFetch([{ status: 429, headers: { "retry-after": "3600" } }, OPENAI_OK]);
  const res = await openaiClient("gpt-5", "k", { fetch, sleep: async () => assert.fail("slept") }).complete({ prompt: "p" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /Retry-After 3600 s is over 60 s; not retried/);
  assert.equal(calls.length, 1);
});

test("Retry-After is read as seconds or an HTTP date", () => {
  const now = Date.parse("2026-11-17T00:00:00Z");
  assert.equal(retryAfterMs("2", now), 2000);
  assert.equal(retryAfterMs("0.5", now), 500);
  assert.equal(retryAfterMs("Tue, 17 Nov 2026 00:00:05 GMT", now), 5000);
  assert.equal(retryAfterMs("Mon, 16 Nov 2026 23:00:00 GMT", now), 0);
  assert.equal(retryAfterMs(null, now), null);
  assert.equal(retryAfterMs("soon", now), null);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(599), true);
  for (const s of [400, 401, 403, 404, 408, 422]) assert.equal(isRetryableStatus(s), false, String(s));
});

test("a reader whose calls keep failing 5xx is reported as failed, the run continues, and its retries are spent", async () => {
  // Real provider clients over a scripted fetch: anthropic answers as a clean
  // reader, openai returns 503 on every attempt.
  const reader = miniReader();
  const counts = { anthropic: 0, openai: 0 };
  const fetch = async (url, init) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      counts.anthropic += 1;
      const prompt = JSON.parse(init.body).messages[0].content;
      const text = JSON.stringify({ verdict: reader(artifactFromPrompt(prompt), "x"), message: "read", dealKillers: [] });
      return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
    }
    counts.openai += 1;
    return new Response("overloaded", { status: 503 });
  };
  const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" };
  const res = await run(
    {
      tools: fixtureJson("mini/tools.json"),
      truth: fixture("mini/truth.md"),
      requests: fixtureJson("mini/requests.json"),
      models: ["claude-haiku-4-5", "gpt-5"],
      maxUsd: 1,
      prices: TEST_PRICES,
      env,
    },
    { clientFor: (spec, e) => clientFor(spec, e, { fetch, sleep: async () => {} }) },
  );
  assert.equal(res.status, "completed");
  const failed = res.readers.filter((r) => r.status === "error");
  assert.deepEqual(failed.map((r) => r.model), ["gpt-5", "gpt-5"]);
  for (const r of failed) assert.match(r.error, /HTTP 503.*gave up after 2 retries/);
  assert.equal(res.readers.filter((r) => r.status === "ok").length, 2);
  assert.equal(counts.openai, 2 * (1 + MAX_RETRIES));
  assert.equal(counts.anthropic, 2);
  // Every retried attempt is in actual spend, and the estimate still bounds it.
  assert.equal(res.cost.actual.retries, 2 * MAX_RETRIES);
  assert.ok(res.cost.actual.usd <= res.cost.estimate.usd);
  assert.match(renderVerdictMd(res), /including 4 retried attempt\(s\)/);
});

test("model specs: prefixes win, otherwise panelist's providerOf; grok maps to xai", () => {
  assert.equal(parseModelSpec("claude-haiku-4-5").provider, "anthropic");
  assert.equal(parseModelSpec("gpt-5").provider, "openai");
  assert.equal(parseModelSpec("grok-4").provider, "xai");
  assert.deepEqual(parseModelSpec("google:gemini-2.5-pro"), { provider: "google", model: "gemini-2.5-pro", spec: "google:gemini-2.5-pro" });
});

test("panel: personas and models zip cyclically; --readers caps it", () => {
  const panel = buildPanel({ personaIds: ["a", "b", "c", "d"], models: ["claude-haiku-4-5", "claude-sonnet-4-6", "gpt-5"] });
  assert.deepEqual(panel.map((r) => `${r.personaId}/${r.model}`), ["a/claude-haiku-4-5", "b/claude-sonnet-4-6", "c/gpt-5", "d/claude-haiku-4-5"]);
  assert.equal(buildPanel({ personaIds: ["a", "b"], models: ["gpt-5"], maxReaders: 1 }).length, 1);
});
