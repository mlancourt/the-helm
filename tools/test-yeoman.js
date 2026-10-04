#!/usr/bin/env node
/**
 * The Helm — Yeoman tile tests (vault spec `Yeoman-Tile-Spec.md`, Y1–Y16).
 * Node, zero deps, no browser.
 *
 *   node tools/test-yeoman.js
 *
 * The tile is a form that talks to one action, so it is driven here the way
 * a thumb would: open the sheet, fill the fields, tap Draft, read what the
 * action was handed and what landed in the DOM. The rulings with teeth get a
 * source scan as well as a render, because the failure mode is a well-meant
 * edit, not a crash:
 *
 *   Y7   the draft and its [BLANKS] reach the DOM verbatim; the module
 *        contains no string substitution that could ever fill one in
 *   Y11  sms: / mailto: on two anchors, built from the draft by one function
 *        through encodeURIComponent; no other scheme, no target
 *   Y13  nothing but the recents list touches localStorage; no innerHTML;
 *        rule 7: no clock
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

const { El } = require('./dom-shim.js'); // installs global.document

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SRC = read('docs', 'tiles', 'yeoman.js');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/[ \t]+\/\/ .*$/gm, '');
const APP = read('docs', 'app.js');
const CSS = read('docs', 'style.css');

// ------------------------------------------------------------- globals

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const nav = { onLine: true, clipboard: null };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
let storage = fakeStorage();
Object.defineProperty(globalThis, 'localStorage', { get: () => storage, configurable: true });

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};
const tap = (node) => node.listeners.click[0]({ stopPropagation() {} });
const byText = (root, tag, text) => root.querySelectorAll(tag).find((n) => n.textContent === text);
const one = (root, cls) => root.querySelector(cls);

// -------------------------------------------------------------- harness

const FIXTURE = {
  read: 'He wants to know when the blades land and what they cost.',
  assumed: 'Assumed you want to confirm the order and quote a price.',
  subject: 'Squeegee blades',
  draft: 'Hi Jeff,\n\nThey are [PRICE] a pair and we can have them out [DAY/TIME].\n\nThanks,',
  blanks: ['PRICE', 'DAY/TIME'],
  usd: 0.0091,
  mode: 'draft',
};

/**
 * One board's worth of the shell: render the face, capture the sheet the
 * shell would open, and record every request the tile makes.
 */
function harness({ answer = () => FIXTURE } = {}) {
  const calls = [];
  let n = 0;
  const panel = { title: null, body: null };
  const ctx = {
    id: 'yeoman',
    title: '✍️ Yeoman',
    actions: {
      openPanel(title, build) {
        panel.title = title;
        panel.body = new El('div');
        build(panel.body);
      },
      async draft(req) {
        calls.push(JSON.parse(JSON.stringify(req)));
        n++;
        return answer(req, n);
      },
    },
  };
  const face = new El('div');
  return { ctx, face, calls, panel };
}

async function openSheet(Y, which = 'Reply', opts) {
  const h = harness(opts);
  Y.render(h.face, undefined, h.ctx);
  tap(byText(h.face, 'button', which));
  const s = h.panel.body;
  const f = {
    name: one(s, '.yeo-name'),
    role: one(s, '.yeo-role'),
    context: one(s, '.yeo-context'),
    paste: one(s, '.yeo-paste'),
    intent: one(s, '.yeo-intent'),
    draft: one(s, '.yeo-draft-btn'),
    status: one(s, '.yeo-status'),
  };
  return { ...h, s, f };
}

function fill(f, { name = 'Jeff', role = 'customer', context = 'waiting on a squeegee two weeks', paste = 'Any word on those blades?', intent = 'confirm and quote' } = {}) {
  f.name.value = name;
  f.role.value = role;
  f.context.value = context;
  if (paste !== null) f.paste.value = paste;
  f.intent.value = intent;
}

// ---------------------------------------------------------------- tests

