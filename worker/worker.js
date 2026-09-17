/**
 * The Helm — Cloudflare Worker (API + KV + /ask proxy seam).
 *
 * Single self-contained file on purpose: dashboard-paste stays a viable
 * fallback if wrangler is ever unavailable. Plain JS, no build step.
 *
 * Bindings
 *   HELM_KV        KV namespace (see README for key design)
 * Secrets
 *   ADMIN_SECRET       required — guards /api/admin/*
 *   ASK_DAILY_CAP_USD  optional — default 3.00 (M4)
 *   ASK_MODEL          optional (M4)
 *   ANTHROPIC_API_KEY  optional (M4) — never reaches the page
 */

// ---------------------------------------------------------------- constants

const ALLOWED_ORIGIN_EXACT = new Set(['https://mlancourt.github.io']);
const ALLOWED_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAX_EVENT_BYTES = 16 * 1024;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_ASK_SYSTEM_BYTES = 256 * 1024;
const MAX_TOKENS_BYTES = 64 * 1024;
const MAX_TEXT_LEN = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// id == the KV key minus the "evt:" prefix. Strict so a caller can never
// steer a delete at `tokens`, `snapshot`, or anything else in the namespace.
const EVENT_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z:[0-9a-z]{6}$/;

const DEFAULT_ASK_CAP_USD = 3.0;

// ------------------------------------------------------------------ helpers

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const h = { Vary: 'Origin' };
  if (ALLOWED_ORIGIN_EXACT.has(origin) || ALLOWED_ORIGIN_RE.test(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Admin-Secret';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
      ...extra,
    },
  });
}

function err(request, status, reason, detail) {
  const body = { error: true, reason };
  if (detail) body.detail = detail;
  return json(request, body, status);
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nonEmptyText(v, max = MAX_TEXT_LEN) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

/** Constant-time string compare for the admin secret. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function rand6() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(36);
  return s.slice(0, 6);
}

function utcNowIso() {
  return new Date().toISOString();
}

/** UTC day, YYYY-MM-DD — the spend-cap bucket. */
function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function readTextCapped(request, max) {
  const len = Number(request.headers.get('Content-Length') || '0');
  if (len > max) return { tooBig: true };
  const text = await request.text();
  // Content-Length can lie or be absent (chunked); check the real thing too.
  if (new TextEncoder().encode(text).length > max) return { tooBig: true };
  return { text };
}

async function readJsonCapped(request, max) {
  const r = await readTextCapped(request, max);
  if (r.tooBig) return { tooBig: true };
  try {
    return { value: JSON.parse(r.text) };
  } catch {
    return { bad: true };
  }
}

// --------------------------------------------------------------------- auth

/** Token from `?t=` or `Authorization: Bearer`. Values are never logged. */
function extractToken(request, url) {
  const auth = request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const t = url.searchParams.get('t');
  return t ? t.trim() : '';
}

/**
 * Resolve a caller. The token map is a MAP, not a constant — a second
 * read-only token can be added later with no code change.
 * Returns {name, role} or null.
 */
async function resolveCaller(env, token) {
  if (!token) return null;
  const raw = await env.HELM_KV.get('tokens');
  if (!raw) return null;
  let map;
  try {
    map = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(map)) return null;
  const who = map[token];
  if (!isObj(who)) return null;
  return { name: String(who.name || 'unknown'), role: String(who.role || 'owner') };
}

function adminOk(request, env) {
  const secret = env.ADMIN_SECRET;
  if (!secret) return false;
  return safeEqual(request.headers.get('X-Admin-Secret') || '', secret);
}

// ----------------------------------------------------------- event contract

/**
 * Exactly these four types. Anything else is a 400 with a reason.
 * Each validator returns null (ok) or a human reason string.
 */
const EVENT_VALIDATORS = {
  meal_verdict(p) {
    if (!isObj(p)) return 'payload must be an object';
    if (!DATE_RE.test(String(p.date || ''))) return 'payload.date must be YYYY-MM-DD';
    if (!['HIT', 'MISS', 'MEH'].includes(p.verdict)) {
      return 'payload.verdict must be one of HIT, MISS, MEH';
    }
    return null;
  },
  build_request(p) {
    if (!isObj(p)) return 'payload must be an object';
    if (!nonEmptyText(p.text)) return `payload.text must be a non-empty string (max ${MAX_TEXT_LEN})`;
    return null;
  },
  field_note(p) {
    if (!isObj(p)) return 'payload must be an object';
    if (!nonEmptyText(p.text)) return `payload.text must be a non-empty string (max ${MAX_TEXT_LEN})`;
    return null;
  },
  mileage(p) {
    if (!isObj(p)) return 'payload must be an object';
    if (!Number.isInteger(p.odometer) || p.odometer < 0 || p.odometer > 9999999) {
      return 'payload.odometer must be an integer between 0 and 9999999';
    }
    if (!['business', 'personal'].includes(p.kind)) {
      return 'payload.kind must be one of business, personal';
    }
    if (!(p.note === null || p.note === undefined || nonEmptyText(p.note))) {
      return `payload.note must be null or a non-empty string (max ${MAX_TEXT_LEN})`;
    }
    return null;
  },
};

const EVENT_TYPES = Object.keys(EVENT_VALIDATORS);

// ------------------------------------------------------------- KV: events

async function listEventKeys(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.HELM_KV.list({ prefix: 'evt:', cursor });
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  keys.sort(); // ISO-prefixed keys sort chronologically
  return keys;
}

async function readEvents(env) {
  const keys = await listEventKeys(env);
  const raws = await Promise.all(keys.map((k) => env.HELM_KV.get(k)));
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    if (!raws[i]) continue; // drained between list and get — fine
    try {
      out.push(JSON.parse(raws[i]));
    } catch {
      out.push({ id: keys[i].slice(4), corrupt: true });
    }
  }
  return out;
}

