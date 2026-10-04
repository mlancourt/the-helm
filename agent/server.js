/**
 * The Helm brain — the vault-smart /ask (Brain-Service-Spec, A3–A9).
 *
 *   node server.js            (launchd: com.lannyai.helm-agent)
 *
 * Bound to 127.0.0.1:8787 ONLY. The world reaches it through cloudflared and
 * Cloudflare Access (OTP, Matt's email), never directly.
 *
 *   GET  /health → {ok, mode:"vault", host, ts, spend_today_usd, cap_usd}
 *   POST /ask    {q, history?, tile_id?, tile_data?}
 *                → {answer, mode:"vault", usd, files_read[], ms}
 *
 * Failures are `{reason}` JSON, the Worker's vocabulary: 503 brain_off ·
 * 503 busy · 503 no_key · 503 no_system · 429 cap · 504 timeout · 502 upstream ·
 * 400 bad_json/bad_shape · 413 too_large · 404 not_found.
 *
 * Nothing here logs a question, an answer or a grep pattern — lengths, counts,
 * paths read and money only.
 */

import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { vaultRoot } from './vault.js';
import { TILE_ID_RE } from './snapshot.js';
import { buildSystemPrompt } from './prompt.js';
import { runAsk, DEFAULT_MODEL, ASK_TIMEOUT_MS } from './brain.js';
import { capUsd, readSpend, recordSpend, appendAudit, questionHash, brainOff, readApiKey } from './ledger.js';

export const HOST = '127.0.0.1';
export const PORT = 8787;
export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_Q_CHARS = 4000;
export const MAX_HISTORY = 10;
const MAX_HISTORY_CHARS = 8000;
export const BUSY_WAIT_MS = 20_000;

/**
 * Origins allowed to call with credentials. Access answers the preflight at
 * the edge (A2); the service echoes the same headers on the real response so
 * the browser hands the body to the page.
 */
const ALLOWED_ORIGINS = new Set(['https://helm.lannyai.com']);
const isLocalOrigin = (o) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Same rules as worker.js normalizeHistory: user/assistant, non-empty, ≤ 10, starts on a user turn. */
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
  const tail = turns.slice(-MAX_HISTORY);
  while (tail.length && tail[0].role !== 'user') tail.shift();
  return tail;
}

/** A promise mutex: one ask at a time; a waiter gives up after `waitMs`. */
export function createMutex() {
  let tail = Promise.resolve();
  return {
    async acquire(waitMs) {
      const prev = tail;
      let release;
      const mine = new Promise((r) => (release = r));
      tail = prev.then(() => mine);
      let timer;
      const got = await Promise.race([
        prev.then(() => true),
        new Promise((r) => (timer = setTimeout(() => r(false), waitMs))),
      ]);
      clearTimeout(timer);
      if (!got) {
        // Hand our slot straight on so the queue behind us is not blocked.
        prev.then(() => release());
        return null;
      }
      return release;
    },
  };
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !(ALLOWED_ORIGINS.has(origin) || isLocalOrigin(origin))) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

function send(req, res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

function readBody(req, cap) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > cap) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(over ? { tooBig: true } : { text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ bad: true }));
  });
}

/**
 * The service, with every outside dependency injectable so the tests can run
 * it with no key, no model and no vault of Matt's.
 */
