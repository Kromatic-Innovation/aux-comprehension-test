# Contributing

Thanks for your interest.

- Open an issue before a large change so we can agree on the approach.
- Work on a branch from `develop` and open pull requests against `develop`.
- `npm test` must pass. The suite is offline: do not add a test that calls a
  real provider. Live checks belong in `eval/`, which is manual-only.
- Prompt text lives in `prompts/` as content, not as string literals in code.
- Keep the dependency footprint at `panelist` alone unless there is a strong
  reason.

By contributing you agree that your contributions are licensed under the
Apache License 2.0.
