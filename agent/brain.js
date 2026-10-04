/**
 * One vault-smart ask: build the three tools, call the Agent SDK with every
 * built-in OFF, price the run, and say what was read.
 *
 * SAFETY BY CONSTRUCTION (A3/A5) — the query() options below are the whole
 * fence: `tools: []` turns off every built-in (no Bash, Read, Write, Edit,
 * WebFetch…), `settingSources: []` loads no CLAUDE.md or settings from disk,
 * `permissionMode: 'dontAsk'` denies anything not pre-approved, and
 * `allowedTools` pre-approves exactly the three in-process vault tools. There
 * is no fetch tool, no write tool and no shell tool, and none is to be added.
 */

import os from 'node:os';
import { z } from 'zod';
import { readFile, grepVault, listDir } from './vault.js';
import { priceModelUsage, estimateUsd } from './prices.js';

export const MAX_TURNS = 12;
export const ASK_TIMEOUT_MS = 90_000;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const ALLOWED_TOOLS = ['mcp__vault__read_file', 'mcp__vault__grep_vault', 'mcp__vault__list_dir'];
export const TURN_NOTE = '\n\n(stopped at the 12-turn limit.)';

const ok = (text) => ({ content: [{ type: 'text', text }] });
const bad = (text) => ({ content: [{ type: 'text', text }], isError: true });

/**
 * The three tools, closed over one request's counters. A handler never
 * throws: a refusal or a miss is an error STRING the model can read.
 */
export function makeVaultTools(sdk, vault, stats, { spawn } = {}) {
  const { tool } = sdk;
  const guarded = (fn) => async (args) => {
    try {
      return await fn(args || {});
    } catch {
      return bad('tool failed');
    }
  };
  return [
    tool(
      'read_file',
      'Read one text file from the vault. `path` is vault-relative, e.g. "06-AI-Stack/The-Helm/_The-Helm-Index.md". 200 KB cap.',
      { path: z.string() },
      guarded(async ({ path }) => {
        const r = await readFile(vault, path);
        if (r.error) return bad(r.error);
        stats.files_read.push(r.rel);
        return ok(r.text);
      })
    ),
    tool(
      'grep_vault',
      'Search the vault with ripgrep (regex, line numbers, 1 line of context). Optional `glob` narrows files (e.g. "06-AI-Stack/**/*.md"). Returns at most `max` matches (default 40).',
      { pattern: z.string(), glob: z.string().optional(), max: z.number().int().positive().max(200).optional() },
      guarded(async (args) => {
        stats.grep_count++;
        const r = await grepVault(vault, args, spawn ? { spawn } : {});
        return r.error ? bad(r.error) : ok(r.text);
      })
    ),
    tool(
      'list_dir',
      'List a vault folder: names (folders end in "/"), sizes, modified times. `path` is vault-relative; "" is the vault root. 500 entries cap.',
      { path: z.string() },
      guarded(async ({ path }) => {
        stats.list_count++;
        const r = await listDir(vault, path);
        return r.error ? bad(r.error) : ok(r.text);
      })
    ),
  ];
}

/**
 * The SDK takes one prompt string, so prior turns ride in front of the
 * question as a plain transcript. (The history is already normalized.)
 */
export function promptWithHistory(q, history) {
  if (!history.length) return q;
  const lines = history.map((m) => `${m.role === 'user' ? 'Matt' : 'You'}: ${m.content}`);
  return ['Earlier in this conversation:', '', ...lines, '', 'Matt now asks:', q].join('\n');
}

/** The exact options object handed to query(). Exported so a test can hold it. */
export function queryOptions({ system, model, apiKey, mcpServer, abortController, env = process.env }) {
  return {
    tools: [],
    settingSources: [],
    permissionMode: 'dontAsk',
    allowedTools: ALLOWED_TOOLS.slice(),
    maxTurns: MAX_TURNS,
    systemPrompt: system,
    model,
    cwd: os.tmpdir(),
    env: { ...env, ANTHROPIC_API_KEY: apiKey },
    mcpServers: { vault: mcpServer },
    abortController,
  };
}

/**
 * Run one ask. Returns
 *   {outcome:'ok'|'turns', answer, usd, turns, tokens_in, tokens_out, stats}
 *   {outcome:'timeout'|'error', usd, turns, tokens_in, tokens_out, stats, detail?}
 * — the money is counted on every path, because a timed-out run still spent.
 */
export async function runAsk({ sdk, vault, system, q, history, model, apiKey, timeoutMs = ASK_TIMEOUT_MS, spawn, env = process.env }) {
  const stats = { files_read: [], grep_count: 0, list_count: 0 };
  const instance = sdk.createSdkMcpServer({ name: 'vault', version: '1.0.0', tools: makeVaultTools(sdk, vault, stats, { spawn }) });
  const abortController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  // Fallback accounting off each assistant message, deduped by message id,
  // for a run that never reaches its result (timeout, crash).
  const perMessage = new Map();
  const texts = [];
  let assistantTurns = 0;
  let result = null;

  try {
    const it = sdk.query({
      prompt: promptWithHistory(q, history),
      options: queryOptions({ system, model, apiKey, mcpServer: instance, abortController, env }),
    });
    for await (const msg of it) {
      if (msg?.type === 'assistant' && !msg.parent_tool_use_id) {
        const m = msg.message || {};
        if (m.id && !perMessage.has(m.id)) assistantTurns++;
        if (m.id && m.usage) perMessage.set(m.id, { model: m.model || model, usage: m.usage });
        for (const b of m.content || []) if (b?.type === 'text' && b.text) texts.push(b.text);
      } else if (msg?.type === 'result') {
        result = msg;
      }
    }
  } catch (e) {
    clearTimeout(timer);
    const acc = fallbackAccounting(perMessage);
    return { outcome: timedOut ? 'timeout' : 'error', turns: assistantTurns, ...acc, stats, detail: timedOut ? null : String(e?.message || e).slice(0, 200) };
  }
  clearTimeout(timer);

  if (timedOut) return { outcome: 'timeout', turns: assistantTurns, ...fallbackAccounting(perMessage), stats };

  const acc = result?.modelUsage && Object.keys(result.modelUsage).length ? priceModelUsage(result.modelUsage) : fallbackAccounting(perMessage);
  const turns = Number(result?.num_turns) || assistantTurns;

  if (result?.subtype === 'success') {
    return { outcome: 'ok', answer: String(result.result ?? texts.join('\n\n')), turns, ...acc, stats };
  }
  if (result?.subtype === 'error_max_turns') {
    const partial = texts.join('\n\n').trim();
    return { outcome: 'turns', answer: (partial || 'I ran out of turns before I had an answer.') + TURN_NOTE, turns, ...acc, stats };
  }
  return { outcome: 'error', turns, ...acc, stats, detail: result?.subtype || 'no result' };
}

function fallbackAccounting(perMessage) {
  let usd = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  for (const { model, usage } of perMessage.values()) {
    usd += estimateUsd(model, usage);
    tokens_in += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    tokens_out += usage.output_tokens || 0;
  }
  return { usd: Math.round(usd * 1e6) / 1e6, tokens_in, tokens_out };
}
