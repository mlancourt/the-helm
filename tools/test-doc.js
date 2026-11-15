#!/usr/bin/env node
/**
 * The Helm — doc ("🩺 Doc"). Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-doc.js
 *
 * Vault spec `Doc-Tile-Spec.md`, DT1–DT15. The rulings with teeth:
 *
 *   DT14  the page prints value_text / delta_text / avg_text / every label as
 *         sent; result and avg_result reach a class through ONE lookup and an
 *         unknown value is no tone. No arithmetic, no dates (rule 7).
 *   DT10  value_text null → `no reading`, nothing in the row toned; result
 *         null beside a value → the value and no delta.
 *   tones --good/--warn/--bad on the delta text and the 7-day dot only,
 *         scoped under [data-tile="doc"]; the value never wears one.
 *   DT11/DT15  the paragraph and `problem` are textContent; note null draws
 *         nothing.
 *   DT13  no buttons, inputs or events; the face is one tap target.
 *   DT7   none of the four forbidden words, in the module or its styles.
 *   fresh false adds one faint line and changes nothing else.
 *   rule 9 — hostile shapes render or vanish, never throw.
 *
 * Fixtures come straight from tools/make-mock-data.js (invented readings),
 * run here per flag so they always carry Central today.
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
const mock = (flag) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'make-mock-data.js'), ...(flag ? [flag] : [])], { encoding: 'utf8' })).tiles.doc;
const clone = (o) => JSON.parse(JSON.stringify(o));
const text = (n) => (n ? n.textContent : '');
const has = (n, c) => !!n && n.classList.contains(c);
const TONED = /(^|\s)[\w-]*-(good|warn|bad)(\s|$)/;

/** Every element under a node, the node included. */
function all(n, out = []) {
  if (!n || !n.tagName) return out;
  out.push(n);
  for (const k of n.childNodes || []) all(k, out);
  return out;
}

