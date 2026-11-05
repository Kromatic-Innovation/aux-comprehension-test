// The CLI surface the workspace skill invokes:
//   run --tools --truth --requests --models [--judge] --max-usd --out
// and the files it writes: readers/<persona>__<model>.json, token-weight.md,
// verdict.md, verdict.json.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("without --judge the summary says pass is withheld and why", async () => {
  const { base, out } = setup();
  const stdout = sink();
  const code = await main([...base, "--max-usd", "1", "--out", out], { env: {}, stdout, stderr: sink(), deps: deps() });
  assert.equal(code, EXIT.conditional);
  assert.match(stdout.text, /pass withheld: .*no --judge/);
  assert.match(readFileSync(join(out, "verdict.md"), "utf8"), /## Why not pass[\s\S]*no --judge/);
});

// --- The README's first run: no provider key, no spend. ---------------------
//
// This exercises the REAL clientFor (no injected deps) and the REAL bundled
// price table, with an empty environment -- exactly what a reader who has just
// installed the package and set no key gets. If this test needs a mock to
// pass, the README is lying.

/**
 * The argv of the FIRST fenced bash command under README.md's "## First run"
 * heading, with repo-relative input paths resolved. The test below runs the
 * README's own command text, so the documented first run and the tested first
 * run cannot drift apart.
 */
function readmeFirstRunArgv() {
  const root = new URL("../", import.meta.url);
  const readme = readFileSync(new URL("README.md", root), "utf8");
  const start = readme.indexOf("## First run");
  assert.ok(start > 0, "README.md has no '## First run' heading");
  const fence = readme.indexOf("```bash", start);
  assert.ok(fence > 0, "no fenced bash block under README.md's '## First run'");
  const body = readme.slice(fence + "```bash".length, readme.indexOf("```", fence + 7));
  const tokens = body.replace(/\\\n/g, " ").trim().split(/\s+/);
  assert.equal(tokens[0], "aux-comprehension-test", `first-run block does not invoke the CLI: ${tokens[0]}`);
  return tokens.slice(1).map((t) => (t.startsWith("test/fixtures/") ? fileURLToPath(new URL(t, root)) : t));
}

test("the README's first run works with no provider key and spends nothing", async () => {
  const argv = readmeFirstRunArgv();
  // Pin the documented shape: the run subcommand, estimate-only, a ceiling.
  assert.equal(argv[0], "run");
  assert.ok(argv.includes("--estimate-only"), "the documented first run must be --estimate-only");
  assert.ok(argv.includes("--max-usd"), "--max-usd is required and must appear in the README command");
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { env: {}, stdout, stderr });

  assert.equal(code, 0, `expected exit 0, got ${code}; stderr: ${stderr.text}`);
  assert.match(stdout.text, /estimated spend \(upper bound\): \$\d+\.\d{4} over 4 call\(s\)/);
  assert.match(stdout.text, /priced: 4 reader\(s\)/);
  assert.match(stdout.text, /runnable now: 0 of 4 reader\(s\) have a key/);
  assert.match(stdout.text, /no model was called; nothing was spent\./);
  // Missing keys are reported, not fatal.
  assert.match(stderr.text, /SKIPPED reader .*: ANTHROPIC_API_KEY is not set/);
  assert.match(stderr.text, /SKIPPED reader .*: OPENAI_API_KEY is not set/);
  // The estimate is a real number priced off the bundled table, not zero.
  const usd = Number(stdout.text.match(/\$(\d+\.\d{4})/)[1]);
  assert.ok(usd > 0 && usd <= 1, `estimate ${usd} should be >0 and within the ceiling`);
});

test("--estimate-only prices the whole panel, so a missing key does not change the number", async () => {
  const base = readmeFirstRunArgv();
  const noKeys = sink();
  await main(base, { env: {}, stdout: noKeys, stderr: sink() });
  const allKeys = sink();
  await main(base, { env: { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" }, stdout: allKeys, stderr: sink() });

  const usd = (t) => t.match(/\$(\d+\.\d{4})/)[1];
  assert.equal(usd(noKeys.text), usd(allKeys.text), "the estimate must not depend on which keys are set");
  assert.match(noKeys.text, /runnable now: 0 of 4/);
  assert.match(allKeys.text, /runnable now: 4 of 4/);
});

test("a real run with no key still refuses (exit 3) -- only --estimate-only is key-free", async () => {
  const { base, out } = setup();
  const err = sink();
  const code = await main([...base, "--max-usd", "1", "--out", out], { env: {}, stdout: sink(), stderr: err });
  assert.equal(code, EXIT.refused);
  assert.match(err.text, /REFUSED: no reader can run/);
  assert.equal(existsSync(out), false);
});

// --- --version and the 64/70 exit-code split -------------------------------

test("--version and -V print the version and exit 0", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const flag of ["--version", "-V"]) {
    const out = sink();
    assert.equal(await main([flag], { stdout: out, stderr: sink() }), 0, flag);
    assert.equal(out.text.trim(), pkg.version, flag);
  }
});

test("an unexpected internal error exits 70, not 64", async () => {
  const { base, out } = setup();
  const err = sink();
  const code = await main([...base, "--max-usd", "1", "--out", out], {
    env: {},
    stdout: sink(),
    stderr: err,
    deps: { clientFor: () => { throw new TypeError("simulated bug"); } },
  });
  assert.equal(code, EXIT.internal, "a bug must not masquerade as a usage error");
  assert.equal(EXIT.internal, 70);
  assert.match(err.text, /internal error: /);
  assert.match(err.text, /simulated bug/);
  // It must not collide with a verdict code.
  assert.ok(![EXIT.pass, EXIT.conditional, EXIT.fail].includes(code));
});

test("64 still means a bad command line or bad input files", async () => {
  const { base, out } = setup();
  // A missing input file.
  const missing = base.map((a) => (a.endsWith("mini/tools.json") ? join(FIXTURES, "nope/tools.json") : a));
  const err1 = sink();
  assert.equal(
    await main([...missing, "--max-usd", "1", "--out", out], { env: {}, stdout: sink(), stderr: err1, deps: deps() }),
    EXIT.usage,
  );
  assert.match(err1.text, /could not read inputs/);
  // A RunError with code USAGE from inside run() -- not an internal error.
  const err2 = sink();
  assert.equal(
    await main([...base, "--max-usd", "1", "--out", out, "--personas", "no-such-persona"], {
      env: {},
      stdout: sink(),
      stderr: err2,
      deps: deps(),
    }),
    EXIT.usage,
  );
  assert.match(err2.text, /unknown persona no-such-persona/);
});
