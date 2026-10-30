// Offline fixture test over a real server's copy, before and after a copy
// revision. Zero tokens: every reader and the judge are scripted.
//
// Fixture: the tools/list payload of the neumann MCP server
// (https://kromatic.com/mcp/neumann), captured at server version 0.2.5
// ("before") and 0.2.10 ("after"). See test/fixtures/neumann/README.md.
//
// The scripted reader responses are a RECONSTRUCTION of the findings the
// manual comprehension test recorded against this copy, not verbatim model
// output. Each scripted reader reacts only to text it can find in the
// payload it was shown:
//   - the cautious agent and the literal reader flag the billing block's
//     free-runs count when its description says "counting this call", which
//     leaves open whether the current call is already subtracted;
//   - the small-context host complains the list is long (length-only), and
//     misreads buy_credits' destructiveHint as "deletes data" — a single
//     reader on copy that is correct;
//   - routing picks the tool for each request by its intent, from the names
//     actually present.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/run.mjs";
import { fixture, fixtureJson, mockClientFor, firstSentence, resetRegistry, TEST_PRICES } from "./_mock.mjs";

const ROUTES = {
  r01: ["run_monte_carlo_simulation", "run_simulation"],
  r02: ["rank_inputs_by_impact", "oat_sensitivity"],
  r03: ["summarize_outcome_scenarios", "scenario_analysis"],
  r04: ["check_simulation_model", "validate_graph"],
  r05: ["estimate_simulation_size_and_cost", "estimate"],
  r06: ["convert_range_to_distribution", "solve_distribution_parameters"],
  r07: ["convert_distribution_to_range", "describe_distribution"],
  r08: ["get_simulation_results", "get_results"],
  r09: ["check_account_and_credits", "whoami"],
  r10: ["buy_credits"],
  r11: ["send_feedback", "feedback"],
  r12: [],
};

export function neumannReader(artifact, personaId) {
  const tools = artifact.tools;
  const names = new Set(tools.map((t) => t.name));
  const json = JSON.stringify(tools);
  const teachBack = tools.map((t) => ({ tool: t.name, meaning: firstSentence(t.description) }));
  const routing = artifact.requests.map((r) => ({ requestId: r.id, tool: (ROUTES[r.id] ?? []).find((n) => names.has(n)) ?? "none" }));
  const confusion = [];
  const accountTool = names.has("check_account_and_credits") ? "check_account_and_credits" : "whoami";
  const m = json.match(/Free anonymous runs left[^"]*counting this call[^"]*/);
  if (m && (personaId === "cautious-agent" || personaId === "literal-reader")) {
    confusion.push({
      tool: accountTool,
      about: "billing.anonymous_runs_remaining_today",
      kind: "ambiguous",
      issue:
        personaId === "cautious-agent"
          ? `"${m[0]}" — I cannot tell whether this call has already been subtracted, so I cannot tell the user how many free runs remain.`
          : `"counting this call" reads both ways: the count includes this call, or the count already excludes it.`,
    });
  }
  if (personaId === "small-context-host") {
    confusion.push({ tool: "*", about: "tool list", kind: "length", issue: "The tool list is very long; the schemas take most of my context." });
    const buy = tools.find((t) => t.name === "buy_credits");
    if (buy?.annotations?.destructiveHint === true) {
      confusion.push({ tool: "buy_credits", about: "annotations.destructiveHint", kind: "misleading", issue: "destructiveHint is true, so buy_credits looks like it deletes account data." });
    }
  }
  return { teachBack, routing, confusion };
}

const MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "gpt-5"];

async function runVersion(ver, extra = {}) {
  return run(
    {
      tools: fixtureJson(`neumann/tools-${ver}.json`),
      truth: fixture(`neumann/truth-${ver}.md`),
      requests: fixtureJson(`neumann/requests-${ver}.json`),
      models: MODELS,
      judge: "claude-sonnet-4-6",
      maxUsd: 5,
      prices: TEST_PRICES,
      env: {},
      ...extra,
    },
    { clientFor: mockClientFor({ script: neumannReader, judgeModel: "claude-sonnet-4-6" }) },
  );
}

