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

## Credentials

Either route works, and the workflow picks one automatically:

| Route | Set this | How it is used |
|---|---|---|
| Secret store (optional) | Your CI secret store's service token, as a repository secret | The **load-provider-keys step** resolves `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` from your secret store and exports them to the job |
| Plain repository secrets | `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` | The run step reads these when the secret store did not supply a key |

Before either, a **resolve-credential-route step** checks whether the secret
store's token is set and prints which route the run is taking. With no token,
the load-provider-keys step is skipped entirely and only the plain repository
secrets are used, so a fork with no secret store can still run the eval with
nothing but a provider key.

**If both are set, the secret store wins.** The run step keeps any key the
secret-store step already exported and falls back to the plain repository
secret only for a key that is still empty. The decision is per key: a key the
secret store did not resolve can still come from a plain repository secret.

A provider with no key on either route is skipped and reported, not failed. If
**no** provider has a key the run is refused (exit 3) and the job fails — a
live eval with no credentials at all is a misconfiguration, not a result.

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
