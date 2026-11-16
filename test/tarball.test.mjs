// The published tarball: what `files` ships, and that the README's first run
// works against an unpacked copy of it (not only against a git checkout).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readmeFirstRunArgv } from "./_readme.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const npm = (args, cwd = ROOT) => execFileSync("npm", args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } });

function packedFiles() {
  const [info] = JSON.parse(npm(["pack", "--dry-run", "--json", "--ignore-scripts"]));
  return info.files.map((f) => f.path);
}

test("npm pack ships the CHANGELOG, SECURITY policy and example inputs", () => {
  const files = packedFiles();
  for (const f of ["CHANGELOG.md", "SECURITY.md", "README.md", "LICENSE", "NOTICE", "examples/mini/tools.json", "examples/mini/truth.md", "examples/mini/requests.json"]) {
    assert.ok(files.includes(f), `${f} is not in the tarball`);
  }
  assert.ok(!files.some((f) => f.startsWith("test/")), "the test suite must not ship");
});

test("the shipped example inputs are the tested mini fixture, byte for byte", () => {
  const ex = join(ROOT, "examples/mini");
  const fx = join(ROOT, "test/fixtures/mini");
  assert.deepEqual(readdirSync(ex).sort(), readdirSync(fx).sort());
  for (const f of readdirSync(fx)) assert.equal(readFileSync(join(ex, f), "utf8"), readFileSync(join(fx, f), "utf8"), f);
});

test("the README's first run exits 0 against an unpacked tarball", () => {
  const dir = mkdtempSync(join(tmpdir(), "act-pack-"));
  const [info] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", dir]));
  execFileSync("tar", ["-xzf", join(dir, info.filename), "-C", dir]);
  const pkg = join(dir, "package");
  // The tarball carries no dependencies; borrow this checkout's installed ones.
  symlinkSync(join(ROOT, "node_modules"), join(pkg, "node_modules"), "dir");

  const argv = readmeFirstRunArgv(pkg);
  for (const a of argv.filter((x) => x.startsWith("/"))) assert.ok(a.startsWith(pkg), `${a} does not resolve inside the unpacked tarball`);
  const env = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete env[k];
  // execFileSync throws on a non-zero exit, so returning at all means exit 0.
  const out = execFileSync(process.execPath, [join(pkg, "bin/aux-comprehension-test.mjs"), ...argv], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /estimated spend \(upper bound\): \$\d+\.\d{4} over 4 call\(s\)/);
  assert.match(out, /no model was called; nothing was spent\./);
});