// -------------------------------------------------------------- KV: ask cap

async function askSpendToday(env) {
  const raw = await env.HELM_KV.get(`ask:cap:${utcDay()}`);
  if (!raw) return { usd: 0, calls: 0 };
  try {
    const v = JSON.parse(raw);
    return { usd: Number(v.usd) || 0, calls: Number(v.calls) || 0 };
  } catch {
    return { usd: 0, calls: 0 };
  }
}

function askCapUsd(env) {
  const n = Number(env.ASK_DAILY_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ASK_CAP_USD;
}

/**
 * The one swappable seam. v1 (M4) calls the Anthropic Messages API from
 * here; Phase 2 swaps the body for a Cloudflare Tunnel fetch. The page
 * never learns which — it only ever sees {answer, mode, usd}.
 */
async function askBackend(/* env, { q, tile_id, tile_data, history, system } */) {
  return { notImplemented: true };
}

// ------------------------------------------------------------------ routes

async function handleGetData(request, env, caller) {
  const raw = await env.HELM_KV.get('snapshot');
  let snapshot = null;
  let snapshot_error = null;
  if (raw) {
    try {
      snapshot = JSON.parse(raw);
    } catch {
      snapshot_error = 'stored snapshot is not valid JSON';
    }
  }
  const pending = await readEvents(env);
  return json(request, { me: caller, snapshot, snapshot_error, pending });
}

async function handlePostEvent(request, env, caller) {
  const r = await readJsonCapped(request, MAX_EVENT_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', `event body exceeds ${MAX_EVENT_BYTES} bytes`);
  if (r.bad) return err(request, 400, 'bad_json', 'body must be valid JSON');

  const body = r.value;
  if (!isObj(body)) return err(request, 400, 'bad_shape', 'body must be an object');

  const type = body.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_VALIDATORS, type)) {
    return err(request, 400, 'bad_type', `type must be one of: ${EVENT_TYPES.join(', ')}`);
  }
  const why = EVENT_VALIDATORS[type](body.payload);
  if (why) return err(request, 400, 'bad_payload', why);

  const ts = utcNowIso();
  const id = `${ts}:${rand6()}`;
  const event = { id, ts, actor: caller.name, type, payload: body.payload };

  // One KV key per event. KV has no atomic append, so a single array key
  // would drop writes whenever two events raced.
  await env.HELM_KV.put(`evt:${id}`, JSON.stringify(event));
  return json(request, event, 201);
}

