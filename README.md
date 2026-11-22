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

> **Live runs need provider API keys and cost money.** Every reader and judge
> call is billed to your own provider account. `--max-usd` is required, has no
> default, and refuses to start when the pre-run estimate is over your ceiling.
> The first run below needs no key and spends nothing.

## Install

Requires Node 20 or later.

```bash
npm install -g aux-comprehension-test

# Or the unreleased tip of develop:
npm install -g github:Kromatic-Innovation/aux-comprehension-test#develop
```

Releases publish to npm from reviewed `vX.Y.Z` tags, with provenance. See
`CHANGELOG.md` for what each version changed.

Running from a git checkout instead? Run `npm ci` in it first.

### Runtime dependency

The one runtime dependency is [panelist](https://www.npmjs.com/package/panelist),
which supplies the persona registry and the `spawn` prompt the readers run
through. It is **pre-1.0** and comes from the same organisation as this
package, so the two move together. The supported range is `^0.4.1` (from
`package.json`), which npm reads as `>=0.4.1 <0.5.0`: a panelist `0.5.0`
is a breaking change until this package widens the range.

## First run (no key, no spend)

Ask for the estimate instead of the run. `--estimate-only` reads your real
inputs, builds the real reader prompts, prices them against the bundled table,
and prints the estimate — without calling any model and without needing a
provider key:

```bash
aux-comprehension-test run \
  --tools "$(npm root -g)/aux-comprehension-test/examples/mini/tools.json" \
  --truth "$(npm root -g)/aux-comprehension-test/examples/mini/truth.md" \
  --requests "$(npm root -g)/aux-comprehension-test/examples/mini/requests.json" \
  --models claude-haiku-4-5,gpt-5 \
  --max-usd 1 \
  --estimate-only
```

Installed locally instead (`npm install aux-comprehension-test` in a project)?
Run this from that project's directory. `npx` finds the local CLI, and the
example sits under `node_modules`:

```bash
npx aux-comprehension-test run \
  --tools node_modules/aux-comprehension-test/examples/mini/tools.json \
  --truth node_modules/aux-comprehension-test/examples/mini/truth.md \
  --requests node_modules/aux-comprehension-test/examples/mini/requests.json \
  --models claude-haiku-4-5,gpt-5 \
  --max-usd 1 \
  --estimate-only
```

Either command prints:

```
SKIPPED reader small-context-host x claude-haiku-4-5: ANTHROPIC_API_KEY is not set
SKIPPED reader cautious-agent x gpt-5: OPENAI_API_KEY is not set
SKIPPED reader technical-term-searcher x claude-haiku-4-5: ANTHROPIC_API_KEY is not set
SKIPPED reader literal-reader x gpt-5: OPENAI_API_KEY is not set
estimated spend: $0.2605 over 4 call(s)
  readers (upper bound): $0.2605 over 4 call(s)
priced: 4 reader(s), ceiling $1
runnable now: 0 of 4 reader(s) have a key
no model was called; nothing was spent.
```

Missing keys are reported, not fatal: the estimate covers the whole panel your
command line names, so the number does not change when you add a key. Exit
code is 0.

With `--judge`, the estimate has a second part. The reader and teach-back calls
stay an upper bound; the re-read is only an estimate, because its row count is
not known until the readers answer (see [Cost](#cost)). Add `--judge <model>`
to the same command. The judge must be a model with a price, either in the
bundled table `data/prices.json` (for example `claude-sonnet-4-6`) or in your
own `--prices` file:

```bash
aux-comprehension-test run \
  --tools "$(npm root -g)/aux-comprehension-test/examples/mini/tools.json" \
  --truth "$(npm root -g)/aux-comprehension-test/examples/mini/truth.md" \
  --requests "$(npm root -g)/aux-comprehension-test/examples/mini/requests.json" \
  --models claude-haiku-4-5,gpt-5 \
  --judge claude-sonnet-4-6 \
  --max-usd 1 \
  --estimate-only
```

```
SKIPPED reader small-context-host x claude-haiku-4-5: ANTHROPIC_API_KEY is not set
SKIPPED reader cautious-agent x gpt-5: OPENAI_API_KEY is not set
SKIPPED reader technical-term-searcher x claude-haiku-4-5: ANTHROPIC_API_KEY is not set
SKIPPED reader literal-reader x gpt-5: OPENAI_API_KEY is not set
SKIPPED judge claude-sonnet-4-6: ANTHROPIC_API_KEY is not set
estimated spend: $0.9067 over 9 call(s)
  readers + teach-back (upper bound): $0.8254 over 8 call(s)
  re-read (estimated, 10 rows assumed): $0.0813 over 1 call(s); more rows cost more, up to --max-usd
priced: 4 reader(s) + judge claude-sonnet-4-6 (no key yet), ceiling $1
runnable now: 0 of 4 reader(s) have a key
no model was called; nothing was spent.
```

The paths above are the small example payload that ships in the package, under
`examples/mini/` of the install (global or `node_modules`). From a git checkout, use
`examples/mini/tools.json` and so on directly. Nothing about `--estimate-only`
depends on the example: point the same three flags at your own `tools.json`,
`truth.md` and `requests.json`.

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

**`--instructions`** (optional): the server's `instructions` string, the
other agent-facing copy an MCP server sends, returned by `initialize`. Many
hosts put it in the model's context next to the tools, so copy that explains
something once in the instructions and only refers to it in each tool should
be tested with it. Pass a plain-text or markdown file. If `--tools` is a
capture that carries instructions, they are used without the flag:
`{ "tools": [...], "instructions": "..." }`,
`{ "result": { "tools": [...], "instructions": "..." } }`, or a JSON-RPC array
`[<initialize response>, <tools/list response>]`. The flag wins over a capture.
Readers see the instructions under `server_instructions`, before the tools,
and are asked to teach them back as `server-instructions`. Without
instructions, nothing changes.

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

When you pass server instructions, you may add a `## server-instructions`
section with their intended meaning. It is graded for teach-back like a tool.
It is optional, and it is set aside on runs without instructions, so one truth
file serves both.

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

When more than one tool is a correct answer, list the others in an optional
`also_acceptable` array (tool names in the payload, or `"none"`). A pick in
`also_acceptable` counts as correct: no routing row, and no near-miss row
even when it is the `nearMiss` tool. Write it before any reader runs, like
the rest of the ground truth. An entry that is not a tool in the payload (or
`"none"`) is a usage error (exit `64`).

```json
{ "id": "q7", "request": "What's the P80 total cost?",
  "expected": "scenario_analysis", "nearMiss": "estimate_run_cost",
  "also_acceptable": ["full_distribution"] }
```

Here a reader who picks `full_distribution` is correct. A reader who picks
`estimate_run_cost` trips the near-miss row, and any other pick trips a routing
row.

Readers see only each request's `id` and `request` text. They never see
`expected`, `nearMiss` or `also_acceptable`.

### Outputs

| File | Contents |
|---|---|
| `readers/<persona>__<model>.json` | One reader's teach-back, routing picks and confusion list, verbatim |
| `token-weight.md` | Bytes and approximate tokens for the whole payload and per tool (description, input schema, output schema), plus a `(server instructions)` row when instructions were given (not counted in the payload total). Informational |
| `verdict.md` | The verdict, why it is not `pass` (if it is not), the cut-list, the actual spend |
| `verdict.json` | The same, machine-readable |
| `judge/<n>-<call>.txt` | Only when a judge call failed to parse: the judge's raw reply (first and last 2 KB), with the provider's stop reason (`max_tokens` means it was cut off) |

The reader outputs quote your payload verbatim. Keep the run directory out of
version control.

### Exit codes

`0` pass, `1` conditional, `2` fail, `3` refused (over budget, an unpriced
model, or no reader could run; nothing was called), `64` usage error (your
command line or input files), `70` internal error (a bug in this tool).

`0`-`2` are verdicts, so a crash never reuses them: a caller can always tell a
result from a failure. `64` and `70` are the sysexits `EX_USAGE` / `EX_SOFTWARE`
codes: `64` means fix your command line or inputs, `70` means report a bug.

## How it grades

- **Routing** is graded mechanically against the expected tool, or any tool
  in the request's `also_acceptable`. A miss on a near-miss pair is a defect
  on both tools in the pair.
- **Confusion reports** are grouped by tool and the field they are about.
- **Teach-back drift** is graded by an optional judge model (`--judge`), which
  compares each explanation with your intended meaning without knowing which
  model wrote it. **Without `--judge`, `pass` is always withheld**: the
  readings are written side by side for you to grade, and the best possible
  verdict is `conditional`, with "no --judge" listed under "Why not pass" in
  `verdict.md`, in `withheldPass` in `verdict.json` and on the CLI's
  `pass withheld:` line. This is deliberate: an ungraded teach-back is not
  evidence the copy was understood, so a judge-less run cannot certify it.
  The judge grades teach-back in batches of 5 tools per call, so a large
  payload never needs one reply big enough to be cut off at the output cap.
  If a teach-back call fails anyway, `pass` is withheld the same way, but the
  reason reads "judge failed: <reason>", not "no --judge"; `verdict.json`'s
  `judge.failures` records the stop reason, and the raw reply is saved under
  `judge/`.
- **The re-read is batched too.** Single-reader rows go to the judge in
  batches sized from the judge's output cap (one row per 300 tokens of it), so
  no reply has to hold them all. A batch that fails (cut off, or not JSON) is
  recorded and the next batch is still sent. Before each re-read call, the
  spend so far plus that call's upper bound is checked against `--max-usd`; if
  it would go over, the re-read stops there. Any single-reader row left
  without a verdict (its batch failed, the judge's reply left it out, or the
  spend cap stopped the re-read) withholds `pass`, with "re-read incomplete:
  N of M single-reader rows unverified" and the cause of each.
- **Must-fix needs a misreading.** A misreading is a routing miss (on the
  expected tool, and on a tool picked wrongly) or teach-back drift the judge
  confirmed against your ground truth. A confusion report is reported unease,
  not a misreading: a cluster of confusion reports about a tool is
  `informational`, however many readers raised it, unless some reader also
  misread that tool. The readers' words stay in the row so you still see them,
  and if the judge's re-read finds the copy ambiguous the row is flagged
  `consider`. Neither moves the verdict. (A length complaint promoted by
  `--length-benchmark` is exempt: the benchmark is the evidence.)
- **Reader error vs. copy defect.** A defect tripped by exactly one reader,
  where the copy is unambiguous on re-read, is a reader error, not a must-fix.
  The judge does the re-read; without one the row is marked
  `unverified (no judge)`, and when the judge was configured but failed it is
  marked `unverified (judge failed: <reason>)`. A defect
  tripped by two or more readers is a must-fix (for confusion, only with a
  misreading, above).
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
  two readers answered, when fewer readers answered than the panel was
  configured for (a reader whose reply could not be parsed, whose call failed,
  or that was skipped for a missing key; the reason names each one and why),
  when teach-back was not graded (no `--judge`, or the judge failed), or when
  the judge's re-read did not complete: any single-reader row left without a
  verdict (a cut-off or unparseable batch, a reply that left the row out, or
  `--max-usd` reached before it was sent). A run that fails still fails.
- **pass**: no must-fix rows, readers from at least two providers, and graded
  teach-back.

`crossModel` is computed from the readers' providers (panelist's `providerOf`,
or an explicit `provider:` prefix). A single-provider panel can never pass.

## Cost

`--max-usd` is required and has no default. Before any model is called, the
CLI estimates spend (the exact prompt each call will send, at chars / 4 tokens,
plus each call's full output cap and the input of its maximum retries) and
refuses to start if the estimate is over the ceiling. For the reader calls and
the teach-back judge calls this is an upper bound. The re-read part is not (see
below), so the total is not one either when a judge is configured. A model with no known price also refuses the run:
it is never priced at zero. The bundled table in `data/prices.json` covers
current Anthropic models and OpenAI `gpt-5` (standard tier). Each provider's
entry under that file's `sources` block records the pricing page the numbers
were verified against and the date they were read, so a stale table is visible
rather than silent. A price entry can carry one prompt-length tier,
`"above": { "tokens": N, "input": ..., "output": ... }`: a call whose
approximate input tokens are over `N` is priced at the `above` rates, in the
estimate and in the actual spend, so the tier never makes the estimate understate a call.
`claude-haiku-5-5` is bundled this way (0.1 / 0.5 up to 100,000 input tokens,
0.5 / 2.5 above). An `above` tier that is missing a field is treated as
unpriced and refuses the run.
The re-read's row count is only known once the readers answer, so the estimate
prices it for one row per request plus two per tool (routing, teach-back and
one confusion row per tool). Confusion rows have no real bound, so this part is
an estimate, printed separately with the number of rows it assumed. A run that
produces more rows than that spends more on the re-read than the estimate
showed, and says so: `verdict.json`'s `cost.reread` carries `rowsAssumed`,
`rows` (rows due a re-read), `rowsSent` and `overAssumed`, and `verdict.md`
prints the same counts. Each assumed row is also priced as a fixed-size
placeholder (a 400-character complaint and a 120-character defect), so rows that
match the assumed count but carry longer complaints can still need more input
than the estimate showed. `cost.reread` records that too: `inputCharsAssumed`
(the input characters of the re-read calls the estimate priced), `inputChars`
(the input characters of the re-read calls the run's rows needed, sent or not)
and `inputOverAssumed` (true when `inputChars` is the larger), and the CLI
summary prints a `re-read input:` line when it is true. The re-read still
never goes over the ceiling: spend is checked again before every re-read call,
and the re-read stops, withholding `pass`, rather than exceed `--max-usd`. So a
`--max-usd` set equal to the estimate can end `conditional` with "re-read
incomplete"; leave headroom above the re-read part if you want the whole
re-read. With no judge configured there is no re-read, and `cost.reread` is
`null`.
Prices match the exact id or a `-YYYYMMDD` / `@...` snapshot of it only, so
`gpt-5-pro`, `gpt-5-mini` and dashed-date snapshots are unpriced until you add
them. Pass `--prices <file>` for any other model:

```json
{ "models": { "gpt-5-mini": { "input": 0.25, "output": 2 } } }
```

A provider call that gets a 429 or a 5xx is retried at most twice, waiting
for the response's `Retry-After` when it has one (and giving up instead when
that is over 60 s), otherwise 1 s and then 2 s. Any other error, including a
timeout, is not retried. A call that still fails is reported on that reader and
the run continues. Each retried attempt is counted in actual spend at its full
input and no output, since the provider reports no usage for it, and the
estimate counts that worst case (two retried attempts) for every call, so the
estimate never understates a call that is retried.

Prices are USD per million tokens. Check them against your provider before
relying on an estimate. Actual usage is reported in `verdict.json` at the end.

## Keys

Keys are read from the environment only: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). A
provider whose key is missing is **skipped and reported**, not treated as a
failure. A skipped reader did not answer, though, so a run with one cannot
`pass`: see "fewer readers answered than the panel was configured for" under
the verdict rules. Prefix a model id with `xai:` or `google:` (or `anthropic:` /
`openai:`) when the provider is not obvious from the id.

## Network and data sent

A live run contacts only the providers its readers and judge belong to, and
only these hosts:

| Provider | Host | Key |
|---|---|---|
| Anthropic | `api.anthropic.com` | `ANTHROPIC_API_KEY` |
| OpenAI | `api.openai.com` | `OPENAI_API_KEY` |
| xAI | `api.x.ai` | `XAI_API_KEY` |
| Google | `generativelanguage.googleapis.com` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` |

Nothing else is called: no telemetry, no update check, no price lookup (prices
come from the bundled `data/prices.json` or your `--prices` file). A provider
with no key set is never contacted.

What is sent to those providers:

- **Every reader** receives its reader prompt, which contains the **full
  `tools/list` payload** you pass with `--tools` and the `id` and `request`
  text of every routing request. It does not receive your ground truth or the
  expected tools.
- **The judge** (only with `--judge`) receives your **ground-truth file**
  alongside each reader's teach-back, together with each tool's own payload
  entry and the server instructions, and the payload alongside any complaint
  that exactly one reader raised.

Treat the payload and the ground truth as shared with each provider you name,
under that provider's own data terms.

**`--estimate-only` and `npm test` contact no provider.** `--estimate-only`
builds and prices the prompts and returns before any model is called, with or
without keys in the environment. `npm test` replaces `fetch` with one that
fails the test making the call, and carries no keys.

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

### `run()` options

`run(opts, deps?)` reads exactly these fields. Each CLI flag maps to one of
them; `run` reads no files and parses no paths itself.

| Field | Type | Required | Default | CLI flag |
|---|---|---|---|---|
| `tools` | parsed JSON: a bare array, `{ tools }`, `{ result: { tools } }`, or a JSON-RPC capture `[<initialize response>, <tools/list response>]` | yes | | `--tools` |
| `truth` | string: the ground-truth markdown | yes | | `--truth` |
| `requests` | parsed JSON: `[{ id, request, expected, nearMiss?, also_acceptable? }]` | yes | | `--requests` |
| `models` | `string[]` of model specs (`xai:`, `google:` etc. prefixes allowed) | yes | | `--models` |
| `maxUsd` | positive number: the spend ceiling | yes | none, ever | `--max-usd` |
| `instructions` | string: the server's `initialize` `instructions` | no | any `instructions` in the `tools` capture, else none | `--instructions` (file contents) |
| `judge` | model spec string | no | no judge, so `pass` is withheld | `--judge` |
| `personas` | `string[]` of reader persona ids | no | all bundled personas | `--personas` |
| `maxReaders` | number: cap on panel size | no | no cap | `--readers` |
| `maxTokens` | number: reader output cap | no | `8192` | `--max-tokens` |
| `judgeMaxTokens` | integer: judge output cap, at least `300` (room for one re-read row; a smaller value refuses the run) | no | `4096` | `--judge-max-tokens` |
| `prices` | flat map `{ <id>: { input, output, above? } }`, USD per million tokens (no `models` wrapper) | no | the bundled `data/prices.json` table | `--prices` (merged over the bundled table) |
| `lengthBenchmark` | `{ materiallyLonger, correlatesWithLowerSelection, source }` | no | `null` | `--length-benchmark` |
| `out` | directory path to write outputs into | no | write nothing | `--out` |
| `estimateOnly` | boolean | no | `false` | `--estimate-only` |
| `env` | object to read provider keys from | no | `process.env` | none |

`deps.clientFor(spec, env)` replaces the built-in provider clients. It
receives a parsed spec `{ provider, model }` and returns `{ client }` or
`{ skipped: "<reason>" }`.

`prices`, when you pass it to `run` directly, **replaces** the bundled table
rather than merging with it, and is the flat model map, not the
`{ "models": ... }` file shape `--prices` reads. The CLI builds it with the
`loadPrices(file)` from `aux-comprehension-test/internal` (an unstable
internal), which merges a file over the bundled table.

### `run()` result

A completed run resolves to the object written to `verdict.json`:

```js
{
  status: "completed",
  tool: "aux-comprehension-test",
  version: "0.2.2",
  grade: {
    verdict: "pass" | "conditional" | "fail",
    crossModel: true,                 // readers came from two or more providers
    providers: ["anthropic", "openai"],
    withheldPass: [],                 // why not pass; empty when verdict is "pass"
    counts: { structural, mustFix, readerError, informational },
    cutList: [ /* one row per defect: { id, kind, tools, defect, class, trippedBy, about?, misreadings?, consider?, reread? } */ ],
  },
  readers: [{ personaId, model, provider, status: "ok" | "error", error?, file }],
  skipped: [{ personaId, model, provider, reason }],   // readers with no key
  judge: { model, skipped, errors, failures: [{ purpose, reason, stopReason, file? }] },
  lengthBenchmark,                    // the option, echoed, or null
  cost: {
    maxUsd,
    estimate: { usd, maxRetries, calls, parts: { bounded: { usd, calls }, reread: { usd, calls, rowsAssumed } | null } },
    actual: { usd, approximate, retries, calls },
    reread: { rowsAssumed, rows, rowsSent, overAssumed, inputCharsAssumed, inputChars, inputOverAssumed } | null, // null when no judge is configured
  },
  tokenWeight: { label, method, total: { bytes, tokens }, instructions?: { bytes, tokens }, flags },
  honesty: [ /* panelist's usage header, then HOST_CAVEAT */ ],
}
```

`cutList[].class` is `structural`, `must-fix`, `reader-error` or
`informational`, in that order. Each `readers[].file` is the path, relative to
`out`, of that reader's verbatim answer.

`cost.reread` and `cost.estimate.parts.reread` are `null` when no judge is
configured (no `judge` option, or a judge skipped for a missing key): there is
no re-read. Check for `null` before reading `cost.reread.overAssumed`.

With `estimateOnly: true`, `run` resolves instead to
`{ status: "estimate", estimate, skipped, judge: { model, skipped },
priced: { readers, judge }, runnable: { readers, judge } }` and writes nothing.
`run` throws a `RunError` (below) for bad inputs or a refused run. A reader
whose call failed does not throw: it appears in `readers` with
`status: "error"`.

### Stable surface

Exactly these exports are public and documented. Each one has a direct test,
and `test/public-api.test.mjs` fails if this list and the package's actual
exports drift apart:

| Export | What it is |
|---|---|
| `run(opts, deps?)` | One comprehension-test run, end to end. Returns the result object written to `verdict.json` |
| `RunError` | Thrown by `run`. `.code` is `"REFUSED"` (nothing was called) or `"USAGE"` (bad inputs) |
| `VERSION` | This package's version |
| `HOST_CAVEAT` | The sentence every output carries about what a pass does and does not mean |
| `main(argv, io?)` | The CLI as a function. Returns the exit code; writes nothing to the real stdio unless you let it |
| `EXIT` | The exit-code map (`pass`, `conditional`, `fail`, `refused`, `usage`, `internal`) |

The package root exports nothing else. **Everything under
`aux-comprehension-test/internal` is an unstable internal**: the graders,
prompt builders, persona registry, cost functions and provider clients. It is
exported so the test suite can reach it; any of it may change shape in any
`0.x` release without a major bump. Import from it only if you are willing to
pin an exact version.

## Development

```bash
npm test
```

The suite is offline: every reader and judge is scripted and network access is
disabled. It includes a fixture test over a real server's copy before and
after a copy revision (`test/fixtures/neumann/`). The live cross-model run is a
manual eval; see [`eval/README.md`](eval/README.md).

## Maintainer

Maintained by Kromatic. For bugs and features, open an issue on this
repository. For anything security-sensitive, do **not** open a public issue —
email **security@kromatic.com** instead (see [SECURITY.md](SECURITY.md)).

Maintenance is **best effort, with no SLA**. We aim to reply to issues and
pull requests within about two weeks, but there is no guaranteed response
time; security reports follow the shorter timeline in SECURITY.md.

The code is Apache-2.0: **fork it freely**, patch it for your own needs, and
publish your fork under its own name. You do not need to wait on us.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
