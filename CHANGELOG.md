# Changelog

## 0.1.0 (unreleased)

First version.

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
