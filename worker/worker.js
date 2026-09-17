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
 *   ANTHROPIC_API_KEY  required for /ask — never reaches the page
 *   ASK_MODEL          optional — default the newest Sonnet-class model
 *   ASK_DAILY_CAP_USD  optional — default 3.00
 *
 * Most of this file is private to the Worker; the handful of pure helpers the
 * /ask path is built from are exported so tools/test-ask.js can unit-test them
 * without a running Worker. Cloudflare ignores exports other than `default`.
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

// ---- /ask (M4) ------------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** The brief's number. Answers are a paragraph, not an essay. */
const ASK_MAX_TOKENS = 800;
/** The brief's number. Past this the page gets 504 {reason:"timeout"}. */
const ASK_TIMEOUT_MS = 25_000;
/** Newest Sonnet-class model, per the brief. Override with secret ASK_MODEL. */
const DEFAULT_ASK_MODEL = 'claude-sonnet-5';

const MAX_ASK_BYTES = 128 * 1024;
const MAX_ASK_HISTORY = 10;      // turns, per the brief
const MAX_HISTORY_CHARS = 8000;  // one turn; an 800-token answer is ~3200
/** Per the brief: a tile bigger than this is sent as a note, not as data. */
const MAX_TILE_DATA_BYTES = 8 * 1024;

const TILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

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

export function askModel(env) {
  const m = env && typeof env.ASK_MODEL === 'string' ? env.ASK_MODEL.trim() : '';
  return m || DEFAULT_ASK_MODEL;
}

/**
 * List prices in USD per million tokens, matched by model-id prefix (longest
 * wins). The cap is a dollar guard rail, so an id nobody has priced here is
 * costed at the most expensive tier rather than at zero — an unknown model
 * must trip the cap early, never run free.
 */
const ASK_PRICES = [
  ['claude-fable-5', { in: 10, out: 50 }],
  ['claude-mythos-5', { in: 10, out: 50 }],
  ['claude-opus-', { in: 5, out: 25 }],
  ['claude-sonnet-5', { in: 2, out: 10 }],
  ['claude-sonnet-4-6', { in: 3, out: 15 }],
  ['claude-haiku-4-5', { in: 1, out: 5 }],
];
const ASK_PRICE_UNKNOWN = { in: 10, out: 50 };

export function modelPrices(model) {
  const id = String(model || '');
  let hit = null;
  for (const [prefix, price] of ASK_PRICES) {
    if (id.startsWith(prefix) && (!hit || prefix.length > hit.prefix.length)) hit = { prefix, price };
  }
  return hit ? hit.price : ASK_PRICE_UNKNOWN;
}

/**
 * Cost estimate from the usage block the API returns. Cache writes bill at
 * 1.25x and cache reads at 0.1x of the input rate.
 *
 * This is an estimate, not an invoice — the cap exists to stop a runaway loop,
 * and the console is the ledger.
 */
export function estimateUsd(model, usage) {
  const p = modelPrices(model);
  const u = usage || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const input = num(u.input_tokens) + num(u.cache_creation_input_tokens) * 1.25 + num(u.cache_read_input_tokens) * 0.1;
  const usd = (input * p.in + num(u.output_tokens) * p.out) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Trim the page's transcript into something the Messages API will accept:
 * user/assistant turns only, non-empty, at most MAX_ASK_HISTORY of them, and
 * starting on a user turn (the API rejects a leading assistant message).
 * Anything malformed is dropped rather than 400'd — a chat box should not fail
 * closed because one turn in the scrollback is odd.
 */
export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const turns = [];
  for (const m of raw) {
    if (!isObj(m)) continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    turns.push({ role: m.role, content: content.slice(0, MAX_HISTORY_CHARS) });
  }
  const tail = turns.slice(-MAX_ASK_HISTORY);
  while (tail.length && tail[0].role !== 'user') tail.shift();
  return tail;
}

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

/** A tile's data, or a note standing in for it when it is too big to send. */
function tileDataForModel(data, where) {
  const bytes = byteLen(JSON.stringify(data ?? null));
  if (bytes <= MAX_TILE_DATA_BYTES) return data ?? null;
  return {
    _truncated: true,
    _note: `${where} omitted: ${bytes} bytes exceeds the ${MAX_TILE_DATA_BYTES}-byte per-tile limit`,
    _keys: isObj(data) ? Object.keys(data) : undefined,
  };
}

