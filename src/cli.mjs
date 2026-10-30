// cli.mjs — `aux-comprehension-test run ...`.
//
// Exit codes: 0 pass, 1 conditional, 2 fail, 3 refused (over budget, unknown
// price, or no reader can run; nothing was called), 64 usage error.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { run, RunError, VERSION } from "./run.mjs";
import { loadPrices } from "./cost.mjs";

export const EXIT = { pass: 0, conditional: 1, fail: 2, refused: 3, usage: 64 };

export const USAGE = `aux-comprehension-test ${VERSION}

Usage:
  aux-comprehension-test run --tools tools.json --truth truth.md --requests requests.json \\
    --models <m1,m2,...> --max-usd N --out <dir> [options]

Required:
  --tools <file>        MCP tools/list payload (bare array, {tools}, or JSON-RPC {result:{tools}})
  --truth <file>        ground truth: one "## <tool_name>" section per tool (intended meaning)
  --requests <file>     routing requests: [{id, request, expected, nearMiss?}]
  --models <list>       comma-separated model ids; prefix xai:/google: (or anthropic:/openai:) when ambiguous
  --max-usd <N>         spend ceiling in USD; no default. Over-estimate refuses to start
  --out <dir>           output directory (unless --estimate-only)

Options:
  --judge <model>       judge for teach-back drift and single-reader re-reads; without one, pass is withheld
  --personas <list>     reader personas (default: all bundled)
  --readers <N>         cap the number of readers
  --max-tokens <N>      reader output cap (default 8192)
  --prices <file>       price overrides {"models": {"<id>": {"input": usd/Mtok, "output": usd/Mtok}}}
  --length-benchmark <file>  {materiallyLonger, correlatesWithLowerSelection, source}; only both true promotes length complaints
  --estimate-only       print the pre-run estimate and exit without calling any model

Keys come from ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY. A missing key skips that
reader and is reported; it is not a failure.

Exit: 0 pass, 1 conditional, 2 fail, 3 refused, 64 usage error.
`;

const OPTIONS = {
  tools: { type: "string" },
  truth: { type: "string" },
  requests: { type: "string" },
  models: { type: "string" },
  judge: { type: "string" },
  personas: { type: "string" },
  readers: { type: "string" },
  "max-usd": { type: "string" },
  "max-tokens": { type: "string" },
  prices: { type: "string" },
  "length-benchmark": { type: "string" },
  out: { type: "string" },
  "estimate-only": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);

/**
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr, deps } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`${err.message}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const { values: v, positionals } = parsed;
  if (v.help || positionals[0] === "help") {
    stdout.write(USAGE);
    return 0;
  }
  if (positionals[0] !== "run") {
    stderr.write(`expected the "run" command\n\n${USAGE}`);
    return EXIT.usage;
  }
  const missing = ["tools", "truth", "requests", "models", "max-usd"].filter((k) => !v[k]);
  if (!v["estimate-only"] && !v.out) missing.push("out");
  if (missing.length) {
    stderr.write(`missing required: ${missing.map((m) => `--${m}`).join(", ")}\n\n${USAGE}`);
    return EXIT.usage;
  }
  const maxUsd = Number(v["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    stderr.write("--max-usd must be a positive number\n");
    return EXIT.usage;
  }

  let opts;
  try {
    opts = {
      tools: JSON.parse(readFileSync(v.tools, "utf8")),
      truth: readFileSync(v.truth, "utf8"),
      requests: JSON.parse(readFileSync(v.requests, "utf8")),
      models: list(v.models),
      judge: v.judge,
      personas: list(v.personas),
      maxReaders: v.readers ? Number(v.readers) : undefined,
      maxTokens: v["max-tokens"] ? Number(v["max-tokens"]) : undefined,
      maxUsd,
      prices: loadPrices(v.prices),
      lengthBenchmark: v["length-benchmark"] ? JSON.parse(readFileSync(v["length-benchmark"], "utf8")) : null,
      out: v.out,
      estimateOnly: Boolean(v["estimate-only"]),
      env,
    };
  } catch (err) {
    stderr.write(`could not read inputs: ${err.message}\n`);
    return EXIT.usage;
  }

  let result;
  try {
    result = await run(opts, deps);
  } catch (err) {
    if (err instanceof RunError && err.code === "REFUSED") {
      stderr.write(`REFUSED: ${err.message}\n`);
      return EXIT.refused;
    }
    stderr.write(`${err.message}\n`);
    return EXIT.usage;
  }

  for (const s of result.skipped) stderr.write(`SKIPPED reader ${s.personaId} x ${s.model}: ${s.reason}\n`);
  if (result.judge?.skipped) stderr.write(`SKIPPED judge ${result.judge.skipped}\n`);
  if (result.status === "estimate") {
    stdout.write(`estimated spend (upper bound): $${result.estimate.usd.toFixed(4)} over ${result.estimate.calls.length} call(s)\n`);
    return 0;
  }
  const g = result.grade;
  stdout.write(
    `verdict: ${g.verdict} (crossModel: ${g.crossModel}; ${g.counts.mustFix} must-fix, ${g.counts.structural} structural, ` +
      `${g.counts.readerError} reader-error, ${g.counts.informational} informational)\n` +
      (g.withheldPass.length ? `pass withheld: ${g.withheldPass.join("; ")}\n` : "") +
      `spend: $${result.cost.actual.usd.toFixed(4)} actual, $${result.cost.estimate.usd.toFixed(4)} estimated, ceiling $${maxUsd}\n` +
      `wrote ${opts.out}/verdict.md\n`,
  );
  return EXIT[g.verdict];
}
