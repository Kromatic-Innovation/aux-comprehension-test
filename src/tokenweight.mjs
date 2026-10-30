// tokenweight.mjs — the tools/list token-weight report.
//
// INFORMATIONAL / BENCHMARK INPUT ONLY. Nothing here can move the verdict:
// its flags become informational cut-list rows. Length is promoted to a
// defect only by an explicit competitor benchmark (see grade.mjs), never by
// a byte count on its own.
//
// Tokens are approximated as ceil(chars / 4) unless a `countTokens(text)`
// function is supplied (for example a provider token-count endpoint). No
// tokenizer dependency.

import { createHash } from "node:crypto";

/** A tool whose own share of the payload is above this is flagged as dominant. */
export const DOMINANT_SHARE = 0.5;
/** A sub-schema repeated in at least this many tools... */
export const REPEAT_MIN_TOOLS = 3;
/** ...whose repeats together exceed this share of the payload is flagged. */
export const REPEAT_MIN_SHARE = 0.1;

const bytes = (v) => (v == null ? 0 : Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v)));
const approx = (n) => Math.ceil(n / 4);

function collectDefs(schema, into) {
  if (!schema || typeof schema !== "object") return;
  for (const key of ["$defs", "definitions"]) {
    const defs = schema[key];
    if (defs && typeof defs === "object") {
      for (const [name, def] of Object.entries(defs)) into.push({ name, def });
    }
  }
}

/**
 * @param {{tools: object[]}} payload
 * @param {{countTokens?: (text: string) => Promise<number>}} [opts]
 */
export async function measureTokenWeight(payload, { countTokens } = {}) {
  const method = countTokens ? "provider token count" : "approximate (chars / 4)";
  const tok = async (text, b) => (countTokens ? countTokens(text) : approx(b));
  const payloadJson = JSON.stringify(payload);
  const totalBytes = bytes(payloadJson);

  const tools = [];
  const defUses = new Map(); // name#hash -> { name, bytes, tools: Set }
  for (const t of payload.tools) {
    const parts = {
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? null,
      outputSchema: t.outputSchema ?? null,
    };
    const row = { tool: t.name, bytes: bytes(t), tokens: 0, parts: {} };
    for (const [k, v] of Object.entries(parts)) {
      const b = bytes(v);
      row.parts[k] = { bytes: b, tokens: v == null ? 0 : await tok(typeof v === "string" ? v : JSON.stringify(v), b) };
    }
    row.tokens = await tok(JSON.stringify(t), row.bytes);
    row.share = totalBytes ? row.bytes / totalBytes : 0;
    tools.push(row);

    const defs = [];
    collectDefs(t.inputSchema, defs);
    collectDefs(t.outputSchema, defs);
    for (const { name, def } of defs) {
      const json = JSON.stringify(def);
      const key = `${name}#${createHash("sha256").update(json).digest("hex").slice(0, 12)}`;
      if (!defUses.has(key)) defUses.set(key, { name, bytes: bytes(json), tools: new Set() });
      defUses.get(key).tools.add(t.name);
    }
  }

  const flags = [];
  if (tools.length >= 3) {
    for (const r of tools) {
      if (r.share > DOMINANT_SHARE) {
        flags.push({
          kind: "dominant-tool",
          tools: [r.tool],
          detail: `${r.tool} is ${(r.share * 100).toFixed(0)}% of the payload (${r.bytes} of ${totalBytes} bytes).`,
        });
      }
    }
  }
  for (const u of defUses.values()) {
    const repeated = u.bytes * u.tools.size;
    if (u.tools.size >= REPEAT_MIN_TOOLS && repeated / totalBytes > REPEAT_MIN_SHARE) {
      flags.push({
        kind: "repeated-subschema",
        tools: [...u.tools],
        detail:
          `Sub-schema ${u.name} (${u.bytes} bytes) is repeated in ${u.tools.size} tools: ` +
          `${repeated} bytes, ${((repeated / totalBytes) * 100).toFixed(0)}% of the payload.`,
      });
    }
  }

  return {
    label: "informational / benchmark input — never a verdict input on its own",
    method,
    total: { bytes: totalBytes, tokens: await tok(payloadJson, totalBytes) },
    tools,
    flags,
  };
}

export function renderTokenWeightMd(report) {
  const lines = [
    "# tools/list token weight",
    "",
    `**${report.label}.** Over-length alone never yields \`fail\` or a must-fix row; it is input to a benchmark against comparable tools.`,
    "",
    `Token method: ${report.method}.`,
    "",
    `Whole payload: ${report.total.bytes} bytes, ~${report.total.tokens} tokens, ${report.tools.length} tools.`,
    "",
    "| Tool | Bytes | ~Tokens | Share | Description (B / ~tok) | Input schema (B / ~tok) | Output schema (B / ~tok) |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of report.tools) {
    const p = (k) => `${r.parts[k].bytes} / ${r.parts[k].tokens}`;
    lines.push(
      `| ${r.tool} | ${r.bytes} | ${r.tokens} | ${(r.share * 100).toFixed(1)}% | ${p("description")} | ${p("inputSchema")} | ${p("outputSchema")} |`,
    );
  }
  lines.push("", "## Informational flags", "");
  if (report.flags.length === 0) lines.push("None.");
  for (const f of report.flags) lines.push(`- **${f.kind}**: ${f.detail}`);
  lines.push("");
  return lines.join("\n");
}
