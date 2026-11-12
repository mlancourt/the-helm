#!/usr/bin/env node
/**
 * The Helm — purser_due: the Purser's notes + money out. Node, zero deps, on
 * the shared DOM shim.
 *
 *   node tools/test-purser-notes.js
 *
 * Vault spec `Purser-Money-Desk-Tile-Spec.md`, PM1–PM8. The rulings with teeth:
 *
 *   P7/PM1  nothing drawn for `heads_up: null`, `notes: []` with no problem,
 *           or `money_out: null` — and with both keys null or absent, the
 *           face and sheet are BYTE-IDENTICAL to v1.48.0's markup (a golden
 *           taken from git, below).
 *   PM5     an urgent note's mark is the act tone; nothing else on the row is.
 *   PM6     a `problem` is one line in the act tone.
 *   PM7     every string through textContent.
 *   PM8     no arithmetic on money, no dates built; `$NaN` / `$0.00` never.
 *   rule 5/6  no buttons, no inputs, no events.  rule 9  hostile shapes.
 *
 * Fixtures come from tools/make-mock-data.js (invented data), run per flag so
 * they always carry Central today, plus the fixed payloads below.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { El } = require('./dom-shim.js');

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

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const mock = (flag) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'make-mock-data.js'), ...(flag ? [flag] : [])], { encoding: 'utf8' })).tiles.purser_due;
const text = (n) => (n ? n.textContent : '');
const count = (n, cls) => n.querySelectorAll('.' + cls).length;

// --- BEGIN shared fixtures 
const STACK = {
  known_through: '2026-09-17',
  items: [
    { kind: 'card', emoji: '🟦', name: 'Blue card', full_name: 'Made-Up Blue Cash (…6543)', amount: 412.88, amount_display: true, due: '2026-09-24', days_out: 3, tone: 'act', pay_mode: 'manual', reminder: '2026-09-22' },
    { kind: 'bill', emoji: '🏠', name: 'Mortgage', full_name: 'Invented Savings Bank — mortgage', amount: 2184, amount_display: true, due: '2026-10-02', days_out: 11, tone: 'fund', pay_mode: 'auto', reminder: null },
    { kind: 'card', emoji: '🟩', name: 'Shop card', full_name: 'Pretend Rewards Visa (…2201)', amount: 1290.4, amount_display: false, due: '2026-10-08', days_out: 17, tone: 'act', pay_mode: 'manual', reminder: null },
  ],
  totals: { next_45d: 3887.28, next_14d: 2596.88, manual: 1703.28, auto: 2184, quarterly_escrow: 42.5 },
  ur_available: 148200,
  streak: { clean_statements: 31, since: '2024-02-01' },
  unscheduled: [{ emoji: '🛡️', name: 'Umbrella policy', amount: 412, why: 'annual premium; no pay day in the config' }],
};
const PAYLOADS = {
  full: STACK,
  empty: { known_through: '2026-09-17', items: [] },
  bare: {},
};
function ser(n) {
  if (!n || !n.tagName) return JSON.stringify(n ? n.textContent : '');
  const attrs = Object.keys(n.attrs).filter((k) => k !== 'class').sort().map((k) => `${k}=${JSON.stringify(n.attrs[k])}`);
  const on = Object.keys(n.listeners).sort().map((k) => `on${k}`);
  const kids = n.childNodes.length ? n.childNodes.map(ser).join('') : n._text ? JSON.stringify(n._text) : '';
  const tag = n.tagName.toLowerCase();
  return `<${tag} class=${JSON.stringify(n.className)}${[...attrs, ...on].map((a) => ' ' + a).join('')}>${kids}</${tag}>`;
}
/** Face + sheet markup for one payload. */
function drawBoth(mod, data, El) {
  const root = new El('div');
  const opened = [];
  mod.render(root, { band: 'DAILY', status: 'ok', data }, { id: 'purser_due', actions: { openPanel: (title, build) => opened.push({ title, build }) } });
  const face = root.querySelector('.purser-face');
  face.listeners.click[0]({});
  const body = new El('div');
  opened[0].build(body);
  return { face: ser(root), sheet: ser(body), title: opened[0].title };
}

