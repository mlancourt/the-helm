#!/usr/bin/env node
/**
 * The Helm — Wren tile tests (vault spec `Wren-Tile-Spec.md` v1.0, WT1–WT12).
 * Node, zero deps, no browser.
 *
 *   node tools/test-wren.js
 *
 * The `yeoman` tile is Wren's face now. Driven the way a thumb would: render
 * the card, open the sheet, tap a tab, answer a question, talk to her — and
 * read what the actions were handed and what landed in the DOM. The Draft
 * face is the Yeoman's sheet and is held by tools/test-yeoman.js; this file
 * holds everything she added on top of it:
 *
 *   WT2  the face: opening, ≤ 3 attention lines, more ▸, a badge that counts
 *        OPEN QUESTIONS and nothing else; no brief → one muted line
 *   rule 8  a stale brief greys, with its own date, verbatim
 *   WT10 the two event shapes, pending + the undo valve, and "Send as note"
 *        filing Matt's words, never hers
 *   WT9  Talk asks the brain as persona "wren" and the chip says which brain
 *        answered — the ask tile's own states
 *   rule 10  bold is built from split text; the module has no HTML sink
 *   WT5  `?tile=yeoman` opens the sheet once and leaves the URL clean
 *   WT4  the Worker's closed event list takes exactly the two new shapes
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
const SW = read('docs', 'sw.js');
const CONFIG = read('docs', 'config.js');

const nav = { onLine: true, clipboard: null };
Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  get: () => ({ getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }),
  configurable: true,
});
const opened = [];
globalThis.window = { open: (u, t) => opened.push([u, t]) };

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};
const tap = (node) => node.listeners.click[0]({ stopPropagation() {} });
const byText = (root, tag, text) => root.querySelectorAll(tag).find((n) => n.textContent === text);
const one = (root, cls) => root.querySelector(cls);
const visible = (n) => !!n && !n.classList.contains('hidden');

// -------------------------------------------------------------- fixtures

const BRIEF = {
  path: '06-AI-Stack/Wren/Briefs/2026-10/2026-10-27 0449 - Brief.md',
  date: '2026-10-27',
  generated_at: '2026-10-27T09:52:10Z',
  title: 'Wren — Mon 10/27, 4:52 CDT',
  opening: 'Quiet-ish morning. **Two things** worth a minute.',
  attention: ['**Pat (Acme) — fishing for a discount.** Hold price.', '**Second** line.', 'Third line.', 'FOURTH LINE only in the sheet.'],
  people: ['**Aunt Example** — jokes.'],
  record: ['Parts shipped.'],
  question_lines: ['Weekends?'],
  extra: [{ title: 'For the crew', lines: ['**MC → the Architect** — invented.\n> paste block'] }],
  stale: false,
};
const QUESTIONS = [
  { qid: '3fa1c92b0e', date: '2026-10-25', text: 'Weekends: one morning sweep, or leave them quiet? (re: cadence)' },
  { qid: '0ddfa170fc', date: '2026-10-26', text: 'Aunt Example — a nudge, or leave her to you? (re: Aunt Example)' },
];
const tileOf = (data, extra = {}) => ({ band: 'DAILY', status: 'ok', error: null, updated_at: '2026-10-27T10:00:00Z', data, ...extra });

function harness({ ask, pending = [], submit, withdraw } = {}) {
  const calls = { submit: [], withdraw: [], ask: [] };
  let n = 0;
  const panel = { title: null, body: null };
  const ctx = {
    id: 'yeoman',
    title: 'Wren',
    pending,
    actions: {
      openPanel(title, build) {
        panel.title = title;
        panel.body = new El('div');
        build(panel.body);
      },
      async submitEvent(ev, opts) {
        calls.submit.push([JSON.parse(JSON.stringify(ev)), opts]);
        if (submit) return submit(ev);
        n++;
        return { id: `2026-10-27T10:00:0${n}.000Z:evt00${n}`, ts: '2026-10-27T10:00:00Z', actor: 'Matt', ...ev };
      },
      async withdrawEvent(id, opts) {
        calls.withdraw.push([id, opts]);
        if (withdraw) return withdraw(id);
      },
      async ask(payload) {
        calls.ask.push(JSON.parse(JSON.stringify(payload)));
        return ask ? ask(payload, calls.ask.length) : { answer: `reply ${calls.ask.length}`, mode: 'vault', usd: 0.01, files_read: [] };
      },
      async draft() {
        return { read: null, assumed: null, subject: null, draft: 'x', blanks: [], usd: 0, mode: 'draft' };
      },
    },
  };
  return { ctx, calls, panel, face: new El('div') };
}

const tabBtn = (s, label) => s.querySelectorAll('.wren-tab').find((b) => b.textContent === label);
const pane = (s, key) => one(s, `.wren-pane-${key}`);

(async () => {
  console.log('The Helm — Wren tile tests\n');
  const Y = await import('../docs/tiles/yeoman.js');
  const { REGISTRY } = await import('../docs/tiles/_registry.js');
  const { askBrainFirst } = await import('../docs/lib/brain.js');
  const { FAILURES } = await import('../docs/tiles/ask.js');

  // -- registry ------------------------------------------------------------
  console.log('registry (WT1)');
  {
    const e = REGISTRY.yeoman;
    check('the id stays yeoman, titled Wren', e?.title === 'Wren');
    check('band and position unchanged (ASK, 15)', e?.band === 'ASK' && e?.position === 15);
    check('same module', e?.module === './tiles/yeoman.js');
    check('no tile id "wren" was added', !('wren' in REGISTRY));
  }

  // -- face, with a brief ----------------------------------------------------
  console.log('\nthe face, with a brief (WT2)');
  {
    const h = harness();
    Y.render(h.face, tileOf({ brief: BRIEF, questions: QUESTIONS }), h.ctx);
    const opening = one(h.face, '.wren-opening');
    check('the opening line', opening?.textContent === 'Quiet-ish morning. Two things worth a minute.', opening?.textContent);
    check('its bold is a <strong>, not asterisks', opening.querySelectorAll('strong').map((n) => n.textContent).join('|') === 'Two things');
    const attn = h.face.querySelectorAll('.wren-attn').flatMap((u) => u.querySelectorAll('li'));
    check('three attention lines, not four', attn.length === 3, String(attn.length));
    check('in payload order', attn.map((li) => li.textContent).join('|') === 'Pat (Acme) — fishing for a discount. Hold price.|Second line.|Third line.');
    check('the fourth is not on the face', !/FOURTH LINE/.test(h.face.textContent));
    check('a "more ▸" affordance', one(h.face, '.wren-more')?.textContent === 'more ▸');
    const badge = one(h.face, '.wren-badge');
    check('the badge counts open questions (2), not attention lines (4)', badge?.textContent === '2 questions', badge?.textContent);
    check('nothing on the face counts anything else', !/\b4\b/.test(h.face.textContent));
    const buttons = h.face.querySelectorAll('.yeo-face-btn').map((b) => b.textContent);
    check('Talk / Draft still on the face', buttons.join('|') === 'Talk|Draft', buttons.join('|'));
    check('not greyed when fresh', !one(h.face, '.wren-stale'));

    const one1 = harness();
    Y.render(one1.face, tileOf({ brief: BRIEF, questions: QUESTIONS.slice(0, 1) }), one1.ctx);
    check('one question reads "1 question"', one(one1.face, '.wren-badge')?.textContent === '1 question');
    const none = harness();
    Y.render(none.face, tileOf({ brief: BRIEF, questions: [] }), none.ctx);
    check('no open questions → no badge, never a zero', !one(none.face, '.wren-badge'));
    const junk = harness();
    Y.render(junk.face, tileOf({ brief: BRIEF, questions: [null, 'x', { qid: 7 }, { qid: 'abc', text: '  ' }, QUESTIONS[0]] }), junk.ctx);
    check('only well-formed questions count', one(junk.face, '.wren-badge')?.textContent === '1 question');

    tap(one(h.face, '.wren-more'));
    check('more ▸ opens the sheet on the Brief tab', h.panel.title === 'Wren' && tabBtn(h.panel.body, 'Brief')?.getAttribute('aria-selected') === 'true');
    const q = harness();
    Y.render(q.face, tileOf({ brief: BRIEF, questions: QUESTIONS }), q.ctx);
    tap(one(q.face, '.wren-badge'));
    check('the badge opens the Questions tab', tabBtn(q.panel.body, 'Questions')?.getAttribute('aria-selected') === 'true');
  }

  // -- face, without a brief / stale ----------------------------------------------
  console.log('\nno brief, and a stale one (rule 8)');
  {
    for (const [label, t] of [['tile undefined', undefined], ['tile null', null], ['brief null', tileOf({ brief: null, questions: [] })], ['data junk', tileOf('nope')]]) {
      const h = harness();
      let threw = null;
      try {
        Y.render(h.face, t, h.ctx);
      } catch (e) {
        threw = e;
      }
      check(`${label}: renders, no throw`, !threw, threw && threw.message);
      check(`${label}: one muted line "No brief this morning."`, h.face.querySelectorAll('.yeo-line').map((n) => n.textContent).join('|') === 'No brief this morning.');
      check(`${label}: Talk + Draft offered`, h.face.querySelectorAll('button').map((b) => b.textContent).join('|') === 'Talk|Draft');
    }
    const qOnly = harness();
    Y.render(qOnly.face, tileOf({ brief: null, questions: QUESTIONS }), qOnly.ctx);
    check('no brief but open questions → the badge still shows', one(qOnly.face, '.wren-badge')?.textContent === '2 questions');

    const st = harness();
    Y.render(st.face, tileOf({ brief: { ...BRIEF, stale: true, date: '2026-10-24' }, questions: [] }), st.ctx);
    check('a stale brief greys its face', !!one(st.face, '.wren-stale'));
    check('and says its own date, verbatim', one(st.face, '.wren-stale-line')?.textContent === 'brief from 2026-10-24 — not this morning’s');
    tap(one(st.face, '.wren-more'));
    check('the Brief tab greys too', !!one(pane(st.panel.body, 'brief'), '.wren-stale'));
  }

  // -- the sheet + the Brief tab -------------------------------------------------
  console.log('\nthe sheet: four faces, Brief in full');
  {
    const h = harness();
    Y.openSheet(tileOf({ brief: BRIEF, questions: QUESTIONS }), h.ctx);
    const s = h.panel.body;
    check('tabs Brief · Questions · Talk · Draft', s.querySelectorAll('.wren-tab').map((b) => b.textContent).join('|') === 'Brief|Questions|Talk|Draft');
    check('Brief is the default', visible(pane(s, 'brief')) && !visible(pane(s, 'draft')));
    check('the Draft face is not built until it is opened', !one(s, '.yeo-sheet'));
    const heads = pane(s, 'brief').querySelectorAll('.wren-head').map((n) => n.textContent);
    check('sections headed as the spec names them, plus an extra', heads.join('|') === 'Worth your attention|People|For the record|A question for you|For the crew', heads.join('|'));
    check('all four attention lines in the sheet', /FOURTH LINE only in the sheet\./.test(pane(s, 'brief').textContent));
    check('the title and the source path, verbatim', one(s, '.wren-title')?.textContent === BRIEF.title && one(s, '.wren-source')?.textContent === BRIEF.path);
    const crew = pane(s, 'brief').querySelectorAll('li').find((li) => /MC →/.test(li.textContent));
    check('a multi-line crew item keeps its newline as text', crew?.textContent === 'MC → the Architect — invented.\n> paste block');
    check('no "**" reaches the DOM', !/\*\*/.test(s.textContent));

    const empty = harness();
    Y.openSheet(tileOf({ brief: { ...BRIEF, people: [], record: [], extra: [] }, questions: [] }), empty.ctx);
    check('an empty section is not drawn', !pane(empty.panel.body, 'brief').querySelectorAll('.wren-head').some((n) => n.textContent === 'People'));

    tap(tabBtn(s, 'Draft'));
    check('Draft builds the Yeoman sheet under its tab', visible(pane(s, 'draft')) && !!one(pane(s, 'draft'), '.yeo-sheet') && !visible(pane(s, 'brief')));
    check('…which opens in Reply, as it always has', one(pane(s, 'draft'), '.yeo-seg-btn')?.getAttribute('aria-pressed') === 'true');
    tap(tabBtn(s, 'Brief'));
    tap(tabBtn(s, 'Draft'));
    check('switching back does not build it twice', pane(s, 'draft').querySelectorAll('.yeo-sheet').length === 1);
  }

  // -- bold via split text -----------------------------------------------------
  console.log('\nbold is split text (rule 10)');
  {
    const n = Y.rich('p', 'x', 'a **b** c **d**');
    check('two strongs', n.querySelectorAll('strong').map((s) => s.textContent).join('|') === 'b|d');
    check('the text reads clean', n.textContent === 'a b c d');
    const u = Y.rich('p', 'x', 'open **never closed');
    check('an unclosed marker stays literal', u.textContent === 'open **never closed' && u.querySelectorAll('strong').length === 0);
    const html = Y.rich('p', 'x', '**<img src=x onerror=alert(1)>**');
    check('markup inside bold is text, not an element', html.querySelectorAll('strong')[0]?.textContent === '<img src=x onerror=alert(1)>' && html.querySelectorAll('img').length === 0);
    check('source scan: no innerHTML / outerHTML / insertAdjacentHTML in the module', !/innerHTML|outerHTML|insertAdjacentHTML/.test(SRC));
    check('source scan: bold is split on the marker and built with createTextNode', /\.split\('\*\*'\)/.test(CODE) && /document\.createTextNode\(/.test(CODE));
    check('source scan: rule 7 — no clock in the module', !/new Date\(|Date\.(parse|now)/.test(CODE));
    check('source scan: the module fetches nothing itself', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(CODE));
  }

  // -- Questions ----------------------------------------------------------------
  console.log('\nQuestions: answer, pending, undo (WT10, rule 5)');
  {
    const h = harness();
    Y.openSheet(tileOf({ brief: BRIEF, questions: QUESTIONS }), h.ctx, 'questions');
    const p = pane(h.panel.body, 'questions');
    const rows = p.querySelectorAll('.wren-q');
    check('one row per open question', rows.length === 2);
    check('each with its date and text, verbatim', one(rows[0], '.wren-q-date')?.textContent === '2026-10-25' && one(rows[0], '.wren-q-text')?.textContent === QUESTIONS[0].text);
    check('the answer box waits for a tap', !visible(one(rows[0], '.wren-answer')) && !visible(one(rows[0], '.wren-send')));
    tap(one(rows[0], '.wren-tap'));
    check('tap → a textarea and Send', visible(one(rows[0], '.wren-answer')) && visible(one(rows[0], '.wren-send')));
    check('the box is capped at 2,000', one(rows[0], '.wren-answer').getAttribute('maxlength') === '2000');

    tap(one(rows[0], '.wren-send'));
    await flush();
    check('an empty answer sends nothing', h.calls.submit.length === 0);

    one(rows[0], '.wren-answer').value = '  Leave weekends quiet.  ';
    tap(one(rows[0], '.wren-send'));
    await flush();
    const [ev, opts] = h.calls.submit[0] || [];
    check('Send files exactly one event', h.calls.submit.length === 1);
    check('wren_answer {qid, question, answer} — the spec shape, trimmed',
      JSON.stringify(ev) === JSON.stringify({ type: 'wren_answer', payload: { qid: '3fa1c92b0e', question: QUESTIONS[0].text, answer: 'Leave weekends quiet.' } }), JSON.stringify(ev));
    check('filed quietly, so the sheet stays open', opts && opts.quiet === true);
    const row0 = p.querySelectorAll('.wren-q')[0];
    check('the question now wears the pending badge', row0.querySelectorAll('.pill').some((n) => n.textContent === 'pending' && n.classList.contains('pill-pending')));
    check('with what Matt said, as text', one(row0, '.wren-said')?.textContent === 'Leave weekends quiet.');
    check('and never as answered', !/answered|applied|done/i.test(row0.textContent));
    check('the other question is untouched', !p.querySelectorAll('.wren-q')[1].querySelectorAll('.pill').length);

    tap(one(row0, '.wren-undo'));
    await flush();
    check('undo withdraws that one event, quietly', h.calls.withdraw.length === 1 && h.calls.withdraw[0][0] === '2026-10-27T10:00:01.000Z:evt001' && h.calls.withdraw[0][1]?.quiet === true);
    check('and the question is answerable again', !p.querySelectorAll('.wren-q')[0].querySelectorAll('.pill').length && !!one(p.querySelectorAll('.wren-q')[0], '.wren-tap'));

    // Seeded from what the Worker already holds: the page shows pending until
    // the snapshot stops listing the qid.
    const held = { id: '2026-10-27T09:00:00.000Z:abc123', type: 'wren_answer', payload: { qid: '0ddfa170fc', question: QUESTIONS[1].text, answer: 'leave her to me' } };
    const other = { id: 'x', type: 'field_note', payload: { text: 'unrelated' } };
    const s2 = harness({ pending: [held, other] });
    Y.openSheet(tileOf({ brief: BRIEF, questions: QUESTIONS }), s2.ctx, 'questions');
    const r2 = pane(s2.panel.body, 'questions').querySelectorAll('.wren-q');
    check('a pending answer from /api/data shows on load', r2[1].querySelectorAll('.pill').some((n) => n.textContent === 'pending') && one(r2[1], '.wren-said')?.textContent === 'leave her to me');
    check('other event types are ignored', !r2[0].querySelectorAll('.pill').length);
    tap(one(r2[1], '.wren-undo'));
    await flush();
    check('and its undo is the DELETE of that id', s2.calls.withdraw[0]?.[0] === held.id);
    const gone = harness({ pending: [held] });
    Y.openSheet(tileOf({ brief: BRIEF, questions: QUESTIONS.slice(0, 1) }), gone.ctx, 'questions');
    check('once the snapshot drops the qid, the row is gone', pane(gone.panel.body, 'questions').querySelectorAll('.wren-q').length === 1 && !/leave her to me/.test(gone.panel.body.textContent));

    const bad = harness({ submit: () => Promise.reject(new Error('mock mode — events are not sent')) });
    Y.openSheet(tileOf({ brief: null, questions: QUESTIONS }), bad.ctx, 'questions');
    const br = pane(bad.panel.body, 'questions').querySelectorAll('.wren-q')[0];
    tap(one(br, '.wren-tap'));
    one(br, '.wren-answer').value = 'yes';
    tap(one(br, '.wren-send'));
    await flush();
    check('a failed send says so and stays answerable', /couldn’t send that — mock mode/.test(one(br, '.yeo-status')?.textContent || '') && !br.querySelectorAll('.pill').length);
    const long = harness();
    Y.openSheet(tileOf({ brief: null, questions: QUESTIONS }), long.ctx, 'questions');
    const lr = pane(long.panel.body, 'questions').querySelectorAll('.wren-q')[0];
    tap(one(lr, '.wren-tap'));
    one(lr, '.wren-answer').value = 'x'.repeat(2001);
    tap(one(lr, '.wren-send'));
    await flush();
    check('past 2,000 characters nothing is sent', long.calls.submit.length === 0);
    const nq = harness();
    Y.openSheet(tileOf({ brief: BRIEF, questions: [] }), nq.ctx, 'questions');
    check('no open questions → one quiet line', pane(nq.panel.body, 'questions').textContent === 'No open questions.');
  }

  // -- Talk -------------------------------------------------------------------------
  console.log('\nTalk: brain as Wren, the Worker as fallback (WT9)');
  {
    const data = { brief: BRIEF, questions: QUESTIONS };
    const h = harness();
    Y.openSheet(tileOf(data), h.ctx, 'talk');
    const p = pane(h.panel.body, 'talk');
    const input = one(p, '.ask-input');
    const send = byText(p, 'button', 'Send');
    check('no note button before Matt has said anything', !visible(one(p, '.wren-note')));
    input.value = 'How should I answer Pat?';
    tap(send);
    await flush();
    const a = h.calls.ask[0];
    check('one ask', h.calls.ask.length === 1);
    check('persona "wren", pinned to this tile with its data', a?.persona === 'wren' && a?.tile_id === 'yeoman' && JSON.stringify(a?.tile_data) === JSON.stringify(data));
    check('q is Matt’s words, history empty on the first turn', a?.q === 'How should I answer Pat?' && Array.isArray(a?.history) && a.history.length === 0);
    const bubbles = p.querySelectorAll('.bubble').map((b) => b.textContent);
    check('the transcript, as text', bubbles.join('|') === 'How should I answer Pat?|reply 1', bubbles.join('|'));
    check('the chip says vault', one(p, '.pill-mode')?.textContent === 'vault');

    for (let i = 2; i <= 8; i++) {
      input.value = `turn ${i}`;
      tap(send);
      await flush();
    }
    const last = h.calls.ask[h.calls.ask.length - 1];
    check('history sent is ≤ 10, role + content only', last.history.length <= 10 && last.history.every((m) => Object.keys(m).join() === 'role,content'), String(last.history.length));
    check('the transcript in memory stays ≤ 10', p.querySelectorAll('.bubble').length <= 10, String(p.querySelectorAll('.bubble').length));

    tap(one(p, '.wren-note-btn'));
    await flush();
    const [note, nopts] = h.calls.submit[0] || [];
    check('Send as note files wren_note {text} with MATT’s last message', JSON.stringify(note) === JSON.stringify({ type: 'wren_note', payload: { text: 'turn 8' } }), JSON.stringify(note));
    check('never the model’s text', !/reply/.test(JSON.stringify(note)));
    check('quietly', nopts?.quiet === true);
    check('the note shows pending, with undo', one(p, '.wren-note').querySelectorAll('.pill').some((n) => n.textContent === 'pending') && !!one(p, '.wren-undo'));
    tap(one(p, '.wren-undo'));
    await flush();
    check('undo withdraws the note', h.calls.withdraw[0]?.[0] === '2026-10-27T10:00:01.000Z:evt001' && !!one(p, '.wren-note-btn'));

    // The fallback chip: the shell's ask() tags a Worker answer "snapshot".
    const fb = harness({ ask: () => ({ answer: 'from the snapshot', mode: 'snapshot', usd: 0.002 }) });
    Y.openSheet(tileOf(data), fb.ctx, 'talk');
    const fp = pane(fb.panel.body, 'talk');
    one(fp, '.ask-input').value = 'hi';
    tap(byText(fp, 'button', 'Send'));
    await flush();
    check('a Worker answer reads "snapshot"', one(fp, '.pill-mode')?.textContent === 'snapshot');

    for (const [reason, chip] of [['cap', 'cap'], ['signin', 'sign in'], ['timeout', 'slow'], ['upstream', 'off']]) {
      const x = harness({ ask: () => Promise.reject(Object.assign(new Error(reason), { reason, login: 'https://brain.example.invalid/health' })) });
      Y.openSheet(tileOf(data), x.ctx, 'talk');
      const xp = pane(x.panel.body, 'talk');
      one(xp, '.ask-input').value = 'hi';
      tap(byText(xp, 'button', 'Send'));
      await flush();
      const shown = reason === 'signin' ? (visible(one(xp, '.ask-signin')) ? 'sign in' : '') : one(xp, '.pill-mode')?.textContent;
      check(`${reason} → chip "${chip}" (the ask tile's state)`, shown === chip && FAILURES[reason][1] === chip, shown);
      check(`${reason} → the ask tile's words in the transcript`, xp.querySelectorAll('.bubble').some((b) => b.textContent === FAILURES[reason][0]));
    }

    // The brain call itself: persona rides to the brain; the Worker answers
    // the same payload when the brain is down, and the chip says snapshot.
    const sent = [];
    const fetchDown = async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { status: 502, ok: false, type: 'basic', url, json: async () => ({ reason: 'upstream' }) };
    };
    let workerGot = null;
    const r = await askBrainFirst({ q: 'hi', history: [], persona: 'wren', tile_id: 'yeoman', tile_data: data }, {
      brainBase: 'https://brain.example.invalid', fetchImpl: fetchDown, timeoutMs: 1000,
      workerAsk: async (b) => ((workerGot = b), { answer: 'snap', mode: 'snapshot', usd: 0 }),
    });
    check('lib/brain.js sends persona to the brain', sent[0]?.persona === 'wren');
    check('a brain 5xx falls back to the Worker with the tile pinned', workerGot?.tile_id === 'yeoman' && r.mode === 'snapshot');
  }

  // -- ?tile= --------------------------------------------------------------------
  console.log('\n?tile=yeoman (WT5)');
  {
    const fnSrc = (APP.match(/function openFromQuery\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    check('the shell has openFromQuery', fnSrc.length > 0);
    check('boot calls it after the first load', /await refresh\(\);\s*startLiveBand\(\);\s*openFromQuery\(\);/.test(APP));
    const run = (search, { snapshot } = {}) => {
      const params = new URLSearchParams(search);
      const replaced = [];
      const opens = [];
      const moduleNs = new Map([['yeoman', { openSheet: (tile, ctx) => opens.push({ tile, ctx }) }], ['dinner', {}]]);
      const state = { snapshot: snapshot || { tiles: { yeoman: tileOf({ brief: BRIEF, questions: QUESTIONS }) } }, pending: [], live: null, weather: null };
      const fn = new Function('params', 'history', 'location', 'moduleNs', 'REGISTRY', 'state', 'actions', `${fnSrc}\nreturn openFromQuery;`)(
        params, { replaceState: (_a, _b, u) => replaced.push(u) }, { pathname: '/', hash: '' }, moduleNs, REGISTRY, state, { tag: 'actions' }
      );
      fn();
      return { opens, replaced };
    };
    const a = run('?tile=yeoman');
    check('opens the yeoman sheet once', a.opens.length === 1);
    check('with its snapshot tile and the registry title', a.opens[0]?.tile?.data?.brief?.title === BRIEF.title && a.opens[0]?.ctx?.title === 'Wren' && a.opens[0]?.ctx?.actions?.tag === 'actions');
    check('and strips the param', a.replaced.join() === '/');
    const b = run('?mock=1&tile=yeoman');
    check('other params survive', b.replaced.join() === '/?mock=1' && b.opens.length === 1);
    check('no param → nothing touched', (({ opens, replaced }) => !opens.length && !replaced.length)(run('?mock=1')));
    for (const bad of ['ask', 'dinner', 'nope', '../x', 'YEOMAN']) {
      const x = run(`?tile=${encodeURIComponent(bad)}`);
      check(`?tile=${bad} opens nothing, still stripped`, x.opens.length === 0 && x.replaced.length === 1);
    }
    const c = run('?tile=yeoman', { snapshot: { tiles: {} } });
    check('no snapshot entry → the ASK stand-in, still opens', c.opens.length === 1 && c.opens[0].tile?.data === null);
    check('no new URL scheme in the shell for it', !/['"`](sms|mailto|tel|intent|helm):/.test(fnSrc));

    const h = harness();
    Y.openSheet(tileOf({ brief: BRIEF, questions: QUESTIONS }), h.ctx);
    check('Y.openSheet opens the Brief face', h.panel.title === 'Wren' && visible(pane(h.panel.body, 'brief')));
  }

  // -- the shell's quiet events ---------------------------------------------------
  console.log('\nshell + SW');
  {
    check('submitEvent takes {quiet} and then repaints the header only', /async submitEvent\(event, \{ quiet = false \} = \{\}\)[\s\S]*?if \(quiet\) renderHeader\(\);\s*else renderAll\(\);/.test(APP));
    check('withdrawEvent takes {quiet} too', /async withdrawEvent\(id, \{ quiet = false \} = \{\}\)[\s\S]*?if \(quiet\) renderHeader\(\);\s*else renderAll\(\);/.test(APP));
    check('APP_VERSION 1.39.0', /APP_VERSION = '1\.39\.0'/.test(CONFIG));
    check('CACHE_VERSION helm-v60', /CACHE_VERSION = 'helm-v60'/.test(SW));
    check('/api/ask, /api/draft and the brain still bypass the cache', /url\.hostname === 'brain\.lannyai\.com'/.test(SW) && /endsWith\('\/api\/ask'\)/.test(SW) && /endsWith\('\/api\/draft'\)/.test(SW));
    const mock = JSON.parse(read('docs', 'mock', 'helm-data.json'));
    const m = mock.tiles.yeoman;
    check('the mock carries a yeoman tile in the producer’s shape', m?.band === 'DAILY' && !!m.data?.brief && Array.isArray(m.data?.questions));
    check('the mock questions carry 10-hex qids', m.data.questions.every((q) => /^[0-9a-f]{10}$/.test(q.qid)));
    check('the payload carries lines, never a count (W1)', !Object.keys(m.data).some((k) => /count|total|n_/.test(k)) && !Object.keys(m.data.brief).some((k) => /count|total|items$/.test(k)));
    const h = harness();
    Y.render(h.face, m, h.ctx);
    check('and renders', !!one(h.face, '.wren-opening') && one(h.face, '.wren-badge')?.textContent === `${m.data.questions.length} questions`);
  }

  // -- the Worker's closed list ----------------------------------------------------
  console.log('\nthe Worker takes exactly the two new shapes (WT4/WT10)');
  {
    const W = await import('../worker/worker.js');
    const E = W.eventShapeError;
    const ok = { qid: '3fa1c92b0e', question: 'q?', answer: 'a' };
    check('wren_answer ok', E('wren_answer', ok) === null);
    check('wren_note ok', E('wren_note', { text: 'a note' }) === null);
    check('answer at 2,000 ok, 2,001 refused', E('wren_answer', { ...ok, answer: 'x'.repeat(2000) }) === null && typeof E('wren_answer', { ...ok, answer: 'x'.repeat(2001) }) === 'string');
    check('text at 2,000 ok, 2,001 refused', E('wren_note', { text: 'x'.repeat(2000) }) === null && typeof E('wren_note', { text: 'x'.repeat(2001) }) === 'string');
    check('question at 500 ok, 501 refused', E('wren_answer', { ...ok, question: 'x'.repeat(500) }) === null && typeof E('wren_answer', { ...ok, question: 'x'.repeat(501) }) === 'string');
    for (const qid of ['3FA1C92B0E', '3fa1c92b0', '3fa1c92b0e1', 'zzzzzzzzzz', 1234567890, null]) check(`qid ${JSON.stringify(qid)} refused`, typeof E('wren_answer', { ...ok, qid }) === 'string');
    check('empty / blank / non-string answer refused', ['', '   ', 7, null].every((a) => typeof E('wren_answer', { ...ok, answer: a }) === 'string'));
    check('missing question refused', typeof E('wren_answer', { qid: ok.qid, answer: 'a' }) === 'string');
    check('empty note refused', typeof E('wren_note', { text: '  ' }) === 'string' && typeof E('wren_note', {}) === 'string' && typeof E('wren_note', null) === 'string');
    check('the four old types still validate', E('field_note', { text: 'x' }) === null && E('meal_verdict', { date: '2026-10-27', verdict: 'HIT' }) === null);
    check('anything else is still refused', /type must be one of/.test(E('wren_send_mail', {}) || '') && /type must be one of/.test(E('__proto__', {}) || ''));
    check('the closed list names six types', /meal_verdict, build_request, field_note, mileage, wren_answer, wren_note$/.test(E('nope', {})));
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
