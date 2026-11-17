// Direct tests for the exported grading helpers: decide, buildClusters,
// gradeTeachBack, lengthPromoted, rereadCandidates. They are unstable
// internals (the `./internal` subpath), but they are exported, so each is
// exercised here on its own rather than only through run().

import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, buildClusters, gradeTeachBack, lengthPromoted, rereadCandidates, NO_TOOL } from "aux-comprehension-test/internal";

const truth = { tools: { alpha: { meaning: "Alpha does a." }, beta: { meaning: "Beta does b." } } };
const requests = [
  { id: "q1", request: "do a", expected: "alpha" },
  { id: "q2", request: "do b", expected: "beta", nearMiss: "alpha" },
  { id: "q3", request: "do nothing", expected: NO_TOOL },
];
const clean = { teachBack: [{ tool: "alpha", meaning: "does a" }, { tool: "beta", meaning: "does b" }], routing: [{ requestId: "q1", tool: "alpha" }, { requestId: "q2", tool: "beta" }, { requestId: "q3", tool: NO_TOOL }], confusion: [] };
const reader = (personaId, provider, response = clean) => ({ personaId, model: `${provider}-m`, provider, response });

// --- lengthPromoted ---------------------------------------------------------

test("lengthPromoted needs benchmark evidence on both counts", () => {
  assert.equal(lengthPromoted(null), false);
  assert.equal(lengthPromoted(undefined), false);
  assert.equal(lengthPromoted({ materiallyLonger: true }), false);
  assert.equal(lengthPromoted({ correlatesWithLowerSelection: true }), false);
  assert.equal(lengthPromoted({ materiallyLonger: true, correlatesWithLowerSelection: false }), false);
  assert.equal(lengthPromoted({ materiallyLonger: "yes", correlatesWithLowerSelection: true }), false);
  assert.equal(lengthPromoted({ materiallyLonger: true, correlatesWithLowerSelection: true }), true);
});

// --- buildClusters ----------------------------------------------------------

test("buildClusters: a clean reader trips nothing", () => {
  const clusters = buildClusters({ readers: [reader("p1", "anthropic")], requests, truth, teachBackGrades: null, lengthBenchmark: null });
  assert.equal(clusters.size, 0);
});

test("buildClusters: misrouting, near-miss, missing teach-back and confusion each cluster, deduped per reader", () => {
  const messy = {
    teachBack: [{ tool: "alpha", meaning: "does a" }],
    routing: [{ requestId: "q1", tool: "beta" }, { requestId: "q2", tool: "alpha" }],
    confusion: [
      { tool: "alpha", about: "description", issue: "unclear scope", kind: "ambiguous" },
      { tool: "alpha", about: "description", issue: "still unclear", kind: "ambiguous" },
    ],
  };
  const r1 = reader("p1", "anthropic", messy);
  const r2 = reader("p2", "openai", messy);
  const clusters = buildClusters({ readers: [r1, r2], requests, truth, teachBackGrades: null, lengthBenchmark: null });
  assert.deepEqual([...clusters.keys()].sort(), ["confusion:alpha:description", "routing:q1", "routing:q2", "routing:q3", "teachback:beta"]);

  assert.match(clusters.get("routing:q2").defect, /Near-miss pair/);
  assert.deepEqual(clusters.get("routing:q2").tools, ["beta", "alpha"]);
  assert.equal(clusters.get("routing:q3").trippedBy[0].evidence, "(no pick given)");
  assert.deepEqual(clusters.get("routing:q3").tools, [NO_TOOL]);
  assert.equal(clusters.get("teachback:beta").trippedBy[0].evidence, "(no teach-back given)");
  // Two complaints from one reader about the same field count once per reader.
  const conf = clusters.get("confusion:alpha:description");
  assert.deepEqual(conf.trippedBy.map((t) => t.reader), ["p1__anthropic-m", "p2__openai-m"]);
  assert.equal(conf.trippedBy[0].evidence, "unclear scope");
});

test("buildClusters: length-only complaints stay informational unless the benchmark promotes them", () => {
  const r = reader("p1", "anthropic", { ...clean, confusion: [{ tool: "beta", about: "description", issue: "this is too long", kind: "other" }] });
  const plain = buildClusters({ readers: [r], requests, truth, teachBackGrades: null, lengthBenchmark: null });
  assert.equal(plain.get("length:beta").informational, true);
  const promoted = buildClusters({ readers: [r], requests, truth, teachBackGrades: null, lengthBenchmark: { materiallyLonger: true, correlatesWithLowerSelection: true } });
  assert.equal(promoted.has("length:beta"), false);
  assert.ok(promoted.has("confusion:beta:description"));
});

