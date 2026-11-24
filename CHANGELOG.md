# Changelog

## [0.2.4] - unreleased

### Added

- None.

### Changed

- The `panelist` dependency now accepts every version from 0.4.2 on
  (`>=0.4.2`) instead of `^0.4.1`, which on 0.x only admitted 0.4.x.
  Installing this package now picks up new `panelist` releases, including a
  future 0.5.x, without a release here. The lockfile resolves 0.4.2, which
  changes nothing this package calls
  ([#88](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/88)).

### Fixed

- None.

## [0.2.3] - 2026-11-22

Release-review polish. This release adds direct tests for the re-read
input-size helpers that 0.2.2 introduced, and fixes a README § Cost passage
whose pronoun pointed at the wrong noun. No code under `src/` changed.

- No behaviour change. No output change: `verdict.json` and the CLI summary
  are the same as on 0.2.2, apart from the `version` field.
- No breaking API change. No experimental surface added. No
  security-relevant change: the judge receives the same data as on 0.2.2.
  To upgrade, install the new version. No flags or inputs need to change.

### Added

- None. The new tests ship no new surface.

### Changed

- None.

### Fixed

- `rereadInputChars`, `rereadInputReport` and `rereadInputOverLine` now have
  direct unit tests, as `rereadRowReport` does. A test pins that
  `cost.reread.inputChars` counts every batch a full re-read needs, not only
  the batches sent before `--max-usd` stopped it, and a test reaches
  `quote()`'s `Object.prototype.toString` fallback
  ([#74](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/74)).
- README § Cost: the sentence about `cost.reread` being `null` with no judge
  sat ahead of "It still never goes over the ceiling", so "It" read as
  `cost.reread`. The ceiling sentence names the re-read again and the `null`
  sentence closes the passage, wrapped to the file's line width
  ([#75](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/75)).

## [0.2.2] - 2026-11-22

Cost-report completeness. A run now says when its re-read cost more than
the estimate priced because the complaints were longer than assumed, not
only when there were more of them. The README's first run and `run()`
result sample match what the tool prints.

- **Behaviour change.** A `run()` call whose `judgeMaxTokens` is not a number
  is still refused with `RunError` code `USAGE`, but the message now names
  the type (`got "300" (string)`). A value with no JSON form, such as a
  BigInt, is refused the same way and no longer escapes as a `TypeError`.
- **Output change.** `verdict.json`'s `cost.reread` gains
  `inputCharsAssumed`, `inputChars` and `inputOverAssumed`, and the CLI
  summary prints a `re-read input:` line when the re-read input exceeded the
  estimate. No existing field changed, and `--max-usd` enforcement is
  unchanged.
- No breaking API change. No experimental surface added. No
  security-relevant change: the judge receives the same data as on 0.2.1.
  To upgrade, install the new version. No flags or inputs need to change.

### Added

- None. The new `verdict.json` fields are part of the fixes below.

### Changed

- None.

### Fixed

- README: the `run()` result sample now lists `cost.estimate.parts` and
  `cost.reread`, says `cost.reread` is `null` when no judge is configured,
  and shows the current `version`. § Cost says the same
  ([#54](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/54)).
- `run()` with a `judgeMaxTokens` that is not a number now names its type in
  the refusal: `got "300" (string)`, not `got 300`, which read like a valid
  value. A string is still refused
  ([#55](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/55)).
- README § First run gives a local-install form of the command
  (`npx aux-comprehension-test run` with `node_modules/aux-comprehension-test/...`
  paths) after the global one, for a project that ran
  `npm install aux-comprehension-test`
  ([#56](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/56)).
- README § First run shows the full `--estimate-only --judge claude-sonnet-4-6`
  command above its sample estimate, and the sample is that command's full
  output. A test runs the README's command and checks the sample against it
  ([#57](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/57)).
- A run whose re-read rows matched the estimate's assumed count but carried
  complaints longer than its 400-character placeholder spent more on the
  re-read than the estimate showed, and said nothing: `overAssumed` only
  compares row counts. `verdict.json`'s `cost.reread` now also records
  `inputCharsAssumed`, `inputChars` and `inputOverAssumed`, and the CLI
  summary prints a `re-read input:` line when the input exceeded the
  estimate. No existing field changed. `--max-usd` enforcement is unchanged
  ([#65](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/65)).

## [0.2.1] - 2026-11-22

Honest judge cost reporting. The pre-run estimate no longer calls its total
an upper bound when part of it is not one. A judge output cap too small to
hold one re-read row is now refused.

- **Behaviour change.** A command line with `--judge-max-tokens` below 300
  (or a `run()` call with `judgeMaxTokens` below 300) ran on 0.2.0 and is
  refused on 0.2.1 with exit `64` (`RunError` code `USAGE`). Below 300 even a
  one-row re-read reply could be cut off, so those runs paid for judge calls
  and still came back `conditional`.
- **Output change.** The `--estimate-only` line now reads
  `estimated spend: $T over N call(s)`, followed by a
  `readers + teach-back (upper bound)` line and, with `--judge`, a
  `re-read (estimated, N rows assumed)` line. A script that matched
  `estimated spend (upper bound)` needs updating. `verdict.json` gains
  `cost.estimate.parts` and `cost.reread`. No existing field changed.
- No breaking API change beyond the refused values above. No experimental
  surface added. No security-relevant change: the judge receives the same
  data as on 0.2.0. To upgrade, install the new version and raise any
  `--judge-max-tokens` below 300 to at least 300.

### Added

- None. The new `verdict.json` fields are part of the fixes below.

### Changed

- `--judge-max-tokens` and `run()`'s `judgeMaxTokens` must be an integer of
  at least 300 (`REREAD_TOKENS_PER_ROW`, the room one re-read row needs). A
  smaller value is refused with a message that names the minimum and why.
  `--help` and the README options table give the minimum
  ([#44](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/44)).

### Fixed

- The pre-run estimate no longer calls its total an upper bound. The reader
  and teach-back calls are a bound. The re-read is priced for an assumed row
  count (one per request plus two per tool), and confusion rows have no
  bound, so that part is an estimate. The CLI prints the two parts
  separately. A run with more re-read rows than the estimate assumed now says
  so: `verdict.json`'s `cost.reread` records `rowsAssumed`, `rows`,
  `rowsSent` and `overAssumed`, and `verdict.md` and the CLI summary print
  the counts. Before, a `--max-usd` set equal to the estimate could end
  `conditional` ("re-read incomplete") with no warning. Spend-stop is
  unchanged: `--max-usd` still holds
  ([#43](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/43)).

## [0.2.0] - 2026-11-22

The judge is more trustworthy on large payloads, and `pass` is withheld in two
more cases where the run could not prove it.

- **Behaviour change.** A run that passed on 0.1.0 can come back
  `conditional` on 0.2.0 if a reader failed to answer or a single-reader
  re-read did not complete. `withheldPass` says which case applied.
- **Data sent to the judge.** The teach-back judge now receives each tool's
  payload entry and the server instructions on every grading call. Before,
  it received them only on the re-read. If your payload is confidential,
  note that it now reaches the judge model's provider on every call. Judge
  input cost rises accordingly.
- No breaking API change. No experimental surface added. To upgrade, install
  the new version. No flags or inputs need to change.

### Added

- `--judge-max-tokens <N>`: set the judge's output cap from the CLI
  (`run()`'s `judgeMaxTokens`, default 4096). The pre-run estimate and the
  `--max-usd` check price judge calls at this cap ([#38](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/38)).

### Changed

- `pass` is withheld when fewer readers answered than the panel was configured
  for. A reader that was skipped for a missing key, whose call failed, or
  whose reply could not be parsed did not answer. `withheldPass` names each
  missing reader and why. A run that fails still fails ([#34](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/34)).
- The single-reader re-read is sent to the judge in batches sized from its
  output cap, so no single reply has to hold every row. A failed batch is
  recorded and the next one is still sent. Before each batch, the spend so far
  plus that batch's upper bound is checked against `--max-usd`, and the
  re-read stops rather than go over. Any row left without a verdict withholds
  `pass`, with the count and the cause. The pre-run estimate prices several
  re-read batches instead of one ([#35](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/35)).
- The README install section now shows the published npm package first.
- CI: `actions/create-github-app-token` bumped to v3.3.0.

### Fixed

- The teach-back judge no longer reports a true detail as drift. It used to
  see only the truth file's `meaning` and the reader's explanation, so a
  detail that the payload states but the truth leaves out looked invented. Now
  each teach-back item carries its tool's payload entry, the prompt shows the
  server instructions once, and the template says that a detail present in
  the payload is never drift ([#38](https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/38)).

## [0.1.0] - 2026-11-17

First version.

### Added

- `aux-comprehension-test run`: a blind reader panel through panelist `spawn`
  (no tools granted), with teach-back, routing and confusion per reader.
- Grading: mechanical routing with near-miss pairs, reader error vs. must-fix,
  length-only complaints informational, an optional judge for teach-back drift
  and single-reader re-reads, and `crossModel` required for `pass`.
- `pass` is always withheld without `--judge`; the CLI summary prints why.
- Token-weight report (informational).
- Required `--max-usd` with a fail-closed pre-run estimate. An unpriced model
  refuses the run; it is never priced at zero.
- A bundled price table for current Anthropic models and OpenAI `gpt-5`, with
  each provider's pricing page and the date the prices were verified.
- Prompt-length price tiers: a price entry may carry an `above` tier, and a
  call over its token threshold is priced at the higher rates in the estimate
  and in actual spend. `claude-haiku-5-5` ships with its over-100,000-token
  tier.
- `--estimate-only`: prices the whole panel the command line names and reports
  which readers have no key yet, with no model called and no key needed.
- `--version` (`-V`).
- Exit codes: `0`-`2` verdicts, `3` refused, `64` usage error, `70` internal
  error.
- Missing provider keys are skipped and reported.
- A small example payload under `examples/mini/`, used by the README's first
  run.
- Offline test suite, including a before/after fixture over a real server's
  copy, and a manual-only live eval workflow that accepts plain
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` repository secrets.
- npm publishing on a pushed `v*` tag through npm trusted publishing (OIDC, no
  stored npm token). The tarball carries the CLI, `src/`, `data/`, `prompts/`,
  `personas/`, `examples/`, `LICENSE`, `NOTICE`, `README.md`, `CHANGELOG.md`
  and `SECURITY.md`.
- README: a cost-and-keys note above Install, both install commands, a no-key
  first run, and the stable library surface (every other root export is an
  unstable internal).
- Docs: the hosts a live run contacts and the data sent to them (README and
  `SECURITY.md`), every `run()` option and the shape of its result, the
  `panelist` coupling and its supported range, a best-effort maintenance
  statement, a fuller `CONTRIBUTING.md`, and which credential route wins in
  the live eval.
- Provider calls retry a 429 or 5xx at most twice, honouring `Retry-After`
  (1 s then 2 s otherwise). A call that still fails is reported on that
  reader, with the provider's status, and the run carries on. Retried attempts
  are counted in actual spend, and the pre-run estimate counts the maximum
  retries for every call, so it stays an upper bound.
- CI runs the suite on Node 20 and 22, audits runtime dependencies
  (`npm audit --omit=dev --audit-level=high`), and fails if the tarball would
  ship anything outside `package.json` `files`.
- Direct tests for the exported grading helpers `decide`, `buildClusters`,
  `gradeTeachBack`, `lengthPromoted` and `rereadCandidates`.
- The package root exports only the six stable names (`run`, `RunError`,
  `VERSION`, `HOST_CAVEAT`, `main`, `EXIT`). The unstable internals moved to
  the `aux-comprehension-test/internal` subpath.
- The judge grades teach-back in batches of 5 tools per call, and the pre-run
  estimate prices every batch, so a large payload is graded instead of failing
  on a reply cut off at the output cap. A judge call that still fails keeps its
  raw reply (first and last 2 KB) under `judge/` in the run directory and
  records the provider's stop reason in `verdict.json` `judge.failures`; its
  rows read `unverified (judge failed: <reason>)`, and `unverified (no judge)`
  is kept for runs without `--judge`.
- Must-fix needs a misreading: a confusion cluster is `must-fix` only when
  some reader also misread that tool (a routing miss, or judge-confirmed
  teach-back drift). A confusion-only cluster is `informational`, however many
  readers raised it, keeps the readers' evidence, and is flagged `consider`
  when the judge's re-read finds the copy ambiguous. It never moves the
  verdict.
- Requests may carry `also_acceptable: string[]`: other tools (or `"none"`)
  the author counts as a correct pick. Such a pick yields no routing row and
  no near-miss row. An entry that is not a payload tool is a usage error, and
  readers never see the field.
- `--instructions <file>` (and `instructions` in a `--tools` capture): the
  server's `initialize` instructions are shown to readers in a labelled
  section before the tools, an optional `## server-instructions` ground-truth
  section is graded for teach-back, and token-weight reports them on their
  own row.
- The teach-back judge sees each tool's own payload text and the server
  instructions alongside the truth file's `meaning`, and is told that a detail
  present in the payload is never drift, so a reader who repeats a true detail
  the truth file leaves out is no longer reported as drift.
- `--judge-max-tokens <N>`: the judge's output cap per call (default 4096). It
  sizes the re-read batches, and the pre-run estimate and the `--max-usd`
  check price every judge call at it.

### Changed

- Nothing: this is the first release.

### Fixed

- Nothing: this is the first release.
