// The judge's re-read of single-reader rows: batched so no reply needs to be
// longer than the output cap, and `pass` withheld whenever any single-reader
// row is left without a verdict (a cut-off or unparseable batch, a reply that
// drops ids, or the spend cap stopping the re-read)
// (https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/35).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.mjs";
import { reread, rereadBatches, rereadBatchSize, REREAD_TOKENS_PER_ROW } from "../src/judge.mjs";
import { mockClientFor, scriptedJudge, resetRegistry, firstSentence, TEST_PRICES } from "./_mock.mjs";
import { runMini, miniReader } from "./_mini.mjs";

beforeEach(resetRegistry);

const incomplete = (w) => /^re-read incomplete: /.test(w);
const PERSONAS = ["small-context-host", "cautious-agent", "technical-term-searcher", "literal-reader"];

// ── a mini run: one single-reader row per reader ─────────────────────────────

// Each reader files one confusion note about a different field: four
// single-reader rows, every one a re-read candidate.
const oneEach = Object.fromEntries(
  PERSONAS.map((p, i) => [p, [{ tool: "delete_saved_report", about: `field_${i}`, kind: "ambiguous", issue: `Unclear what field_${i} does.` }]]),
);
const isReread = (p) => p.prompt.includes("COMPLAINTS:");

