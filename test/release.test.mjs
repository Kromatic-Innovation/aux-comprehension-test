// The CHANGELOG shape release.yml depends on: it lifts the `## [<version>]`
// section verbatim into the GitHub Release body, and the release PR replaces
// `unreleased` with the date.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the CHANGELOG's first section is this version, unreleased or dated", () => {
  const { version } = JSON.parse(read("package.json"));
  const first = read("CHANGELOG.md").split("\n").find((l) => l.startsWith("## "));
  const esc = version.replace(/[.]/g, "\\.");
  assert.match(first, new RegExp(`^## \\[${esc}\\] - (unreleased|\\d{4}-\\d{2}-\\d{2})$`));
});

test("release.yml's section-lift step extracts the whole grouped section", () => {
  const wf = read(".github/workflows/release.yml");
  const m = wf.match(/awk -v ver="\$VERSION" '\n([\s\S]*?)\n\s*' CHANGELOG\.md/);
  assert.ok(m, "release.yml no longer has the awk section-lift step this test reads");
  const { version } = JSON.parse(read("package.json"));
  const notes = execFileSync("awk", ["-v", `ver=${version}`, m[1], new URL("../CHANGELOG.md", import.meta.url).pathname], { encoding: "utf8" });
  for (const h of ["### Added", "### Changed", "### Fixed"]) assert.match(notes, new RegExp(`^${h}$`, "m"));
  assert.doesNotMatch(notes, /^## /m, "the lift ran past this version's section");
});