(async () => {
  console.log('The Helm — Yeoman tile tests\n');
  const Y = await import('../docs/tiles/yeoman.js');
  const { REGISTRY } = await import('../docs/tiles/_registry.js');

  // -- registry -----------------------------------------------------------
  console.log('registry (Y1, Y15)');
  {
    const e = REGISTRY.yeoman;
    check('registered', !!e);
    check('band ASK', e?.band === 'ASK');
    check('position 15', e?.position === 15);
    check('module ./tiles/yeoman.js', e?.module === './tiles/yeoman.js');
    check('titled Yeoman', /Yeoman/.test(e?.title || ''));
    const snap = JSON.parse(read('docs', 'mock', 'helm-data.json'));
    check('the mock snapshot has NO yeoman entry (no producer)', !('yeoman' in (snap.tiles || {})));
  }

  // -- face ---------------------------------------------------------------
  console.log('\nthe face renders from nothing');
  {
    const h = harness();
    let threw = null;
    try {
      Y.render(h.face, undefined, h.ctx);
    } catch (e) {
      threw = e;
    }
    check('render with no snapshot tile does not throw', !threw, threw && threw.message);
    check('one muted line', one(h.face, '.yeo-line')?.textContent === 'paste a message, get your reply');
    const buttons = h.face.querySelectorAll('button').map((b) => b.textContent);
    check('two buttons: Reply / New message', buttons.join('|') === 'Reply|New message', buttons.join('|'));

    const a = harness();
    const b = harness();
    Y.render(a.face, null, a.ctx);
    Y.render(b.face, { data: { anything: 'at all' }, status: 'error', error: 'boom' }, b.ctx);
    check('the face never reads `tile`', a.face.textContent === b.face.textContent &&
      a.face.querySelectorAll('button').length === b.face.querySelectorAll('button').length);
    check('the sheet opens through the shared panel, titled by the shell', (tap(byText(a.face, 'button', 'Reply')), a.panel.title === '✍️ Yeoman'));
  }

  // -- controls -------------------------------------------------------------
  console.log('\nthe sheet controls');
  {
    const { s, f } = await openSheet(Y, 'Reply');
    const seg = s.querySelectorAll('.yeo-seg-btn').map((b) => b.textContent);
    check('mode segmented Reply · New', seg.slice(0, 2).join('|') === 'Reply|New', seg.join('|'));
    check('channel segmented Text · Email', seg.slice(2).join('|') === 'Text|Email');
    check('Reply is pressed on a Reply open', s.querySelectorAll('.yeo-seg-btn')[0].getAttribute('aria-pressed') === 'true');
    check('Text is the default channel', s.querySelectorAll('.yeo-seg-btn')[2].getAttribute('aria-pressed') === 'true');
    check('a name input', f.name?.tagName === 'INPUT');
    const opts = f.role.querySelectorAll('option');
    check('a role select: placeholder + the seven registers', f.role?.tagName === 'SELECT' && opts.length === 8);
    check('roles in the spec order', opts.slice(1).map((o) => o.textContent).join(',') === 'Customer,Prospect,Vendor,Crew,Family,Friend,Other');
    check('role values are lower-case on the wire', opts.slice(1).every((o) => o.getAttribute('value') === o.textContent.toLowerCase()));
    check('no role is pre-chosen', f.role.value === '');
    check('a context input', f.context?.tagName === 'INPUT');
    check('a recents row', !!one(s, '.yeo-recents'));
    check('a paste textarea', f.paste?.tagName === 'TEXTAREA');
    check('a Paste button', one(s, '.yeo-paste-btn')?.textContent === 'Paste');
    check('the intent label reads "What do you want to happen?"', s.querySelectorAll('.yeo-label').some((n) => n.textContent === 'What do you want to happen?'));
    check('an intent input', f.intent?.tagName === 'INPUT');
    check('a Draft button', f.draft?.textContent === 'Draft');
    check('the paste box shows in Reply', !one(s, '.yeo-paste-block').classList.contains('hidden'));
    check('no result before a draft', one(s, '.yeo-result').classList.contains('hidden'));

    tap(byText(s, 'button', 'New'));
    check('New hides the paste box', one(s, '.yeo-paste-block').classList.contains('hidden'));
    tap(byText(s, 'button', 'Reply'));
    check('and Reply brings it back', !one(s, '.yeo-paste-block').classList.contains('hidden'));

    const compose = await openSheet(Y, 'New message');
    check('a New message open starts in compose, paste hidden', compose.s.querySelectorAll('.yeo-seg-btn')[1].getAttribute('aria-pressed') === 'true' &&
      one(compose.s, '.yeo-paste-block').classList.contains('hidden'));
  }

  // -- request bodies -------------------------------------------------------
  console.log('\nrequest bodies');
  {
    storage = fakeStorage();
    const r = await openSheet(Y, 'Reply');
    fill(r.f);
    tap(r.f.draft);
    await flush();
    const b = r.calls[0];
    check('reply: one call', r.calls.length === 1);
    check('reply body shape', JSON.stringify(b) === JSON.stringify({
      mode: 'reply', channel: 'text',
      to: { name: 'Jeff', role: 'customer', context: 'waiting on a squeegee two weeks' },
      incoming: 'Any word on those blades?', intent: 'confirm and quote',
    }), JSON.stringify(b));
    check('no nudge, no history on a first draft', !('nudge' in b) && !('history' in b));

    const c = await openSheet(Y, 'New message');
    fill(c.f, { paste: 'a stale paste that must not ride along', context: '' });
    tap(byText(c.s, 'button', 'Email'));
    tap(c.f.draft);
    await flush();
    const cb = c.calls[0];
    check('compose body: mode compose, channel email', cb.mode === 'compose' && cb.channel === 'email');
    check('compose never sends the paste box', !('incoming' in cb));
    check('an empty context is left off', !('context' in cb.to));

    const blank = await openSheet(Y, 'Reply');
    fill(blank.f, { role: '' });
    tap(blank.f.draft);
    await flush();
    check('no role -> no call, and the sheet says so', blank.calls.length === 0 && /role/.test(blank.f.status.textContent));
    fill(blank.f, { paste: '  ', intent: '' });
    tap(blank.f.draft);
    await flush();
    check('reply with neither paste nor intent -> no call', blank.calls.length === 0 && /paste a message/.test(blank.f.status.textContent));

    // nudges: history = prior drafts as assistant turns, joined by the nudges
    const drafts = (req, n) => ({ ...FIXTURE, draft: `draft ${n}`, blanks: [] });
    const t = await openSheet(Y, 'Reply', { answer: drafts });
    fill(t.f);
    tap(t.f.draft);
    await flush();
    tap(byText(t.s, 'button', 'shorter'));
    await flush();
    const n1 = t.calls[1];
    check('a nudge resends the request with nudge set', n1.nudge === 'shorter' && n1.mode === 'reply' && n1.incoming === 'Any word on those blades?');
    check('history = the prior draft as an assistant turn', JSON.stringify(n1.history) === JSON.stringify([{ role: 'assistant', content: 'draft 1' }]), JSON.stringify(n1.history));
    check('the new draft replaces the old in place', one(t.s, '.yeo-draft').textContent === 'draft 2');

    tap(byText(t.s, 'button', 'warmer'));
    await flush();
    check('a second nudge carries the thread', JSON.stringify(t.calls[2].history) === JSON.stringify([
      { role: 'assistant', content: 'draft 1' },
      { role: 'user', content: 'NUDGE: shorter' },
      { role: 'assistant', content: 'draft 2' },
    ]), JSON.stringify(t.calls[2].history));
    check('three drafts kept, at 3/3', one(t.s, '.yeo-pos').textContent === '3/3');

    tap(one(t.s, '.yeo-back'));
    check('one tap back shows the previous draft', one(t.s, '.yeo-draft').textContent === 'draft 2' && one(t.s, '.yeo-pos').textContent === '2/3');
    tap(one(t.s, '.yeo-fwd'));
    check('and forward again', one(t.s, '.yeo-draft').textContent === 'draft 3');
    tap(one(t.s, '.yeo-back'));

    tap(byText(t.s, 'button', 're-roll'));
    await flush();
    check('nudging from an earlier draft branches from there', JSON.stringify(t.calls[3].history) === JSON.stringify([
      { role: 'assistant', content: 'draft 1' },
      { role: 'user', content: 'NUDGE: shorter' },
      { role: 'assistant', content: 'draft 2' },
    ]));
    tap(byText(t.s, 'button', 'firmer'));
    await flush();
    tap(byText(t.s, 'button', 'more casual'));
    await flush();
    check('never more than the last 3 drafts', one(t.s, '.yeo-pos').textContent === '3/3');
    check('history never exceeds 10 turns', t.calls.every((c) => !c.history || c.history.length <= 10));
    check('every nudge chip is one of the five', t.calls.slice(1).every((c) => ['shorter', 'warmer', 'firmer', 'more casual', 're-roll'].includes(c.nudge)));

    tap(t.f.draft);
    await flush();
    check('a fresh Draft starts a new thread', !('history' in t.calls[t.calls.length - 1]) && !one(t.s, '.yeo-pos'));
  }

  // -- the result block + Y7 ------------------------------------------------
  console.log('\nthe result block · Y7 bracket integrity');
  {
    const r = await openSheet(Y, 'Reply');
    fill(r.f);
    tap(byText(r.s, 'button', 'Email'));
    tap(r.f.draft);
    await flush();
    const s = r.s;
    check('read, muted', one(s, '.yeo-read')?.textContent === FIXTURE.read);
    check('assumed, in its own line', one(s, '.yeo-assumed')?.textContent === FIXTURE.assumed);
    check('subject on email', one(s, '.yeo-subject')?.textContent === `Subject: ${FIXTURE.subject}`);
    check('the draft reaches the DOM byte-for-byte', one(s, '.yeo-draft')?.textContent === FIXTURE.draft);
    check('both blanks survive in the draft, brackets intact', /\[PRICE\]/.test(one(s, '.yeo-draft').textContent) && /\[DAY\/TIME\]/.test(one(s, '.yeo-draft').textContent));
    check('and appear in the fill-in line', one(s, '.yeo-blanks')?.textContent === 'fill in: PRICE, DAY/TIME');
    check('the draft is a plain block, not a field', one(s, '.yeo-draft').tagName === 'DIV');
    check('the "drafting…" line is gone once it lands', one(s, '.yeo-status').classList.contains('hidden'));

    tap(byText(s, 'button', 'Text'));
    check('switching to Text hides the subject', !one(s, '.yeo-subject'));

    const plain = await openSheet(Y, 'Reply', { answer: () => ({ read: null, assumed: null, subject: null, draft: 'just words', blanks: [], usd: 0, mode: 'draft' }) });
    fill(plain.f);
    tap(plain.f.draft);
    await flush();
    check('no read, no assumed, no blanks -> none of those lines', !one(plain.s, '.yeo-read') && !one(plain.s, '.yeo-assumed') && !one(plain.s, '.yeo-blanks'));

    check('Y7 scan: no string substitution anywhere in the module', !/\.replace(All)?\s*\(/.test(CODE));
    check('Y7 scan: no bracket pattern the module could match on', !/\\\[/.test(CODE) && !/'\['|"\["/.test(CODE));
    check('Y7 scan: blanks are printed, never computed (no matchAll/regex over the draft)', !/matchAll|\.match\(|RegExp/.test(CODE));
  }

  // -- Y11 hand-off -----------------------------------------------------------
  console.log('\nY11 — copy + hand-off, never send');
  {
    const tricky = { ...FIXTURE, draft: 'Hi & welcome #1?\nLine two = [PRICE] 100%', subject: 'Re: a&b' };
    const r = await openSheet(Y, 'Reply', { answer: () => tricky });
    fill(r.f);
    tap(byText(r.s, 'button', 'Email'));
    tap(r.f.draft);
    await flush();
    const sms = one(r.s, '.yeo-sms');
    const mail = one(r.s, '.yeo-mail');
    check('an Open in Messages anchor', sms?.tagName === 'A' && sms.textContent === 'Open in Messages');
    check('an Open in Mail anchor', mail?.tagName === 'A' && mail.textContent === 'Open in Mail');
    check('sms href begins exactly sms:?&body=', sms.getAttribute('href').startsWith('sms:?&body='));
    check('sms href is the draft, encodeURIComponent-ed, and nothing else', sms.getAttribute('href') === `sms:?&body=${encodeURIComponent(tricky.draft)}`, sms.getAttribute('href'));
    check('mailto href begins exactly mailto:?', mail.getAttribute('href').startsWith('mailto:?'));
    check('mailto carries subject + body, both encoded', mail.getAttribute('href') === `mailto:?subject=${encodeURIComponent(tricky.subject)}&body=${encodeURIComponent(tricky.draft)}`, mail.getAttribute('href'));
    check('no target on either anchor', sms.getAttribute('target') === undefined && mail.getAttribute('target') === undefined);
    tap(byText(r.s, 'button', 'Text'));
    check('a text-channel Mail anchor has no subject', one(r.s, '.yeo-mail').getAttribute('href') === `mailto:?body=${encodeURIComponent(tricky.draft)}`);

    // Copy: clipboard first, then the selected-textarea fallback.
    const written = [];
    nav.clipboard = { writeText: async (t) => written.push(t) };
    tap(one(r.s, '.yeo-copy'));
    await flush();
    check('Copy writes the draft verbatim to the clipboard', written.length === 1 && written[0] === tricky.draft);
    check('and says so', one(r.s, '.yeo-copy').textContent === 'Copied');

    nav.clipboard = null;
    const execs = [];
    document.execCommand = (cmd) => (execs.push(cmd), true);
    const r2 = await openSheet(Y, 'Reply', { answer: () => tricky });
    fill(r2.f);
    tap(r2.f.draft);
    await flush();
    tap(one(r2.s, '.yeo-copy'));
    check('no clipboard API -> execCommand("copy") on a selected textarea', execs.join() === 'copy' && one(r2.s, '.yeo-copy').textContent === 'Copied');
    check('and the buffer is removed after', !one(r2.s, '.yeo-copy-buf'));
    delete document.execCommand;

    // Paste, in the tap.
    nav.clipboard = { readText: async () => 'pasted from the phone' };
    const p = await openSheet(Y, 'Reply');
    tap(one(p.s, '.yeo-paste-btn'));
    await flush();
    check('Paste reads the clipboard into the box', p.f.paste.value === 'pasted from the phone');
    nav.clipboard = { readText: async () => { throw new Error('denied'); } };
    tap(one(p.s, '.yeo-paste-btn'));
    await flush();
    check('a refused paste says how to paste instead', /long-press/.test(p.f.status.textContent));
    nav.clipboard = null;

    // the source
    const schemes = [...new Set([...CODE.matchAll(/\b([a-z][a-z0-9+.-]*):(?=\?|\/\/)/gi)].map((m) => m[1].toLowerCase()))];
    check('the only scheme literals are sms: and mailto:', schemes.sort().join(',') === 'mailto,sms', schemes.join(','));
    check('no http(s), tel, javascript, data or obsidian anywhere', !/https?:|tel:|javascript:|data:|obsidian/i.test(CODE));
    check('one function builds the hand-off hrefs', (CODE.match(/function handoffHref\(/g) || []).length === 1);
    const fn = (CODE.match(/function handoffHref\([\s\S]*?\n\}/) || [''])[0];
    const outside = CODE.replace(fn, '');
    check('encodeURIComponent is only ever called inside it', /encodeURIComponent/.test(fn) && !/encodeURIComponent/.test(outside));
    check('every href is handoffHref(...)', [...CODE.matchAll(/href:\s*([^\s,}]+)/g)].every((m) => m[1].startsWith('handoffHref(')) &&
      (CODE.match(/href:/g) || []).length === 2);
    check('no target attribute in the module', !/target/.test(CODE));
    check('safeUrl() is untouched — the module does not import or widen it', !/safeUrl/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')) &&
      /protocol === 'http:' \|\| u\.protocol === 'https:'/.test(read('docs', 'lib', 'dom.js')));
    check('the module fetches nothing itself', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(CODE));
  }

  // -- Y13 ----------------------------------------------------------------------
  console.log('\nY13 — memory only, recents excepted');
  {
    storage = fakeStorage();
    const r = await openSheet(Y, 'Reply');
    fill(r.f);
    tap(r.f.draft);
    await flush();
    tap(byText(r.s, 'button', 'shorter'));
    await flush();
    const keys = [...storage.map.keys()];
    check('one localStorage key, the recents key', keys.join() === 'helm.yeoman.recents', keys.join());
    const stored = storage.map.get('helm.yeoman.recents');
    const list = JSON.parse(stored);
    check('a recent is {name, role, context} and nothing else', list.length === 1 &&
      Object.keys(list[0]).sort().join() === 'context,name,role' && list[0].name === 'Jeff' && list[0].role === 'customer');
    for (const secret of ['Any word on those blades', 'confirm and quote', 'Hi Jeff', 'PRICE', FIXTURE.read]) {
      check(`storage never holds "${secret.slice(0, 24)}"`, !stored.includes(secret));
    }

    const again = await openSheet(Y, 'Reply');
    const chip = one(again.s, '.yeo-recent');
    check('the next sheet offers the recent as a chip', chip?.textContent === 'Jeff · Customer');
    tap(chip);
    check('tapping it fills name, role and context', again.f.name.value === 'Jeff' && again.f.role.value === 'customer' &&
      again.f.context.value === 'waiting on a squeegee two weeks');
    check('and nothing else', again.f.paste.value === undefined && again.f.intent.value === undefined);

    for (let i = 0; i < 15; i++) {
      const x = await openSheet(Y, 'Reply');
      fill(x.f, { name: `Person ${i}` });
      tap(x.f.draft);
      await flush();
    }
    check('recents keep the last 12', JSON.parse(storage.map.get('helm.yeoman.recents')).length === 12);
    check('newest first', JSON.parse(storage.map.get('helm.yeoman.recents'))[0].name === 'Person 14');

    storage = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); } };
    const blocked = await openSheet(Y, 'Reply');
    fill(blocked.f);
    tap(blocked.f.draft);
    await flush();
    check('blocked storage still drafts', blocked.calls.length === 1 && !!one(blocked.s, '.yeo-draft'));
    storage = fakeStorage();

    const lsUses = [...CODE.matchAll(/localStorage\.(\w+)\(([^)]*)\)/g)];
    check('localStorage is only ever read/written at RECENTS_KEY', lsUses.length === 2 &&
      lsUses.every((m) => /^(getItem|setItem)$/.test(m[1]) && m[2].trim().startsWith('RECENTS_KEY')), lsUses.map((m) => m[0]).join(' '));
    check('the recents key is the only storage-shaped literal', (CODE.match(/'helm\.[^']*'/g) || []).join() === "'helm.yeoman.recents'");
    check('no sessionStorage / indexedDB', !/sessionStorage|indexedDB/.test(CODE));
    check('no innerHTML / outerHTML / insertAdjacentHTML', !/innerHTML|outerHTML|insertAdjacentHTML/.test(SRC));
    check('rule 7: no `new Date(`', !/new Date\(/.test(CODE));
    check('rule 7: no Date.parse / Date.now', !/Date\.(parse|now)/.test(CODE));
  }

  // -- states ---------------------------------------------------------------------
  console.log('\nstates');
  {
    let release;
    const slow = await openSheet(Y, 'Reply', { answer: () => new Promise((r) => { release = () => r(FIXTURE); }) });
    fill(slow.f);
    tap(slow.f.draft);
    await flush();
    check('waiting: "drafting…"', slow.f.status.textContent === 'drafting…' && !slow.f.status.classList.contains('hidden'));
    check('waiting: the Draft button is disabled', slow.f.draft.disabled === true);
    tap(slow.f.draft);
    await flush();
    check('a second tap while drafting sends nothing', slow.calls.length === 1);
    release();
    await flush();
    check('and it re-enables when the draft lands', slow.f.draft.disabled === false);

    const fail = (status, reason) => () => {
      const e = new Error(reason || `http ${status}`);
      if (status) e.status = status;
      e.reason = reason;
      throw e;
    };
    const cases = [
      [429, 'cap', 'daily cap reached — resets midnight UTC'],
      [502, 'upstream', 'the Yeoman’s out — try again'],
      [504, 'timeout', 'the Yeoman’s out — try again'],
      [503, 'no_system', 'the Yeoman has no voice book loaded yet'],
    ];
    for (const [status, reason, copy] of cases) {
      const x = await openSheet(Y, 'Reply', { answer: fail(status, reason) });
      fill(x.f);
      tap(x.f.draft);
      await flush();
      check(`${status} -> "${copy}"`, x.f.status.textContent === copy, x.f.status.textContent);
      check(`${status} leaves no stale draft on the sheet`, !one(x.s, '.yeo-draft'));
    }

    nav.onLine = false;
    const off = await openSheet(Y, 'Reply');
    fill(off.f);
    tap(off.f.draft);
    await flush();
    check('offline -> "needs a connection"', off.f.status.textContent === 'needs a connection');
    check('and no request is attempted', off.calls.length === 0);
    const dropped = await openSheet(Y, 'Reply', { answer: fail(0) });
    nav.onLine = true;
    fill(dropped.f);
    tap(dropped.f.draft);
    nav.onLine = false;
    await flush();
    check('a request that never reached the Worker while offline -> "needs a connection"', dropped.f.status.textContent === 'needs a connection');
    nav.onLine = true;
  }

  // -- the mock responder -------------------------------------------------------------
  console.log('\n?mock=1 /api/draft');
  {
    check('app.js routes draft to the mock responder under ?mock=1', /async draft\(payload\)\s*\{\s*if \(MOCK\) return mockDraft\(payload\);\s*return api\('\/api\/draft'/.test(APP));
    const fnSrc = (APP.match(/function mockDraft\(req\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    check('mockDraft found', fnSrc.length > 0);
    const mockDraft = new Function(`${fnSrc}\nreturn mockDraft;`)();
    const m = await mockDraft({ mode: 'reply', channel: 'email', to: { name: 'Pat', role: 'vendor' }, incoming: 'x' });
    check('it answers in the contract shape', ['read', 'assumed', 'subject', 'draft', 'blanks', 'usd', 'mode'].every((k) => k in m) && m.mode === 'draft');
    check('with exactly one blank, present in the draft', m.blanks.length === 1 && m.draft.includes(`[${m.blanks[0]}]`));
    const x = await openSheet(Y, 'Reply', { answer: (req) => mockDraft(req) });
    fill(x.f, { name: 'Pat' });
    tap(x.f.draft);
    await new Promise((r) => setTimeout(r, 500));
    await flush();
    check('the sheet renders the mock end to end', /Hi Pat/.test(one(x.s, '.yeo-draft')?.textContent || '') &&
      one(x.s, '.yeo-blanks')?.textContent === 'fill in: PRICE');
  }

  // -- the skin -------------------------------------------------------------------------
  console.log('\nNight Watch tokens only');
  {
    const start = CSS.indexOf('/* ---------------------------------------------------------------- yeoman');
    const end = CSS.indexOf('\n/* ---', start + 10);
    const block = start >= 0 ? CSS.slice(start, end > start ? end : undefined).replace(/\/\*[\s\S]*?\*\//g, '') : '';
    check('the yeoman stylesheet block exists', block.length > 0);
    check('no colour literal in it', !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(block), (block.match(/#[0-9a-f]{3,8}\b|rgba?\(/i) || [])[0]);
    check('assumed is the warn tone via color-mix', /\.yeo-assumed\s*\{[^}]*color-mix\(in srgb, var\(--warn\)/.test(block));
    const used = [...new Set([...block.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))];
    const rootBlock = (CSS.match(/:root\s*\{[\s\S]*?\n\}/) || [''])[0];
    check('every token it uses already exists in :root', used.every((t) => rootBlock.includes(`${t}:`)), used.filter((t) => !rootBlock.includes(`${t}:`)).join(','));
    check('inputs are 16px (no iOS focus zoom)', /\.yeo-input, \.yeo-select, \.yeo-paste\s*\{[^}]*font-size:\s*16px/.test(block));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('\ntest run crashed:', e && e.stack);
  process.exit(1);
});
