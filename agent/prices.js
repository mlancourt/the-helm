/**
 * List prices in USD per million tokens, matched by model-id prefix (longest
 * wins) — copied from worker/worker.js's ASK_PRICES. An id nobody has priced
 * is costed at the most expensive tier, so an unknown model trips the cap
 * early and never runs free.
 *
 * `claude-sonnet-5-5` has its own row at the price /api/draft already charges
 * it (the Worker reaches it through the `claude-sonnet-5` prefix), so the two
 * $3 rails cost the same model the same way.
 */
export const ASK_PRICES = [
  ['claude-fable-5', { in: 10, out: 50 }],
  ['claude-mythos-5', { in: 10, out: 50 }],
  ['claude-opus-', { in: 5, out: 25 }],
  ['claude-sonnet-5-5', { in: 2, out: 10 }],
  ['claude-sonnet-5', { in: 2, out: 10 }],
  ['claude-sonnet-4-6', { in: 3, out: 15 }],
  ['claude-haiku-4-5', { in: 1, out: 5 }],
];
export const ASK_PRICE_UNKNOWN = { in: 10, out: 50 };

export function modelPrices(model) {
  const id = String(model || '');
  let hit = null;
  for (const [prefix, price] of ASK_PRICES) {
    if (id.startsWith(prefix) && (!hit || prefix.length > hit.prefix.length)) hit = { prefix, price };
  }
  return hit ? hit.price : ASK_PRICE_UNKNOWN;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Messages-API usage shape → USD. Cache writes 1.25x, cache reads 0.1x. */
export function estimateUsd(model, usage) {
  const p = modelPrices(model);
  const u = usage || {};
  const input = num(u.input_tokens) + num(u.cache_creation_input_tokens) * 1.25 + num(u.cache_read_input_tokens) * 0.1;
  const usd = (input * p.in + num(u.output_tokens) * p.out) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * The SDK result's `modelUsage` ({<model>: {inputTokens, …}}) → USD and token
 * totals, priced by OUR table, never the SDK's own costUSD — the cap is ours.
 */
export function priceModelUsage(modelUsage) {
  let usd = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  for (const [model, u] of Object.entries(modelUsage || {})) {
    const usage = {
      input_tokens: num(u?.inputTokens),
      output_tokens: num(u?.outputTokens),
      cache_creation_input_tokens: num(u?.cacheCreationInputTokens),
      cache_read_input_tokens: num(u?.cacheReadInputTokens),
    };
    usd += estimateUsd(model, usage);
    tokens_in += usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    tokens_out += usage.output_tokens;
  }
  return { usd: Math.round(usd * 1e6) / 1e6, tokens_in, tokens_out };
}
