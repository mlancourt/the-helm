#!/usr/bin/env node
/**
 * The Helm — /top (Newsstand Top Stories, N11–N16) Worker tests. Node, zero
 * deps, no wrangler, no network, no key.
 *
 *   node tools/test-top.js
 *
 * Same harness shape as tools/test-draft.js: worker.js driven directly
 * against a fake KV and a stubbed model API. Spec Tests 7–11 are the
 * sections below, in order. Every headline here is invented.
 *
 * Never asserted: the CONTENT of `top:sys`. The taste prompt is the vault
 * owner's (N12); this file only proves it is plumbed.
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
const TOKEN = 'test-token-owner-000000';
const HOUR = 3_600_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

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

/** Distinct invented headlines: no two share enough words to look like twins. */
const WORDS = 'amber basalt cobalt dune ember fjord garnet harbor indigo juniper kestrel lagoon meadow nimbus onyx prairie quartz ridge sierra tundra umber valley willow xenon yarrow zephyr'.split(' ');
function headline(i) {
  return `${WORDS[i % 26]} ${WORDS[(i * 7 + 3) % 26]} ${WORDS[(i * 11 + 5) % 26]} report ${i} n${i}`;
}

function mkCard(i, over = {}) {
  return {
    title: headline(i),
    synopsis: null,
    source: `Source ${i % 9}`,
    url: `https://example.test/story/${i}`,
    lens: null,
    category: 'Tech',
    emoji: '💻',
    published_at: iso(HOUR),
    ...over,
  };
}

function snapshot(cards, asOf = iso(10 * 60_000)) {
  return JSON.stringify({ schema: 1, tiles: { newsstand: { band: 'HOURLY', status: 'ok', data: { cards, as_of: asOf } } } });
}

function baseEnv({ kv = {}, env = {} } = {}) {
  return {
    HELM_KV: makeKV({
      tokens: JSON.stringify({ [TOKEN]: { name: 'Matt', role: 'owner' } }),
      'top:sys': 'You rank stories. (test stand-in for the vault prompt)',
      ...kv,
    }),
    ADMIN_SECRET: 'test-admin',
    ANTHROPIC_API_KEY: 'test-key',
    ...env,
  };
}

function apiOk(text, usage = { input_tokens: 18000, output_tokens: 1500 }) {
  return new Response(JSON.stringify({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A model that scores by a function of the input it was actually sent. */
function stubModel(scoreFor) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body });
    const user = body.messages[0].content;
    const input = JSON.parse(user.split('\n').pop());
    const out = scoreFor(input, calls.length);
    return apiOk(typeof out === 'string' ? out : JSON.stringify(out));
  };
  return calls;
}

