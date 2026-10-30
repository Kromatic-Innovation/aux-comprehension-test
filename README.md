# aux-comprehension-test

A blind, cross-model comprehension test for MCP tool copy.

Host models choose your MCP server's tools from the `tools/list` payload alone:
names, titles, descriptions, annotations and schemas. If that copy can be
misread, some host will misread it, and you will never see it happen.
`aux-comprehension-test` runs reader models from more than one provider over
the payload, with no tools and no other context, and asks each one to:

1. **teach back** every tool in its own words,
2. **route** 10 to 14 realistic user requests to a tool (or `none`), and
3. **report confusion**: anything it could read more than one way.

It grades those answers against the ground truth you wrote first, and emits a
**cut-list** (tool × defect × which persona and model tripped it × that
reader's own words), a **token-weight report**, and a
**pass / conditional / fail** verdict. There is no averaged score.

Readers run through [panelist](https://www.npmjs.com/package/panelist)'s
`spawn`, as behavioural personas with different failure points: a small-context
host, a cautious agent, a technical-term searcher and a literal reader.

> **What a pass means.** The readers are models reading a payload, not real MCP
> hosts running their own tool-selection harnesses. A pass is a cheap
> pre-filter: the copy survived blind readers from more than one provider. It is
> not proof that any host will route correctly.

## Install

Requires Node 20 or later.

```bash
npm install -g aux-comprehension-test
```

## Usage

```bash
aux-comprehension-test run \
  --tools tools.json \
  --truth truth.md \
  --requests requests.json \
  --models claude-haiku-4-5,claude-sonnet-4-6,gpt-5 \
  --judge claude-sonnet-4-6 \
  --prices prices.json \
  --max-usd 2 \
  --out .aux-comprehension-test/my-server@abc123
```

Run `aux-comprehension-test --help` for every option. Use `--estimate-only` to
see the pre-run estimate without calling any model.

### Inputs

**`--tools`**: the `tools/list` payload, as a bare array, `{ "tools": [...] }`, or
a JSON-RPC response `{ "result": { "tools": [...] } }`.

**`--truth`**: your intended meaning for each tool, written **before** any reader
runs. Ground truth written after you have seen a reader's answer is a
rationalisation, and nothing downstream can tell the difference. One `##`
section per tool, named exactly as in the payload; it must cover every tool:

```markdown
## estimate_run_cost

Predicts the credit cost of a run before running it. Free and read-only.
Use it before a large run; it does not check the model for mistakes.

- Misreading: It forecasts the probability of an event.
```

Readers never see this file. A sentinel test pins that.

**`--requests`**: 10 to 14 realistic requests, each with the tool that should
handle it (or `"none"`). Include near-miss pairs: two tools a reader could
confuse.

```json
[
  { "id": "q1", "request": "How many credits will a 10,000-trial run cost?",
    "expected": "estimate_run_cost", "nearMiss": "forecast_probability" },
  { "id": "q4", "request": "Translate this paragraph into French.", "expected": "none" }
]
```

Readers see only each request's `id` and `request` text.

### Outputs

| File | Contents |
|---|---|
| `readers/<persona>__<model>.json` | One reader's teach-back, routing picks and confusion list, verbatim |
| `token-weight.md` | Bytes and approximate tokens for the whole payload and per tool (description, input schema, output schema). Informational |
| `verdict.md` | The verdict, why it is not `pass` (if it is not), the cut-list, the actual spend |
| `verdict.json` | The same, machine-readable |

The reader outputs quote your payload verbatim. Keep the run directory out of
version control.

### Exit codes

`0` pass, `1` conditional, `2` fail, `3` refused (over budget, an unpriced
model, or no reader could run; nothing was called), `64` usage error.

## How it grades

- **Routing** is graded mechanically against the expected tool. A miss on a
  near-miss pair is a defect on both tools in the pair.
- **Confusion reports** are grouped by tool and the field they are about.
- **Teach-back drift** is graded by an optional judge model (`--judge`), which
  compares each explanation with your intended meaning without knowing which
  model wrote it. **Without `--judge`, `pass` is always withheld**: the
  readings are written side by side for you to grade, and the best possible
  verdict is `conditional`, with "no --judge" listed under "Why not pass" in
  `verdict.md`, in `withheldPass` in `verdict.json` and on the CLI's
  `pass withheld:` line. This is deliberate: an ungraded teach-back is not
  evidence the copy was understood, so a judge-less run cannot certify it.
- **Reader error vs. copy defect.** A defect tripped by exactly one reader,
  where the copy is unambiguous on re-read, is a reader error, not a must-fix.
  The judge does the re-read; without one the row is marked unverified. A defect
  tripped by two or more readers is a must-fix.
- **Length-only complaints are informational.** "Too long" is not a copy defect
  at current token budgets. It counts only when you pass `--length-benchmark`
  with evidence that your copy is materially longer than comparable tools **and**
  that this correlates with lower selection. The token-weight report is
  benchmark input on the same footing: over-length alone never yields `fail` or
  a must-fix row.

**Verdict:**

- **fail**: structural. A tool whose purpose no reader recovered.
- **conditional**: must-fix rows exist, each a copy edit; or `pass` is withheld.
  `pass` is withheld when the panel spans only one provider, when fewer than
  two readers answered, or when teach-back was not graded (no `--judge`, or
  the judge failed).
- **pass**: no must-fix rows, readers from at least two providers, and graded
  teach-back.

`crossModel` is computed from the readers' providers (panelist's `providerOf`,
or an explicit `provider:` prefix). A single-provider panel can never pass.

## Cost

`--max-usd` is required and has no default. Before any model is called, the
CLI estimates an upper bound on spend (the exact prompt each call will send, at
chars / 4 tokens, plus each call's full output cap) and refuses to start if the
estimate is over the ceiling. A model with no known price also refuses the run:
it is never priced at zero. The bundled table in `data/prices.json` covers
current Anthropic models and OpenAI `gpt-5` (standard tier, verified against
OpenAI's pricing page on the date recorded in the file's `sources` block).
Prices match the exact id or a `-YYYYMMDD` / `@...` snapshot of it only, so
`gpt-5-pro`, `gpt-5-mini` and dashed-date snapshots are unpriced until you add
them. Pass `--prices <file>` for any other model:

```json
{ "models": { "gpt-5-mini": { "input": 0.25, "output": 2 } } }
```

Prices are USD per million tokens. Check them against your provider before
relying on an estimate. Actual usage is reported in `verdict.json` at the end.

## Keys

Keys are read from the environment only: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). A
provider whose key is missing is **skipped and reported**, not treated as a
failure. Prefix a model id with `xai:` or `google:` (or `anthropic:` /
`openai:`) when the provider is not obvious from the id.

## Library use

```js
import { run } from "aux-comprehension-test";

const result = await run(
  { tools, truth, requests, models: ["claude-haiku-4-5", "gpt-5"], maxUsd: 1, out: "run-dir" },
  { clientFor: (spec) => ({ client: myClientFor(spec) }) }, // optional: inject any provider
);
```

An injected client has panelist's adapter shape:
`{ model, complete({ prompt, maxTokens }) -> { ok, text, model, usage? } }`.

## Development

```bash
npm test
```

The suite is offline: every reader and judge is scripted and network access is
disabled. It includes a fixture test over a real server's copy before and
after a copy revision (`test/fixtures/neumann/`). The live cross-model run is a
manual eval; see [`eval/README.md`](eval/README.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
