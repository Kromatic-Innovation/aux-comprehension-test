// _readme.mjs — the README's first-run command, as an argv the tests can run.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** How the README's first run names the global install's package directory. */
export const README_INSTALL_PREFIX = '"$(npm root -g)/aux-comprehension-test/';

/**
 * The argv of the FIRST fenced bash command under README.md's "## First run"
 * heading. Its input paths point into the global install; they are resolved
 * against `pkgRoot` (this checkout by default, or an unpacked tarball), so the
 * documented first run and the tested first run cannot drift apart.
 */
export function readmeFirstRunArgv(pkgRoot = new URL("../", import.meta.url)) {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf("## First run");
  assert.ok(start > 0, "README.md has no '## First run' heading");
  const fence = readme.indexOf("```bash", start);
  assert.ok(fence > 0, "no fenced bash block under README.md's '## First run'");
  const body = readme.slice(fence + "```bash".length, readme.indexOf("```", fence + 7));
  const PKG = "\u0000pkg/";
  const tokens = body
    .split(README_INSTALL_PREFIX)
    .join(PKG)
    .replace(/\\\n/g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => (t.startsWith(PKG) ? t.replace(/"$/, "") : t));
  assert.equal(tokens[0], "aux-comprehension-test", `first-run block does not invoke the CLI: ${tokens[0]}`);
  const root = pkgRoot instanceof URL ? pkgRoot : pathToFileURL(pkgRoot.endsWith("/") ? pkgRoot : `${pkgRoot}/`);
  return tokens.slice(1).map((t) => {
    if (!t.startsWith(PKG)) return t;
    return fileURLToPath(new URL(t.slice(PKG.length), root));
  });
}
