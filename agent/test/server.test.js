import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { makeVault, fakeSdk, assistant, success, serve } from './helpers.js';
import { queryOptions, ALLOWED_TOOLS, TURN_NOTE } from '../brain.js';
import { centralDay } from '../ledger.js';
import { normalizeHistory, createMutex } from '../server.js';

const Q = 'what is the invented secret question about dinner';

function readAudit(V) {
  const f = path.join(V.logs, 'ask-audit.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** A run that reads one file, greps once, lists once, then answers. */
function happySdk() {
  return fakeSdk(async function* ({ call }) {
    yield assistant('m1', null);
    await call('read_file', { path: 'Notes/hello.md' });
    await call('grep_vault', { pattern: 'SECRET-PATTERN-xyz' });
    await call('list_dir', { path: 'Notes' });
    await call('read_file', { path: '../outside.txt' }); // refused: not counted as read
    yield assistant('m2', 'Chili. [[hello]]');
    yield success('Chili. [[hello]]');
  });
}

const noGrep = () => {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = () => {};
  setImmediate(() => c.emit('close', 1));
  return c;
};

test('query() options are the fence — exactly as specified', () => {
  const o = queryOptions({ system: 'S', model: 'claude-sonnet-5-5', apiKey: 'k', mcpServer: { type: 'sdk' }, abortController: new AbortController(), env: { PATH: '/x' } });
  assert.deepEqual(o.tools, []);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.permissionMode, 'dontAsk');
  assert.deepEqual(o.allowedTools, ['mcp__vault__read_file', 'mcp__vault__grep_vault', 'mcp__vault__list_dir']);
  assert.equal(o.maxTurns, 12);
  assert.equal(o.systemPrompt, 'S');
  assert.equal(o.cwd, os.tmpdir());
  assert.deepEqual(Object.keys(o.mcpServers), ['vault']);
  assert.equal(o.env.ANTHROPIC_API_KEY, 'k');
  assert.equal(o.env.PATH, '/x');
  assert.deepEqual(ALLOWED_TOOLS, o.allowedTools);
});

test('the service registers exactly three tools, all vault reads', async () => {
  const V = makeVault();
  const sdk = happySdk();
  const s = await serve({ env: V.env, loadSdk: async () => sdk, spawn: noGrep });
  try {
    await s.req('POST', '/ask', { q: Q });
    const tools = sdk.seen.options.mcpServers.vault.instance.tools.map((t) => t.name);
    assert.deepEqual(tools.sort(), ['grep_vault', 'list_dir', 'read_file']);
    assert.equal(sdk.seen.options.model, 'claude-sonnet-5-5', 'A4 default');
  } finally {
    await s.close();
  }
});

test('POST /ask → vault answer with files_read; audit line has no question text', async () => {
  const V = makeVault();
  const s = await serve({ env: V.env, loadSdk: async () => happySdk(), spawn: noGrep });
  try {
    const r = await s.req('POST', '/ask', { q: Q, history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }] });
    assert.equal(r.status, 200);
    assert.equal(r.json.mode, 'vault');
    assert.equal(r.json.answer, 'Chili. [[hello]]');
    assert.deepEqual(r.json.files_read, [path.join('Notes', 'hello.md')]);
    assert.equal(typeof r.json.usd, 'number');
    assert.ok(r.json.usd > 0);
    assert.equal(typeof r.json.ms, 'number');

    const lines = readAudit(V);
    assert.equal(lines.length, 1);
    const a = lines[0];
    assert.deepEqual(Object.keys(a), ['ts', 'question_hash', 'files_read', 'grep_count', 'list_count', 'turns', 'tokens_in', 'tokens_out', 'usd', 'ms', 'outcome']);
    assert.match(a.question_hash, /^[0-9a-f]{12}$/);
    assert.deepEqual(a.files_read, [path.join('Notes', 'hello.md')]);
    assert.equal(a.grep_count, 1);
    assert.equal(a.list_count, 1);
    assert.equal(a.turns, 2);
    assert.equal(a.tokens_in, 1000);
    assert.equal(a.tokens_out, 200);
    assert.equal(a.outcome, 'ok');
    const raw = fs.readFileSync(path.join(V.logs, 'ask-audit.jsonl'), 'utf8');
    assert.ok(!raw.includes('secret question'), 'never the question');
    assert.ok(!raw.includes('Chili'), 'never the answer');
    assert.ok(!raw.includes('SECRET-PATTERN'), 'never a grep pattern');

    const spend = JSON.parse(fs.readFileSync(path.join(V.logs, 'ask-spend.json'), 'utf8'));
    assert.equal(spend.day, centralDay());
    assert.equal(spend.n, 1);
    assert.equal(spend.usd, r.json.usd);
  } finally {
    await s.close();
  }
});

