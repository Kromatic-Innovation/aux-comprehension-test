// judge.mjs — the optional injected judge.
//
// Two jobs, both one call per invocation:
//   gradeTeachBack: compare one reader's teach-back with the intended
//     meaning. The judge never sees which model or persona wrote it.
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

export function buildTeachBackPrompt(truth, teachBack) {
  const items = Object.entries(truth.tools).map(([tool, t]) => ({
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
  if (!res || res.ok !== true || typeof res.text !== "string") {
    throw new Error(`judge ${client.model}: ${res?.reason ?? "no usable text"}`);
  }
  const obj = extractJsonObject(res.text);
  if (!obj) throw new Error(`judge ${client.model}: reply was not a JSON object`);
  return obj;
}

/** @returns {Promise<Array<{tool, recovered: boolean, drift: string}>>} */
export async function gradeTeachBack(client, truth, teachBack, { maxTokens = 4096 } = {}) {
  const obj = await ask(client, buildTeachBackPrompt(truth, teachBack), maxTokens);
  const grades = Array.isArray(obj.grades) ? obj.grades : [];
  return grades
    .filter((g) => g && typeof g.tool === "string" && typeof g.recovered === "boolean")
    .map((g) => ({ tool: g.tool, recovered: g.recovered, drift: typeof g.drift === "string" ? g.drift : "" }));
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
