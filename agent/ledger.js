/**
 * The brain's own $3/day rail (A7) and its audit log (A8). Both live under
 * ~/Library/Logs/the-helm/ (HELM_LOG_DIR overrides, for tests).
 *
 * The audit line carries counts, paths and money — NEVER the question, the
 * answer or a grep pattern (a pattern is the question in disguise).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_CAP_USD = 3.0;

export function logDir(env = process.env) {
  return env.HELM_LOG_DIR || path.join(os.homedir(), 'Library', 'Logs', 'the-helm');
}

export function configDir(env = process.env) {
  return env.HELM_CONFIG_DIR || path.join(os.homedir(), '.config', 'the-helm');
}

export function capUsd(env = process.env) {
  const n = Number(env.ASK_DAILY_CAP_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_USD;
}

/** Today in Central, YYYY-MM-DD — the brain's day turns over in Matt's midnight. */
export function centralDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function readSpend(env = process.env, now = new Date()) {
  const day = centralDay(now);
  try {
    const v = JSON.parse(await fsp.readFile(path.join(logDir(env), 'ask-spend.json'), 'utf8'));
    if (v && v.day === day) return { day, usd: Number(v.usd) || 0, n: Number(v.n) || 0 };
  } catch {
    /* no ledger yet, or unreadable — a fresh day */
  }
  return { day, usd: 0, n: 0 };
}

/** Add one ask's cost. Written via a temp file + rename so a crash never truncates it. */
export async function recordSpend(usd, env = process.env, now = new Date()) {
  const cur = await readSpend(env, now);
  const next = { day: cur.day, usd: Math.round((cur.usd + (Number(usd) || 0)) * 1e6) / 1e6, n: cur.n + 1 };
  const dir = logDir(env);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'ask-spend.json');
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next));
  await fsp.rename(tmp, file);
  return next;
}

export function questionHash(q) {
  return crypto.createHash('sha256').update(String(q)).digest('hex').slice(0, 12);
}

/** The audit line, built from an explicit field list so nothing else can ride along. */
export function auditLine(r) {
  return {
    ts: r.ts || new Date().toISOString(),
    question_hash: r.question_hash,
    files_read: Array.isArray(r.files_read) ? r.files_read.slice() : [],
    grep_count: r.grep_count | 0,
    list_count: r.list_count | 0,
    turns: r.turns | 0,
    tokens_in: r.tokens_in | 0,
    tokens_out: r.tokens_out | 0,
    usd: Number(r.usd) || 0,
    ms: r.ms | 0,
    outcome: r.outcome,
  };
}

export async function appendAudit(r, env = process.env) {
  const dir = logDir(env);
  await fsp.mkdir(dir, { recursive: true });
  const line = auditLine(r);
  await fsp.appendFile(path.join(dir, 'ask-audit.jsonl'), JSON.stringify(line) + '\n');
  return line;
}

/** The soft kill switch (A9): `touch ~/.config/the-helm/brain-off`. */
export function brainOff(env = process.env) {
  return fs.existsSync(path.join(configDir(env), 'brain-off'));
}

/** Read per request, so a rotated key needs no restart. Never logged. */
export function readApiKey(env = process.env) {
  try {
    const k = fs.readFileSync(path.join(configDir(env), 'anthropic-key'), 'utf8').trim();
    return k || null;
  } catch {
    return null;
  }
}