test("a re-read cut off at the output cap withholds pass and reports how many rows are unverified", async () => {
  const prompts = [];
  const out = mkdtempSync(join(tmpdir(), "act-reread-"));
  const res = await runMini({
    script: miniReader({ confusion: oneEach }),
    // Teach-back replies are short and fit; re-read rows are ~2,500 tokens each.
    judgeClient: scriptedJudge("claude-sonnet-4-6", { rereadPad: 10000, honourCap: true, prompts }),
    out,
  });
  // Teach-back was graded: only the re-read failed.
  assert.ok(!res.grade.withheldPass.some((w) => /teach-back/.test(w)), JSON.stringify(res.grade.withheldPass));
  assert.ok(res.judge.failures.length > 0);
  for (const f of res.judge.failures) {
    assert.match(f.purpose, /^re-read/);
    assert.equal(f.stopReason, "max_tokens");
  }
  assert.equal(res.grade.counts.mustFix, 0);
  assert.equal(res.grade.verdict, "conditional");
  const w = res.grade.withheldPass.find(incomplete);
  assert.ok(w, JSON.stringify(res.grade.withheldPass));
  assert.match(w, /^re-read incomplete: 4 of 4 single-reader rows unverified \(4: judge failed: reply was not a JSON object \(cut off at the output cap\)\)/);
  for (const row of res.grade.cutList.filter((r) => r.kind === "confusion")) assert.match(row.reread, /^unverified \(judge failed: .*cut off/);
  // Shown in verdict.json and verdict.md.
  assert.ok(JSON.parse(readFileSync(join(out, "verdict.json"), "utf8")).grade.withheldPass.some(incomplete));
  assert.match(readFileSync(join(out, "verdict.md"), "utf8"), /## Why not pass[\s\S]*re-read incomplete: 4 of 4/);
});

test("control: the same run with a judge that fits under the cap passes", async () => {
  const res = await runMini({ script: miniReader({ confusion: oneEach }), judgeClient: scriptedJudge("claude-sonnet-4-6", { honourCap: true }) });
  assert.deepEqual(res.judge.failures, []);
  for (const row of res.grade.cutList.filter((r) => r.kind === "confusion")) assert.equal(typeof row.reread, "object");
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
});

test("a judge reply that parses but drops ids withholds pass too", async () => {
  const res = await runMini({
    script: miniReader({ confusion: oneEach }),
    judgeClient: scriptedJudge("claude-sonnet-4-6", { dropIds: ["confusion:delete_saved_report:field_1"] }),
  });
  assert.deepEqual(res.judge.failures, []);
  const w = res.grade.withheldPass.find(incomplete);
  assert.match(w, /^re-read incomplete: 1 of 4 single-reader rows unverified \(1: judge returned no re-read for this row\)/);
  assert.equal(res.grade.verdict, "conditional");
});

test("when the remaining --max-usd cannot cover the re-read, it is not sent and pass is withheld", async () => {
  const prompts = [];
  // The provider bills teach-back far above the reply's size, using up most of
  // the budget: spend so far plus the re-read call's upper bound is over $1.
  const judgeClient = scriptedJudge("claude-sonnet-4-6", { prompts, billOutput: (p) => (p.includes("ITEMS:") ? 16000 : null) });
  const res = await runMini({ script: miniReader({ confusion: oneEach }), judgeClient });
  assert.equal(prompts.filter(isReread).length, 0, "no re-read call was made");
  assert.ok(res.cost.actual.usd <= res.cost.maxUsd, `${res.cost.actual.usd} > ${res.cost.maxUsd}`);
  const w = res.grade.withheldPass.find(incomplete);
  assert.match(w, /^re-read incomplete: 4 of 4 single-reader rows unverified \(4: not re-read: --max-usd 1 would be exceeded/);
  for (const row of res.grade.cutList.filter((r) => r.kind === "confusion")) assert.match(row.reread, /^unverified \(not re-read: --max-usd 1 would be exceeded/);
  assert.equal(res.grade.verdict, "conditional");
});

test("no judge: no re-read-incomplete reason (no --judge already withholds pass)", async () => {
  const res = await runMini({ judge: null, script: miniReader({ confusion: oneEach }) });
  assert.ok(!res.grade.withheldPass.some(incomplete));
  assert.ok(res.grade.withheldPass.some((w) => /no --judge/.test(w)));
});

// ── a large payload: more single-reader rows than one reply holds ───────────

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
// Every reader files a confusion note on every tool, each about its own field:
// 4 x 17 = 68 single-reader rows.
const bigReader = (artifact, personaId) => ({
  teachBack: artifact.tools.map((t) => ({ tool: t.name, meaning: firstSentence(t.description) })),
  routing: artifact.requests.map((r, i) => ({ requestId: r.id, tool: names[i] })),
  confusion: artifact.tools.map((t) => ({ tool: t.name, about: `${personaId}_field`, kind: "ambiguous", issue: `What does ${personaId}_field mean on ${t.name}?` })),
});
// A verbose judge: ~250 tokens per re-read row. 68 rows in one reply would be
// ~17,000 tokens, far over the 4,096 cap; a batch of rereadBatchSize(4096) fits.
const verbose = (prompts) => scriptedJudge("claude-sonnet-4-6", { rereadPad: 1000, honourCap: true, prompts });

test("large payload: 68 single-reader rows are re-read across several calls and every row gets a verdict", async () => {
  const prompts = [];
  const res = await run(
    { tools: bigTools, truth: bigTruth, requests: bigRequests, models: ["claude-haiku-4-5", "gpt-5"], judge: "claude-sonnet-4-6", maxUsd: 10, prices: TEST_PRICES, env: {} },
    { clientFor: mockClientFor({ script: bigReader, judgeModel: "claude-sonnet-4-6", judge: verbose(prompts) }) },
  );
  assert.deepEqual(res.judge.failures, []);
  const calls = prompts.filter(isReread);
  assert.equal(calls.length, Math.ceil(68 / rereadBatchSize(4096)));
  const sent = calls.flatMap((p) => JSON.parse(p.prompt.slice(p.prompt.indexOf("COMPLAINTS:") + 11)).map((c) => c.id));
  assert.equal(sent.length, 68);
  assert.equal(new Set(sent).size, 68, "every row sent exactly once");
  const single = res.grade.cutList.filter((r) => r.kind === "confusion");
  assert.equal(single.length, 68);
  for (const row of single) assert.equal(typeof row.reread, "object", `${row.id}: ${row.reread}`);
  assert.ok(!res.grade.withheldPass.some(incomplete), JSON.stringify(res.grade.withheldPass));
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
});

test("control: the same 68 rows asked for in one reply are cut off", async () => {
  const rows = Array.from({ length: 68 }, (_, i) => ({ id: `c${i}`, tools: ["t"], about: "a", complaint: "x", defect: "d" }));
  await assert.rejects(
    reread(verbose(), { tools: [] }, rows, { maxTokens: 4096, batchSize: 68 }),
    (err) => err.stopReason === "max_tokens" && /cut off/.test(err.message),
  );
});

test("a failed batch does not stop the later ones: only its own rows are unverified", async () => {
  let n = 0;
  const flaky = {
    model: "j",
    async complete(args) {
      n += 1;
      if (n === 2) return { ok: true, text: '{"rereads": [', stopReason: "max_tokens" };
      return scriptedJudge("j").complete(args);
    },
  };
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, tools: ["t"], about: "a", complaint: "x", defect: "d" }));
  const failed = [];
  const got = await reread(flaky, { tools: [] }, rows, { maxTokens: 4096, batchSize: 3, onBatchError: (err, batch, i, total) => failed.push({ ids: batch.map((c) => c.id), i, total, stop: err.stopReason }) });
  assert.equal(n, 3);
  assert.deepEqual(failed, [{ ids: ["c3", "c4", "c5"], i: 1, total: 3, stop: "max_tokens" }]);
  assert.deepEqual([...got.keys()], ["c0", "c1", "c2", "c6"]);
});

test("beforeBatch can stop the re-read; every row not sent goes to onStop", async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, tools: ["t"], about: "a", complaint: "x", defect: "d" }));
  let calls = 0;
  const stopped = [];
  const got = await reread(scriptedJudge("j"), { tools: [] }, rows, {
    batchSize: 2,
    beforeBatch: () => (calls++ === 0 ? null : "out of budget"),
    onStop: (reason, left) => stopped.push([reason, left.map((c) => c.id)]),
  });
  assert.deepEqual([...got.keys()], ["c0", "c1"]);
  assert.deepEqual(stopped, [["out of budget", ["c2", "c3", "c4"]]]);
});

