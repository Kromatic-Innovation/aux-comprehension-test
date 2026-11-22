// The pre-run estimate's re-read part is priced for an assumed row count, not
// a bound: confusion rows are unbounded. The estimate says which part is an
// upper bound and which is not, and a run with more re-read rows than were
// assumed reports rows assumed vs. rows sent in verdict.json and verdict.md
// (https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/43).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, EXIT } from "../src/cli.mjs";
import { FIXTURES, mockClientFor, scriptedJudge, resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { miniReader, runMini } from "./_mini.mjs";

beforeEach(resetRegistry);

const PERSONAS = ["small-context-host", "cautious-agent", "technical-term-searcher", "literal-reader"];
// The mini fixture: 4 requests and 3 tools, so the estimate assumes
// 4 + 2 * 3 = 10 re-read rows.
const ASSUMED = 10;

// Each reader files `perReader` confusion notes, each about its own field:
// 4 * perReader single-reader rows, every one a re-read candidate.
const confusion = (perReader) =>
  Object.fromEntries(
    PERSONAS.map((p) => [
      p,
      Array.from({ length: perReader }, (_, i) => ({ tool: "delete_saved_report", about: `${p}_field_${i}`, kind: "ambiguous", issue: `Unclear what ${p}_field_${i} does.` })),
    ]),
  );

function sink() {
  let s = "";
  return { write: (x) => (s += x), get text() { return s; } };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "act-est-"));
  const prices = join(dir, "prices.json");
  writeFileSync(prices, JSON.stringify({ models: TEST_PRICES }));
  const base = [
    "run",
    "--tools", join(FIXTURES, "mini/tools.json"),
    "--truth", join(FIXTURES, "mini/truth.md"),
    "--requests", join(FIXTURES, "mini/requests.json"),
    "--models", "claude-haiku-4-5,gpt-5",
    "--judge", "claude-sonnet-4-6",
    "--prices", prices,
  ];
  return { base, out: join(dir, "out") };
}

// The row counts of cost.reread; its input-size fields are checked separately.
const rowCounts = ({ rowsAssumed, rows, rowsSent, overAssumed }) => ({ rowsAssumed, rows, rowsSent, overAssumed });

const deps = (script) => ({ clientFor: mockClientFor({ script, judgeModel: "claude-sonnet-4-6", judge: scriptedJudge("claude-sonnet-4-6") }) });

test("the estimate line does not call the total an upper bound; it splits the bounded part from the re-read", async () => {
  const { base } = setup();
  const stdout = sink();
  assert.equal(await main([...base, "--max-usd", "10", "--estimate-only"], { env: {}, stdout, stderr: sink(), deps: deps(miniReader()) }), 0);
  assert.doesNotMatch(stdout.text, /estimated spend \(upper bound\)/);
  const total = Number(stdout.text.match(/^estimated spend: \$(\d+\.\d{4}) over \d+ call\(s\)$/m)[1]);
  const bounded = Number(stdout.text.match(/^ {2}readers \+ teach-back \(upper bound\): \$(\d+\.\d{4}) over \d+ call\(s\)$/m)[1]);
  const rr = Number(stdout.text.match(new RegExp(`^  re-read \\(estimated, ${ASSUMED} rows assumed\\): \\$(\\d+\\.\\d{4}) over \\d+ call\\(s\\)`, "m"))[1]);
  assert.ok(Math.abs(bounded + rr - total) < 0.00015, `${bounded} + ${rr} != ${total}`);
});

test("more re-read rows than the estimate assumed: the estimate understates the re-read, and the verdict says so", async () => {
  const { base, out } = setup();
  const stdout = sink();
  const script = miniReader({ confusion: confusion(4) });
  const code = await main([...base, "--max-usd", "10", "--out", out], { env: {}, stdout, stderr: sink(), deps: deps(script) });
  assert.equal(code, EXIT.pass, stdout.text);

  const v = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  assert.deepEqual(rowCounts(v.cost.reread), { rowsAssumed: ASSUMED, rows: 16, rowsSent: 16, overAssumed: true });
  assert.equal(v.cost.estimate.parts.reread.rowsAssumed, ASSUMED);
  // The difference is real: the re-read actually cost more than its estimated part.
  const rereadActual = v.cost.actual.calls.filter((c) => c.purpose === "judge").reduce((s, c) => s + c.usd, 0);
  assert.ok(rereadActual > 0);
  const md = readFileSync(join(out, "verdict.md"), "utf8");
  assert.match(md, new RegExp(`re-read rows: 16 to re-read, 16 sent, ${ASSUMED} assumed by the estimate — more than the estimate assumed`));
  assert.doesNotMatch(md, /estimate ≤ \$/, "the total is not labelled a bound");
  assert.match(stdout.text, new RegExp(`re-read: 16 rows, ${ASSUMED} assumed by the estimate \\(16 sent\\); the re-read part of the estimate was exceeded`));

  // The estimate output for the same inputs shows the assumption the run exceeded.
  const est = sink();
  assert.equal(await main([...base, "--max-usd", "10", "--estimate-only"], { env: {}, stdout: est, stderr: sink(), deps: deps(script) }), 0);
  assert.match(est.text, new RegExp(`re-read \\(estimated, ${ASSUMED} rows assumed\\)`));
});