async function handleDeleteEvent(request, env, caller, rawId) {
  let id;
  try {
    id = decodeURIComponent(rawId || '');
  } catch {
    return err(request, 400, 'bad_id', 'id is not valid percent-encoding');
  }
  if (!EVENT_ID_RE.test(id)) return err(request, 400, 'bad_id', 'id is not a well-formed event id');

  const key = `evt:${id}`;
  const raw = await env.HELM_KV.get(key);
  if (!raw) return err(request, 404, 'not_found', 'no such pending event (it may already be drained)');

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return err(request, 500, 'corrupt', 'stored event is not valid JSON');
  }
  if (event.actor !== caller.name) {
    return err(request, 403, 'not_actor', 'only the event author may withdraw it');
  }

  await env.HELM_KV.delete(key);
  return json(request, { deleted: id });
}

async function handleHealth(request, env) {
  const raw = await env.HELM_KV.get('snapshot');
  let published_at = null;
  if (raw) {
    try {
      published_at = JSON.parse(raw).generated_at || null;
    } catch {
      published_at = null;
    }
  }
  const keys = await listEventKeys(env);
  const spend = await askSpendToday(env);
  return json(request, {
    published_at,
    pending_count: keys.length,
    ask_today_usd: Number(spend.usd.toFixed(4)),
    ask_cap_usd: askCapUsd(env),
  });
}

