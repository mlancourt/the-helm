#!/usr/bin/env node
/**
 * The Helm — app-shell tests. Node, zero deps, no browser.
 *
 *   node tools/test-shell.js
 *
 * The header and the two sheets have no coverage anywhere else, because
 * app.js cannot be imported outside a browser — it reads `location` and the
 * DOM at module scope. So this file tests the three things that can be tested
 * without booting it, which happen to be the three that break silently:
 *
 *   1  the version chip comes from ONE constant. A version typed into the
 *      markup drifts from the one in Ship Status within a deploy, and then
 *      the board is lying about which build a phone is running.
 *   2  the subhead never prints `me.name`. /api/data still returns it and the
 *      page still reads it; the board just never says it. That is enforced by
 *      subheadText() having no parameter that could carry a name, which is a
 *      thing a test can actually assert.
 *   3  the phone sheets have no fixed height. A `height` on .sheet is the bug
 *      Matt photographed — a mostly-empty panel with the composer floating in
 *      the middle of it — and it would come back the moment someone "fixes"
 *      the sheet by nailing it to a number.
 *
 * Plus a standing rule-4 guard: the stylesheet may not reference anything off
 * this origin, and the inlined face may not grow past 15 KB.
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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('docs', 'style.css');
const HTML = read('docs', 'index.html');
const APP = read('docs', 'app.js');
const CONFIG = read('docs', 'config.js');
const SW = read('docs', 'sw.js');

// ------------------------------------------------------------ css parsing

/**
 * Split a stylesheet into top-level items by brace matching. At-rules come
 * back with their body so a media query can be recursed into separately;
 * everything else is a {selector, body} pair. Comments are stripped first so a
 * `{` inside prose cannot throw the depth off.
 */
function topLevelRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    out.push({ prelude, body: src.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

/** Every rule whose selector list mentions `selector`, outside any @media. */
function baseRules(selector) {
  return topLevelRules(CSS)
    .filter((r) => !r.prelude.startsWith('@'))
    .filter((r) => r.prelude.split(',').some((s) => s.trim() === selector));
}

/**
 * Every `@media (min-width: 720px)` body, joined. There is more than one —
 * the desktop rules are written next to the phone rules they override rather
 * than collected at the bottom — so this must not stop at the first.
 */
function desktopBlock() {
  return topLevelRules(CSS)
    .filter((x) => /^@media[^{]*min-width:\s*720px/.test(x.prelude))
    .map((x) => x.body)
    .join('\n');
}

/** Source with comments stripped — prose about a rule is not the rule. */
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of `prop` in a rule body, ignoring longhands that contain it. */
function decls(body, prop) {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`, 'g');
  return [...body.matchAll(re)].map((m) => m[1].trim());
}

// ------------------------------------------------------------------- tests

console.log('The Helm — app shell tests\n');

// -- 1. the version chip ----------------------------------------------------
console.log('version chip renders from the constant');
{
  const APP_VERSION = (CONFIG.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  check('config.js exports APP_VERSION', !!APP_VERSION, 'not found');
  check('and it is a full major.minor.patch', /^\d+\.\d+\.\d+$/.test(APP_VERSION || ''), APP_VERSION);

  // Derive the label the way config.js does, then confirm config.js agrees.
  const label = `v${String(APP_VERSION).split('.').slice(0, 2).join('.')}`;
  check(`the label is v + major.minor (${label})`, /^v\d+\.\d+$/.test(label));
  check(
    'config.js derives the label rather than repeating the number',
    /APP_VERSION_LABEL\s*=\s*`v\$\{APP_VERSION/.test(CONFIG)
  );

  check('index.html carries an empty chip element', /<span id="version-chip"[^>]*>\s*<\/span>/.test(HTML));
  check('app.js fills it from the constant', /version-chip'\)[\s\S]{0,120}APP_VERSION_LABEL/.test(APP));
  check('app.js imports the constant', /import\s*\{[^}]*APP_VERSION_LABEL[^}]*\}\s*from '\.\/config\.js'/.test(APP));

  // The whole point: nobody may type the version anywhere but config.js.
  const literal = new RegExp(`v${String(APP_VERSION).split('.').slice(0, 2).join('\\.')}\\b`);
  check('index.html does not hardcode the version', !literal.test(stripJsComments(HTML.replace(/<!--[\s\S]*?-->/g, ''))));
  check('app.js does not hardcode the version', !literal.test(stripJsComments(APP)));
  check('style.css does not hardcode the version', !literal.test(stripCssComments(CSS)));

  // ...and Ship Status prints the full one from that same constant.
  const SHIP = read('docs', 'tiles', 'ship_status.js');
  check('ship_status imports APP_VERSION', /import\s*\{\s*APP_VERSION\s*\}\s*from '\.\.\/config\.js'/.test(SHIP));
  check('ship_status does not hardcode the version', !new RegExp(String(APP_VERSION).replace(/\./g, '\\.')).test(SHIP));

  // The chip is a readout of the build, so the build had better be cached as
  // its own generation: a version bump with a stale CACHE_VERSION ships a chip
  // that says v1.1 over a v1.0 shell.
  const cacheV = (SW.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
  check(`sw.js has a CACHE_VERSION (${cacheV})`, !!cacheV);
}

// -- 2. the subhead ---------------------------------------------------------
console.log('\nsubhead never contains me.name');
(async () => {
  const header = await import('../docs/lib/header.js');

  check('the operator label is LannyAI', header.OPERATOR === 'LannyAI', header.OPERATOR);

  const fresh = new Date(Date.now() - 49 * 60 * 1000).toISOString();
  const line = header.subheadText({ generated_at: fresh });
  check('the line leads with the label', line.startsWith('LannyAI'), line);
  check('and keeps the snapshot age after it', /snapshot 49m ago$/.test(line), line);

  // The structural guarantee: one parameter, and it is the snapshot. There is
  // no argument a caller could pass that carries a person's name.
  check('subheadText takes exactly one argument', header.subheadText.length === 1);

  // Belt and braces — even a snapshot that somehow carries an identity cannot
  // put it on screen.
  const hostile = header.subheadText({ generated_at: fresh, me: { name: 'Matt' }, name: 'Matt', owner: 'Matt' });
  check('a name smuggled into the snapshot is not rendered', !/Matt/.test(hostile), hostile);

  // No snapshot at all: the label alone, never a stray separator.
  check('with no snapshot it is just the label', header.subheadText(null) === 'LannyAI');
  check('with an unparseable timestamp, no empty "snapshot" bit', header.subheadText({ generated_at: 'soon' }) === 'LannyAI');

  // And app.js must not have grown its own copy of the line.
  const CODE = stripJsComments(APP);
  const renderHeader = (CODE.match(/function renderHeader\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  check('renderHeader was found', renderHeader.length > 0);
  check('renderHeader delegates to subheadText', /subheadText\(state\.snapshot\)/.test(renderHeader));
  check('renderHeader does not read state.me', !/state\.me/.test(renderHeader), 'me is back in the header');
  check(
    'state.me is only ever assigned, never rendered',
    [...CODE.matchAll(/state\.me\b(?!\s*=)/g)].length === 0,
    'something reads state.me'
  );
  check('the board does not print me.name anywhere', !/\bme\?\.name|\bme\.name\b/.test(CODE));

  // -- 2b. the tile error line, and who may opt out of it -------------------
  //
  // The shell paints `tile.error` as a red line above every tile body. One
  // tile — `newsstand`, an aggregator over ~40 RSS feeds — says it better
  // itself ("36 of 40 sources answered"), so it exports a flag and the shell
  // stands down for it.
  //
  // An earlier cut had the TILE delete the node the shell had painted. That
  // worked and was backwards: a tile reaching into the shell's own markup
  // breaks silently the day the shell changes it. So the direction is tested
  // here, from the shell's side, on the shipped source — and the predicate is
  // pulled out and actually RUN, rather than pattern-matched.
  console.log('\nthe tile error line is opt-out, and the opt-out is opt-in');
  {
    const src = (CODE.match(/function ownsErrorLine\(id\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    check('app.js defines ownsErrorLine', src.length > 0);

    // The real function, with a stub standing in for the module map it closes
    // over. If the shipped predicate changes shape, this stops compiling.
    const ns = new Map();
    const ownsErrorLine = new Function('moduleNs', `${src}\nreturn ownsErrorLine;`)(ns);

    ns.set('newsstand', { render() {}, ownsErrorLine: true });
    ns.set('calendar', { render() {} });
    check('a module that exports the flag opts out', ownsErrorLine('newsstand') === true);
    check('a module WITHOUT the flag still gets the shell\u2019s error line', ownsErrorLine('calendar') === false);
    check('and so does a tile whose module never loaded', ownsErrorLine('nothing_here') === false);

    // Strictly `=== true`: a tile that grows some unrelated truthy export of
    // the same name must not silently lose its error line.
    ns.set('almost', { render() {}, ownsErrorLine: 'yes' });
    check('truthy is not enough — the flag must be exactly true', ownsErrorLine('almost') === false);

    // The shell's half: exactly one place prints the SNAPSHOT's error, and it
    // is gated. (`card-error` is also the class on "this tile threw", which
    // is a different thing and deliberately not covered below.)
    const paints = [...CODE.matchAll(/text:\s*String\(tile\.error\)/g)].length;
    check('one place in the shell prints the snapshot error', paints === 1, String(paints));
    check(
      'and it is gated on the flag',
      /if\s*\(tile\.error\s*&&\s*!ownsErrorLine\(id\)\)/.test(CODE),
      'the error line is no longer gated'
    );

    // The opt-out covers the ENGINE's error, not a crash. A module that
    // throws has just proved it cannot report anything, including itself, so
    // the shell says so whatever flag the module exports.
    const crash = (CODE.match(/catch \(e\) \{[\s\S]{0,400}?This tile failed to render[^\n]*\n/) || [''])[0];
    check('a tile that throws is still reported by the shell', crash.length > 0);
    check('and that line is not gated on the flag', !/ownsErrorLine/.test(crash));

    // The tile's half: declared, never done by hand.
    const NEWS = read('docs', 'tiles', 'newsstand.js');
    check('newsstand exports the flag', /export const ownsErrorLine = true;/.test(NEWS));
    check('and never touches card-error itself', !/card-error/.test(NEWS));
    check('nor removes nodes from the body it was handed', !/removeChild/.test(NEWS));
  }

  // -- 3. the sheets --------------------------------------------------------
  console.log('\nsheets size to content in the phone breakpoint');
  const sheet = baseRules('.sheet');
  check('there is a base .sheet rule', sheet.length === 1, `found ${sheet.length}`);
  const sheetBody = sheet[0]?.body || '';

  check('.sheet sets no height', decls(sheetBody, 'height').length === 0, decls(sheetBody, 'height').join(', '));
  check('.sheet sets no min-height', decls(sheetBody, 'min-height').length === 0);
  check('.sheet caps itself with max-height instead', decls(sheetBody, 'max-height').length === 1);
  check('and that cap is against the visible viewport', /var\(--vvh/.test(decls(sheetBody, 'max-height')[0] || ''));
  check('.sheet sits on the keyboard, not the layout viewport', /var\(--kb/.test(decls(sheetBody, 'bottom')[0] || ''));
  check(
    '.sheet drops the safe-area inset once the keyboard covers it',
    /var\(--safe-b\)\s*-\s*var\(--kb/.test(decls(sheetBody, 'padding')[0] || '')
  );

  const trans = decls(sheetBody, 'transition')[0] || '';
  check('.sheet slides in 200ms ease-out', /transform\s+200ms\s+ease-out/.test(trans), trans);
  check('.sheet is translated, not resized, to open', /translateY/.test(sheetBody));

  for (const sel of ['.sheet-body', '.ask-transcript', '.panel-body', '.ask-compose']) {
    const rules = baseRules(sel);
    check(`${sel} exists`, rules.length >= 1);
    const body = rules.map((r) => r.body).join(';');
    check(`${sel} sets no fixed height`, decls(body, 'height').length === 0, decls(body, 'height').join(', '));
  }

  const transcript = baseRules('.ask-transcript').map((r) => r.body).join(';');
  check('.ask-transcript has no min-height floor', /min-height:\s*0/.test(transcript));
  const tMax = decls(transcript, 'max-height')[0] || '';
  check('.ask-transcript is capped at 40vh', /40vh/.test(tMax), tMax);
  check('and also against the visible viewport', /var\(--vvh/.test(tMax), tMax);
  check('.ask-transcript grows with content', /flex:\s*0 1 auto/.test(transcript));

  check('.ask-compose never shrinks', /flex:\s*0 0 auto/.test(baseRules('.ask-compose').map((r) => r.body).join(';')));

  const panel = baseRules('.panel-body').map((r) => r.body).join(';');
  check('.panel-body is capped the same way', /var\(--vvh/.test(decls(panel, 'max-height')[0] || ''));

  // Desktop is explicitly unchanged: docked, 70vh, body fills it.
  const desk = desktopBlock();
  check('desktop still docks at a fixed offset', /bottom:\s*18px/.test(desk));
  check('desktop keeps its 70vh panel', /max-height:\s*70vh/.test(desk));
  check('desktop restores the filling transcript', /\.ask-transcript\s*\{[^}]*max-height:\s*none/.test(desk));
  check('desktop restores the filling body', /\.sheet-body\s*\{[^}]*flex:\s*1 1 auto/.test(desk));
  check('desktop restores the uncapped panel body', /\.panel-body\s*\{[^}]*max-height:\s*none/.test(desk));

  /**
   * ...and each of those overrides must come after the rule it overrides.
   * Media queries add no specificity, so a desktop override written ABOVE its
   * phone rule loses the cascade — silently, and only on a wide screen, which
   * is the one place these tests cannot see. This is that bug's tripwire: it
   * was real, and presence alone did not catch it.
   */
  const ordered = topLevelRules(CSS);
  const lastBaseIndex = (sel) =>
    ordered.reduce((acc, r, i) =>
      !r.prelude.startsWith('@') && r.prelude.split(',').some((x) => x.trim() === sel) ? i : acc, -1);
  const overrideIndex = (sel) =>
    ordered.reduce((acc, r, i) =>
      /^@media[^{]*min-width:\s*720px/.test(r.prelude) && new RegExp(`(^|[},])\\s*\\${sel}\\s*\\{`).test(r.body) ? i : acc, -1);

  for (const sel of ['.sheet', '.sheet-body', '.ask-transcript', '.panel-body']) {
    const base = lastBaseIndex(sel);
    const over = overrideIndex(sel);
    check(`${sel} has a desktop override`, over !== -1);
    check(
      `${sel}'s desktop override wins the cascade`,
      over > base,
      `override at rule ${over}, phone rule at ${base} — the override is above the rule it overrides`
    );
  }

  // Reduced motion. There is more than one such block now — the sheets stop
  // sliding and the live-dot stops pulsing — so every one of them counts.
  const rms = topLevelRules(CSS).filter((r) => /prefers-reduced-motion/.test(r.prelude));
  check('prefers-reduced-motion is honoured at all', rms.length > 0);
  check(
    'the sheets stop sliding under reduced motion',
    rms.some((r) => /\.sheet[^{]*\{[^}]*transition:\s*none/.test(r.body)),
    `${rms.length} reduced-motion blocks`
  );
  // Anything that animates forever has to be switchable off; a pulsing dot in
  // the corner of the eye is exactly what the setting exists for.
  const keyframed = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  for (const name of keyframed) {
    const users = [...CSS.matchAll(new RegExp(`animation:[^;]*\\b${name}\\b[^;]*;`, 'g'))];
    const infinite = users.some((u) => /infinite/.test(u[0]));
    if (!infinite) continue;
    check(
      `the endless @keyframes ${name} is stilled under reduced motion`,
      rms.some((r) => /animation:\s*none/.test(r.body))
    );
  }

  // app.js side of the contract.
  check('app.js publishes --kb and --vvh', /--kb/.test(APP) && /--vvh/.test(APP));
  check('app.js reads them off visualViewport', /visualViewport/.test(APP));
  check('app.js subtracts offsetTop from the keyboard height', /vv\.offsetTop/.test(APP));
  check('app.js listens for both resize and scroll', /addEventListener\('resize'/.test(APP) && /addEventListener\('scroll'/.test(APP));
  check('app.js survives a browser with no visualViewport', /if\s*\(!vv\)/.test(APP));

  // -- 4. rule 4: nothing leaves this origin --------------------------------
  console.log('\nrule 4 — the stylesheet reaches nowhere');
  const urls = [...CSS.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)].map((m) => m[2].trim());
  check('every url() in style.css is inline data', urls.every((u) => u.startsWith('data:')), urls.filter((u) => !u.startsWith('data:')).join(', '));

  const faces = [...CSS.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
  check('there is exactly one @font-face', faces.length === 1, `found ${faces.length}`);
  const b64 = (CSS.match(/base64,([A-Za-z0-9+/=]+)\)/) || [])[1] || '';
  const bytes = Buffer.from(b64, 'base64').length;
  check(`the inlined face is ${bytes} bytes`, bytes > 0);
  check('and it is under the 15 KB ceiling', bytes <= 15 * 1024, `${bytes} bytes`);
  check('it is a woff2', /^wOF2/.test(Buffer.from(b64, 'base64').subarray(0, 4).toString('latin1')));
  check('the face declares a fallback-friendly display', /font-display:\s*swap/.test(faces[0] || ''));
  check('the wordmark names a system fallback after it', /\.wordmark\s*\{[\s\S]*?font-family:[^;]*sans-serif/.test(CSS));
  check('the face is not applied to body text', !/^\s*(html, body|body)\s*\{[^}]*Helm Display/m.test(CSS));

  check('index.html links nothing off-origin', !/<link[^>]+href=["']https?:/i.test(HTML));
  check('index.html loads no external script', !/<script[^>]+src=["']https?:/i.test(HTML));

  // The new module has to be in the precache list or an offline open loses
  // the subhead entirely.
  check('sw.js precaches lib/header.js', SW.includes("'./lib/header.js'"));

  // -- 5. the board is ONE flat grid, in Matt's order -----------------------
  //
  // Ruling, 2026-09-20: no band headers, no grouping. `band` stays in the
  // registry — it still gates the ask tile off the board and out of module
  // preloading, and it still describes refresh cadence — but `position` is the
  // whole of the layout now.
  //
  // The order is the point, so it is asserted twice: once against the registry
  // (the source of truth) and once against the cards the SHIPPED renderAll
  // actually appends, run here with stubs. A registry whose numbers are right
  // and a render pass that sorts by something else is exactly the bug this
  // change could introduce, and only the second assertion would see it.
  console.log('\nthe board is one grid, in the registry order');
  {
    const { El } = require('./dom-shim.js'); // installs global.document
    const { REGISTRY, ...rest } = await import('../docs/tiles/_registry.js');
    const dom = await import('../docs/lib/dom.js');
    const fmt = await import('../docs/lib/fmt.js');
    const REG = read('docs', 'tiles', '_registry.js');

    const ORDER = [
      'calendar', 'reminders', 'captains_log', 'dinner', 'weather', 'newsstand',
      'entertainment', 'local_events', 'today_games', 'bets_live', 'bets_ledger',
      'cards', 'purser_due', 'wss_tape', 'ship_status',
    ];

    // The tens, and the first tile to cash them in. `captains_log` was slotted
    // between reminders (20) and dinner (30) on 2026-09-21 and NO other number
    // moved — which is the whole reason the grid was renumbered in tens rather
    // than one-per-tile. Asserted as what it is: an insert, not a renumber.
    const INSERTS = { captains_log: 25 };

    // -- the registry ------------------------------------------------------
    const onBoard = Object.entries(REGISTRY)
      .filter(([, e]) => e.band !== 'ASK')
      .sort((a, b) => a[1].position - b[1].position)
      .map(([id]) => id);

    check(`the registry carries ${ORDER.length} board tiles`, onBoard.length === ORDER.length, String(onBoard.length));
    check('and their positions put them in Matt’s order', onBoard.join(' ') === ORDER.join(' '), onBoard.join(' '));
    check(
      'the positions rise, so the order is unambiguous',
      ORDER.every((id, i) => i === 0 || REGISTRY[id].position > REGISTRY[ORDER[i - 1]].position),
      ORDER.map((id) => REGISTRY[id]?.position).join(' ')
    );
    check(
      'every tile that has not been inserted between two others is still on a ten',
      ORDER.filter((id) => !(id in INSERTS)).every((id, i) => REGISTRY[id].position === (i + 1) * 10),
      ORDER.filter((id) => !(id in INSERTS)).map((id) => REGISTRY[id]?.position).join(' ')
    );
    for (const [id, pos] of Object.entries(INSERTS)) {
      const i = ORDER.indexOf(id);
      check(
        `${id} slotted in at ${pos} and moved nobody`,
        REGISTRY[id].position === pos &&
          REGISTRY[ORDER[i - 1]].position === i * 10 &&
          REGISTRY[ORDER[i + 1]].position === (i + 1) * 10,
        `${REGISTRY[ORDER[i - 1]]?.position} ${REGISTRY[id]?.position} ${REGISTRY[ORDER[i + 1]]?.position}`
      );
    }
    check('ask is band ASK, off-board at 999', REGISTRY.ask.band === 'ASK' && REGISTRY.ask.position === 999);
    check('every board tile still declares a band', onBoard.every((id) => !!REGISTRY[id].band));

    // The dead exports. Nothing imports them after this change, and a dead
    // export rots — the next person to read one would believe it.
    check('BAND_ORDER and BAND_LABEL are gone from the registry', !/BAND_ORDER|BAND_LABEL/.test(REG));
    check('and nothing is left exported but REGISTRY', Object.keys(rest).length === 0, Object.keys(rest).join(', '));
    check('app.js imports REGISTRY alone', /import\s*\{\s*REGISTRY\s*\}\s*from '\.\/tiles\/_registry\.js'/.test(APP));
    check('bandRank() is gone from the shell', !/bandRank/.test(CODE));
    check('the stylesheet has no .band-label rule', baseRules('.band-label').length === 0);
    check('the board still has exactly one .grid rule', baseRules('.grid').length === 1, String(baseRules('.grid').length));

    // -- the shipped renderAll ---------------------------------------------
    //
    // Both halves are the real source, pulled out and RUN: renderAll for the
    // order, tileCard for what each card actually is.
    const ownsSrc = (CODE.match(/function ownsErrorLine\(id\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    const cardSrc = (CODE.match(/function tileCard\(id, entry, tile\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    const allSrc = (CODE.match(/function renderAll\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    check('renderAll was found', allSrc.length > 0);
    check('tileCard was found', cardSrc.length > 0);

    const noop = () => {};
    const shellState = { snapshot: null, pending: [], live: null, weather: null, error: null };
    const tileCard = new Function(
      'el', 'pill', 'empty', 'clear', 'genericCard', 'ago', 'ctTime',
      'actions', 'modules', 'moduleNs', 'attachExplain', 'state',
      `${ownsSrc}\n${cardSrc}\nreturn tileCard;`
    )(
      dom.el, dom.pill, dom.empty, dom.clear, dom.genericCard, fmt.ago, fmt.ctTime,
      { openAsk: noop }, new Map(), new Map(), noop, shellState
    );

    const boardEl = new El('main');
    const renderAll = new Function(
      'renderBanner', 'renderBoardBanner', 'renderHeader',
      'document', 'clear', 'el', 'empty', 'REGISTRY', 'tileCard', 'state',
      `${allSrc}\nreturn renderAll;`
    )(noop, noop, noop, { getElementById: () => boardEl }, dom.clear, dom.el, dom.empty, REGISTRY, tileCard, shellState);

    const tile = (band) => ({ band, updated_at: '2026-09-20T12:00:00.000Z', status: 'ok', error: null, data: { n: 1 } });
    const fullSnapshot = () => {
      const tiles = {};
      for (const [id, e] of Object.entries(REGISTRY)) tiles[id] = tile(e.band);
      return { schema: 1, generated_at: '2026-09-20T12:00:00.000Z', tiles };
    };

    const titles = () => boardEl.querySelectorAll('.card-title').map((n) => n.textContent);

    shellState.snapshot = fullSnapshot();
    renderAll();

    const grids = boardEl.querySelectorAll('.grid');
    check('the board holds exactly one grid', grids.length === 1, `${grids.length} grids`);
    check('and the grid is the only thing in it', boardEl.childNodes.length === 1, String(boardEl.childNodes.length));
    check('no band header survives anywhere on the board', boardEl.querySelectorAll('.band-label').length === 0);
    check(`the grid holds all ${ORDER.length} cards`, grids[0].childNodes.length === ORDER.length, String(grids[0].childNodes.length));
    check(
      'in exactly Matt’s order',
      titles().join(' | ') === ORDER.map((id) => REGISTRY[id].title).join(' | '),
      titles().join(' | ')
    );
    check('ask is in the snapshot and NOT on the board', !!shellState.snapshot.tiles.ask && !titles().includes('Ask'));

    // -- rule 9, still true in one grid -------------------------------------
    const drifted = fullSnapshot();
    drifted.tiles.frobnicator = { band: 'HOURLY', updated_at: '2026-09-20T12:00:00.000Z', status: 'ok', error: null, data: { widgets: 3 } };
    shellState.snapshot = drifted;
    renderAll();

    const grid = boardEl.querySelectorAll('.grid')[0];
    check('an unregistered snapshot tile is rendered', grid.childNodes.length === ORDER.length + 1, String(grid.childNodes.length));
    check('and it sorts to the end at 500', titles()[ORDER.length] === 'frobnicator', titles().slice(-2).join(' | '));
    check('the registered order is untouched by it', titles().slice(0, ORDER.length).join(' | ') === ORDER.map((id) => REGISTRY[id].title).join(' | '));

    const last = grid.childNodes[ORDER.length];
    check('it renders as the generic key/value card', last.querySelectorAll('.generic').length === 1);
    check('with a row per key', last.querySelectorAll('.row-label').map((n) => n.textContent).join(',') === 'widgets');
    check('and says why it looks like that', /No render module for this tile yet\./.test(last.textContent));

    // A registered tile the snapshot has dropped is the other direction, and
    // it must keep its slot rather than falling to the bottom.
    const thin = { schema: 1, generated_at: '2026-09-20T12:00:00.000Z', tiles: { dinner: tile('DAILY') } };
    shellState.snapshot = thin;
    renderAll();
    check('a snapshot with one tile still renders the whole board', titles().length === ORDER.length, String(titles().length));
    check('and the missing ones keep their slots, greyed', titles().join(' | ') === ORDER.map((id) => REGISTRY[id].title).join(' | '));
    check(
      'a missing tile says so',
      /Not in this snapshot\./.test(boardEl.querySelectorAll('.grid')[0].childNodes[0].textContent)
    );
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