test("spend-stop is unchanged: rows the cap keeps back are counted as not sent", async () => {
  // The provider bills teach-back far above the reply's size, so the re-read cannot be afforded.
  const judgeClient = scriptedJudge("claude-sonnet-4-6", { billOutput: (p) => (p.includes("ITEMS:") ? 16000 : null) });
  const res = await runMini({ script: miniReader({ confusion: confusion(4) }), judgeClient });
  assert.deepEqual(rowCounts(res.cost.reread), { rowsAssumed: ASSUMED, rows: 16, rowsSent: 0, overAssumed: true });
  assert.ok(res.cost.actual.usd <= res.cost.maxUsd);
  assert.equal(res.grade.verdict, "conditional");
});

test("control: within the assumed rows, the verdict reports the counts without the warning", async () => {
  const { base, out } = setup();
  const stdout = sink();
  assert.equal(await main([...base, "--max-usd", "10", "--out", out], { env: {}, stdout, stderr: sink(), deps: deps(miniReader({ confusion: confusion(1) })) }), EXIT.pass);
  const v = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  assert.deepEqual(rowCounts(v.cost.reread), { rowsAssumed: ASSUMED, rows: 4, rowsSent: 4, overAssumed: false });
  // Short complaints: the re-read needed less input than the placeholder rows priced.
  assert.ok(v.cost.reread.inputChars < v.cost.reread.inputCharsAssumed, JSON.stringify(v.cost.reread));
  assert.equal(v.cost.reread.inputOverAssumed, false);
  assert.doesNotMatch(stdout.text, /re-read input:/);
  const md = readFileSync(join(out, "verdict.md"), "utf8");
  assert.match(md, new RegExp(`re-read rows: 4 to re-read, 4 sent, ${ASSUMED} assumed by the estimate\\n`));
  assert.doesNotMatch(md, /more than the estimate assumed/);
  assert.doesNotMatch(stdout.text, /re-read part of the estimate was exceeded/);
});

test("no judge: no re-read part and no re-read row report", async () => {
  const res = await runMini({ judge: null });
  assert.equal(res.cost.reread, null);
  assert.equal(res.cost.estimate.parts.reread, null);
  assert.equal(res.cost.estimate.parts.bounded.usd, res.cost.estimate.usd);
});

// https://github.com/Kromatic-Innovation/aux-comprehension-test/issues/65:
// the estimate prices each assumed row as a placeholder with a 400-character
// complaint, so rows that match the assumed COUNT but carry longer complaints
// need more input than it priced. overAssumed (a row count) cannot see that.
test("the assumed row count with complaints over 400 characters: the re-read input exceeds the estimate, and the run says so", async () => {
  const { base, out } = setup();
  const stdout = sink();
  // 3 + 3 + 2 + 2 = 10 single-reader confusion rows: exactly the assumed count.
  const perPersona = [3, 3, 2, 2];
  const long = (p, i) => `Unclear what ${p}_field_${i} does. ` + "The description never says whether it is read, written, or both, and the schema gives no hint either. ".repeat(6);
  const script = miniReader({
    confusion: Object.fromEntries(
      PERSONAS.map((p, k) => [p, Array.from({ length: perPersona[k] }, (_, i) => ({ tool: "delete_saved_report", about: `${p}_field_${i}`, kind: "ambiguous", issue: long(p, i) }))]),
    ),
  });
  assert.ok(long(PERSONAS[0], 0).length > 400);
  const code = await main([...base, "--max-usd", "10", "--out", out], { env: {}, stdout, stderr: sink(), deps: deps(script) });
  assert.equal(code, EXIT.pass, stdout.text);

  const r = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8")).cost.reread;
  assert.deepEqual(rowCounts(r), { rowsAssumed: ASSUMED, rows: ASSUMED, rowsSent: ASSUMED, overAssumed: false }, "the row count alone reports nothing");
  assert.ok(r.inputCharsAssumed > 0);
  assert.ok(r.inputChars > r.inputCharsAssumed, JSON.stringify(r));
  assert.equal(r.inputOverAssumed, true);
  assert.match(stdout.text, new RegExp(`^re-read input: ${r.inputChars} chars, ${r.inputCharsAssumed} assumed by the estimate's placeholder rows; the re-read part of the estimate was exceeded$`, "m"));
  // The row-count line stays silent: the count matched.
  assert.doesNotMatch(stdout.text, /^re-read: \d+ rows/m);
});

test("the re-read input size the estimate assumed is the input of the re-read calls it priced", async () => {
  const { base, out } = setup();
  await main([...base, "--max-usd", "10", "--out", out], { env: {}, stdout: sink(), stderr: sink(), deps: deps(miniReader({ confusion: confusion(1) })) });
  const v = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
  const priced = v.cost.estimate.calls.filter((c) => c.purpose.startsWith("judge re-read")).reduce((n, c) => n + c.inputTokens, 0);
  // The estimate prices input at chars / 4 (rounded up per call).
  assert.ok(Math.abs(priced - v.cost.reread.inputCharsAssumed / 4) <= v.cost.estimate.parts.reread.calls, `${priced} vs ${v.cost.reread.inputCharsAssumed}`);
});