async function handleAsk(request, env) {
  // M4 wires this up. The seam and the cap check live here already so the
  // page can be built against the real shape.
  const spend = await askSpendToday(env);
  if (spend.usd >= askCapUsd(env)) return err(request, 429, 'cap', 'daily /ask spend cap reached');

  const r = await readJsonCapped(request, MAX_EVENT_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', 'ask body too large');
  if (r.bad) return err(request, 400, 'bad_json', 'body must be valid JSON');
  if (!isObj(r.value) || !nonEmptyText(r.value.q, MAX_TEXT_LEN))
    return err(request, 400, 'bad_shape', 'body.q must be a non-empty string');

  const out = await askBackend();
  if (out.notImplemented) return err(request, 503, 'not_implemented', '/api/ask lands in M4');
  return json(request, out);
}

// ------------------------------------------------------------ admin routes

async function handleAdminPublish(request, env) {
  const r = await readTextCapped(request, MAX_SNAPSHOT_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', `snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`);

  let parsed;
  try {
    parsed = JSON.parse(r.text);
  } catch {
    return err(request, 400, 'bad_json', 'snapshot must be valid JSON');
  }
  if (!isObj(parsed)) return err(request, 400, 'bad_shape', 'snapshot must be a JSON object');
  if (parsed.schema === undefined || parsed.schema === null) {
    return err(request, 400, 'no_schema', 'snapshot must carry a `schema` field');
  }

  // Replaced atomically: one key, one put.
  await env.HELM_KV.put('snapshot', r.text);
  return json(request, {
    published: true,
    schema: parsed.schema,
    generated_at: parsed.generated_at || null,
    tiles: isObj(parsed.tiles) ? Object.keys(parsed.tiles).length : 0,
    bytes: r.text.length,
  });
}

async function handleAdminEvents(request, env) {
  const events = await readEvents(env);
  return json(request, { count: events.length, events });
}

async function handleAdminAck(request, env) {
  const r = await readJsonCapped(request, MAX_EVENT_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', 'ack body too large');
  if (r.bad) return err(request, 400, 'bad_json', 'body must be valid JSON');
  const ids = isObj(r.value) ? r.value.ids : null;
  if (!Array.isArray(ids)) return err(request, 400, 'bad_shape', 'body.ids must be an array');

  const acked = [];
  const rejected = [];
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : '';
    if (!EVENT_ID_RE.test(id)) {
      rejected.push(id);
      continue;
    }
    await env.HELM_KV.delete(`evt:${id}`);
    acked.push(id);
  }
  return json(request, { acked: acked.length, ids: acked, rejected });
}

async function handleAdminTokens(request, env) {
  const r = await readJsonCapped(request, MAX_TOKENS_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', 'token map too large');
  if (r.bad) return err(request, 400, 'bad_json', 'body must be valid JSON');
  const map = r.value;
  if (!isObj(map)) return err(request, 400, 'bad_shape', 'body must be a {token: {name, role}} object');

  for (const [tok, who] of Object.entries(map)) {
    if (tok.length < 16) return err(request, 400, 'weak_token', 'every token must be at least 16 characters');
    if (!isObj(who) || !nonEmptyText(who.name, 120) || !nonEmptyText(who.role, 40)) {
      return err(request, 400, 'bad_shape', 'each value must be {name, role}');
    }
  }
  await env.HELM_KV.put('tokens', JSON.stringify(map));
  // Count only. Token values are never echoed or logged.
  return json(request, { tokens: Object.keys(map).length });
}

async function handleAdminAskSystem(request, env) {
  const r = await readTextCapped(request, MAX_ASK_SYSTEM_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', 'ask-system text too large');
  if (!r.text || !r.text.trim()) return err(request, 400, 'empty', 'body must be non-empty text');
  await env.HELM_KV.put('ask:sys', r.text);
  return json(request, { stored: true, bytes: r.text.length });
}

// ------------------------------------------------------------------ router

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const method = request.method.toUpperCase();

      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }

      if (!env.HELM_KV) return err(request, 500, 'no_kv', 'HELM_KV binding is missing');

      // ---- admin surface -------------------------------------------------
      if (path.startsWith('/api/admin/')) {
        if (!adminOk(request, env)) return err(request, 401, 'unauthorized', 'bad or missing X-Admin-Secret');
        if (path === '/api/admin/publish' && method === 'POST') return handleAdminPublish(request, env);
        if (path === '/api/admin/events' && method === 'GET') return handleAdminEvents(request, env);
        if (path === '/api/admin/events/ack' && method === 'POST') return handleAdminAck(request, env);
        if (path === '/api/admin/tokens' && method === 'POST') return handleAdminTokens(request, env);
        if (path === '/api/admin/ask-system' && method === 'PUT') return handleAdminAskSystem(request, env);
        return err(request, 404, 'no_route', `${method} ${path}`);
      }

      // ---- page surface (token) -----------------------------------------
      if (path.startsWith('/api/')) {
        const caller = await resolveCaller(env, extractToken(request, url));
        if (!caller) return err(request, 401, 'unauthorized', 'bad or missing token');

        if (path === '/api/data' && method === 'GET') return handleGetData(request, env, caller);
        if (path === '/api/event' && method === 'POST') return handlePostEvent(request, env, caller);
        if (path === '/api/health' && method === 'GET') return handleHealth(request, env);
        if (path === '/api/ask' && method === 'POST') return handleAsk(request, env);

        const del = path.match(/^\/api\/event\/(.+)$/);
        if (del && method === 'DELETE') return handleDeleteEvent(request, env, caller, del[1]);

        return err(request, 404, 'no_route', `${method} ${path}`);
      }

      return err(request, 404, 'no_route', `${method} ${path}`);
    } catch (e) {
      // Never log request bodies or token values.
      console.error('helm worker error:', e && e.message);
      return err(request, 500, 'internal', 'unexpected worker error');
    }
  },
};
