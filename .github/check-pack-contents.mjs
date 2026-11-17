#!/usr/bin/env node
// check-pack-contents.mjs — fail if the npm tarball ships anything outside
// package.json `files`.
//
// `files` is an allowlist, but npm also always packs some names on its own,
// whatever `files` says: README*, LICENSE* / LICENCE*, and so on. A
// `README.orig` left by a merge, or a `LICENSE.bak`, would ship silently. This
// check runs `npm pack --dry-run` and fails on any packed path that is not
// package.json itself, a `files` entry, or a path under a `files` directory.
//
// Usage: node .github/check-pack-contents.mjs [package-dir]   (default: cwd)
// Exit 0 when clean, 1 on stray files, 2 when it cannot run the check.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GLOB = /[*?[\]{}!]/;

/** Packed paths not covered by `files` (package.json itself is always allowed). */
export function strayFiles(packed, files) {
  const globbed = files.filter((f) => GLOB.test(f));
  if (globbed.length) throw new Error(`files entries with glob patterns are not supported by this check: ${globbed.join(", ")}`);
  const allowed = files.map((f) => f.replace(/^\.\//, "").replace(/\/+$/, ""));
  return packed.filter((p) => p !== "package.json" && !allowed.some((a) => p === a || p.startsWith(`${a}/`)));
}

export function packedPaths(dir) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });
  const [info] = JSON.parse(out);
  return info.files.map((f) => f.path);
}

export function checkPack(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) throw new Error("package.json has no `files` allowlist");
  const packed = packedPaths(dir);
  return { packed, stray: strayFiles(packed, pkg.files) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? ".");
  let result;
  try {
    result = checkPack(dir);
  } catch (err) {
    console.error(`pack check could not run: ${err.message}`);
    process.exit(2);
  }
  if (result.stray.length) {
    console.error(`npm pack would ship ${result.stray.length} file(s) outside package.json \`files\`:`);
    for (const f of result.stray) console.error(`  ${f}`);
    console.error("Remove them, or add them to `files` if they are meant to ship.");
    process.exit(1);
  }
  console.log(`pack check: ok (${result.packed.length} file(s), all inside package.json \`files\`)`);
}