test('history rides in the prompt; system prompt carries the vault sections in order', async () => {
  const V = makeVault();
  const sdk = happySdk();
  const s = await serve({ env: V.env, loadSdk: async () => sdk, spawn: noGrep });
  try {
    await s.req('POST', '/ask', { q: 'now?', history: [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: 'earlier a' }], tile_id: 'dinner', tile_data: { meal: 'x' } });
    assert.match(sdk.seen.prompt, /Matt: earlier q\nYou: earlier a[\s\S]*now\?$/);
    const sys = sdk.seen.options.systemPrompt;
    const order = ['INVENTED ASK PROMPT', '**Last updated:** invented header', 'INVENTED ABOUT', '### Crew Routing', '# Board snapshot', '# Pinned tile', '# You are vault-smart now.'];
    let at = -1;
    for (const marker of order) {
      const i = sys.indexOf(marker);
      assert.ok(i > at, `${marker} in order`);
      at = i;
    }
    assert.ok(sys.includes('ROUTE LINE') && !sys.includes('not this'), 'routing stops at the next ###');
    assert.ok(!sys.includes('**later bold**'), 'only the first ** line of the Hub');
    assert.ok(!sys.includes('run-x'), 'run_id stays out (askSnapshotView)');
    assert.ok(sys.includes('invented chili'));
  } finally {
    await s.close();
  }
});

test('cap: at ≥ $3 → 429 cap, the model is never called, audit says cap', async () => {
  const V = makeVault();
  fs.mkdirSync(V.logs, { recursive: true });
  fs.writeFileSync(path.join(V.logs, 'ask-spend.json'), JSON.stringify({ day: centralDay(), usd: 3.0, n: 9 }));
  const sdk = happySdk();
  const s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    const r = await s.req('POST', '/ask', { q: Q });
    assert.equal(r.status, 429);
    assert.equal(r.json.reason, 'cap');
    assert.equal(sdk.seen.calls, 0);
    assert.equal(readAudit(V)[0].outcome, 'cap');
    const h = await s.req('GET', '/health');
    assert.equal(h.json.spend_today_usd, 3);
    assert.equal(h.json.cap_usd, 3);
  } finally {
    await s.close();
  }
});

test('cap: just under $3 still runs; yesterday’s ledger does not count', async () => {
  const V = makeVault();
  fs.mkdirSync(V.logs, { recursive: true });
  fs.writeFileSync(path.join(V.logs, 'ask-spend.json'), JSON.stringify({ day: '2000-01-01', usd: 99, n: 9 }));
  const s = await serve({ env: V.env, loadSdk: async () => happySdk(), spawn: noGrep });
  try {
    assert.equal((await s.req('POST', '/ask', { q: Q })).status, 200);
    fs.writeFileSync(path.join(V.logs, 'ask-spend.json'), JSON.stringify({ day: centralDay(), usd: 2.999, n: 9 }));
    assert.equal((await s.req('POST', '/ask', { q: Q })).status, 200);
    assert.equal((await s.req('POST', '/ask', { q: Q })).status, 429, 'the last ask pushed it over');
  } finally {
    await s.close();
  }
});

test('cap: ASK_DAILY_CAP_USD overrides', async () => {
  const V = makeVault();
  fs.mkdirSync(V.logs, { recursive: true });
  fs.writeFileSync(path.join(V.logs, 'ask-spend.json'), JSON.stringify({ day: centralDay(), usd: 0.5, n: 1 }));
  const s = await serve({ env: { ...V.env, ASK_DAILY_CAP_USD: '0.5' }, loadSdk: async () => happySdk() });
  try {
    assert.equal((await s.req('POST', '/ask', { q: Q })).status, 429);
  } finally {
    await s.close();
  }
});

