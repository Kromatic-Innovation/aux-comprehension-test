// reader.mjs — build the reader panel and run one blind reader through
// panelist's `spawn`.
//
// Isolation: the reader prompt is panelist's buildSpawnPrompt over exactly
// four things — the persona identity, the payload, the reader view of the
// requests (id + text only), and the instruction. Ground truth, expected
// tools and other readers' output are never arguments here, so they cannot
// reach the prompt. `spawn` is called with no `tools`, so it grants none.

import { spawn, buildSpawnPrompt, registerPersonas, getPersona, providerOf } from "panelist";
import { readAsset, readJsonAsset } from "./assets.mjs";
import { readerRequests, NO_TOOL } from "./inputs.mjs";

export const READER_INSTRUCTION = readAsset("prompts/reader-instruction.md").trim();

export const RESPONSE_SCHEMA = {
  teachBack: [{ tool: "<tool name>", meaning: "<what it does, when to use it, what it returns, what it costs or changes>" }],
  routing: [{ requestId: "<request id>", tool: `<tool name, or "${NO_TOOL}">` }],
  confusion: [
    {
      tool: '<tool name, or "*">',
      about: "<field, parameter, annotation, or description>",
      issue: "<what confused you, quoting the words>",
      kind: "ambiguous|missing|misleading|jargon|length|other",
    },
  ],
};

const BUNDLED = readJsonAsset("personas/readers.json");
export const DEFAULT_PERSONA_IDS = BUNDLED.personas.map((p) => p.id);

/** Register the bundled reader personas (idempotent: last-wins by id). */
export function registerReaderPersonas() {
  registerPersonas(BUNDLED);
}

/**
 * Split `provider:model` into parts. Without a prefix the provider is
 * inferred with panelist's providerOf; `grok-*` ids map to xai.
 */
export function parseModelSpec(spec) {
  const s = String(spec).trim();
  const m = s.match(/^(anthropic|openai|xai|google):(.+)$/);
  if (m) return { provider: m[1], model: m[2], spec: s };
  if (/^grok/i.test(s)) return { provider: "xai", model: s, spec: s };
  return { provider: providerOf(s), model: s, spec: s };
}

/**
 * Pair personas with models. Default: zip cyclically to max(personas, models)
 * so every model and every persona appears at least once (three models and
 * four personas give four readers). `maxReaders` caps the panel.
 */
export function buildPanel({ personaIds = DEFAULT_PERSONA_IDS, models, maxReaders } = {}) {
  if (!Array.isArray(models) || models.length === 0) throw new Error("panel: at least one model is required");
  if (!Array.isArray(personaIds) || personaIds.length === 0) throw new Error("panel: at least one persona is required");
  const specs = models.map(parseModelSpec);
  const n = Math.max(specs.length, personaIds.length);
  const panel = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const personaId = personaIds[i % personaIds.length];
    const m = specs[i % specs.length];
    const key = `${personaId}__${m.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    panel.push({ personaId, ...m });
  }
  return maxReaders ? panel.slice(0, maxReaders) : panel;
}

/** The artifact a reader sees: the payload verbatim plus the reader view of the requests. */
export function buildReaderArtifact(payload, requests) {
  return JSON.stringify({ tools: payload.tools, requests: readerRequests(requests) }, null, 1);
}

/** The exact prompt spawn will send, for cost estimation and the sentinel test. */
export function renderReaderPrompt({ personaId, payload, requests }) {
  const persona = getPersona(personaId);
  if (!persona) throw new Error(`unknown persona ${personaId}`);
  return buildSpawnPrompt({
    persona,
    mode: "vote",
    artifact: buildReaderArtifact(payload, requests),
    instruction: READER_INSTRUCTION,
    responseSchema: RESPONSE_SCHEMA,
  });
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** Coerce a reader's verdict into the three lists, dropping malformed entries. */
export function normalizeReaderVerdict(verdict) {
  const v = verdict && typeof verdict === "object" ? verdict : {};
  return {
    teachBack: arr(v.teachBack)
      .filter((x) => x && typeof x.tool === "string")
      .map((x) => ({ tool: x.tool, meaning: typeof x.meaning === "string" ? x.meaning : "" })),
    routing: arr(v.routing)
      .filter((x) => x && typeof x.requestId === "string")
      .map((x) => ({ requestId: x.requestId, tool: typeof x.tool === "string" ? x.tool : null })),
    confusion: arr(v.confusion)
      .filter((x) => x && typeof x.issue === "string" && x.issue.trim())
      .map((x) => ({
        tool: typeof x.tool === "string" && x.tool ? x.tool : "*",
        about: typeof x.about === "string" && x.about ? x.about : "description",
        issue: x.issue.trim(),
        kind: typeof x.kind === "string" ? x.kind.toLowerCase() : "other",
      })),
  };
}

/**
 * Run one reader. Never throws on a model failure: a failed reader is
 * returned with `error` so the run can report it and carry on.
 */
export async function runReader({ reader, client, payload, requests, maxTokens }) {
  // panelist reports a failed call only as "no usable text"; keep the
  // provider's own reason (HTTP status, retries) so the reader's error says why.
  let lastFailure = null;
  const watched = {
    ...client,
    model: client.model,
    async complete(args) {
      const res = await client.complete(args);
      lastFailure = res && res.ok === false && res.reason ? res.reason : null;
      return res;
    },
  };
  try {
    const out = await spawn(
      reader.personaId,
      {
        mode: "vote",
        artifact: buildReaderArtifact(payload, requests),
        instruction: READER_INSTRUCTION,
        responseSchema: RESPONSE_SCHEMA,
      },
      { client: watched, maxTokens },
    );
    if (out.verdict == null) {
      return { ...reader, error: "reader reply carried no parseable verdict", raw: out.message };
    }
    return {
      ...reader,
      response: normalizeReaderVerdict(out.verdict),
      message: out.message,
      isolation: out.isolation,
      honesty: out.honesty,
    };
  } catch (err) {
    const message = err?.message ?? String(err);
    return { ...reader, error: lastFailure ? `${message}: ${lastFailure}` : message };
  }
}