test("buildClusters: judge drift trips a teach-back cluster with the drift attached", () => {
  const r = reader("p1", "anthropic");
  const grades = new Map([["p1__anthropic-m", [{ tool: "alpha", recovered: false, drift: "confused with beta" }, { tool: "beta", recovered: true, drift: "" }]]]);
  const clusters = buildClusters({ readers: [r], requests, truth, teachBackGrades: grades, lengthBenchmark: null });
  assert.deepEqual([...clusters.keys()], ["teachback:alpha"]);
  assert.equal(clusters.get("teachback:alpha").trippedBy[0].drift, "confused with beta");
});

// --- rereadCandidates -------------------------------------------------------

test("rereadCandidates: single-reader, non-informational clusters only", () => {
  const clusters = new Map([
    ["confusion:a:x", { id: "confusion:a:x", tools: ["a"], about: "x", defect: "d1", trippedBy: [{ reader: "r1", evidence: "e1" }] }],
    ["routing:q1", { id: "routing:q1", tools: ["a"], defect: "d2", trippedBy: [{ reader: "r1", evidence: "e2" }, { reader: "r2", evidence: "e3" }] }],
    ["length:a", { id: "length:a", tools: ["a"], defect: "d3", informational: true, trippedBy: [{ reader: "r1", evidence: "e4" }] }],
    ["teachback:b", { id: "teachback:b", tools: ["b"], defect: "d4", trippedBy: [{ reader: "r2", evidence: "e5" }] }],
  ]);
  assert.deepEqual(rereadCandidates(clusters), [
    { id: "confusion:a:x", tools: ["a"], about: "x", complaint: "e1", defect: "d1" },
    { id: "teachback:b", tools: ["b"], about: null, complaint: "e5", defect: "d4" },
  ]);
  assert.deepEqual(rereadCandidates(new Map()), []);
});

// --- decide -----------------------------------------------------------------

const two = [reader("p1", "anthropic"), reader("p2", "openai")];
const cluster = (id, kind, trippedBy, extra = {}) => [id, { id, kind, tools: ["alpha"], defect: id, trippedBy: trippedBy.map((reader) => ({ reader, evidence: "e" })), ...extra }];

test("decide: no rows, cross-model, two readers, graded -> pass", () => {
  const g = decide({ clusters: new Map(), readers: two, rereads: new Map(), teachBackGraded: true, tokenWeight: null });
  assert.equal(g.verdict, "pass");
  assert.equal(g.crossModel, true);
  assert.deepEqual(g.withheldPass, []);
  assert.deepEqual(g.counts, { structural: 0, mustFix: 0, readerError: 0, informational: 0 });
});

const MISREADING = [{ reader: "r2", personaId: "p2", model: "openai-m", kind: "routing", evidence: "q1: picked beta, expected alpha" }];

test("decide: classes, re-read outcomes, token-weight rows and sort order", () => {
  const clusters = new Map([
    cluster("teachback:alpha", "teachback", ["r1", "r2"]),
    cluster("confusion:two", "confusion", ["r1", "r2"], { misreadings: MISREADING }),
    cluster("confusion:amb", "confusion", ["r1"], { misreadings: MISREADING }),
    cluster("confusion:misread", "confusion", ["r2"]),
    cluster("length:alpha", "length", ["r1"], { informational: true }),
  ]);
  const rereads = new Map([["confusion:amb", { ambiguous: true, why: "two readings" }], ["confusion:misread", { ambiguous: false, why: "clear" }]]);
  const tokenWeight = { flags: [{ kind: "heavy", tools: ["alpha"], detail: "alpha is heavy" }] };
  const g = decide({ clusters, readers: two, rereads, teachBackGraded: true, tokenWeight });

  assert.equal(g.verdict, "fail");
  const cls = Object.fromEntries(g.cutList.map((r) => [r.id, r.class]));
  assert.deepEqual(cls, {
    "teachback:alpha": "structural",
    "confusion:two": "must-fix",
    "confusion:amb": "must-fix",
    "confusion:misread": "reader-error",
    "length:alpha": "informational",
    "token-weight:heavy:alpha": "informational",
  });
  assert.deepEqual(g.counts, { structural: 1, mustFix: 2, readerError: 1, informational: 2 });
  assert.deepEqual(g.cutList.map((r) => r.class), ["structural", "must-fix", "must-fix", "reader-error", "informational", "informational"]);
  assert.deepEqual(g.cutList.find((r) => r.id === "confusion:amb").reread, { ambiguous: true, why: "two readings" });
  assert.equal("informational" in g.cutList.find((r) => r.id === "length:alpha"), false);
});

