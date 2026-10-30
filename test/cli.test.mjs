// The CLI surface the workspace skill invokes:
//   run --tools --truth --requests --models [--judge] --max-usd --out
// and the files it writes: readers/<persona>__<model>.json, token-weight.md,
// verdict.md, verdict.json.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, EXIT } from "../src/cli.mjs";
import { FIXTURES, mockClientFor, resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { miniReader } from "./_mini.mjs";

beforeEach(resetRegistry);

function sink() {
  let s = "";
  return { write: (x) => (s += x), get text() { return s; } };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "act-"));
  const prices = join(dir, "prices.json");
  writeFileSync(prices, JSON.stringify({ models: TEST_PRICES }));
  const base = [
    "run",
    "--tools", join(FIXTURES, "mini/tools.json"),
    "--truth", join(FIXTURES, "mini/truth.md"),
    "--requests", join(FIXTURES, "mini/requests.json"),
    "--models", "claude-haiku-4-5,gpt-5",
    "--prices", prices,
  ];
  return { dir, base, out: join(dir, "out") };
}

const deps = (script = miniReader(), missing) => ({ clientFor: mockClientFor({ script, judgeModel: "claude-sonnet-4-6", missing }) });

test("missing --max-usd is a usage error (exit 64) and writes nothing", async () => {
  const { base, out } = setup();
  const err = sink();
  const code = await main([...base, "--out", out], { env: {}, stdout: sink(), stderr: err, deps: deps() });
  assert.equal(code, EXIT.usage);
  assert.match(err.text, /--max-usd/);
  assert.equal(existsSync(out), false);
});

test("a passing run writes the four outputs and exits 0", async () => {
  const { base, out } = setup();
  const stdout = sink();
  const code = await main([...base, "--judge", "claude-sonnet-4-6", "--max-usd", "1", "--out", out], { env: {}, stdout, stderr: sink(), deps: deps() });
  assert.equal(code, EXIT.pass, stdout.text);
  assert.deepEqual(readdirSync(out).sort(), ["readers", "token-weight.md", "verdict.json", "verdict.md"]);
  assert.deepEqual(readdirSync(join(out, "readers")).sort(), [
    "cautious-agent__gpt-5.json",
    "literal-reader__gpt-5.json",
    "small-context-host__claude-haiku-4-5.json",
    "technical-term-searcher__claude-haiku-4-5.json",
  ]);
  const reader = JSON.parse(readFileSync(join(out, "readers", "cautious-agent__gpt-5.json"), "utf8"));
  assert.ok(Array.isArray(reader.teachBack) && Array.isArray(reader.routing) && Array.isArray(reader.confusion));
  assert.deepEqual(reader.isolation.tools, []);
  const verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  assert.equal(verdict.grade.verdict, "pass");
  assert.ok(Array.isArray(verdict.grade.cutList));
  assert.ok(verdict.cost.actual.usd >= 0 && verdict.cost.maxUsd === 1);
  assert.match(readFileSync(join(out, "verdict.md"), "utf8"), /^# Comprehension test verdict: PASS/);
  assert.match(readFileSync(join(out, "verdict.md"), "utf8"), /not validation/);
  assert.match(readFileSync(join(out, "token-weight.md"), "utf8"), /informational/);
});

test("conditional exits 1; over budget exits 3 with nothing written", async () => {
  let { base, out } = setup();
  assert.equal(await main([...base, "--max-usd", "1", "--out", out], { env: {}, stdout: sink(), stderr: sink(), deps: deps() }), EXIT.conditional);
  ({ base, out } = setup());
  const err = sink();
  assert.equal(await main([...base, "--max-usd", "0.00001", "--out", out], { env: {}, stdout: sink(), stderr: err, deps: deps() }), EXIT.refused);
  assert.match(err.text, /REFUSED: estimated spend/);
  assert.equal(existsSync(out), false);
});

test("a skipped provider is reported on stderr and is not a failure exit", async () => {
  const { base, out } = setup();
  const err = sink();
  const code = await main([...base, "--judge", "claude-sonnet-4-6", "--max-usd", "1", "--out", out], { env: {}, stdout: sink(), stderr: err, deps: deps(miniReader(), ["openai"]) });
  assert.match(err.text, /SKIPPED reader .* gpt-5: OPENAI_API_KEY is not set/);
  assert.equal(code, EXIT.conditional, "single-provider panel: conditional, not an error");
});

test("--estimate-only needs no --out and exits 0", async () => {
  const { base } = setup();
  const stdout = sink();
  assert.equal(await main([...base, "--max-usd", "1", "--estimate-only"], { env: {}, stdout, stderr: sink(), deps: deps() }), 0);
  assert.match(stdout.text, /estimated spend/);
});

test("--help prints usage; an unknown flag is a usage error", async () => {
  const out = sink();
  assert.equal(await main(["--help"], { stdout: out, stderr: sink() }), 0);
  assert.match(out.text, /--max-usd <N>/);
  assert.equal(await main(["run", "--bogus"], { stdout: sink(), stderr: sink() }), EXIT.usage);
});