async function call(worker, env, { path = '/api/top', method = 'POST', body, token = TOKEN, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && typeof body !== 'string') h['Content-Type'] = 'application/json';
  const res = await worker.fetch(
    new Request(`https://worker.test${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* empty or non-JSON */
  }
  return { status: res.status, json, text };
}

(async () => {
  const realFetch = globalThis.fetch;
  const W = await import('../worker/worker.js');
  const worker = W.default;
  const now = Date.now();

  // ---- plumbing ---------------------------------------------------------
  console.log('plumbing');
  {
    const env = baseEnv();
    const g = await call(worker, env, { method: 'GET' });
    check('GET with no cache is 204', g.status === 204 && g.text === '', `${g.status} ${g.text}`);
    check('GET without a token is 401', (await call(worker, env, { method: 'GET', token: '' })).status === 401);
    check('POST without a token is 401', (await call(worker, env, { token: '' })).status === 401);

    const put = await call(worker, env, {
      path: '/api/admin/top-system', method: 'PUT', body: 'taste ✓', token: '',
      headers: { 'X-Admin-Secret': 'test-admin', 'Content-Type': 'text/plain' },
    });
    check('admin PUT stores top:sys', put.status === 200 && env.HELM_KV.map.get('top:sys') === 'taste ✓', put.text);
    check('and reports UTF-8 bytes, never the text', put.json?.bytes === 9 && !put.text.includes('taste'), put.text);
    const bad = await call(worker, env, { path: '/api/admin/top-system', method: 'PUT', body: 'x', token: '', headers: { 'X-Admin-Secret': 'nope' } });
    check('a bad admin secret is 401', bad.status === 401);
    const empty = await call(worker, env, { path: '/api/admin/top-system', method: 'PUT', body: '  ', token: '', headers: { 'X-Admin-Secret': 'test-admin' } });
    check('an empty prompt is refused', empty.status === 400);
    check('POST with broken JSON is 400', (await call(worker, env, { body: '{nope' })).status === 400);
  }

  // ---- Test 7: 200 cards -> ten rows; the 36 h half-life ---------------------
  console.log('\nTest 7 — 200 cards, ten rows, the half-life');
  {
    const cards = Array.from({ length: 200 }, (_, i) => mkCard(i, { published_at: iso(((i % 50) + 1) * HOUR) }));
    const env = baseEnv({ kv: { snapshot: snapshot(cards) } });
    const calls = stubModel((input) => input.map((x) => ({ i: x.i, s: x.i % 101 })));
    const r = await call(worker, env, { body: {} });
    check('200 with a body', r.status === 200, r.text.slice(0, 200));
    check('ten rows', r.json?.cards?.length === 10, String(r.json?.cards?.length));
    check('ranks 1..10 in order', r.json.cards.every((c, k) => c.rank === k + 1));
    check('scores never rise down the list', r.json.cards.every((c, k, a) => k === 0 || a[k - 1].score >= c.score));
    check('each row is the whole original card plus rank and score', r.json.cards.every((c) => c.url && c.title && c.emoji && 'score' in c));
    check('fresh:true, capped:false, error:null', r.json.fresh === true && r.json.capped === false && r.json.error === null);
    check('model and as_of are carried', r.json.model === 'claude-sonnet-5-5' && typeof r.json.as_of === 'string');
    check('usd is booked', r.json.usd > 0);
    check('one model call', calls.length === 1);
    check('the model is Sonnet 5.5', calls[0].body.model === 'claude-sonnet-5-5');
    check('the system block is cached', calls[0].body.system[0].cache_control?.type === 'ephemeral');
    const sent = JSON.parse(calls[0].body.messages[0].content.split('\n').pop());
    check('every card is sent with i', sent.length === 200 && sent.every((x, k) => x.i === k));
    check('the model input carries no url (N12)', !calls[0].body.messages[0].content.includes('example.test'));
    check('the input keys are exactly i/title/synopsis/source/category/age_h',
      Object.keys(sent[0]).sort().join() === 'age_h,category,i,source,synopsis,title');
    check('top:latest is written', JSON.parse(env.HELM_KV.map.get('top:latest')).cards.length === 10);
    const g = await call(worker, env, { method: 'GET' });
    check('GET now returns the cached ten', g.status === 200 && g.json.cards.length === 10 && g.json.cards[0].url === r.json.cards[0].url);
    check('the spend lands on the top line', JSON.parse(env.HELM_KV.map.get(`top:cap:${TODAY}`)).usd === r.json.usd);
    check('and on the shared counter (rule 11)', JSON.parse(env.HELM_KV.map.get(`ask:cap:${TODAY}`)).usd === r.json.usd);

    // The spec's example: a 72 h-old 90 ranks below a 0 h 50.
    const pair = [mkCard(0, { published_at: iso(72 * HOUR) }), mkCard(1, { published_at: iso(0) })];
    const ranked = W.rankTop(pair, [90, 50], now);
    check('72 h-old 90 (22.5) ranks below a fresh 50', ranked[0].title === pair[1].title && ranked[1].title === pair[0].title);
    check('90 × 0.5^(72/36) = 22.5', Math.abs(ranked[1].score - 22.5) < 0.1, String(ranked[1].score));
    check('a 36 h-old 80 scores 40', Math.abs(W.rankTop([mkCard(0, { published_at: new Date(now - 36 * HOUR).toISOString() })], [80], now)[0].score - 40) < 0.05);
    const nul = W.rankTop([mkCard(0, { published_at: null })], [80], now);
    check('null published_at ages as 72 h (80 -> 20)', Math.abs(nul[0].score - 20) < 0.05, String(nul[0].score));
    check('topAgeHours(null) is 72', W.topAgeHours(null, now) === 72);
    check('topAgeHours of garbage is 72', W.topAgeHours('not a date', now) === 72);
    check('the model input sends null age as 72', W.topModelInput([mkCard(0, { published_at: null })], now)[0].age_h === 72);
    const tie = W.rankTop([mkCard(0, { published_at: iso(2 * HOUR) }), mkCard(1, { published_at: iso(2 * HOUR - 1) })], [0, 0], now);
    check('ties go to the newer card', tie[0].title === headline(1));
    check('fewer than ten on the board returns them all', W.rankTop([mkCard(0), mkCard(1)], [10, 20], now).length === 2);
  }

  // ---- Test 8: the sports cap -------------------------------------------------
  console.log('\nTest 8 — the sports cap');
  {
    const SPORTS = ['Local Sports', 'Soccer', 'Betting'];
    const cards = [
      ...Array.from({ length: 8 }, (_, i) => mkCard(i, { category: SPORTS[i % 3] })),
      ...Array.from({ length: 12 }, (_, i) => mkCard(i + 8, { category: i % 2 ? 'Science' : 'Politics' })),
    ];
    const scores = cards.map((_, i) => 100 - i);
    const out = W.rankTop(cards, scores, now);
    const sports = out.filter((c) => SPORTS.includes(c.category));
    check('top 8 raw are sports -> exactly 3 sports rows', sports.length === 3, String(sports.length));
    check('and 7 non-sports', out.length - sports.length === 7);
    check('the three seated sports are the top three raw', sports.map((c) => c.title).join() === cards.slice(0, 3).map((c) => c.title).join(), sports.map((c) => c.title).join('|'));

    const cardsCards = Array.from({ length: 12 }, (_, i) => mkCard(i, { category: 'Cards' }));
    const outCards = W.rankTop(cardsCards, cardsCards.map((_, i) => 100 - i), now);
    check('Cards is never capped — ten Cards rows', outCards.length === 10 && outCards.every((c) => c.category === 'Cards'));

    const thin = [
      ...Array.from({ length: 12 }, (_, i) => mkCard(i, { category: SPORTS[i % 3] })),
      mkCard(20, { category: 'Tech' }),
      mkCard(21, { category: 'Science' }),
    ];
    const outThin = W.rankTop(thin, thin.map((_, i) => 100 - i), now);
    check('only 2 non-sports still returns 10', outThin.length === 10, String(outThin.length));
    check('both non-sports are in', outThin.filter((c) => !SPORTS.includes(c.category)).length === 2);
    check('the soft fill is still in rank order', outThin.every((c, k, a) => k === 0 || a[k - 1].score >= c.score));
    check('a near-miss spelling is not sports ("local sports")',
      W.rankTop(Array.from({ length: 10 }, (_, i) => mkCard(i, { category: 'local sports' })), Array(10).fill(50), now).length === 10);
  }

  // ---- Test 9: the duplicate bump ---------------------------------------------
  console.log('\nTest 9 — the duplicate bump');
  {
    const a = mkCard(0, { title: 'Packers sign veteran kicker after preseason injury', source: 'Acme Packing Co', category: 'Science' });
    const b = mkCard(1, { title: 'Packers sign a veteran kicker after preseason injury!', source: 'WPR', category: 'Science' });
    const lone = mkCard(2, { title: 'Quiet comet passes the outer planets', source: 'Phys.org', category: 'Science' });
    check('the pair is a Jaccard ≥ 0.6 twin', W.jaccard(W.titleTokens(a.title), W.titleTokens(b.title)) >= 0.6);
    check('normalization drops punctuation and stopwords', [...W.titleTokens('The Packers, a team!')].join() === 'packers,team');
    const out = W.rankTop([a, b, lone], [50, 40, 55], now);
    const ofPair = out.filter((c) => c.title === a.title || c.title === b.title);
    check('one of the pair is dropped', ofPair.length === 1, String(ofPair.length));
    check('the higher twin is kept', ofPair[0].title === a.title);
    const base = 50 * 0.5 ** (1 / 36);
    check('it carries +10 once', Math.abs(ofPair[0].score - (base + 10)) < 0.11, `${ofPair[0].score} vs ${base + 10}`);
    check('the bump lifts it over a raw 55', out[0].title === a.title);

    const tri = W.rankTop([a, b, mkCard(3, { title: 'Packers sign veteran kicker after preseason injury', source: 'Brew Hoop', category: 'Science' })], [50, 40, 30], now);
    check('three twins: one row, +10 once not twice', tri.length === 1 && Math.abs(tri[0].score - (base + 10)) < 0.11, JSON.stringify(tri.map((c) => c.score)));

    const sameA = { ...a, source: 'WPR' };
    const same = W.rankTop([sameA, b], [50, 40], now);
    check('same source: no bump', Math.abs(same[0].score - base) < 0.11, String(same[0].score));
    check('same source: both kept', same.length === 2);
    check('unrelated titles are not twins', W.jaccard(W.titleTokens(a.title), W.titleTokens(lone.title)) < 0.6);
  }

  // ---- Test 10: bad shape -> one retry -> cached list + error -----------------
  console.log('\nTest 10 — bad shape, one retry, fail closed');
  {
    const cards = Array.from({ length: 30 }, (_, i) => mkCard(i));
    const cache = { ranked_at: iso(9 * HOUR), as_of: iso(10 * HOUR), model: 'claude-sonnet-5-5', usd: 0.07, fresh: true, capped: false, error: null,
      cards: [{ rank: 1, score: 80, ...mkCard(99) }] };
    const env = baseEnv({ kv: { snapshot: snapshot(cards), 'top:latest': JSON.stringify(cache) } });
    const calls = stubModel(() => 'Here are my thoughts on the news today.');
    const r = await call(worker, env, { body: {} });
    check('no 5xx — 200', r.status === 200, String(r.status));
    check('exactly two model calls (one retry)', calls.length === 2, String(calls.length));
    check('the cached list is returned', r.json.cards.length === 1 && r.json.cards[0].url === cache.cards[0].url);
    check('error is set and names the ranker', typeof r.json.error === 'string' && r.json.error.startsWith('ranker: '), r.json.error);
    check('fresh:false', r.json.fresh === false);
    check('the cache is not overwritten', JSON.parse(env.HELM_KV.map.get('top:latest')).ranked_at === cache.ranked_at);
    check('both failed calls are still booked', JSON.parse(env.HELM_KV.map.get(`top:cap:${TODAY}`)).usd > 0);

    const env2 = baseEnv({ kv: { snapshot: snapshot(cards) } });
    let n = 0;
    stubModel((input) => (++n === 1 ? input.slice(1).map((x) => ({ i: x.i, s: 5 })) : input.map((x) => ({ i: x.i, s: 5 }))));
    const r2 = await call(worker, env2, { body: {} });
    check('a missing index on try 1, good on try 2 -> ranked', r2.json.fresh === true && r2.json.cards.length === 10 && n === 2);

    const env3 = baseEnv({ kv: { snapshot: snapshot(cards) } });
    stubModel(() => '[{"i":0,"s":5}]');
    const r3 = await call(worker, env3, { body: {} });
    check('no cache + failure -> 200, empty cards, error', r3.status === 200 && Array.isArray(r3.json.cards) && r3.json.cards.length === 0 && /^ranker: /.test(r3.json.error));

    const env4 = baseEnv({ kv: { snapshot: snapshot(cards) } });
    globalThis.fetch = async () => new Response('{"type":"error","error":{"message":"overloaded"}}', { status: 529 });
    const r4 = await call(worker, env4, { body: {} });
    check('an upstream 5xx is a 200 with error, never a 5xx', r4.status === 200 && /^ranker: /.test(r4.json.error), r4.text);

    check('parse: a duplicate index fails', !!W.parseTopScores('[{"i":0,"s":1},{"i":0,"s":2}]', 2).reason);
    check('parse: a score over 100 fails', !!W.parseTopScores('[{"i":0,"s":101}]', 1).reason);
    check('parse: a negative score fails', !!W.parseTopScores('[{"i":0,"s":-1}]', 1).reason);
    check('parse: an index out of range fails', !!W.parseTopScores('[{"i":1,"s":1}]', 1).reason);
    check('parse: a fenced array is fine', W.parseTopScores('```json\n[{"i":0,"s":42}]\n```', 1).scores?.[0] === 42);
  }

  // ---- Test 11: N14 triggers and the cap ---------------------------------------
  console.log('\nTest 11 — refresh triggers and the cap');
  {
    const cards = Array.from({ length: 20 }, (_, i) => mkCard(i));
    const good = () => stubModel((input) => input.map((x) => ({ i: x.i, s: 50 })));
    const cached = (rankedAgo, asOfAgo) => JSON.stringify({ ranked_at: iso(rankedAgo), as_of: iso(asOfAgo), model: 'claude-sonnet-5-5', usd: 0.07,
      fresh: true, capped: false, error: null, cards: [{ rank: 1, score: 70, ...mkCard(99) }] });

    let env = baseEnv({ kv: { snapshot: snapshot(cards, iso(5 * 60_000)), 'top:latest': cached(2 * HOUR, 3 * HOUR) } });
    let calls = good();
    let r = await call(worker, env, { body: {} });
    check('cache < 6 h (board newer) -> fresh:false', r.json.fresh === false && r.json.cards[0].url === mkCard(99).url);
    check('and no model call', calls.length === 0);

    const sameAsOf = iso(8 * HOUR);
    env = baseEnv({ kv: { snapshot: snapshot(cards, sameAsOf), 'top:latest': JSON.stringify({ ...JSON.parse(cached(7 * HOUR, 0)), as_of: sameAsOf }) } });
    calls = good();
    r = await call(worker, env, { body: {} });
    check('cache > 6 h, as_of unchanged -> no model call', calls.length === 0 && r.json.fresh === false);

    env = baseEnv({ kv: { snapshot: snapshot(cards, iso(10 * 60_000)), 'top:latest': cached(7 * HOUR, 8 * HOUR) } });
    calls = good();
    r = await call(worker, env, { body: {} });
    check('cache > 6 h and a newer as_of -> model call', calls.length === 1 && r.json.fresh === true);

    env = baseEnv({ kv: { snapshot: snapshot(cards), 'top:latest': cached(10 * 60_000, 10 * 60_000) } });
    calls = good();
    r = await call(worker, env, { body: { force: true } });
    check('force always calls, even on a 10-minute-old cache', calls.length === 1 && r.json.fresh === true);
    check('a truthy non-boolean is not force', (calls = good(), await call(worker, env, { body: { force: 'yes' } }), calls.length === 0));

    env = baseEnv({ kv: { snapshot: snapshot(cards) } });
    calls = good();
    r = await call(worker, env, { body: '' });
    check('no cache -> model call (an empty body is {})', calls.length === 1 && r.json.fresh === true);

    env = baseEnv({
      kv: { snapshot: snapshot(cards), 'top:latest': cached(7 * HOUR, 8 * HOUR), [`top:cap:${TODAY}`]: JSON.stringify({ usd: 0.5, calls: 7 }) },
    });
    calls = good();
    r = await call(worker, env, { body: { force: true } });
    check('over TOP_DAILY_CAP_USD -> no model call, even forced', calls.length === 0);
    check('-> the cached list with capped:true', r.status === 200 && r.json.capped === true && r.json.cards.length === 1);

    env = baseEnv({
      kv: { snapshot: snapshot(cards), [`top:cap:${TODAY}`]: JSON.stringify({ usd: 0.2, calls: 3 }) },
      env: { TOP_DAILY_CAP_USD: '0.10' },
    });
    calls = good();
    r = await call(worker, env, { body: {} });
    check('the cap is configurable by TOP_DAILY_CAP_USD', calls.length === 0 && r.json.capped === true);
    check('capped with no cache -> {cards:[]}', Array.isArray(r.json.cards) && r.json.cards.length === 0);

    env = baseEnv({ kv: { snapshot: snapshot(cards), [`ask:cap:${TODAY}`]: JSON.stringify({ usd: 3, calls: 40 }) } });
    calls = good();
    r = await call(worker, env, { body: {} });
    check('the shared $3 cap also stops a ranking (rule 11)', calls.length === 0 && r.json.capped === true);

    env = baseEnv({ kv: { snapshot: snapshot(cards), [`top:cap:${TODAY}`]: JSON.stringify({ usd: 0.1234, calls: 2 }) } });
    const h = await call(worker, env, { path: '/api/health', method: 'GET' });
    check('health reports the top line and its cap', h.json?.top_today_usd === 0.1234 && h.json?.top_cap_usd === 0.5, h.text);

    env = baseEnv({ kv: { snapshot: snapshot(cards) } });
    env.HELM_KV.map.delete('top:sys');
    calls = good();
    r = await call(worker, env, { body: {} });
    check('no top:sys -> no call, 200 with error', calls.length === 0 && r.status === 200 && /^ranker: /.test(r.json.error));
  }

  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('\ntest run crashed:', e && e.stack);
  process.exit(1);
});
