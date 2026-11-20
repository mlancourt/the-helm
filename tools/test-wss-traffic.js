#!/usr/bin/env node
/**
 * The Helm — wss_traffic ("Site Pulse"). Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-wss-traffic.js
 *
 * Vault spec `Site-Pulse-Scoreboard-Spec.md` (SB1–SB12), amending
 * `Site-Pulse-Tile-Spec.md` (S1–S15). The rulings with teeth:
 *
 *   SB1–SB3 the face is the weekly scoreboard: one dated group, six rows in
 *           order, each dot · label over prev / avg · this 7 days · arrow, no
 *           sparkline.
 *   SB4 the tone is the script's ratio — this 7 days ÷ the 4-week average —
 *       through ONE weekTone() against one named constant pair; nothing that
 *       chooses a colour reads the previous-7 figure or the change. Held at
 *       the DOM, in the module source and in the stylesheet.
 *   SB5 the arrow is the change against the previous 7, faint, ▲ = better,
 *       nothing at zero.
 *   SB7 no false baselines: a null average is a hollow dot and `avg —`.
 *   SB8 a GA4 gap is one faint line; the two values still print.
 *   SB9 the footer: flagged count · yesterday's sessions · 5xx (S11's
 *       threshold tone) · CF's date.
 *   SB10 the sheet opens with the whole scoreboard and the flagged searches.
 *   SB11 no scoreboard, or one more than six days old → one line in place of
 *        the rows, the footer still printed; a missing row is `—` + hollow.
 *   S6  a failed source greys its rows in place with its last good date and
 *       why; three newest days missing turns its dots black.
 *   S8  no dollar sign anywhere in the module; no buttons on the face.
 *   S9  an unknown metric surfaces under its own key (the sheet).
 *   SB12/S10 the page computes no ratio, no average and no change.
 */

const fs = require('node:fs');
const path = require('node:path');
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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const mockFile = (name) => JSON.parse(read('docs', 'mock', name));
const clone = (o) => JSON.parse(JSON.stringify(o));
const cls = (node) => node.className;

