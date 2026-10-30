// Grading rules: crossModel, reader error vs must-fix, length-only,
// structural fail, routing near-miss pairs.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runMini, miniReader } from "./_mini.mjs";
import { scriptedJudge, resetRegistry } from "./_mock.mjs";
import { isLengthOnly } from "../src/grade.mjs";

beforeEach(resetRegistry);

// ── crossModel ──────────────────────────────────────────────────────────────────────

test("counter-example: two Anthropic models with zero defects yield conditional, not pass", async () => {
  const res = await runMini({ models: ["claude-haiku-4-5", "claude-sonnet-4-6"] });
  assert.equal(res.grade.counts.mustFix, 0);
  assert.equal(res.grade.counts.structural, 0);
  assert.equal(res.grade.crossModel, false);
  assert.deepEqual(res.grade.providers, ["anthropic"]);
  assert.equal(res.grade.verdict, "conditional");
  assert.ok(res.grade.withheldPass.some((w) => /single-provider/.test(w)));
});

test("control: the same clean panel across two providers passes", async () => {
  const res = await runMini({ models: ["claude-haiku-4-5", "gpt-5"] });
  assert.equal(res.grade.crossModel, true);
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
});

test("no judge: teach-back is ungraded, so pass is withheld", async () => {
  const res = await runMini({ judge: null });
  assert.equal(res.grade.verdict, "conditional");
  assert.ok(res.grade.withheldPass.some((w) => /no --judge/.test(w)));
});

// ── reader error vs must-fix ──────────────────────────────────────────────────────────

const MISREAD = { tool: "delete_saved_report", about: "annotations.destructiveHint", kind: "misleading", issue: "destructiveHint true — does this delete every report?" };

test("a defect tripped by exactly one reader on unambiguous copy is a reader error, not must-fix", async () => {
  const res = await runMini({ script: miniReader({ confusion: { "small-context-host": [MISREAD] } }) });
  const row = res.grade.cutList.find((r) => r.kind === "confusion");
  assert.equal(row.class, "reader-error");
  assert.equal(row.trippedBy.length, 1);
  assert.equal(row.trippedBy[0].personaId, "small-context-host");
  assert.equal(row.reread.ambiguous, false);
  assert.equal(res.grade.counts.mustFix, 0);
  assert.equal(res.grade.verdict, "pass", "a reader error does not block pass");
});

test("the same defect tripped by two readers is must-fix", async () => {
  const res = await runMini({ script: miniReader({ confusion: { "small-context-host": [MISREAD], "cautious-agent": [MISREAD] } }) });
  const row = res.grade.cutList.find((r) => r.kind === "confusion");
  assert.equal(row.class, "must-fix");
  assert.equal(res.grade.verdict, "conditional");
});

test("a single-reader defect the judge finds ambiguous on re-read is must-fix", async () => {
  const id = "confusion:delete_saved_report:annotations.destructivehint";
  const res = await runMini({
    script: miniReader({ confusion: { "small-context-host": [MISREAD] } }),
    judgeClient: scriptedJudge("claude-sonnet-4-6", { ambiguousIds: [id] }),
  });
  const row = res.grade.cutList.find((r) => r.id === id);
  assert.equal(row.class, "must-fix");
  assert.equal(res.grade.verdict, "conditional");
});

test("without a judge a single-reader defect stays a reader error, marked unverified", async () => {
  const res = await runMini({ judge: null, script: miniReader({ confusion: { "small-context-host": [MISREAD] } }) });
  const row = res.grade.cutList.find((r) => r.kind === "confusion");
  assert.equal(row.class, "reader-error");
  assert.match(row.reread, /unverified/);
});

// ── length-only is informational ──────────────────────────────────────────────────

const LONG = [{ tool: "*", about: "tool list", kind: "other", issue: "These descriptions are too long and wordy." }];

test("a length-only complaint yields an informational row and does not change the verdict", async () => {
  const baseline = await runMini();
  resetRegistry();
  // Every reader complains: even unanimous, length alone stays informational.
  const all = Object.fromEntries(["small-context-host", "cautious-agent", "technical-term-searcher", "literal-reader"].map((p) => [p, LONG]));
  const res = await runMini({ script: miniReader({ confusion: all }) });
  const rows = res.grade.cutList.filter((r) => r.kind === "length");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].class, "informational");
  assert.equal(rows[0].trippedBy.length, 4);
  assert.equal(res.grade.verdict, baseline.grade.verdict);
  assert.equal(res.grade.verdict, "pass");
  assert.equal(res.grade.counts.mustFix, 0);
});

test("length complaints become defects only with benchmark evidence on both counts", async () => {
  const all = { "small-context-host": LONG, "cautious-agent": LONG };
  for (const [bench, promoted] of [
    [{ materiallyLonger: true, correlatesWithLowerSelection: false }, false],
    [{ materiallyLonger: false, correlatesWithLowerSelection: true }, false],
    [{ materiallyLonger: true, correlatesWithLowerSelection: true, source: "fixture" }, true],
  ]) {
    resetRegistry();
    const res = await runMini({ script: miniReader({ confusion: all }), lengthBenchmark: bench });
    assert.equal(res.grade.counts.mustFix, promoted ? 1 : 0, JSON.stringify(bench));
  }
});

test("isLengthOnly: a length complaint is not confused with a real ambiguity", () => {
  assert.equal(isLengthOnly({ kind: "length", issue: "x" }), true);
  assert.equal(isLengthOnly({ kind: "other", issue: "The schema is bloated." }), true);
  assert.equal(isLengthOnly({ kind: "ambiguous", issue: "Long description, and unclear whether it charges." }), false);
  assert.equal(isLengthOnly({ kind: "other", issue: "Unclear whether this call is free." }), false);
});

// ── routing and structural ────────────────────────────────────────────────────────────

test("a miss on a near-miss pair is a defect on both tools", async () => {
  const wrong = { q1: "forecast_probability" };
  const res = await runMini({ script: miniReader({ routing: { "small-context-host": wrong, "cautious-agent": wrong } }) });
  const row = res.grade.cutList.find((r) => r.id === "routing:q1");
  assert.deepEqual(row.tools, ["estimate_run_cost", "forecast_probability"]);
  assert.equal(row.class, "must-fix");
  assert.match(row.trippedBy[0].evidence, /picked forecast_probability/);
});

test("a tool whose purpose no reader recovers is structural and fails the gate", async () => {
  const lost = { delete_saved_report: "Shows the weather." };
  const tb = Object.fromEntries(["small-context-host", "cautious-agent", "technical-term-searcher", "literal-reader"].map((p) => [p, lost]));
  const res = await runMini({ script: miniReader({ teachBack: tb }) });
  const row = res.grade.cutList.find((r) => r.id === "teachback:delete_saved_report");
  assert.equal(row.class, "structural");
  assert.equal(res.grade.verdict, "fail");
});

test("every cut-list row names tool, defect, persona x model and evidence; no score anywhere", async () => {
  const res = await runMini({ script: miniReader({ confusion: { "small-context-host": [MISREAD], "cautious-agent": [MISREAD] } }) });
  for (const row of res.grade.cutList) {
    assert.ok(row.tools.length && row.defect && row.class);
    for (const t of row.trippedBy) assert.ok(t.personaId && t.model && t.evidence);
  }
  const json = JSON.stringify(res.grade);
  assert.ok(!/"(score|passRate|average|mean)"/.test(json), "no averaged score or pass-rate");
});
