// Server instructions: the `instructions` string an MCP server returns from
// initialize, tested alongside tools/list (--instructions, or a capture).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/run.mjs";
import { main, EXIT } from "../src/cli.mjs";
import { normalizePayload, gradedTruth, checkTruthCoverage, parseTruth, SERVER_INSTRUCTIONS } from "../src/inputs.mjs";
import { measureTokenWeight, renderTokenWeightMd } from "../src/tokenweight.mjs";
import { FIXTURES, fixture, fixtureJson, mockClientFor, scriptedJudge, resetRegistry, TEST_PRICES } from "./_mock.mjs";
import { miniReader } from "./_mini.mjs";

beforeEach(resetRegistry);

const INSTR = "ZZ-INSTRUCTIONS-TEXT-ZZ Credits are shared across all tools; estimate before any large run.";
const TRUTH_SENTINEL = "ZZ-GROUND-TRUTH-SENTINEL-ZZ";
const truthWithSection = (meaning = `${TRUTH_SENTINEL} Credits are shared across tools; estimate before large runs.`) =>
  `${fixture("mini/truth.md").replace(/^(Predicts|Forecasts|Permanently)/gm, `${TRUTH_SENTINEL} $1`)}\n## ${SERVER_INSTRUCTIONS}\n\n${meaning}\n`;

/** miniReader, plus a teach-back of the instructions whenever the reader is shown them. */
const instrReader = (tb = (s) => s) => (artifact, personaId) => {
  const v = miniReader()(artifact, personaId);
  if (artifact.server_instructions) v.teachBack.push({ tool: SERVER_INSTRUCTIONS, meaning: tb(artifact.server_instructions, personaId) });
  return v;
};

function go({ instructions, tools = fixtureJson("mini/tools.json"), truth = truthWithSection(), script = instrReader(), prompts, judgePrompts, ...rest } = {}) {
  return run(
    { tools, truth, requests: fixtureJson("mini/requests.json"), models: ["claude-haiku-4-5", "gpt-5"], judge: "claude-sonnet-4-6", maxUsd: 1, prices: TEST_PRICES, env: {}, instructions, ...rest },
    { clientFor: mockClientFor({ script, judgeModel: "claude-sonnet-4-6", judge: scriptedJudge("claude-sonnet-4-6", { prompts: judgePrompts }), prompts }) },
  );
}

test("with the flag: the instructions are in every reader prompt, before the tools, and no ground truth is", async () => {
  const prompts = [];
  const judgePrompts = [];
  const res = await go({ instructions: INSTR, prompts, judgePrompts });
  assert.equal(res.status, "completed");
  assert.equal(prompts.length, 4);
  for (const { personaId, prompt } of prompts) {
    assert.ok(prompt.includes(INSTR), `${personaId}: instructions missing`);
    const art = prompt.slice(prompt.indexOf('"""'));
    assert.ok(art.indexOf('"server_instructions"') >= 0 && art.indexOf('"server_instructions"') < art.indexOf('"tools"'), `${personaId}: instructions are not before the tools`);
    assert.match(prompt, /server's instructions/);
    assert.ok(!prompt.includes(TRUTH_SENTINEL), `${personaId}: ground truth leaked`);
  }
  // Control: the planted truth (including the server-instructions section) did reach the judge.
  assert.ok(judgePrompts.some((p) => p.prompt.includes(TRUTH_SENTINEL)));
});

test("without the flag: no instructions section, and a server-instructions truth section is not required or graded", async () => {
  const prompts = [];
  const judgePrompts = [];
  const res = await go({ prompts, judgePrompts });
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.withheldPass));
  for (const { prompt } of prompts) {
    assert.ok(!/server_instructions|server's instructions/.test(prompt));
  }
  const items = judgePrompts.filter((p) => p.prompt.includes("ITEMS:")).flatMap((p) => JSON.parse(p.prompt.slice(p.prompt.indexOf("ITEMS:") + 6)));
  assert.ok(items.length > 0 && !items.some((it) => it.tool === SERVER_INSTRUCTIONS));
  assert.equal(res.tokenWeight.instructions, undefined);
});

test("with the flag but no server-instructions truth section, nothing extra is required", async () => {
  const res = await go({ instructions: INSTR, truth: fixture("mini/truth.md") });
  assert.equal(res.grade.verdict, "pass", JSON.stringify(res.grade.cutList));
});

test("teach-back: the server-instructions section is graded when the flag is given", async () => {
  const judgePrompts = [];
  const ok = await go({ instructions: INSTR, judgePrompts });
  const items = judgePrompts.filter((p) => p.prompt.includes("ITEMS:")).flatMap((p) => JSON.parse(p.prompt.slice(p.prompt.indexOf("ITEMS:") + 6)));
  assert.equal(items.filter((it) => it.tool === SERVER_INSTRUCTIONS).length, 4, "one grade per reader");
  assert.equal(ok.grade.verdict, "pass");

  resetRegistry();
  // Every reader misreads the instructions: structural, like a tool no reader recovered.
  const lost = await go({ instructions: INSTR, script: instrReader(() => "Shows the weather.") });
  const row = lost.grade.cutList.find((r) => r.id === `teachback:${SERVER_INSTRUCTIONS}`);
  assert.ok(row);
  assert.equal(row.class, "structural");
  assert.equal(lost.grade.verdict, "fail");
});

