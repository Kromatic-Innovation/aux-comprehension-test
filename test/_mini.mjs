// _mini.mjs — a three-tool fixture and a configurable scripted reader for
// the grading-rule tests.

import { run } from "../src/run.mjs";
import { fixture, fixtureJson, mockClientFor, firstSentence, TEST_PRICES } from "./_mock.mjs";

const CORRECT = { q1: "estimate_run_cost", q2: "forecast_probability", q3: "delete_saved_report", q4: "none" };

/**
 * A clean reader (correct teach-back and routing, no confusion) with optional
 * per-reader overrides: `confusion[personaId]`, `routing[personaId]`,
 * `teachBack[personaId]` (tool -> meaning).
 */
export function miniReader({ confusion = {}, routing = {}, teachBack = {} } = {}) {
  return (artifact, personaId) => ({
    teachBack: artifact.tools.map((t) => ({ tool: t.name, meaning: teachBack[personaId]?.[t.name] ?? firstSentence(t.description) })),
    routing: artifact.requests.map((r) => ({ requestId: r.id, tool: routing[personaId]?.[r.id] ?? CORRECT[r.id] })),
    confusion: confusion[personaId] ?? [],
  });
}

export function runMini({ script = miniReader(), models = ["claude-haiku-4-5", "gpt-5"], judge = "claude-sonnet-4-6", judgeClient, missing, prompts, calls, ...opts } = {}) {
  return run(
    {
      tools: fixtureJson("mini/tools.json"),
      truth: fixture("mini/truth.md"),
      requests: fixtureJson("mini/requests.json"),
      models,
      judge,
      maxUsd: 1,
      prices: TEST_PRICES,
      env: {},
      ...opts,
    },
    { clientFor: mockClientFor({ script, judgeModel: judge, judge: judgeClient, missing, prompts, calls }) },
  );
}
