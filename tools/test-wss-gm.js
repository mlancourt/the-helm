#!/usr/bin/env node
/**
 * The Helm — wss_gm ("📈 WSS"). Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-wss-gm.js
 *
 * Vault spec `WSS-GM-Tile-Spec.md`, K1–K14. The rulings with teeth:
 *
 *   K11  the page prints value_text / basis_text / vs_text / every more[] line
 *        as sent; result reaches a class through ONE lookup and an unknown or
 *        null value is no tone. No arithmetic, no number formatting, no dates.
 *        No buttons, inputs or events; the face is one tap target.
 *   tones --good/--warn/--bad on vs_text only, scoped under
 *        [data-tile="wss_gm"] (card and panel); the value never wears one.
 *   K14  the note, unmapped_text and every label are textContent; note null
 *        draws nothing.
 *   K13  stale shows the shell's pill and reason and still prints the numbers.
 *   rule 9 — hostile shapes render or vanish, never throw.
 *
 * Fixtures come straight from tools/make-mock-data.js (invented figures), run
 * here per flag so they always carry Central today.
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
const mock = (flag) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'make-mock-data.js'), ...(flag ? [flag] : [])], { encoding: 'utf8' })).tiles.wss_gm;
const clone = (o) => JSON.parse(JSON.stringify(o));
const text = (n) => (n ? n.textContent : '');
const has = (n, c) => !!n && n.classList.contains(c);
const TONED = /(^|\s)[\w-]*-(good|warn|bad)(\s|$)/;

function all(n, out = []) {
  if (!n || !n.tagName) return out;
  out.push(n);
  for (const k of n.childNodes || []) all(k, out);
  return out;
}

(async () => {
  const mod = await import('../docs/tiles/wss_gm.js');
  const SRC = read('docs', 'tiles', 'wss_gm.js');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const CSS = read('docs', 'style.css');

  function render(tile) {
    const root = new El('div');
    const opened = [];
    const actions = { openPanel: (title, build) => opened.push({ title, build }) };
    mod.render(root, tile, { id: 'wss_gm', actions });
    return {
      root,
      opened,
      sheet() {
        const face = root.querySelector('.gm-face');
        face.listeners.click[0]({});
        const body = new El('div');
        opened[opened.length - 1].build(body);
        return body;
      },
    };
  }
  const lineOf = (root, id) => root.querySelector('.gm-line-' + id);
  const tileOf = (data, status = 'ok') => ({ band: 'DAILY', status, error: null, data });
  const vsTone = (root, id) => ((lineOf(root, id).querySelector('.gm-vs') || { className: '' }).className.match(/gm-vs-(good|warn|bad)/) || [])[1] || 'none';

  // -- the registry ------------------------------------------------------------
  console.log('\nregistry + ship');
  const REG = read('docs', 'tiles', '_registry.js');
  check(
    "wss_gm: DAILY, position 136, '📈 WSS', no feed",
    /wss_gm:\s*\{\s*band:\s*'DAILY',\s*position:\s*136,\s*module:\s*'\.\/tiles\/wss_gm\.js',\s*title:\s*'📈 WSS'\s*\}/.test(REG)
  );
  const { REGISTRY } = await import('../docs/tiles/_registry.js');
  const order = Object.entries(REGISTRY).sort((a, b) => a[1].position - b[1].position).map(([id]) => id);
  check('directly after wss_ap, and nothing moved (134 · 136 · 140)',
    order[order.indexOf('wss_ap') + 1] === 'wss_gm' && REGISTRY.wss_ap.position === 134 && REGISTRY.ship_status.position === 140);
  check('no other tile sits at 136', Object.values(REGISTRY).filter((e) => e.position === 136).length === 1);
  check('the SW precaches the module', /'\.\/tiles\/wss_gm\.js'/.test(read('docs', 'sw.js')));
  {
    const cv = Number((read('docs', 'sw.js').match(/CACHE_VERSION = 'helm-v(\d+)'/) || [])[1]);
    const av = (read('docs', 'config.js').match(/APP_VERSION = '(\d+)\.(\d+)\.\d+'/) || []).slice(1).map(Number);
    check('CACHE_VERSION is at least helm-v81', cv >= 81, String(cv));
    check('APP_VERSION is at least 1.51.0', av[0] > 1 || (av[0] === 1 && av[1] >= 51), av.join('.'));
  }
  check('npm test runs this file', /node tools\/test-wss-gm\.js/.test(read('package.json')));
  check('the default mock snapshot carries wss_gm', mock().status === 'ok' && !!mock().data);

  // -- the face ------------------------------------------------------------------
  console.log('\nthe face — a plan year mid-quarter');
  const full = mock();
  const F = full.data;
  const { root, opened, sheet } = render(full);
  const face = root.querySelector('.gm-face');
  check('one face, a role=button div (not a <button> — long-press still reaches the shell)',
    face && face.tagName === 'DIV' && face.getAttribute('role') === 'button' && face.getAttribute('tabindex') === '0');
  check('no button / input / textarea / select on the face', ['button', 'input', 'textarea', 'select'].every((t) => root.querySelectorAll(t).length === 0));
  check('head: as_of_label verbatim', text(root.querySelector('.gm-asof')) === F.as_of_label);
  check('head: "vs plan {plan_year}"', text(root.querySelector('.gm-basis-word')) === `vs plan ${F.plan_year}`, text(root.querySelector('.gm-basis-word')));
  const lines = root.querySelectorAll('.gm-line');
  check('one row per rows[] entry, in payload order', lines.map((n) => n.className.match(/gm-line-(\w+)/)[1]).join(' ') === F.rows.map((r) => r.id).join(' '));
  check('labels verbatim', lines.map((n) => text(n.querySelector('.gm-label'))).join('|') === F.rows.map((r) => r.label).join('|'));
  check('values verbatim, in the big-value cell', lines.map((n) => text(n.querySelector('.gm-value'))).join('|') === F.rows.map((r) => r.value_text).join('|'));
  check('basis_text verbatim, faint', lines.map((n) => text(n.querySelector('.gm-basis'))).join('|') === F.rows.map((r) => r.basis_text).join('|'));
  check('vs_text verbatim', lines.map((n) => text(n.querySelector('.gm-vs'))).join('|') === F.rows.map((r) => r.vs_text).join('|'));
  check('good / warn tones from result', vsTone(root, 'rental') === 'good' && vsTone(root, 'revenue') === 'warn' && vsTone(root, 'equipment') === 'warn' && vsTone(root, 'profit') === 'good');
  check('result null → vs_text printed, no tone', vsTone(root, 'parts_service') === 'none' && text(lineOf(root, 'parts_service').querySelector('.gm-vs')) === 'nothing to grade against');
  check('the value never wears a tone (its class is exactly gm-value)', lines.every((n) => n.querySelector('.gm-value').className === 'gm-value'));
  check('tones land on vs_text and NOTHING else', all(root).filter((n) => TONED.test(n.className || '')).every((n) => has(n, 'gm-vs')));
  check('the note: label · kind faint, then the text', text(root.querySelector('.gm-note-meta')) === `${F.note.label} · ${F.note.kind}` && text(root.querySelector('.gm-note')) === F.note.text);
  check('the face prints no more[] line', !root.querySelector('.gm-more') && !F.more.some((m) => text(root).includes(m.text)));

  // -- the sheet -------------------------------------------------------------------
  console.log('\nthe sheet');
  const body = sheet();
  check('the tap opens the panel titled 📈 WSS', opened.length === 1 && opened[0].title === '📈 WSS');
  const more = body.querySelectorAll('.gm-more');
  check('every more[] line, verbatim, in payload order', more.map(text).join('|') === F.more.map((m) => m.text).join('|'), more.map(text).join('|'));
  check('sections in order: more → note (no unmapped when it is null)', body.querySelectorAll('.gm-sec').map((n) => n.className.match(/gm-sec-(\w+)/)[1]).join(' ') === 'more note');
  check('the note again, in full', text(body.querySelector('.gm-sec-note').querySelector('.gm-note')) === F.note.text && has(body.querySelector('.gm-sec-note').querySelector('.gm-note'), 'gm-note-full'));
  check('the sheet has no buttons or inputs, and no tone', ['button', 'input', 'textarea', 'select'].every((t) => body.querySelectorAll(t).length === 0) && all(body).every((n) => !TONED.test(n.className || '')));
  check('the contracted-base line carries the share, never a name', /largest customer \d+%$/.test(F.more.find((m) => m.id === 'contracted_base').text));
  {
    const u = mock('--gm-unmapped');
    const b = render(u).sheet();
    check('unmapped_text: one faint line after more[], verbatim', text(b.querySelector('.gm-unmapped')) === u.data.unmapped_text &&
      b.querySelectorAll('.gm-sec').map((n) => n.className.match(/gm-sec-(\w+)/)[1]).join(' ') === 'more unmapped note');
    check('… and it stays off the face', !render(u).root.querySelector('.gm-unmapped'));
  }

  // -- no plan / a null row / long note ---------------------------------------------
  console.log('\nno plan · a row the script could not read · a long note');
  {
    const np = mock('--gm-noplan');
    const r = render(np);
    check('plan_year null → "vs last year"', text(r.root.querySelector('.gm-basis-word')) === 'vs last year');
    check('rows still verbatim, the bad tone reaches vs_text', vsTone(r.root, 'equipment') === 'bad' && text(lineOf(r.root, 'equipment').querySelector('.gm-vs')) === np.data.rows[3].vs_text);
    check('note null → nothing drawn, and the sheet has no note section', !r.root.querySelector('.gm-note') && !r.root.querySelector('.gm-note-meta') && !/note/i.test(text(r.root)) && !r.sheet().querySelector('.gm-sec-note'));
    const nr = render(mock('--gm-nullrow'));
    check('vs_text null → no vs element, nothing toned in that row', !lineOf(nr.root, 'equipment').querySelector('.gm-vs') && all(lineOf(nr.root, 'equipment')).every((n) => !TONED.test(n.className || '')));
    check('… its value prints as sent', text(lineOf(nr.root, 'equipment').querySelector('.gm-value')) === '—');
    const ln = mock('--gm-longnote');
    const lr = render(ln);
    check('a long note renders whole on the face (the CSS clamps it, the page cuts nothing)', text(lr.root.querySelector('.gm-note')) === ln.data.note.text && ln.data.note.text.length > 600);
    check('… and the face note is clamped by the stylesheet, the sheet\'s is not', /\.gm-note\s*\{[^}]*-webkit-line-clamp:\s*4/.test(CSS) && /\.gm-note-full\s*\{[^}]*-webkit-line-clamp:\s*unset/.test(CSS));
    const yr = clone(full); yr.data.plan_year = '2027';
    check('a plan_year that is not a number reads "vs last year" (no number parsed)', text(render(yr).root.querySelector('.gm-basis-word')) === 'vs last year');
  }

  // -- stale / empty / error ---------------------------------------------------------
  console.log('\nstale · empty · error (K13)');
  {
    const st = mock('--gm-stale');
    const r = render(st);
    check('the mock is stale with a reason', st.status === 'stale' && /h old/.test(st.error));
    check('stale: the last numbers still print, byte-identical to ok', (() => {
      const ok = clone(st); ok.status = 'ok';
      return text(r.root) === text(render(ok).root) && lineOf(r.root, 'revenue') && text(lineOf(r.root, 'revenue').querySelector('.gm-value')) === st.data.rows[0].value_text;
    })());
    check('stale: the module draws no pill of its own (the shell\'s amber pill + reason line)', !r.root.querySelector('.pill') && !r.root.querySelector('.card-error'));
    check('the shell greys and pills a stale tile amber', /const degraded = status === 'error' \|\| status === 'stale'/.test(read('docs', 'app.js')) && /pill\(status, status === 'error' \? 'bad' : 'warn'\)/.test(read('docs', 'app.js')));
    const e = render(mock('--gm-empty'));
    check('empty → exactly one faint line, "No numbers yet."', e.root.childNodes.length === 1 && text(e.root) === 'No numbers yet.' && has(e.root.childNodes[0], 'gm-quiet'));
    check('  …no face, no tap target', !e.root.querySelector('.gm-face') && e.opened.length === 0);
    const er = render({ band: 'DAILY', status: 'error', error: 'kpi.json unreadable (JSONDecodeError)', data: {} });
    check('error → the module draws nothing (the shell owns pill, line and grey)', er.root.childNodes.length === 0);
  }

  // -- the tone lookup ----------------------------------------------------------------
  console.log('\nthe tone lookup (K11)');
  for (const bad of ['win', 'GOOD', '', 'warning', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 1, true, null, {}, []]) {
    const x = clone(full); x.data.rows[0].result = bad;
    let r, threw = null;
    try { r = render(x); } catch (e) { threw = e; }
    check(`result ${JSON.stringify(bad)} → no tone, no throw`, !threw && r && vsTone(r.root, 'revenue') === 'none', threw && threw.message);
  }

  // -- K14: text is untrusted ------------------------------------------------------------
  console.log('\nuntrusted text (K14)');
  {
    const evil = clone(mock('--gm-unmapped'));
    const tag = '<img src=x onerror=alert(1)>';
    evil.data.note.text = tag + ' **bold**';
    evil.data.unmapped_text = 'Not in a bucket: ' + tag;
    evil.data.rows[0].label = tag;
    evil.data.more[0].text = tag;
    const r = render(evil);
    const b = r.sheet();
    check('markup in the note, a label, an unmapped line and a more line prints as text',
      text(r.root.querySelector('.gm-note')) === evil.data.note.text && text(lineOf(r.root, 'revenue').querySelector('.gm-label')) === tag &&
      text(b.querySelector('.gm-unmapped')) === evil.data.unmapped_text && text(b.querySelector('.gm-more')) === tag);
    check('no element was built from it', all(r.root).concat(all(b)).every((n) => n.tagName !== 'IMG'));
  }

  // -- hostile shapes ---------------------------------------------------------------------
  console.log('\nhostile shapes (rule 9)');
  {
    const shapes = [
      null, undefined, 'x', 42, [], {},
      { as_of_label: 5, plan_year: {}, rows: 'none', more: 7, unmapped_text: 9, note: 'x' },
      { rows: [null, 3, 'x', [], {}, { id: {}, label: 7, value_text: 101000, basis_text: 1, vs_text: 94, result: 'good' }], more: [null, 3, {}, { text: 5 }, 'a bare string line'], note: { text: 12, label: {}, kind: [] } },
      { ...clone(F), mystery: { any: true }, rows: F.rows.map((r) => ({ ...r, extra: '<b>x</b>' })) },
    ];
    let threw = null;
    for (const data of shapes) {
      try { const r = render(tileOf(data)); if (r.root.querySelector('.gm-face')) r.sheet(); } catch (e) { threw = e; break; }
    }
    check('no shape throws (face and sheet)', !threw, threw && threw.stack);
    for (const status of ['ok', 'stale', 'missing', undefined]) {
      let t2 = null;
      try { render({ status, data: null }); render({ status, data: shapes[7] }); } catch (e) { t2 = e; }
      check(`status ${status} with hostile data never throws`, !t2, t2 && t2.message);
    }
    const r = render(tileOf(shapes[7]));
    check('a number where text is expected vanishes (no number formatting)', !/101000|101,000|94/.test(text(r.root)));
    check('  …and that row wears no tone (no vs_text, no tone)', all(r.root).every((n) => !TONED.test(n.className || '')));
    check('a bare-string more line prints; non-text entries vanish', text(r.sheet()) === 'a bare string line');
    const u = render(tileOf(shapes[8]));
    check('unknown keys are ignored', !/<b>x<\/b>|mystery/.test(text(u.root) + text(u.sheet())));
    check('NaN / undefined / null / [object never printed', !/NaN|undefined|null|\[object/.test(shapes.map((d) => { const x = render(tileOf(d)); return text(x.root) + (x.root.querySelector('.gm-face') ? text(x.sheet()) : ''); }).join('')));
    check('data null with status ok → the quiet line', text(render(tileOf(null)).root) === 'No numbers yet.');
  }

  // -- source scans -------------------------------------------------------------------------
  console.log('\nsource scans');
  check('rule 7: no new Date(', !/new Date\(/.test(SRC));
  check('rule 7: no Date.parse / Date.now / Intl', !/Date\.parse|Date\.now|Intl\./.test(SRC));
  check('rule 10: no innerHTML / insertAdjacentHTML', !/innerHTML|insertAdjacentHTML/.test(SRC));
  check('no fetch(', !/fetch\(/.test(SRC));
  check('K11: no number formatting (toFixed, toLocaleString, Math., parseInt, parseFloat, Number(, String(', !/toFixed|toLocaleString|Math\.|parseInt|parseFloat|Number\(|String\(/.test(CODE));
  check('K11: no arithmetic operators in the code (+ - * / % += -= ++ --, and no .reduce)',
    !/\s[-*/%+]\s|[+-]=|\+\+|--(?!\w)|\.reduce\(/.test(CODE.replace(/'[^']*'|`[^`]*`/g, "''")));
  check('K11: no comparison at all (< > <= >=)', !/[^=!]=?[<>]=?(?!=)/.test(CODE.replace(/'[^']*'|`[^`]*`/g, "''").replace(/=>/g, '')));
  check('K11: the tone words live in the one TONE lookup', (CODE.match(/'(good|warn|bad)'/g) || []).length === 3 && /const TONE = \{ good: 'good', warn: 'warn', bad: 'bad' \};/.test(CODE));
  check('K11: TONE is read in exactly one function', (CODE.match(/\bTONE\b/g) || []).length === 3);
  check('rules 5/6: no event post, no actions but openPanel', !/submitEvent|\/api\/event|actions\.(?!openPanel)\w+/.test(CODE));
  check('no button / input / textarea / select built', !/el\('(button|input|textarea|select)'/.test(CODE));
  check('no feed: the module reads no ctx.live / ctx.weather', !/ctx\??\.(live|weather)/.test(CODE) && !('feed' in REGISTRY.wss_gm));
  check('K10: the module never names payroll or a customer field', !/payroll|top_customer|closed_month/i.test(SRC));

  // -- stylesheet ---------------------------------------------------------------------------
  console.log('\nstylesheet');
  {
    const start = CSS.indexOf('/* ------------------------------------------------------------ wss_gm (');
    const end = CSS.indexOf('/* ------------------------------------------------------------ /wss_gm */', start);
    check('the block is found, after Doc and not at the end of the file', start > CSS.indexOf('/doc */') && end > start && end < CSS.indexOf('B14 — the live pulse'));
    const block = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const toned = rules.filter((r) => /var\(--(good|warn|bad|info)\)/.test(r.body));
    const SCOPED = /^\.(card|panel)\[data-tile="wss_gm"\] \.gm-vs-(good|warn|bad)$/;
    check('tone tokens only on vs_text, scoped to this tile\'s card and panel',
      toned.length === 3 && toned.every((r) => r.sel.split(',').every((s) => SCOPED.test(s.trim()))), toned.map((r) => r.sel).join(' | '));
    check('every toned rule names both the card and the panel', toned.every((r) => /\.card\[data-tile="wss_gm"\]/.test(r.sel) && /\.panel\[data-tile="wss_gm"\]/.test(r.sel)));
    check('good → --good, warn → --warn, bad → --bad, nothing crossed', toned.every((r) => {
      const t = r.sel.match(/-(good|warn|bad)\s*$/)[1];
      return (r.body.match(/var\(--(good|warn|bad)\)/g) || []).every((v) => v === `var(--${t})`);
    }));
    check('the value rule wears no tone, and is the text colour', rules.filter((r) => /\.gm-value\b/.test(r.sel)).every((r) => !/--(good|warn|bad)/.test(r.body)) && /\.gm-value\s*\{[^}]*color:\s*var\(--text\)/.test(block));
    check("the value is Site Pulse's big-value style (22px / 650 / tabular)", /\.gm-value\s*\{[^}]*font-size:\s*22px;[^}]*font-weight:\s*650;[^}]*tabular-nums/.test(block));
    check('the basis is faint, the quiet line is faint', /\.gm-basis\s*\{[^}]*color:\s*var\(--text-faint\)/.test(block) && /\.gm-quiet\s*\{[^}]*color:\s*var\(--text-faint\)/.test(block));
    check('no --info and no colour literals in the block', !/--info/.test(block) && !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(block));
    check('no rule outside the block styles a gm- class', ![...(CSS.slice(0, start) + CSS.slice(end + 10)).matchAll(/([^{}]+)\{/g)].some((m) => /\.gm-/.test(m[1])));
    check('text sizes are on the scale (11·12·13·14·22)', [...block.matchAll(/font-size:\s*(\d+)px/g)].every((m) => [11, 12, 13, 14, 22].includes(Number(m[1]))));
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