test("a reply carrying an id from outside its batch is ignored", async () => {
  const judge = { model: "j", complete: async () => ({ ok: true, text: '{"rereads": [{"id": "c0", "ambiguous": true, "why": "w"}, {"id": "elsewhere", "ambiguous": true, "why": "w"}]}' }) };
  const got = await reread(judge, { tools: [] }, [{ id: "c0" }]);
  assert.deepEqual([...got.keys()], ["c0"]);
});

test("rereadBatchSize derives rows per call from the output cap; rereadBatches keeps every row once, in order", () => {
  assert.equal(rereadBatchSize(4096), Math.floor(4096 / REREAD_TOKENS_PER_ROW));
  assert.equal(rereadBatchSize(10), 1);
  const rows = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(rereadBatches(rows, 3), [[0, 1, 2], [3, 4, 5], [6]]);
});

test("estimate: stays at or above actual spend on the batched 68-row re-read", async () => {
  const res = await run(
    { tools: bigTools, truth: bigTruth, requests: bigRequests, models: ["claude-haiku-4-5", "gpt-5"], judge: "claude-sonnet-4-6", maxUsd: 10, prices: TEST_PRICES, env: {} },
    { clientFor: mockClientFor({ script: bigReader, judgeModel: "claude-sonnet-4-6", judge: verbose() }) },
  );
  assert.ok(res.cost.actual.usd <= res.cost.estimate.usd, `${res.cost.actual.usd} > ${res.cost.estimate.usd}`);
  assert.ok(res.cost.estimate.calls.filter((c) => c.purpose.startsWith("judge re-read")).length > 1, "the estimate prices more than one re-read call");
});
