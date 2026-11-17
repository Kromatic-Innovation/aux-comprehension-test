// Judge failures: teach-back grading is batched so a large payload never
// needs one reply the output cap cuts off; a judge that does fail keeps its raw
// reply and labels rows "judge failed", never "no judge".

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.mjs";
import { gradeTeachBack, teachBackBatches, TEACHBACK_BATCH_SIZE, clipRaw, RAW_KEEP } from "../src/judge.mjs";
import { stopped } from "../src/clients.mjs";
import { mockClientFor, scriptedJudge, resetRegistry, firstSentence, TEST_PRICES } from "./_mock.mjs";
import { runMini, miniReader } from "./_mini.mjs";

beforeEach(resetRegistry);

const N = 17;
const names = Array.from({ length: N }, (_, i) => `tool_${String(i + 1).padStart(2, "0")}`);
const bigTools = {
  tools: names.map((n, i) => ({
    name: n,
    description: `Computes widget ledger totals for region number ${i + 1}. Read-only and free.`,
    inputSchema: { type: "object", properties: {} },
  })),
};
const bigTruth = names.map((n, i) => `## ${n}\n\nComputes widget ledger totals for region number ${i + 1}. Read-only, free.\n`).join("\n");
const bigRequests = names.map((n, i) => ({ id: `r${i + 1}`, request: `Ledger totals for region ${i + 1}, please.`, expected: n }));
const bigReader = (artifact) => ({
  teachBack: artifact.tools.map((t) => ({ tool: t.name, meaning: firstSentence(t.description) })),
  routing: artifact.requests.map((r, i) => ({ requestId: r.id, tool: names[i] })),
  confusion: [],
});

// A verbose judge (~300 tokens of commentary per grade) that is cut off at the
// call's output cap: 17 grades in one reply is ~5,100 tokens, over the 4,096 cap.
const verboseJudge = (prompts) => scriptedJudge("claude-sonnet-4-6", { pad: 1200, honourCap: true, prompts });

function runBig(judgeClient) {
  return run(
    { tools: bigTools, truth: bigTruth, requests: bigRequests, models: ["claude-haiku-4-5", "gpt-5"], judge: "claude-sonnet-4-6", maxUsd: 5, prices: TEST_PRICES, env: {} },
    { clientFor: mockClientFor({ script: bigReader, judgeModel: "claude-sonnet-4-6", judge: judgeClient }) },
  );
}

test("large payload: a 17-tool x 4-reader run grades every teach-back item", async () => {
  const prompts = [];
  const res = await runBig(verboseJudge(prompts));
  assert.equal(res.readers.filter((r) => r.status === "ok").length, 4);
  assert.deepEqual(res.judge.errors, []);
  assert.deepEqual(res.judge.failures, []);
  assert.ok(!res.grade.withheldPass.some((w) => /teach-back/.test(w)), JSON.stringify(res.grade.withheldPass));
  assert.equal(res.grade.verdict, "pass");
  // Every tool x reader item reached the judge, in batches of TEACHBACK_BATCH_SIZE.
  const tb = prompts.filter((p) => p.prompt.includes("ITEMS:"));
  assert.equal(tb.length, 4 * Math.ceil(N / TEACHBACK_BATCH_SIZE));
  const items = tb.flatMap((p) => JSON.parse(p.prompt.slice(p.prompt.indexOf("ITEMS:") + 6)));
  assert.equal(items.length, N * 4);
  for (const n of names) assert.equal(items.filter((it) => it.tool === n).length, 4, n);
});

test("control: the same verbose judge asked for all 17 tools in one reply is cut off", async () => {
  const teachBack = names.map((n, i) => ({ tool: n, meaning: `Computes widget ledger totals for region number ${i + 1}.` }));
  await assert.rejects(
    gradeTeachBack(verboseJudge(), { tools: Object.fromEntries(names.map((n) => [n, { meaning: "Computes widget ledger totals." }])) }, teachBack, { batchSize: N }),
    (err) => err.stopReason === "max_tokens" && /cut off/.test(err.message) && typeof err.raw === "string",
  );
});

