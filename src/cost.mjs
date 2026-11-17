// cost.mjs — pre-run spend estimate and post-run actual spend.
//
// The estimate is an upper bound: input tokens are ceil(chars / 4) of the
// exact prompt each call will send, and output tokens are the full output
// cap for that call. It fails closed: a model with no known price throws
// instead of being priced at zero, because a zero price would silently
// satisfy any --max-usd.
//
// A price entry may carry one prompt-length tier:
//   { "input": 0.1, "output": 0.5, "above": { "tokens": 100000, "input": 0.5, "output": 2.5 } }
// A call whose input tokens are over `above.tokens` is priced entirely at the
// `above` rates, in the estimate and in actual-spend reporting alike.
//
// Retries: a provider call that gets a 429 or 5xx is retried up to
// MAX_RETRIES times (clients.mjs). Each retried attempt is counted in actual
// spend at its full input (chars / 4 of the prompt) and zero output, because
// the provider reports no usage for a failed attempt. The estimate counts the
// same worst case for every call (MAX_RETRIES retried attempts, then a full
// reply), so it stays an upper bound when calls are retried.

import { readFileSync } from "node:fs";
import { readJsonAsset } from "./assets.mjs";
import { MAX_RETRIES } from "./clients.mjs";

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

const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * True when a price entry is usable. A malformed `above` tier makes the whole
 * entry unpriced rather than silently falling back to the lower tier, which
 * would under-state the bound for exactly the large prompts the tier exists for.
 */
export function validPrice(price) {
  if (!price) return false;
  if (price.above === undefined) return true;
  const a = price.above;
  return Boolean(a) && positive(a.tokens) && positive(a.input) && positive(a.output);
}

/** The rates that apply to one call: the `above` tier once input tokens are over its threshold. */
export function rateFor(price, inputTokens) {
  return price.above && inputTokens > price.above.tokens ? price.above : price;
}

export function usd({ inputTokens, outputTokens }, price) {
  const rate = rateFor(price, inputTokens);
  return (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
}

/**
 * @param {Array<{model: string, prompt: string, maxTokens: number, purpose: string}>} calls
 * @param {object} prices
 * @param {{maxRetries?: number}} [opts]  retried attempts to allow per call (default MAX_RETRIES)
 * @returns {{ usd: number, maxRetries: number, calls: object[] }}
 */
export function estimate(calls, prices, { maxRetries = MAX_RETRIES } = {}) {
  const unknown = [...new Set(calls.filter((c) => !validPrice(priceFor(c.model, prices))).map((c) => c.model))];
  if (unknown.length) {
    const err = new Error(
      `no price known for ${unknown.join(", ")}; refusing to estimate spend as zero. ` +
        `Pass --prices <file.json> with {"models": {"<id>": {"input": <usd/Mtok>, "output": <usd/Mtok>}}} ` +
        `(optionally "above": {"tokens": <N>, "input": <usd/Mtok>, "output": <usd/Mtok>} for a prompt-length tier).`,
    );
    err.code = "UNKNOWN_PRICE";
    throw err;
  }
  const rows = calls.map((c) => {
    const price = priceFor(c.model, prices);
    const tokens = { inputTokens: approxTokens(c.prompt), outputTokens: c.maxTokens };
    const retryUsd = maxRetries * usd({ inputTokens: tokens.inputTokens, outputTokens: 0 }, price);
    return { purpose: c.purpose, model: c.model, ...tokens, retries: maxRetries, usd: usd(tokens, price) + retryUsd };
  });
  return { usd: rows.reduce((s, r) => s + r.usd, 0), maxRetries, calls: rows };
}

/**
 * Wrap a client so every call's usage is recorded. When a client reports no
 * usage, chars / 4 of the prompt and reply stand in, marked approximate. A
 * reply carrying `retries: n` (clients.mjs) also records n retried attempts,
 * each at chars / 4 of the prompt in and nothing out, marked approximate.
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
      const retries = Number.isInteger(res?.retries) && res.retries > 0 ? res.retries : 0;
      for (let i = 0; i < retries; i++) {
        ledger.push({ purpose, model: client.model, inputTokens: approxTokens(args.prompt), outputTokens: 0, approximate: true, retry: true });
      }
      return res;
    },
  };
}

export function actual(ledger, prices) {
  let total = 0;
  const rows = ledger.map((e) => {
    const p = priceFor(e.model, prices);
    const cost = validPrice(p) ? usd(e, p) : null;
    if (cost != null) total += cost;
    return { ...e, usd: cost };
  });
  return { usd: total, approximate: ledger.some((e) => e.approximate), retries: ledger.filter((e) => e.retry).length, calls: rows };
}