/**
 * The snapshot as the model sees it: tiles, plus the three header fields that
 * make them readable (`schema`, `generated_at`, `tz`). `run_id` and anything
 * else the engine adds stays out — it is provenance, not board state.
 */
export function askSnapshotView(snapshot) {
  const tiles = {};
  const src = isObj(snapshot) && isObj(snapshot.tiles) ? snapshot.tiles : {};
  for (const [id, tile] of Object.entries(src)) {
    if (!isObj(tile)) continue;
    tiles[id] = { ...tile, data: tileDataForModel(tile.data, `tile \`${id}\` data`) };
  }
  return {
    schema: isObj(snapshot) ? (snapshot.schema ?? null) : null,
    generated_at: isObj(snapshot) ? (snapshot.generated_at ?? null) : null,
    tz: isObj(snapshot) ? (snapshot.tz ?? null) : null,
    tiles,
  };
}

/**
 * system = the vault owner's `ask:sys` text + the current snapshot + the
 * pinned tile, in that order. The prompt's *content* is not ours; this file
 * only ever appends board state beneath it.
 */
export function buildAskSystem({ sysText, snapshot, pinned }) {
  const parts = [String(sysText || '').trim()];

  parts.push(
    [
      '# Board snapshot',
      'The tiles currently published to The Helm. Business dates are plain YYYY-MM-DD',
      'strings in the timezone named by `tz` — read them verbatim, never shift them.',
      'Bet grades on the page are a lean, never a settlement.',
      '',
      JSON.stringify(askSnapshotView(snapshot)),
    ].join('\n')
  );

  if (pinned && pinned.tile_id) {
    parts.push(
      [
        '# Pinned tile',
        `The reader opened this from the \`${pinned.tile_id}\` tile and is asking about it.`,
        '',
        JSON.stringify(tileDataForModel(pinned.tile_data, 'pinned tile data')),
      ].join('\n')
    );
  }

  return parts.join('\n\n');
}

/** One HTTP call to the model API, bounded by whatever time is left. */
async function callModelApi(key, body, timeoutMs) {
  if (timeoutMs <= 0) return { timeout: true };
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    const name = e && e.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { timeout: true };
    return { network: true };
  }
}

/** Text blocks, joined. Anything that is not text is not an answer. */
function answerText(data) {
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  return blocks
    .filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
}

/**
 * The one swappable seam. v1 (M4) calls the Anthropic Messages API from
 * here; Phase 2 swaps the body for a Cloudflare Tunnel fetch. The page
 * never learns which — it only ever sees {answer, mode, usd}.
 *
 * Raw fetch rather than the SDK on purpose: rule 3 keeps this Worker a single
 * self-contained file that can be pasted into the Cloudflare dashboard, and a
 * bundled npm dependency would end that.
 *
 * Returns {answer, usd, usage, model} or {fail: 'no_key'|'timeout'|'upstream'}.
 */
async function askBackend(env, { system, messages, model }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { fail: 'no_key' };

  const deadline = Date.now() + ASK_TIMEOUT_MS;
  const body = {
    model,
    max_tokens: ASK_MAX_TOKENS,
    // One cached block: the system prompt and snapshot are identical across
    // every ask between two publishes, and only the messages move.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    // A board answer is a short paragraph. Thinking tokens would come out of
    // the same 800-token budget the answer needs, so it is off — and a model
    // that refuses the field (thinking always on) gets one more attempt
    // without it rather than handing the page a 400.
    thinking: { type: 'disabled' },
  };

  let res = await callModelApi(key, body, deadline - Date.now());
  if (res.status === 400 && /thinking/i.test(res.text || '')) {
    const { thinking, ...withoutThinking } = body;
    res = await callModelApi(key, withoutThinking, deadline - Date.now());
  }

  if (res.timeout) return { fail: 'timeout' };
  if (res.network) return { fail: 'upstream', detail: 'could not reach the model API' };

  let data = null;
  try {
    data = JSON.parse(res.text);
  } catch {
    /* handled below */
  }
  if (res.status !== 200 || !isObj(data)) {
    const msg = isObj(data) && isObj(data.error) && data.error.message ? String(data.error.message) : `http ${res.status}`;
    return { fail: 'upstream', status: res.status, detail: msg.slice(0, 200) };
  }

  let answer = answerText(data);
  if (data.stop_reason === 'refusal') {
    answer = answer || 'The model declined to answer that one.';
  } else if (data.stop_reason === 'max_tokens') {
    answer = `${answer}\n\n(cut off at the ${ASK_MAX_TOKENS}-token answer limit.)`.trim();
  }
  if (!answer) answer = 'The model returned an empty answer.';

  return { answer, usage: data.usage || null, model: data.model || model, usd: estimateUsd(data.model || model, data.usage) };
}

