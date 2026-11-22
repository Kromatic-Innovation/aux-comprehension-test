// judge.mjs — the optional injected judge.
//
// Two jobs:
//   gradeTeachBack: compare one reader's teach-back with the intended
//     meaning and the tool's own payload text. The judge never sees which model or persona wrote it. Graded
//     in batches of TEACHBACK_BATCH_SIZE tools, one call per batch, so a large
//     payload never needs one huge reply that the output cap cuts off.
//   reread: for complaints raised by exactly one reader, re-read the copy
//     and say whether it is genuinely ambiguous (must-fix) or the reader
//     misread unambiguous copy (reader error). Sent in batches sized from the
//     output cap (rereadBatchSize), one call per batch, so a long list of
//     complaints never needs one reply the cap cuts off. A failed batch does
//     not stop the later ones: their rows can still be verified.
//
// With no judge configured the run emits the readings side by side for a
// person to grade, and withholds `pass` (see grade.mjs).

import { extractJsonObject } from "panelist";
import { readAsset, fillTemplate } from "./assets.mjs";

const TEACHBACK_TEMPLATE = readAsset("prompts/judge-teachback.md");
const REREAD_TEMPLATE = readAsset("prompts/judge-reread.md");

/** Tools graded per teach-back judge call. */
export const TEACHBACK_BATCH_SIZE = 5;

/** The ground-truth tool names, split into the batches gradeTeachBack sends. */
export function teachBackBatches(truth, size = TEACHBACK_BATCH_SIZE) {
  const names = Object.keys(truth.tools);
  const out = [];
  for (let i = 0; i < names.length; i += size) out.push(names.slice(i, i + size));
  return out;
}

/** How much of a failed judge reply is kept: the first and last RAW_KEEP chars. */
export const RAW_KEEP = 2048;

export function clipRaw(text, keep = RAW_KEEP) {
  const s = String(text ?? "");
  if (s.length <= keep * 2) return s;
  return `${s.slice(0, keep)}\n\n[... ${s.length - keep * 2} chars omitted ...]\n\n${s.slice(-keep)}`;
}

/**
 * A judge call that produced no usable grades. `reason` is the short cause
 * used in row labels; `stopReason` is the provider's stop reason when it gave
 * one (`max_tokens` means the reply was cut off); `raw` is the clipped reply.
 */
export class JudgeError extends Error {
  constructor(model, reason, { stopReason = null, raw = null } = {}) {
    super(`judge ${model}: ${reason}`);
    this.reason = reason;
    this.stopReason = stopReason;
    this.raw = raw;
  }
}

/**
 * The payload text the judge is shown for one tool: its whole entry in the
 * tools/list payload (description, input schema, annotations). A detail the
 * reader read there is true even when the truth file's `meaning` leaves it out.
 */
export function payloadToolText(payload, tool) {
  const entry = payload?.tools?.find((t) => t && t.name === tool);
  return entry ? JSON.stringify(entry) : "";
}

/**
 * @param {object} truth
 * @param {object[]} teachBack
 * @param {string[]} [tools]  the tools to grade (default: every tool in truth)
 * @param {object} [payload]  the normalized payload ({tools, instructions?}); each
 *        item carries its tool's payload text, and the server instructions are
 *        shown once, so a true payload detail is not mistaken for drift
 */
export function buildTeachBackPrompt(truth, teachBack, tools = Object.keys(truth.tools), payload = null) {
  const items = tools.map((tool) => [tool, truth.tools[tool]]).map(([tool, t]) => ({
    tool,
    intended: t.meaning,
    payload: payloadToolText(payload, tool),
    reader: teachBack.find((x) => x.tool === tool)?.meaning ?? "",
  }));
  const instructions = typeof payload?.instructions === "string" && payload.instructions ? payload.instructions : "(none)";
  return fillTemplate(TEACHBACK_TEMPLATE, { instructions, items: JSON.stringify(items, null, 1) });
}

export function buildRereadPrompt(payload, complaints) {
  return fillTemplate(REREAD_TEMPLATE, {
    payload: JSON.stringify(payload),
    complaints: JSON.stringify(complaints, null, 1),
  });
}

async function ask(client, prompt, maxTokens) {
  const res = await client.complete({ prompt, maxTokens, temperature: 0, tools: [] });
  const stopReason = typeof res?.stopReason === "string" ? res.stopReason : null;
  if (!res || res.ok !== true || typeof res.text !== "string") {
    throw new JudgeError(client.model, res?.reason ?? "no usable text", { stopReason });
  }
  const obj = extractJsonObject(res.text);
  if (!obj) {
    const cut = stopReason === "max_tokens" ? " (cut off at the output cap)" : "";
    throw new JudgeError(client.model, `reply was not a JSON object${cut}`, { stopReason, raw: clipRaw(res.text) });
  }
  return obj;
}

