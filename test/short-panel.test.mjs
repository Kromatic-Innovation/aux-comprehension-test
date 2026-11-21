// A short panel: fewer readers answered than the panel was configured for.
// The reader that went missing may be the one that would have blocked, so
// `pass` is withheld the same way it is for a single-provider panel
// (https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/34).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMini, miniReader } from "./_mini.mjs";
import { resetRegistry } from "./_mock.mjs";
import { decide } from "../src/grade.mjs";

beforeEach(resetRegistry);

// One configured reader returns no parseable verdict; everyone else is clean.
const dropOne = (who, base = miniReader()) => (artifact, personaId, model) => (personaId === who ? null : base(artifact, personaId, model));
const short = (w) => /fewer readers answered than the panel was configured for/.test(w);

test("a reader with no parseable verdict withholds an otherwise-passing run, naming the reader and the reason", async () => {
  const out = mkdtempSync(join(tmpdir(), "act-short-"));
  const res = await runMini({ script: dropOne("cautious-agent"), out });
  const failed = res.readers.filter((r) => r.status === "error");
  assert.equal(failed.length, 1);
  assert.equal(res.grade.counts.mustFix, 0);
  assert.equal(res.grade.counts.structural, 0);
  assert.equal(res.grade.crossModel, true);
  assert.equal(res.grade.verdict, "conditional");
  const w = res.grade.withheldPass.find(short);
  assert.ok(w, JSON.stringify(res.grade.withheldPass));
  assert.match(w, /\(3 of 4\)/);
  assert.ok(w.includes(`cautious-agent × ${failed[0].model}`), w);
  assert.match(w, /reader reply carried no parseable verdict/);
  // Shown in verdict.json and verdict.md.
  const verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  assert.ok(verdict.grade.withheldPass.some(short));
  const md = readFileSync(join(out, "verdict.md"), "utf8");
  assert.match(md, /## Why not pass[\s\S]*fewer readers answered than the panel was configured for \(3 of 4\): cautious-agent/);
});

test("control: a run where every configured reader answers is unaffected", async () => {
  const res = await runMini();
  assert.equal(res.readers.every((r) => r.status === "ok"), true);
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
  assert.deepEqual(res.grade.withheldPass, []);
});

test("a run that fails still fails when a reader also failed", async () => {
  const lost = { delete_saved_report: "Shows the weather." };
  const tb = Object.fromEntries(["small-context-host", "cautious-agent", "technical-term-searcher", "literal-reader"].map((p) => [p, lost]));
  const res = await runMini({ script: dropOne("cautious-agent", miniReader({ teachBack: tb })) });
  assert.equal(res.readers.filter((r) => r.status === "error").length, 1);
  assert.equal(res.grade.counts.structural, 1);
  assert.equal(res.grade.verdict, "fail");
  assert.ok(res.grade.withheldPass.some(short), "the short panel is still reported");
});

test("a reader skipped for a missing key also counts as not answering", async () => {
  const res = await runMini({ models: ["claude-haiku-4-5", "gpt-5"], missing: ["openai"] });
  const w = res.grade.withheldPass.find(short);
  assert.match(w, /\(2 of 4\)/);
  assert.match(w, /skipped: OPENAI_API_KEY is not set/);
});

test("decide: no panel info keeps the old behaviour; a full panel adds nothing", () => {
  const readers = [
    { personaId: "a", model: "m1", provider: "anthropic" },
    { personaId: "b", model: "m2", provider: "openai" },
  ];
  const base = { clusters: new Map(), readers, rereads: new Map(), teachBackGraded: true, tokenWeight: null, judgeFailure: { teachBack: null, reread: null } };
  assert.equal(decide(base).verdict, "pass");
  assert.equal(decide({ ...base, panel: { configured: 2, missing: [] } }).verdict, "pass");
  const g = decide({ ...base, panel: { configured: 3, missing: [{ personaId: "c", model: "m3", reason: "HTTP 500" }] } });
  assert.equal(g.verdict, "conditional");
  assert.deepEqual(g.withheldPass, ["fewer readers answered than the panel was configured for (2 of 3): c × m3 (HTTP 500)"]);
});