test('brain-off: 503 brain_off on every route, before anything else', async () => {
  const V = makeVault();
  fs.writeFileSync(path.join(V.config, 'brain-off'), '');
  const sdk = happySdk();
  const s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    for (const [m, p] of [['GET', '/health'], ['POST', '/ask'], ['GET', '/nope'], ['OPTIONS', '/ask']]) {
      const r = await s.req(m, p, m === 'POST' ? { q: Q } : undefined);
      assert.equal(r.status, 503, `${m} ${p}`);
      if (m !== 'OPTIONS') assert.deepEqual(r.json, { ok: false, reason: 'brain_off' });
    }
    assert.equal(sdk.seen.calls, 0);
    assert.equal(readAudit(V).length, 0);
  } finally {
    await s.close();
  }
});

test('GET /health shape', async () => {
  const V = makeVault();
  const s = await serve({ env: V.env });
  try {
    const r = await s.req('GET', '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json), ['ok', 'mode', 'host', 'ts', 'spend_today_usd', 'cap_usd']);
    assert.equal(r.json.mode, 'vault');
    assert.equal(r.json.ok, true);
  } finally {
    await s.close();
  }
});

test('shape errors: 404, bad json, empty q, long q, bad tile id, body cap', async () => {
  const V = makeVault();
  const sdk = happySdk();
  const s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    assert.deepEqual((await s.req('GET', '/ask')).json, { reason: 'not_found' });
    assert.equal((await s.req('GET', '/etc/passwd')).status, 404);
    assert.equal((await s.req('POST', '/ask', '{nope')).json.reason, 'bad_json');
    assert.equal((await s.req('POST', '/ask', { q: '  ' })).json.reason, 'bad_shape');
    assert.equal((await s.req('POST', '/ask', { q: 'x'.repeat(4001) })).status, 400);
    assert.equal((await s.req('POST', '/ask', { q: 'ok', tile_id: '../x' })).status, 400);
    assert.equal((await s.req('POST', '/ask', { q: 'ok', tile_data: 'x'.repeat(130 * 1024) })).status, 413);
    assert.equal(sdk.seen.calls, 0);
  } finally {
    await s.close();
  }
});

test('no key / no system prompt → 503, model never called', async () => {
  const V = makeVault();
  fs.unlinkSync(path.join(V.config, 'anthropic-key'));
  const sdk = happySdk();
  let s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    assert.equal((await s.req('POST', '/ask', { q: Q })).json.reason, 'no_key');
  } finally {
    await s.close();
  }
  fs.writeFileSync(path.join(V.config, 'anthropic-key'), 'k');
  fs.unlinkSync(path.join(V.vault, '06-AI-Stack/The-Helm/Ask-System-Prompt-v1.md'));
  s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    assert.equal((await s.req('POST', '/ask', { q: Q })).json.reason, 'no_system');
    assert.equal(sdk.seen.calls, 0);
  } finally {
    await s.close();
  }
});

test('12-turn limit: partial text + the note, outcome turns', async () => {
  const V = makeVault();
  const sdk = fakeSdk(async function* () {
    yield assistant('m1', 'Partial so far.');
    yield { type: 'result', subtype: 'error_max_turns', num_turns: 12, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 10, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
  });
  const s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    const r = await s.req('POST', '/ask', { q: Q });
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, 'Partial so far.' + TURN_NOTE);
    assert.equal(TURN_NOTE, '\n\n(stopped at the 12-turn limit.)');
    assert.equal(readAudit(V)[0].outcome, 'turns');
    assert.equal(readAudit(V)[0].turns, 12);
  } finally {
    await s.close();
  }
});

