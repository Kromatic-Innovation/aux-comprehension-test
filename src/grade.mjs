// grade.mjs — turn reader outputs into a cut-list and a verdict.
//
// No averaged score and no pass-rate. Every row names the tool(s), the
// defect, each persona × model that tripped it, and that reader's own words
// as evidence.
//
// A *misreading* is evidence that a reader actually got a tool wrong: a
// routing miss (on the expected tool, and on a tool wrongly picked), or
// teach-back drift the judge confirmed against the ground truth. A confusion
// report on its own is reported unease, not a misreading.
//
// Row classes:
//   must-fix       tripped by two or more distinct readers, or by one reader
//                  where the judge's re-read found the copy ambiguous. A
//                  confusion cluster qualifies only when its tool also has at
//                  least one misreading (from any reader).
//   reader-error   tripped by exactly one reader, copy unambiguous on re-read
//                  (or not re-read: no judge, or the judge failed -- the row
//                  says which). Not a must-fix.
//   structural     a tool whose purpose no reader recovered. Yields `fail`.
//   informational  length-only complaints, token-weight flags, and
//                  confusion-only clusters (no misreading of that tool),
//                  however many readers raised them. Never moves the verdict.
//                  A confusion-only row the judge's re-read found ambiguous
//                  carries `consider: true`: worth a look, still not a gate.
//
// Verdict:
//   fail         any structural row.
//   conditional  must-fix rows exist (each a copy edit), or `pass` is
//                withheld (single-provider panel, fewer than two readers, or
//                teach-back not graded because no judge was configured).
//   pass         no must-fix rows, crossModel, two or more readers, graded.

import { NO_TOOL } from "./inputs.mjs";

const LENGTH_RE =
  /\b(too long|overly long|very long|too verbose|verbose|lengthy|wordy|bloat(ed)?|too many tokens|too much text|long (tool )?(list|descriptions?|schemas?))\b/i;
const NON_LENGTH_KINDS = new Set(["ambiguous", "missing", "misleading", "jargon"]);

/** A complaint about length and nothing else. */
export function isLengthOnly(item) {
  if (item.kind === "length") return true;
  if (NON_LENGTH_KINDS.has(item.kind)) return false;
  return LENGTH_RE.test(item.issue);
}

/** Length complaints count as defects only with benchmark evidence on BOTH counts. */
export function lengthPromoted(benchmark) {
  return Boolean(benchmark && benchmark.materiallyLonger === true && benchmark.correlatesWithLowerSelection === true);
}

const readerKey = (r) => `${r.personaId}__${r.model}`;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9_.*]+/g, " ").trim();

function add(clusters, key, base, trip) {
  if (!clusters.has(key)) clusters.set(key, { id: key, ...base, trippedBy: [] });
  const c = clusters.get(key);
  if (!c.trippedBy.some((t) => t.reader === trip.reader)) c.trippedBy.push(trip);
}

/**
 * Collect every trip into clusters keyed by defect.
 * @param {object} args
 * @param {object[]} args.readers  successful readers ({personaId, model, provider, response})
 * @param {object[]} args.requests
 * @param {object} args.truth
 * @param {Map<string, object[]>|null} args.teachBackGrades  reader key -> judge grades
 * @param {object|null} args.lengthBenchmark
 */
