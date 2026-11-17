// --max-usd is required; a pre-run estimate over the limit refuses to start
// with zero model calls; an unknown price refuses rather than pricing at zero.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runMini } from "./_mini.mjs";
import { resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { readFileSync } from "node:fs";
import { estimate, priceFor, loadPrices, actual, validPrice, meter } from "../src/cost.mjs";

beforeEach(resetRegistry);

test("--max-usd is required: run refuses without it", async () => {
  for (const maxUsd of [undefined, 0, -1, NaN, "2"]) {
    resetRegistry();
    const calls = { n: 0 };
    await assert.rejects(runMini({ maxUsd, calls }), (err) => err.code === "USAGE" && /--max-usd is required/.test(err.message));
    assert.equal(calls.n, 0);
  }
});

test("an estimate over --max-usd refuses to start and calls no model", async () => {
  const calls = { n: 0 };
  await assert.rejects(runMini({ maxUsd: 0.0001, calls }), (err) => err.code === "REFUSED" && /exceeds --max-usd/.test(err.message));
  assert.equal(calls.n, 0, "no reader was called");
});

test("a model with no known price refuses rather than being priced at zero", async () => {
  const calls = { n: 0 };
  await assert.rejects(
    runMini({ models: ["claude-haiku-4-5", "gpt-unknown-9"], calls }),
    (err) => err.code === "REFUSED" && /no price known for gpt-unknown-9/.test(err.message),
  );
  assert.equal(calls.n, 0);
});

test("--estimate-only reports the estimate and calls nothing", async () => {
  const calls = { n: 0 };
  const res = await runMini({ estimateOnly: true, calls });
  assert.equal(res.status, "estimate");
  assert.ok(res.estimate.usd > 0);
  assert.equal(calls.n, 0);
});

test("the estimate is an upper bound on the scripted run's actual spend", async () => {
  const res = await runMini();
  assert.ok(res.cost.actual.usd > 0);
  assert.ok(res.cost.actual.usd <= res.cost.estimate.usd);
  assert.equal(res.cost.maxUsd, 1);
});

test("priceFor matches exact ids and dated snapshots only", () => {
  const p = { "claude-sonnet-5": { input: 1, output: 1 }, "claude-sonnet-5-5": { input: 2, output: 2 }, "gpt-5": { input: 1, output: 1 } };
  assert.equal(priceFor("claude-sonnet-5-5", p).input, 2);
  assert.equal(priceFor("claude-sonnet-5", p).input, 1);
  assert.equal(priceFor("claude-sonnet-5-5-20261001", p).input, 2);
  assert.equal(priceFor("claude-sonnet-5-5@20261001", p).input, 2);
  // An unlisted variant must not inherit its base model's (cheaper) price.
  assert.equal(priceFor("gpt-5-pro", p), null);
  assert.equal(priceFor("claude-sonnet-5-5-preview", p), null);
  assert.equal(priceFor("gpt-4o", p), null);
});

test("an unlisted variant of a priced model refuses the run", async () => {
  const calls = { n: 0 };
  await assert.rejects(runMini({ models: ["claude-haiku-4-5", "gpt-5-pro"], calls }), (err) => err.code === "REFUSED" && /gpt-5-pro/.test(err.message));
  assert.equal(calls.n, 0);
});

test("estimate counts the full output cap per call", () => {
  const est = estimate([{ purpose: "r", model: "gpt-5", prompt: "x".repeat(4000), maxTokens: 1000 }], TEST_PRICES);
  assert.equal(est.calls[0].inputTokens, 1000);
  assert.equal(est.calls[0].outputTokens, 1000);
  // Plus the worst case of MAX_RETRIES retried attempts, each input-only.
  assert.equal(est.calls[0].retries, 2);
  assert.equal(est.usd, (1000 * 1.25 + 1000 * 10) / 1e6 + 2 * ((1000 * 1.25) / 1e6));
});

test("estimate counts the maximum retries: input-only attempts, at the call's tier", () => {
  const c = [{ purpose: "r", model: "gpt-5", prompt: "x".repeat(4000), maxTokens: 1000 }];
  const noRetry = estimate(c, TEST_PRICES, { maxRetries: 0 });
  const withRetry = estimate(c, TEST_PRICES);
  assert.equal(withRetry.maxRetries, 2);
  assert.equal(noRetry.usd, (1000 * 1.25 + 1000 * 10) / 1e6);
  assert.equal(withRetry.usd, noRetry.usd + 2 * ((1000 * 1.25) / 1e6));
});

test("actual spend counts every retried attempt the client reports", async () => {
  const ledger = [];
  const client = { model: "gpt-5", complete: async () => ({ ok: true, text: "abcd", model: "gpt-5", usage: { inputTokens: 10, outputTokens: 5 }, retries: 2 }) };
  await meter(client, ledger, "reader r").complete({ prompt: "x".repeat(400) });
  assert.equal(ledger.length, 3);
  assert.deepEqual(ledger.filter((e) => e.retry).map((e) => [e.inputTokens, e.outputTokens]), [[100, 0], [100, 0]]);
  const a = actual(ledger, TEST_PRICES);
  assert.equal(a.retries, 2);
  assert.equal(a.approximate, true);
  assert.equal(a.usd, (10 * 1.25 + 5 * 10) / 1e6 + 2 * ((100 * 1.25 + 0 * 10) / 1e6));
  // The worst-case estimate for the same call still bounds it.
  assert.ok(a.usd <= estimate([{ purpose: "r", model: "gpt-5", prompt: "x".repeat(400), maxTokens: 5 }], TEST_PRICES).usd);
});

test("a reply with no retries adds no retry rows", async () => {
  const ledger = [];
  const client = { model: "gpt-5", complete: async () => ({ ok: false, reason: "openai HTTP 400: bad" }) };
  await meter(client, ledger, "reader r").complete({ prompt: "x".repeat(40) });
  assert.equal(ledger.length, 1);
  assert.equal(actual(ledger, TEST_PRICES).retries, 0);
});

test("the bundled price table loads and has no zero prices", () => {
  const prices = loadPrices();
  assert.ok(Object.keys(prices).length > 0);
  for (const [id, p] of Object.entries(prices)) {
    assert.ok(p.input > 0 && p.output > 0, id);
    if (p.above) assert.ok(p.above.tokens > 0 && p.above.input >= p.input && p.above.output >= p.output, `${id} above tier`);
    assert.ok(validPrice(p), id);
  }
});

// The workspace skill's default panel (its "Default model matrix"): current
// Haiku, current Sonnet (also the default judge) and one OpenAI GPT reader.
// The skill names the GPT reader only as "one OpenAI GPT model"; gpt-5 is the
// id this package documents and tests with. The README usage example's
// Anthropic ids are included so the documented command runs unmodified.
// Checked against the bundled table only, never TEST_PRICES.
const SKILL_DEFAULT_PANEL = ["claude-haiku-5-5", "claude-sonnet-5-5", "gpt-5", "claude-haiku-4-5", "claude-sonnet-4-6"];

test("every model in the skill's default panel is priced by the bundled table", () => {
  const prices = loadPrices();
  for (const id of SKILL_DEFAULT_PANEL) assert.ok(priceFor(id, prices), `${id} has no bundled price`);
});

test("bundled OpenAI prices record their source and retrieval date", () => {
  const raw = JSON.parse(readFileSync(new URL("../data/prices.json", import.meta.url), "utf8"));
  const src = raw.sources?.openai;
  assert.match(src?.url ?? "", /^https:\/\/developers\.openai\.com\//);
  assert.match(src?.retrieved ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(raw.models["gpt-5"], { input: 1.25, output: 10 });
});

test("an OpenAI variant or dashed-date snapshot of a bundled id stays unpriced", () => {
  const prices = loadPrices();
  assert.equal(priceFor("gpt-5-pro", prices), null);
  assert.equal(priceFor("gpt-5-2025-08-07", prices), null);
});

// --- Prompt-length tiers: the estimate stays an upper bound. ---------------

const TIERED = { input: 1, output: 5, above: { tokens: 1000, input: 5, output: 25 } };
const call = (chars) => ({ purpose: "r", model: "tiered", prompt: "x".repeat(chars), maxTokens: 100 });

test("a prompt over a tier's threshold is estimated at the higher tier", () => {
  const over = estimate([call(4004)], { tiered: TIERED }); // 1001 input tokens
  assert.equal(over.calls[0].inputTokens, 1001);
  assert.equal(over.usd, (1001 * 5 + 100 * 25) / 1e6 + 2 * ((1001 * 5 + 0 * 25) / 1e6));
});

test("a prompt at or under a tier's threshold uses the lower tier", () => {
  // maxRetries: 0 isolates the tier rule from the retry allowance.
  const at = estimate([call(4000)], { tiered: TIERED }, { maxRetries: 0 }); // exactly 1000
  assert.equal(at.usd, (1000 * 1 + 100 * 5) / 1e6);
  const under = estimate([call(400)], { tiered: TIERED }, { maxRetries: 0 });
  assert.equal(under.usd, (100 * 1 + 100 * 5) / 1e6);
});

test("the higher tier refuses a run the lower tier would have let through", async () => {
  // The mini payload's reader prompts are far over 10 tokens, so every call
  // lands in the `above` tier.
  const lower = { "claude-haiku-4-5": { input: 1, output: 5 }, "gpt-5": { input: 1, output: 5 } };
  const tiered = {
    "claude-haiku-4-5": { input: 1, output: 5, above: { tokens: 10, input: 5, output: 25 } },
    "gpt-5": { input: 1, output: 5, above: { tokens: 10, input: 5, output: 25 } },
  };
  const low = await runMini({ judge: null, prices: lower, estimateOnly: true });
  const high = await runMini({ judge: null, prices: tiered, estimateOnly: true });
  assert.ok(Math.abs(high.estimate.usd - 5 * low.estimate.usd) < 1e-12, "every call priced at the 5x tier");
  const maxUsd = (low.estimate.usd + high.estimate.usd) / 2;

  const passes = await runMini({ judge: null, prices: lower, estimateOnly: true, maxUsd });
  assert.equal(passes.status, "estimate");
  const calls = { n: 0 };
  await assert.rejects(
    runMini({ judge: null, prices: tiered, maxUsd, calls }),
    (err) => err.code === "REFUSED" && /exceeds --max-usd/.test(err.message),
  );
  assert.equal(calls.n, 0);
});

test("actual spend applies the same tier rule per call", () => {
  const ledger = [
    { purpose: "r", model: "tiered", inputTokens: 1001, outputTokens: 10 },
    { purpose: "r", model: "tiered", inputTokens: 1000, outputTokens: 10 },
  ];
  const res = actual(ledger, { tiered: TIERED });
  assert.equal(res.calls[0].usd, (1001 * 5 + 10 * 25) / 1e6);
  assert.equal(res.calls[1].usd, (1000 * 1 + 10 * 5) / 1e6);
});

test("a malformed tier refuses rather than falling back to the lower tier", () => {
  for (const above of [null, {}, { tokens: 1000, input: 5 }, { tokens: 0, input: 5, output: 25 }, { tokens: 1000, input: "5", output: 25 }]) {
    assert.equal(validPrice({ input: 1, output: 5, above }), false, JSON.stringify(above));
    assert.throws(() => estimate([call(40)], { tiered: { input: 1, output: 5, above } }), (err) => err.code === "UNKNOWN_PRICE");
  }
  assert.equal(validPrice(TIERED), true);
  assert.equal(validPrice({ input: 1, output: 5 }), true);
});

test("an unpriced model still refuses alongside a tiered one", () => {
  assert.throws(() => estimate([call(40), { ...call(40), model: "nope" }], { tiered: TIERED }), (err) => err.code === "UNKNOWN_PRICE" && /nope/.test(err.message));
});

test("bundled claude-haiku-5-5 carries its over-100,000-token tier", () => {
  const p = loadPrices()["claude-haiku-5-5"];
  assert.deepEqual(p, { input: 0.1, output: 0.5, above: { tokens: 100000, input: 0.5, output: 2.5 } });
  const big = estimate([{ purpose: "r", model: "claude-haiku-5-5", prompt: "x".repeat(400004), maxTokens: 1000 }], loadPrices(), { maxRetries: 0 });
  assert.equal(big.usd, (100001 * 0.5 + 1000 * 2.5) / 1e6);
});
