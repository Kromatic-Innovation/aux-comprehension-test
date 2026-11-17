// The published tarball: what `files` ships, and that the README's first run
// works against an unpacked copy of it (not only against a git checkout).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readmeFirstRunArgv } from "./_readme.mjs";
import { strayFiles, checkPack } from "../.github/check-pack-contents.mjs";

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

// --- The CI pack check: nothing outside `files` ships. ----------------------

const CHECK = join(ROOT, ".github/check-pack-contents.mjs");

test("strayFiles allows package.json, `files` entries and paths under them only", () => {
  const files = ["bin", "src/", "./data", "README.md", "LICENSE"];
  const packed = ["package.json", "bin/x.mjs", "src/a/b.mjs", "data/p.json", "README.md", "LICENSE", "README.orig", "LICENSE.bak", "srcx/a.mjs", "binary"];
  assert.deepEqual(strayFiles(packed, files), ["README.orig", "LICENSE.bak", "srcx/a.mjs", "binary"]);
  assert.throws(() => strayFiles([], ["src/**/*.mjs"]), /glob patterns are not supported/);
});

test("this package's tarball has no stray files", () => {
  const { packed, stray } = checkPack(ROOT);
  assert.ok(packed.length > 0);
  assert.deepEqual(stray, []);
});

test("a stray README.orig at the root ships despite `files`, and the pack check fails on it", () => {
  // A minimal copy of the package: package.json, README.md and one shipped file.
  const dir = mkdtempSync(join(tmpdir(), "act-stray-"));
  copyFileSync(join(ROOT, "package.json"), join(dir, "package.json"));
  copyFileSync(join(ROOT, "README.md"), join(dir, "README.md"));
  mkdirSync(join(dir, "bin"));
  copyFileSync(join(ROOT, "bin/aux-comprehension-test.mjs"), join(dir, "bin/aux-comprehension-test.mjs"));
  const run = () => execFileSync(process.execPath, [CHECK, dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(run(), /pack check: ok/);

  writeFileSync(join(dir, "README.orig"), "left over from a merge\n");
  writeFileSync(join(dir, "notes.txt"), "not packed at all\n");
  let err;
  try {
    run();
  } catch (e) {
    err = e;
  }
  assert.ok(err, "the pack check passed with a stray README.orig in the tarball");
  assert.equal(err.status, 1);
  assert.match(err.stderr, /outside package.json `files`/);
  assert.match(err.stderr, /README\.orig/);
  assert.doesNotMatch(err.stderr, /notes\.txt/);
});