/**
 * One call per batch of TEACHBACK_BATCH_SIZE tools. Any batch failing throws
 * its JudgeError: a partly graded teach-back is not a graded one.
 * @returns {Promise<Array<{tool, recovered: boolean, drift: string}>>}
 */
export async function gradeTeachBack(client, truth, teachBack, { maxTokens = 4096, batchSize = TEACHBACK_BATCH_SIZE, payload = null } = {}) {
  const out = [];
  for (const tools of teachBackBatches(truth, batchSize)) {
    const obj = await ask(client, buildTeachBackPrompt(truth, teachBack, tools, payload), maxTokens);
    const grades = Array.isArray(obj.grades) ? obj.grades : [];
    out.push(
      ...grades
        .filter((g) => g && typeof g.tool === "string" && typeof g.recovered === "boolean")
        .map((g) => ({ tool: g.tool, recovered: g.recovered, drift: typeof g.drift === "string" ? g.drift : "" })),
    );
  }
  return out;
}

/**
 * Output tokens budgeted per re-read row. A row in the prompt's format is
 * ~50-80 tokens; the margin covers a judge that writes long `why`s.
 */
export const REREAD_TOKENS_PER_ROW = 300;

/**
 * The smallest judge output cap a run accepts (`judgeMaxTokens`,
 * `--judge-max-tokens`): room for one re-read row. Below it even a single-row
 * re-read reply can be cut off, so every batch could fail and come back
 * unverified while each one is still paid for.
 */
export const MIN_JUDGE_MAX_TOKENS = REREAD_TOKENS_PER_ROW;

/** A value as JSON where it has a JSON form, else as String() (a BigInt, a circular object). */
function quote(v) {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    try {
      return String(v);
    } catch {
      return Object.prototype.toString.call(v);
    }
  }
}

/**
 * Why a judge output cap is refused, or null when it is usable. `shown` is how
 * the value is quoted (the CLI passes the raw flag text). A value that is not a
 * number is quoted with its type, so `"300"` (a string) does not read like the
 * valid number 300.
 */
export function judgeMaxTokensProblem(n, shown = n) {
  if (Number.isInteger(n) && n >= MIN_JUDGE_MAX_TOKENS) return null;
  const got = typeof n === "number" ? shown : `${quote(n)} (${n === null ? "null" : typeof n})`;
  return (
    `must be an integer of at least ${MIN_JUDGE_MAX_TOKENS}, got ${got}: the judge needs ${REREAD_TOKENS_PER_ROW} output tokens ` +
    `for one re-read row, and below that even a single-row reply can be cut off`
  );
}

/** Complaints per re-read call, so each reply fits under the output cap. */
export function rereadBatchSize(maxTokens) {
  return Math.max(1, Math.floor(maxTokens / REREAD_TOKENS_PER_ROW));
}

/** The complaints, split into the batches reread sends, in order. */
export function rereadBatches(complaints, size) {
  const out = [];
  for (let i = 0; i < complaints.length; i += size) out.push(complaints.slice(i, i + size));
  return out;
}

/**
 * One call per batch. Rows the judge did not return a verdict for are simply
 * absent from the Map; the caller counts them as unverified.
 *
 * @param {object} [opts]
 *   @param {number} [opts.maxTokens=2048]
 *   @param {number} [opts.batchSize]  default rereadBatchSize(maxTokens)
 *   @param {function} [opts.beforeBatch]  ({prompt, batch}) -> null to send, or a
 *          reason string to stop before sending this batch (and every later one)
 *   @param {function} [opts.onBatchError] (err, batch, index, total) -> void. When given, a failed
 *          batch is reported here and the next batch is still sent; without it
 *          the first failure throws.
 *   @param {function} [opts.onStop]  (reason, rows) -> void, with every row not sent
 * @returns {Promise<Map<string, {ambiguous: boolean, why: string}>>}
 */
export async function reread(client, payload, complaints, { maxTokens = 2048, batchSize = rereadBatchSize(maxTokens), beforeBatch, onBatchError, onStop } = {}) {
  const out = new Map();
  const batches = rereadBatches(complaints, batchSize);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const prompt = buildRereadPrompt(payload, batch);
    const stop = beforeBatch ? beforeBatch({ prompt, batch }) : null;
    if (stop) {
      onStop?.(stop, batches.slice(i).flat());
      break;
    }
    let obj;
    try {
      obj = await ask(client, prompt, maxTokens);
    } catch (err) {
      if (!onBatchError) throw err;
      onBatchError(err, batch, i, batches.length);
      continue;
    }
    const wanted = new Set(batch.map((c) => c.id));
    for (const r of Array.isArray(obj.rereads) ? obj.rereads : []) {
      if (r && typeof r.id === "string" && wanted.has(r.id) && typeof r.ambiguous === "boolean") {
        out.set(r.id, { ambiguous: r.ambiguous, why: typeof r.why === "string" ? r.why : "" });
      }
    }
  }
  return out;
}
