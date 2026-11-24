// The CHANGELOG shape release.yml depends on: it lifts the `## [<version>]`
// section verbatim into the GitHub Release body, and the release PR replaces
// `unreleased` with the date.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the CHANGELOG's first section is this version, unreleased or dated", () => {
  const { version } = JSON.parse(read("package.json"));
  const first = read("CHANGELOG.md").split("\n").find((l) => l.startsWith("## "));
  const esc = version.replace(/[.]/g, "\\.");
  assert.match(first, new RegExp(`^## \\[${esc}\\] - (unreleased|\\d{4}-\\d{2}-\\d{2})$`));
});

// CONTRIBUTING.md § Version and CHANGELOG: Added, Changed and Fixed are
// required; Internal (test-only, docs-only and CI-only changes) is optional
// and comes last. Nothing else may appear as a subsection heading.
const REQUIRED = ["### Added", "### Changed", "### Fixed"];
const ORDER = [...REQUIRED, "### Internal"];

const awkProgram = () => {
  const wf = read(".github/workflows/release.yml");
  const m = wf.match(/awk -v ver="\$VERSION" '\n([\s\S]*?)\n\s*' CHANGELOG\.md/);
  assert.ok(m, "release.yml no longer has the awk section-lift step this test reads");
  return m[1];
};

const lift = (version, file) => execFileSync("awk", ["-v", `ver=${version}`, awkProgram(), file], { encoding: "utf8" });

const assertConvention = (notes) => {
  for (const h of REQUIRED) assert.match(notes, new RegExp(`^${h}$`, "m"));
  const headings = notes.split("\n").filter((l) => l.startsWith("### "));
  for (const h of headings) assert.ok(ORDER.includes(h), `unexpected CHANGELOG subsection ${JSON.stringify(h)}`);
  const idx = headings.map((h) => ORDER.indexOf(h));
  assert.deepEqual(idx, [...new Set(idx)].sort((a, b) => a - b), `subsections out of order or repeated: ${headings.join(", ")}`);
};

test("release.yml's section-lift step extracts the whole grouped section", () => {
  const { version } = JSON.parse(read("package.json"));
  const notes = lift(version, new URL("../CHANGELOG.md", import.meta.url).pathname);
  assertConvention(notes);
  assert.doesNotMatch(notes, /^## /m, "the lift ran past this version's section");
});

test("the section lift carries an ### Internal subsection into the release notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "act-changelog-"));
  const file = join(dir, "CHANGELOG.md");
  writeFileSync(file, [
    "# Changelog", "",
    "## [9.9.9] - unreleased", "",
    "### Added", "", "- None.", "",
    "### Changed", "", "- None.", "",
    "### Fixed", "", "- None.", "",
    "### Internal", "", "- New tests for the re-read helpers.", "",
    "## [9.9.8] - 2026-01-01", "",
    "### Added", "", "- Older entry.", "",
  ].join("\n"));
  try {
    const notes = lift("9.9.9", file);
    assertConvention(notes);
    assert.match(notes, /^### Internal\n\n- New tests for the re-read helpers\.$/m);
    assert.doesNotMatch(notes, /Older entry/, "the lift ran past this version's section");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the convention check refuses unknown, misordered and repeated subsections", () => {
  const base = "### Added\n\n### Changed\n\n### Fixed\n";
  assert.doesNotThrow(() => assertConvention(base));
  assert.doesNotThrow(() => assertConvention(`${base}\n### Internal\n`));
  assert.throws(() => assertConvention("### Added\n\n### Changed\n"), /Fixed/);
  assert.throws(() => assertConvention(`${base}\n### Tests\n`), /unexpected CHANGELOG subsection/);
  assert.throws(() => assertConvention("### Added\n\n### Changed\n\n### Internal\n\n### Fixed\n"), /out of order/);
  assert.throws(() => assertConvention(`${base}\n### Fixed\n`), /out of order or repeated/);
});
