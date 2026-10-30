import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePayload, parseTruth, checkTruthCoverage, normalizeRequests } from "../src/inputs.mjs";

const P = { tools: [{ name: "a" }, { name: "b" }] };

test("payload: bare array, {tools} and JSON-RPC {result:{tools}} are accepted", () => {
  assert.equal(normalizePayload(P.tools).tools.length, 2);
  assert.equal(normalizePayload(P).tools.length, 2);
  assert.equal(normalizePayload({ jsonrpc: "2.0", result: P }).tools.length, 2);
  assert.throws(() => normalizePayload({}), /non-empty tools array/);
  assert.throws(() => normalizePayload([{ description: "x" }]), /string `name`/);
});

test("truth: one section per tool, misreadings split out, preamble ignored", () => {
  const t = parseTruth("# Title\npreamble\n\n## a\n\nDoes A.\n\n- Misreading: does B.\n\n## `b`\nDoes B.\n");
  assert.deepEqual(t.tools.a, { meaning: "Does A.", misreadings: ["does B."] });
  assert.equal(t.tools.b.meaning, "Does B.");
  assert.throws(() => parseTruth(""), /empty/);
  assert.throws(() => parseTruth("# only a title"), /no `## <tool_name>`/);
  assert.throws(() => parseTruth("## a\nx\n## a\ny"), /twice/);
});

test("truth must cover exactly the payload's tools", () => {
  assert.throws(() => checkTruthCoverage(parseTruth("## a\nx"), P), /no ground truth for: b/);
  assert.throws(() => checkTruthCoverage(parseTruth("## a\nx\n## b\ny\n## c\nz"), P), /not in the payload: c/);
  checkTruthCoverage(parseTruth("## a\nx\n## b\ny"), P);
});

test("requests: expected must be a payload tool or none; ids unique", () => {
  assert.equal(normalizeRequests([{ id: "1", request: "r", expected: "none" }], P).length, 1);
  assert.throws(() => normalizeRequests([{ id: "1", request: "r", expected: "zzz" }], P), /not a tool in the payload/);
  assert.throws(() => normalizeRequests([{ id: "1", request: "r", expected: "a", nearMiss: "q" }], P), /nearMiss/);
  assert.throws(() => normalizeRequests([{ id: "1", request: "r", expected: "a" }, { id: "1", request: "s", expected: "b" }], P), /duplicate/);
  assert.throws(() => normalizeRequests([], P), /non-empty/);
});
