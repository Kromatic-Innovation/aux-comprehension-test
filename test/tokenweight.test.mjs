// Token-weight report: bytes and approximate tokens for the whole payload and
// per tool (description, input schema, output schema), labelled
// informational. Over-length alone never yields fail.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { measureTokenWeight, renderTokenWeightMd } from "../src/tokenweight.mjs";
import { fixtureJson, resetRegistry } from "./_mock.mjs";
import { runMini } from "./_mini.mjs";

beforeEach(resetRegistry);

test("reports whole-payload and per-tool bytes and ~tokens, split by part", async () => {
  const payload = fixtureJson("mini/tools.json");
  const r = await measureTokenWeight(payload);
  assert.match(r.label, /informational/);
  assert.equal(r.method, "approximate (chars / 4)");
  assert.equal(r.total.bytes, Buffer.byteLength(JSON.stringify(payload)));
  assert.equal(r.total.tokens, Math.ceil(r.total.bytes / 4));
  assert.equal(r.tools.length, 3);
  const t = r.tools[0];
  assert.equal(t.parts.description.bytes, Buffer.byteLength(payload.tools[0].description));
  assert.equal(t.parts.inputSchema.bytes, Buffer.byteLength(JSON.stringify(payload.tools[0].inputSchema)));
  assert.deepEqual(t.parts.outputSchema, { bytes: 0, tokens: 0 });
});

test("uses a provider token count when one is supplied", async () => {
  const r = await measureTokenWeight(fixtureJson("mini/tools.json"), { countTokens: async (s) => s.length });
  assert.equal(r.method, "provider token count");
  assert.equal(r.total.tokens, JSON.stringify(fixtureJson("mini/tools.json")).length);
});

test("flags a repeated sub-schema and a dominant tool, informationally", async () => {
  const shared = { type: "object", description: "x".repeat(2000), properties: { a: { type: "string" } } };
  const tools = ["a", "b", "c", "d"].map((n) => ({ name: n, description: "d", inputSchema: { type: "object", $defs: { Shared: shared } } }));
  tools.push({ name: "huge", description: "y".repeat(40000) });
  const r = await measureTokenWeight({ tools });
  const kinds = r.flags.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ["dominant-tool", "repeated-subschema"]);
  assert.match(renderTokenWeightMd(r), /Informational flags[\s\S]*Shared/);
});

test("over-length alone never yields fail or a must-fix row", async () => {
  // Bloat every description and schema 50x, with clean readers.
  const payload = fixtureJson("mini/tools.json");
  for (const t of payload.tools) {
    t.description = `${t.description} ${"Padding sentence that adds length. ".repeat(400)}`;
    t.inputSchema.$defs = { Pad: { type: "object", description: "z".repeat(20000) } };
  }
  const res = await runMini({ tools: payload, maxUsd: 5 });
  assert.equal(res.grade.verdict, "pass");
  assert.equal(res.grade.counts.mustFix, 0);
  assert.ok(res.grade.cutList.filter((r) => r.kind === "token-weight").every((r) => r.class === "informational"));
  assert.ok(res.grade.cutList.some((r) => r.kind === "token-weight"), "the bloat was flagged");
});
