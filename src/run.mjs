// run.mjs — one comprehension-test run, end to end.
//
// Order matters for cost safety: every input is validated, every client is
// resolved and the spend is estimated BEFORE any model is called. An
// estimate over --max-usd, or a model with no known price, refuses the run
// with zero calls made.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPersona, USAGE_HEADER } from "panelist";
import { normalizePayload, parseTruth, checkTruthCoverage, normalizeRequests, gradedTruth } from "./inputs.mjs";
import { registerReaderPersonas, buildPanel, parseModelSpec, renderReaderPrompt, runReader, DEFAULT_PERSONA_IDS } from "./reader.mjs";
import { gradeTeachBack, reread, buildTeachBackPrompt, buildRereadPrompt, teachBackBatches, rereadBatchSize, rereadBatches, judgeMaxTokensProblem } from "./judge.mjs";
import { buildClusters, rereadCandidates, decide } from "./grade.mjs";
import { measureTokenWeight, renderTokenWeightMd } from "./tokenweight.mjs";
import { loadPrices, estimate, meter, actual } from "./cost.mjs";
import { clientFor as defaultClientFor } from "./clients.mjs";
import { renderVerdictMd } from "./render.mjs";
import { readJsonAsset } from "./assets.mjs";

export const VERSION = readJsonAsset("package.json").version;

export const HOST_CAVEAT =
  "The readers are models reading a tools/list payload, not real MCP hosts running their own tool-selection harnesses. A pass is a pre-filter, not proof that a host will route correctly.";

export class RunError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_");
export const readerFileName = (r) => `${safe(r.personaId)}__${safe(r.model)}.json`;

/**
 * @param {object} opts
 *   @param {object} opts.tools        tools/list payload (parsed JSON)
 *   @param {string} opts.truth        ground-truth markdown
 *   @param {object} opts.requests     routing requests (parsed JSON)
 *   @param {string[]} opts.models     model specs
 *   @param {number} opts.maxUsd       REQUIRED spend ceiling
 *   @param {string} [opts.instructions]  the server's `instructions` string (overrides any in the capture)
 *   @param {string} [opts.judge]      judge model spec
 *   @param {string[]} [opts.personas]
 *   @param {number} [opts.maxReaders]
 *   @param {number} [opts.maxTokens=8192]      reader output cap
 *   @param {number} [opts.judgeMaxTokens=4096]  judge output cap; an integer >= MIN_JUDGE_MAX_TOKENS (300)
 *   @param {object} [opts.prices]     model -> {input, output} USD/Mtok
 *   @param {object} [opts.lengthBenchmark]
 *   @param {string} [opts.out]        output directory; omit to write nothing
 *   @param {boolean} [opts.estimateOnly]
 *   @param {object} [opts.env=process.env]
 * @param {object} [deps]
 *   @param {function} [deps.clientFor]  (spec, env) -> {client}|{skipped}
 */
