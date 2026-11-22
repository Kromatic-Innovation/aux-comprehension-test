// render.mjs — verdict.md. Leads with the verdict and the cut-list, never a score.

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const clip = (s, n = 240) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Readers + teach-back are an upper bound; the re-read is priced for an
// assumed row count, so it is an estimate only (see run.mjs).
function estimateDetail(est) {
  const p = est?.parts;
  if (!p) return "";
  if (!p.reread) return " (readers, upper bound)";
  return ` (readers + teach-back ≤ $${p.bounded.usd.toFixed(4)}; re-read estimated at $${p.reread.usd.toFixed(4)} for ${p.reread.rowsAssumed} rows)`;
}

function rereadRowsLine(r) {
  if (!r) return [];
  const base = `- re-read rows: ${r.rows} to re-read, ${r.rowsSent} sent, ${r.rowsAssumed} assumed by the estimate`;
  return [r.overAssumed ? `${base} — more than the estimate assumed, so its re-read part understated the spend (--max-usd still held)` : base];
}

export function renderVerdictMd(result) {
  const g = result.grade;
  const L = [
    `# Comprehension test verdict: ${g.verdict.toUpperCase()}`,
    "",
    `- crossModel: **${g.crossModel}** (providers: ${g.providers.join(", ") || "none"})`,
    `- readers answered: ${result.readers.filter((r) => r.status === "ok").length}; failed: ${result.readers.filter((r) => r.status === "error").length}; skipped: ${result.skipped.length}`,
    `- judge: ${result.judge.model ?? `none${result.judge.skipped ? ` (${result.judge.skipped})` : ""}`}`,
    `- rows: ${g.counts.structural} structural, ${g.counts.mustFix} must-fix, ${g.counts.readerError} reader-error, ${g.counts.informational} informational`,
    `- spend: estimate $${result.cost.estimate.usd.toFixed(4)}${estimateDetail(result.cost.estimate)}, actual $${result.cost.actual.usd.toFixed(4)}${result.cost.actual.approximate ? " (partly approximate)" : ""}${result.cost.actual.retries ? ` including ${result.cost.actual.retries} retried attempt(s)` : ""}, ceiling $${result.cost.maxUsd}`,
    ...rereadRowsLine(result.cost.reread),
    "",
  ];
  if (g.withheldPass.length) {
    L.push("## Why not pass", "");
    for (const w of g.withheldPass) L.push(`- ${w}`);
    if (g.counts.mustFix) L.push(`- ${g.counts.mustFix} must-fix row(s) below`);
    if (g.counts.structural) L.push(`- ${g.counts.structural} structural row(s) below`);
    L.push("");
  }
  if (result.judge.failures?.length) {
    L.push("## Judge failures", "");
    for (const f of result.judge.failures) {
      L.push(`- ${f.purpose}: ${f.reason} (stop reason: ${f.stopReason ?? "unknown"})${f.file ? `; raw reply kept in ${f.file}` : ""}`);
    }
    L.push("");
  }
  if (result.skipped.length) {
    L.push("## Skipped readers", "");
    for (const s of result.skipped) L.push(`- ${s.personaId} × ${s.model}: ${s.reason}`);
    L.push("");
  }
  L.push("## Cut-list", "", "| Class | Tool(s) | Defect | Tripped by (persona × model) | Evidence |", "|---|---|---|---|---|");
  if (g.cutList.length === 0) L.push("| — | — | No rows. | — | — |");
  for (const row of g.cutList) {
    const who = row.trippedBy.length ? row.trippedBy.map((t) => `${t.personaId} × ${t.model}`).join("; ") : "measurement";
    const ev = row.trippedBy.length ? row.trippedBy.map((t) => `"${clip(esc(t.evidence))}"`).join("; ") : "see token-weight.md";
    const rr = row.reread && typeof row.reread === "object" ? ` Re-read: ${row.reread.ambiguous ? "ambiguous" : "unambiguous"} — ${esc(row.reread.why)}` : row.reread ? ` Re-read: ${row.reread}.` : "";
    const mr = row.misreadings?.length ? ` Misread by: ${row.misreadings.map((m) => `${m.personaId} × ${m.model} (${m.kind}: ${clip(esc(m.evidence), 120)})`).join("; ")}.` : "";
    const cls = row.consider ? `${row.class} (consider)` : row.class;
    L.push(`| ${cls} | ${esc(row.tools.join(", "))} | ${esc(row.defect)}${mr}${rr} | ${esc(who)} | ${ev} |`);
  }
  L.push("", "## Honesty caveat", "");
  for (const h of result.honesty) L.push(`> ${h}`, ">");
  L.pop();
  L.push("");
  return L.join("\n");
}
