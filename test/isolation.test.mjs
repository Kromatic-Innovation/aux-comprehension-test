// Reader isolation: no ground-truth string in any rendered reader prompt, no
// expected tool in the reader view of the requests, and no tool granted.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.mjs";
import { readerRequests } from "../src/inputs.mjs";
import { fixture, fixtureJson, mockClientFor, scriptedJudge, resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { miniReader } from "./_mini.mjs";

beforeEach(resetRegistry);

const SENTINEL = "ZZ-GROUND-TRUTH-SENTINEL-ZZ";
const REQ_SENTINEL = "ZZ-REQUEST-RATIONALE-SENTINEL-ZZ";

function plantedInputs() {
  // The sentinel goes into every place ground truth lives: each tool's
  // intended meaning, each feared misreading, and an author-only field on
  // every request.
  const truth = fixture("mini/truth.md")
    .replace(/^(Predicts|Forecasts|Permanently)/gm, `${SENTINEL} $1`)
    .replace(/- Misreading: /g, `- Misreading: ${SENTINEL} `);
  const requests = fixtureJson("mini/requests.json").map((r) => ({ ...r, rationale: `${REQ_SENTINEL} because ${r.expected}` }));
  return { truth, requests };
}

test("sentinel: no ground-truth string appears in any rendered reader prompt", async () => {
  const { truth, requests } = plantedInputs();
  const readerPrompts = [];
  const judgePrompts = [];
  const res = await run(
    { tools: fixtureJson("mini/tools.json"), truth, requests, models: ["claude-haiku-4-5", "gpt-5"], judge: "claude-sonnet-4-6", maxUsd: 1, prices: TEST_PRICES, env: {} },
    { clientFor: mockClientFor({ script: miniReader(), judgeModel: "claude-sonnet-4-6", judge: scriptedJudge("claude-sonnet-4-6", { prompts: judgePrompts }), prompts: readerPrompts }) },
  );
  assert.equal(res.status, "completed");
  assert.equal(readerPrompts.length, 4, "every reader prompt was captured");
  for (const { personaId, prompt } of readerPrompts) {
    assert.ok(!prompt.includes(SENTINEL), `${personaId}: ground truth leaked into the reader prompt`);
    assert.ok(!prompt.includes(REQ_SENTINEL), `${personaId}: an author-only request field leaked`);
    assert.ok(!prompt.includes("Misreading"), `${personaId}: feared misreadings leaked`);
    assert.ok(!/"expected"|"nearMiss"/.test(prompt), `${personaId}: expected tools leaked`);
    assert.ok(prompt.includes("estimate_run_cost"), "the payload itself is in the prompt");
  }
  // Negative control: the planted truth really did reach the run — the judge,
  // which is not a reader, sees it. Without this a broken plant would pass.
  assert.ok(judgePrompts.some((p) => p.prompt.includes(SENTINEL)), "control: sentinel reached the judge");
});

test("no reader prompt contains another reader's output", async () => {
  const prompts = [];
  const script = (artifact, personaId) => ({ ...miniReader()(artifact, personaId), confusion: [{ tool: "*", about: "x", kind: "other", issue: `UNIQUE-${personaId}` }] });
  await run(
    { tools: fixtureJson("mini/tools.json"), truth: fixture("mini/truth.md"), requests: fixtureJson("mini/requests.json"), models: ["claude-haiku-4-5", "gpt-5"], maxUsd: 1, prices: TEST_PRICES, env: {} },
    { clientFor: mockClientFor({ script, prompts }) },
  );
  for (const { prompt } of prompts) assert.ok(!/UNIQUE-/.test(prompt));
});

test("the reader view of requests carries only id and request text", () => {
  const view = readerRequests([{ id: "a", request: "r", expected: "t", nearMiss: "u", rationale: "x" }]);
  assert.deepEqual(view, [{ id: "a", request: "r" }]);
});

test("readers are granted no tools", async () => {
  const seen = [];
  const clientFor = (spec) => ({
    client: {
      model: spec.model,
      async complete(args) {
        seen.push(args.tools);
        return { ok: true, model: spec.model, text: JSON.stringify({ verdict: { teachBack: [], routing: [], confusion: [] }, message: "m", dealKillers: [] }) };
      },
    },
  });
  const res = await run(
    { tools: fixtureJson("mini/tools.json"), truth: fixture("mini/truth.md"), requests: fixtureJson("mini/requests.json"), models: ["claude-haiku-4-5", "gpt-5"], maxUsd: 1, prices: TEST_PRICES, env: {} },
    { clientFor },
  );
  assert.ok(seen.length > 0);
  for (const t of seen) assert.deepEqual(t, []);
  assert.equal(res.status, "completed");
});
