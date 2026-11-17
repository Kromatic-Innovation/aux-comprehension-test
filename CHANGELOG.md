# Changelog

## [0.1.0] - unreleased

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

### Changed

- Nothing: this is the first release.

### Fixed

- Nothing: this is the first release.
