// Provider handling: a missing key is skipped and reported, never a failure;
// clients send keys in headers only and offer no tools. No network: fetch is
// stubbed in every case.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runMini } from "./_mini.mjs";
import { resetRegistry } from "./_mock.mjs";
import { clientFor, anthropicClient, openaiClient, googleClient } from "../src/clients.mjs";
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
  const res = await openaiClient("gpt-5", "k").complete({ prompt: "p" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /HTTP 429/);
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
