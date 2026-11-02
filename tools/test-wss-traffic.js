#!/usr/bin/env node
/**
 * The Helm — wss_traffic ("Site Pulse"). Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-wss-traffic.js
 *
 * Vault spec `Site-Pulse-Tile-Spec.md`, S1–S10. The rulings with teeth:
 *
 *   S3  two indicators, two jobs — the arrow is day-over-day and never
 *       coloured; the dot is `ratio` against the same-weekday baseline, and
 *       nothing that chooses a colour reads the day-over-day field. Held at
 *       the DOM, in the module source and in the stylesheet.
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
  const cellsOf = (root) => root.querySelectorAll('.pulse-cell');
  const dotIn = (node) => node.querySelectorAll('.pulse-dot').map(cls);

  // -- the registry ------------------------------------------------------------
  console.log('\nregistry');
  const REG = read('docs', 'tiles', '_registry.js');
  check(
    'S1: wss_traffic, DAILY, position 132, 📈 Site Pulse',
    /wss_traffic:\s*\{\s*band:\s*'DAILY',\s*position:\s*132,\s*module:\s*'\.\/tiles\/wss_traffic\.js',\s*title:\s*'📈 Site Pulse'/.test(REG)
  );
  const { REGISTRY } = await import('../docs/tiles/_registry.js');
  check('Crew Tape 130 and Watch Bill 135 did not move', REGISTRY.wss_tape.position === 130 && REGISTRY.watch_bill.position === 135);
  check('the SW precaches the module', /'\.\/tiles\/wss_traffic\.js'/.test(read('docs', 'sw.js')));
  check('CACHE_VERSION is helm-v64', /CACHE_VERSION = 'helm-v64'/.test(read('docs', 'sw.js')));
  check('APP_VERSION is 1.43.0', /APP_VERSION = '1\.43\.0'/.test(read('docs', 'config.js')));

  // -- the clean face ------------------------------------------------------------
  console.log('\nthe face — a clean day');
  const { root } = render(clean);
  const cells = cellsOf(root);
  check('four cells', cells.length === 4, String(cells.length));
  const labels = cells.map((c) => c.querySelector('.pulse-label').textContent);
  check('in S2 order', labels.join('|') === 'Sessions|Leads · Carts|Organic clicks|Impressions', labels.join('|'));
  check('sessions prints its value', cells[0].querySelector('.pulse-value').textContent === '87');
  check('leads · carts is one cell, "3 · 1"', cells[1].querySelector('.pulse-value').textContent === '3 · 1');
  check('clicks and impressions print theirs', cells[2].querySelector('.pulse-value').textContent === '27' && cells[3].querySelector('.pulse-value').textContent === '2,210');

  const chips = root.querySelectorAll('.pulse-date');
  check('two date chips', chips.length === 2, String(chips.length));
  check('the GA4 chip is the GA4 block’s own date', chips[0].textContent === shortDay(D.latest.ga4.date), chips[0].textContent);
  check('the GSC chip is the GSC block’s own date', chips[1].textContent === shortDay(D.latest.gsc.date), chips[1].textContent);
  check('S4: the fixture’s GSC date is older than GA4’s, and the chips differ', D.latest.gsc.date < D.latest.ga4.date && chips[0].textContent !== chips[1].textContent);
  check('S4: the GSC chip says why', chips[1].getAttribute('title') === 'Search Console reports 2–3 days behind');
  check('the GA4 chip carries no lag note', !chips[0].getAttribute('title'));

  check('sessions at 0.66 → warn', dotIn(cells[0]).join() === 'pulse-dot pulse-dot-warn', dotIn(cells[0]).join());
  check('leads at null → hollow, carts at 1.0 → good', dotIn(cells[1]).join('|') === 'pulse-dot pulse-dot-none|pulse-dot pulse-dot-good', dotIn(cells[1]).join('|'));
  check('the hollow dot says "no baseline yet"', cells[1].querySelector('.pulse-dot-none').getAttribute('title') === 'no baseline yet');
  check('clicks at 0.55 → bad', dotIn(cells[2]).join() === 'pulse-dot pulse-dot-bad', dotIn(cells[2]).join());
  check('impressions at 1.0 → good', dotIn(cells[3]).join() === 'pulse-dot pulse-dot-good');

  const arrows = root.querySelectorAll('.pulse-arrow').map((n) => n.textContent);
  check('arrows print the delta as given: ▼ 9 · ▲ 2 · – 0 · ▼ 21 · ▲ 12', arrows.slice(0, 5).join(' | ') === '▼ 9 | ▲ 2 | – 0 | ▼ 21 | ▲ 12', arrows.join(' | '));
  check('every arrow wears the one plain class — no tone', root.querySelectorAll('.pulse-arrow').every((n) => cls(n) === 'pulse-arrow'));

  const sub = root.querySelector('.pulse-sub');
  check('the muted line: CTR · Pos · 5xx', /^CTR 2\.3%.*Pos 11\.2.*5xx 0%/.test(sub.textContent), sub.textContent);
  const segs = sub.querySelectorAll('.pulse-seg');
  check('position at 1.4, lower is better → warn (would be good un-inverted)', dotIn(segs[1]).join() === 'pulse-dot pulse-dot-warn', dotIn(segs[1]).join());
  check('5xx has no baseline → hollow', dotIn(segs[2]).join() === 'pulse-dot pulse-dot-none');
  check('no source is down', root.querySelectorAll('.pulse-src-down').length === 0);

  const face = root.querySelector('.pulse-face');
  check('the face is a role=button div, focusable', face.tagName === 'DIV' && face.getAttribute('role') === 'button' && face.getAttribute('tabindex') === '0');
  check('S8: no buttons and no links on the face', root.querySelectorAll('button').length === 0 && root.querySelectorAll('a').length === 0);
  check('S8: no dollar sign on the face', !root.textContent.includes('$'));

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

  // -- S3: the dot never reads dod --------------------------------------------
  console.log('\nS3 — the dot is the ratio, the arrow is the movement');
  {
    const a = clone(clean);
    a.data.latest.ga4.sessions = { value: 87, dod: -500, baseline: 87, ratio: 1.0 };
    const b = clone(clean);
    b.data.latest.ga4.sessions = { value: 87, dod: 500, baseline: 87, ratio: 1.0 };
    const c = clone(clean);
    c.data.latest.ga4.sessions = { value: 87, dod: 500, baseline: 300, ratio: 0.29 };
    const da = dotIn(cellsOf(render(a).root)[0]).join();
    const db = dotIn(cellsOf(render(b).root)[0]).join();
    const dc = dotIn(cellsOf(render(c).root)[0]).join();
    check('a crash day-over-day at ratio 1.0 is still green', da === 'pulse-dot pulse-dot-good', da);
    check('and identical to a surge at ratio 1.0', da === db);
    check('a surge day-over-day at ratio 0.29 is red', dc === 'pulse-dot pulse-dot-bad', dc);
    const sa = cellsOf(render(a).root)[0].querySelector('.pulse-arrow');
    const sb = cellsOf(render(b).root)[0].querySelector('.pulse-arrow');
    check('the arrows differ (▼ 500 / ▲ 500) with the same class', sa.textContent === '▼ 500' && sb.textContent === '▲ 500' && cls(sa) === cls(sb));
    const nod = clone(clean);
    delete nod.data.latest.ga4.sessions.dod;
    check('no dod → no arrow, the dot stays', cellsOf(render(nod).root)[0].querySelectorAll('.pulse-arrow').length === 0 && dotIn(cellsOf(render(nod).root)[0]).length === 1);
  }

  // -- S4: equal dates ------------------------------------------------------------
  console.log('\nS4 — the dates');
  {
    const same = clone(clean);
    same.data.latest.gsc.date = same.data.latest.ga4.date;
    const ch = render(same).root.querySelectorAll('.pulse-date');
    check('same date → same chip text and no lag tooltip', ch[0].textContent === ch[1].textContent && !ch[1].getAttribute('title'));
    const noGsc = clone(clean);
    noGsc.data.latest.gsc = null;
    const r = render(noGsc).root;
    check('a missing GSC block → one chip, its cells print —, nothing thrown', r.querySelectorAll('.pulse-date').length === 1 && cellsOf(r)[2].querySelector('.pulse-value').textContent === '—');
  }

  // -- S6: a greyed source ------------------------------------------------------------
  console.log('\nS6 — Search Console down');
  {
    const down = mockFile('pulse-gsc-down.json').tiles.wss_traffic;
    const r = render(down).root;
    const g = groupOf(r, 'gsc');
    const gCells = g.querySelectorAll('.pulse-cell');
    check('its cells are greyed in place', gCells.length === 2 && gCells.every((c) => c.classList.contains('pulse-cell-grey')));
    check('no numbers in its cells', gCells.every((c) => !/\d/.test(c.textContent)), gCells.map((c) => c.textContent).join(' / '));
    check('never a zero: the value reads —', gCells.every((c) => c.querySelector('.pulse-value').textContent === '—'));
    const line = g.querySelector('.pulse-src-down');
    const want = `GSC · last good ${shortDay(down.data.sources_status.gsc.last_good)} · 403 permission`;
    check('the status line: source · last good · why', line && line.textContent === want, line && line.textContent);
    check('five newest days missing → its dots are ⚫', dotIn(g).length === 2 && dotIn(g).every((c) => c === 'pulse-dot pulse-dot-dead'), dotIn(g).join());
    const segs = r.querySelector('.pulse-sub').querySelectorAll('.pulse-seg');
    check('CTR and Pos grey too, 5xx untouched', segs[0].classList.contains('pulse-seg-grey') && segs[1].classList.contains('pulse-seg-grey') && !segs[2].classList.contains('pulse-seg-grey'));
    check('CTR and Pos print no numbers', !/\d/.test(segs[0].textContent + segs[1].textContent), segs[0].textContent + segs[1].textContent);
    check('GA4 is unaffected', groupOf(r, 'ga4').querySelectorAll('.pulse-cell-grey').length === 0 && groupOf(r, 'ga4').querySelectorAll('.pulse-src-down').length === 0);
    check('the GA4 sessions dot still reads its ratio', dotIn(groupOf(r, 'ga4').querySelectorAll('.pulse-cell')[0]).join() === 'pulse-dot pulse-dot-warn');

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
      return rr.querySelectorAll('.pulse-cell-grey').length === 0 && rr.querySelectorAll('.pulse-dot-dead').length === 0;
    })());
    const noGood = clone(two);
    noGood.data.sources_status.gsc.last_good = null;
    check('never had a good pull → says so', groupOf(render(noGood).root, 'gsc').querySelector('.pulse-src-down').textContent === 'GSC · no good pull yet · timeout');
    const cfDown = clone(clean);
    cfDown.data.sources_status.cf = { ok: false, last_good: null, error: '403 token', failing_since: 'x' };
    cfDown.data.latest.cf = null;
    for (const d of cfDown.data.days) d.cf = null;
    const rc = render(cfDown).root;
    const lines = rc.querySelectorAll('.pulse-src-down').map((n) => n.textContent);
    check('Cloudflare down → its line under the muted row, 5xx greyed ⚫', lines.join() === 'CF · no good pull yet · 403 token' && dotIn(rc.querySelector('.pulse-sub').querySelectorAll('.pulse-seg')[2]).join() === 'pulse-dot pulse-dot-dead', lines.join());
  }

  // -- stale and empty ------------------------------------------------------------
  console.log('\nstale and empty');
  {
    const stale = mockFile('pulse-stale.json').tiles.wss_traffic;
    const r = render(stale).root;
    const chip = r.querySelector('.pulse-stale');
    check('stale → a chip "stale since {day}"', chip && chip.textContent === 'stale since ' + shortDay(stale.data.stale_since), chip && chip.textContent);
    check('stale still renders the last data — four cells', cellsOf(r).length === 4);
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
    h('stale with nothing parseable', { status: 'stale', generated_at: 5, days: [{ date: '2026-11-01', ga4: { sessions: { value: 1 } } }] }, 'stale');
    const s = render(tileOf({ status: 'ok', latest: { ga4: { date: '2026-11-01', sessions: { value: '87' } } }, days: [] })).root;
    check('a string where a number belongs prints —, never the string', cellsOf(s)[0].querySelector('.pulse-value').textContent === '—');
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
  const toneUses = [...SRC.matchAll(/pulse-dot-' \+ (\w+)/g)].map((m) => m[1]);
  check('the dot class is chosen in one place, from dotTone', toneUses.join() === 'tone' && /const tone = dead \? 'dead' : dotTone\(/.test(SRC), toneUses.join());
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
    check('--good/--warn/--bad appear only on .pulse-dot rules', toned.length === 3 && toned.every((r) => /^\.pulse-dot-(good|warn|bad)$/.test(r.sel)), toned.map((r) => r.sel).join(','));
    check('no rule elsewhere in the stylesheet tones a pulse class', ![...CSS.slice(0, start).matchAll(/([^{}]+)\{([^}]*)\}/g)].some((m) => /pulse-/.test(m[1])));
    check('no colour literal but a black shadow', !/#[0-9a-f]{3,8}\b/i.test(block) && [...block.matchAll(/rgba?\(([^)]*)\)/g)].every((m) => /^0,\s*0,\s*0/.test(m[1])));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