export function createApp(deps = {}) {
  const env = deps.env || process.env;
  const vault = deps.vault || vaultRoot(env);
  const mutex = deps.mutex || createMutex();
  const busyWaitMs = deps.busyWaitMs ?? BUSY_WAIT_MS;
  const timeoutMs = deps.timeoutMs ?? ASK_TIMEOUT_MS;
  const now = deps.now || (() => new Date());
  const log = deps.log || ((s) => console.log(s));
  const loadSdk = deps.loadSdk || (() => import('@anthropic-ai/claude-agent-sdk'));
  const model = (typeof env.ASK_MODEL === 'string' && env.ASK_MODEL.trim()) || DEFAULT_MODEL;

  async function health(req, res) {
    const spend = await readSpend(env, now());
    send(req, res, 200, { ok: true, mode: 'vault', host: os.hostname(), ts: now().toISOString(), spend_today_usd: Number(spend.usd.toFixed(4)), cap_usd: capUsd(env) });
  }

  async function ask(req, res) {
    const started = Date.now();
    const r = await readBody(req, MAX_BODY_BYTES);
    if (r.tooBig) return send(req, res, 413, { reason: 'too_large' });
    if (r.bad) return send(req, res, 400, { reason: 'bad_json' });
    let body;
    try {
      body = JSON.parse(r.text);
    } catch {
      return send(req, res, 400, { reason: 'bad_json' });
    }
    if (!isObj(body) || typeof body.q !== 'string' || !body.q.trim()) return send(req, res, 400, { reason: 'bad_shape', detail: 'q must be a non-empty string' });
    const q = body.q.trim();
    if (q.length > MAX_Q_CHARS) return send(req, res, 400, { reason: 'bad_shape', detail: `q is over ${MAX_Q_CHARS} characters` });

    let pinned = null;
    if (body.tile_id !== undefined && body.tile_id !== null) {
      if (typeof body.tile_id !== 'string' || !TILE_ID_RE.test(body.tile_id)) return send(req, res, 400, { reason: 'bad_shape', detail: 'tile_id must be a tile id' });
      pinned = { tile_id: body.tile_id, tile_data: body.tile_data ?? null };
    }
    const history = normalizeHistory(body.history);
    const qh = questionHash(q);

    const release = await mutex.acquire(busyWaitMs);
    if (!release) return send(req, res, 503, { reason: 'busy' });
    try {
      // The cap is checked before the model is called (A7) — and inside the
      // mutex, so two queued asks cannot both slip under it.
      const spend = await readSpend(env, now());
      const cap = capUsd(env);
      if (spend.usd >= cap) {
        await appendAudit({ question_hash: qh, outcome: 'cap', ms: Date.now() - started }, env);
        log(`ask cap q_len=${q.length} spent=${spend.usd} cap=${cap}`);
        return send(req, res, 429, { reason: 'cap' });
      }

      const apiKey = readApiKey(env);
      if (!apiKey) return send(req, res, 503, { reason: 'no_key' });

      const built = await buildSystemPrompt(vault, { pinned });
      if (built.error) return send(req, res, 503, { reason: 'no_system' });

      const sdk = await loadSdk();
      const out = await runAsk({ sdk, vault, system: built.system, q, history, model, apiKey, timeoutMs, spawn: deps.spawn, env });
      const ms = Date.now() - started;

      if (out.usd > 0) await recordSpend(out.usd, env, now());
      await appendAudit(
        {
          question_hash: qh,
          files_read: out.stats.files_read,
          grep_count: out.stats.grep_count,
          list_count: out.stats.list_count,
          turns: out.turns,
          tokens_in: out.tokens_in,
          tokens_out: out.tokens_out,
          usd: out.usd,
          ms,
          outcome: out.outcome,
        },
        env
      );
      log(
        `ask ${out.outcome} model=${model} q_len=${q.length} hist=${history.length} pinned=${pinned ? pinned.tile_id : '-'} ` +
          `files=${out.stats.files_read.length} greps=${out.stats.grep_count} lists=${out.stats.list_count} turns=${out.turns} ` +
          `in=${out.tokens_in} out=${out.tokens_out} usd=${out.usd} ms=${ms}`
      );

      if (out.outcome === 'timeout') return send(req, res, 504, { reason: 'timeout' });
      if (out.outcome === 'error') return send(req, res, 502, { reason: 'upstream' });
      return send(req, res, 200, { answer: out.answer, mode: 'vault', usd: out.usd, files_read: out.stats.files_read, ms });
    } catch (e) {
      log(`ask error q_len=${q.length} ${String(e?.name || 'Error')}`);
      try {
        await appendAudit({ question_hash: qh, outcome: 'error', ms: Date.now() - started }, env);
      } catch {
        /* the log dir is gone — the answer still says so */
      }
      return send(req, res, 502, { reason: 'upstream' });
    } finally {
      release();
    }
  }

  return async function handler(req, res) {
    try {
      // The soft kill switch outranks everything, preflight included.
      if (brainOff(env)) return send(req, res, 503, { ok: false, reason: 'brain_off' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/health') return await health(req, res);
      if (req.method === 'POST' && url.pathname === '/ask') return await ask(req, res);
      return send(req, res, 404, { reason: 'not_found' });
    } catch {
      if (!res.headersSent) send(req, res, 500, { reason: 'internal' });
    }
  };
}

export function start(deps = {}) {
  const server = http.createServer(createApp(deps));
  server.listen(PORT, HOST, () => console.log(`helm-agent listening on http://${HOST}:${PORT} vault=${deps.vault || vaultRoot()}`));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) start();