test('wall clock: an ask past the timeout aborts → 504, spend still counted', async () => {
  const V = makeVault();
  const sdk = fakeSdk(async function* ({ options }) {
    yield assistant('m1', 'thinking', { input_tokens: 5000, output_tokens: 0 });
    await new Promise((resolve, reject) => {
      options.abortController.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  });
  const s = await serve({ env: V.env, loadSdk: async () => sdk, timeoutMs: 50 });
  try {
    const r = await s.req('POST', '/ask', { q: Q });
    assert.equal(r.status, 504);
    assert.equal(r.json.reason, 'timeout');
    const a = readAudit(V)[0];
    assert.equal(a.outcome, 'timeout');
    assert.ok(a.usd > 0);
    assert.ok(JSON.parse(fs.readFileSync(path.join(V.logs, 'ask-spend.json'), 'utf8')).usd > 0);
  } finally {
    await s.close();
  }
});

test('SDK throws → 502 upstream, outcome error', async () => {
  const V = makeVault();
  const sdk = fakeSdk(async function* () {
    throw new Error('boom with question text inside? never logged');
  });
  const logs = [];
  const s = await serve({ env: V.env, loadSdk: async () => sdk, log: (l) => logs.push(l) });
  try {
    const r = await s.req('POST', '/ask', { q: Q });
    assert.equal(r.status, 502);
    assert.equal(readAudit(V)[0].outcome, 'error');
    assert.ok(!logs.join('\n').includes('secret question'));
  } finally {
    await s.close();
  }
});

test('one ask at a time: a second waits, then 503 busy', async () => {
  const V = makeVault();
  let release;
  const gate = new Promise((r) => (release = r));
  const sdk = fakeSdk(async function* () {
    await gate;
    yield success('done');
  });
  const s = await serve({ env: V.env, loadSdk: async () => sdk, busyWaitMs: 50 });
  try {
    const first = s.req('POST', '/ask', { q: Q });
    await new Promise((r) => setTimeout(r, 20));
    const second = await s.req('POST', '/ask', { q: Q });
    assert.equal(second.status, 503);
    assert.equal(second.json.reason, 'busy');
    release();
    assert.equal((await first).status, 200);
    assert.equal((await s.req('POST', '/ask', { q: Q })).status, 200, 'the lock is released after');
  } finally {
    await s.close();
  }
});

test('mutex: a waiter that times out does not jam the queue', async () => {
  const m = createMutex();
  const r1 = await m.acquire(10);
  assert.equal(await m.acquire(10), null);
  r1();
  const r3 = await m.acquire(10);
  assert.ok(r3);
  r3();
});

test('CORS: the page origin gets credentials; others get nothing', async () => {
  const V = makeVault();
  const s = await serve({ env: V.env });
  try {
    const ok = await s.req('GET', '/health', undefined, { origin: 'https://helm.lannyai.com' });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://helm.lannyai.com');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    const evil = await s.req('GET', '/health', undefined, { origin: 'https://evil.example' });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    assert.equal((await s.req('OPTIONS', '/ask', undefined, { origin: 'https://helm.lannyai.com' })).status, 204);
  } finally {
    await s.close();
  }
});

test('normalizeHistory mirrors the Worker', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` }));
  const n = normalizeHistory(many);
  assert.equal(n.length, 10);
  assert.equal(n[0].role, 'user');
  assert.deepEqual(normalizeHistory([{ role: 'system', content: 'x' }, { role: 'assistant', content: 'a' }, { role: 'user', content: ' ' }]), []);
  assert.deepEqual(normalizeHistory('nope'), []);
});

test('server binds loopback only', () => {
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(src, /export const HOST = '127\.0\.0\.1';/);
  assert.match(src, /server\.listen\(PORT, HOST/);
});

test('by construction: no fetch, write, shell or exec anywhere in the service', () => {
  for (const f of ['server.js', 'brain.js', 'vault.js', 'prompt.js', 'snapshot.js', 'prices.js']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/\bfetch\(/.test(src), `${f}: no fetch`);
    assert.ok(!/(?<!\.)\bexec(Sync|File)?\(|child_process/.test(src) || f === 'vault.js', `${f}: no exec`);
    assert.ok(!/shell:\s*true/.test(src), `${f}: no shell`);
    assert.ok(!/(writeFile|appendFile|unlink|rmSync|rename)\w*\(/.test(src) || f === 'ledger.js', `${f}: no writes`);
  }
  const vaultSrc = fs.readFileSync(new URL('../vault.js', import.meta.url), 'utf8');
  assert.ok(!/(?<!\.)\bexec(Sync|File)?\(/.test(vaultSrc), 'vault.js: spawn only, never exec');
  assert.equal((vaultSrc.match(/\bspawn\(/g) || []).length, 1, 'vault.js spawns exactly once (rg)');
  // ledger.js writes only its two files under the log dir.
  const ledger = fs.readFileSync(new URL('../ledger.js', import.meta.url), 'utf8');
  for (const m of ledger.matchAll(/(writeFile|appendFile|rename)\(([^,]+)/g)) assert.match(m[2], /tmp|file|path\.join\(dir/);
});