test("a run without the flag does not need readers to teach back the instructions", async () => {
  // Same truth file, a reader that never mentions instructions: still pass.
  const res = await go({ script: miniReader() });
  assert.ok(!res.grade.cutList.some((r) => r.id === `teachback:${SERVER_INSTRUCTIONS}`));
  assert.equal(res.grade.verdict, "pass");
});

test("instructions can come from an initialize + tools/list capture; the flag wins", () => {
  const tools = fixtureJson("mini/tools.json").tools;
  const capture = [
    { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "x" }, instructions: "from initialize" } },
    { jsonrpc: "2.0", id: 2, result: { tools } },
  ];
  assert.equal(normalizePayload(capture).instructions, "from initialize");
  assert.equal(normalizePayload(capture).tools.length, 3);
  assert.equal(normalizePayload(capture, { instructions: "from file" }).instructions, "from file");
  assert.equal(normalizePayload({ tools, instructions: "top" }).instructions, "top");
  assert.equal(normalizePayload({ result: { tools, instructions: "rpc" } }).instructions, "rpc");
  assert.equal("instructions" in normalizePayload({ tools }), false);
  assert.equal("instructions" in normalizePayload(tools), false, "a bare tools array is still a tools array");
  assert.throws(() => normalizePayload({ tools }, { instructions: "  \n" }), /empty/);
  assert.throws(() => normalizePayload({ tools: [...tools, { name: SERVER_INSTRUCTIONS }] }, { instructions: "x" }), /reserved/);
});

test("a capture's instructions reach the reader prompt with no flag", async () => {
  const prompts = [];
  const capture = [{ jsonrpc: "2.0", id: 1, result: { instructions: INSTR } }, { jsonrpc: "2.0", id: 2, result: fixtureJson("mini/tools.json") }];
  await go({ tools: capture, prompts });
  assert.ok(prompts.length && prompts.every((p) => p.prompt.includes(INSTR)));
});

test("truth coverage never requires, and gradedTruth sets aside, an ungraded server-instructions section", () => {
  const payload = { tools: [{ name: "a" }] };
  const truth = parseTruth(`## a\nx\n## ${SERVER_INSTRUCTIONS}\ny`);
  checkTruthCoverage(truth, payload);
  assert.deepEqual(Object.keys(gradedTruth(truth, payload).tools), ["a"]);
  assert.deepEqual(Object.keys(gradedTruth(truth, { ...payload, instructions: "i" }).tools), ["a", SERVER_INSTRUCTIONS]);
});

test("token weight: the report has an instructions row, outside the payload total", async () => {
  const tools = fixtureJson("mini/tools.json").tools;
  const plain = await measureTokenWeight({ tools });
  const r = await measureTokenWeight({ tools, instructions: INSTR });
  assert.deepEqual(r.instructions, { bytes: Buffer.byteLength(INSTR), tokens: Math.ceil(Buffer.byteLength(INSTR) / 4) });
  assert.deepEqual(r.total, plain.total);
  const md = renderTokenWeightMd(r);
  assert.match(md, /\| \(server instructions\) \| \d+ \| \d+ \|/);
  assert.doesNotMatch(renderTokenWeightMd(plain), /server instructions/);
});

test("CLI: --instructions <file> is read and reaches the outputs; an empty file exits 64", async () => {
  const dir = mkdtempSync(join(tmpdir(), "act-instr-"));
  const prices = join(dir, "prices.json");
  writeFileSync(prices, JSON.stringify({ models: TEST_PRICES }));
  const truth = join(dir, "truth.md");
  writeFileSync(truth, truthWithSection());
  const instr = join(dir, "instructions.md");
  writeFileSync(instr, INSTR);
  const sink = () => { let s = ""; return { write: (x) => (s += x), get text() { return s; } }; };
  const args = (file) => [
    "run", "--tools", join(FIXTURES, "mini/tools.json"), "--truth", truth, "--requests", join(FIXTURES, "mini/requests.json"),
    "--models", "claude-haiku-4-5,gpt-5", "--judge", "claude-sonnet-4-6", "--prices", prices, "--max-usd", "1",
    "--out", join(dir, "out"), "--instructions", file,
  ];
  const deps = { clientFor: mockClientFor({ script: instrReader(), judgeModel: "claude-sonnet-4-6" }) };
  assert.equal(await main(args(instr), { env: {}, stdout: sink(), stderr: sink(), deps }), EXIT.pass);
  assert.match(readFileSync(join(dir, "out", "token-weight.md"), "utf8"), /\(server instructions\)/);
  assert.ok(JSON.parse(readFileSync(join(dir, "out", "verdict.json"), "utf8")).tokenWeight.instructions.bytes > 0);

  resetRegistry();
  const empty = join(dir, "empty.md");
  writeFileSync(empty, "\n");
  const err = sink();
  assert.equal(await main(args(empty), { env: {}, stdout: sink(), stderr: err, deps }), EXIT.usage);
  assert.match(err.text, /--instructions file is empty/);
});
