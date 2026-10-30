// --max-usd is required; a pre-run estimate over the limit refuses to start
// with zero model calls; an unknown price refuses rather than pricing at zero.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runMini } from "./_mini.mjs";
import { resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { readFileSync } from "node:fs";
import { estimate, priceFor, loadPrices } from "../src/cost.mjs";

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
  assert.equal(est.usd, (1000 * 1.25 + 1000 * 10) / 1e6);
});

test("the bundled price table loads and has no zero prices", () => {
  const prices = loadPrices();
  assert.ok(Object.keys(prices).length > 0);
  for (const [id, p] of Object.entries(prices)) assert.ok(p.input > 0 && p.output > 0, id);
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
