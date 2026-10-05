#!/usr/bin/env node
/**
 * The Helm — Phase 2 page tests: /ask asks the brain first (A1/A2/A10).
 * Node, zero deps, no browser, no network.
 *
 *   node tools/test-brain.js
 *
 * app.js cannot be imported outside a browser, so its new ask() path lives in
 * docs/lib/brain.js as a pure function with fetch and the Worker call
 * injected — this file drives every branch of it — and app.js is held to
 * wiring it with a source scan. Then the Ask tile is rendered on the shared
 * DOM shim: the mode chip's states, the sign-in button, the files footer.
 */

const fs = require('node:fs');
const path = require('node:path');

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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const { El } = require('./dom-shim.js'); // installs global.document
const opened = [];
globalThis.window = { open: (u, t) => opened.push([u, t]) };

const BRAIN = 'https://brain.lannyai.com';

/** A Response-ish object, as fetch would hand back. */
function resp(status, body, { type = 'cors', url = `${BRAIN}/ask` } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    type,
    url,
    async json() {
      if (typeof body === 'string') return JSON.parse(body);
      return body;
    },
  };
}

function rig(handler) {
  const seen = { fetch: [], worker: [] };
  const deps = {
    brainBase: BRAIN,
    fetchImpl: async (url, init) => {
      seen.fetch.push({ url, init });
      return handler(url, init);
    },
    workerAsk: async (body) => {
      seen.worker.push(body);
      return { answer: 'from the snapshot', mode: 'snapshot', usd: 0.01 };
    },
  };
  return { deps, seen };
}