export async function run(opts, deps = {}) {
  const clientFor = deps.clientFor ?? defaultClientFor;
  const env = opts.env ?? process.env;
  const maxTokens = opts.maxTokens ?? 8192;
  const judgeMaxTokens = opts.judgeMaxTokens ?? 4096;
  const prices = opts.prices ?? loadPrices();

  if (!(typeof opts.maxUsd === "number" && Number.isFinite(opts.maxUsd) && opts.maxUsd > 0)) {
    throw new RunError("USAGE", "--max-usd is required and must be a positive number; there is no default");
  }
  const judgeCapProblem = judgeMaxTokensProblem(judgeMaxTokens);
  if (judgeCapProblem) throw new RunError("USAGE", `judgeMaxTokens ${judgeCapProblem}`);
  // inputs.mjs and buildPanel throw plain Errors -- they have no opinion about
  // exit codes. Every one of those is the CALLER's input being wrong, so they
  // surface as USAGE (exit 64), never as a bug in this tool (exit 70). Applied
  // per call rather than around the whole block on purpose:
  // registerReaderPersonas() reads this package's own bundled personas, so if
  // it fails the package is broken and that IS an internal error.
  const asUsage = (fn) => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof RunError) throw err;
      throw new RunError("USAGE", err.message);
    }
  };

  const payload = asUsage(() => normalizePayload(opts.tools, { instructions: opts.instructions }));
  const parsedTruth = asUsage(() => parseTruth(opts.truth));
  asUsage(() => checkTruthCoverage(parsedTruth, payload));
  const truth = gradedTruth(parsedTruth, payload);
  const requests = asUsage(() => normalizeRequests(opts.requests, payload));

  registerReaderPersonas();
  const personaIds = opts.personas?.length ? opts.personas : DEFAULT_PERSONA_IDS;
  for (const id of personaIds) if (!getPersona(id)) throw new RunError("USAGE", `unknown persona ${id}; known: ${DEFAULT_PERSONA_IDS.join(", ")}`);
  const panel = asUsage(() => buildPanel({ personaIds, models: opts.models, maxReaders: opts.maxReaders }));

  const active = [];
  const skipped = [];
  for (const reader of panel) {
    const c = clientFor(reader, env);
    if (c.client) active.push({ reader, client: c.client });
    else skipped.push({ personaId: reader.personaId, model: reader.model, provider: reader.provider, reason: c.skipped });
  }
  let judgeSpec = null;
  let judge = { model: null, client: null, skipped: null };
  if (opts.judge) {
    judgeSpec = parseModelSpec(opts.judge);
    const c = clientFor(judgeSpec, env);
    judge = c.client ? { model: judgeSpec.model, client: c.client, skipped: null } : { model: null, client: null, skipped: `${judgeSpec.model}: ${c.skipped}` };
  }

  // A real run needs at least one reader that can actually be called.
  // --estimate-only does not: it answers a planning question ("what would
  // this cost?") that is meaningful BEFORE any key exists, so it prices the
  // whole panel the command line names and reports which readers cannot run
  // yet. That can only over-state the bound, never under-state it: the panel
  // is a superset of the readers a keyed run would call.
  if (active.length === 0 && !opts.estimateOnly) {
    throw new RunError("REFUSED", `no reader can run: ${skipped.map((s) => `${s.model} (${s.reason})`).join("; ")}`);
  }

  // Pre-run estimate: the exact reader prompts, full output caps.
  let rereadRowsAssumed = null;
  const priced = opts.estimateOnly ? panel.map((reader) => ({ reader })) : active;
  const pricedJudge = opts.estimateOnly ? (judgeSpec?.model ?? null) : judge.model;
  const calls = priced.map(({ reader }) => ({
    purpose: `reader ${reader.personaId}`,
    model: reader.model,
    prompt: renderReaderPrompt({ personaId: reader.personaId, payload, requests }),
    maxTokens,
  }));
  if (pricedJudge) {
    // Every teach-back batch is its own call, each at the full output cap.
    const fakeTeachBack = Object.keys(truth.tools).map((tool) => ({ tool, meaning: "x".repeat(Math.ceil((maxTokens * 4) / Object.keys(truth.tools).length)) }));
    const batches = teachBackBatches(truth);
    for (const { reader } of priced) {
      batches.forEach((tools, i) => {
        calls.push({
          purpose: `judge teach-back ${reader.personaId} (batch ${i + 1}/${batches.length})`,
          model: pricedJudge,
          prompt: buildTeachBackPrompt(truth, fakeTeachBack, tools, payload),
          maxTokens: judgeMaxTokens,
        });
      });
    }
    // The re-read is batched too, and how many rows it gets is only known once
    // the readers answer. Routing rows are keyed by request and teach-back rows
    // by tool, so those are bounded; confusion rows are not, and are priced at
    // one per tool. So this part is an ESTIMATE, not an upper bound: a run
    // with more rows than it assumed spends more on the re-read than shown
    // here, and the run reports rows assumed vs. rows sent (cost.reread). It
    // still never goes over --max-usd: the spend is checked before every
    // re-read call, and the re-read stops (withholding pass) rather than exceed it.
    const nTools = Object.keys(truth.tools).length;
    rereadRowsAssumed = requests.length + 2 * nTools;
    const fakeRow = { id: "x".repeat(40), tools: ["x".repeat(40)], about: "x".repeat(40), complaint: "x".repeat(400), defect: "x".repeat(120) };
    const chunks = rereadBatches(Array.from({ length: rereadRowsAssumed }, () => fakeRow), rereadBatchSize(judgeMaxTokens));
    chunks.forEach((rows, i) => {
      calls.push({ purpose: `judge re-read (batch ${i + 1}/${chunks.length})`, model: pricedJudge, prompt: buildRereadPrompt(payload, rows), maxTokens: judgeMaxTokens });
    });
  }
  let est;
  try {
    est = estimate(calls, prices);
  } catch (err) {
    throw new RunError("REFUSED", err.message);
  }
  est.parts = estimateParts(est, rereadRowsAssumed);
  if (est.usd > opts.maxUsd) {
    throw new RunError(
      "REFUSED",
      `estimated spend $${est.usd.toFixed(4)} exceeds --max-usd ${opts.maxUsd}; refusing to start (no model was called). ` +
        `Lower --readers, drop a model, or raise --max-usd.`,
    );
  }
  if (opts.estimateOnly) {
    return {
      status: "estimate",
      estimate: est,
      skipped,
      judge: { model: judgeSpec?.model ?? null, skipped: judge.skipped },
      // What the estimate covers, and what could run right now with the keys
      // currently in the environment. `priced` >= `runnable` always.
      priced: { readers: priced.length, judge: pricedJudge },
      runnable: { readers: active.length, judge: Boolean(judge.client) },
    };
  }

  // Readers.
  const ledger = [];
  const results = await Promise.all(
    active.map(({ reader, client }) => runReader({ reader, client: meter(client, ledger, `reader ${reader.personaId}`), payload, requests, maxTokens })),
  );
  const ok = results.filter((r) => r.response);

  // Judge: teach-back grades, then a re-read of single-reader complaints.
  // A failed judge call is recorded, never thrown: the run still reports,
  // with pass withheld and the affected rows labelled `judge failed`.
  let teachBackGrades = null;
  const judgeErrors = [];
  const judgeFailures = [];
  const judgeFailed = (purpose, err) => {
    judgeErrors.push(err.message);
    judgeFailures.push({
      purpose,
      reason: err.reason ?? err.message,
      stopReason: err.stopReason ?? null,
      ...(err.raw != null ? { raw: err.raw, file: `judge/${judgeFailures.length + 1}-${safe(purpose)}.txt` } : {}),
    });
  };
  if (judge.client) {
    const jc = meter(judge.client, ledger, "judge");
    teachBackGrades = new Map();
    for (const r of ok) {
      try {
        teachBackGrades.set(`${r.personaId}__${r.model}`, await gradeTeachBack(jc, truth, r.response.teachBack, { maxTokens: judgeMaxTokens, payload }));
      } catch (err) {
        judgeFailed(`teach-back ${r.personaId}__${r.model}`, err);
      }
    }
  }
  const teachBackGraded = Boolean(judge.client) && judgeFailures.length === 0 && ok.length > 0;
  const clusters = buildClusters({ readers: ok, requests, truth, teachBackGrades, lengthBenchmark: opts.lengthBenchmark ?? null });
  // Re-read of single-reader rows, in batches. A failed batch is recorded and
  // the next one is still sent. Before each call, the spend so far plus that
  // call's upper bound is checked against --max-usd, and the re-read stops
  // rather than go over. Every row left without a verdict is named in
  // rereadGaps with why, and withholds pass (grade.mjs).
  let rereads = null;
  const rereadGaps = new Map();
  let rereadReport = null;
  if (judge.client) {
    const candidates = rereadCandidates(clusters);
    let rowsStopped = 0;
    rereads = await reread(meter(judge.client, ledger, "judge"), payload, candidates, {
      maxTokens: judgeMaxTokens,
      beforeBatch: ({ prompt }) => {
        const spent = actual(ledger, prices).usd;
        const next = estimate([{ purpose: "judge re-read", model: judge.model, prompt, maxTokens: judgeMaxTokens }], prices).usd;
        if (spent + next <= opts.maxUsd) return null;
        return `--max-usd ${opts.maxUsd} would be exceeded: ${spent.toFixed(4)} USD spent, next re-read call up to ${next.toFixed(4)} USD`;
      },
      onBatchError: (err, batch, i, n) => {
        judgeFailed(n > 1 ? `re-read batch ${i + 1}/${n}` : "re-read", err);
        for (const c of batch) rereadGaps.set(c.id, `judge failed: ${err.reason ?? err.message}`);
      },
      onStop: (reason, rows) => {
        rowsStopped = rows.length;
        for (const c of rows) rereadGaps.set(c.id, `not re-read: ${reason}`);
      },
    });
    rereadReport = rereadRowReport(rereadRowsAssumed, candidates.length, candidates.length - rowsStopped);
  }
  const judgeFailure = judgeFailures.length ? failureSummary(judgeFailures) : null;
  const tokenWeight = await measureTokenWeight(payload);
  const grade = decide({
    clusters,
    readers: ok,
    rereads,
    teachBackGraded,
    tokenWeight,
    judgeFailure: judge.client ? { teachBack: teachBackGraded ? null : judgeFailure, reread: null } : null,
    rereadGaps,
    // Configured = every reader the panel named, including any skipped for a
    // missing key: the reader that never answered may be the one that would
    // have blocked.
    panel: {
      configured: panel.length,
      missing: [
        ...results.filter((r) => !r.response).map((r) => ({ personaId: r.personaId, model: r.model, reason: r.error ?? "no reply" })),
        ...skipped.map((s) => ({ personaId: s.personaId, model: s.model, reason: `skipped: ${s.reason}` })),
      ],
    },
  });

  const result = {
    status: "completed",
    tool: "aux-comprehension-test",
    version: VERSION,
    grade,
    readers: results.map((r) => ({
      personaId: r.personaId,
      model: r.model,
      provider: r.provider,
      status: r.response ? "ok" : "error",
      ...(r.error ? { error: r.error } : {}),
      file: `readers/${readerFileName(r)}`,
    })),
    skipped,
    judge: {
      model: judge.model,
      skipped: judge.skipped,
      errors: judgeErrors,
      // One entry per failed judge call: why, the provider's stop reason
      // (`max_tokens` = cut off), and where the clipped raw reply was saved.
      failures: judgeFailures.map(({ raw, ...f }) => f),
    },
    lengthBenchmark: opts.lengthBenchmark ?? null,
    cost: { maxUsd: opts.maxUsd, estimate: est, actual: actual(ledger, prices), reread: rereadReport },
    tokenWeight: {
      label: tokenWeight.label,
      method: tokenWeight.method,
      total: tokenWeight.total,
      ...(tokenWeight.instructions ? { instructions: tokenWeight.instructions } : {}),
      flags: tokenWeight.flags,
    },
    honesty: [USAGE_HEADER, HOST_CAVEAT],
  };

  if (opts.out) writeOutputs(opts.out, result, results, tokenWeight, judgeFailures);
  return result;
}

