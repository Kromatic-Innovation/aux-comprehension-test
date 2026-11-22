// The teach-back judge sees each tool's own payload text, not only the truth
// file's `meaning`, so a reader who repeats a true detail from the payload
// that the truth author left out is not reported as drift
// (https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/38).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.mjs";
import { buildTeachBackPrompt, payloadToolText } from "../src/judge.mjs";
import { normalizePayload, parseTruth } from "../src/inputs.mjs";
import { fixture, fixtureJson, mockClientFor, resetRegistry, firstSentence, TEST_PRICES } from "./_mock.mjs";

beforeEach(resetRegistry);

// A synthetic payload: estimate_run_cost states a chart and numeric limits
// that the mini truth file's `meaning` for it does not mention.
const DETAIL = "Returns a breakdown chart. Accepts up to 50000 trials and 200 nodes.";
const INSTRUCTION_DETAIL = "Every estimate also includes a confidence band.";

function syntheticTools() {
  const raw = fixtureJson("mini/tools.json");
  const t = raw.tools.find((x) => x.name === "estimate_run_cost");
  t.description = `${t.description} ${DETAIL}`;
  return { tools: raw.tools, instructions: `Use estimate_run_cost before any run. ${INSTRUCTION_DETAIL}` };
}

const truthMd = fixture("mini/truth.md");
const truth = parseTruth(truthMd);
assert.ok(!/chart|50000|confidence/i.test(truth.tools.estimate_run_cost.meaning), "fixture premise: truth omits the detail");

/** Every reader explains estimate_run_cost with the payload's extra details. */
const readerWithDetail = (invented = "") => (artifact) => ({
  teachBack: artifact.tools.map((t) => ({
    tool: t.name,
    meaning: t.name === "estimate_run_cost" ? `Predicts how many credits a simulation run will cost. ${DETAIL} ${INSTRUCTION_DETAIL} ${invented}`.trim() : firstSentence(t.description),
  })),
  routing: artifact.requests.map((r) => ({ requestId: r.id, tool: { q1: "estimate_run_cost", q2: "forecast_probability", q3: "delete_saved_report", q4: "none" }[r.id] })),
  confusion: [],
});

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

/**
 * A stub judge that behaves like the one in the issue: any significant word in
 * the reader's teach-back that appears in neither the intended meaning, the
 * tool's payload text, nor the server instructions is an "added detail" and
 * so drift.
 */
function strictJudge(model, prompts = []) {
  return {
    model,
    async complete({ prompt }) {
      prompts.push(prompt);
      const instr = prompt.slice(prompt.indexOf("SERVER INSTRUCTIONS:"), prompt.lastIndexOf("ITEMS:"));
      const items = JSON.parse(prompt.slice(prompt.lastIndexOf("ITEMS:") + 6));
      const grades = items.map((it) => {
        const known = words(`${it.intended} ${it.payload ?? ""} ${instr}`);
        const added = [...words(it.reader)].filter((w) => !known.has(w));
        return added.length
          ? { tool: it.tool, recovered: false, drift: `adds details the instructions do not contain: ${added.join(", ")}` }
          : { tool: it.tool, recovered: true, drift: "" };
      });
      const text = JSON.stringify({ grades });
      return { ok: true, text, model, stopReason: "end_turn", usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(text.length / 4) } };
    },
  };
}

function runSynthetic({ script, judge }) {
  return run(
    {
      tools: syntheticTools(),
      truth: truthMd,
      requests: fixtureJson("mini/requests.json"),
      models: ["claude-haiku-4-5", "gpt-5"],
      judge: "claude-sonnet-4-6",
      maxUsd: 1,
      prices: TEST_PRICES,
      env: {},
    },
    { clientFor: mockClientFor({ script, judgeModel: "claude-sonnet-4-6", judge }) },
  );
}

const teachBackRows = (res, tool) => res.grade.cutList.filter((r) => r.kind === "teachback" && r.tools.includes(tool));

test("the teach-back prompt carries each tool's payload text and the server instructions", () => {
  const payload = normalizePayload(syntheticTools());
  const prompt = buildTeachBackPrompt(truth, [], Object.keys(truth.tools), payload);
  const items = JSON.parse(prompt.slice(prompt.lastIndexOf("ITEMS:") + 6));
  const item = items.find((i) => i.tool === "estimate_run_cost");
  assert.equal(item.payload, payloadToolText(payload, "estimate_run_cost"));
  assert.ok(item.payload.includes(DETAIL));
  assert.equal(item.intended, truth.tools.estimate_run_cost.meaning);
  // Each item carries only its own tool's text.
  assert.ok(!items.find((i) => i.tool === "forecast_probability").payload.includes(DETAIL));
  assert.ok(prompt.includes(INSTRUCTION_DETAIL));
  assert.match(prompt, /present in the payload[^.]*is never drift/);
});

test("a true payload detail the truth file omits is not reported as drift", async () => {
  const prompts = [];
  const res = await runSynthetic({ script: readerWithDetail(), judge: strictJudge("claude-sonnet-4-6", prompts) });
  assert.deepEqual(res.judge.failures, []);
  assert.ok(prompts.some((p) => p.includes(DETAIL)), "the judge was shown the payload detail");
  assert.deepEqual(teachBackRows(res, "estimate_run_cost"), []);
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
});

test("control: without the payload text the same judge reports the true detail as drift", async () => {
  const prompts = [];
  const judge = strictJudge("claude-sonnet-4-6", prompts);
  const tb = [{ tool: "estimate_run_cost", meaning: `Predicts how many credits a simulation run will cost. ${DETAIL}` }];
  const res = await judge.complete({ prompt: buildTeachBackPrompt(truth, tb, ["estimate_run_cost"]) });
  const [g] = JSON.parse(res.text).grades;
  assert.equal(g.recovered, false);
  assert.match(g.drift, /adds details/);
});

test("control: a detail in neither the truth nor the payload is still drift", async () => {
  const res = await runSynthetic({ script: readerWithDetail("It also emails a quarterly invoice."), judge: strictJudge("claude-sonnet-4-6") });
  const rows = teachBackRows(res, "estimate_run_cost");
  assert.equal(rows.length, 1);
  assert.notEqual(res.grade.verdict, "pass");
});