(async () => {
  const mod = await import('../docs/tiles/wss_traffic.js');
  const { shortDay, addDays } = await import('../docs/lib/fmt.js');
  const SRC = read('docs', 'tiles', 'wss_traffic.js');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const CSS = read('docs', 'style.css');

  /** Render a tile; returns {root, sheet()} — sheet() taps the face and builds the panel body. */
  function render(tile) {
    const root = new El('div');
    const opened = [];
    const actions = { openPanel: (title, build) => opened.push({ title, build }) };
    mod.render(root, tile, { id: 'wss_traffic', actions });
    return {
      root,
      opened,
      sheet() {
        const face = root.querySelector('.pulse-face');
        face.listeners.click[0]({});
        const body = new El('div');
        opened[opened.length - 1].build(body);
        return body;
      },
    };
  }
  const tileOf = (data, status = 'ok') => ({ band: 'DAILY', status, error: null, data });

  const clean = mockFile('helm-data.json').tiles.wss_traffic;
  const D = clean.data;
  const WK = D.weekly;
  const FACE_KEYS = ['clicks', 'clicks_net', 'mobile_clicks', 'mobile_impressions', 'organic_sessions', 'leads'];
  const LABELS = ['Clicks', 'Clicks, net of flagged', 'Mobile clicks', 'Mobile impressions', 'Organic sessions', 'Leads'];
  const rowOf = (w, key) => w.rows.find((r) => r.key === key);
  const linesOf = (root) => root.querySelectorAll('.pulse-line');
  const lineOf = (root, key) => root.querySelector('.pulse-line-' + key);
  const valueOf = (root, key) => lineOf(root, key).querySelector('.pulse-value');
  const subOf = (root, key) => lineOf(root, key).querySelector('.pulse-sub7');
  const dotIn = (node) => node.querySelectorAll('.pulse-dot').map(cls);
  const toneIn = (node) => cls(node.querySelector('.pulse-value')).replace('pulse-value pulse-value-', '');
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 20 }) : '—');

  // -- the registry ------------------------------------------------------------
  console.log('\nregistry');
  const REG = read('docs', 'tiles', '_registry.js');
  check(
    'S1: wss_traffic, DAILY, position 132, 📈 Site Pulse',
    /wss_traffic:\s*\{\s*band:\s*'DAILY',\s*position:\s*132,\s*module:\s*'\.\/tiles\/wss_traffic\.js',\s*title:\s*'📈 Site Pulse'/.test(REG)
  );
  const { REGISTRY } = await import('../docs/tiles/_registry.js');
  check('Crew Tape 130 and Ship Status 140 did not move', REGISTRY.wss_tape.position === 130 && REGISTRY.ship_status.position === 140);
  check('the SW precaches the module', /'\.\/tiles\/wss_traffic\.js'/.test(read('docs', 'sw.js')));
  {
    const cv = Number((read('docs', 'sw.js').match(/CACHE_VERSION = 'helm-v(\d+)'/) || [])[1]);
    const av = (read('docs', 'config.js').match(/APP_VERSION = '(\d+)\.(\d+)\.\d+'/) || []).slice(1).map(Number);
    check('CACHE_VERSION is at least helm-v82 (the scoreboard face)', cv >= 82, String(cv));
    check('APP_VERSION is at least 1.52.0', av[0] > 1 || (av[0] === 1 && av[1] >= 52), av.join('.'));
  }

  // -- the face: the weekly scoreboard ---------------------------------------------
  console.log('\nthe face — the weekly scoreboard (SB1–SB3)');
  const { root } = render(clean);
  const heads = root.querySelectorAll('.pulse-group-head');
  check('SB1: one group head', heads.length === 1, String(heads.length));
  check('SB1: "Search · 7 days to {window_end}"', heads[0].querySelector('.pulse-group-name').textContent === 'Search'
    && heads[0].querySelector('.pulse-date').textContent === '7 days to ' + shortDay(WK.window.end), heads[0].textContent);
  check('SB1: the S11 groups are gone (no GA4 group, no lag suffix)', !root.querySelector('.pulse-group-ga4') && !root.querySelector('.pulse-group-gsc') && !root.textContent.includes('lags'));
  const lines = linesOf(root);
  const labels = lines.map((n) => n.querySelector('.pulse-label').textContent);
  check('SB2: six rows, these labels, this order', labels.join('|') === LABELS.join('|'), labels.join('|'));
  check('SB2: each row is the row its key names', lines.map((n) => cls(n).split(' ')[1]).join() === FACE_KEYS.map((k) => 'pulse-line-' + k).join());
  check('SB3: every row is four cells — dot · label over prev/avg · value · arrow', lines.every((n) => n.childNodes.length === 4
    && cls(n.childNodes[0]).startsWith('pulse-dot ') && cls(n.childNodes[1]) === 'pulse-name' && cls(n.childNodes[2]).startsWith('pulse-value ') && cls(n.childNodes[3]) === 'pulse-arrow-cell'));
  const vals = lines.map((n) => n.querySelector('.pulse-value').textContent);
  check('SB3: the big value is this 7 days, printed as given', vals.join('|') === FACE_KEYS.map((k) => fmt(rowOf(WK, k).w)).join('|'), vals.join('|'));
  const subs = FACE_KEYS.map((k) => subOf(root, k).textContent);
  check('a fractional average keeps its digits and gains the thousands comma (4,120.75), the arrow too (▼ 1,340)', subOf(root, 'mobile_impressions').textContent === 'prev 3,950 · avg 4,120.75' && lineOf(root, 'mobile_impressions').querySelector('.pulse-arrow').textContent === '▼ 1,340');
  check('SB3: "prev {P} · avg {average}" under each label', subs.join('|') === FACE_KEYS.map((k) => 'prev ' + fmt(rowOf(WK, k).p) + ' · avg ' + fmt(rowOf(WK, k).avg)).join('|'), subs.join('|'));
  check('SB3: no sparkline on the face', root.querySelectorAll('svg').length === 0);
  check('SB3: the sheet-only rows are not on the face', !lineOf(root, 'mobile_position') && !lineOf(root, 'desktop_clicks') && !lineOf(root, 'desktop_impressions'));

  // SB4: the tone.
  const want = { clicks: 'warn', clicks_net: 'good', mobile_clicks: 'warn', mobile_impressions: 'bad', organic_sessions: 'good', leads: 'good' };
  check('SB4: the fixture tones all six rows (no hollow dot)', FACE_KEYS.every((k) => toneIn(lineOf(root, k)) !== 'none'));
  for (const k of FACE_KEYS) {
    check(`SB4: ${k} ratio ${rowOf(WK, k).ratio} → ${want[k]}`, toneIn(lineOf(root, k)) === want[k], toneIn(lineOf(root, k)));
  }
  check('SB4: every row’s dot and value wear the same tone', lines.every((n) => dotIn(n)[0].replace('pulse-dot pulse-dot-', '') === toneIn(n)));
  check('SB4: a toned dot says what it compares', lineOf(root, 'clicks').querySelector('.pulse-dot').getAttribute('title') === 'vs the 4-week average');

  // SB5: the arrow.
  const arrows = lines.map((n) => n.querySelector('.pulse-arrow-cell').textContent);
  const wantArrows = FACE_KEYS.map((k) => {
    const d = rowOf(WK, k).delta;
    return d === 0 ? '' : (d > 0 ? '▲ ' : '▼ ') + fmt(Math.abs(d));
  });
  check('SB5: the arrow is the change vs the previous 7, ▲ up / ▼ down, magnitude as given', arrows.join('|') === wantArrows.join('|'), arrows.join('|'));
  check('SB5/S14: leads changed by 0 → no arrow node at all', rowOf(WK, 'leads').delta === 0 && lineOf(root, 'leads').querySelectorAll('.pulse-arrow').length === 0);
  check('SB5: every arrow wears the one plain class, tooltip "vs the previous 7 days"', root.querySelectorAll('.pulse-arrow').every((n) => cls(n) === 'pulse-arrow' && n.getAttribute('title') === 'vs the previous 7 days'));
  check('no "– 0" anywhere on the face', !root.textContent.includes('– 0'));

  // SB9: the footer.
  const foot = root.querySelector('.pulse-footline');
  const wantFoot = WK.flagged.length + ' searches flagged · Yesterday ' + shortDay(D.latest.ga4.date) + ': ' + fmt(D.latest.ga4.sessions.value)
    + ' sessions · 5xx ' + fmt(D.latest.cf.err5xx_pct.value) + '% · CF ' + shortDay(D.latest.cf.date);
  check('SB9: footer — flagged · yesterday’s sessions · 5xx · CF', foot && foot.textContent === wantFoot, foot && foot.textContent);
  check('SB9: the fixture flags two searches', WK.flagged.length === 2);
  check('SB9: 5xx under the threshold wears no tone', cls(foot.querySelector('.pulse-foot-5xx')) === 'pulse-foot-5xx');
  check('no GA4 gap line on a whole week', !root.querySelector('.pulse-gap'));
  check('no source is down', root.querySelectorAll('.pulse-src-down').length === 0 && root.querySelectorAll('.pulse-line-grey').length === 0);

  const face = root.querySelector('.pulse-face');
  check('the face is a role=button div, focusable', face.tagName === 'DIV' && face.getAttribute('role') === 'button' && face.getAttribute('tabindex') === '0');
  check('S8: no buttons and no links on the face', root.querySelectorAll('button').length === 0 && root.querySelectorAll('a').length === 0);
  check('S8: no dollar sign on the face', !root.textContent.includes('$'));

  // -- weekTone: the one scoreboard colour -------------------------------------
  console.log('\nweekTone (SB4)');
  const T = mod.weekTone;
  const table = [
    [1.0, 'good'], [0.95, 'good'], [0.949, 'warn'], [0.9, 'warn'], [0.8, 'warn'], [0.799, 'bad'], [0.5, 'bad'], [0, 'bad'],
    [2.4, 'good'], [null, 'none'], [undefined, 'none'], ['0.97', 'none'], [NaN, 'none'], [Infinity, 'none'],
  ];
  for (const [r, w] of table) check(`ratio ${String(r)} → ${w}`, T(r) === w, T(r));
  check('SB4: the bands are ONE named constant pair, 0.95 and 0.80', /const WEEK_GOOD = 0\.95;/.test(SRC) && /const WEEK_WARN = 0\.8;/.test(SRC)
    && /r >= WEEK_GOOD\) return 'good'/.test(SRC) && /r >= WEEK_WARN\) return 'warn'/.test(SRC));

  // -- SB4: the colour never reads the previous 7 ------------------------------------
  console.log('\nSB4 — the tone is the ratio; prev and the change never colour');
  {
    const a = clone(clean);
    Object.assign(rowOf(a.data.weekly, 'clicks'), { p: 9999, delta: -9787, ratio: 1.0 });
    const b = clone(clean);
    Object.assign(rowOf(b.data.weekly, 'clicks'), { p: 1, delta: 211, ratio: 1.0 });
    const c = clone(clean);
    Object.assign(rowOf(c.data.weekly, 'clicks'), { p: 1, delta: 211, ratio: 0.5 });
    const [ra, rb, rc] = [a, b, c].map((t) => lineOf(render(t).root, 'clicks'));
    check('a crash vs the previous 7 at ratio 1.0 is green', toneIn(ra) === 'good' && dotIn(ra).join() === 'pulse-dot pulse-dot-good');
    check('and identical to a surge at ratio 1.0 (dot, value)', ['.pulse-dot', '.pulse-value'].every((q) => cls(ra.querySelector(q)) === cls(rb.querySelector(q))));
    check('a surge vs the previous 7 at ratio 0.5 is red', toneIn(rc) === 'bad');
    check('the arrows differ (▼ 9,787 / ▲ 211) with the same class', ra.querySelector('.pulse-arrow').textContent === '▼ 9,787' && rb.querySelector('.pulse-arrow').textContent === '▲ 211' && cls(ra.querySelector('.pulse-arrow')) === cls(rb.querySelector('.pulse-arrow')));
    const avgOnly = clone(clean);
    Object.assign(rowOf(avgOnly.data.weekly, 'clicks'), { w: 1, avg: 1000 });   // the page never divides: ratio stays 0.94
    check('the page reads ratio, never w ÷ avg (w 1, avg 1000, ratio 0.94 → still warn)', toneIn(lineOf(render(avgOnly).root, 'clicks')) === 'warn');
    const noDelta = clone(clean);
    delete rowOf(noDelta.data.weekly, 'clicks').delta;
    const rn = lineOf(render(noDelta).root, 'clicks');
    check('no delta → no arrow, the dot stays', rn.querySelectorAll('.pulse-arrow').length === 0 && dotIn(rn).length === 1);
  }

  // -- SB7: a null baseline -------------------------------------------------------
  console.log('\nSB7 — a null-baseline row');
  {
    const t = mockFile('pulse-null-row.json').tiles.wss_traffic;
    const r = render(t).root;
    check('leads: hollow dot, untoned value, "avg —"', dotIn(lineOf(r, 'leads')).join() === 'pulse-dot pulse-dot-none' && toneIn(lineOf(r, 'leads')) === 'none'
      && subOf(r, 'leads').textContent === 'prev ' + fmt(rowOf(t.data.weekly, 'leads').p) + ' · avg —', subOf(r, 'leads').textContent);
    check('net clicks: hollow too, its value still printed', dotIn(lineOf(r, 'clicks_net')).join() === 'pulse-dot pulse-dot-none' && valueOf(r, 'clicks_net').textContent === fmt(rowOf(t.data.weekly, 'clicks_net').w));
    check('the hollow dot says "no 4-week average"', lineOf(r, 'leads').querySelector('.pulse-dot').getAttribute('title') === 'no 4-week average');
    check('the other rows keep their tones', toneIn(lineOf(r, 'clicks')) === 'warn' && toneIn(lineOf(r, 'mobile_impressions')) === 'bad');
    check('SB9: one flagged → "1 search flagged"', r.querySelector('.pulse-footline').textContent.startsWith('1 search flagged · Yesterday '));
  }

  // -- SB8: a GA4 gap -----------------------------------------------------------
  console.log('\nSB8 — GA4 missing a day');
  {
    const t = mockFile('pulse-ga4-gap.json').tiles.wss_traffic;
    const r = render(t).root;
    const gap = r.querySelector('.pulse-gap');
    check('one faint line under the rows: "GA4 missing 1 day in this window"', gap && gap.textContent === 'GA4 missing 1 day in this window', gap && gap.textContent);
    check('  …inside the group, after the rows', r.querySelector('.pulse-group-weekly').childNodes.indexOf(gap) === 2);
    check('the two GA4 values still print', valueOf(r, 'organic_sessions').textContent === fmt(rowOf(t.data.weekly, 'organic_sessions').w) && valueOf(r, 'leads').textContent === fmt(rowOf(t.data.weekly, 'leads').w));
    check('  …untoned and with no arrow — the script sent no ratio and no change', ['organic_sessions', 'leads'].every((k) => toneIn(lineOf(r, k)) === 'none' && lineOf(r, k).querySelectorAll('.pulse-arrow').length === 0));
    const three = clone(t);
    three.data.weekly.ga4_gap_days = 3;
    check('three days → "GA4 missing 3 days in this window"', render(three).root.querySelector('.pulse-gap').textContent === 'GA4 missing 3 days in this window');
    const junk = clone(t);
    junk.data.weekly.ga4_gap_days = '1';
    check('a gap that is not a number → no line', !render(junk).root.querySelector('.pulse-gap'));
  }

  // -- SB9: the footer’s 5xx threshold -----------------------------------------------
  console.log('\nSB9 — 5xx keeps S11’s threshold tone');
  {
    const at = (v, ratio) => {
      const t = clone(clean);
      t.data.latest.cf.err5xx_pct = { value: v, dod: 0, baseline: 0.1, ratio };
      return render(t).root.querySelector('.pulse-foot-5xx');
    };
    check('0.002% → "5xx 0.002%", no tone', at(0.002, 0.02).textContent === '5xx 0.002%' && cls(at(0.002, 0.02)) === 'pulse-foot-5xx');
    check('exactly 0.5% at ratio 5 (lower is better) → bad', cls(at(0.5, 5)) === 'pulse-foot-5xx pulse-value-bad');
    check('0.6% at ratio 1.5 → warn', cls(at(0.6, 1.5)) === 'pulse-foot-5xx pulse-value-warn');
    check('0.6% with no daily baseline → no tone (S11’s row was hollow too)', cls(at(0.6, null)) === 'pulse-foot-5xx');
    check('5xx never earns a row on the face any more', !lineOf(render(clean).root, 'err5xx_pct'));
    const none = clone(clean);
    none.data.weekly.flagged = [];
    check('nothing flagged → the flagged part is omitted', render(none).root.querySelector('.pulse-footline').textContent.startsWith('Yesterday '));
  }

  // -- dotTone: kept for the 5xx footer only --------------------------------------
  console.log('\ndotTone (S3 daily bands — the 5xx footer only)');
  {
    const DT = mod.dotTone;
    const t2 = [
      ['err5xx_pct', 1.0, true, 'good'], ['err5xx_pct', 1.25, true, 'good'], ['err5xx_pct', 1.26, true, 'warn'], ['err5xx_pct', 1.67, true, 'warn'],
      ['err5xx_pct', 1.68, true, 'bad'], ['sessions', 0.8, false, 'good'], ['sessions', 0.79, false, 'warn'], ['sessions', 0.59, false, 'bad'],
      ['sessions', null, false, 'none'], ['sessions', '0.9', false, 'none'],
    ];
    for (const [k, r, low, w] of t2) check(`${k} ${String(r)}${low ? ' (lower is better)' : ''} → ${w}`, DT(k, r, low) === w, DT(k, r, low));
  }

  // -- SB11: not available ------------------------------------------------------------
  console.log('\nSB11 — no scoreboard, an old one, a missing row');
  {
    const nw = mockFile('pulse-no-weekly.json').tiles.wss_traffic;
    check('the fixture carries weekly: null (the engine’s absent shape)', nw.data.weekly === null);
    const r = render(nw).root;
    const na = r.querySelector('.pulse-weekly-na');
    check('no weekly → "Weekly scoreboard not available · last never"', na && na.textContent === 'Weekly scoreboard not available · last never', na && na.textContent);
    check('  …in place of the rows: no rows, no group head', linesOf(r).length === 0 && !r.querySelector('.pulse-group-head'));
    check('  …and the footer still prints (yesterday, 5xx, CF)', r.querySelector('.pulse-footline').textContent === 'Yesterday ' + shortDay(D.latest.ga4.date) + ': 87 sessions · 5xx 0% · CF ' + shortDay(D.latest.cf.date));
    check('  …still a tap target', r.querySelector('.pulse-face').getAttribute('role') === 'button');
    const removed = clone(clean);
    delete removed.data.weekly;
    check('the key removed from a copy (the Architect’s acceptance) → the same line, nothing thrown', render(removed).root.querySelector('.pulse-weekly-na').textContent === 'Weekly scoreboard not available · last never');

    const old = clone(clean);
    old.data.weekly.window.end = addDays(D.run_today, -7);
    const ro = render(old).root;
    check('window ended 7 days before run_today → not available · last {that day}', ro.querySelector('.pulse-weekly-na').textContent === 'Weekly scoreboard not available · last ' + shortDay(addDays(D.run_today, -7)) && linesOf(ro).length === 0);
    const six = clone(clean);
    six.data.weekly.window.end = addDays(D.run_today, -6);
    check('6 days before → still shown', linesOf(render(six).root).length === 6);
    const noRun = clone(old);
    delete noRun.data.run_today;
    check('no run_today → nothing to judge age by, shown as dated', linesOf(render(noRun).root).length === 6);
    const noEnd = clone(clean);
    noEnd.data.weekly.window = { start: 'x' };
    check('a window with no end → not available · last never', render(noEnd).root.querySelector('.pulse-weekly-na').textContent === 'Weekly scoreboard not available · last never');

    const miss = clone(clean);
    miss.data.weekly.rows = miss.data.weekly.rows.filter((x) => x.key !== 'clicks');
    const rm = render(miss).root;
    check('a row the script did not send → "—" with a hollow dot, prev — · avg —, its label kept', valueOf(rm, 'clicks').textContent === '—'
      && dotIn(lineOf(rm, 'clicks')).join() === 'pulse-dot pulse-dot-none' && subOf(rm, 'clicks').textContent === 'prev — · avg —'
      && lineOf(rm, 'clicks').querySelector('.pulse-label').textContent === 'Clicks');
    const nulls = clone(clean);
    for (const x of nulls.data.weekly.rows) Object.assign(x, { w: null, p: null, avg: null, ratio: null, delta: null });
    const rn = render(nulls).root;
    check('a scoreboard the script could not compute (all null) → six "—" rows, hollow, no arrows', linesOf(rn).length === 6
      && FACE_KEYS.every((k) => valueOf(rn, k).textContent === '—' && dotIn(lineOf(rn, k)).join() === 'pulse-dot pulse-dot-none') && rn.querySelectorAll('.pulse-arrow').length === 0);
  }

  // -- S6: a greyed source ------------------------------------------------------------
  console.log('\nS6 — a failed source, held by SB11');
  {
    const down = mockFile('pulse-gsc-down.json').tiles.wss_traffic;
    const r = render(down).root;
    const gscKeys = FACE_KEYS.slice(0, 4);
    check('the four Search Console rows grey in place, "—", no prev/avg, no arrow', gscKeys.every((k) => valueOf(r, k).textContent === '—'
      && cls(lineOf(r, k)).includes('pulse-line-grey') && !subOf(r, k) && lineOf(r, k).querySelectorAll('.pulse-arrow').length === 0));
    check('five newest days missing → their dots are ⚫', gscKeys.every((k) => dotIn(lineOf(r, k)).join() === 'pulse-dot pulse-dot-dead'));
    const line = r.querySelector('.pulse-src-down');
    check('the status line: source · last good · why', line && line.textContent === `GSC · last good ${shortDay(down.data.sources_status.gsc.last_good)} · 403 permission`, line && line.textContent);
    check('the GA4 rows are unaffected and keep their tones', toneIn(lineOf(r, 'organic_sessions')) === 'good' && valueOf(r, 'leads').textContent === fmt(rowOf(down.data.weekly, 'leads').w));
    const two = clone(clean);
    two.data.sources_status.gsc = { ok: false, last_good: D.latest.gsc.date, error: 'timeout' };
    check('down with 2 null days → hollow, not black', dotIn(lineOf(render(two).root, 'clicks')).join() === 'pulse-dot pulse-dot-none');
    const lag = clone(clean);
    lag.data.days[2].gsc = null;
    check('three null days while ok → no grey, no black (the lag is not a failure)', render(lag).root.querySelectorAll('.pulse-line-grey').length === 0);
    const ga4Down = clone(clean);
    ga4Down.data.sources_status.ga4 = { ok: false, last_good: D.latest.ga4.date, error: '500 backend' };
    const rg = render(ga4Down).root;
    check('GA4 down → its two rows grey, its line says so, the footer’s yesterday reads —', ['organic_sessions', 'leads'].every((k) => valueOf(rg, k).textContent === '—')
      && rg.querySelectorAll('.pulse-src-down').map((n) => n.textContent).join() === 'GA4 · last good ' + shortDay(D.latest.ga4.date) + ' · 500 backend'
      && rg.querySelector('.pulse-footline').textContent.includes('Yesterday: — sessions'));
    const cfDown = clone(clean);
    cfDown.data.sources_status.cf = { ok: false, last_good: null, error: '403 token' };
    cfDown.data.latest.cf = null;
    for (const d of cfDown.data.days) d.cf = null;
    const rc = render(cfDown).root;
    check('Cloudflare down → its line under the footer, 5xx — and no CF date', rc.querySelectorAll('.pulse-src-down').map((n) => n.textContent).join() === 'CF · no good pull yet · 403 token'
      && rc.querySelector('.pulse-footline').textContent === '2 searches flagged · Yesterday ' + shortDay(D.latest.ga4.date) + ': 87 sessions · 5xx —', rc.querySelector('.pulse-footline').textContent);
    const naDown = clone(down);
    naDown.data.weekly = null;
    const rnd = render(naDown).root;
    check('no scoreboard AND a source down → the not-available line, then its status line', rnd.querySelector('.pulse-weekly-na') && rnd.querySelectorAll('.pulse-src-down').length === 1);
  }

  // -- stale and empty ------------------------------------------------------------
  console.log('\nstale and empty');
  {
    const stale = mockFile('pulse-stale.json').tiles.wss_traffic;
    const r = render(stale).root;
    const chip = r.querySelector('.pulse-stale');
    check('stale → a chip "stale since {day}"', chip && chip.textContent === 'stale since ' + shortDay(stale.data.stale_since), chip && chip.textContent);
    check('stale still renders the last data — its six rows', linesOf(r).length === 6);
    const noSince = clone(stale);
    delete noSince.data.stale_since;
    check('no stale_since → falls back to generated_at’s date', render(noSince).root.querySelector('.pulse-stale').textContent === 'stale since ' + shortDay(noSince.data.generated_at.slice(0, 10)));
    check('a fresh tile has no stale chip', root.querySelectorAll('.pulse-stale').length === 0);

    const emptyTile = mockFile('pulse-empty.json').tiles.wss_traffic;
    const e = render(emptyTile);
    check('empty → "No pulse yet — first run 6:15 AM."', e.root.textContent === 'No pulse yet — first run 6:15 AM.', e.root.textContent);
    check('empty → no face and nothing to tap', !e.root.querySelector('.pulse-face'));
  }

  // -- the sheet ------------------------------------------------------------
  console.log('\nthe sheet');
  {
    const r = render(clean);
    const body = r.sheet();
    check('tapping the body opens it, titled 📈 Site Pulse', r.opened.length === 1 && r.opened[0].title === '📈 Site Pulse');
    const secs = body.querySelectorAll('.pulse-sec').map((s) => cls(s).split(' ')[1]);
    check('SB10: the scoreboard and the flagged searches lead; everything the sheet had stays',
      secs.join(' ') === 'pulse-sec-scoreboard pulse-sec-flagged pulse-sec-sparks pulse-sec-err pulse-sec-queries pulse-sec-pages pulse-sec-channels pulse-sec-last7', secs.join(' '));
    const sb = body.querySelector('.pulse-sec-scoreboard');
    const sl = sb.querySelectorAll('.pulse-line');
    check('SB10: nine rows — the six, then mobile position, desktop clicks, desktop impressions',
      sl.map((n) => n.querySelector('.pulse-label').textContent).join('|') === LABELS.concat(['Mobile average position', 'Desktop clicks', 'Desktop impressions']).join('|'));
    check('SB10: every value as given', sl.map((n) => n.querySelector('.pulse-value').textContent).join('|') === WK.rows.map((x) => fmt(x.w)).join('|'));
    const sOf = (k) => sb.querySelector('.pulse-line-' + k);
    check('SB10: the desktop rows wear no tone — a blank dot, a plain value', ['desktop_clicks', 'desktop_impressions'].every((k) =>
      dotIn(sOf(k)).join() === 'pulse-dot pulse-dot-blank' && cls(sOf(k).querySelector('.pulse-value')) === 'pulse-value pulse-value-plain'));
    check('SB10: mobile position is toned off its ratio (avg ÷ W, 0.88 → warn)', toneIn(sOf('mobile_position')) === 'warn');
    const pa = sOf('mobile_position').querySelector('.pulse-arrow');
    check('S15: position slid (delta +0.6, lower is better) → "▼ 0.6", tooltip says so', pa.textContent === '▼ 0.6' && /lower is better, ▲ = improved/.test(pa.getAttribute('title')));
    check('SB10: the six face rows read the same in the sheet', FACE_KEYS.every((k) => toneIn(sOf(k)) === toneIn(lineOf(root, k)) && sOf(k).querySelector('.pulse-value').textContent === valueOf(root, k).textContent));
    check('SB10: one faint line — "Desktop impressions include rank-tracker traffic"', sb.querySelectorAll('.pulse-foot').map((n) => n.textContent).includes('Desktop impressions include rank-tracker traffic'));
    check('the windows, dated', sb.querySelector('.pulse-windows').textContent === 'this 7 ' + shortDay(WK.window.start) + '–' + shortDay(WK.window.end)
      + ' · prev ' + shortDay(WK.prev_window.start) + '–' + shortDay(WK.prev_window.end) + ' · avg ' + shortDay(WK.avg_window.start) + '–' + shortDay(WK.avg_window.end) + ' ÷ 4');
    const flags = body.querySelector('.pulse-sec-flagged').querySelectorAll('.pulse-flag');
    check('SB10: the flagged searches, one block each', flags.length === WK.flagged.length);
    const f0 = WK.flagged[0];
    check('  this week: clicks · impressions · CTR', flags[0].querySelectorAll('.pulse-row')[0].textContent === f0.query + f0.w.clicks + ' · ' + f0.w.impressions + ' · ' + f0.w.ctr + '%', flags[0].textContent);
    check('  and the previous 7 under it', flags[0].querySelector('.pulse-flag-before').textContent === 'prev 7' + f0.p.clicks + ' · ' + f0.p.impressions + ' · ' + f0.p.ctr + '%');
    const noP = clone(clean);
    noP.data.weekly.flagged[0].p = null;
    check('  a week with no row prints —', render(noP).sheet().querySelector('.pulse-flag-before').textContent === 'prev 7—');
    const none = clone(clean);
    none.data.weekly.flagged = [];
    check('nothing flagged → "None flagged."', render(none).sheet().querySelector('.pulse-sec-flagged').textContent.includes('None flagged.'));
    const nul = clone(clean);
    nul.data.weekly.flagged = null;
    check('flagged null (its pull failed) → "not available", and no count in the footer', render(nul).sheet().querySelector('.pulse-sec-flagged').textContent.includes('not available')
      && render(nul).root.querySelector('.pulse-footline').textContent.startsWith('Yesterday '));
    const naBody = render(mockFile('pulse-no-weekly.json').tiles.wss_traffic).sheet();
    check('SB11 in the sheet: the scoreboard section says not available, no flagged section, the rest stays',
      naBody.querySelector('.pulse-sec-scoreboard').querySelector('.pulse-weekly-na') && !naBody.querySelector('.pulse-sec-flagged') && naBody.querySelector('.pulse-sec-sparks'));

    // The sheet's unchanged half (S5).
    const sparks = body.querySelectorAll('.pulse-spark-wrap');
    check('four sparklines, in order', sparks.map((s) => s.querySelector('.pulse-spark-name').textContent).join('|') === 'Sessions|Organic clicks|Impressions|Avg position · up is better');
    check('each is an inline SVG (svgEl, no library)', body.querySelectorAll('.pulse-spark').every((s) => s.namespaceURI === 'http://www.w3.org/2000/svg'));
    check('each with a dotted baseline at the latest baseline', body.querySelectorAll('.pulse-spark-base').length === 4);
    const lastLabels = body.querySelectorAll('.pulse-spark-label').map((n) => n.textContent);
    check('each last value labelled', lastLabels.join('|') === '87|27|2,210|11.2', lastLabels.join('|'));
    {
      const inv = clone(clean);
      inv.data.days = inv.data.days.slice(2, 4);
      inv.data.days[0].gsc.position.value = 4; // newest — better
      inv.data.days[1].gsc.position.value = 12;
      inv.data.latest.gsc.position.baseline = null;
      const b2 = render(inv).sheet();
      const pos = b2.querySelectorAll('.pulse-spark-wrap').find((w) => /position/.test(w.textContent));
      const d = pos.querySelector('.pulse-spark-line').getAttribute('d');
      const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
      check('position’s axis is inverted: the better (newer) point is higher', ys.length === 2 && ys[1] < ys[0], d);
      const gap = clone(clean);
      gap.data.days = gap.data.days.slice(0, 3);
      gap.data.days[1].ga4 = null;
      const gd = render(gap).sheet().querySelectorAll('.pulse-spark-wrap')[0].querySelector('.pulse-spark-line').getAttribute('d');
      check('a missing day lifts the pen — two moves, no line drawn through the gap', (gd.match(/M/g) || []).length === 2 && !/L/.test(gd), gd);
    }
    check('5xx bars, one per day with any', body.querySelectorAll('.pulse-err-bar').length === 2, String(body.querySelectorAll('.pulse-err-bar').length));
    const qrows = body.querySelector('.pulse-sec-queries').querySelectorAll('.pulse-row').filter((n) => !n.classList.contains('pulse-row-head'));
    check('five query rows', qrows.length === 5);
    check('query row: query · clicks · impr · pos', qrows[0].querySelector('.pulse-row-name').textContent === 'example floor scrubber' && qrows[0].querySelector('.pulse-row-nums').textContent === '14 · 210 · 3.2');
    const pchips = qrows.map((q) => (q.querySelector('.pulse-pos-chip') || { textContent: '' }).textContent);
    check('position Δ: ▲ improved, ▼ slid, none under 0.5', pchips.join('|') === '▲ 0.9||▲ 4.6|▼ 2.1|', pchips.join('|'));
    check('the Δ chip is never toned', body.querySelectorAll('.pulse-pos-chip').every((n) => cls(n) === 'pulse-pos-chip'));
    const prow = body.querySelector('.pulse-sec-pages').querySelectorAll('.pulse-row')[1];
    check('page row: path · clicks · impr', prow.textContent === '/machines/example-mini-hd9 · 88');
    const segs = body.querySelectorAll('.pulse-ch');
    check('channels: four segments, the zero key skipped', segs.length === 4 && !body.querySelector('.pulse-ch-other'));
    check('legend in contract order', body.querySelectorAll('.pulse-ch-key').map((n) => n.textContent).join('|') === 'organic 412|paid 96|direct 74|referral 21');
    const trs = body.querySelector('.pulse-table').querySelectorAll('.pulse-tr');
    check('last 7 days: a header + seven rows', trs.length === 8, String(trs.length));
    check('row 1: the newest day, leads · carts · purchases', trs[1].querySelectorAll('.pulse-td').map((n) => n.textContent).join('|') === `${shortDay(D.days[0].date)}|3|1|1`, trs[1].querySelectorAll('.pulse-td').map((n) => n.textContent).join('|'));
    const also = body.querySelectorAll('.pulse-extra').map((n) => n.querySelector('.pulse-row-name').textContent);
    check('S9: the metrics the contract does not name are listed under their own key', also.includes('ga4.checkouts') && also.includes('cf.threats'), also.join(','));
    check('S9: the named ones are not repeated there', !also.includes('ga4.sessions') && !also.includes('ga4.users') && !also.includes('cf.requests'));
    check('S9: non-metrics (channels, dates, flags) are not listed as metrics', !also.some((k) => /channels|date|pulled_at|final|day_basis/.test(k)));
    const links = body.querySelectorAll('a');
    check('three footer links', links.map((a) => a.textContent).join('|') === 'GA4|Search Console|Cloudflare');
    check('exact destinations', links[0].getAttribute('href') === 'https://analytics.google.com/analytics/web/#/p347141060/reports/intelligenthome' &&
      links[1].getAttribute('href') === 'https://search.google.com/search-console?resource_id=sc-domain%3Awisconsinscrubandsweep.com' &&
      links[2].getAttribute('href') === 'https://dash.cloudflare.com/');
    check('new tab, noopener', links.every((a) => a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel'))));
    check('S8: no dollar sign in the sheet', !body.textContent.includes('$'));
    check('S8: no buttons in the sheet', body.querySelectorAll('button').length === 0);
    check('no tripwire line on a clear day', body.querySelectorAll('.pulse-tripwire').length === 0);

    const thin = { status: 'ok', latest: { ga4: clone(D.latest.ga4) }, days: D.days.slice(0, 4).map((d) => ({ date: d.date, ga4: clone(d.ga4) })) };
    const tb = render(tileOf(thin)).sheet();
    const tsecs = tb.querySelectorAll('.pulse-sec').map((s) => cls(s).split(' ')[1]);
    check('a thin fixture (no weekly) draws the not-available scoreboard + what it has data for', tsecs.join(' ') === 'pulse-sec-scoreboard pulse-sec-sparks pulse-sec-last7', tsecs.join(' '));
    const quiet = clone(clean);
    for (const d of quiet.data.days) if (d.cf) d.cf.err5xx_pct.value = 0;
    check('no 5xx on any day → no 5xx section', !render(quiet).sheet().querySelector('.pulse-sec-err'));
    const tw = clone(clean);
    tw.data.tripwire = { tag_gone: true, since: D.days[0].date };
    check('tag gone → one plain line atop the sheet', render(tw).sheet().querySelector('.pulse-tripwire').textContent === 'GA4 saw no sessions while Cloudflare saw traffic · since ' + shortDay(D.days[0].date));
  }

  // -- hostile shapes ------------------------------------------------------------
  console.log('\nhostile shapes render or vanish, never throw');
  {
    const h = (name, data, status) => {
      let threw = null;
      let r = null;
      try {
        r = render(tileOf(data, status));
        if (r.opened !== undefined && r.root.querySelector('.pulse-face')) r.sheet();
      } catch (e) {
        threw = e;
      }
      check(name, !threw && r.root.childNodes.length > 0, threw && threw.stack);
    };
    h('data a string', 'oops');
    h('data null', null);
    h('data an array', [1, 2]);
    h('days empty, latest missing', { status: 'ok', days: [] });
    h('days not an array', { status: 'ok', days: 'x', latest: { ga4: { date: '2026-11-01', sessions: { value: 3 } } } });
    h('days full of junk', { status: 'ok', days: [null, 4, 'x', { date: 7 }, { date: '2026-11-01', ga4: 'x', gsc: [] }] });
    h('numbers as strings', { status: 'ok', latest: { ga4: { date: '2026-11-01', sessions: { value: '87', dod: '-9', ratio: '0.66', baseline: '131' } } }, days: [{ date: '2026-11-01', ga4: { sessions: { value: '87' } } }] });
    h('metrics as strings', { status: 'ok', latest: { ga4: { date: '2026-11-01', sessions: 'lots', leads: 3 }, gsc: 'x', cf: 0 }, days: [{ date: '2026-11-01', ga4: {} }] });
    h('every other block the wrong type', {
      ...clone(D),
      sources_status: [], queries_top10: { a: 1 }, pages_top10: 'x', channels_7d: { organic: 'many', paid: -3 }, lower_is_better: 'position', tripwire: 'yes',
    });
    h('weekly a string', { ...clone(D), weekly: 'soon' });
    h('weekly an array', { ...clone(D), weekly: [1, 2] });
    h('weekly rows junk', { ...clone(D), weekly: { ...clone(WK), rows: [null, 4, 'x', { key: 7 }, { key: 'clicks', w: '212', ratio: 'high', delta: 'up', label: 3 }] } });
    h('weekly rows not an array', { ...clone(D), weekly: { ...clone(WK), rows: { clicks: 1 } } });
    h('weekly windows junk', { ...clone(D), weekly: { ...clone(WK), window: { end: 20261117 }, prev_window: 'x', avg_window: [] } });
    h('weekly flagged junk', { ...clone(D), weekly: { ...clone(WK), flagged: [null, 'q', { query: 3 }, { query: 'a', w: 'x', p: { clicks: 'many' } }], ga4_gap_days: -2 } });
    h('weekly alone, nothing else', { status: 'ok', weekly: clone(WK), run_today: D.run_today });
    h('run_today junk', { ...clone(D), run_today: 'today' });
    h('a bad date string', { status: 'ok', latest: { ga4: { date: 'yesterday', sessions: { value: 1 } } }, days: [{ date: 'yesterday', ga4: { sessions: { value: 1 } } }] });
    h('days[] of 1', { ...clone(D), days: clone(D.days.slice(0, 1)) });
    h('days[] empty with a full latest', { ...clone(D), days: [] });
    h('5xx as a string', { status: 'ok', latest: { cf: { date: '2026-11-01', err5xx_pct: { value: '2' } } }, days: [] });
    h('stale with nothing parseable', { status: 'stale', generated_at: 5, days: [{ date: '2026-11-01', ga4: { sessions: { value: 1 } } }] }, 'stale');
    const s = render(tileOf({ ...clone(D), weekly: { ...clone(WK), rows: [{ key: 'clicks', label: 'Clicks', w: '212', p: '198', avg: '224.5', ratio: '0.94' }] } })).root;
    check('a string where a number belongs prints —, never the string, and no tone', valueOf(s, 'clicks').textContent === '—' && subOf(s, 'clicks').textContent === 'prev — · avg —' && toneIn(lineOf(s, 'clicks')) === 'none');
    const lab = render(tileOf({ ...clone(D), weekly: { ...clone(WK), rows: [{ key: 'clicks', label: '', w: 1 }] } })).root;
    check('an empty label falls back to the spec’s own', lineOf(lab, 'clicks').querySelector('.pulse-label').textContent === 'Clicks');
  }

  // -- rule 7: no Date built from a string --------------------------------------
  console.log('\nrule 7');
  {
    const Real = Date;
    let stringDates = 0;
    global.Date = class extends Real {
      constructor(...a) {
        if (a.length === 1 && typeof a[0] === 'string') stringDates++;
        super(...a);
      }
      static parse(s) { stringDates++; return Real.parse(s); }
    };
    try {
      render(clean).sheet();
      for (const f of ['pulse-gsc-down.json', 'pulse-stale.json', 'pulse-null-row.json', 'pulse-ga4-gap.json', 'pulse-no-weekly.json']) render(mockFile(f).tiles.wss_traffic).sheet();
    } finally {
      global.Date = Real;
    }
    check('a full face + sheet render of every face builds no Date from a string', stringDates === 0, String(stringDates));
  }

  // -- source scans ------------------------------------------------------------
  console.log('\nsource scans');
  check('S8: no dollar sign anywhere in the module', !SRC.includes('$'));
  check('rule 10: no innerHTML', !/innerHTML/.test(SRC));
  check('rule 7: no new Date(', !/new Date\(/.test(SRC));
  check('rule 7: no Date.parse', !/Date\.parse/.test(SRC));
  check('rule 7: the one age check goes through daysBetween', /import \{ shortDay, daysBetween \} from '\.\.\/lib\/fmt\.js'/.test(SRC) && CODE.split('daysBetween(').length === 2);
  check('SB12: no median', !/median/i.test(SRC));
  check('SB12: no baseline computed', !/baseline\s*=[^=]/.test(SRC));
  check('SB12: no ratio computed', !/ratio\s*=[^=]/.test(SRC) && !/\.w\s*\/|\/\s*\w+\.avg|\.avg\s*\//.test(CODE));
  check('SB12: no change computed from w and p', !/\.w\s*-\s*\w*\.?p\b/.test(CODE));
  check('SB12: no reductions over days[]', !/\.reduce\(/.test(SRC));
  check('S3: the day-over-day field is gone from the module', !/\bdod\b/.test(CODE));
  const aStart = SRC.indexOf('function weekArrow(');
  const aEnd = SRC.indexOf('\nfunction ', aStart + 1);
  const outside = SRC.slice(0, aStart) + SRC.slice(aEnd);
  check('SB5: `delta` appears only inside weekArrow()', aStart > 0 && aEnd > aStart && /\.delta/.test(SRC.slice(aStart, aEnd)) && !/delta/.test(outside));
  const wtStart = SRC.indexOf('export function weekTone(');
  const wtBody = SRC.slice(wtStart, SRC.indexOf('\n}\n', wtStart)).replace(/^.*\n/, '');
  check('SB4: weekTone reads its ratio argument only', wtStart > 0 && !/delta|prev|\.p\b|\.w\b|avg|dod|value|baseline/.test(wtBody));
  check('SB4: weekTone has one caller — scoreRows, off row.ratio', CODE.split('weekTone(').length === 3 && /const tone = weekTone\(row \? row\.ratio : null\);/.test(SRC));
  check('SB9: dotTone has one caller — the footer’s 5xx', CODE.split('dotTone(').length === 3 && /dotTone\('err5xx_pct', em\.ratio/.test(SRC));
  const toneUses = [...SRC.matchAll(/pulse-(dot|value)-' \+ (\w+)/g)].map((m) => m[1] + ':' + m[2]);
  check('the dot and the value each take a tone variable, nothing else', toneUses.sort().join() === 'dot:tone,value:hot,value:tone', toneUses.join());
  check('SB3: no face sparkline left in the module', !/faceSpark|pulse-face-spark|\bFACE\b/.test(CODE) && CODE.split('sparkGeometry(').length === 2 && /sparkGeometry\(vals, SHEET/.test(SRC));
  check('S14: the arrow returns nothing at zero', /d === null \|\| d === 0\) return null/.test(SRC) && !/– 0/.test(CODE));
  check('lower_is_better comes from the payload first', /arr\(data\.lower_is_better\)/.test(SRC) && /LOWER_DEFAULT = \['position', 'err5xx_pct'\]/.test(SRC));
  check('the footer links go through extLink (safeUrl)', /extLink\(href, label/.test(SRC));
  check('SB11: the age limit is one named constant, six days', /const WEEK_MAX_AGE = 6;/.test(SRC) && /age > WEEK_MAX_AGE/.test(SRC));

  // -- stylesheet ------------------------------------------------------------
  console.log('\nstylesheet');
  {
    const start = CSS.indexOf('/* ------------------------------------------------------------ wss_traffic');
    const end = CSS.indexOf('/wss_traffic */', start);
    const block = CSS.slice(start, end);
    const bare = block.replace(/\/\*[\s\S]*?\*\//g, '');
    check('the Site Pulse block exists', start > 0 && end > start);
    check('S3/SB4: no rule in it mentions a day-over-day or previous-7 field', !/dod|delta|prev/.test(bare));
    const scoped = [...CSS.matchAll(/\.card\[data-tile="wss_traffic"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('');
    check('no .card[data-tile="wss_traffic"] rule mentions dod or delta', !/dod|delta/.test(scoped));
    const rules = [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const toned = rules.filter((r) => /var\(--(good|warn|bad)\)/.test(r.body));
    check('--good/--warn/--bad appear only on .pulse-dot-* and .pulse-value-* rules', toned.length === 6 && toned.every((r) => /^\.pulse-(dot|value)-(good|warn|bad)$/.test(r.sel)), toned.map((r) => r.sel).join(','));
    check('the arrow, the prev/avg line and the gap line name no tone token', rules.filter((r) => /pulse-(arrow|sub7|gap|weekly-na|foot)/.test(r.sel)).every((r) => !/--(good|warn|bad|info|brass)/.test(r.body)));
    check('the prev/avg line is faint text', /\.pulse-sub7 \{[^}]*color: var\(--text-faint\)/.test(block));
    check('the row grid: 8px dot · 1fr label · value · 52px arrow', /\.pulse-line \{[^}]*grid-template-columns: 8px minmax\(0, 1fr\) auto 52px/.test(block));
    check('no face sparkline rules remain', !/\.pulse-(face-spark|face-line|spark-now-|spark-cell)/.test(bare));
    check('no v1.1 face rules remain', !/\.pulse-(cell|cells|grid|seg|marks|ind|sep)\b/.test(block));
    check('no rule elsewhere in the stylesheet tones a pulse class', ![...CSS.slice(0, start).matchAll(/([^{}]+)\{([^}]*)\}/g)].some((m) => /pulse-/.test(m[1])));
    check('no colour literal but a black shadow', !/#[0-9a-f]{3,8}\b/i.test(block) && [...block.matchAll(/rgba?\(([^)]*)\)/g)].every((m) => /^0,\s*0,\s*0/.test(m[1])));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
