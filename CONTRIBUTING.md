# Contributing

Thanks for your interest.

- Open an issue before a large change so we can agree on the approach.
- Work on a branch from `develop` and open pull requests against `develop`.
  `main` only receives promoted, already-merged work; do not target it.
- `npm test` must pass. The suite is offline: do not add a test that calls a
  real provider. Live checks belong in `eval/`, which is manual-only.
- Prompt text lives in `prompts/` as content, not as string literals in code.
- Keep the dependency footprint at `panelist` alone unless there is a strong
  reason.

## Setup

Node 20 is the floor (`engines.node` is `>=20`, and CI runs on Node 20 and 22).
Install from the lockfile, not with `npm install`:

```bash
npm ci
npm test
```

## Layout

| Path | Contents |
|---|---|
| `bin/` | The CLI entrypoint (`aux-comprehension-test.mjs`) |
| `src/` | The package. `index.mjs` is the root export (the stable surface); `internal.mjs` is the `./internal` subpath; `run.mjs` is one run end to end; `cli.mjs` is the CLI as a function |
| `prompts/` | Reader and judge prompt text, as markdown |
| `personas/` | The bundled reader personas, registered with panelist |
| `data/prices.json` | The bundled price table and the pricing pages it was read from |
| `examples/mini/` | The small example payload the README's first run uses; shipped in the package |
| `test/` | The offline test suite (`*.test.mjs`), its helpers (`_*.mjs`) and `fixtures/` |
| `eval/` | The manual live eval's documentation. Never run by `npm test`, never published |
| `.github/` | CI, the release workflow and `public-safe-lint.sh` |

## Version and CHANGELOG

The version in `package.json` and the first heading of `CHANGELOG.md` move
together. While a version is in progress, the CHANGELOG's first section is
`## [<package.json version>] - unreleased`, with `### Added`, `### Changed`
and `### Fixed` subsections; `test/release.test.mjs` fails otherwise. A
section may also end with an `### Internal` subsection. No other `###`
headings are allowed, and the four appear in that order.

- Add a line under the matching subsection of that section with your change.
- `### Added`, `### Changed` and `### Fixed` are for changes a user of the
  package sees: new surface, changed behaviour or output, and fixed behaviour
  or output. A change that only touches tests, documentation or CI goes under
  `### Internal`, even when it fixes a mistake, so a reader who scans by
  heading does not take it for a behaviour fix. Write "None." under an empty
  `### Added`, `### Changed` or `### Fixed`; leave `### Internal` out when it
  would be empty.
- Released sections are not rewritten to this convention. It applies from
  the next release on.
- When work starts on the next version, bump `version` in `package.json` and
  open a new `## [<new version>] - unreleased` section above the last one.
- The release PR replaces `unreleased` with the release date. Publishing
  happens from a pushed `v<version>` tag on `main`: the release workflow
  refuses a tag that disagrees with `package.json`, and uses that version's
  CHANGELOG section as the GitHub Release notes.

## Stable surface

README §Library use lists the stable exports in its "Stable surface" table.
`test/public-api.test.mjs` fails if that table and the package's actual
exports drift apart, and every stable export has a direct test there.

- Adding, removing or renaming a stable export means changing the table, the
  `STABLE` list in that test, and the export, in the same PR.
- Changing the behaviour of a stable export is a breaking change: note it
  under `### Changed` in the CHANGELOG.
- Everything else is exported from `src/internal.mjs` (the
  `aux-comprehension-test/internal` subpath), is an unstable internal, and may
  change in any `0.x` release. Do not add a non-stable name to `src/index.mjs`.

By contributing you agree that your contributions are licensed under the
Apache License 2.0.