test("decide: confusion-only clusters are informational however many readers raised them", () => {
  const clusters = new Map([
    cluster("confusion:two", "confusion", ["r1", "r2"]),
    cluster("confusion:empty", "confusion", ["r1", "r2"], { misreadings: [] }),
    cluster("confusion:amb", "confusion", ["r1"]),
    cluster("confusion:clear", "confusion", ["r1"]),
  ]);
  const rereads = new Map([["confusion:amb", { ambiguous: true, why: "two readings" }], ["confusion:clear", { ambiguous: false, why: "clear" }]]);
  const g = decide({ clusters, readers: two, rereads, teachBackGraded: true, tokenWeight: null });
  const by = Object.fromEntries(g.cutList.map((r) => [r.id, r]));
  assert.equal(by["confusion:two"].class, "informational");
  assert.equal(by["confusion:empty"].class, "informational");
  assert.equal(by["confusion:amb"].class, "informational");
  assert.equal(by["confusion:amb"].consider, true);
  assert.equal("consider" in by["confusion:two"], false);
  assert.equal(by["confusion:clear"].class, "reader-error", "the reader-error rule still applies first");
  assert.equal(g.verdict, "pass");
});

test("buildClusters: a confusion cluster carries the misreadings of its tool, from any reader", () => {
  const confused = { ...clean, confusion: [{ tool: "alpha", about: "description", issue: "unclear", kind: "ambiguous" }] };
  const misrouted = { ...clean, routing: [{ requestId: "q1", tool: "beta" }, { requestId: "q2", tool: "beta" }, { requestId: "q3", tool: NO_TOOL }] };
  const clusters = buildClusters({ readers: [reader("p1", "anthropic", confused), reader("p2", "openai", misrouted)], requests, truth, teachBackGrades: null, lengthBenchmark: null });
  const m = clusters.get("confusion:alpha:description").misreadings;
  assert.equal(m.length, 1);
  assert.equal(m[0].personaId, "p2");
  assert.match(m[0].evidence, /q1: picked beta, expected alpha/);
});

test("decide: must-fix rows give conditional; no judge marks single-reader rows unverified", () => {
  const clusters = new Map([cluster("confusion:one", "confusion", ["r1"]), cluster("confusion:two", "confusion", ["r1", "r2"], { misreadings: MISREADING })]);
  const g = decide({ clusters, readers: two, rereads: null, teachBackGraded: false, tokenWeight: null });
  assert.equal(g.verdict, "conditional");
  const one = g.cutList.find((r) => r.id === "confusion:one");
  assert.equal(one.class, "reader-error");
  assert.equal(one.reread, "unverified (no judge)");
  assert.ok(g.withheldPass.some((w) => /no --judge/.test(w)));
});

test("decide: pass is withheld for one reader or a single-provider panel", () => {
  const solo = decide({ clusters: new Map(), readers: [reader("p1", "anthropic")], rereads: new Map(), teachBackGraded: true, tokenWeight: null });
  assert.equal(solo.verdict, "conditional");
  assert.ok(solo.withheldPass.some((w) => /fewer than two readers/.test(w)));
  const same = decide({ clusters: new Map(), readers: [reader("p1", "anthropic"), reader("p2", "anthropic")], rereads: new Map(), teachBackGraded: true, tokenWeight: null });
  assert.equal(same.verdict, "conditional");
  assert.equal(same.crossModel, false);
  assert.ok(same.withheldPass.some((w) => /single-provider panel \(anthropic\)/.test(w)));
  // One reader tripping a teach-back is not structural: structural needs every reader of two or more.
  const lone = decide({ clusters: new Map([cluster("teachback:alpha", "teachback", ["r1"])]), readers: two, rereads: new Map(), teachBackGraded: true, tokenWeight: null });
  assert.equal(lone.cutList[0].class, "reader-error");
});

// --- gradeTeachBack ---------------------------------------------------------

test("gradeTeachBack sends the intended and reader meanings, and keeps only well-formed grades", async () => {
  const sent = [];
  const client = {
    model: "judge-m",
    async complete(args) {
      sent.push(args);
      const grades = [
        { tool: "alpha", recovered: true, drift: "" },
        { tool: "beta", recovered: false },
        { tool: "gamma", recovered: "yes" },
        { recovered: true },
        null,
      ];
      return { ok: true, text: `Here you go: ${JSON.stringify({ grades })}`, model: "judge-m" };
    },
  };
  const grades = await gradeTeachBack(client, truth, [{ tool: "alpha", meaning: "reader says a" }], { maxTokens: 123 });
  assert.deepEqual(grades, [
    { tool: "alpha", recovered: true, drift: "" },
    { tool: "beta", recovered: false, drift: "" },
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].maxTokens, 123);
  assert.equal(sent[0].temperature, 0);
  assert.deepEqual(sent[0].tools, []);
  assert.match(sent[0].prompt, /Alpha does a\./);
  assert.match(sent[0].prompt, /reader says a/);
});

test("gradeTeachBack throws on a failed or non-JSON judge reply", async () => {
  const failing = { model: "judge-m", complete: async () => ({ ok: false, reason: "anthropic HTTP 503: x (gave up after 2 retries)" }) };
  await assert.rejects(gradeTeachBack(failing, truth, []), /judge judge-m: anthropic HTTP 503/);
  const prose = { model: "judge-m", complete: async () => ({ ok: true, text: "no json here" }) };
  await assert.rejects(gradeTeachBack(prose, truth, []), /not a JSON object/);
});