async function rejects(p) {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

const flush = () => new Promise((r) => setImmediate(r));
const byCls = (root, c) => root.querySelectorAll(`.${c}`);
const tap = (n) => n.listeners.click.forEach((f) => f());

(async () => {
  console.log('The Helm — brain-first /ask tests\n');
  const { askBrainFirst, BRAIN_TIMEOUT_MS } = await import('../docs/lib/brain.js');
  const Q = { q: 'what did I decide about the tunnel?', history: [], tile_id: undefined, tile_data: undefined };

  // ---------------------------------------------------------------- transport
  console.log('brain ok');
  {
    const { deps, seen } = rig(() => resp(200, { answer: 'Tunnel is live. [[Brain-Service-Spec]]', mode: 'vault', usd: 0.08, files_read: ['06-AI-Stack/The-Helm/Brain-Service-Spec.md', 42], ms: 4100 }));
    const r = await askBrainFirst(Q, deps);
    check('returns the brain answer', r.answer === 'Tunnel is live. [[Brain-Service-Spec]]');
    check('tagged mode vault', r.mode === 'vault');
    check('files_read carried, strings only', JSON.stringify(r.files_read) === '["06-AI-Stack/The-Helm/Brain-Service-Spec.md"]', JSON.stringify(r.files_read));
    check('usd + ms carried', r.usd === 0.08 && r.ms === 4100);
    check('the Worker was not called', seen.worker.length === 0);
    const { url, init } = seen.fetch[0];
    check('POSTs BRAIN_BASE/ask', url === `${BRAIN}/ask` && init.method === 'POST');
    check("credentials: 'include' (the Access cookie)", init.credentials === 'include');
    check("redirect: 'manual' (so an Access redirect is visible)", init.redirect === 'manual');
    check('json content-type, no other header', JSON.stringify(init.headers) === '{"content-type":"application/json"}');
    check('no token rides to the brain', !JSON.stringify(init).includes('Bearer'));
    check('the body is the payload', JSON.parse(init.body).q === Q.q);
    check('a timeout signal is attached', init.signal && typeof init.signal.aborted === 'boolean');
    check('the timeout is 95 s', BRAIN_TIMEOUT_MS === 95_000);
  }

  console.log('\nbrain 401 / 403 / Access redirect → sign in');
  for (const [label, r] of [
    ['401', resp(401, { reason: 'unauthorized' })],
    ['403', resp(403, 'not json')],
    ['opaqueredirect', resp(0, null, { type: 'opaqueredirect', url: '' })],
    ['302', resp(302, null)],
    ['landed on the Access login host', resp(200, '<html>', { url: 'https://rough-waterfall-df27.cloudflareaccess.com/cdn-cgi/access/login/brain.lannyai.com' })],
  ]) {
    const { deps, seen } = rig(() => r);
    const e = await rejects(askBrainFirst(Q, deps));
    check(`${label}: throws reason signin`, e && e.reason === 'signin', e && e.reason);
    check(`${label}: login is the pinned /health`, e && e.login === `${BRAIN}/health`);
    check(`${label}: no fallback to the Worker`, seen.worker.length === 0);
  }

  console.log('\nbrain down → Worker fallback, tagged snapshot');
  for (const [label, handler] of [
    ['network TypeError', () => { throw new TypeError('Failed to fetch'); }],
    ['timeout', () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }],
    ['503 brain_off', () => resp(503, { ok: false, reason: 'brain_off' })],
    ['503 busy', () => resp(503, { reason: 'busy' })],
    ['502 from the tunnel (HTML)', () => resp(502, '<html>bad gateway')],
    ['504 timeout', () => resp(504, { reason: 'timeout' })],
    ['200 but not an answer', () => resp(200, { nope: true })],
  ]) {
    const { deps, seen } = rig(handler);
    const r = await askBrainFirst(Q, deps);
    check(`${label}: the Worker answered`, seen.worker.length === 1 && r.answer === 'from the snapshot');
    check(`${label}: mode snapshot`, r.mode === 'snapshot');
  }
  {
    const { deps, seen } = rig(() => resp(503, { reason: 'brain_off' }));
    await askBrainFirst(Q, deps);
    check('the Worker gets the same payload', JSON.stringify(seen.worker[0]) === JSON.stringify(Q));
  }
  {
    const { deps } = rig(() => { throw new TypeError('x'); });
    deps.workerAsk = async () => { const e = new Error('cap'); e.reason = 'cap'; throw e; };
    const e = await rejects(askBrainFirst(Q, deps));
    check('a Worker failure on the fallback passes through (cap)', e && e.reason === 'cap');
  }

  console.log('\ncap');
  {
    const { deps, seen } = rig(() => resp(429, { reason: 'cap' }));
    const e = await rejects(askBrainFirst(Q, deps));
    check('429 → throws reason cap', e && e.reason === 'cap');
    check('and does NOT spend the Worker’s rail instead (A7)', seen.worker.length === 0);
  }
  {
    const { deps } = rig(() => resp(400, { reason: 'bad_shape' }));
    const e = await rejects(askBrainFirst(Q, deps));
    check('a 400 surfaces its reason, no fallback', e && e.reason === 'bad_shape');
  }

  // ---------------------------------------------------------------- the tile
  console.log('\nthe Ask tile');
  const A = await import('../docs/tiles/ask.js');
  function mount(askImpl) {
    const root = new El('div');
    const sent = [];
    const ctl = A.render(root, { data: {} }, {
      id: 'ask',
      actions: {
        ask: async (p) => {
          sent.push(JSON.parse(JSON.stringify(p)));
          return askImpl(p, sent.length);
        },
        submitEvent: async () => ({}),
      },
    });
    const input = root.querySelector('.ask-input');
    const send = root.querySelector('.btn-send');
    const chip = root.querySelector('.pill-mode');
    const signin = root.querySelector('.ask-signin');
    const askQ = async (q) => {
      input.value = q;
      tap(send);
      await flush();
      await flush();
    };
    return { root, ctl, sent, input, chip, signin, askQ };
  }
  const visible = (n) => !n.classList.contains('hidden');
  const lastAssistant = (root) => {
    const b = root.querySelectorAll('.bubble-assistant').pop();
    return b ? b.querySelector('.bubble-text').textContent : '';
  };

  {
    const t = mount(() => ({ answer: 'From the vault. [[About-Matt]]', mode: 'vault', usd: 0.05, files_read: ['06-AI-Stack/The-Captain/About-Matt.md', '[[Hub]]'] }));
    check('the chip starts at vault', t.chip.textContent === 'vault' && visible(t.chip));
    check('the sign-in button starts hidden', !visible(t.signin));
    await t.askQ('who am I');
    check('vault answer → chip vault', t.chip.textContent === 'vault');
    check('the cost rides on the chip title', /\$0\.0500/.test(t.chip.title));
    const footer = t.root.querySelector('.ask-files');
    check('a vault answer wears a files footer', !!footer);
    const toggle = t.root.querySelector('.ask-files-toggle');
    check('it reads "read 2 files ▸"', toggle && toggle.textContent === 'read 2 files ▸', toggle && toggle.textContent);
    const list = t.root.querySelector('.ask-files-list');
    check('the list starts folded', list && list.classList.contains('hidden'));
    tap(toggle);
    check('a tap opens it', !list.classList.contains('hidden') && toggle.textContent === 'read 2 files ▾');
    const items = list.querySelectorAll('li').map((li) => li.textContent);
    check('each file as plain text, wikilink brackets stripped', JSON.stringify(items) === '["06-AI-Stack/The-Captain/About-Matt.md","Hub"]', JSON.stringify(items));
    check('the bubble text is the answer verbatim', lastAssistant(t.root) === 'From the vault. [[About-Matt]]');
    await t.askQ('and again');
    check('the next ask sends role + content only — no files in history', t.sent[1].history.every((m) => Object.keys(m).join() === 'role,content'), JSON.stringify(t.sent[1].history));
    check('the open state survives the repaint', !t.root.querySelectorAll('.ask-files-list')[0].classList.contains('hidden'));
  }
  {
    const t = mount(() => ({ answer: 'one', mode: 'vault', files_read: ['A.md'] }));
    await t.askQ('x');
    check('singular: "read 1 file ▸"', t.root.querySelector('.ask-files-toggle').textContent === 'read 1 file ▸');
  }
  {
    const t = mount(() => ({ answer: 'none read', mode: 'vault', files_read: [] }));
    await t.askQ('x');
    check('no files read → no footer', !t.root.querySelector('.ask-files'));
  }
  {
    const t = mount(() => ({ answer: 'from the board', mode: 'snapshot', usd: 0.01, files_read: ['ignored.md'] }));
    await t.askQ('x');
    check('snapshot answer → chip snapshot', t.chip.textContent === 'snapshot');
    check('a snapshot answer never wears a files footer', !t.root.querySelector('.ask-files'));
  }
  {
    const t = mount((p, n) => {
      if (n === 1) {
        const e = new Error('signin');
        e.reason = 'signin';
        e.login = `${BRAIN}/health`;
        throw e;
      }
      return { answer: 'in', mode: 'vault', files_read: [] };
    });
    await t.askQ('x');
    check('signin → the chip hides', !visible(t.chip));
    check('and the sign-in button shows', visible(t.signin) && t.signin.textContent === 'sign in');
    check('it is a real button', t.signin.tagName === 'BUTTON' && t.signin.getAttribute('type') === 'button');
    check('the chat says what to do', /sign in/i.test(lastAssistant(t.root)));
    tap(t.signin);
    check('a tap opens the login in a new tab', opened.length === 1 && opened[0][0] === `${BRAIN}/health` && opened[0][1] === '_blank', JSON.stringify(opened));
    await t.askQ('y');
    check('the next good ask puts the chip back', visible(t.chip) && !visible(t.signin) && t.chip.textContent === 'vault');
  }
  {
    const t = mount(() => {
      const e = new Error('cap');
      e.reason = 'cap';
      throw e;
    });
    await t.askQ('x');
    check('cap → chip cap', t.chip.textContent === 'cap');
    check('the cap message stays (FAILURES intact)', /budget is spent/.test(t.root.querySelectorAll('.bubble-text').pop().textContent));
  }
  {
    const t = mount(() => {
      const e = new Error('upstream');
      e.reason = 'upstream';
      throw e;
    });
    await t.askQ('x');
    check('nobody answered → chip off', t.chip.textContent === 'off');
  }
  {
    const t = mount(() => ({ answer: 'x', mode: 'vault' }));
    t.input.value = 'build me a tile for tides';
    tap(t.root.querySelector('.btn-send'));
    await flush();
    check('the build-request offer still intercepts', !t.root.querySelector('.ask-offer').classList.contains('hidden') && t.sent.length === 0);
  }

  // ----------------------------------------------------------------- scans
  console.log('\nsource scans');
  const CONFIG = read('docs', 'config.js');
  const APP = stripJs(read('docs', 'app.js'));
  const BRAINJS = stripJs(read('docs', 'lib', 'brain.js'));
  const ASKJS = stripJs(read('docs', 'tiles', 'ask.js'));
  const SW = read('docs', 'sw.js');
  check("config.js: BRAIN_BASE = 'https://brain.lannyai.com'", /export const BRAIN_BASE = 'https:\/\/brain\.lannyai\.com';/.test(CONFIG));
  check('config.js: no query-string override for the brain', !/brain/i.test((CONFIG.match(/export function apiBase[\s\S]*?\n}/) || [''])[0]) && !/get\('brain'\)/.test(CONFIG));
  check('app.js: ask() routes through askBrainFirst with BRAIN_BASE', /askBrainFirst\(payload,\s*\{\s*brainBase:\s*BRAIN_BASE/.test(APP));
  check('app.js: the Worker stays the fallback', /workerAsk:\s*\(body\)\s*=>\s*api\('\/api\/ask'/.test(APP));
  const credFiles = ['app.js', 'lib/brain.js', 'tiles/ask.js', 'live/espn.js', 'live/nws.js', 'live/band.js']
    .filter((f) => /credentials\s*:\s*'include'/.test(read('docs', ...f.split('/'))));
  check("credentials: 'include' appears in lib/brain.js and nowhere else", JSON.stringify(credFiles) === '["lib/brain.js"]', JSON.stringify(credFiles));
  check('brain.js fetches only `${brainBase}/ask`', (BRAINJS.match(/fetchImpl\(/g) || []).length === 1 && /fetchImpl\(`\$\{brainBase\}\/ask`/.test(BRAINJS));
  check('ask.js: no innerHTML (rule 10)', !/innerHTML/.test(ASKJS));
  check('ask.js opens only the login it was handed', /window\.open\(loginUrl, '_blank'\)/.test(ASKJS) && (ASKJS.match(/window\.open/g) || []).length === 1);
  // At-least, not equal: a pinned literal here failed the suite on every later ship (2026-10-05).
  check('sw.js: helm-v51 or later', Number((SW.match(/CACHE_VERSION = 'helm-v(\d+)'/) || [])[1]) >= 51);
  check('sw.js precaches lib/brain.js', SW.includes("'./lib/brain.js'"));
  check('sw.js never caches the brain origin', /url\.hostname === 'brain\.lannyai\.com'/.test(SW));
  check('config.js: APP_VERSION 1.30.0 or later', (() => { const v = ((CONFIG.match(/APP_VERSION = '([\d.]+)'/) || [])[1] || '0.0.0').split('.').map(Number); return v[0] > 1 || (v[0] === 1 && v[1] >= 30); })());
  check('docs/CNAME is exactly helm.lannyai.com', read('docs', 'CNAME').trim() === 'helm.lannyai.com' && read('docs', 'CNAME').split('\n').filter(Boolean).length === 1);
  const MANIFEST = JSON.parse(read('docs', 'manifest.webmanifest'));
  check('manifest start_url + scope stay relative', MANIFEST.start_url === './' && MANIFEST.scope === './');
  const WORKER = read('worker', 'worker.js');
  check('Worker CORS admits the new page origin', /ALLOWED_ORIGIN_EXACT = new Set\(\[[^\]]*'https:\/\/helm\.lannyai\.com'/.test(WORKER));

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