/**
 * Add one call's cost to today's bucket. KV has no atomic increment, so two
 * asks racing can under-count by one — acceptable on a one-user board where
 * the cap is a guard rail. The bucket expires on its own so the namespace does
 * not accumulate a key per day forever.
 */
async function recordAskSpend(env, usd) {
  const current = await askSpendToday(env);
  const next = {
    usd: Math.round((current.usd + (Number(usd) || 0)) * 1e6) / 1e6,
    calls: current.calls + 1,
  };
  await env.HELM_KV.put(`ask:cap:${utcDay()}`, JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 14 });
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
  // The cap is checked before anything is read, so a runaway page cannot even
  // spend the Worker's time once the day's budget is gone.
  const spend = await askSpendToday(env);
  const cap = askCapUsd(env);
  if (spend.usd >= cap) {
    return err(request, 429, 'cap', `daily /ask spend cap of $${cap.toFixed(2)} reached`);
  }

  const r = await readJsonCapped(request, MAX_ASK_BYTES);
  if (r.tooBig) return err(request, 413, 'too_large', 'ask body too large');
  if (r.bad) return err(request, 400, 'bad_json', 'body must be valid JSON');
  if (!isObj(r.value) || !nonEmptyText(r.value.q, MAX_TEXT_LEN))
    return err(request, 400, 'bad_shape', 'body.q must be a non-empty string');

  const body = r.value;
  const q = body.q.trim();

  let pinned = null;
  if (body.tile_id !== undefined && body.tile_id !== null) {
    if (typeof body.tile_id !== 'string' || !TILE_ID_RE.test(body.tile_id)) {
      return err(request, 400, 'bad_shape', 'body.tile_id must be a tile id');
    }
    pinned = { tile_id: body.tile_id, tile_data: body.tile_data ?? null };
  }

  // The prompt's content belongs to the vault owner and is installed by
  // PUT /api/admin/ask-system. Without it there is nothing to ask *as*, and
  // inventing a stand-in here would be this repo writing vault content.
  const sysText = await env.HELM_KV.get('ask:sys');
  if (!sysText || !sysText.trim()) {
    return err(request, 503, 'no_system', 'the /ask system prompt has not been installed yet');
  }

  let snapshot = null;
  const rawSnapshot = await env.HELM_KV.get('snapshot');
  if (rawSnapshot) {
    try {
      snapshot = JSON.parse(rawSnapshot);
    } catch {
      snapshot = null; // a broken snapshot means no board context, not a 500
    }
  }

  const model = askModel(env);
  const out = await askBackend(env, {
    system: buildAskSystem({ sysText, snapshot, pinned }),
    messages: [...normalizeHistory(body.history), { role: 'user', content: q }],
    model,
  });

  if (out.fail === 'no_key') return err(request, 503, 'no_key', 'no model key is configured on this Worker');
  if (out.fail === 'timeout') return err(request, 504, 'timeout', `no answer within ${ASK_TIMEOUT_MS / 1000}s`);
  if (out.fail === 'upstream') return err(request, 502, 'upstream', out.detail || 'the model API refused the call');

  await recordAskSpend(env, out.usd);

  // Length and cost only. The question, the answer and the snapshot never
  // reach a log line.
  console.log(
    `ask ok model=${out.model} q_len=${q.length} pinned=${pinned ? pinned.tile_id : '-'} ` +
      `in=${out.usage?.input_tokens ?? '?'} cached=${out.usage?.cache_read_input_tokens ?? 0} ` +
      `out=${out.usage?.output_tokens ?? '?'} usd=${out.usd}`
  );

  return json(request, { answer: out.answer, mode: 'snapshot', usd: out.usd });
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
