// inputs.mjs — load and validate the three author inputs: the tools/list
// payload, the ground-truth file, and the routing requests.
//
// The reader-facing view of the requests (readerRequests) carries ONLY the id
// and the request text. Expected tools, near-miss partners and any other
// author field stay on the grading side; the sentinel test pins this.

export const NO_TOOL = "none";

/**
 * Accept a bare tools array, `{ tools: [...] }`, or a JSON-RPC response
 * `{ result: { tools: [...] } }`. Returns `{ tools }` with the tools verbatim.
 */
export function normalizePayload(raw) {
  let tools = null;
  if (Array.isArray(raw)) tools = raw;
  else if (raw && Array.isArray(raw.tools)) tools = raw.tools;
  else if (raw && raw.result && Array.isArray(raw.result.tools)) tools = raw.result.tools;
  if (!tools || tools.length === 0) {
    throw new Error("tools payload: expected a non-empty tools array (bare, under `tools`, or under `result.tools`)");
  }
  for (const t of tools) {
    if (!t || typeof t.name !== "string" || !t.name) {
      throw new Error("tools payload: every tool needs a string `name`");
    }
  }
  return { tools };
}

export function toolNames(payload) {
  return payload.tools.map((t) => t.name);
}

/**
 * Parse the ground-truth markdown.
 *
 * Format: one `## <tool_name>` heading per tool. Everything under it, up to
 * the next `## ` heading, is the author's intended meaning. Lines starting
 * `- Misreading:` are collected separately as feared misreadings. Text before
 * the first `## ` heading is a preamble and is ignored.
 *
 * @returns {{ tools: Record<string, {meaning: string, misreadings: string[]}> }}
 */
export function parseTruth(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("truth: the ground-truth file is empty");
  }
  const tools = {};
  let current = null;
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^##\s+`?([^`\s]+)`?\s*$/);
    if (h) {
      current = h[1];
      if (tools[current]) throw new Error(`truth: tool ${current} appears twice`);
      tools[current] = { meaning: "", misreadings: [] };
      continue;
    }
    if (!current) continue;
    const m = line.match(/^\s*-\s*Misreading:\s*(.+)$/i);
    if (m) tools[current].misreadings.push(m[1].trim());
    else tools[current].meaning += line + "\n";
  }
  for (const t of Object.values(tools)) t.meaning = t.meaning.trim();
  if (Object.keys(tools).length === 0) {
    throw new Error("truth: no `## <tool_name>` sections found");
  }
  return { tools };
}

/** Every tool in the payload must have ground truth, and vice versa. */
export function checkTruthCoverage(truth, payload) {
  const names = new Set(toolNames(payload));
  const missing = [...names].filter((n) => !truth.tools[n]);
  const extra = Object.keys(truth.tools).filter((n) => !names.has(n));
  const problems = [];
  if (missing.length) problems.push(`no ground truth for: ${missing.join(", ")}`);
  if (extra.length) problems.push(`ground truth names tools not in the payload: ${extra.join(", ")}`);
  if (problems.length) throw new Error(`truth: ${problems.join("; ")}`);
}

/**
 * Validate routing requests: `[{ id, request, expected, nearMiss? }]` or
 * `{ requests: [...] }`. `expected` is a tool name or "none".
 */
export function normalizeRequests(raw, payload) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.requests) ? raw.requests : null;
  if (!list || list.length === 0) throw new Error("requests: expected a non-empty array");
  const names = new Set(toolNames(payload));
  const seen = new Set();
  for (const r of list) {
    if (!r || typeof r.id !== "string" || !r.id) throw new Error("requests: every request needs a string `id`");
    if (seen.has(r.id)) throw new Error(`requests: duplicate id ${r.id}`);
    seen.add(r.id);
    if (typeof r.request !== "string" || !r.request.trim()) throw new Error(`requests: ${r.id} has no request text`);
    if (r.expected !== NO_TOOL && !names.has(r.expected)) {
      throw new Error(`requests: ${r.id} expects ${JSON.stringify(r.expected)}, which is not a tool in the payload (or "none")`);
    }
    if (r.nearMiss != null && !names.has(r.nearMiss)) {
      throw new Error(`requests: ${r.id} names nearMiss ${JSON.stringify(r.nearMiss)}, which is not a tool in the payload`);
    }
  }
  return list;
}

/** The ONLY view of the requests a reader ever sees. */
export function readerRequests(requests) {
  return requests.map((r) => ({ id: r.id, request: r.request }));
}
