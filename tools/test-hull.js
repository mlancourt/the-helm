#!/usr/bin/env node
/**
 * The Helm — ship_status's hull panel. Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-hull.js
 *
 * The panel is an annunciator: a fixed grid of lamps learned by position. The
 * rulings under test:
 *
 *   H3  crew and vitals render in PAYLOAD ORDER — a red lamp turns red where
 *       it always sits.
 *   H5  tone is the engine's. The page maps `tone` to a class and weighs no
 *       number: not percent_free, not last_secs, not load, not an age.
 *   H8  the one exception — the heartbeat lamp is the age of
 *       `worker_published_at` through `freshnessTone(iso, 3, 12)`, because the
 *       engine cannot report its own absence.
 *
 * Held at the DOM and at the source, the same two ways as the plan meter.
 */

const fs = require('node:fs');
const path = require('node:path');
const { El, all } = require('./dom-shim.js');

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

const textOf = (node) => node.textContent;
const countOf = (node, cls) => node.querySelectorAll('.' + cls).length;
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const tap = (node) => node.listeners.click[0]({ stopPropagation() {} });
const isoAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

const job = (id, over = {}) => ({
  id: `com.lannyai.${id}`,
  label: id,
  kind: 'timer',
  state: 'ok',
  tone: 'good',
  every: 'every 1h',
  last_exit: 0,
  pid: null,
  last_seen_at: isoAgo(0.5),
  last_secs: 47,
  last_line: `${id}: finished rc=0`,
  ...over,
});