// Markup of HEAD's purser_due.js (v1.48.0, before PM1–PM8) for the payloads above — generated once from git, never by hand.
const GOLDEN = {
 "full": {
  "face": "<div class=\"\"><div class=\"purser-face purser-tappable\" aria-label=\"Open the due stack breakdown\" role=\"button\" tabindex=\"0\" onclick onkeydown><div class=\"purser\"><div class=\"purser-row\" title=\"Made-Up Blue Cash (…6543)\"><span class=\"purser-emoji\" aria-hidden=\"true\">\"🟦\"</span><div class=\"purser-main\"><div class=\"purser-name\">\"Blue card\"</div><div class=\"purser-meta\"><span class=\"purser-days\">\"9/24  ·  in 3 days\"</span></div></div><div class=\"purser-side\"><span class=\"purser-amount\">\"$412.88\"</span><div class=\"purser-marks\"><span class=\"purser-alarm\" aria-label=\"reminder due\">\"⏰\"</span><span class=\"purser-dot purser-dot-act\" aria-hidden=\"true\"></span></div></div></div><div class=\"purser-row\" title=\"Invented Savings Bank — mortgage\"><span class=\"purser-emoji\" aria-hidden=\"true\">\"🏠\"</span><div class=\"purser-main\"><div class=\"purser-name\">\"Mortgage\"</div><div class=\"purser-meta\"><span class=\"purser-days\">\"10/2  ·  in 11 days\"</span></div></div><div class=\"purser-side\"><span class=\"purser-amount\">\"$2,184.00\"</span><div class=\"purser-marks\"><span class=\"purser-dot purser-dot-fund\" aria-hidden=\"true\"></span></div></div></div><div class=\"purser-row\" title=\"Pretend Rewards Visa (…2201)\"><span class=\"purser-emoji\" aria-hidden=\"true\">\"🟩\"</span><div class=\"purser-main\"><div class=\"purser-name\">\"Shop card\"</div><div class=\"purser-meta\"><span class=\"purser-days\">\"10/8  ·  in 17 days\"</span></div></div><div class=\"purser-side\"><div class=\"purser-marks\"><span class=\"purser-dot purser-dot-act\" aria-hidden=\"true\"></span></div></div></div></div><p class=\"tile-foot\">\"ledger current through 2026-09-17\"</p></div></div>",
  "sheet": "<div class=\"\"><div class=\"purser-totals\"><div class=\"purser-total\"><span class=\"purser-total-label\">\"next 45 days\"</span><span class=\"purser-total-value\">\"$3,887.28\"</span></div><div class=\"purser-total\"><span class=\"purser-total-label\">\"next 14 days\"</span><span class=\"purser-total-value\">\"$2,596.88\"</span></div><div class=\"purser-total\"><span class=\"purser-total-label\">\"manual\"</span><span class=\"purser-total-value\">\"$1,703.28\"</span></div><div class=\"purser-total\"><span class=\"purser-total-label\">\"autopay\"</span><span class=\"purser-total-value\">\"$2,184.00\"</span></div><div class=\"purser-total\"><span class=\"purser-total-label\">\"quarterly_escrow\"</span><span class=\"purser-total-value\">\"$42.50\"</span></div></div><div class=\"purser-chips\"><span class=\"purser-chip\">\"💎 148,200 UR available\"</span><span class=\"purser-chip\">\"🔥 31 statements · $0 interest · since 2024-02-01\"</span></div><div class=\"purser-sec\"><h3 class=\"purser-sec-head\">\"No pay day set\"</h3><div class=\"purser-uns-row\"><span class=\"purser-emoji\" aria-hidden=\"true\">\"🛡️\"</span><div class=\"purser-main\"><div class=\"purser-name\">\"Umbrella policy\"</div><div class=\"purser-why\">\"annual premium; no pay day in the config\"</div></div><span class=\"purser-amount\">\"$412.00\"</span></div></div><p class=\"tile-foot\">\"ledger current through 2026-09-17\"</p></div>",
  "title": "Purser — Due"
 },
 "empty": {
  "face": "<div class=\"\"><div class=\"purser-face purser-tappable\" aria-label=\"Open the due stack breakdown\" role=\"button\" tabindex=\"0\" onclick onkeydown><p class=\"tile-foot\">\"ledger current through 2026-09-17\"</p></div></div>",
  "sheet": "<div class=\"\"><p class=\"tile-foot\">\"ledger current through 2026-09-17\"</p></div>",
  "title": "Purser — Due"
 },
 "bare": {
  "face": "<div class=\"\"><div class=\"purser-face purser-tappable\" aria-label=\"Open the due stack breakdown\" role=\"button\" tabindex=\"0\" onclick onkeydown><p class=\"tile-foot\">\"ledger date unknown\"</p></div></div>",
  "sheet": "<div class=\"\"><p class=\"tile-foot\">\"ledger date unknown\"</p></div>",
  "title": "Purser — Due"
 }
};

