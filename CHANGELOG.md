# Changelog

## [0.1.0] - unreleased

First version.

The release PR replaces `unreleased` above with the release date. The heading
is bracketed so `release.yml` can lift this section verbatim into the GitHub
Release body.

- `aux-comprehension-test run`: blind reader panel through panelist `spawn`
  (no tools granted), teach-back, routing and confusion per reader.
- Grading: mechanical routing with near-miss pairs, reader error vs. must-fix,
  length-only complaints informational, optional judge for teach-back drift and
  single-reader re-reads, `crossModel` required for `pass`.
- Token-weight report (informational).
- Required `--max-usd` with a fail-closed pre-run estimate. The bundled price
  table covers current Anthropic models and OpenAI `gpt-5`, with the source and
  retrieval date recorded.
- `pass` is always withheld without `--judge`; the CLI summary prints why.
- Missing provider keys skipped and reported.
- Offline test suite, including a before/after fixture over a real server's
  copy; manual-only live eval workflow.
- First run needs no provider key: `--estimate-only` prices the whole panel
  the command line names and reports which readers have no key yet, instead of
  refusing with "no reader can run". It still refuses an unpriced model or an
  estimate over `--max-usd`.
- `--version` (`-V`).
- An unexpected internal error exits `70`, not `64`. `64` now means only what
  it says -- a bad command line or bad input files -- and no failure reuses the
  verdict codes `0`-`2`.
- npm publishing on a pushed `v*` tag through npm trusted publishing (OIDC, no
  stored npm token), from the canonical shared `release.yml`. `files` and
  `publishConfig` keep the tarball to the CLI, `src/`, `data/`, `prompts/`,
  `personas/`, `LICENSE`, `NOTICE` and `README.md`.
- The bundled Anthropic prices record the pricing page and the date they were
  verified against it, as the OpenAI prices already did. `claude-haiku-5-5` is
  priced by prompt length; the bundled entry is the up-to-100,000-token tier
  and the file says so.
- README: a cost-and-keys note above Install, both install commands with which
  one works today, a no-key first run, and the stable library surface (every
  other root export is an unstable internal).
- The manual live eval accepts plain `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
  repository secrets as well as 1Password.
