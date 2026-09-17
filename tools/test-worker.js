#!/usr/bin/env node
/**
 * The Helm — Worker tests. Node, zero deps. Runs against a live `wrangler dev`.
 *
 *   cd worker && npx wrangler dev --port 8787     # terminal 1
 *   node tools/test-worker.js                     # terminal 2
 *
 * Env: HELM_BASE (default http://127.0.0.1:8787), HELM_ADMIN_SECRET.
 * Tokens used here are throwaway dev strings and are rewritten by the run.
 */

const BASE = process.env.HELM_BASE || 'http://127.0.0.1:8787';
const ADMIN = process.env.HELM_ADMIN_SECRET || 'dev-admin-secret-change-me';

const TOK_OWNER = 'dev-token-owner-0000000000';
const TOK_GUEST = 'dev-token-guest-0000000000';

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

async function call(method, path, { token, admin, body, raw, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (admin) headers['X-Admin-Secret'] = admin;
  if (origin) headers.Origin = origin;
  let payload;
  if (raw !== undefined) {
    payload = raw;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  console.log(`The Helm — Worker tests against ${BASE}\n`);

  // -- bootstrap: admin installs the token map ----------------------------
  console.log('admin auth');
  check('bad admin secret is 401', (await call('POST', '/api/admin/tokens', { admin: 'nope', body: {} })).status === 401);
  check('missing admin secret is 401', (await call('GET', '/api/admin/events')).status === 401);

  const seeded = await call('POST', '/api/admin/tokens', {
    admin: ADMIN,
    body: {
      [TOK_OWNER]: { name: 'Matt', role: 'owner' },
      [TOK_GUEST]: { name: 'Guest', role: 'reader' },
    },
  });
  check('admin sets the token map', seeded.status === 200 && seeded.json.tokens === 2, `status ${seeded.status} ${seeded.text}`);
  check('token map response echoes no token values', !seeded.text.includes(TOK_OWNER));

  const weak = await call('POST', '/api/admin/tokens', { admin: ADMIN, body: { short: { name: 'x', role: 'y' } } });
  check('short tokens are rejected', weak.status === 400 && weak.json.reason === 'weak_token');
  // restore the good map (the weak attempt was rejected before writing)
  await call('POST', '/api/admin/tokens', {
    admin: ADMIN,
    body: { [TOK_OWNER]: { name: 'Matt', role: 'owner' }, [TOK_GUEST]: { name: 'Guest', role: 'reader' } },
  });

  // -- token auth ---------------------------------------------------------
  console.log('\ntoken auth');
  check('no token is 401', (await call('GET', '/api/data')).status === 401);
  check('unknown token is 401', (await call('GET', '/api/data', { token: 'not-a-real-token-xxxx' })).status === 401);
  check('?t= query token works', (await call('GET', `/api/data?t=${TOK_OWNER}`)).status === 200);
  check('Bearer token works', (await call('GET', '/api/data', { token: TOK_OWNER })).status === 200);

  // -- snapshot validation ------------------------------------------------
  console.log('\nsnapshot publish');
  check('unparseable snapshot is 400', (await call('POST', '/api/admin/publish', { admin: ADMIN, raw: '{nope' })).json?.reason === 'bad_json');
  const noSchema = await call('POST', '/api/admin/publish', { admin: ADMIN, raw: JSON.stringify({ tiles: {} }) });
  check('snapshot without `schema` is 400', noSchema.status === 400 && noSchema.json.reason === 'no_schema');
  check('non-object snapshot is 400', (await call('POST', '/api/admin/publish', { admin: ADMIN, raw: '[1,2,3]' })).json?.reason === 'bad_shape');

  const { execSync } = await import('node:child_process');
  const mock = execSync('node tools/make-mock-data.js', { cwd: new URL('..', import.meta.url).pathname }).toString();
  const published = await call('POST', '/api/admin/publish', { admin: ADMIN, raw: mock });
  check('mock snapshot publishes', published.status === 200 && published.json.schema === 1, published.text);

  const data = await call('GET', '/api/data', { token: TOK_OWNER });
  check('GET /api/data returns me', data.json?.me?.name === 'Matt' && data.json.me.role === 'owner');
  check('GET /api/data returns the snapshot', data.json?.snapshot?.schema === 1);
  check('GET /api/data carries every mock tile', Object.keys(data.json?.snapshot?.tiles || {}).length === 8);
  check('GET /api/data returns a pending array', Array.isArray(data.json?.pending));

  // -- event shape rejection ---------------------------------------------
  console.log('\nevent validation');
  const bad = [
    ['unknown type', { type: 'launch_missile', payload: {} }, 'bad_type'],
    ['missing type', { payload: {} }, 'bad_type'],
    ['meal_verdict bad date', { type: 'meal_verdict', payload: { date: '9/17/2026', verdict: 'HIT' } }, 'bad_payload'],
    ['meal_verdict bad verdict', { type: 'meal_verdict', payload: { date: '2026-09-17', verdict: 'YUM' } }, 'bad_payload'],
    ['field_note empty text', { type: 'field_note', payload: { text: '   ' } }, 'bad_payload'],
    ['mileage non-integer', { type: 'mileage', payload: { odometer: 74812.5, kind: 'business' } }, 'bad_payload'],
    ['mileage bad kind', { type: 'mileage', payload: { odometer: 74812, kind: 'joyride' } }, 'bad_payload'],
    ['build_request no payload', { type: 'build_request' }, 'bad_payload'],
  ];
  for (const [name, body, reason] of bad) {
    const r = await call('POST', '/api/event', { token: TOK_OWNER, body });
    check(`rejects ${name}`, r.status === 400 && r.json.reason === reason, `got ${r.status} ${r.text}`);
  }
  check('rejects unparseable event body', (await call('POST', '/api/event', { token: TOK_OWNER, raw: '{' })).json?.reason === 'bad_json');

  // -- happy path: all four types ----------------------------------------
  console.log('\nevent write');
  const good = [
    { type: 'meal_verdict', payload: { date: '2026-09-17', verdict: 'HIT' } },
    { type: 'build_request', payload: { text: 'a tile for shop consumables' } },
    { type: 'field_note', payload: { text: 'compressor cycling short again' } },
    { type: 'mileage', payload: { odometer: 74812, kind: 'business', note: null } },
  ];
  const stored = [];
  for (const body of good) {
    const r = await call('POST', '/api/event', { token: TOK_OWNER, body });
    check(`accepts ${body.type}`, r.status === 201 && r.json.type === body.type, `got ${r.status} ${r.text}`);
    if (r.json?.id) stored.push(r.json);
  }
  check('events are stamped with id, ts, actor', stored.every((e) => e.id && e.ts && e.actor === 'Matt'));
  check('ts is UTC ISO-8601', stored.every((e) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(e.ts)));

  // -- one KV key per event (no array key would survive this) -------------
  console.log('\nper-event KV keys');
  const burst = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      call('POST', '/api/event', { token: TOK_OWNER, body: { type: 'field_note', payload: { text: `burst ${i}` } } })
    )
  );
  const burstIds = burst.map((r) => r.json?.id).filter(Boolean);
  check('6 concurrent writes all return 201', burst.every((r) => r.status === 201));
  check('6 concurrent writes get 6 distinct ids', new Set(burstIds).size === 6);

  const adminEvents = await call('GET', '/api/admin/events', { admin: ADMIN });
  check('admin sees all 10 events (none lost to a racing append)', adminEvents.json?.count === 10, `count ${adminEvents.json?.count}`);
  check('admin events are sorted by ts', adminEvents.json.events.map((e) => e.id).join() === [...adminEvents.json.events.map((e) => e.id)].sort().join());

  const pendingNow = await call('GET', '/api/data', { token: TOK_OWNER });
  check('GET /api/data surfaces the 10 pending events', pendingNow.json?.pending?.length === 10);

  // -- delete: the undo valve --------------------------------------------
  console.log('\ndelete event');
  const victim = stored[0].id;
  check('malformed id is 400', (await call('DELETE', '/api/event/not-an-id', { token: TOK_OWNER })).json?.reason === 'bad_id');
  check('id aimed at another KV key is 400', (await call('DELETE', '/api/event/tokens', { token: TOK_OWNER })).json?.reason === 'bad_id');
  const wrongActor = await call('DELETE', `/api/event/${encodeURIComponent(victim)}`, { token: TOK_GUEST });
  check('a different actor cannot delete', wrongActor.status === 403 && wrongActor.json.reason === 'not_actor', wrongActor.text);
  const delOk = await call('DELETE', `/api/event/${encodeURIComponent(victim)}`, { token: TOK_OWNER });
  check('the author can delete', delOk.status === 200 && delOk.json.deleted === victim, delOk.text);
  check('deleting twice is 404 (drained)', (await call('DELETE', `/api/event/${encodeURIComponent(victim)}`, { token: TOK_OWNER })).status === 404);
  check('count drops by exactly one', (await call('GET', '/api/admin/events', { admin: ADMIN })).json.count === 9);

  // -- ack drains only what was named ------------------------------------
  console.log('\nadmin ack');
  const ackBad = await call('POST', '/api/admin/events/ack', { admin: ADMIN, body: { ids: 'nope' } });
  check('ack without an ids array is 400', ackBad.status === 400 && ackBad.json.reason === 'bad_shape');
  const ack = await call('POST', '/api/admin/events/ack', { admin: ADMIN, body: { ids: [...burstIds, 'snapshot'] } });
  check('ack drains the 6 named events', ack.json?.acked === 6, ack.text);
  check('ack rejects a non-event id', ack.json.rejected.includes('snapshot'));
  check('3 events remain', (await call('GET', '/api/admin/events', { admin: ADMIN })).json.count === 3);

  // -- health -------------------------------------------------------------
  console.log('\nhealth');
  const health = await call('GET', '/api/health', { token: TOK_OWNER });
  check('health reports published_at', typeof health.json?.published_at === 'string');
  check('health reports pending_count', health.json.pending_count === 3);
  check('health reports ask_today_usd', health.json.ask_today_usd === 0);
  check('health needs a token', (await call('GET', '/api/health')).status === 401);

  // -- ask seam (M4) ------------------------------------------------------
  console.log('\nask seam');
  check('ask needs a token', (await call('POST', '/api/ask', { body: { q: 'hi' } })).status === 401);
  const ask = await call('POST', '/api/ask', { token: TOK_OWNER, body: { q: 'what is open?' } });
  check('ask is a documented 503 until M4', ask.status === 503 && ask.json.reason === 'not_implemented', ask.text);
  check('ask rejects an empty q', (await call('POST', '/api/ask', { token: TOK_OWNER, body: { q: '' } })).status === 400);

  // -- CORS ---------------------------------------------------------------
  console.log('\nCORS');
  const pre = await call('OPTIONS', '/api/data', { origin: 'https://mlancourt.github.io' });
  check('preflight from Pages is 204', pre.status === 204);
  check('preflight echoes the Pages origin', pre.headers.get('access-control-allow-origin') === 'https://mlancourt.github.io');
  const local = await call('OPTIONS', '/api/data', { origin: 'http://localhost:5173' });
  check('localhost dev origin is allowed', local.headers.get('access-control-allow-origin') === 'http://localhost:5173');
  const evil = await call('OPTIONS', '/api/data', { origin: 'https://evil.example' });
  check('an unknown origin gets no allow-origin header', !evil.headers.get('access-control-allow-origin'));

  // -- routing ------------------------------------------------------------
  console.log('\nrouting');
  check('unknown api route is 404 JSON', (await call('GET', '/api/nope', { token: TOK_OWNER })).json?.reason === 'no_route');
  check('unknown admin route is 404 JSON', (await call('GET', '/api/admin/nope', { admin: ADMIN })).json?.reason === 'no_route');
  check('root is 404 JSON', (await call('GET', '/')).json?.reason === 'no_route');

  // -- leave the namespace clean -----------------------------------------
  const left = (await call('GET', '/api/admin/events', { admin: ADMIN })).json.events.map((e) => e.id);
  await call('POST', '/api/admin/events/ack', { admin: ADMIN, body: { ids: left } });

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\ntest run crashed:', e.message);
  console.error(`is \`wrangler dev\` up at ${BASE}?`);
  process.exit(1);
});