(async () => {
  const mod = await import('../docs/tiles/purser_due.js');
  const { usd } = await import('../docs/lib/fmt.js');
  const SRC = read('docs', 'tiles', 'purser_due.js');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** Render; returns {root, face, opened, sheet()} — sheet() taps the face and builds the panel body. */
  function draw(data, status = 'ok') {
    const root = new El('div');
    const opened = [];
    mod.render(root, { band: 'DAILY', status, error: null, data }, { id: 'purser_due', actions: { openPanel: (title, build) => opened.push({ title, build }) } });
    const face = root.querySelector('.purser-face');
    return {
      root,
      face,
      opened,
      sheet() {
        face.listeners.click[0]({});
        const body = new El('div');
        opened[opened.length - 1].build(body);
        return body;
      },
    };
  }
  const tagOf = (n) => (n && n.tagName ? n.tagName.toLowerCase() : '');
  const kids = (n) => n.childNodes.filter((c) => c.tagName);
  const firstClass = (n) => (n.className || '').split(' ')[0];

  // -- P7 / PM1: nothing new, nothing changed ---------------------------------
  console.log('\nunchanged when the new keys say nothing (golden from v1.48.0)');
  for (const [name, data] of Object.entries(PAYLOADS)) {
    for (const [label, extra] of [
      ['absent', {}],
      ['both null', { heads_up: null, money_out: null }],
      ['notes [] + no problem', { heads_up: { date: '2026-09-19', label: 'Sat 9/19', notes: [], problem: null } }],
      ['notes [] + empty problem', { heads_up: { notes: [], problem: '' } }],
      ['heads_up {} + money_out {}', { heads_up: {}, money_out: {} }],
      ['unknown keys alongside', { purser_mood: 'cheerful', heads_up: null, money_out: null, budget_pace: { dining: 0.8 } }],
    ]) {
      const got = drawBoth(mod, { ...data, ...extra }, El);
      check(`${name} · ${label}: face markup identical`, got.face === GOLDEN[name].face, got.face.slice(0, 160));
      check(`${name} · ${label}: sheet markup identical`, got.sheet === GOLDEN[name].sheet && got.title === GOLDEN[name].title, got.sheet.slice(0, 160));
    }
  }

  const ABSENT = mock();
  check('the default mock carries neither key (it IS the notes-absent face)', !('heads_up' in ABSENT.data) && !('money_out' in ABSENT.data));
  {
    const r = draw(ABSENT.data);
    check('  no notes block, no problem line, no money-out row', count(r.root, 'purser-notes') === 0 && count(r.root, 'purser-problem') === 0 && count(r.root, 'purser-out') === 0);
    check('  one freshness line only — the ledger', count(r.root, 'tile-foot') === 1 && /ledger current through/.test(text(r.root)));
    check('  no "no notes" line, no count, no badge', !/\bnotes?\b|Purser|heads.?up|badge/i.test(text(r.root)), text(r.root).slice(0, 200));
    const s = r.sheet();
    check('  the sheet has no From the Purser section', count(s, 'purser-from') === 0 && !/From the Purser/.test(text(s)));
  }

  // -- PM1: one quiet note -----------------------------------------------------
  console.log('\none quiet note');
  const QUIET = mock('--purser-quiet');
  const QN = QUIET.data.heads_up.notes[0];
  {
    const r = draw(QUIET.data);
    check('one note row', count(r.face, 'purser-note') === 1);
    check('its headline, verbatim', text(r.face.querySelector('.purser-note-head')) === QN.headline);
    check('a quiet mark — no urgent class', r.face.querySelector('.purser-note-mark').className === 'purser-note-mark');
    check('no +more line under one note', count(r.face, 'purser-note-more') === 0);
    check('the face does not print the body or evidence', !text(r.face).includes(QN.body) && !text(r.face).includes(QN.evidence[0]));
    check('the notes lead the face', firstClass(kids(r.face)[0]) === 'purser-notes', firstClass(kids(r.face)[0]));
    check('the due stack is still all there', count(r.face, 'purser-row') === QUIET.data.items.length);
    const s = r.sheet();
    const from = kids(s)[0];
    check('the sheet opens with From the Purser · {label}', firstClass(from) === 'purser-from' && text(from.querySelector('.purser-sec-head')) === `From the Purser · ${QUIET.data.heads_up.label}`, text(from).slice(0, 80));
    check('  headline', text(s.querySelector('.purser-from-head')) === QN.headline);
    check('  a quiet chip with kind, verbatim', text(s.querySelector('.purser-note-kind')) === QN.kind);
    check('  the body', text(s.querySelector('.purser-from-body')) === QN.body);
    check('  each evidence line, in the faint style', s.querySelectorAll('.purser-from-evidence').map(text).join('|') === QN.evidence.join('|'));
    check('the existing sheet follows: totals right after the notes', firstClass(kids(s)[1]) === 'purser-totals', firstClass(kids(s)[1]));
    check('  and the ledger line still closes it', /ledger current through/.test(text(kids(s)[kids(s).length - 1])));
  }

  // -- PM5: urgent first, tone on the mark only ----------------------------------
  console.log('\none urgent + two quiet');
  const URG = mock('--purser-urgent');
  {
    const r = draw(URG.data);
    const rows = r.face.querySelectorAll('.purser-note');
    check('three rows, in the engine’s order (urgent first)', rows.map((n) => text(n)).join('|') === URG.data.heads_up.notes.map((n) => n.headline).join('|'));
    check('the urgent row’s mark wears the urgent class', rows[0].querySelector('.purser-note-mark').className === 'purser-note-mark purser-note-mark-urgent');
    check('the quiet rows’ marks do not', rows.slice(1).every((n) => n.querySelector('.purser-note-mark').className === 'purser-note-mark'));
    const classesOf = (n) => n.querySelectorAll('div, span, p').map((x) => x.className).concat(n.className).filter((c) => !/purser-note-mark/.test(c)).sort().join(' ');
    check('apart from the mark, an urgent row and a quiet row are the same class set', classesOf(rows[0]) === classesOf(rows[1]), `${classesOf(rows[0])} / ${classesOf(rows[1])}`);
    check('the urgent mark is labelled for a screen reader', rows[0].querySelector('.purser-note-mark').getAttribute('aria-label') === 'urgent');
    check('exactly one urgent mark on the face', count(r.face, 'purser-note-mark-urgent') === 1);
    const s = r.sheet();
    check('the sheet wears the same urgent mark once', count(s, 'purser-note-mark-urgent') === 1 && s.querySelectorAll('.purser-from-note').length === 3);
    check('the page never re-sorts: a payload with urgent last renders it last', (() => {
      const flipped = { ...URG.data, heads_up: { ...URG.data.heads_up, notes: URG.data.heads_up.notes.slice().reverse() } };
      const marks = draw(flipped).face.querySelectorAll('.purser-note-mark').map((m) => m.className);
      return marks[2] === 'purser-note-mark purser-note-mark-urgent' && marks[0] === 'purser-note-mark';
    })());
    check('urgent is strictly true: "yes", 1 and "true" stay quiet', ['yes', 1, 'true'].every((u) => count(draw({ heads_up: { notes: [{ headline: 'x', urgent: u }] } }).face, 'purser-note-mark-urgent') === 0));
  }

  // -- three rows and +N more ----------------------------------------------------
  console.log('\nfive notes');
  const FIVE = mock('--purser-five');
  {
    const r = draw(FIVE.data);
    check('three rows on the face', count(r.face, 'purser-note') === 3);
    const more = r.face.querySelector('.purser-note-more');
    check('then "+2 more"', text(more) === '+2 more', text(more));
    check('  inside the face — the existing tap target', r.face.querySelectorAll('.purser-note-more').length === 1 && r.face.getAttribute('role') === 'button');
    check('  and not a control of its own (no element, no listener, no role)', tagOf(more) === 'div' && Object.keys(more.listeners).length === 0 && !more.getAttribute('role') && !more.getAttribute('tabindex'));
    check('no count of notes beyond that, no badge', !/\b5\b|five|notes/i.test(text(r.face.querySelector('.purser-notes'))));
    const s = r.sheet();
    check('the sheet carries all five', s.querySelectorAll('.purser-from-note').length === 5);
    check('a note with no body draws no body element', s.querySelectorAll('.purser-from-body').length === FIVE.data.heads_up.notes.filter((n) => n.body).length);
    check('a note with no evidence draws no evidence lines', s.querySelectorAll('.purser-from-evidence').length === FIVE.data.heads_up.notes.reduce((a, n) => a + n.evidence.length, 0));
    check('exactly four notes → three rows + "+1 more"', text(draw({ heads_up: { notes: FIVE.data.heads_up.notes.slice(0, 4) } }).face.querySelector('.purser-note-more')) === '+1 more');
    check('exactly three notes → no +more', count(draw({ heads_up: { notes: FIVE.data.heads_up.notes.slice(0, 3) } }).face, 'purser-note-more') === 0);
  }

  // -- PM6: problem ----------------------------------------------------------------
  console.log('\nproblem');
  const PROB = mock('--purser-problem');
  {
    const r = draw(PROB.data);
    const p = r.face.querySelector('.purser-problem');
    check('one problem line with the producer’s text', count(r.face, 'purser-problem') === 1 && text(p) === PROB.data.heads_up.problem);
    check('  no note rows beside it', count(r.face, 'purser-note') === 0 && count(r.face, 'purser-notes') === 0);
    check('  it sits above the due stack', kids(r.face).findIndex((n) => n === p) < kids(r.face).findIndex((n) => firstClass(n) === 'purser'));
    check('  the sheet draws no From section without notes', count(r.sheet(), 'purser-from') === 0);
    check('a problem is drawn even beside notes', count(draw({ heads_up: { notes: [{ headline: 'x' }], problem: 'second file half-read' } }).face, 'purser-problem') === 1);
  }

  // -- PM3 / PM4: money out ----------------------------------------------------------
  console.log('\nmoney out');
  const OUT = mock('--purser-out');
  const MO = OUT.data.money_out;
  {
    const r = draw(OUT.data);
    const row = r.face.querySelector('.purser-out');
    check('one money-out row', count(r.face, 'purser-out') === 1);
    check('  Money out {label}, verbatim', text(row.querySelector('.purser-out-label')) === `Money out ${MO.label}`);
    check('  the amount through the tile’s money formatter', text(row.querySelector('.purser-out-amount')) === usd(MO.out_total), text(row.querySelector('.purser-out-amount')));
    check('  {count} charges ({pending} pending)', text(row.querySelector('.purser-out-count')) === `${MO.count} charges (${MO.pending_count} pending)`);
    check('  fresh → not muted', row.className === 'purser-out');
    const order = kids(r.face).map(firstClass);
    check('  under the stack, above the clocks', order.indexOf('purser') < order.indexOf('purser-out') && order.indexOf('purser-out') < order.indexOf('tile-foot'), order.join(' '));
    const foots = r.face.querySelectorAll('.tile-foot').map(text);
    check('two freshness lines: the ledger, then the bank feed', foots.length === 2 && /^ledger current through /.test(foots[0]) && foots[1] === `bank feed through ${MO.through_label}`, foots.join(' / '));
    const s = r.sheet();
    const sk = kids(s).map(firstClass);
    check('the sheet puts the money-out row beside (right after) the totals', sk.indexOf('purser-out') === sk.indexOf('purser-totals') + 1, sk.join(' '));
    check('  and both clocks close the sheet', s.querySelectorAll('.tile-foot').map(text).join(' / ') === foots.join(' / '));
  }
  {
    const OLD = mock('--purser-out-old');
    const row = draw(OLD.data).face.querySelector('.purser-out');
    check('fresh: false → the whole row muted', row.className === 'purser-out purser-out-old', row.className);
    check('  still printing its own (old) date, verbatim', text(row).includes(OLD.data.money_out.label));
    check('fresh missing → not muted (only false mutes)', draw({ money_out: { ...MO, fresh: undefined } }).face.querySelector('.purser-out').className === 'purser-out');
  }
  {
    const BARE = mock('--purser-out-bare');
    const r = draw(BARE.data);
    check('pending_count 0 → no parenthesis', text(r.face.querySelector('.purser-out-count')) === `${BARE.data.money_out.count} charges` && !/\(/.test(text(r.face.querySelector('.purser-out'))));
    check('through_label null → no feed line', count(r.face, 'tile-foot') === 1 && !/bank feed/.test(text(r.root)));
    check('one charge reads singular', text(draw({ money_out: { ...MO, count: 1, pending_count: 0 } }).face.querySelector('.purser-out-count')) === '1 charge');
    check('count 0 prints as given', text(draw({ money_out: { ...MO, count: 0, pending_count: 0 } }).face.querySelector('.purser-out-count')) === '0 charges');
  }

  // -- the whole desk, top to bottom ------------------------------------------------
  {
    const DESK = mock('--purser-desk');
    const order = kids(draw(DESK.data).face).map(firstClass);
    check('face order: notes · stack · money out · ledger line · feed line', order.join(' ') === 'purser-notes purser purser-out tile-foot tile-foot', order.join(' '));
    const withProblem = kids(draw({ ...DESK.data, heads_up: { ...DESK.data.heads_up, problem: 'x' } }).face).map(firstClass);
    check('  with a problem: notes · problem · stack · …', withProblem.slice(0, 3).join(' ') === 'purser-notes purser-problem purser', withProblem.join(' '));
  }

  // -- PM8: no arithmetic on money, no $NaN, no $0.00 ---------------------------------
  console.log('\nPM8 — the money is the engine’s');
  for (const bad of [null, undefined, 'abc', '187.42', NaN, Infinity, -Infinity, true, {}, [], '']) {
    const r = draw({ money_out: { ...MO, out_total: bad } });
    const t = text(r.face);
    check(`out_total ${JSON.stringify(bad) ?? 'undefined'} → no amount element, no $NaN / $0.00`, count(r.face, 'purser-out-amount') === 0 && !/\$NaN|\$0\.00|NaN|Infinity|\$—|—\s*·/.test(t), t.slice(0, 120));
  }
  check('a real zero is a real number and prints $0.00', text(draw({ money_out: { ...MO, out_total: 0 } }).face.querySelector('.purser-out-amount')) === '$0.00');
  check('a value with more precision is formatted, not re-added', text(draw({ money_out: { ...MO, out_total: 1234.5 } }).face.querySelector('.purser-out-amount')) === '$1,234.50');
  check('labels print verbatim, however odd', text(draw({ money_out: { ...MO, label: 'Someday 13/45', through_label: 'never o’clock' } }).root).includes('Money out Someday 13/45') && text(draw({ money_out: { ...MO, through_label: 'never o’clock' } }).root).includes('bank feed through never o’clock'));
  check('the money-out code reads out_total only through money()', (CODE.match(/out_total/g) || []).length === 1 && /money\(mo\.out_total\)/.test(CODE));
  check('no reduce, no sum, no Math on this tile', !/reduce\(|Math\.|\bsum\b/.test(CODE));
  check('no new Date(', !/new Date\(/.test(CODE));
  check('no Date.parse', !/Date\.parse/.test(CODE));
  check('no Date at all', !/\bDate\b/.test(CODE));

  // -- PM7 / rule 10: textContent only --------------------------------------------------
  console.log('\nPM7 — text is untrusted');
  {
    const evil = '<img src=x onerror=alert(1)><b>bold</b>';
    const r = draw({ heads_up: { label: evil, notes: [{ headline: evil, kind: evil, urgent: true, body: evil, evidence: [evil] }], problem: evil }, money_out: { ...MO, label: evil, through_label: evil } });
    const s = r.sheet();
    check('markup in every string lands as text on the face', text(r.face).split(evil).length - 1 === 4, String(text(r.face).split(evil).length - 1));
    check('  and in the sheet', text(s).includes(`From the Purser · ${evil}`) && s.querySelectorAll('.purser-from-evidence').map(text)[0] === evil && text(s.querySelector('.purser-note-kind')) === evil);
    check('  no element was made from it', r.root.querySelectorAll('img, b').length === 0 && s.querySelectorAll('img, b').length === 0);
    check('no innerHTML / outerHTML / insertAdjacentHTML in the module', !/innerHTML|outerHTML|insertAdjacentHTML/.test(CODE));
  }

  // -- rule 9: hostile shapes ------------------------------------------------------------
  console.log('\nrule 9 — hostile shapes');
  const LONG = 'b'.repeat(5000);
  const HOSTILE = [
    { heads_up: 'notes!' }, { heads_up: 7 }, { heads_up: [] }, { heads_up: { notes: 'x' } }, { heads_up: { notes: {} } },
    { heads_up: { notes: [null, 5, 'x', [], { headline: 5 }, { headline: { a: 1 } }, { headline: null, kind: 9, evidence: 'no' }, { headline: 'ok', body: LONG, evidence: [null, 3, {}, 'fine'] }] } },
    { heads_up: { notes: [{ headline: 'p' }], problem: { why: 1 } } }, { heads_up: { label: { x: 1 }, notes: [{ headline: 'l' }] } },
    { money_out: 'x' }, { money_out: [] }, { money_out: 0 }, { money_out: { count: '9', pending_count: '2' } }, { money_out: { label: 5 } },
    { money_out: { label: { a: 1 }, out_total: 5, count: NaN, pending_count: -1, through_label: [] } }, { money_out: { fresh: 'no', label: 'L' } },
    { items: 'nope', heads_up: { notes: [{ headline: 'h' }] }, money_out: MO },
  ];
  for (const data of HOSTILE) {
    let threw = null;
    let face = '';
    let sheet = '';
    try {
      const r = draw(data);
      face = text(r.root);
      sheet = text(r.sheet());
    } catch (e) { threw = e; }
    const shown = JSON.stringify(data).slice(0, 70);
    check(`${shown} — never throws`, !threw, threw && threw.message);
    check(`${shown} — no undefined / NaN / [object Object] / null`, !/undefined|NaN|\[object Object\]|\bnull\b/.test(face + sheet), (face + ' || ' + sheet).slice(0, 200));
  }
  {
    const r = draw({ heads_up: { notes: [{ headline: 'ok', body: LONG }] } });
    check('a 5,000-character body renders whole in the sheet', text(r.sheet().querySelector('.purser-from-body')).length === 5000);
    check('  and never onto the face', !text(r.face).includes('bbbbbbbbbb'));
    const num = draw({ heads_up: { notes: [{ headline: 42 }] } });
    check('a number headline prints as a number', text(num.face.querySelector('.purser-note-head')) === '42');
    const obj = draw({ heads_up: { notes: [{ headline: { a: 1 } }] } });
    check('an object headline prints a dash, not [object Object]', text(obj.face.querySelector('.purser-note-head')) === '—');
    check('non-object notes vanish; object ones stay', count(draw({ heads_up: { notes: [null, 'x', 5, { headline: 'kept' }] } }).face, 'purser-note') === 1);
    check('a money_out with nothing printable draws nothing', count(draw({ money_out: { fresh: true, through_label: 'Fri 9:00 AM' } }).face, 'purser-out') === 0);
    check('  but its clock still prints when it has one', /bank feed through Fri 9:00 AM/.test(text(draw({ money_out: { fresh: true, through_label: 'Fri 9:00 AM' } }).face)));
  }

  // -- rules 5 + 6: nothing here acts ------------------------------------------------------
  console.log('\nno controls, no events');
  {
    const DESK = mock('--purser-desk');
    const r = draw({ ...DESK.data, heads_up: { ...DESK.data.heads_up, notes: FIVE.data.heads_up.notes } });
    const s = r.sheet();
    check('no button or input anywhere on face or sheet', r.root.querySelectorAll('button, input, textarea, select, a').length === 0 && s.querySelectorAll('button, input, textarea, select, a').length === 0);
    const withListeners = [r.root, ...r.root.querySelectorAll('div, span, p'), ...s.querySelectorAll('div, span, p, h3')].filter((n) => Object.keys(n.listeners).length);
    check('the only listeners are the face’s own click + keydown (the sheet)', withListeners.length === 1 && withListeners[0] === r.face && Object.keys(r.face.listeners).sort().join(' ') === 'click keydown');
    check('the face is still a role=button div, so long-press Explain still reaches it', tagOf(r.face) === 'div' && r.face.getAttribute('role') === 'button');
  }
  check('no fetch(', !/\bfetch\(/.test(CODE));
  check('no event post', !/postEvent|submitEvent|fileEvent|api\/event|sendBeacon|XMLHttpRequest/.test(CODE));
  check('builds no button or input', !/el\(\s*'(button|input|textarea|select|a)'|createElement/.test(CODE));
  check('registers no listener of its own beyond the two', (CODE.match(/addEventListener/g) || []).length === 2 && !/\bon:\s*\{/.test(CODE));

  // -- the notes region: kind is printed, never branched on ---------------------------------
  {
    const a = CODE.indexOf('const FACE_NOTES');
    const b = CODE.indexOf('function money(');
    const region = a !== -1 && b > a ? CODE.slice(a, b) : '';
    check('the notes region is found', region.length > 400);
    check('kind is never compared or switched on', !/kind\s*[!=]==?|[!=]==?\s*kind|switch\s*\(/.test(region));
    check('every note string goes through words()', !/note\.(headline|body|kind)(?!\))/.test(region.replace(/words\(note\.(headline|body|kind)\)/g, '')));
    check('heads_up is read nowhere outside the region', !/heads_up/.test(CODE.slice(0, a) + CODE.slice(b)));
  }

  // -- ship -------------------------------------------------------------------------------
  console.log('\nship');
  const CFG = read('docs', 'config.js');
  const SW = read('docs', 'sw.js');
  const ver = (CFG.match(/APP_VERSION = '(\d+)\.(\d+)\.(\d+)'/) || []).slice(1).map(Number);
  check('APP_VERSION at least 1.49.0', ver.length === 3 && (ver[0] > 1 || (ver[0] === 1 && ver[1] >= 49)), ver.join('.'));
  const cache = Number((SW.match(/CACHE_VERSION = 'helm-v(\d+)'/) || [])[1]);
  check('CACHE_VERSION at least helm-v76', cache >= 76, String(cache));
  check('the tile stays at position 120', /purser_due:\s*\{\s*band:\s*'DAILY',\s*position:\s*120,/.test(read('docs', 'tiles', '_registry.js')));
  const PKG = JSON.parse(read('package.json'));
  check('this test runs under npm test', PKG.scripts.test.includes('node tools/test-purser-notes.js'));
  for (const f of ['quiet', 'urgent', 'five', 'problem', 'out', 'out-old', 'out-bare', 'desk']) {
    let ok = false;
    try { ok = !!JSON.parse(read('docs', 'mock', `purser-${f}.json`)).tiles.purser_due; } catch (e) { ok = false; }
    check(`docs/mock/purser-${f}.json exists (?mock=purser-${f}) and is generated by npm run mock`, ok && PKG.scripts.mock.includes(`--purser-${f} > docs/mock/purser-${f}.json`));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
