#!/usr/bin/env node
/**
 * The Helm — /ask tests. Node, zero deps, no wrangler, no network, no key.
 *
 *   node tools/test-ask.js
 *
 * worker.js is an ES module whose only Cloudflare dependencies are `fetch`,
 * `Request`, `Response` and `crypto` — all of which Node has — so the whole
 * route is driven here against a fake KV namespace and a stubbed model API.
 * That keeps the expensive paths (cap enforcement, timeout, upstream failure,
 * the thinking retry) testable without ever spending a cent or a token.
 *
 * The one thing these tests deliberately never assert is the *content* of the
 * system prompt beyond its plumbing: that text comes from the vault owner.
 */

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TODAY = new Date().toISOString().slice(0, 10);
const CAP_KEY = `ask:cap:${TODAY}`;

/** Minimal in-memory stand-in for a KV namespace binding. */
function makeKV(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async get(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async put(k, v) {
      map.set(k, String(v));
    },
    async delete(k) {
      map.delete(k);
    },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const TOKEN = 'test-token-owner-000000';
const SNAPSHOT = {
  schema: 1,
  generated_at: '2026-09-17T12:00:00.000Z',
  run_id: 'run-test',
  tz: 'America/Chicago',
  tiles: {
    dinner: { band: 'DAILY', status: 'ok', updated_at: '2026-09-17T11:00:00.000Z', data: { date: '2026-09-17', meal: 'chili' } },
  },
};

function baseEnv(extra = {}) {
  return {
    HELM_KV: makeKV({
      tokens: JSON.stringify({ [TOKEN]: { name: 'Matt', role: 'owner' } }),
      snapshot: JSON.stringify(SNAPSHOT),
      'ask:sys': 'You are the Helm steward. (test stand-in for the vault prompt)',
      ...(extra.kv || {}),
    }),
    ADMIN_SECRET: 'test-admin',
    ANTHROPIC_API_KEY: 'test-key',
    ...extra.env,
  };
}

/** A model-API response, shaped like the real one. */
function apiOk({ text = 'Chili tonight.', usage = { input_tokens: 2000, output_tokens: 100 }, stop_reason = 'end_turn', model = 'claude-sonnet-5' } = {}) {
  return new Response(JSON.stringify({ model, stop_reason, content: [{ type: 'text', text }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Swap in a scripted model API. Returns the recorded request bodies so a test
 * can assert what was actually sent upstream.
 */
function stubModelApi(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body, signal: init.signal });
    return handler(body, calls.length, init);
  };
  return calls;
}

async function ask(worker, env, body, { token = TOKEN } = {}) {
  const res = await worker.fetch(
    new Request('https://worker.test/api/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

async function main() {
  console.log('The Helm — /ask tests\n');
  const W = await import('../worker/worker.js');
  const worker = W.default;
  const realFetch = globalThis.fetch;

  // -- pricing -------------------------------------------------------------
  console.log('pricing');
  check('sonnet-class is $2/$10 per MTok', W.modelPrices('claude-sonnet-5').in === 2 && W.modelPrices('claude-sonnet-5').out === 10);
  check('sonnet 4.6 keeps its own older price', W.modelPrices('claude-sonnet-4-6').in === 3);
  check('every opus id prices the same', W.modelPrices('claude-opus-5').out === 25 && W.modelPrices('claude-opus-4-8').out === 25);
  check('haiku is the cheap tier', W.modelPrices('claude-haiku-4-5').in === 1);
  const unknown = W.modelPrices('claude-something-nobody-priced');
  check('an unpriced model costs the MOST, never zero', unknown.in === 10 && unknown.out === 50);
  check('no model id at all still prices high', W.modelPrices(undefined).in === 10);

  const usd = W.estimateUsd('claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  check('1M in + 1M out on sonnet is $12', usd === 12, `got ${usd}`);
  const cached = W.estimateUsd('claude-sonnet-5', { input_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, output_tokens: 0 });
  check('cache reads bill at 0.1x and writes at 1.25x', cached === 2.7, `got ${cached}`);
  check('a missing usage block is $0, not NaN', W.estimateUsd('claude-sonnet-5', null) === 0);
  check('garbage usage values are ignored', W.estimateUsd('claude-sonnet-5', { input_tokens: 'lots' }) === 0);

  // -- model selection -----------------------------------------------------
  console.log('\nmodel selection');
  check('default model is sonnet-class', W.askModel({}) === 'claude-sonnet-5');
  check('ASK_MODEL overrides it', W.askModel({ ASK_MODEL: 'claude-opus-5' }) === 'claude-opus-5');
  check('a blank ASK_MODEL falls back', W.askModel({ ASK_MODEL: '   ' }) === 'claude-sonnet-5');

  // -- history normalization ----------------------------------------------
  console.log('\nhistory');
  const long = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }));
  const trimmed = W.normalizeHistory(long);
  check('history is capped at 10 turns', trimmed.length <= 10, `got ${trimmed.length}`);
  check('history starts on a user turn (the API rejects otherwise)', trimmed[0].role === 'user');
  check('the most recent turns are the ones kept', trimmed[trimmed.length - 1].content === 'turn 13');
  check('junk turns are dropped, not fatal', W.normalizeHistory([{ role: 'system', content: 'x' }, null, { role: 'user', content: '  ' }, { role: 'user', content: 'ok' }]).length === 1);
  check('a non-array history is empty', W.normalizeHistory('nope').length === 0);
  check('an over-long turn is clamped', W.normalizeHistory([{ role: 'user', content: 'x'.repeat(50000) }])[0].content.length === 8000);

  // -- snapshot view -------------------------------------------------------
  console.log('\nsnapshot view');
  const view = W.askSnapshotView(SNAPSHOT);
  check('tz and generated_at survive (dates are unreadable without them)', view.tz === 'America/Chicago' && view.generated_at === SNAPSHOT.generated_at);
  check('run_id does not (provenance, not board state)', view.run_id === undefined);
  check('tiles pass through intact', view.tiles.dinner.data.meal === 'chili');
  check('a business date stays a verbatim string', view.tiles.dinner.data.date === '2026-09-17');

  const fat = { schema: 1, tiles: { newsstand: { band: 'HOURLY', data: { cards: 'x'.repeat(9000) } }, dinner: SNAPSHOT.tiles.dinner } };
  const fatView = W.askSnapshotView(fat);
  check('a tile over 8 KB is replaced by a note', fatView.tiles.newsstand.data._truncated === true);
  check('the note says how big it was', /9\d{3} bytes/.test(fatView.tiles.newsstand.data._note || ''), fatView.tiles.newsstand.data._note);
  check('the over-size tile keeps its band', fatView.tiles.newsstand.band === 'HOURLY');
  check('other tiles are untouched by one fat neighbour', fatView.tiles.dinner.data.meal === 'chili');
  check('a null snapshot yields an empty board, not a throw', Object.keys(W.askSnapshotView(null).tiles).length === 0);

  const system = W.buildAskSystem({ sysText: 'VAULT PROMPT', snapshot: SNAPSHOT, pinned: { tile_id: 'dinner', tile_data: { meal: 'chili' } } });
  check('the vault prompt leads the system text', system.startsWith('VAULT PROMPT'));
  check('the snapshot follows it', system.indexOf('# Board snapshot') > 0);
  check('the pinned tile comes last', system.indexOf('# Pinned tile') > system.indexOf('# Board snapshot'));
  check('the pinned tile is named', system.includes('`dinner`'));
  check('no pin means no pinned section', !W.buildAskSystem({ sysText: 'x', snapshot: SNAPSHOT, pinned: null }).includes('# Pinned tile'));

  // -- the route: auth and shape ------------------------------------------
  console.log('\nroute — auth and shape');
  stubModelApi(() => apiOk());
  check('ask needs a token', (await ask(worker, baseEnv(), { q: 'hi' }, { token: 'nope' })).status === 401);
  check('an empty q is 400', (await ask(worker, baseEnv(), { q: '   ' })).status === 400);
  check('a missing q is 400', (await ask(worker, baseEnv(), {})).json?.reason === 'bad_shape');
  check('a bogus tile_id is 400', (await ask(worker, baseEnv(), { q: 'hi', tile_id: '../snapshot' })).json?.reason === 'bad_shape');

  // -- the route: happy path ----------------------------------------------
  console.log('\nroute — happy path');
  let env = baseEnv();
  let calls = stubModelApi(() => apiOk({ usage: { input_tokens: 4000, cache_read_input_tokens: 1000, output_tokens: 200 } }));
  let r = await ask(env && worker, env, { q: 'what is for dinner?', history: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] });
  check('an answer comes back 200', r.status === 200, r.text);
  check('the answer is the model text', r.json?.answer === 'Chili tonight.');
  check('mode is "snapshot" in v1', r.json?.mode === 'snapshot');
  check('the call reports its own cost', r.json?.usd === W.estimateUsd('claude-sonnet-5', { input_tokens: 4000, cache_read_input_tokens: 1000, output_tokens: 200 }), `got ${r.json?.usd}`);
  check('the key never reaches the page', !r.text.includes('test-key'));

  const sent = calls[0].body;
  check('the model API is the only thing called', calls.length === 1 && calls[0].url === 'https://api.anthropic.com/v1/messages');
  check('the key travels as x-api-key', calls[0].headers['x-api-key'] === 'test-key');
  check('max_tokens is the brief\'s 800', sent.max_tokens === 800);
  check('the default model is used', sent.model === 'claude-sonnet-5');
  check('the system prompt is one cached block', Array.isArray(sent.system) && sent.system[0].cache_control.type === 'ephemeral');
  check('the snapshot rides in the system prompt', sent.system[0].text.includes('chili'));
  check('history is replayed before the question', sent.messages.length === 3 && sent.messages[0].content === 'hi');
  check('the question is the last message', sent.messages[2].role === 'user' && sent.messages[2].content === 'what is for dinner?');
  check('thinking is off (it would eat the 800-token answer)', sent.thinking.type === 'disabled');
  check('the call is bounded by a timeout signal', !!calls[0].signal);

  const spend = JSON.parse(await env.HELM_KV.get(CAP_KEY));
  check('the cost lands in today\'s UTC bucket', spend.usd === r.json.usd && spend.calls === 1, JSON.stringify(spend));

  // a second call accumulates
  await ask(worker, env, { q: 'and tomorrow?' });
  const spend2 = JSON.parse(await env.HELM_KV.get(CAP_KEY));
  check('a second ask accumulates onto the same bucket', spend2.calls === 2 && spend2.usd > spend.usd);

  // -- the route: pinned tile ---------------------------------------------
  console.log('\nroute — pinned tile (Explain)');
  calls = stubModelApi(() => apiOk());
  await ask(worker, baseEnv(), { q: 'Explain this tile.', tile_id: 'bets_live', tile_data: { tickets: [{ id: 't1', market: 'spread' }] } });
  check('the pinned tile is pinned into the system prompt', calls[0].body.system[0].text.includes('# Pinned tile'));
  check('the pinned tile data is sent', calls[0].body.system[0].text.includes('spread'));

  calls = stubModelApi(() => apiOk());
  await ask(worker, baseEnv(), { q: 'Explain this tile.', tile_id: 'newsstand', tile_data: { cards: 'y'.repeat(9000) } });
  check('an over-size pinned tile is a note, not 9 KB of payload', calls[0].body.system[0].text.includes('pinned tile data omitted'));

  // -- the route: the cap --------------------------------------------------
  console.log('\nroute — the daily cap');
  env = baseEnv({ kv: { [CAP_KEY]: JSON.stringify({ usd: 3.0, calls: 40 }) } });
  calls = stubModelApi(() => apiOk());
  r = await ask(worker, env, { q: 'one more' });
  check('at the cap the answer is 429', r.status === 429, r.text);
  check('the page is told why', r.json?.reason === 'cap');
  check('nothing was spent past the cap', calls.length === 0);

  env = baseEnv({ env: { ASK_DAILY_CAP_USD: '0.50' }, kv: { [CAP_KEY]: JSON.stringify({ usd: 0.6, calls: 3 }) } });
  check('a configured cap is enforced at its own number', (await ask(worker, env, { q: 'hi' })).status === 429);

  env = baseEnv({ env: { ASK_DAILY_CAP_USD: '0.50' }, kv: { [CAP_KEY]: JSON.stringify({ usd: 0.4, calls: 3 }) } });
  stubModelApi(() => apiOk());
  check('under that cap the ask still runs', (await ask(worker, env, { q: 'hi' })).status === 200);

  env = baseEnv({ kv: { [CAP_KEY]: JSON.stringify({ usd: 2.99, calls: 9 }) } });
  stubModelApi(() => apiOk({ usage: { input_tokens: 1000, output_tokens: 100 } }));
  check('the last ask under the cap is allowed through', (await ask(worker, env, { q: 'hi' })).status === 200);
  check('and it pushes the bucket over, closing the door behind it', JSON.parse(await env.HELM_KV.get(CAP_KEY)).usd >= 2.99);

  // -- the route: degradation ---------------------------------------------
  console.log('\nroute — degradation');
  env = baseEnv({ env: { ANTHROPIC_API_KEY: undefined } });
  delete env.ANTHROPIC_API_KEY;
  r = await ask(worker, env, { q: 'hi' });
  check('no key configured is 503 no_key', r.status === 503 && r.json.reason === 'no_key', r.text);

  env = baseEnv();
  await env.HELM_KV.delete('ask:sys');
  r = await ask(worker, env, { q: 'hi' });
  check('no system prompt installed is 503 no_system', r.status === 503 && r.json.reason === 'no_system', r.text);

  env = baseEnv();
  stubModelApi(() => {
    const e = new Error('timed out');
    e.name = 'TimeoutError';
    throw e;
  });
  r = await ask(worker, env, { q: 'hi' });
  check('a model timeout is 504 timeout', r.status === 504 && r.json.reason === 'timeout', r.text);
  check('a timeout costs nothing we can see, so nothing is booked', (await env.HELM_KV.get(CAP_KEY)) === null);

  env = baseEnv();
  stubModelApi(() => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 }));
  r = await ask(worker, env, { q: 'hi' });
  check('an upstream failure is 502 upstream', r.status === 502 && r.json.reason === 'upstream', r.text);
  check('the upstream reason is passed along', /overloaded/.test(r.json.detail || ''));

  env = baseEnv();
  stubModelApi(() => new Response('<html>gateway</html>', { status: 502 }));
  r = await ask(worker, env, { q: 'hi' });
  check('a non-JSON upstream body is still a clean 502', r.status === 502 && r.json.reason === 'upstream');

  env = baseEnv();
  stubModelApi(() => new Response('{}', { status: 200 }));
  r = await ask(worker, env, { q: 'hi' });
  check('an empty answer says so rather than returning blank', r.status === 200 && /empty answer/.test(r.json.answer));

  env = baseEnv();
  await env.HELM_KV.put('snapshot', '{not json');
  stubModelApi(() => apiOk());
  r = await ask(worker, env, { q: 'hi' });
  check('a corrupt snapshot still answers (no board context, no 500)', r.status === 200, r.text);

  env = baseEnv();
  await env.HELM_KV.delete('snapshot');
  stubModelApi(() => apiOk());
  check('no snapshot published yet still answers', (await ask(worker, env, { q: 'hi' })).status === 200);

  // -- stop reasons --------------------------------------------------------
  console.log('\nstop reasons');
  env = baseEnv();
  stubModelApi(() => apiOk({ text: 'Half an ans', stop_reason: 'max_tokens' }));
  r = await ask(worker, env, { q: 'hi' });
  check('a truncated answer says it was cut off', /cut off at the 800-token/.test(r.json.answer), r.json?.answer);

  env = baseEnv();
  stubModelApi(() => apiOk({ text: '', stop_reason: 'refusal' }));
  r = await ask(worker, env, { q: 'hi' });
  check('a refusal reads as a refusal, not an error', r.status === 200 && /declined/.test(r.json.answer));

  // -- the thinking retry --------------------------------------------------
  console.log('\nthinking retry');
  env = baseEnv({ env: { ASK_MODEL: 'claude-fable-5-1' } });
  calls = stubModelApi((body, n) =>
    n === 1 && body.thinking
      ? new Response(JSON.stringify({ error: { message: '`thinking` may not be disabled for this model' } }), { status: 400 })
      : apiOk({ model: 'claude-fable-5-1' })
  );
  r = await ask(worker, env, { q: 'hi' });
  check('a model that refuses thinking:disabled is retried without it', r.status === 200, r.text);
  check('the retry drops only that field', calls.length === 2 && !('thinking' in calls[1].body) && calls[1].body.max_tokens === 800);
  check('the retry is priced at the model that actually answered', r.json.usd === W.estimateUsd('claude-fable-5-1', { input_tokens: 2000, output_tokens: 100 }));

  env = baseEnv();
  calls = stubModelApi(() => new Response(JSON.stringify({ error: { message: 'credit balance too low' } }), { status: 400 }));
  r = await ask(worker, env, { q: 'hi' });
  check('an unrelated 400 is NOT retried', calls.length === 1 && r.status === 502);

  // -- health --------------------------------------------------------------
  console.log('\nhealth');
  env = baseEnv({ kv: { [CAP_KEY]: JSON.stringify({ usd: 1.2345, calls: 4 }) } });
  const health = await worker.fetch(new Request('https://worker.test/api/health', { headers: { Authorization: `Bearer ${TOKEN}` } }), env);
  const hj = await health.json();
  check('health reports today\'s spend', hj.ask_today_usd === 1.2345, JSON.stringify(hj));
  check('health reports the cap in force', hj.ask_cap_usd === 3);

  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\ntest run crashed:', e && e.stack);
  process.exit(1);
});
