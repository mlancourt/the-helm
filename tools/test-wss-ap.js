#!/usr/bin/env node
/**
 * The Helm — wss_ap ("Vendor Bills"). Node, zero deps, on the shared DOM shim.
 *
 *   node tools/test-wss-ap.js
 *
 * Vault spec `AP-Bills-Tile-Spec.md`, AP1–AP12. The rulings with teeth:
 *
 *   AP2  the headline is the engine's `last_day`, wearing its own label.
 *   AP3  only rows with something to say: Today · held (warn) · not billed
 *        (bad when stuck, neutral and "waiting for the next run" otherwise).
 *   AP4  a quiet day is one faint line and the card does not grey.
 *   AP5  the sheet: Held → Not billed → each day, sections with rows only;
 *        one QuickBooks anchor per bill, and only for http(s).
 *   AP9  the page does no arithmetic on money and prints no figure for a
 *        total that is not a number.
 *   rule 7 / 10 / 9 — no clock, textContent only, hostile shapes never throw.
 *
 * Fixtures come straight from tools/make-mock-data.js (invented data), run
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
const mock = (flag) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'make-mock-data.js'), ...(flag ? [flag] : [])], { encoding: 'utf8' })).tiles.wss_ap;
const clone = (o) => JSON.parse(JSON.stringify(o));
const text = (n) => (n ? n.textContent : '');
const has = (n, c) => !!n && n.classList.contains(c);

(async () => {
  const mod = await import('../docs/tiles/wss_ap.js');
  const { usd } = await import('../docs/lib/fmt.js');
  const SRC = read('docs', 'tiles', 'wss_ap.js');
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const CSS = read('docs', 'style.css');

  /** Render a tile; returns {root, opened, sheet()} — sheet() taps the face and builds the panel body. */
  function render(tile) {
    const root = new El('div');
    const opened = [];
    const actions = { openPanel: (title, build) => opened.push({ title, build }) };
    mod.render(root, tile, { id: 'wss_ap', actions });
    return {
      root,
      opened,
      sheet() {
        const face = root.querySelector('.ap-face');
        face.listeners.click[0]({});
        const body = new El('div');
        opened[opened.length - 1].build(body);
        return body;
      },
    };
  }
  const lineOf = (root, key) => root.querySelector('.ap-line-' + key);
  const tileOf = (data, status = 'ok') => ({ band: 'DAILY', status, error: null, data });

  // -- the registry ------------------------------------------------------------
  console.log('\nregistry + ship');
  const REG = read('docs', 'tiles', '_registry.js');
  check(
    'AP1: wss_ap, DAILY, position 134, 🧾 Vendor Bills, no feed',
    /wss_ap:\s*\{\s*band:\s*'DAILY',\s*position:\s*134,\s*module:\s*'\.\/tiles\/wss_ap\.js',\s*title:\s*'🧾 Vendor Bills'\s*\}/.test(REG)
  );
  const { REGISTRY } = await import('../docs/tiles/_registry.js');
  check('Site Pulse 132 and Ship Status 140 did not move', REGISTRY.wss_traffic.position === 132 && REGISTRY.ship_status.position === 140);
  check('the SW precaches the module', /'\.\/tiles\/wss_ap\.js'/.test(read('docs', 'sw.js')));
  {
    const cv = Number((read('docs', 'sw.js').match(/CACHE_VERSION = 'helm-v(\d+)'/) || [])[1]);
    const av = (read('docs', 'config.js').match(/APP_VERSION = '(\d+)\.(\d+)\.\d+'/) || []).slice(1).map(Number);
    check('CACHE_VERSION is at least helm-v75', cv >= 75, String(cv));
    check('APP_VERSION is at least 1.48.0', av[0] > 1 || (av[0] === 1 && av[1] >= 48), av.join('.'));
  }
  check('npm test runs this file', /node tools\/test-wss-ap\.js/.test(read('package.json')));

  // -- the normal face -----------------------------------------------------------
  console.log('\nthe face — a normal day (AP2–AP3)');
  const normal = mock();
  const N = normal.data;
  const { root, opened, sheet } = render(normal);
  const face = root.querySelector('.ap-face');
  check('one face, a role=button div (not a <button> — long-press still reaches the shell)',
    face && face.tagName === 'DIV' && face.getAttribute('role') === 'button' && face.getAttribute('tabindex') === '0');
  check('no <button> or <input> anywhere on the face', root.querySelectorAll('button').length === 0 && root.querySelectorAll('input').length === 0);
  check('AP2: the headline wears last_day\'s label and count', text(root.querySelector('.ap-head-label')) === `${N.last_day.label} · 3 bills`, text(root.querySelector('.ap-head-label')));
  check('AP2: the total in the big-value style, through usd()', text(root.querySelector('.ap-head-total')) === usd(N.last_day.total) && usd(N.last_day.total) === '$778.22');
  const today = lineOf(root, 'today');
  check('Today row: "Today" · count · total', text(today.querySelector('.ap-lead')) === 'Today' && text(today.querySelector('.ap-rest')) === '2 · $296.35', text(today));
  const held = lineOf(root, 'held');
  check('held row: "1 held"', text(held.querySelector('.ap-lead')) === '1' && text(held.querySelector('.ap-rest')) === 'held', text(held));
  check('held row: dot and number wear the held mark', has(held.querySelector('.ap-dot'), 'ap-dot-held') && has(held.querySelector('.ap-lead'), 'ap-num-held'));
  const unb = lineOf(root, 'unbilled');
  check('not billed row: "1 not billed"', text(unb.querySelector('.ap-lead')) === '1' && text(unb.querySelector('.ap-rest')) === 'not billed');
  check('not billed, nothing stuck → neutral + "waiting for the next run"',
    !has(unb.querySelector('.ap-dot'), 'ap-dot-stuck') && !has(unb.querySelector('.ap-lead'), 'ap-num-stuck') && text(unb.querySelector('.ap-line-note')) === 'waiting for the next run');
  check('rows in order: Today, held, not billed', root.querySelectorAll('.ap-line').map((n) => n.className.match(/ap-line-(\w+)/)[1]).join(' ') === 'today held unbilled');
  check('the card does not grey on a normal day', mod.greys(normal) === false);

  // -- the sheet ---------------------------------------------------------------
  console.log('\nthe sheet (AP5)');
  const body = sheet();
  check('the tap opens the panel titled 🧾 Vendor Bills', opened.length === 1 && opened[0].title === '🧾 Vendor Bills');
  const secs = body.querySelectorAll('.ap-sec');
  check('sections in order Held → Not billed → each day, newest first',
    secs.map((n) => n.className.match(/ap-sec-(\w+)/)[1]).join(' ') === 'held unbilled day day', secs.map((n) => n.className).join(' | '));
  const heads = body.querySelectorAll('.ap-sec-head').map(text);
  check('day heads: "{label} · {n} bills · {total}"',
    heads[2] === `${N.days[0].label} · 2 bills · $296.35` && heads[3] === `${N.days[1].label} · 3 bills · $778.22`, heads.join(' | '));
  check('Held / Not billed heads', heads[0] === 'Held' && heads[1] === 'Not billed');
  const hrow = body.querySelector('.ap-row-held');
  const H0 = N.held[0];
  check('held row: vendor · invoice · total', text(hrow.querySelector('.ap-vendor')) === H0.vendor && text(hrow.querySelector('.ap-inv')) === H0.invoice && text(hrow.querySelector('.ap-amt')) === usd(H0.total));
  check('held row: why verbatim', text(hrow.querySelector('.ap-why')) === H0.why);
  check('held row: "since {since_label}" faint', text(hrow.querySelector('.ap-faint')) === `since ${H0.since_label}`);
  const urow = body.querySelector('.ap-row-unbilled');
  check('not billed row: why · landed {landed_label}', text(urow.querySelector('.ap-why')) === `${N.unbilled[0].why} · landed ${N.unbilled[0].landed_label}`);
  const brows = body.querySelectorAll('.ap-row-bill');
  check('one row per bill, in payload order', brows.map((r) => text(r.querySelector('.ap-inv'))).join(' ') === N.days.flatMap((d) => d.bills.map((b) => b.invoice)).join(' '));
  const B0 = N.days[1].bills[1];
  const b0 = brows[3];
  check('bill meta: gl · description · inv · due', text(b0.querySelector('.ap-meta')) === `${B0.gl} · ${B0.description} · inv ${B0.inv_label} · due ${B0.due_label}`, text(b0.querySelector('.ap-meta')));
  check('bill note, faint', text(b0.querySelector('.ap-faint')) === B0.note);
  const adoptedChips = body.querySelectorAll('.ap-chip');
  check('adopted → one quiet "already in QuickBooks" chip', adoptedChips.length === 1 && text(adoptedChips[0]) === 'already in QuickBooks');
  const links = body.querySelectorAll('a');
  const httpBills = N.days.flatMap((d) => d.bills).filter((b) => /^https?:/.test(b.qbo_url || ''));
  check('an anchor only for an http(s) qbo_url (the javascript: one gets none)', links.length === httpBills.length && links.length === 4, String(links.length));
  check('anchors read "QuickBooks", target _blank, rel noopener',
    links.every((a) => text(a) === 'QuickBooks' && a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel'))));
  check('anchor hrefs are the payload\'s', links.map((a) => a.getAttribute('href')).join(' ') === httpBills.map((b) => b.qbo_url).join(' '));
  check('no anchor text anywhere is "javascript"', !body.querySelectorAll('a').some((a) => /javascript/i.test(a.getAttribute('href'))));
  check('the sheet has no buttons or inputs', ['button', 'input', 'textarea', 'select'].every((t) => body.querySelectorAll(t).length === 0));

  // -- stuck ------------------------------------------------------------------
  console.log('\nstuck (AP7)');
  {
    const t = mock('--ap-stuck');
    const r = render(t);
    const u = lineOf(r.root, 'unbilled');
    check('any stuck row → the bad mark on dot and number', has(u.querySelector('.ap-dot'), 'ap-dot-stuck') && has(u.querySelector('.ap-lead'), 'ap-num-stuck'));
    check('  …and no "waiting" note', !u.querySelector('.ap-line-note'));
    check('  count is the rows: 2 not billed', text(u.querySelector('.ap-lead')) === '2');
    check('no headline, no Today, no held row', !r.root.querySelector('.ap-head') && !lineOf(r.root, 'today') && !lineOf(r.root, 'held'));
    const s = r.sheet();
    check('sheet: Not billed only', s.querySelectorAll('.ap-sec').length === 1 && !!s.querySelector('.ap-sec-unbilled'));
    const dots = s.querySelectorAll('.ap-row-unbilled').map((n) => has(n.querySelector('.ap-dot'), 'ap-dot-stuck'));
    check('sheet: the stuck row wears the bad dot, the waiting one does not', dots.join(' ') === 'true false');
  }

  // -- held only / held_older only ------------------------------------------------
  console.log('\nheld only · held_older only (AP8)');
  {
    const r = render(mock('--ap-held'));
    check('held only: one row, "2 held"', r.root.querySelectorAll('.ap-line').length === 1 && text(lineOf(r.root, 'held').querySelector('.ap-lead')) === '2');
    const s = r.sheet();
    check('sheet: Held only', s.querySelectorAll('.ap-sec').length === 1 && !!s.querySelector('.ap-sec-held'));
    const amts = s.querySelectorAll('.ap-row-held').map((n) => n.querySelectorAll('.ap-amt').length);
    check('a held row with a null total prints no amount at all', amts.join(' ') === '1 0', amts.join(' '));
    check('no older line when held_older is 0', !s.querySelector('.ap-older'));
  }
  {
    const t = mock('--ap-older');
    const r = render(t);
    check('held_older only: "4 held"', text(lineOf(r.root, 'held')) === '4held' && t.data.held.length === 0);
    const s = r.sheet();
    check('sheet: Held with no rows and one faint line', s.querySelectorAll('.ap-row').length === 0 && text(s.querySelector('.ap-older')) === '4 held more than 30 days' && has(s.querySelector('.ap-older'), 'ap-faint'));
    check('the {n} is length + held_older', (() => { const x = clone(t); x.data.held = [{ vendor: 'Example' }]; return text(lineOf(render(x).root, 'held').querySelector('.ap-lead')) === '5'; })());
  }

  // -- adopted --------------------------------------------------------------------
  console.log('\nadopted');
  {
    const r = render(mock('--ap-adopted'));
    const s = r.sheet();
    check('the chip, and no anchor when qbo_url is null', text(s.querySelector('.ap-chip')) === 'already in QuickBooks' && s.querySelectorAll('a').length === 0);
    check('headline "1 bill" singular', /· 1 bill$/.test(text(r.root.querySelector('.ap-head-label'))));
    check('sheet: one day section', s.querySelectorAll('.ap-sec').map((n) => n.className).join() === 'ap-sec ap-sec-day');
  }

  // -- every optional field null -----------------------------------------------
  console.log('\nnulls everywhere');
  {
    const t = mock('--ap-nulls');
    let r;
    let threw = null;
    try { r = render(t); r.body = r.sheet(); } catch (e) { threw = e; }
    check('renders without throwing', !threw, threw && threw.message);
    const all = text(r.root) + text(r.body);
    check('no "NaN", "undefined" or "null" printed', !/NaN|undefined|null/.test(all), all);
    check('no row prints an amount for a null total', r.body.querySelectorAll('.ap-amt').length === 0);
    check('a bill with no meta parts draws no meta line, no note, no marks',
      !r.body.querySelector('.ap-row-bill').querySelector('.ap-meta') && !r.body.querySelector('.ap-row-bill').querySelector('.ap-faint') && !r.body.querySelector('.ap-row-bill').querySelector('.ap-marks'));
    check('a held row with no why or since draws only its first line', r.body.querySelector('.ap-row-held').querySelectorAll('.ap-why').length === 0 && r.body.querySelector('.ap-row-held').querySelectorAll('.ap-faint').length === 0);
    check('the vendor falls to an em dash, never blank', text(r.body.querySelector('.ap-vendor')) === '—');
  }

  // -- empty ---------------------------------------------------------------------
  console.log('\nempty (AP4)');
  {
    const t = mock('--ap-empty');
    const r = render(t);
    check('exactly one line, "Nothing to review."', r.root.childNodes.length === 1 && text(r.root) === 'Nothing to review.' && has(r.root.childNodes[0], 'ap-quiet'));
    check('no face, no sections, no tap target', !r.root.querySelector('.ap-face') && r.root.querySelectorAll('.ap-sec').length === 0 && r.opened.length === 0);
    check('the card does not grey for empty', mod.greys(t) === false);
    check('the quiet line is faint, not a tone', /\.ap-quiet\s*\{[^}]*color:\s*var\(--text-faint\)/.test(CSS));
  }

  // -- error / stale ---------------------------------------------------------------
  console.log('\nerror · stale (rule 8)');
  {
    const t = mock('--ap-error');
    const r = render(t);
    check('error: the module draws nothing — the shell owns the pill, the error line and the grey', r.root.childNodes.length === 0);
    check('error: greys() is exactly true', mod.greys(t) === true);
    check('error: the fixture carries the error text the shell prints', /ap-seen\.json/.test(t.error) && t.status === 'error');
    check('error: the shell paints that line (the module does not claim it)', !/wss_ap/.test((read('docs', 'app.js').match(/function ownsErrorLine[\s\S]*?\n\}/) || [''])[0]));
    const st = clone(normal); st.status = 'stale';
    check('stale: greys() true, and the last data still renders', mod.greys(st) === true && !!render(st).root.querySelector('.ap-head'));
    check('greys() is false for anything else', [null, undefined, {}, { status: 'ok' }, { status: 'missing' }].every((x) => mod.greys(x) === false));
  }

  // -- hostile shapes (rule 9 / AP12) -------------------------------------------------
  console.log('\nhostile shapes');
  {
    const shapes = [
      null, undefined, 'x', 42, [], { status: 'ok' },
      { last_day: [], today_so_far: 'two', days: {}, held: 'none', unbilled: 7, held_older: '3' },
      { last_day: { label: 7, count: '3', total: '778.22' }, days: [null, 'x', { bills: 'no' }, { label: 'Mon 1/1', bills: [null, 3, { invoice: {} }] }], held: [null, 2, { why: { a: 1 } }], unbilled: [null, { stuck: 'yes' }] },
      { ...clone(N), extra_key: { anything: true }, days: N.days.map((d) => ({ ...d, mystery: 1, bills: d.bills.map((b) => ({ ...b, unknown: '<b>x</b>' })) })) },
    ];
    let threw = null;
    for (const data of shapes) {
      try { const r = render(tileOf(data)); if (r.root.querySelector('.ap-face')) r.sheet(); } catch (e) { threw = e; break; }
    }
    check('no shape throws (face and sheet)', !threw, threw && threw.stack);
    const r = render(tileOf(shapes[7]));
    check('a string total on last_day prints no figure (AP9: money is a number or nothing)', !r.root.querySelector('.ap-head-total'));
    check('a string count prints no count', !/bill/.test(text(r.root.querySelector('.ap-head'))));
    check('"yes" is not stuck — only stuck === true is', !lineOf(r.root, 'unbilled').querySelector('.ap-num-stuck'));
    check('held_older "3" is not a count', !lineOf(render(tileOf(shapes[6])).root, 'held'));
    const u = render(tileOf(shapes[8]));
    check('unknown keys on a row are ignored', !/<b>x<\/b>|mystery|anything/.test(text(u.sheet())));
    const evil = clone(normal); evil.data.held[0].why = '<img src=x onerror=alert(1)>'; evil.data.days[0].bills[0].description = '<script>x</script>';
    const es = render(evil).sheet();
    check('rule 10: markup in why / description is printed as text', text(es.querySelector('.ap-row-held').querySelector('.ap-why')) === evil.data.held[0].why && /<script>x<\/script>/.test(text(es)));
    const nan = clone(normal); nan.data.last_day.total = NaN; nan.data.held[0].total = Infinity;
    check('NaN / Infinity totals print nothing', !/NaN|Infinity/.test(text(render(nan).root) + text(render(nan).sheet())));
  }

  // -- source scans ------------------------------------------------------------------
  console.log('\nsource scans');
  check('rule 7: no new Date(', !/new Date\(/.test(SRC));
  check('rule 7: no Date.parse', !/Date\.parse/.test(SRC));
  check('rule 10: no innerHTML', !/innerHTML/.test(SRC));
  check('AP9: no .reduce(', !/\.reduce\(/.test(SRC));
  check('no fetch(', !/fetch\(/.test(SRC));
  check('rules 5/6: no event post (submitEvent, /api/event, ctx.actions.* but openPanel)',
    !/submitEvent|\/api\/event|actions\.(?!openPanel)\w+/.test(CODE));
  check('no button / input / textarea built', !/el\('(button|input|textarea|select)'/.test(CODE));
  check('AP9: money goes through fmt.js usd(), no second formatter', /import \{ usd \} from '\.\.\/lib\/fmt\.js'/.test(SRC) && !/toLocaleString|toFixed|Intl\./.test(CODE));
  check('AP9: no sum of totals — `.total` is only ever handed to money()', [...CODE.matchAll(/\.total\b/g)].length === [...CODE.matchAll(/money\(\w+\.total\)/g)].length);
  check('safeUrl() vets the QuickBooks anchor', /safeUrl\(b\.qbo_url\)/.test(CODE));
  check('the module reads no ctx.live / ctx.weather (no feed)', !/ctx\??\.(live|weather)/.test(CODE));

  // -- stylesheet ---------------------------------------------------------------------
  console.log('\nstylesheet');
  {
    const start = CSS.indexOf('/* ------------------------------------------------------------ wss_ap');
    const end = CSS.indexOf('/* ------------------------------------------------------------ /wss_ap */', start);
    check('the block is found, after Site Pulse', start > CSS.indexOf('/wss_traffic */') && end > start);
    const block = CSS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const toned = rules.filter((r) => /var\(--(good|warn|bad|info)\)/.test(r.body));
    const SCOPED = /^\.(card|panel)\[data-tile="wss_ap"\] \.ap-(dot|num)-(held|stuck)$/;
    check('tone tokens only on the held and stuck marks, scoped to this tile', toned.length > 0 && toned.every((r) => r.sel.split(',').every((s) => SCOPED.test(s.trim()))), toned.map((r) => r.sel).join(' | '));
    check('held marks wear --warn, stuck marks wear --bad, nothing else', toned.every((r) => (/held/.test(r.sel) ? /var\(--warn\)/.test(r.body) && !/--bad/.test(r.body) : /var\(--bad\)/.test(r.body) && !/--warn/.test(r.body))));
    check('no --good or --info anywhere in the block', !/--good|--info/.test(block));
    check('the card scopes all four marks', ['ap-dot-held', 'ap-num-held', 'ap-dot-stuck', 'ap-num-stuck'].every((c) => new RegExp(`\\.card\\[data-tile="wss_ap"\\] \\.${c}`).test(block)));
    check('no colour literals in the block', !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(block));
    check('no rule outside the block styles an ap- class', ![...(CSS.slice(0, start) + CSS.slice(end + 10)).matchAll(/([^{}]+)\{/g)].some((m) => /\.ap-/.test(m[1])));
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