test("estimate: stays at or above actual spend on the batched 17-tool run", async () => {
  const res = await runBig(verboseJudge());
  assert.ok(res.cost.actual.usd > 0);
  assert.ok(res.cost.actual.usd <= res.cost.estimate.usd, `${res.cost.actual.usd} > ${res.cost.estimate.usd}`);
  const judgeCalls = res.cost.actual.calls.filter((c) => c.purpose === "judge").length;
  const estJudgeCalls = res.cost.estimate.calls.filter((c) => c.purpose.startsWith("judge")).length;
  assert.ok(estJudgeCalls >= judgeCalls, `estimate priced ${estJudgeCalls} judge calls, run made ${judgeCalls}`);
});

const MISREAD = { tool: "delete_saved_report", about: "annotations.destructiveHint", kind: "misleading", issue: "destructiveHint true -- does this delete every report?" };

test("cut-off reply: rows say judge failed (not no judge) and the raw reply is kept", async () => {
  const out = mkdtempSync(join(tmpdir(), "act-judge-"));
  const res = await runMini({
    script: miniReader({ confusion: { "small-context-host": [MISREAD] } }),
    judgeClient: scriptedJudge("claude-sonnet-4-6", { pad: 400, honourCap: true }),
    judgeMaxTokens: 20,
    out,
  });
  assert.ok(res.judge.failures.length > 0);
  for (const f of res.judge.failures) {
    assert.equal(f.stopReason, "max_tokens");
    assert.match(f.reason, /not a JSON object \(cut off/);
    assert.ok(f.file.startsWith("judge/"));
    assert.ok(!("raw" in f), "the raw reply lives in the run directory, not verdict.json");
  }
  const row = res.grade.cutList.find((r) => r.kind === "confusion");
  assert.equal(row.class, "reader-error");
  assert.match(row.reread, /^unverified \(judge failed: .*cut off/);
  assert.ok(!JSON.stringify(res.grade).includes("no judge"));
  assert.ok(res.grade.withheldPass.some((w) => /judge failed/.test(w)));
  assert.ok(!res.grade.withheldPass.some((w) => /no --judge/.test(w)));

  const kept = readdirSync(join(out, "judge"));
  assert.equal(kept.length, res.judge.failures.length);
  const body = readFileSync(join(out, res.judge.failures[0].file), "utf8");
  assert.match(body, /stop reason: max_tokens/);
  assert.match(body, /\{"grades"/);
  const verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  assert.equal(verdict.judge.failures[0].stopReason, "max_tokens");
  assert.match(readFileSync(join(out, "verdict.md"), "utf8"), /## Judge failures[\s\S]*raw reply kept in judge\//);
});

test("no judge: labels still read unverified (no judge)", async () => {
  const res = await runMini({ judge: null, script: miniReader({ confusion: { "small-context-host": [MISREAD] } }) });
  const row = res.grade.cutList.find((r) => r.kind === "confusion");
  assert.equal(row.reread, "unverified (no judge)");
  assert.ok(res.grade.withheldPass.some((w) => /no --judge/.test(w)));
  assert.deepEqual(res.judge.failures, []);
});

test("teachBackBatches splits tools in order, every tool exactly once", () => {
  const truth = { tools: Object.fromEntries(names.map((n) => [n, { meaning: "m" }])) };
  const b = teachBackBatches(truth, 5);
  assert.deepEqual(b.map((x) => x.length), [5, 5, 5, 2]);
  assert.deepEqual(b.flat(), names);
});

test("clipRaw keeps the first and last RAW_KEEP chars of a long reply", () => {
  assert.equal(clipRaw("short"), "short");
  const long = "a".repeat(RAW_KEEP) + "MIDDLE".repeat(1000) + "z".repeat(RAW_KEEP);
  const c = clipRaw(long);
  assert.ok(c.startsWith("a".repeat(RAW_KEEP)) && c.endsWith("z".repeat(RAW_KEEP)));
  assert.ok(!c.includes("MIDDLE") && /chars omitted/.test(c));
});

test("stopped normalizes every provider's output-cap stop to max_tokens", () => {
  assert.deepEqual(stopped("max_tokens"), { stopReason: "max_tokens" });
  assert.deepEqual(stopped("length"), { stopReason: "max_tokens" });
  assert.deepEqual(stopped("MAX_TOKENS"), { stopReason: "max_tokens" });
  assert.deepEqual(stopped("end_turn"), { stopReason: "end_turn" });
  assert.deepEqual(stopped(undefined), {});
});