export function buildClusters({ readers, requests, truth, teachBackGrades, lengthBenchmark }) {
  const clusters = new Map();
  const promoteLength = lengthPromoted(lengthBenchmark);
  // tool -> misreadings of it, from any reader (see the header).
  const misread = new Map();
  const misreadOf = (tool, entry) => {
    if (!tool || tool === NO_TOOL || !truth.tools[tool]) return;
    if (!misread.has(tool)) misread.set(tool, []);
    misread.get(tool).push(entry);
  };

  for (const r of readers) {
    const who = { reader: readerKey(r), personaId: r.personaId, model: r.model, provider: r.provider };
    const { teachBack, routing, confusion } = r.response;

    // Routing: graded mechanically against the expected tool. A pick the
    // author listed in also_acceptable is correct too: no row, no near-miss.
    for (const req of requests) {
      const pick = routing.find((x) => x.requestId === req.id)?.tool ?? null;
      if (pick === req.expected) continue;
      if (pick != null && Array.isArray(req.also_acceptable) && req.also_acceptable.includes(pick)) continue;
      const nearMissHit = req.nearMiss && pick === req.nearMiss;
      const tools = [req.expected === NO_TOOL ? null : req.expected, nearMissHit ? req.nearMiss : null].filter(Boolean);
      const miss = { ...who, kind: "routing", evidence: `${req.id}: picked ${pick ?? "(nothing)"}, expected ${req.expected}` };
      misreadOf(req.expected, miss);
      misreadOf(pick, miss);
      add(
        clusters,
        `routing:${req.id}`,
        {
          kind: "routing",
          tools: tools.length ? tools : [pick ?? NO_TOOL],
          defect: nearMissHit
            ? `Near-miss pair: "${req.request}" routed to ${req.nearMiss} instead of ${req.expected}.`
            : `"${req.request}" is not routed to ${req.expected}.`,
        },
        { ...who, evidence: pick == null ? "(no pick given)" : `picked ${pick}` },
      );
    }

    // Confusion reports.
    for (const c of confusion) {
      if (isLengthOnly(c) && !promoteLength) {
        add(
          clusters,
          `length:${norm(c.tool)}`,
          { kind: "length", tools: [c.tool], defect: "Length-only complaint (informational by rule; no competitor benchmark supplied).", informational: true },
          { ...who, evidence: c.issue },
        );
        continue;
      }
      const key = `confusion:${norm(c.tool)}:${norm(c.about)}`;
      add(clusters, key, { kind: "confusion", tools: [c.tool], about: c.about, defect: `Confusing copy: ${c.tool} / ${c.about}.` }, { ...who, evidence: c.issue });
      // A benchmark-promoted length complaint is backed by outside evidence of
      // lower selection, so a cluster holding one (from any reader, in any
      // order) is not "confusion only".
      if (isLengthOnly(c)) clusters.get(key).lengthPromoted = true;
    }

    // Teach-back: a missing explanation is mechanical; drift needs the judge.
    const grades = teachBackGrades?.get(readerKey(r)) ?? null;
    for (const tool of Object.keys(truth.tools)) {
      const tb = teachBack.find((x) => x.tool === tool);
      if (!tb || !tb.meaning.trim()) {
        add(clusters, `teachback:${tool}`, { kind: "teachback", tools: [tool], defect: `Readers did not recover what ${tool} is for.` }, { ...who, evidence: "(no teach-back given)" });
        continue;
      }
      const g = grades?.find((x) => x.tool === tool);
      if (g && g.recovered === false) {
        misreadOf(tool, { ...who, kind: "teachback", evidence: g.drift || "judge: purpose not recovered" });
        add(
          clusters,
          `teachback:${tool}`,
          { kind: "teachback", tools: [tool], defect: `Readers did not recover what ${tool} is for.` },
          { ...who, evidence: tb.meaning, drift: g.drift },
        );
      }
    }
  }
  for (const c of clusters.values()) {
    if (c.kind === "confusion") c.misreadings = misread.get(c.tools[0]) ?? [];
  }
  return clusters;
}

/** Clusters that a judge should re-read: tripped by exactly one reader. */
export function rereadCandidates(clusters) {
  return [...clusters.values()]
    .filter((c) => !c.informational && c.trippedBy.length === 1)
    .map((c) => ({ id: c.id, tools: c.tools, about: c.about ?? null, complaint: c.trippedBy[0].evidence, defect: c.defect }));
}