/**
 * Split an estimate into the part that is an upper bound (reader calls and
 * teach-back judge calls: every prompt is known before the run) and the
 * re-read part, which is priced for `rowsAssumed` rows and is only an estimate.
 * `reread` is null when no judge is priced (there is no re-read to estimate).
 */
export function estimateParts(est, rowsAssumed) {
  const isReread = (c) => c.purpose.startsWith("judge re-read");
  const sum = (rows) => rows.reduce((s, r) => s + r.usd, 0);
  const bounded = est.calls.filter((c) => !isReread(c));
  const rr = est.calls.filter(isReread);
  return {
    bounded: { usd: sum(bounded), calls: bounded.length },
    reread: rowsAssumed == null ? null : { usd: sum(rr), calls: rr.length, rowsAssumed },
  };
}

/**
 * The re-read's row count against what the estimate assumed. `rows` is every
 * single-reader row due a re-read; `rowsSent` excludes rows the spend cap kept
 * back. `overAssumed` is true when the run had more rows than the estimate
 * priced, so the re-read part of the estimate understated it.
 */
export function rereadRowReport(rowsAssumed, rows, rowsSent) {
  return { rowsAssumed, rows, rowsSent, overAssumed: rowsAssumed != null && rows > rowsAssumed };
}

/** A short cause for row labels: the first failure, plus how many more. */
function failureSummary(failures) {
  const first = failures[0].reason;
  return failures.length > 1 ? `${first}; +${failures.length - 1} more` : first;
}

export function writeOutputs(out, result, readerResults, tokenWeight, judgeFailures = []) {
  mkdirSync(join(out, "readers"), { recursive: true });
  const kept = judgeFailures.filter((f) => f.file);
  if (kept.length) mkdirSync(join(out, "judge"), { recursive: true });
  for (const f of kept) {
    writeFileSync(join(out, f.file), `# judge call: ${f.purpose}\n# stop reason: ${f.stopReason ?? "unknown"}\n# reason: ${f.reason}\n\n${f.raw}\n`);
  }
  for (const r of readerResults) {
    const body = {
      personaId: r.personaId,
      model: r.model,
      provider: r.provider,
      ...(r.response ?? {}),
      ...(r.message ? { message: r.message } : {}),
      ...(r.isolation ? { isolation: r.isolation } : {}),
      ...(r.error ? { error: r.error } : {}),
      ...(r.raw ? { raw: r.raw } : {}),
    };
    writeFileSync(join(out, "readers", readerFileName(r)), JSON.stringify(body, null, 2) + "\n");
  }
  writeFileSync(join(out, "token-weight.md"), renderTokenWeightMd(tokenWeight));
  writeFileSync(join(out, "verdict.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(out, "verdict.md"), renderVerdictMd(result));
}