(async () => {
  const ship = await import('../docs/tiles/ship_status.js');
  const mock = JSON.parse(read('docs', 'mock', 'helm-data.json'));
  const render = (data) => {
    const root = new El('div');
    ship.render(root, { band: 'DAILY', status: 'ok', data }, { id: 'ship_status', actions: {} });
    return root;
  };
  const hullTile = (hull, extra = {}) => render({ worker_published_at: isoAgo(0.1), hull, ...extra });

  // -- the mock fixture ------------------------------------------------------
  console.log('\nhull — the mock fixture');
  const fixture = mock.tiles.ship_status.data;
  const root = render(fixture);
  const lamps = root.querySelectorAll('.hull-lamp');
  check('seven lamps', lamps.length === 7, String(lamps.length));
  const labels = lamps.map((l) => l.querySelector('.hull-lamp-label').textContent);
  const expected = fixture.hull.crew.map((c) => c.label);
  check('in payload order', labels.join('|') === expected.join('|'), labels.join('|'));
  check('five vital cells', countOf(root, 'hull-cell') === 5, String(countOf(root, 'hull-cell')));
  const vLabels = root.querySelectorAll('.hull-cell-label').map((n) => n.textContent);
  check('vitals in payload order', vLabels.join('|') === fixture.hull.vitals.map((v) => v.label).join('|'), vLabels.join('|'));
  check('producers chip reads 15/15', root.querySelector('.hull-chip').textContent === '15/15');
  check('and wears the good tone', countOf(root, 'hull-chip-good') === 1);
  check('the panel sits at the top of the card', root.childNodes[0].className === 'hull');
  check('the header names the host', /^Hull · mock-mini$/.test(root.querySelector('.hull-title').textContent));
  check('the stale lamp is warn', lamps[4].className.includes('hull-lamp-warn'));
  check('its second line says stale in place of a run time', lamps[4].querySelector('.hull-lamp-sub').textContent === 'every 10m · stale', lamps[4].querySelector('.hull-lamp-sub').textContent);
  check('an idle lamp says idle', lamps[5].querySelector('.hull-lamp-sub').textContent === 'on demand · idle');
  check('an ok lamp carries its run time', lamps[0].querySelector('.hull-lamp-sub').textContent === 'every 1h · 47s');
  check('a null last_secs prints no "· Ns"', lamps[1].querySelector('.hull-lamp-sub').textContent === '13×/day 07:05–19:05');
  check('hull never lands in the extras row', !/Also reported/.test(textOf(root)));
  check('no "null", "undefined" or "Invalid Date" anywhere', !/\bnull\b|undefined|Invalid Date|NaN/.test(textOf(root.querySelector('.hull'))));
  check('there is one tile-foot, not two', countOf(root, 'tile-foot') === 1);

  // -- vitals: dots, detail, backup -----------------------------------------
  console.log('\nhull — vitals');
  const cells = root.querySelectorAll('.hull-cell');
  const dotIn = (c) => c.querySelectorAll('.hull-dot').length;
  check('no dot on a neutral uptime', dotIn(cells[0]) === 0);
  check('no dot on a good disk', dotIn(cells[2]) === 0);
  check('backup always carries its dot', dotIn(cells[3]) === 1);
  check('tailscale always carries its dot', dotIn(cells[4]) === 1);
  check('detail rides on the title', cells[2].getAttribute('title') === '49% of 245 GB free');
  check('backup prints an age, not the instant', /ago$|just now/.test(cells[3].querySelector('.hull-cell-value').textContent) && !/Z$/.test(cells[3].textContent));
  check('other values are verbatim', cells[2].querySelector('.hull-cell-value').textContent === '120 GB free');

  const warnVit = hullTile({ state: 'ok', crew: [], vitals: [{ id: 'disk', label: 'Disk', value: '4 GB free', tone: 'bad', percent_free: 2 }] });
  check('a bad disk gets a bad dot', countOf(warnVit, 'hull-dot-bad') === 1);

  const noteVit = hullTile({ state: 'ok', crew: [], vitals: [
    { id: 'backup', label: 'Time Machine', value: null, tone: 'bad', note: 'tmutil did not answer' },
    { id: 'load', label: 'Load', value: '?', tone: 'neutral', note: 'sysctl refused' },
    { id: 'uptime', label: 'Uptime', value: null, tone: 'neutral' },
  ] });
  const nText = textOf(noteVit.querySelector('.hull-vitals'));
  check('a note replaces a null value', /tmutil did not answer/.test(nText));
  check('a note replaces a "?" value', /sysctl refused/.test(nText) && !/\?/.test(nText));
  check('and is muted', countOf(noteVit, 'hull-cell-note') === 3);
  check('no "null" and no "Invalid Date"', !/null|Invalid Date|NaN|undefined/.test(nText), nText);

  // -- tone: unknown, failed, running ----------------------------------------
  console.log('\nhull — tone');
  let threw = null;
  let purple;
  try { purple = hullTile({ state: 'ok', crew: [job('odd', { tone: 'purple' })], vitals: [{ id: 'load', label: 'Load', value: '1', tone: 'purple' }] }); } catch (e) { threw = e; }
  check('an unknown tone does not throw', !threw, threw && threw.message);
  check('an unknown tone renders neutral', purple && countOf(purple, 'hull-lamp-neutral') === 1 && !all(purple).some((n) => /purple/.test(n.className)));

  const failed = hullTile({ state: 'ok', crew: [job('broke', { state: 'failed', tone: 'bad', last_exit: 1, last_line: 'broke: traceback' })], vitals: [] });
  const fLamp = failed.querySelector('.hull-lamp');
  check('a failed lamp is classed bad', fLamp.className.includes('hull-lamp-bad'));
  check('and says failed', /· failed$/.test(fLamp.querySelector('.hull-lamp-sub').textContent));
  check('the detail line starts empty', failed.querySelector('.hull-detail').textContent === '');
  tap(fLamp);
  const fDetail = failed.querySelector('.hull-detail').textContent;
  check('tap → detail carries the log line', /^broke: traceback · last seen /.test(fDetail), fDetail);
  check('and the exit code', /exit 1$/.test(fDetail), fDetail);
  tap(fLamp);
  check('tapping the open lamp closes it', failed.querySelector('.hull-detail').textContent === '');

  const two = hullTile({ state: 'ok', crew: [job('a'), job('b', { last_exit: 0 })], vitals: [] });
  const [la, lb] = two.querySelectorAll('.hull-lamp');
  tap(la); tap(lb);
  check('one open at a time', la.getAttribute('aria-expanded') === 'false' && lb.getAttribute('aria-expanded') === 'true');
  check('a zero exit is not printed', !/exit/.test(two.querySelector('.hull-detail').textContent));

  const never = hullTile({ state: 'ok', crew: [job('t', { last_line: null, last_seen_at: null })], vitals: [] });
  tap(never.querySelector('.hull-lamp'));
  check('no line and no sighting reads "no run recorded"', never.querySelector('.hull-detail').textContent === 'no run recorded');

  const hostile = hullTile({ state: 'ok', crew: [job('x', { last_line: '<img src=x onerror=alert(1)>' })], vitals: [] });
  tap(hostile.querySelector('.hull-lamp'));
  check('last_line is text, never markup', /<img src=x/.test(hostile.querySelector('.hull-detail').textContent) && countOf(hostile, 'img') === 0);

  const running = hullTile({ state: 'ok', crew: [job('r', { state: 'running', pid: 4242 })], vitals: [] });
  check('a running lamp pulses', countOf(running, 'hull-pulse') === 1);
  check('only running lamps pulse', countOf(root, 'hull-pulse') === 0);

  const CSS = read('docs', 'style.css');
  check('the pulse is ~2 s', /\.hull-pulse \{ animation: hull-pulse 2s /.test(CSS));
  check('reduced motion turns it off', /@media \(prefers-reduced-motion: reduce\) \{\s*\.hull-pulse \{ animation: none; \}/.test(CSS));
  const HULL_CSS = CSS.split('\n').filter((l) => /\.hull-/.test(l) || /hull-pulse/.test(l)).join('\n');
  check('the hull block holds no colour literal', !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(HULL_CSS));
  check('no other animation in the hull block', (CSS.match(/animation: hull-/g) || []).length === 1);

  // -- producers -------------------------------------------------------------
  console.log('\nhull — producers');
  const prod = hullTile({ state: 'ok', crew: [], vitals: [], producers: { ok: 14, total: 15, not_ok: ['newsstand'] } });
  const chip = prod.querySelector('.hull-chip');
  check('a not_ok producer makes the chip warn', chip.className.includes('hull-chip-warn') && chip.textContent === '14/15');
  check('the list is hidden until tapped', !/newsstand/.test(textOf(prod)));
  tap(chip);
  check('tap reveals the id', /newsstand/.test(prod.querySelector('.hull-notok').textContent));
  tap(chip);
  check('a second tap folds it', prod.querySelector('.hull-notok').textContent === '');

  // -- error state -----------------------------------------------------------
  console.log('\nhull — state error');
  const err = hullTile({ state: 'error', host: null, note: 'launchctl did not answer', crew: [job('a')], vitals: [{ id: 'load', label: 'Load', value: '1', tone: 'good' }] });
  check('error: zero lamps', countOf(err, 'hull-lamp') === 0);
  check('error: zero cells', countOf(err, 'hull-cell') === 0);
  check('error: the note is printed', err.querySelector('.hull-note').textContent === 'launchctl did not answer');
  check('a null host titles it just "Hull"', err.querySelector('.hull-title').textContent === 'Hull');

  // -- absent ----------------------------------------------------------------
  console.log('\nhull — absent');
  threw = null;
  let absent;
  try { absent = render({ pending_count: 0, worker_published_at: isoAgo(1) }); } catch (e) { threw = e; }
  check('an absent hull does not throw', !threw, threw && threw.message);
  check('and renders zero .hull-* elements', absent && !all(absent).some((n) => /(^|\s)hull/.test(n.className)));
  check('and nothing under "Also reported"', absent && !/Also reported/.test(textOf(absent)));
  for (const [label, bad] of [['a string', 'up'], ['an array', [1]], ['crew as a string', { state: 'ok', crew: 'x', vitals: null }], ['null entries', { state: 'ok', crew: [null, 3], vitals: [null] }]]) {
    let t = null;
    try { hullTile(bad); } catch (e) { t = e; }
    check(`survives hull as ${label}`, !t, t && t.message);
  }

  // -- H8: the heartbeat -----------------------------------------------------
  console.log('\nhull — the heartbeat (H8)');
  const beat = (hours) => hullTile({ state: 'ok', crew: [], vitals: [] }, { worker_published_at: isoAgo(hours) }).querySelector('.hull-beat');
  check('13 h old → bad', beat(13).querySelector('.hull-dot').className.includes('hull-dot-bad'));
  check('5 h old → warn', beat(5).querySelector('.hull-dot').className.includes('hull-dot-warn'));
  check('fresh → good', beat(0.2).querySelector('.hull-dot').className.includes('hull-dot-good'));
  check('it prints the age', /^13h ago$/.test(beat(13).querySelector('.hull-beat-age').textContent));

  // -- SOURCE SCAN (H5) ------------------------------------------------------
  console.log('\nhull — source scan');
  const SRC = read('docs', 'tiles', 'ship_status.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const a = SRC.indexOf('const HULL_TONES');
  const b = SRC.indexOf('const PLAN_TONE');
  const REGION = a !== -1 && b > a ? SRC.slice(a, b) : '';
  check('the hull region is findable', REGION.length > 1000, String(REGION.length));
  const CLASSES = [...REGION.matchAll(/cls:\s*(?:[^,\n`]*\?\s*)?(`[^`]*`(?:\s*:\s*`[^`]*`)?|'[^']*'|[^,}\n]+)/g)].map((m) => m[0].trim());
  const interp = CLASSES.filter((c) => /\$\{/.test(c));
  check('the region emits interpolated classes (dot, chip, lamp)', interp.length === 3, interp.join(' | '));
  check('every interpolated class interpolates ${tone}', interp.every((c) => [...c.matchAll(/\$\{([^}]+)\}/g)].every((m) => m[1] === 'tone')), interp.join(' | '));
  check('the one page-derived tone is freshnessTone', (REGION.match(/freshnessTone\(/g) || []).length === 1 && /freshnessTone\(publishedAt, 3, 12\)/.test(REGION));
  const CMP = /(percent_free|last_secs|\bload\b|ago\([^)]*\)|Date\.parse|hoursSince)\s*(?:[<>]=?|[!=]==?)\s*\d|\d\s*(?:[<>]=?|[!=]==?)\s*(percent_free|last_secs|\bload\b)/;
  check('nothing compares percent_free / last_secs / load / an age to a number', !CMP.test(REGION), (REGION.match(CMP) || [''])[0]);
  check('no percent_free, load or since read at all', !/percent_free|\.load\b|\.since\b/.test(REGION));
  check('the region never parses a date itself', !/new Date|Date\.parse/.test(REGION));
  check('no innerHTML', !/innerHTML/.test(REGION));
  check('no sort (H3)', !/\.sort\(/.test(REGION));
  check('hull is in KNOWN', /'hull',/.test(SRC.slice(SRC.indexOf('const KNOWN'), SRC.indexOf(']);'))));

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('\ntest run crashed:', e && e.stack);
  process.exit(1);
});