/**
 * Classify clusters, attach token-weight flags, and decide the verdict.
 * @param {object} args
 * @param {Map} args.clusters
 * @param {object[]} args.readers       successful readers
 * @param {Map|null} args.rereads       cluster id -> {ambiguous, why}; null when no judge
 * @param {boolean} args.teachBackGraded
 * @param {object|null} args.tokenWeight
 * @param {{teachBack: string|null, reread: string|null}|null} [args.judgeFailure]
 *        null when no judge was configured; otherwise the failure reason (or
 *        null) for each judge job, so an errored judge is never labelled "no judge"
 */
export function decide({ clusters, readers, rereads, teachBackGraded, tokenWeight, judgeFailure = null }) {
  const unverified = judgeFailure?.reread
    ? `unverified (judge failed: ${judgeFailure.reread})`
    : rereads
      ? "unverified (judge returned no re-read for this row)"
      : "unverified (no judge)";
  const rows = [];
  const nReaders = readers.length;
  for (const c of clusters.values()) {
    const distinct = c.trippedBy.length;
    // A confusion cluster with no misreading of its tool. Clusters built by
    // hand without `misreadings` are confusion-only too.
    const confusionOnly = c.kind === "confusion" && !c.lengthPromoted && !(c.misreadings?.length > 0);
    let cls;
    let reread = null;
    let consider = false;
    if (c.informational) cls = "informational";
    else if (c.kind === "teachback" && nReaders >= 2 && distinct === nReaders) cls = "structural";
    else if (distinct >= 2) cls = confusionOnly ? "informational" : "must-fix";
    else {
      const rr = rereads?.get(c.id) ?? null;
      reread = rr ? { ambiguous: rr.ambiguous, why: rr.why } : unverified;
      if (!(rr && rr.ambiguous)) cls = "reader-error";
      else if (confusionOnly) {
        cls = "informational";
        consider = true;
      } else cls = "must-fix";
    }
    const { informational, misreadings, lengthPromoted: _promoted, ...rest } = c;
    const defect = confusionOnly && cls === "informational" ? `${c.defect} Confusion only: no reader misrouted or misexplained ${c.tools[0]}.` : c.defect;
    rows.push({
      ...rest,
      defect,
      class: cls,
      ...(misreadings?.length ? { misreadings } : {}),
      ...(consider ? { consider } : {}),
      ...(reread ? { reread } : {}),
    });
  }
  for (const f of tokenWeight?.flags ?? []) {
    rows.push({ id: `token-weight:${f.kind}:${f.tools.join(",")}`, kind: "token-weight", tools: f.tools, defect: f.detail, class: "informational", trippedBy: [] });
  }

  const providers = [...new Set(readers.map((r) => r.provider))];
  const crossModel = providers.length >= 2;
  const count = (cls) => rows.filter((r) => r.class === cls).length;
  const withheld = [];
  if (nReaders < 2) withheld.push("fewer than two readers answered; one reader is never a run");
  if (!crossModel) withheld.push(`single-provider panel (${providers.join(", ") || "none"}); crossModel is required for pass`);
  if (!teachBackGraded) {
    withheld.push(
      judgeFailure?.teachBack
        ? `teach-back drift not graded (judge failed: ${judgeFailure.teachBack}); pass requires a graded teach-back, so see judge/ and grade readers/ side by side`
        : judgeFailure
          ? // A judge was configured and did not fail: nothing reached it (no reader answered).
            "teach-back drift not graded (no reader answer to grade); pass requires a graded teach-back"
          : "teach-back drift not graded (no --judge); pass requires a judge, so grade readers/ side by side",
    );
  }

  let verdict;
  if (count("structural") > 0) verdict = "fail";
  else if (count("must-fix") > 0) verdict = "conditional";
  else verdict = withheld.length ? "conditional" : "pass";

  const order = { structural: 0, "must-fix": 1, "reader-error": 2, informational: 3 };
  rows.sort((a, b) => order[a.class] - order[b.class] || a.id.localeCompare(b.id));

  return {
    verdict,
    crossModel,
    providers,
    withheldPass: verdict === "pass" ? [] : withheld,
    counts: { structural: count("structural"), mustFix: count("must-fix"), readerError: count("reader-error"), informational: count("informational") },
    cutList: rows,
  };
}
