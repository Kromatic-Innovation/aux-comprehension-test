// _mock.mjs — scripted, offline clients for the test suite. No network, no tokens.
//
// A scripted reader is a function (artifact, personaId) -> verdict. It is
// handed the artifact parsed back out of the RENDERED PROMPT, so a scripted
// reader can only react to what a real reader would see: if a test's script
// depends on a phrase, that phrase has to actually be in the payload.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clearRegistry } from "panelist";

// Zero network for the whole suite: any real fetch fails the test that made it.
globalThis.fetch = async (url) => {
  throw new Error(`network call attempted in tests: ${String(url).split("?")[0]}`);
};

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const fixture = (rel) => readFileSync(join(FIXTURES, rel), "utf8");
export const fixtureJson = (rel) => JSON.parse(fixture(rel));

export function resetRegistry() {
  clearRegistry();
}

/** Pull the fenced artifact back out of a panelist spawn prompt. */
export function artifactFromPrompt(prompt) {
  const start = prompt.indexOf('"""');
  const end = prompt.lastIndexOf('"""');
  if (start < 0 || end <= start) throw new Error("mock: no fenced artifact in prompt");
  return JSON.parse(prompt.slice(start + 3, end));
}

export const firstSentence = (s) => String(s ?? "").split(/(?<=\.)\s/)[0];

/** A reader client that replays a script against the payload it was shown. */
export function scriptedReader(model, personaId, script, { prompts, calls } = {}) {
  return {
    model,
    async complete({ prompt }) {
      prompts?.push({ personaId, model, prompt });
      if (calls) calls.n += 1;
      const verdict = script(artifactFromPrompt(prompt), personaId, model);
      const text = JSON.stringify({ verdict, message: `${personaId} read the payload.`, dealKillers: [] });
      return { ok: true, text, model, usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(text.length / 4) } };
    },
  };
}

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{5,}/g) ?? []);

/**
 * A scripted judge. Teach-back: recovered when the reader's words share at
 * least two significant words with the intended meaning. Re-read: every
 * single-reader complaint is judged unambiguous unless `ambiguousIds` names it.
 * `pad` adds that many chars of commentary per grade (a verbose judge);
 * `honourCap` cuts the reply off at the call's maxTokens, as a provider does.
 */
export function scriptedJudge(model, { ambiguousIds = [], prompts, pad = 0, honourCap = false } = {}) {
  return {
    model,
    async complete({ prompt, maxTokens }) {
      prompts?.push({ model, prompt });
      let out;
      if (prompt.includes("COMPLAINTS:")) {
        const complaints = JSON.parse(prompt.slice(prompt.indexOf("COMPLAINTS:") + 11));
        out = { rereads: complaints.map((c) => ({ id: c.id, ambiguous: ambiguousIds.includes(c.id), why: "scripted re-read" })) };
      } else {
        const items = JSON.parse(prompt.slice(prompt.indexOf("ITEMS:") + 6));
        out = {
          grades: items.map((it) => {
            const a = words(it.intended);
            const shared = [...words(it.reader)].filter((w) => a.has(w)).length;
            return { tool: it.tool, recovered: shared >= 2, drift: shared >= 2 ? "" : "purpose not recovered", ...(pad ? { why: "w".repeat(pad) } : {}) };
          }),
        };
      }
      let text = JSON.stringify(out);
      // honourCap: behave like a real provider at the output cap -- the reply
      // is cut off at ~maxTokens tokens (chars / 4) and says so.
      let stop = "end_turn";
      if (honourCap && Math.ceil(text.length / 4) > maxTokens) {
        text = text.slice(0, maxTokens * 4);
        stop = "max_tokens";
      }
      return { ok: true, text, model, stopReason: stop, usage: { inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(text.length / 4) } };
    },
  };
}

/** deps.clientFor for run(): scripted readers keyed by model, one scripted judge. */
export function mockClientFor({ script, judgeModel, judge, missing = [], prompts, calls }) {
  return (spec) => {
    if (missing.includes(spec.provider)) return { skipped: `${spec.provider.toUpperCase()}_API_KEY is not set` };
    if (spec.model === judgeModel && !spec.personaId) return { client: judge ?? scriptedJudge(spec.model) };
    return { client: scriptedReader(spec.model, spec.personaId, script, { prompts, calls }) };
  };
}

export const TEST_PRICES = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "gpt-5": { input: 1.25, output: 10 },
};
