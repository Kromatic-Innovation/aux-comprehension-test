# eval/ — manual live eval

This directory holds the **manually triggered** live cross-model eval. It is
outside `test/` (so `npm test` never runs it) and outside `package.json`'s
`files` (so it is never published).

`npm test` proves the grader with scripted readers and spends nothing. This
eval is the other half: it runs real reader models from at least two
providers against a committed fixture, to see how live models actually read
the copy and to catch prompt or parser drift against real providers.

## Running it

From the Actions tab, dispatch **Eval - Live panel**
(`.github/workflows/eval-live-panel.yml`). It is `workflow_dispatch` only:
never wired to `push` or `pull_request`, and never a required check.

Inputs:

| Input | Required | Notes |
|---|---|---|
| `fixture` | yes | `mini`, `neumann-before` or `neumann-after` |
| `models` | yes | comma-separated reader model ids; include two providers or the verdict cannot be `pass` |
| `max_usd` | yes | spend ceiling; no default. An estimate over it refuses to start |
| `judge` | no | judge model id; without one `pass` is withheld |
| `prices` | no | JSON `{"models": {"<id>": {"input": usd/Mtok, "output": usd/Mtok}}}` for models the bundled table does not price. An unpriced model refuses the run |

The run directory is uploaded as a workflow artifact. A conditional or fail
verdict is a result, not a broken eval: the job fails only when the run was
refused or the inputs were invalid.

Locally, the same thing is just the CLI with real keys in the environment:

```bash
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node bin/aux-comprehension-test.mjs run \
  --tools test/fixtures/mini/tools.json --truth test/fixtures/mini/truth.md \
  --requests test/fixtures/mini/requests.json \
  --models claude-haiku-4-5,gpt-5 --judge claude-sonnet-4-6 \
  --prices my-prices.json --max-usd 0.50 --out /tmp/act-run
```

A provider whose key is missing is skipped and reported, not treated as a
failure.
