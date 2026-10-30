// cost.mjs — pre-run spend estimate and post-run actual spend.
//
// The estimate is an upper bound: input tokens are ceil(chars / 4) of the
// exact prompt each call will send, and output tokens are the full output
// cap for that call. It fails closed: a model with no known price throws
// instead of being priced at zero, because a zero price would silently
// satisfy any --max-usd.

import { readFileSync } from "node:fs";
import { readJsonAsset } from "./assets.mjs";

const BUNDLED = readJsonAsset("data/prices.json");

export function loadPrices(overridePath) {
  const models = { ...BUNDLED.models };
  if (overridePath) {
    const extra = JSON.parse(readFileSync(overridePath, "utf8"));
    Object.assign(models, extra.models ?? extra);
  }
  return models;
}

/**
 * Exact id, or a dated snapshot of a listed id (`<id>-YYYYMMDD` or `<id>@...`).
 * Any other variant is unpriced: matching on a bare prefix would let a more
 * expensive variant (say `<id>-pro`) inherit a cheaper base price and slip
 * under --max-usd.
 */
export function priceFor(model, prices) {
  if (prices[model]) return prices[model];
  const m = model.match(/^(.+?)(-\d{8}|@.+)$/);
  return m && prices[m[1]] ? prices[m[1]] : null;
}

export const approxTokens = (text) => Math.ceil(String(text).length / 4);

export function usd({ inputTokens, outputTokens }, price) {
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

/**
 * @param {Array<{model: string, prompt: string, maxTokens: number, purpose: string}>} calls
 * @returns {{ usd: number, calls: object[] }}
 */
export function estimate(calls, prices) {
  const unknown = [...new Set(calls.filter((c) => !priceFor(c.model, prices)).map((c) => c.model))];
  if (unknown.length) {
    const err = new Error(
      `no price known for ${unknown.join(", ")}; refusing to estimate spend as zero. ` +
        `Pass --prices <file.json> with {"models": {"<id>": {"input": <usd/Mtok>, "output": <usd/Mtok>}}}.`,
    );
    err.code = "UNKNOWN_PRICE";
    throw err;
  }
  const rows = calls.map((c) => {
    const tokens = { inputTokens: approxTokens(c.prompt), outputTokens: c.maxTokens };
    return { purpose: c.purpose, model: c.model, ...tokens, usd: usd(tokens, priceFor(c.model, prices)) };
  });
  return { usd: rows.reduce((s, r) => s + r.usd, 0), calls: rows };
}

/**
 * Wrap a client so every call's usage is recorded. When a client reports no
 * usage, chars / 4 of the prompt and reply stand in, marked approximate.
 */
export function meter(client, ledger, purpose) {
  return {
    model: client.model,
    async complete(args) {
      const res = await client.complete(args);
      const u = res?.usage;
      const exact = u && Number.isFinite(u.inputTokens) && Number.isFinite(u.outputTokens);
      ledger.push({
        purpose,
        model: client.model,
        inputTokens: exact ? u.inputTokens : approxTokens(args.prompt),
        outputTokens: exact ? u.outputTokens : approxTokens(res?.text ?? ""),
        approximate: !exact,
      });
      return res;
    },
  };
}

export function actual(ledger, prices) {
  let total = 0;
  const rows = ledger.map((e) => {
    const p = priceFor(e.model, prices);
    const cost = p ? usd(e, p) : null;
    if (cost != null) total += cost;
    return { ...e, usd: cost };
  });
  return { usd: total, approximate: ledger.some((e) => e.approximate), calls: rows };
}
