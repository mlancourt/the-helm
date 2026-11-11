#!/usr/bin/env node
/**
 * The Helm — wss_traffic ("Site Pulse"). Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-wss-traffic.js
 *
 * Vault spec `Site-Pulse-Tile-Spec.md`, S1–S14. The rulings with teeth:
 *
 *   S3  two indicators, two jobs — the arrow is day-over-day and never
 *       coloured; the tone is `ratio` against the same-weekday baseline, and
 *       nothing that chooses a colour reads the day-over-day field. Held at
 *       the DOM, in the module source and in the stylesheet.
 *   S11 the face is rows in two dated groups; CTR · 5xx · CF in a footer.
 *   S12 the value wears the dot's tone — one dotTone(), one caller.
 *   S13 a 28-day sparkline per row off the sheet's own geometry.
 *   S14 zero is quiet: 0 · 0 leads/carts is one row, a zero delta no arrow.
 *   S4  each block wears its own date; GSC's lag is shown, never hidden.
 *   S6  a failed source greys in place with its last good date and why;
 *       three newest days missing turns its dots black.
 *   S8  no dollar sign anywhere in the module; no buttons on the face.
 *   S9  an unknown metric surfaces under its own key.
 *   S10 the page computes no baseline, no ratio and no middle value.
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
  const { shortDay } = await import('../docs/lib/fmt.js');
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
  const groupOf = (root, src) => root.querySelector('.pulse-group-' + src);
  const linesOf = (root) => root.querySelectorAll('.pulse-line');
  const lineOf = (root, key) => root.querySelector('.pulse-line-' + key);
  const valueOf = (root, key) => lineOf(root, key).querySelector('.pulse-value');
  const dotIn = (node) => node.querySelectorAll('.pulse-dot').map(cls);
  const LAG = ' · lags 2–3 days';

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
    check('CACHE_VERSION is at least helm-v67', cv >= 67, String(cv));
    check('APP_VERSION is at least 1.44.0', av[0] > 1 || (av[0] === 1 && av[1] >= 44), av.join('.'));
  }

  // -- the clean face ------------------------------------------------------------
  console.log('\nthe face — rows in two dated groups (S11)');
  const { root } = render(clean);
  check('no v1.1 cells or sub-line remain', root.querySelectorAll('.pulse-cell').length === 0 && root.querySelectorAll('.pulse-sub').length === 0);
  const heads = root.querySelectorAll('.pulse-group-head');
  check('two group heads', heads.length === 2, String(heads.length));
  check('heads read GA4 then Search Console', heads.map((h) => h.querySelector('.pulse-group-name').textContent).join('|') === 'GA4|Search Console');
  const dates = root.querySelectorAll('.pulse-date');
  check('the GA4 head wears the GA4 block’s own date, no suffix', dates[0].textContent === shortDay(D.latest.ga4.date) && !dates[0].getAttribute('title'), dates[0].textContent);
  check('S4: the GSC head wears its own date + the lag suffix', dates[1].textContent === shortDay(D.latest.gsc.date) + LAG, dates[1].textContent);
  check('S4: the fixture’s GSC date is older than GA4’s', D.latest.gsc.date < D.latest.ga4.date);
  check('S4: the GSC date keeps its tooltip', dates[1].getAttribute('title') === 'Search Console reports 2–3 days behind');

  const lines = linesOf(root);
  const labels = lines.map((n) => n.querySelector('.pulse-label').textContent);
  check('six rows when carts > 0, in S11 order', labels.join('|') === 'Sessions|Leads|Carts|Organic clicks|Impressions|Avg position', labels.join('|'));
  check('GA4 rows sit in the GA4 group', groupOf(root, 'ga4').querySelectorAll('.pulse-line').length === 3);
  check('GSC rows sit in the GSC group', groupOf(root, 'gsc').querySelectorAll('.pulse-line').length === 3);
  check('every row is the same five cells', lines.every((n) => n.childNodes.length === 5 && n.childNodes.map(cls).slice(1).join('|').replace(/pulse-value [\w-]+/, 'pulse-value') === 'pulse-label|pulse-value|pulse-spark-cell|pulse-arrow-cell'));
  const vals = lines.map((n) => n.querySelector('.pulse-value').textContent);
  check('values print as given', vals.join('|') === '87|3|1|27|2,210|11.2', vals.join('|'));

  // S12: the value wears the tone.
  const vcls = (key) => cls(valueOf(root, key));
  check('sessions 0.66 → value warn', vcls('sessions') === 'pulse-value pulse-value-warn', vcls('sessions'));
  check('clicks 0.55 → value bad', vcls('clicks') === 'pulse-value pulse-value-bad', vcls('clicks'));
  check('impressions 1.0 → value good', vcls('impressions') === 'pulse-value pulse-value-good', vcls('impressions'));
  check('leads null → value none', vcls('leads') === 'pulse-value pulse-value-none', vcls('leads'));
  check('carts 1.0 → value good', vcls('carts') === 'pulse-value pulse-value-good');
  check('position 1.4, lower is better → value warn (would be good un-inverted)', vcls('position') === 'pulse-value pulse-value-warn', vcls('position'));
  check('every row’s dot and value wear the same tone', lines.every((n) => dotIn(n)[0].replace('pulse-dot pulse-dot-', '') === cls(n.querySelector('.pulse-value')).replace('pulse-value pulse-value-', '')));
  check('the hollow dot says "no baseline yet"', lineOf(root, 'leads').querySelector('.pulse-dot-none').getAttribute('title') === 'no baseline yet');

  // S3 + S14: the arrow — faint, last, and nothing at zero.
  const arrows = lines.map((n) => n.querySelector('.pulse-arrow-cell').textContent);
  check('arrows: ▼ 9 · ▲ 2 · (carts 0: nothing) · ▼ 21 · ▲ 12 · ▼ 1.4 (position slid 1.4 → ▼, lower is better)', arrows.join('|') === '▼ 9|▲ 2||▼ 21|▲ 12|▼ 1.4', arrows.join('|'));
  check('the position arrow says so in its tooltip', /lower is better/.test(lineOf(root, 'position').querySelector('.pulse-arrow').getAttribute('title')) && lineOf(root, 'sessions').querySelector('.pulse-arrow').getAttribute('title') === 'vs the day before');
  check('S14: a zero delta has no arrow node at all', lineOf(root, 'carts').querySelectorAll('.pulse-arrow').length === 0);
  check('no "– 0" anywhere on the face', !root.textContent.includes('– 0'));
  check('every arrow wears the one plain class — no tone', root.querySelectorAll('.pulse-arrow').every((n) => cls(n) === 'pulse-arrow'));

  // S13: the sparkline on the face.
  const faceSparks = (n) => n.querySelectorAll('svg');
  check('each row with ≥ 2 points has exactly one face sparkline', lines.every((n) => faceSparks(n).length === 1 && cls(faceSparks(n)[0]) === 'pulse-face-spark'));
  check('face sparklines are inline SVG', root.querySelectorAll('.pulse-face-spark').every((n) => n.namespaceURI === 'http://www.w3.org/2000/svg'));
  check('no baseline line and no label on the face', root.querySelectorAll('.pulse-spark-base').length === 0 && root.querySelectorAll('text').length === 0);
  check('the last point wears the row’s tone', lines.every((n) => {
    const c = n.querySelector('circle');
    return cls(c) === 'pulse-face-now pulse-spark-now-' + cls(n.querySelector('.pulse-value')).replace('pulse-value pulse-value-', '') && c.getAttribute('r') === '2.6';
  }));
  check('viewBox 96×22', root.querySelectorAll('.pulse-face-spark').every((n) => n.getAttribute('viewBox') === '0 0 96 22'));

  // S11: the footer.
  const foot = root.querySelector('.pulse-footline');
  check('footer: CTR · 5xx · CF date', foot && foot.textContent === 'CTR 2.3% · 5xx 0% · CF ' + shortDay(D.latest.cf.date), foot && foot.textContent);
  check('5xx at 0 → footer only, no row', !lineOf(root, 'err5xx_pct'));
  check('no source is down', root.querySelectorAll('.pulse-src-down').length === 0 && root.querySelectorAll('.pulse-group-grey').length === 0);

  const face = root.querySelector('.pulse-face');
  check('the face is a role=button div, focusable', face.tagName === 'DIV' && face.getAttribute('role') === 'button' && face.getAttribute('tabindex') === '0');
  check('S8: no buttons and no links on the face', root.querySelectorAll('button').length === 0 && root.querySelectorAll('a').length === 0);
  check('S8: no dollar sign on the face', !root.textContent.includes('$'));

  // -- S14: zero is quiet ---------------------------------------------------------
  console.log('\nS14 — zero is quiet');
  {
    const z = clone(clean);
    z.data.latest.ga4.leads = { value: 0, dod: -3, baseline: 1, ratio: 0 };
    z.data.latest.ga4.carts = { value: 0, dod: -1, baseline: 1, ratio: 0 };
    const r = render(z).root;
    const lb = linesOf(r).map((n) => n.querySelector('.pulse-label').textContent);
    check('both 0 → five rows, one "Leads · Carts"', lb.join('|') === 'Sessions|Leads · Carts|Organic clicks|Impressions|Avg position', lb.join('|'));
    const lc = lineOf(r, 'leads-carts');
    check('its value is "0 · 0", toneless', lc.querySelector('.pulse-value').textContent === '0 · 0' && cls(lc.querySelector('.pulse-value')) === 'pulse-value pulse-value-none');
    check('a hollow dot even at ratio 0', dotIn(lc).join() === 'pulse-dot pulse-dot-none');
    check('no sparkline, no arrow', lc.querySelectorAll('svg').length === 0 && lc.querySelectorAll('.pulse-arrow').length === 0);
    const one = clone(z);
    one.data.latest.ga4.carts.value = 2;
    const r1 = render(one).root;
    check('either > 0 → two normal rows', !!lineOf(r1, 'leads') && !!lineOf(r1, 'carts') && !lineOf(r1, 'leads-carts') && valueOf(r1, 'carts').textContent === '2');
    check('and a leads 0 at ratio 0 is bad like any other 0', cls(valueOf(r1, 'leads')) === 'pulse-value pulse-value-bad');
    const odd = clone(z);
    odd.data.latest.ga4.leads.value = '0';
    const r2 = render(odd).root;
    check('a non-numeric value falls through to two rows with —', !lineOf(r2, 'leads-carts') && valueOf(r2, 'leads').textContent === '—' && valueOf(r2, 'carts').textContent === '0');
  }

  // -- 5xx earns a row ------------------------------------------------------------
  console.log('\n5xx earns a row at the threshold');
  {
    const e = clone(clean);
    const below = clone(clean);
    below.data.latest.cf.err5xx_pct = { value: 0.002, dod: 0.002, baseline: 0, ratio: null };
    check('5xx at 0.002% (1 in 48k) → footer only, no row (S11 threshold)', !lineOf(render(below).root, 'err5xx_pct') && render(below).root.querySelector('.pulse-footline').textContent.includes('5xx 0.002%'));
    const edge = clone(clean);
    edge.data.latest.cf.err5xx_pct = { value: 0.5, dod: 0.5, baseline: 0.1, ratio: 5 };
    check('5xx at exactly 0.5% → a row', !!lineOf(render(edge).root, 'err5xx_pct'));
    e.data.latest.cf.err5xx_pct = { value: 0.6, dod: 0.6, baseline: 0.1, ratio: 6 };
    const r = render(e).root;
    const row = lineOf(r, 'err5xx_pct');
    check('a 5xx row appears', !!row && row.querySelector('.pulse-label').textContent === '5xx' && row.querySelector('.pulse-value').textContent === '0.6%');
    check('under the GA4 group, last', groupOf(r, 'ga4').querySelectorAll('.pulse-line').pop() === row);
    check('lower is better: ratio 6 → bad', cls(row.querySelector('.pulse-value')) === 'pulse-value pulse-value-bad');
    check('and the footer still reads it', r.querySelector('.pulse-footline').textContent.includes('5xx 0.6%'));
  }
  // -- dotTone: the one colour function ---------------------------------------
  console.log('\ndotTone');
  const T = mod.dotTone;
  const table = [
    ['sessions', 1.0, false, 'good'], ['sessions', 0.8, false, 'good'], ['sessions', 0.79, false, 'warn'],
    ['sessions', 0.66, false, 'warn'], ['sessions', 0.6, false, 'warn'], ['sessions', 0.59, false, 'bad'],
    ['sessions', 0.55, false, 'bad'], ['sessions', 2.4, false, 'good'], ['sessions', null, false, 'none'],
    ['sessions', '0.9', false, 'none'], ['sessions', NaN, false, 'none'], ['sessions', undefined, false, 'none'],
    ['position', 0.5, true, 'good'], ['position', 1.0, true, 'good'], ['position', 1.25, true, 'good'],
    ['position', 1.26, true, 'warn'], ['position', 1.67, true, 'warn'], ['position', 1.68, true, 'bad'],
    ['position', 0.55, true, 'good'], ['err5xx_pct', 3, true, 'bad'], ['position', null, true, 'none'],
  ];
  for (const [k, r, low, want] of table) {
    check(`${k} ${String(r)}${low ? ' (lower is better)' : ''} → ${want}`, T(k, r, low) === want, T(k, r, low));
  }

  // -- S3: the tone never reads dod --------------------------------------------
  console.log('\nS3 — the tone is the ratio, the arrow is the movement');
  {
    const a = clone(clean);
    a.data.latest.ga4.sessions = { value: 87, dod: -500, baseline: 87, ratio: 1.0 };
    const b = clone(clean);
    b.data.latest.ga4.sessions = { value: 87, dod: 500, baseline: 87, ratio: 1.0 };
    const c = clone(clean);
    c.data.latest.ga4.sessions = { value: 87, dod: 500, baseline: 300, ratio: 0.29 };
    const [ra, rb, rc] = [a, b, c].map((t) => lineOf(render(t).root, 'sessions'));
    check('a crash day-over-day at ratio 1.0 is still green', dotIn(ra).join() === 'pulse-dot pulse-dot-good' && cls(ra.querySelector('.pulse-value')) === 'pulse-value pulse-value-good');
    check('and identical to a surge at ratio 1.0 (dot, value, spark point)', ['.pulse-dot', '.pulse-value', 'circle'].every((q) => cls(ra.querySelector(q)) === cls(rb.querySelector(q))));
    check('a surge day-over-day at ratio 0.29 is red', dotIn(rc).join() === 'pulse-dot pulse-dot-bad' && cls(rc.querySelector('.pulse-value')) === 'pulse-value pulse-value-bad');
    const sa = ra.querySelector('.pulse-arrow');
    const sb = rb.querySelector('.pulse-arrow');
    check('the arrows differ (▼ 500 / ▲ 500) with the same class', sa.textContent === '▼ 500' && sb.textContent === '▲ 500' && cls(sa) === cls(sb));
    const nod = clone(clean);
    delete nod.data.latest.ga4.sessions.dod;
    const rn = lineOf(render(nod).root, 'sessions');
    check('no dod → no arrow, the dot stays', rn.querySelectorAll('.pulse-arrow').length === 0 && dotIn(rn).length === 1);
  }

  // -- S13: position inverted on the face ---------------------------------------
  console.log('\nS13 — the face sparkline');
  {
    const at = (newest, older) => {
      const t = clone(clean);
      t.data.days = t.data.days.slice(2, 4);
      t.data.days[0].gsc.position.value = newest;
      t.data.days[1].gsc.position.value = older;
      const ln = lineOf(render(t).root, 'position');
      const first = Number(ln.querySelector('path').getAttribute('d').match(/^M[\d.]+ ([\d.]+)/)[1]);
      return { first, last: Number(ln.querySelector('circle').getAttribute('cy')) };
    };
    const better = at(4, 12);
    const worse = at(12, 4);
    check('a better (lower) newest position sits higher than the older point', better.last < better.first, JSON.stringify(better));
    check('a worse (higher) newest position sits lower', worse.last > worse.first, JSON.stringify(worse));
    const up = clone(clean);
    up.data.days = up.data.days.slice(2, 4);
    up.data.days[0].ga4.sessions.value = 200;
    up.data.days[1].ga4.sessions.value = 50;
    const sl = lineOf(render(up).root, 'sessions');
    check('sessions is not inverted: more is higher', Number(sl.querySelector('circle').getAttribute('cy')) < Number(sl.querySelector('path').getAttribute('d').match(/^M[\d.]+ ([\d.]+)/)[1]));
    const one = clone(clean);
    one.data.days = one.data.days.slice(0, 1);
    check('days[] of 1 → no face sparkline anywhere', render(one).root.querySelectorAll('.pulse-face-spark').length === 0);
    const none = clone(clean);
    none.data.days = [];
    const rn = render(none).root;
    check('days[] empty → the rows still print, no sparklines', linesOf(rn).length === 6 && rn.querySelectorAll('svg').length === 0);
    const gap = clone(clean);
    gap.data.days = gap.data.days.slice(0, 3);
    gap.data.days[1].ga4 = null;
    const gd = lineOf(render(gap).root, 'sessions').querySelector('path').getAttribute('d');
    check('a gap lifts the pen on the face too', (gd.match(/M/g) || []).length === 2 && !/L/.test(gd), gd);
  }

  // -- S4: equal dates ------------------------------------------------------------
  console.log('\nS4 — the dates');
  {
    const same = clone(clean);
    same.data.latest.gsc.date = same.data.latest.ga4.date;
    const ch = render(same).root.querySelectorAll('.pulse-date');
    check('same date → same text, no lag suffix, no tooltip', ch[0].textContent === ch[1].textContent && !ch[1].textContent.includes('lags') && !ch[1].getAttribute('title'));
    const noGsc = clone(clean);
    noGsc.data.latest.gsc = null;
    const r = render(noGsc).root;
    check('a missing GSC block → one date, its rows print —, nothing thrown', r.querySelectorAll('.pulse-date').length === 1 && valueOf(r, 'clicks').textContent === '—' && valueOf(r, 'position').textContent === '—');
  }

  // -- S6: a greyed source ------------------------------------------------------------
  console.log('\nS6 — Search Console down');
  {
    const down = mockFile('pulse-gsc-down.json').tiles.wss_traffic;
    const r = render(down).root;
    const g = groupOf(r, 'gsc');
    const gl = g.querySelectorAll('.pulse-line');
    check('its group is greyed in place, three rows', g.classList.contains('pulse-group-grey') && gl.length === 3);
    check('no numbers in its rows', gl.every((c) => !/\d/.test(c.textContent)), gl.map((c) => c.textContent).join(' / '));
    check('never a zero: every value reads —', gl.every((c) => c.querySelector('.pulse-value').textContent === '—'));
    check('no sparkline and no arrow on a down source', g.querySelectorAll('svg').length === 0 && g.querySelectorAll('.pulse-arrow').length === 0);
    const line = g.querySelector('.pulse-src-down');
    const want = `GSC · last good ${shortDay(down.data.sources_status.gsc.last_good)} · 403 permission`;
    check('the status line: source · last good · why', line && line.textContent === want, line && line.textContent);
    check('five newest days missing → its dots are ⚫, values dead', dotIn(g).length === 3 && dotIn(g).every((c) => c === 'pulse-dot pulse-dot-dead') && gl.every((c) => cls(c.querySelector('.pulse-value')) === 'pulse-value pulse-value-dead'), dotIn(g).join());
    check('the footer’s CTR greys to —, its 5xx untouched', /^CTR — · 5xx 0%/.test(r.querySelector('.pulse-footline').textContent), r.querySelector('.pulse-footline').textContent);
    check('GA4 is unaffected', !groupOf(r, 'ga4').classList.contains('pulse-group-grey') && groupOf(r, 'ga4').querySelectorAll('.pulse-src-down').length === 0);
    check('the GA4 sessions row still reads its ratio', dotIn(lineOf(r, 'sessions')).join() === 'pulse-dot pulse-dot-warn');

    // Two newest days missing → hollow; three → black.
    const two = clone(clean);
    two.data.sources_status.gsc = { ok: false, last_good: two.data.latest.gsc.date, error: 'timeout' };
    const t2 = render(two).root;
    check('down with 2 null days → hollow dots, not black', dotIn(groupOf(t2, 'gsc')).every((c) => c === 'pulse-dot pulse-dot-none'), dotIn(groupOf(t2, 'gsc')).join());
    const three = clone(two);
    three.data.days[2].gsc = null;
    check('down with 3 null days → ⚫', dotIn(groupOf(render(three).root, 'gsc')).every((c) => c === 'pulse-dot pulse-dot-dead'));
    check('three null days while ok → no grey, no black (the lag is not a failure)', (() => {
      const lag = clone(clean);
      lag.data.days[2].gsc = null;
      const rr = render(lag).root;
      return rr.querySelectorAll('.pulse-group-grey').length === 0 && rr.querySelectorAll('.pulse-dot-dead').length === 0;
    })());
    const noGood = clone(two);
    noGood.data.sources_status.gsc.last_good = null;
    check('never had a good pull → says so', groupOf(render(noGood).root, 'gsc').querySelector('.pulse-src-down').textContent === 'GSC · no good pull yet · timeout');
    const cfDown = clone(clean);
    cfDown.data.sources_status.cf = { ok: false, last_good: null, error: '403 token', failing_since: 'x' };
    cfDown.data.latest.cf = null;
    for (const d of cfDown.data.days) d.cf = null;
    const rc = render(cfDown).root;
    const downLines = rc.querySelectorAll('.pulse-src-down').map((n) => n.textContent);
    check('Cloudflare down → its line under the footer, 5xx — and no CF date', downLines.join() === 'CF · no good pull yet · 403 token' && rc.querySelector('.pulse-footline').textContent === 'CTR 2.3% · 5xx —', downLines.join() + ' / ' + rc.querySelector('.pulse-footline').textContent);
    const cfHot = clone(cfDown);
    cfHot.data.latest.cf = { date: D.latest.cf.date, err5xx_pct: { value: 3, ratio: 9 } };
    check('a down Cloudflare never earns a 5xx row', !lineOf(render(cfHot).root, 'err5xx_pct'));
  }

  // -- stale and empty ------------------------------------------------------------
  console.log('\nstale and empty');
  {
    const stale = mockFile('pulse-stale.json').tiles.wss_traffic;
    const r = render(stale).root;
    const chip = r.querySelector('.pulse-stale');
    check('stale → a chip "stale since {day}"', chip && chip.textContent === 'stale since ' + shortDay(stale.data.stale_since), chip && chip.textContent);
    check('stale still renders the last data — its rows', linesOf(r).length === 6);
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
    check('the full fixture draws every section', secs.join(' ') === 'pulse-sec-sparks pulse-sec-err pulse-sec-queries pulse-sec-pages pulse-sec-channels pulse-sec-last7', secs.join(' '));
    const sparks = body.querySelectorAll('.pulse-spark-wrap');
    check('four sparklines, in order', sparks.map((s) => s.querySelector('.pulse-spark-name').textContent).join('|') === 'Sessions|Organic clicks|Impressions|Avg position · up is better');
    check('each is an inline SVG (svgEl, no library)', body.querySelectorAll('.pulse-spark').every((s) => s.namespaceURI === 'http://www.w3.org/2000/svg'));
    check('each with a dotted baseline at the latest baseline', body.querySelectorAll('.pulse-spark-base').length === 4);
    const lastLabels = body.querySelectorAll('.pulse-spark-label').map((n) => n.textContent);
    check('each last value labelled', lastLabels.join('|') === '87|27|2,210|11.2', lastLabels.join('|'));
    // Position inverted: a lower (better) position sits higher (smaller y).
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

    // Thin: GA4 days only, nothing else → sparks (sessions only) + last 7, nothing more.
    const thin = { status: 'ok', latest: { ga4: clone(D.latest.ga4) }, days: D.days.slice(0, 4).map((d) => ({ date: d.date, ga4: clone(d.ga4) })) };
    const tb = render(tileOf(thin)).sheet();
    const tsecs = tb.querySelectorAll('.pulse-sec').map((s) => cls(s).split(' ')[1]);
    check('a thin fixture draws exactly the sections it has data for', tsecs.join(' ') === 'pulse-sec-sparks pulse-sec-last7', tsecs.join(' '));
    check('and one sparkline', tb.querySelectorAll('.pulse-spark-wrap').length === 1);
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
    h('a bad date string', { status: 'ok', latest: { ga4: { date: 'yesterday', sessions: { value: 1 } } }, days: [{ date: 'yesterday', ga4: { sessions: { value: 1 } } }] });
    h('days[] of 1', { ...clone(D), days: clone(D.days.slice(0, 1)) });
    h('days[] empty with a full latest', { ...clone(D), days: [] });
    h('leads/carts as strings', { status: 'ok', latest: { ga4: { date: '2026-11-01', leads: { value: 'none' }, carts: { value: 0 } } }, days: [] });
    h('5xx as a string', { status: 'ok', latest: { cf: { date: '2026-11-01', err5xx_pct: { value: '2' } } }, days: [] });
    h('stale with nothing parseable', { status: 'stale', generated_at: 5, days: [{ date: '2026-11-01', ga4: { sessions: { value: 1 } } }] }, 'stale');
    const s = render(tileOf({ status: 'ok', latest: { ga4: { date: '2026-11-01', sessions: { value: '87' } } }, days: [] })).root;
    check('a string where a number belongs prints —, never the string', valueOf(s, 'sessions').textContent === '—');
    const neg = render(tileOf({ status: 'ok', latest: { ga4: { date: '2026-11-01', sessions: { value: 5 } } }, days: [], lower_is_better: 'position' })).root;
    check('a non-array lower_is_better falls back to position + err5xx_pct', !!neg);
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
      render(mockFile('pulse-gsc-down.json').tiles.wss_traffic).sheet();
      render(mockFile('pulse-stale.json').tiles.wss_traffic).sheet();
    } finally {
      global.Date = Real;
    }
    check('a full face + sheet render builds no Date from a string', stringDates === 0, String(stringDates));
  }

  // -- source scans ------------------------------------------------------------
  console.log('\nsource scans');
  check('S8: no dollar sign anywhere in the module', !SRC.includes('$'));
  check('rule 10: no innerHTML', !/innerHTML/.test(SRC));
  check('rule 7: no new Date(', !/new Date\(/.test(SRC));
  check('rule 7: no Date.parse', !/Date\.parse/.test(SRC));
  check('S10: no median', !/median/i.test(SRC));
  check('S10: no baseline computed', !/baseline\s*=[^=]/.test(SRC));
  check('S10: no ratio computed', !/ratio\s*=[^=]/.test(SRC));
  check('S10: no reductions over days[]', !/\.reduce\(/.test(SRC));
  const aStart = SRC.indexOf('function arrow(');
  const aEnd = SRC.indexOf('\nfunction ', aStart + 1);
  const outside = SRC.slice(0, aStart) + SRC.slice(aEnd);
  check('S3: `dod` appears only inside arrow()', aStart > 0 && aEnd > aStart && /dod/.test(SRC.slice(aStart, aEnd)) && !/dod/.test(outside));
  const toneUses = [...SRC.matchAll(/pulse-(dot|value|spark-now)-' \+ (\w+)/g)].map((m) => m[1] + ':' + m[2]);
  check('dot, value and spark point each take `tone`, nothing else', toneUses.sort().join() === 'dot:tone,spark-now:tone,value:tone', toneUses.join());
  check('toneOf is dotTone’s one caller', /return dead \? 'dead' : dotTone\(/.test(SRC) && CODE.split('dotTone(').length === 3, String(CODE.split('dotTone(').length));
  // B30 moved the geometry to lib/spark.js (bets_live's sweat line shares it):
  // still ONE definition, imported here and called by the face and the sheet.
  check('S13: one sparkline geometry, called by face and sheet', CODE.split('sparkGeometry(').length === 3 && /import \{ sparkGeometry \} from '\.\.\/lib\/spark\.js'/.test(SRC) && !/function sparkGeometry/.test(SRC) && /faceSpark[\s\S]*sparkGeometry\(vals, FACE/.test(SRC) && /sparkGeometry\(vals, SHEET/.test(SRC));
  check('S14: the arrow returns nothing at zero', /d === null \|\| d === 0\) return null/.test(SRC) && !/– 0/.test(CODE));
  const dtStart = SRC.indexOf('export function dotTone(');
  const dtBody = SRC.slice(dtStart, SRC.indexOf('\n}\n', dtStart));
  check('dotTone reads ratio only', dtStart > 0 && !/dod|value|baseline/.test(dtBody.replace(/^.*\n/, '')));
  check('lower_is_better comes from the payload first', /arr\(data\.lower_is_better\)/.test(SRC) && /LOWER_DEFAULT = \['position', 'err5xx_pct'\]/.test(SRC));
  check('dates go through shortDay', /import \{ shortDay \} from '\.\.\/lib\/fmt\.js'/.test(SRC));
  check('the footer links go through extLink (safeUrl)', /extLink\(href, label/.test(SRC));

  // -- stylesheet ------------------------------------------------------------
  console.log('\nstylesheet');
  {
    const start = CSS.indexOf('/* ------------------------------------------------------------ wss_traffic');
    const end = CSS.indexOf('/wss_traffic */', start);
    const block = CSS.slice(start, end);
    check('the Site Pulse block exists', start > 0 && end > start);
    check('S3: no rule in it mentions dod', !/dod/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')));
    const scoped = [...CSS.matchAll(/\.card\[data-tile="wss_traffic"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('');
    check('no .card[data-tile="wss_traffic"] rule mentions dod', !/dod/.test(scoped));
    const rules = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const toned = rules.filter((r) => /var\(--(good|warn|bad)\)/.test(r.body));
    check('--good/--warn/--bad appear only on .pulse-dot-*, .pulse-value-* and .pulse-spark-now-* rules', toned.length === 9 && toned.every((r) => /^\.pulse-(dot|value|spark-now)-(good|warn|bad)$/.test(r.sel)), toned.map((r) => r.sel).join(','));
    check('the arrow rule names no tone token', rules.filter((r) => /pulse-arrow/.test(r.sel)).every((r) => !/--(good|warn|bad|info|brass)/.test(r.body)));
    check('the face sparkline stroke is --text-faint 1.4', /\.pulse-face-line \{[^}]*stroke: var\(--text-faint\); stroke-width: 1\.4/.test(block));
    check('the row grid: 8px dot · 1fr label · value · 96px spark · 52px arrow', /\.pulse-line \{[^}]*grid-template-columns: 8px minmax\(0, 1fr\) auto 96px 52px/.test(block));
    check('under 340px the sparkline column goes', /@media \(max-width: 339px\)[\s\S]*?\.pulse-spark-cell \{ display: none; \}/.test(block));
    check('no v1.1 face rules remain', !/\.pulse-(cell|cells|grid|sub|seg|marks|ind|sep)\b/.test(block));
    check('no rule elsewhere in the stylesheet tones a pulse class', ![...CSS.slice(0, start).matchAll(/([^{}]+)\{([^}]*)\}/g)].some((m) => /pulse-/.test(m[1])));
    check('no colour literal but a black shadow', !/#[0-9a-f]{3,8}\b/i.test(block) && [...block.matchAll(/rgba?\(([^)]*)\)/g)].every((m) => /^0,\s*0,\s*0/.test(m[1])));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
