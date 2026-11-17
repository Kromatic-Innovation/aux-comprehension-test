// The documented public surface of the package entrypoint.
//
// README.md's "Stable surface" table is the contract: exactly these names are
// exported from the package root, each has a direct test here, and everything
// else lives behind the `aux-comprehension-test/internal` subpath. The first
// tests keep the README, package.json `exports` and the actual exports from
// drifting apart, so the promise in the README cannot quietly stop being true.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Through package.json `exports` (a self-reference), as a consumer resolves it.
import * as api from "aux-comprehension-test";
import * as internal from "aux-comprehension-test/internal";
import { fixture, fixtureJson, mockClientFor, resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { miniReader } from "./_mini.mjs";

beforeEach(resetRegistry);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRoot = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** The documented stable surface. Keep in lockstep with README.md. */
const STABLE = ["run", "RunError", "VERSION", "HOST_CAVEAT", "main", "EXIT"];

/** Run the mini fixture offline through the PACKAGE ENTRYPOINT, not src/run.mjs. */
const runViaEntrypoint = (opts = {}) =>
  api.run(
    {
      tools: fixtureJson("mini/tools.json"),
      truth: fixture("mini/truth.md"),
      requests: fixtureJson("mini/requests.json"),
      models: ["claude-haiku-4-5", "gpt-5"],
      maxUsd: 1,
      prices: TEST_PRICES,
      env: {},
      ...opts,
    },
    { clientFor: mockClientFor({ script: miniReader(), judgeModel: "claude-sonnet-4-6" }) },
  );

test("the stable surface is exported from the package entrypoint", () => {
  for (const name of STABLE) {
    assert.ok(name in api, `${name} is documented but not exported from the package root`);
    assert.notEqual(api[name], undefined, `${name} is exported as undefined`);
  }
});

test("the package root exports exactly the stable surface", () => {
  assert.deepEqual(Object.keys(api).sort(), [...STABLE].sort());
});

test("package.json exports maps the root and ./internal, and nothing else", () => {
  assert.deepEqual(JSON.parse(readRoot("package.json")).exports, { ".": "./src/index.mjs", "./internal": "./src/internal.mjs" });
});

test("./internal carries the unstable internals and none of the stable names", () => {
  for (const name of STABLE) assert.equal(name in internal, false, `${name} is stable; it belongs at the root only`);
  for (const name of ["decide", "buildClusters", "gradeTeachBack", "lengthPromoted", "rereadCandidates", "loadPrices", "clientFor", "estimate"]) {
    assert.equal(typeof internal[name], "function", `${name} is missing from ./internal`);
  }
});

test("README's Stable surface table names exactly the stable exports", () => {
  const readme = readRoot("README.md");
  const start = readme.indexOf("### Stable surface");
  assert.ok(start > 0, "README.md has no '### Stable surface' section");
  const rest = readme.slice(start + "### Stable surface".length);
  const end = rest.search(/^#{2,3} /m);
  const section = end < 0 ? rest : rest.slice(0, end);

  // First cell of each table row, backticks stripped, call parens dropped.
  const documented = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1].split("(")[0].trim());
  assert.deepEqual(
    [...documented].sort(),
    [...STABLE].sort(),
    "README's Stable surface table and this test's STABLE list disagree",
  );

  // The unstable-internals promise is only meaningful if there ARE others.
  assert.ok(Object.keys(internal).length > 0, "./internal is empty: the unstable-internals note would be vacuous");
  assert.match(section, /unstable\s+internal/i, "README does not mark ./internal as unstable internals");
  assert.match(section, /aux-comprehension-test\/internal/, "README does not name the ./internal subpath");
});

test("run() completes a real offline run through the entrypoint", async () => {
  const result = await runViaEntrypoint({ judge: "claude-sonnet-4-6" });
  assert.equal(result.status, "completed");
  assert.equal(result.grade.verdict, "pass");
  assert.equal(result.readers.filter((r) => r.status === "ok").length, 4);
  assert.ok(result.cost.actual.usd >= 0);
});

test("RunError is thrown for bad inputs and carries a code", async () => {
  await assert.rejects(
    () => runViaEntrypoint({ maxUsd: 0 }),
    (err) => {
      assert.ok(err instanceof api.RunError, "not a RunError");
      assert.equal(err.code, "USAGE");
      assert.match(err.message, /--max-usd/);
      return true;
    },
  );
  // REFUSED is the other documented code: nothing was called.
  await assert.rejects(
    () => runViaEntrypoint({ maxUsd: 0.00001 }),
    (err) => err instanceof api.RunError && err.code === "REFUSED",
  );
});

test("VERSION is this package's version", () => {
  assert.equal(api.VERSION, JSON.parse(readRoot("package.json")).version);
  assert.match(api.VERSION, /^\d+\.\d+\.\d+/);
});

test("HOST_CAVEAT is carried in a real run's honesty block", async () => {
  assert.match(api.HOST_CAVEAT, /not proof/);
  const result = await runViaEntrypoint();
  assert.ok(result.honesty.includes(api.HOST_CAVEAT), "run() output does not carry HOST_CAVEAT");
});

test("EXIT is the documented exit-code map and main() is callable", async () => {
  assert.deepEqual(api.EXIT, { pass: 0, conditional: 1, fail: 2, refused: 3, usage: 64, internal: 70 });
  let out = "";
  const code = await api.main(["--version"], { stdout: { write: (x) => (out += x) }, stderr: { write: () => {} } });
  assert.equal(code, 0);
  assert.equal(out.trim(), api.VERSION);
});
