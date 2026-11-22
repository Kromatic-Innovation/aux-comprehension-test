// Direct unit tests for the re-read input-size helpers (rereadInputChars,
// rereadInputReport, rereadInputOverLine) and the last fallback of the judge's
// value quoting. The run-level behaviour is in estimate-reread-rows.test.mjs;
// these pin each helper on its own.
// https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/74

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rereadRowReport, rereadInputChars, rereadInputReport } from "../src/run.mjs";
import { rereadOverLine, rereadInputOverLine } from "../src/cli.mjs";
import { buildRereadPrompt, rereadBatches, rereadBatchSize, judgeMaxTokensProblem, REREAD_TOKENS_PER_ROW } from "../src/judge.mjs";
import { normalizePayload } from "../src/inputs.mjs";
import { fixtureJson, resetRegistry, scriptedJudge } from "./_mock.mjs";
import { miniReader, runMini } from "./_mini.mjs";

beforeEach(resetRegistry);

const payload = normalizePayload(fixtureJson("mini/tools.json"));
const row = (i, issue = `Unclear what field_${i} does.`) => ({ id: `row-${i}`, tool: "delete_saved_report", about: `field_${i}`, kind: "ambiguous", complaint: issue });

test("rereadRowReport: counts against the assumed rows, and no assumption is never over", () => {
  assert.deepEqual(rereadRowReport(10, 4, 4), { rowsAssumed: 10, rows: 4, rowsSent: 4, overAssumed: false });
  assert.deepEqual(rereadRowReport(10, 10, 10), { rowsAssumed: 10, rows: 10, rowsSent: 10, overAssumed: false });
  assert.deepEqual(rereadRowReport(10, 11, 3), { rowsAssumed: 10, rows: 11, rowsSent: 3, overAssumed: true });
  assert.equal(rereadRowReport(null, 50, 50).overAssumed, false);
});

test("rereadInputChars: the input of every batch reread() would build, at the judge's batch size", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(i));
  for (const maxTokens of [REREAD_TOKENS_PER_ROW, 3 * REREAD_TOKENS_PER_ROW, 2048]) {
    const batches = rereadBatches(rows, rereadBatchSize(maxTokens));
    const want = batches.reduce((n, b) => n + buildRereadPrompt(payload, b).length, 0);
    assert.equal(rereadInputChars(payload, rows, maxTokens), want, `maxTokens ${maxTokens}`);
  }
  // One row per call repeats the payload in every prompt, so it needs more input than one batch of all seven.
  assert.ok(rereadInputChars(payload, rows, REREAD_TOKENS_PER_ROW) > rereadInputChars(payload, rows, 7 * REREAD_TOKENS_PER_ROW));
  // Longer complaints need more input at the same row count.
  const long = rows.map((r, i) => row(i, "x".repeat(1000)));
  assert.ok(rereadInputChars(payload, long, 2048) > rereadInputChars(payload, rows, 2048));
  // No rows due a re-read: no prompt, no input.
  assert.equal(rereadInputChars(payload, [], 2048), 0);
});

test("rereadInputReport: over only when the input exceeds what the estimate priced", () => {
  assert.deepEqual(rereadInputReport(5000, 4000), { inputCharsAssumed: 5000, inputChars: 4000, inputOverAssumed: false });
  assert.deepEqual(rereadInputReport(5000, 5000), { inputCharsAssumed: 5000, inputChars: 5000, inputOverAssumed: false });
  assert.deepEqual(rereadInputReport(5000, 5001), { inputCharsAssumed: 5000, inputChars: 5001, inputOverAssumed: true });
  // No priced re-read: nothing to be over.
  assert.deepEqual(rereadInputReport(null, 9999), { inputCharsAssumed: null, inputChars: 9999, inputOverAssumed: false });
});

test("rereadInputOverLine: names the input size and the estimate's assumption", () => {
  assert.equal(
    rereadInputOverLine({ inputChars: 6123, inputCharsAssumed: 5000, inputOverAssumed: true }),
    "re-read input: 6123 chars, 5000 assumed by the estimate's placeholder rows; the re-read part of the estimate was exceeded",
  );
  // Control: the row-count line is a different line, so the two warnings cannot be confused.
  assert.notEqual(rereadOverLine({ rows: 11, rowsAssumed: 10, rowsSent: 3 }), rereadInputOverLine({ inputChars: 11, inputCharsAssumed: 10 }));
});

// Which count is reported when --max-usd stops the re-read: inputChars is the
// input a FULL re-read of every row due would need (as `rows` counts rows due,
// not rows sent), not the input actually sent.
test("spend-stop: inputChars counts every batch due, including the ones the cap kept back", async () => {
  const PERSONAS = ["small-context-host", "cautious-agent", "technical-term-searcher", "literal-reader"];
  const confusion = Object.fromEntries(
    PERSONAS.map((p) => [p, Array.from({ length: 4 }, (_, i) => ({ tool: "delete_saved_report", about: `${p}_field_${i}`, kind: "ambiguous", issue: `Unclear what ${p}_field_${i} does.` }))]),
  );
  const prompts = [];
  // The provider bills teach-back far above the reply's size, so no re-read batch can be afforded.
  const judgeClient = scriptedJudge("claude-sonnet-4-6", { prompts, billOutput: (p) => (p.includes("ITEMS:") ? 16000 : null) });
  const stopped = await runMini({ script: miniReader({ confusion }), judgeClient });
  assert.equal(stopped.cost.reread.rows, 16);
  assert.equal(stopped.cost.reread.rowsSent, 0);
  assert.equal(prompts.filter((p) => p.prompt.includes("COMPLAINTS:")).length, 0, "no re-read call was sent");

  // Control: the same rows with the budget to send them all.
  resetRegistry();
  const full = await runMini({ script: miniReader({ confusion }), maxUsd: 100 });
  assert.equal(full.cost.reread.rowsSent, 16);

  assert.ok(stopped.cost.reread.inputChars > 0);
  assert.equal(stopped.cost.reread.inputChars, full.cost.reread.inputChars);
});

test("quote's last fallback: a value with neither a JSON nor a string form is still quoted", () => {
  // Circular, so JSON.stringify throws; null prototype, so String() throws too.
  const bare = Object.create(null);
  bare.self = bare;
  assert.throws(() => JSON.stringify(bare));
  assert.throws(() => String(bare));
  assert.match(judgeMaxTokensProblem(bare), /got \[object Object\] \(object\): /);
});