const rowsOf = (res, cls) => res.grade.cutList.filter((r) => r.class === cls);

beforeEach(resetRegistry);

test("before copy: non-pass, with a must-fix row for the free-runs count semantics", async () => {
  const res = await runVersion("before");
  assert.equal(res.readers.length, 4, "three models and four personas give four readers");
  assert.equal(res.grade.crossModel, true);
  assert.notEqual(res.grade.verdict, "pass");
  assert.equal(res.grade.verdict, "conditional");
  const mustFix = rowsOf(res, "must-fix");
  const billing = mustFix.find((r) => r.id === "confusion:whoami:billing.anonymous_runs_remaining_today");
  assert.ok(billing, `expected the free-runs semantics row; got ${mustFix.map((r) => r.id).join(", ")}`);
  assert.deepEqual(billing.trippedBy.map((t) => t.personaId).sort(), ["cautious-agent", "literal-reader"]);
  assert.ok(billing.trippedBy.every((t) => t.evidence.length > 0), "every trip carries the reader's words");
});

test("before copy: the schema-bloat token-weight flag is an informational row, not a defect", async () => {
  const res = await runVersion("before");
  const bloat = res.grade.cutList.find((r) => r.kind === "token-weight" && /BillingInfo/.test(r.defect));
  assert.ok(bloat, "the repeated billing sub-schema is flagged");
  assert.equal(bloat.class, "informational");
  assert.equal(res.grade.counts.mustFix, 1, "only the semantics row is must-fix; bloat does not add one");
});

test("after copy: the must-fix row clears and the verdict is pass", async () => {
  const res = await runVersion("after");
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
  assert.equal(rowsOf(res, "must-fix").length, 0);
  assert.ok(!res.grade.cutList.some((r) => r.id.includes("anonymous_runs_remaining_today")));
});

test("after copy: the bloat flag persists as informational and does not block pass", async () => {
  // The revision deliberately kept schema size (length is not a defect), so
  // an honest measurement still flags the repeated sub-schema. It must stay
  // informational and leave the verdict alone.
  const res = await runVersion("after");
  const bloat = res.grade.cutList.find((r) => r.kind === "token-weight" && /BillingInfo/.test(r.defect));
  assert.ok(bloat);
  assert.equal(bloat.class, "informational");
  assert.equal(res.grade.verdict, "pass");
});

test("the single-reader annotation misread is a reader error in both copies", async () => {
  for (const ver of ["before", "after"]) {
    resetRegistry();
    const res = await runVersion(ver);
    const row = res.grade.cutList.find((r) => r.id === "confusion:buy_credits:annotations.destructivehint");
    assert.ok(row, ver);
    assert.equal(row.class, "reader-error", ver);
    assert.equal(row.reread.ambiguous, false);
  }
});

test("the length-only complaint is informational in both copies", async () => {
  for (const ver of ["before", "after"]) {
    resetRegistry();
    const res = await runVersion(ver);
    const row = res.grade.cutList.find((r) => r.kind === "length");
    assert.equal(row.class, "informational", ver);
  }
});

test("routing is clean in both copies: every request reaches its expected tool", async () => {
  for (const ver of ["before", "after"]) {
    resetRegistry();
    const res = await runVersion(ver);
    assert.equal(res.grade.cutList.filter((r) => r.kind === "routing").length, 0, ver);
  }
});

test("the fixture run spends no tokens: network is disabled and every call is scripted", async () => {
  // _mock.mjs replaces fetch with one that throws, and env carries no keys.
  await assert.rejects(fetch("https://example.com"), /network call attempted/);
  const res = await runVersion("before");
  assert.ok(res.cost.actual.calls.length > 0);
  assert.ok(res.cost.actual.calls.every((c) => c.model in TEST_PRICES), "only scripted models were called");
});
