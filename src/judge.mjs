// judge.mjs — the optional injected judge.
//
// Two jobs:
//   gradeTeachBack: compare one reader's teach-back with the intended
//     meaning. The judge never sees which model or persona wrote it. Graded
//     in batches of TEACHBACK_BATCH_SIZE tools, one call per batch, so a large
//     payload never needs one huge reply that the output cap cuts off.
//   reread: for complaints raised by exactly one reader, re-read the copy
//     and say whether it is genuinely ambiguous (must-fix) or the reader
//     misread unambiguous copy (reader error).
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
 * @param {object} truth
 * @param {object[]} teachBack
 * @param {string[]} [tools]  the tools to grade (default: every tool in truth)
 */
export function buildTeachBackPrompt(truth, teachBack, tools = Object.keys(truth.tools)) {
  const items = tools.map((tool) => [tool, truth.tools[tool]]).map(([tool, t]) => ({
    tool,
    intended: t.meaning,
    reader: teachBack.find((x) => x.tool === tool)?.meaning ?? "",
  }));
  return fillTemplate(TEACHBACK_TEMPLATE, { items: JSON.stringify(items, null, 1) });
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
export async function gradeTeachBack(client, truth, teachBack, { maxTokens = 4096, batchSize = TEACHBACK_BATCH_SIZE } = {}) {
  const out = [];
  for (const tools of teachBackBatches(truth, batchSize)) {
    const obj = await ask(client, buildTeachBackPrompt(truth, teachBack, tools), maxTokens);
    const grades = Array.isArray(obj.grades) ? obj.grades : [];
    out.push(
      ...grades
        .filter((g) => g && typeof g.tool === "string" && typeof g.recovered === "boolean")
        .map((g) => ({ tool: g.tool, recovered: g.recovered, drift: typeof g.drift === "string" ? g.drift : "" })),
    );
  }
  return out;
}

/** @returns {Promise<Map<string, {ambiguous: boolean, why: string}>>} */
export async function reread(client, payload, complaints, { maxTokens = 2048 } = {}) {
  const out = new Map();
  if (complaints.length === 0) return out;
  const obj = await ask(client, buildRereadPrompt(payload, complaints), maxTokens);
  for (const r of Array.isArray(obj.rereads) ? obj.rereads : []) {
    if (r && typeof r.id === "string" && typeof r.ambiguous === "boolean") {
      out.set(r.id, { ambiguous: r.ambiguous, why: typeof r.why === "string" ? r.why : "" });
    }
  }
  return out;
}