(async () => {
  const mod = await import('../docs/tiles/doc.js');
  const SRC = read('docs', 'tiles', 'doc.js');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const CSS = read('docs', 'style.css');

  /** Render a tile; returns {root, opened, sheet()} — sheet() taps the face and builds the panel body. */
  function render(tile) {
    const root = new El('div');
    const opened = [];
    const actions = { openPanel: (title, build) => opened.push({ title, build }) };
    mod.render(root, tile, { id: 'doc', actions });
    return {
      root,
      opened,
      sheet() {
        const face = root.querySelector('.doc-face');
        face.listeners.click[0]({});
        const body = new El('div');
        opened[opened.length - 1].build(body);
        return body;
      },
    };
  }
  const lineOf = (root, id) => root.querySelector('.doc-line-' + id);
  const tileOf = (data, status = 'ok') => ({ band: 'DAILY', status, error: null, data });

  // -- the registry ------------------------------------------------------------
  console.log('\nregistry + ship');
  const REG = read('docs', 'tiles', '_registry.js');
  check(
    'doc: DAILY, position 27, 🩺 Doc, no feed',
    /doc:\s*\{\s*band:\s*'DAILY',\s*position:\s*27,\s*module:\s*'\.\/tiles\/doc\.js',\s*title:\s*'🩺 Doc'\s*\}/.test(REG)
  );
  const { REGISTRY } = await import('../docs/tiles/_registry.js');
  check("after Captain's Log (25), before dinner (30), and neither moved",
    REGISTRY.captains_log.position === 25 && REGISTRY.dinner.position === 30 && REGISTRY.doc.position === 27);
  check('no other tile sits at 27', Object.entries(REGISTRY).filter(([, e]) => e.position === 27).length === 1);
  check('the SW precaches the module', /'\.\/tiles\/doc\.js'/.test(read('docs', 'sw.js')));
  {
    const cv = Number((read('docs', 'sw.js').match(/CACHE_VERSION = 'helm-v(\d+)'/) || [])[1]);
    const av = (read('docs', 'config.js').match(/APP_VERSION = '(\d+)\.(\d+)\.\d+'/) || []).slice(1).map(Number);
    check('CACHE_VERSION is at least helm-v80', cv >= 80, String(cv));
    check('APP_VERSION is at least 1.50.0', av[0] > 1 || (av[0] === 1 && av[1] >= 50), av.join('.'));
  }
  check('npm test runs this file', /node tools\/test-doc\.js/.test(read('package.json')));
  check('the default mock snapshot carries doc', mock().status === 'ok' && !!mock().data);

  // -- the full card -----------------------------------------------------------
  console.log('\nthe face — the full card');
  const full = mock();
  const F = full.data;
  const { root, opened, sheet } = render(full);
  const face = root.querySelector('.doc-face');
  check('one face, a role=button div (not a <button> — long-press still reaches the shell)',
    face && face.tagName === 'DIV' && face.getAttribute('role') === 'button' && face.getAttribute('tabindex') === '0');
  check('DT13: no button / input / textarea / select on the face', ['button', 'input', 'textarea', 'select'].every((t) => root.querySelectorAll(t).length === 0));
  check('header: day.label', text(root.querySelector('.doc-day')) === F.day.label, text(root.querySelector('.doc-day')));
  check('header: the record as {w}-{l}-{p}', text(root.querySelector('.doc-record')) === `${F.record.w}-${F.record.l}-${F.record.p}` && text(root.querySelector('.doc-record')) === '2-2-1');
  check('fresh: no "watch data through" line', !root.querySelector('.doc-through') && !/watch data through/.test(text(root)));
  const lines = root.querySelectorAll('.doc-line');
  check('one row per rows[] entry, in payload order', lines.map((n) => n.className.match(/doc-line-(\w+)/)[1]).join(' ') === F.rows.map((r) => r.id).join(' '), lines.map((n) => n.className).join(' | '));
  check('labels verbatim', lines.map((n) => text(n.querySelector('.doc-label'))).join('|') === F.rows.map((r) => r.label).join('|'));
  check('values verbatim, in the big-value cell', lines.map((n) => text(n.querySelector('.doc-value'))).join('|') === F.rows.map((r) => r.value_text).join('|'));
  check('deltas verbatim', lines.map((n) => text(n.querySelector('.doc-delta'))).join('|') === F.rows.map((r) => r.delta_text).join('|'));
  const deltaTone = (id) => (lineOf(root, id).querySelector('.doc-delta').className.match(/doc-delta-(\w+)/) || [])[1] || 'none';
  check('win → the good tone on the delta (steps, HRV)', deltaTone('steps') === 'good' && deltaTone('hrv') === 'good');
  check('loss → the bad tone on the delta (energy, sleep)', deltaTone('energy') === 'bad' && deltaTone('sleep') === 'bad');
  check('push → the warn tone on the delta (resting HR)', deltaTone('rhr') === 'warn');
  const dotTone = (r, id) => (lineOf(r, id).querySelector('.doc-dot').className.match(/doc-dot-(\w+)/) || [])[1];
  check('7-day dots off avg_result: win good · push warn · loss bad', dotTone(root, 'steps') === 'good' && dotTone(root, 'energy') === 'warn' && dotTone(root, 'sleep') === 'warn' && dotTone(root, 'hrv') === 'bad');
  check('avg_result null → a hollow dot (resting HR)', dotTone(root, 'rhr') === 'none');
  check("each dot's tooltip is avg_text", F.rows.every((r) => (lineOf(root, r.id).querySelector('.doc-dot').getAttribute('title') || null) === r.avg_text));
  check('the value never wears a tone (its class is exactly doc-value)', lines.every((n) => n.querySelector('.doc-value').className === 'doc-value'));
  check('tones land on the delta and the dot and NOTHING else',
    all(root).filter((n) => TONED.test(n.className || '')).every((n) => has(n, 'doc-delta') || has(n, 'doc-dot')),
    all(root).filter((n) => TONED.test(n.className || '') && !has(n, 'doc-delta') && !has(n, 'doc-dot')).map((n) => n.className).join(' | '));
  check('🏆 on the best row only', root.querySelectorAll('.doc-best').length === 1 && !!lineOf(root, 'steps').querySelector('.doc-best') && text(lineOf(root, 'steps').querySelector('.doc-best')) === '🏆');
  check('the sleep row shows its when_label, faint', text(lineOf(root, 'sleep').querySelector('.doc-when')) === F.rows[2].when_label && / night$/.test(F.rows[2].when_label));
  check('the other rows show no when_label (theirs is the day)', root.querySelectorAll('.doc-when').length === 1);
  check("Doc's paragraph, verbatim, as body text", text(root.querySelector('.doc-note')) === F.note.text && root.querySelector('.doc-note').tagName === 'P');
  check('no problem line when problem is null', !root.querySelector('.doc-problem'));
  check('the face prints no average (that is the sheet)', !root.querySelector('.doc-avg') && !/7-day avg/.test(text(root)));

  // -- the sheet ---------------------------------------------------------------
  console.log('\nthe sheet');
  const body = sheet();
  check('the tap opens the panel titled 🩺 Doc', opened.length === 1 && opened[0].title === '🩺 Doc');
  const secs = body.querySelectorAll('.doc-sec');
  check('sections in order: week → rows → paragraph, nothing else', secs.map((n) => n.className.match(/doc-sec-(\w+)/)[1]).join(' ') === 'week rows note', secs.map((n) => n.className).join(' | '));
  check('"Last 7 days · {w}-{l}-{p}" off the week totals', text(body.querySelector('.doc-sec-head')) === `Last 7 days · ${F.week.w}-${F.week.l}-${F.week.p}`, text(body.querySelector('.doc-sec-head')));
  const wd = body.querySelectorAll('.doc-week-day');
  check('one line per week.days[] entry, in payload order', wd.map((n) => text(n.querySelector('.doc-week-label'))).join('|') === F.week.days.map((d) => d.label).join('|'));
  check("each line carries its own record as sent", wd.map((n) => text(n.querySelector('.doc-week-record'))).join('|') === F.week.days.map((d) => `${d.w}-${d.l}-${d.p}`).join('|'));
  {
    const x = clone(full);
    x.data.week.w = 99; x.data.week.days[0].p = 7;
    const b = render(x).sheet();
    check('totals and day records are PRINTED as sent, never re-added', /· 99-/.test(text(b.querySelector('.doc-sec-head'))) && text(b.querySelector('.doc-week-record')) === `${F.week.days[0].w}-${F.week.days[0].l}-7`);
  }
  const srows = body.querySelectorAll('.doc-line');
  check('every row again, in payload order', srows.map((n) => n.className.match(/doc-line-(\w+)/)[1]).join(' ') === F.rows.map((r) => r.id).join(' '));
  check('with avg_text written out where the engine sent one', srows.map((n) => text(n.querySelector('.doc-avg')) || null).join('|') === F.rows.map((r) => r.avg_text).join('|'));
  check('the sheet rows wear the same delta tones', (srows[0].querySelector('.doc-delta').className.match(/doc-delta-(\w+)/) || [])[1] === 'good' && (srows[3].querySelector('.doc-delta').className.match(/doc-delta-(\w+)/) || [])[1] === 'warn');
  check('and the paragraph last', text(body.querySelector('.doc-sec-note')) === F.note.text);
  check('the sheet has no buttons or inputs', ['button', 'input', 'textarea', 'select'].every((t) => body.querySelectorAll(t).length === 0));
  check('tones in the sheet land on the delta and the dot only', all(body).filter((n) => TONED.test(n.className || '')).every((n) => has(n, 'doc-delta') || has(n, 'doc-dot')));

  // -- no reading / no prior -----------------------------------------------------
  console.log('\nno reading · no prior (DT10)');
  {
    const g = mock('--doc-gaps');
    const r = render(g);
    const hrv = lineOf(r.root, 'hrv');
    check('value_text null → "no reading", faint', text(hrv.querySelector('.doc-value')) === 'no reading' && has(hrv.querySelector('.doc-value'), 'doc-noread'));
    check('  …no delta at all', !hrv.querySelector('.doc-delta'));
    check('  …a hollow, untoned dot with no tooltip', dotTone(r.root, 'hrv') === 'none' && !hrv.querySelector('.doc-dot').getAttribute('title'));
    check('  …nothing in the row is toned', all(hrv).every((n) => !TONED.test(n.className || '')));
    check('  …no 🏆', !hrv.querySelector('.doc-best'));
    const rhr = lineOf(r.root, 'rhr');
    check('value with no prior: the value prints', text(rhr.querySelector('.doc-value')) === '57' && rhr.querySelector('.doc-value').className === 'doc-value');
    check('  …and no delta', !rhr.querySelector('.doc-delta'));
    check('  …its 7-day dot still reads (win → good)', dotTone(r.root, 'rhr') === 'good');
    check('the gaps record prints as sent', text(r.root.querySelector('.doc-record')) === `${g.data.record.w}-${g.data.record.l}-${g.data.record.p}`);
    const hostile = clone(g);
    Object.assign(hostile.data.rows[4], { result: 'win', delta_text: '+9', avg_result: 'win', avg_text: '7-day avg 1', best: true });
    const hh = lineOf(render(hostile).root, 'hrv');
    check('a null value with a result, delta, average and best beside it still wears NOTHING',
      text(hh.querySelector('.doc-value')) === 'no reading' && !hh.querySelector('.doc-delta') && !hh.querySelector('.doc-best') && all(hh).every((n) => !TONED.test(n.className || '')));
    const nr = clone(full); nr.data.rows[0].result = null;
    check('result null with a delta_text present → no delta printed', !lineOf(render(nr).root, 'steps').querySelector('.doc-delta'));
  }

  // -- the tone lookup -------------------------------------------------------------
  console.log('\nthe tone lookup (DT14)');
  for (const bad of ['draw', 'WIN', '', 'good', '__proto__', 'constructor', 'toString', 1, true, {}, []]) {
    const x = clone(full); x.data.rows[0].result = bad; x.data.rows[0].avg_result = bad;
    let r, threw = null;
    try { r = render(x); } catch (e) { threw = e; }
    const l = r && lineOf(r.root, 'steps');
    check(`result ${JSON.stringify(bad)} → no tone, no throw`, !threw && l && !TONED.test(l.querySelector('.doc-dot').className) && (!l.querySelector('.doc-delta') || !TONED.test(l.querySelector('.doc-delta').className)), threw && threw.message);
  }

  // -- fresh false -----------------------------------------------------------------
  console.log('\nfresh false');
  {
    const st = mock('--doc-stale');
    const r = render(st);
    const tl = r.root.querySelector('.doc-through');
    check('one faint line: "watch data through {through_label}"', !!tl && text(tl) === `watch data through ${st.data.through_label}`);
    check('  …it sits right under the header', r.root.querySelector('.doc-face').childNodes[1] === tl);
    check('  …the card does not grey (no greys(), status ok)', typeof mod.greys !== 'function' && st.status === 'ok');
    const same = clone(st); same.data.day.fresh = true;
    const r2 = render(same);
    check('  …and nothing else changes: the rows render byte-identical to fresh', text(r.root.querySelector('.doc-lines')) === text(r2.root.querySelector('.doc-lines')) &&
      all(r.root.querySelector('.doc-lines')).map((n) => n.className).join() === all(r2.root.querySelector('.doc-lines')).map((n) => n.className).join());
    check('  …no warn tone, no pill, no stale word anywhere but that line', !r.root.querySelector('.pill') && !/stale/.test(text(r.root)) && all(r.root).filter((n) => TONED.test(n.className || '')).length === all(r2.root).filter((n) => TONED.test(n.className || '')).length);
    check('fresh missing (not false) adds no line', (() => { const x = clone(st); delete x.data.day.fresh; return !render(x).root.querySelector('.doc-through'); })());
  }

  // -- the note ------------------------------------------------------------------
  console.log('\nthe note (DT11)');
  {
    const q = render(mock('--doc-quiet'));
    check('note null → nothing drawn (no paragraph, no problem, no "no note" line)', !q.root.querySelector('.doc-note') && !q.root.querySelector('.doc-problem') && !/note/i.test(text(q.root)));
    check('note null → the sheet has no paragraph section', !q.sheet().querySelector('.doc-sec-note'));
    const p = mock('--doc-problem');
    const pr = render(p);
    check('problem set → one faint problem line with its text', pr.root.querySelectorAll('.doc-problem').length === 1 && text(pr.root.querySelector('.doc-problem')) === p.data.note.problem);
    check('  …and no paragraph for an empty text', !pr.root.querySelector('.doc-note'));
    check('the problem line is faint, not a tone', /\.doc-problem\s*\{[^}]*color:\s*var\(--text-faint\)/.test(CSS));
    const evil = clone(full); evil.data.note.text = '<img src=x onerror=alert(1)> **bold** [[link]]';
    check('rule 10: markup in the paragraph prints as text', text(render(evil).root.querySelector('.doc-note')) === evil.data.note.text);
    const long = clone(full); long.data.note.text = 'x'.repeat(5000);
    check('a 5,000-character note renders whole (the engine caps, the page does not cut)', text(render(long).root.querySelector('.doc-note')).length === 5000);
  }

  // -- empty / error ---------------------------------------------------------------
  console.log('\nempty · error');
  {
    const e = mock('--doc-empty');
    const r = render(e);
    check('status empty → exactly one faint line, "No watch data yet."', r.root.childNodes.length === 1 && text(r.root) === 'No watch data yet.' && has(r.root.childNodes[0], 'doc-quiet'));
    check('  …no face, no tap target', !r.root.querySelector('.doc-face') && r.opened.length === 0);
    check('the quiet line is faint', /\.doc-quiet\s*\{[^}]*color:\s*var\(--text-faint\)/.test(CSS));
    const er = render({ band: 'DAILY', status: 'error', error: 'watch2026-01.csv could not be parsed (csv.Error)', data: {} });
    check('error → the module draws nothing (the shell owns pill, line and grey)', er.root.childNodes.length === 0);
  }

  // -- hostile shapes ------------------------------------------------------------------
  console.log('\nhostile shapes (rule 9)');
  {
    const shapes = [
      null, undefined, 'x', 42, [], {},
      { day: 'Sat', record: 'two', rows: 'none', week: [], note: 7, through_label: 9 },
      { day: { label: 7, fresh: 'no' }, record: { w: '2', l: -1, p: 1.5 }, rows: [null, 3, 'x', [], {}, { id: {}, label: 7, value_text: 6480, delta_text: 512, result: 'win', best: 'yes' }], week: { w: 'x', days: [null, 'x', { label: 3 }, { label: 'Mon 1/1', w: 'a' }] }, note: { text: 12, problem: {} } },
      { ...clone(F), mystery: { any: true }, rows: F.rows.map((r) => ({ ...r, extra: '<b>x</b>' })), week: { ...F.week, days: F.week.days.map((d) => ({ ...d, extra: 1 })) } },
    ];
    let threw = null;
    for (const data of shapes) {
      try { const r = render(tileOf(data)); if (r.root.querySelector('.doc-face')) r.sheet(); } catch (e) { threw = e; break; }
    }
    check('no shape throws (face and sheet)', !threw, threw && threw.stack);
    for (const status of ['ok', 'stale', 'missing', undefined]) {
      let t2 = null;
      try { render({ status, data: null }); render({ status, data: shapes[7] }); } catch (e) { t2 = e; }
      check(`status ${status} with hostile data never throws`, !t2, t2 && t2.message);
    }
    const r = render(tileOf(shapes[7]));
    check('a number where a label is expected vanishes (no number formatting)', !/6480|512|6,480/.test(text(r.root)));
    check('  …and that row reads "no reading", untoned', /no reading/.test(text(r.root)) && all(r.root).every((n) => !TONED.test(n.className || '')));
    check('a malformed record prints no record', !r.root.querySelector('.doc-record'));
    check('a non-string through_label adds nothing', !/watch data through/.test(text(render(tileOf({ ...clone(F), day: { ...F.day, fresh: false }, through_label: 5 })).root)));
    check('data null with status ok → the quiet line', text(render(tileOf(null)).root) === 'No watch data yet.');
    const u = render(tileOf(shapes[8]));
    check('unknown keys are ignored', !/<b>x<\/b>|mystery/.test(text(u.root) + text(u.sheet())));
    check('NaN / undefined / null / [object never printed', !/NaN|undefined|null|\[object/.test(shapes.map((d) => { const x = render(tileOf(d)); return text(x.root) + (x.root.querySelector('.doc-face') ? text(x.sheet()) : ''); }).join('')));
  }

  // -- source scans --------------------------------------------------------------------
  console.log('\nsource scans');
  check('rule 7: no new Date(', !/new Date\(/.test(SRC));
  check('rule 7: no Date.parse / Date.now / Intl', !/Date\.parse|Date\.now|Intl\./.test(SRC));
  check('rule 10: no innerHTML / insertAdjacentHTML', !/innerHTML|insertAdjacentHTML/.test(SRC));
  check('no fetch(', !/fetch\(/.test(SRC));
  check('DT14: no number formatting (toFixed, toLocaleString, Math., parseInt, parseFloat, Number()', !/toFixed|toLocaleString|Math\.|parseInt|parseFloat|Number\(/.test(CODE));
  check('DT14: no arithmetic operators in the code (- * / % += -= ++ --, and no .reduce)', !/\s[-*/%]\s|[+-]=|\+\+|--(?!\w)|\.reduce\(/.test(CODE.replace(/'[^']*'|`[^`]*`/g, "''")));
  check('DT14: no comparison of two readings (no < or > beyond the count guard)', (CODE.match(/[<>]=?(?!=)/g) || []).filter((m) => m !== '>').length === 1 && /v >= 0/.test(CODE));
  check('DT14: the tone words live in the one TONE lookup', (CODE.match(/'(good|warn|bad)'/g) || []).length === 3 && /const TONE = \{ win: 'good', push: 'warn', loss: 'bad' \};/.test(CODE));
  check('DT14: TONE is read in exactly one function', (CODE.match(/\bTONE\b/g) || []).length === 3);
  check('rules 5/6 / DT13: no event post, no actions but openPanel', !/submitEvent|\/api\/event|actions\.(?!openPanel)\w+/.test(CODE));
  check('DT13: no button / input / textarea / select built', !/el\('(button|input|textarea|select)'/.test(CODE));
  check('the module reads no ctx.live / ctx.weather (no feed)', !/ctx\??\.(live|weather)/.test(CODE));
  {
    const start = CSS.indexOf('/* ------------------------------------------------------------ doc (');
    const end = CSS.indexOf('/* ------------------------------------------------------------ /doc */', start);
    const block = CSS.slice(start, end);
    check('DT7: none of streak / goal / target / missed in the module or its styles', !/streak|goal|target|missed/i.test(SRC + block), (SRC + block).match(/streak|goal|target|missed/i)?.[0]);
  }

  // -- stylesheet ---------------------------------------------------------------------
  console.log('\nstylesheet');
  {
    const start = CSS.indexOf('/* ------------------------------------------------------------ doc (');
    const end = CSS.indexOf('/* ------------------------------------------------------------ /doc */', start);
    check('the block is found, after Vendor Bills and not at the end of the file', start > CSS.indexOf('/wss_ap */') && end > start && end < CSS.indexOf('B14 — the live pulse'));
    const block = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const toned = rules.filter((r) => /var\(--(good|warn|bad|info)\)/.test(r.body));
    const SCOPED = /^\.(card|panel)\[data-tile="doc"\] \.doc-(delta|dot)-(good|warn|bad)$/;
    check('tone tokens only on the delta and the dot, scoped to this tile\'s card and panel',
      toned.length === 6 && toned.every((r) => r.sel.split(',').every((s) => SCOPED.test(s.trim()))), toned.map((r) => r.sel).join(' | '));
    check('every toned rule names both the card and the panel', toned.every((r) => /\.card\[data-tile="doc"\]/.test(r.sel) && /\.panel\[data-tile="doc"\]/.test(r.sel)));
    check('good → --good, warn → --warn, bad → --bad, nothing crossed', toned.every((r) => {
      const t = r.sel.match(/-(good|warn|bad)\s*$/)[1];
      return (r.body.match(/var\(--(good|warn|bad)\)/g) || []).every((v) => v === `var(--${t})`);
    }));
    check('the value rule wears no tone', rules.filter((r) => /\.doc-value\b/.test(r.sel)).every((r) => !/--(good|warn|bad)/.test(r.body)) && /\.doc-value\s*\{[^}]*color:\s*var\(--text\)/.test(block));
    check('no --info anywhere in the block', !/--info/.test(block));
    check('no colour literals in the block', !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(block));
    check('no rule outside the block styles a doc- class', ![...(CSS.slice(0, start) + CSS.slice(end + 10)).matchAll(/([^{}]+)\{/g)].some((m) => /\.doc-/.test(m[1])));
    check("the row is Site Pulse's grid: dot · label · value · two right cells", /\.doc-line\s*\{[^}]*grid-template-columns:\s*8px minmax\(0, 1fr\) auto/.test(block));
    check("the value is Site Pulse's big-value style (22px / 650 / tabular)", /\.doc-value\s*\{[^}]*font-size:\s*22px;[^}]*font-weight:\s*650;[^}]*tabular-nums/.test(block));
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
