#!/usr/bin/env node
/**
 * The Helm — tile render tests. Node, zero deps, no browser.
 *
 *   node tools/test-tiles.js
 *   HELM_SNAPSHOT=/path/to/a/snapshot.json node tools/test-tiles.js
 *
 * Render modules are the one part of the page with no coverage otherwise, and
 * the failure they have is always the same shape: the engine grows a payload,
 * a module reaches into a field that is not there, and one card turns into
 * "This tile failed to render" on a phone. So every module is rendered here
 * against the mock snapshot and against deliberately hostile payloads — empty,
 * half-missing, wrong-typed, and carrying fields no module has heard of.
 *
 * The DOM below is a shim, not jsdom: el() in lib/dom.js uses a small, fixed
 * slice of the DOM, and 60 lines of it beats a dependency (rule 3).
 *
 * With HELM_SNAPSHOT it renders a real snapshot instead — that file is Matt's
 * data, so the test prints pass/fail and node counts, never content.
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

// ----------------------------------------------------------------- DOM shim
//
// Shared with tools/test-weather.js — see tools/dom-shim.js. Requiring it
// installs `global.document`.

const { El, docListenerCount, fireDocEvent } = require('./dom-shim.js');

/**
 * A localStorage shim, because the entertainment tile's "new" counts are a
 * property of the device rather than the snapshot. Node has no localStorage at
 * all, which is itself one of the cases under test: a tile that reaches for it
 * unguarded throws a ReferenceError and takes the card down.
 *
 * `broken: true` is Safari's private mode, where the accessor itself throws.
 */
function fakeStorage(seed = null, { broken = false } = {}) {
  const cell = { value: seed === null ? null : JSON.stringify(seed) };
  return {
    cell,
    get parsed() { return cell.value === null ? null : JSON.parse(cell.value); },
    getItem() { if (broken) throw new Error('private mode'); return cell.value; },
    setItem(_k, v) { if (broken) throw new Error('private mode'); cell.value = String(v); },
  };
}

/** Run `fn` with a given localStorage in place, and always put it back. */
function withStorage(storage, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'localStorage');
  const prev = global.localStorage;
  global.localStorage = storage;
  try { return fn(); } finally {
    if (had) global.localStorage = prev; else delete global.localStorage;
  }
}

/**
 * A fake detail sheet. The newsstand tile is a menu: tapping a button hands a
 * title and a body-builder to ctx.actions.openPanel, and the cards are drawn
 * into whatever body it is given. Here that body is just another shim node,
 * which is exactly what the real sheet's is.
 */
function fakePanel() {
  const calls = [];
  // The shell's half of the bargain (v1.6.0): a builder may hand back a
  // teardown, the previous one is always run before another sheet opens, and
  // closing runs it too. The cards sheet's auction clock depends on all
  // three, so the fake has to honour all three or the test would pass on a
  // shell that leaks intervals.
  let teardown = null;
  const down = () => {
    const fn = teardown;
    teardown = null;
    if (typeof fn === 'function') fn();
  };
  return {
    calls,
    get last() { return calls[calls.length - 1] || null; },
    close: down,
    actions: {
      openPanel(title, build) {
        down();
        const body = new El('div');
        teardown = build(body) || null;
        calls.push({ title, body, teardown });
      },
    },
  };
}

/**
 * A stand-in for setInterval that counts what is actually LIVE.
 *
 * The invariant the cards sheet promises is not "setInterval was called once"
 * — the cadence legitimately changes from 30s to 1s as the first lot comes
 * inside the hour, and that is a clear and a set. It is "at no moment does
 * more than one timer exist, and none survives the close". So the spy tracks
 * handles rather than calls, and exposes both numbers.
 */
function withTimers(fn) {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const live = new Set();
  const spy = { live, created: 0, peak: 0, beat() { for (const h of [...live]) h.fn(); } };
  globalThis.setInterval = (cb, ms) => {
    const h = { fn: cb, ms };
    live.add(h);
    spy.created++;
    spy.peak = Math.max(spy.peak, live.size);
    return h;
  };
  globalThis.clearInterval = (h) => { live.delete(h); };
  try { return fn(spy); } finally {
    globalThis.setInterval = realSet;
    globalThis.clearInterval = realClear;
  }
}

/** Every node's text, flattened — used only to assert that data ARRIVED. */
const textOf = (node) => node.textContent;
const countOf = (node, cls) => node.querySelectorAll('.' + cls).length;

// ------------------------------------------------------------------- tests

async function main() {
  console.log('The Helm — tile render tests\n');

  const REGISTRY_SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'tiles', '_registry.js'), 'utf8');
  const ids = [...REGISTRY_SRC.matchAll(/^\s{2}([a-z0-9_]+):\s*\{[^}]*module:\s*'\.\/(tiles\/[a-z0-9_]+\.js)'/gim)]
    .map((m) => ({ id: m[1], file: m[2] }))
    .filter((t) => t.id !== 'ask'); // the ask panel is a controller, not a tile

  const snapPath = process.env.HELM_SNAPSHOT || path.join(__dirname, '..', 'docs', 'mock', 'helm-data.json');
  const snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  console.log(`snapshot: ${process.env.HELM_SNAPSHOT ? 'REAL (content not printed)' : 'mock'}\n`);

  const mods = new Map();
  for (const { id, file } of ids) mods.set(id, await import('../docs/' + file));

  // -- every registered module renders the snapshot --------------------------
  console.log('renders the snapshot');
  for (const { id } of ids) {
    const tile = snapshot.tiles?.[id];
    if (!tile) { console.log(`  --   ${id} (not in this snapshot)`); continue; }
    const root = new El('div');
    let threw = null;
    try {
      mods.get(id).render(root, tile, { id, actions: {}, snapshot, pending: [], live: null });
    } catch (e) { threw = e; }
    check(`${id} renders`, !threw, threw && threw.message);
    check(`${id} puts something on the page`, !threw && root.childNodes.length > 0);
  }

  // -- hostile payloads: rule 9 in both directions ---------------------------
  console.log('\nhostile payloads (no module may throw)');
  const HOSTILE = [
    ['empty data', {}],
    ['null data', null],
    ['data is a string', 'nope'],
    ['data is an array', [1, 2, 3]],
    ['every value null', { cards: null, items: null, tickets: null, teams: null, days: null, lines: null, spend: null }],
    ['unknown extras only', { some_field_from_2027: 'x', nested: { a: 1 } }],
  ];
  for (const { id } of ids) {
    for (const [label, data] of HOSTILE) {
      const root = new El('div');
      let threw = null;
      try {
        mods.get(id).render(root, { band: 'DAILY', status: 'ok', data }, { id, actions: {} });
      } catch (e) { threw = e; }
      check(`${id} survives ${label}`, !threw, threw && threw.message);
    }
  }

  // -- ship_status specifics -------------------------------------------------
  console.log('\nship_status');
  const ship = mods.get('ship_status');
  if (ship) {
    const full = snapshot.tiles?.ship_status;
    if (full) {
      const root = new El('div');
      ship.render(root, full, { id: 'ship_status', actions: {} });
      check('a spend meter is drawn', countOf(root, 'ship-meter-fill') === 1);
      check('the meter never renders a zero-width bar', /width:\d/.test(root.querySelector('.ship-meter-fill').getAttribute('style')));
      check('the kill switch is printed, not run', countOf(root, 'ship-kill-cmd') === 1);
      check('the footer says display-only', /Display only/.test(textOf(root)));
    }

    // A field the engine adds tomorrow must surface, not vanish (rule 9).
    const grown = { band: 'DAILY', status: 'ok', data: { pending_count: 0, hull_integrity: 'nominal' } };
    const root2 = new El('div');
    ship.render(root2, grown, { id: 'ship_status', actions: {} });
    check('an unknown field is surfaced, not dropped', /hull_integrity/.test(textOf(root2)) && /nominal/.test(textOf(root2)));

    // Partial spend: the meter needs both numbers, the rest must still render.
    const partial = { band: 'DAILY', status: 'ok', data: { spend: { all_time_usd: 4.2 } } };
    const root3 = new El('div');
    ship.render(root3, partial, { id: 'ship_status', actions: {} });
    check('no cap number means no meter, not a broken one', countOf(root3, 'ship-meter-fill') === 0);
    check('the totals it does have still render', /all time/.test(textOf(root3)));

    // A missing boolean must not render as "not yet today".
    const noLog = { band: 'DAILY', status: 'ok', data: { pending_count: 1 } };
    const root4 = new El('div');
    ship.render(root4, noLog, { id: 'ship_status', actions: {} });
    check('an absent captains_log is omitted, not reported false', !/captain/i.test(textOf(root4)));
  }

  // -- newsstand: the category menu ------------------------------------------
  //
  // The tile body is a menu, the stories are in the sheet. So the assertions
  // split the same way: what the BOARD shows (buttons, counts, and nothing
  // else), and what the SHEET shows once a button is tapped.
  console.log('\nnewsstand — the tile menu');
  const news = mods.get('newsstand');
  const tap = (btn) => btn.listeners.click[0]({ stopPropagation() {} });
  const newsTile = (cards, extra = {}) => ({ band: 'HOURLY', status: 'ok', data: { cards, ...extra } });
  const btnsOf = (root) => root.querySelectorAll('.news-menu-btn');
  const countChip = (btn) => btn.querySelector('.news-menu-count').textContent;

  if (news) {
    // First mention decides button order. 'Business' appears first WITHOUT an
    // emoji and again with one; 'tech' arrives a second time in another case;
    // U1 carries no category at all.
    const cards = [
      { title: 'T1', source: 's', url: 'https://example.com/1', category: 'Tech', emoji: '💻', synopsis: 'S-T1', lens: 'L-T1' },
      { title: 'L1', source: 's', url: 'https://example.com/2', category: 'Local News', emoji: '🏙️', synopsis: 'S-L1' },
      { title: 'B1', source: 's', url: 'https://example.com/3', category: 'Business' },
      { title: 'T2', source: 's', url: 'https://example.com/4', category: 'tech', synopsis: 'S-T2' },
      { title: 'U1', source: 's', url: 'https://example.com/5' },
      { title: 'X1', source: 's', url: 'https://example.com/6', category: 'Weather Balloons', emoji: '🎈' },
      { title: 'B2', source: 's', url: 'https://example.com/7', category: 'Business', emoji: '💼' },
      { title: 'T3', source: 's', url: 'javascript:alert(1)', category: 'Tech', synopsis: 'S-T3' },
    ];

    const panel = fakePanel();
    const root = new El('div');
    news.render(root, newsTile(cards, { as_of: new Date().toISOString(), refresh_note: 'next run 07:00' }), {
      id: 'newsstand',
      actions: panel.actions,
    });

    const btns = btnsOf(root);
    check(
      'the menu is derived from the payload, in first-mention order',
      btns.map((b) => b.querySelector('.news-menu-label').textContent).join('|') ===
        'Tech|Local News|Business|Weather Balloons|Uncategorised',
      btns.map((b) => b.querySelector('.news-menu-label').textContent).join('|')
    );
    check('two spellings of one category are one button', btns.length === 5);
    check('each button carries its own count', btns.map(countChip).join() === '3,1,2,1,1', btns.map(countChip).join());
    check('a button wears its category emoji', /💻/.test(btns[0].textContent) && /🏙️/.test(btns[1].textContent));
    check('a category whose first card forgot its emoji still wears one', /💼/.test(btns[2].textContent));
    check('an unknown category still gets a button', /Weather Balloons/.test(btns[3].textContent));
    check('a known category is tinted', btns[0].className.includes('news-menu-tech'));
    check('an unknown category falls back to neutral', btns[3].className.includes('news-menu-neutral'));
    // A card with no category has no button of its own to live under, and must
    // not simply vanish from the board.
    check('uncategorised cards collect in one trailing button', btns[4].querySelector('.news-menu-label').textContent === 'Uncategorised');

    // The whole point of the redesign: the tile is a menu, not a list.
    check('no story cards in the tile body', countOf(root, 'news-card') === 0);
    check('no synopsis in the tile body', !/S-T1/.test(textOf(root)));
    check('no filter rail survives the redesign', countOf(root, 'news-filters') === 0 && countOf(root, 'news-filter') === 0);
    check('one faint line carries as_of and the refresh note', countOf(root, 'tile-foot') === 1);
    check('and it says both', /as of/.test(textOf(root)) && /next run 07:00/.test(textOf(root)));

    // -- the sheet -----------------------------------------------------------
    console.log('\nnewsstand — the category sheet');
    tap(btns[0]); // Tech
    check('a tap opens the sheet', panel.calls.length === 1);
    check('the sheet is titled with the emoji and the category', panel.last.title === '💻 Tech');
    const inSheet = (body) => body.querySelectorAll('.news-card').map((c) => c.querySelector('.news-title').textContent);
    check('the sheet holds that category only', inSheet(panel.last.body).join() === 'T1,T2,T3', inSheet(panel.last.body).join());
    check('across casings', inSheet(panel.last.body).includes('T2'));
    check('an uncategorised card is not in it', !inSheet(panel.last.body).includes('U1'));

    const sheet = panel.last.body;
    check('the cards render in full', /S-T1/.test(textOf(sheet)) && /L-T1/.test(textOf(sheet)));
    check('each card wears its category chip', countOf(sheet, 'news-cat') === 3);
    check('every synopsis starts clamped', countOf(sheet, 'clamped') === 3);
    check('the "more" toggle exists per synopsis', countOf(sheet, 'news-more') === 3);
    check('expanding unclamps', (sheet.querySelector('.news-more').listeners.click[0]({ stopPropagation() {} }), countOf(sheet, 'clamped') === 2));
    check(
      'a javascript: url is inert text, never a link',
      !sheet.querySelectorAll('A').some((a) => /javascript/i.test(a.getAttribute('href') || ''))
    );
    check('a real url is a link', sheet.querySelectorAll('A').some((a) => a.getAttribute('href') === 'https://example.com/1'));

    tap(btns[4]); // Uncategorised
    check('the uncategorised button opens its own cards', inSheet(panel.last.body).join() === 'U1');
    check('and is titled without an emoji it never had', panel.last.title === 'Uncategorised');

    tap(btns[3]); // Weather Balloons — a category no tone palette has heard of
    check('an unknown category opens like any other', inSheet(panel.last.body).join() === 'X1');
    check('the board is unchanged by any of it', countOf(root, 'news-card') === 0 && btnsOf(root).length === 5);

    // -- nothing to show -----------------------------------------------------
    const none = new El('div');
    news.render(none, newsTile([]), { id: 'newsstand', actions: panel.actions });
    check('an empty payload renders no menu', countOf(none, 'news-menu-btn') === 0);
    check('an empty payload says so', /No paper yet/.test(textOf(none)));

    // -- no sheet to open ----------------------------------------------------
    // An older shell, or the generic-card path: the menu goes inert rather
    // than throwing on a phone (rule 8).
    const inert = new El('div');
    let threw = null;
    try {
      news.render(inert, newsTile(cards), { id: 'newsstand', actions: {} });
      tap(btnsOf(inert)[0]);
    } catch (e) { threw = e; }
    check('a tap with no panel action never reaches the page', !threw, threw && threw.message);

    // -- raw RSS v2 ----------------------------------------------------------
    //
    // The engine stopped curating: up to 200 cards from ~40 feeds, newest
    // first, `lens` always null and `synopsis` often null. Everything below is
    // about the tile surviving that — and about the three things the payload
    // grew: `by_category`, `published_at`, and `sources`.
    //
    // Every headline, source and URL here is invented (rule 1).
    console.log('\nnewsstand — raw RSS v2');

    const fmt = await import('../docs/lib/fmt.js');

    // Seventeen categories in the feed config's order — which is the order the
    // buttons must come out in, whatever order the cards arrive in. The last
    // one is deliberately something no tone palette has heard of.
    const CATS = [
      { name: 'Local News', emoji: '🏙️' },
      { name: 'Local Sports', emoji: '🏟️' },
      { name: 'National Politics', emoji: '🏛️' },
      { name: 'Tech', emoji: '💻' },
      { name: 'Business', emoji: '💼' },
      { name: 'Markets', emoji: '📈' },
      { name: 'Soccer', emoji: '⚽' },
      { name: 'Science', emoji: '🔬' },
      { name: 'Space', emoji: '🚀' },
      { name: 'Gaming', emoji: '🎮' },
      { name: 'Books', emoji: '📚' },
      { name: 'Film', emoji: '🎬' },
      { name: 'Music', emoji: '🎵' },
      { name: 'Food', emoji: '🍲' },
      { name: 'Weather', emoji: '🌦️' },
      { name: 'Odd Lots', emoji: '🎩' },
      { name: 'Ferret Fancying', emoji: '🦦' },
    ];

    // 200 cards, dealt so that FIRST-MENTION order is nothing like the config
    // order — otherwise the ordering assertion would pass on the old
    // behaviour. gcd(7, 17) = 1, so every category is hit.
    const bulk = [];
    for (let i = 0; i < 200; i++) {
      const cat = CATS[(i * 7) % CATS.length];
      bulk.push({
        title: `Invented headline ${i}`,
        synopsis: i % 3 === 0 ? null : `Invented synopsis ${i}.`,
        source: `Fictional Gazette ${i % 40}`,
        url: `https://example.com/story/${i}`,
        lens: null,
        category: cat.name,
        emoji: cat.emoji,
        published_at: new Date(Date.now() - i * 60000).toISOString(),
      });
    }
    const expectedCounts = CATS.map((c) => bulk.filter((b) => b.category === c.name).length);

    const bulkPanel = fakePanel();
    const bulkRoot = new El('div');
    news.render(
      bulkRoot,
      newsTile(bulk, {
        count: bulk.length,
        as_of: new Date().toISOString(),
        // `n` here is deliberately wrong: the counts on the buttons must be
        // counted off the cards that actually arrived, never trusted from the
        // engine's summary.
        by_category: CATS.map((c) => ({ name: c.name, emoji: c.emoji, n: 999 })),
        sources: { ok: 40, failed: [], total: 40 },
      }),
      { id: 'newsstand', actions: bulkPanel.actions }
    );

    const bulkBtns = btnsOf(bulkRoot);
    check('200 cards across 17 categories give 17 buttons', bulkBtns.length === 17, String(bulkBtns.length));
    check(
      'the buttons follow by_category, not first mention',
      bulkBtns.map((b) => b.querySelector('.news-menu-label').textContent).join('|') ===
        CATS.map((c) => c.name).join('|'),
      bulkBtns.map((b) => b.querySelector('.news-menu-label').textContent).join('|')
    );
    check(
      'counts are counted off the cards, not read from by_category.n',
      bulkBtns.map(countChip).join() === expectedCounts.join(),
      bulkBtns.map(countChip).join()
    );
    check('no button claims the summary count', !/999/.test(textOf(bulkRoot)));
    check('200 cards still put no story on the board', countOf(bulkRoot, 'news-card') === 0);

    // A category the config lists but no card arrived for gets no button: the
    // count is the cards', so an empty button would be a lie one tap deep.
    const ghostRoot = new El('div');
    news.render(
      ghostRoot,
      newsTile([{ title: 'Only one', source: 'Fictional Gazette', url: 'https://example.com/only', category: 'Tech', emoji: '💻' }], {
        by_category: [{ name: 'Markets', emoji: '📈', n: 4 }, { name: 'Tech', emoji: '💻', n: 1 }],
      }),
      { id: 'newsstand', actions: {} }
    );
    check('a by_category entry with no cards gets no button', btnsOf(ghostRoot).length === 1);
    check('and the one that does arrive still renders', /Tech/.test(textOf(ghostRoot)));

    // A category the cards mention but the config forgot must still appear —
    // rule 9, appended after the ordered ones rather than dropped.
    const strayRoot = new El('div');
    news.render(
      strayRoot,
      newsTile(
        [
          { title: 'A', source: 'Fictional Gazette', url: 'https://example.com/a', category: 'Ferret Fancying', emoji: '🦦' },
          { title: 'B', source: 'Fictional Gazette', url: 'https://example.com/b', category: 'Tech', emoji: '💻' },
        ],
        { by_category: [{ name: 'Tech', emoji: '💻', n: 1 }] }
      ),
      { id: 'newsstand', actions: {} }
    );
    check(
      'a category missing from by_category is appended, not dropped',
      btnsOf(strayRoot).map((b) => b.querySelector('.news-menu-label').textContent).join('|') === 'Tech|Ferret Fancying',
      btnsOf(strayRoot).map((b) => b.querySelector('.news-menu-label').textContent).join('|')
    );

    // -- no cap --------------------------------------------------------------
    //
    // A busy category can hold dozens of stories. The sheet scrolls; it does
    // not truncate, because there is nothing on screen that would say it had.
    const deep = [];
    for (let i = 0; i < 200; i++) {
      deep.push({
        title: `Deep headline ${i}`,
        source: 'Fictional Gazette',
        url: `https://example.com/deep/${i}`,
        category: 'Tech',
        emoji: '💻',
        published_at: new Date(Date.now() - i * 60000).toISOString(),
      });
    }
    const deepPanel = fakePanel();
    const deepRoot = new El('div');
    news.render(deepRoot, newsTile(deep), { id: 'newsstand', actions: deepPanel.actions });
    tap(btnsOf(deepRoot)[0]);
    check('the sheet holds every card in the category, uncapped', countOf(deepPanel.last.body, 'news-card') === 200, String(countOf(deepPanel.last.body, 'news-card')));
    check('including the last one', /Deep headline 199/.test(textOf(deepPanel.last.body)));

    // -- nulls are absences, never the word "null" ---------------------------
    const nullPanel = fakePanel();
    const nullRoot = new El('div');
    const nullCards = [
      { title: 'Title only', synopsis: null, source: 'Fictional Gazette', url: 'https://example.com/n1', lens: null, category: 'Tech', emoji: '💻', published_at: null },
      { title: 'Bare card', synopsis: null, source: null, url: 'https://example.com/n2', lens: null, category: 'Tech', emoji: null, published_at: null },
    ];
    news.render(nullRoot, newsTile(nullCards, { count: 2 }), { id: 'newsstand', actions: nullPanel.actions });
    tap(btnsOf(nullRoot)[0]);
    const nullSheet = nullPanel.last.body;
    check('no "null" anywhere in the tile body', !/null/i.test(textOf(nullRoot)), textOf(nullRoot));
    check('no "null" anywhere in the sheet', !/null/i.test(textOf(nullSheet)), textOf(nullSheet));
    check('a null lens renders nothing at all', countOf(nullSheet, 'news-lens') === 0);
    check('a null synopsis renders nothing at all', countOf(nullSheet, 'news-synopsis') === 0 && countOf(nullSheet, 'news-more') === 0);
    check('a card with only a title is still a card', countOf(nullSheet, 'news-card') === 2);
    check('and its title is still a link', nullSheet.querySelectorAll('A').some((a) => a.getAttribute('href') === 'https://example.com/n1'));

    // -- the age chip --------------------------------------------------------
    //
    // The rungs are checked against a FIXED clock on the helper itself; the
    // tile is then checked to be rendering that same helper's answer.
    const FIXED = Date.parse('2026-09-19T18:00:00Z'); // 1:00 PM Central
    const before = (ms) => new Date(FIXED - ms).toISOString();
    check('ageChip: under a minute is "now"', fmt.ageChip(before(30 * 1000), FIXED) === 'now', fmt.ageChip(before(30 * 1000), FIXED));
    check('ageChip: minutes', fmt.ageChip(before(12 * 60000), FIXED) === '12m', fmt.ageChip(before(12 * 60000), FIXED));
    check('ageChip: hours', fmt.ageChip(before(3 * 3600000), FIXED) === '3h', fmt.ageChip(before(3 * 3600000), FIXED));
    check('ageChip: just over a day is "yesterday"', fmt.ageChip(before(25 * 3600000), FIXED) === 'yesterday', fmt.ageChip(before(25 * 3600000), FIXED));
    check('ageChip: inside the week is a weekday', fmt.ageChip(before(3 * 86400000), FIXED) === 'Wed', fmt.ageChip(before(3 * 86400000), FIXED));
    check('ageChip: older than a week is a date', fmt.ageChip(before(9 * 86400000), FIXED) === '9/10', fmt.ageChip(before(9 * 86400000), FIXED));
    check('ageChip: a stamp from the future is just new', fmt.ageChip(new Date(FIXED + 60000).toISOString(), FIXED) === 'now');
    check('ageChip: junk gives no chip', fmt.ageChip('not a date', FIXED) === '' && fmt.ageChip(null, FIXED) === '');
    // Rule 7: a date-only string is never parsed as an instant.
    check('ageChip: a date-only string is refused, not parsed', fmt.ageChip('2026-09-12', FIXED) === '', fmt.ageChip('2026-09-12', FIXED));

    const agePanel = fakePanel();
    const ageRoot = new El('div');
    const stamped = new Date(Date.now() - 12 * 60000).toISOString();
    news.render(
      ageRoot,
      newsTile([
        { title: 'Stamped', source: 'Fictional Gazette', url: 'https://example.com/s1', category: 'Tech', emoji: '💻', published_at: stamped },
        { title: 'Unstamped', source: 'Fictional Gazette', url: 'https://example.com/s2', category: 'Tech', emoji: '💻' },
      ]),
      { id: 'newsstand', actions: agePanel.actions }
    );
    tap(btnsOf(ageRoot)[0]);
    const ageSheet = agePanel.last.body;
    const ageCards = ageSheet.querySelectorAll('.news-card');
    check('a card with published_at wears a chip', countOf(ageCards[0], 'news-age') === 1);
    check(
      'and the chip is the helper’s own answer',
      ageCards[0].querySelector('.news-age').textContent === fmt.ageChip(stamped),
      ageCards[0].querySelector('.news-age').textContent
    );
    check('a card with no published_at wears no chip element', countOf(ageCards[1], 'news-age') === 0);

    // -- the source name is required -----------------------------------------
    check('every row shows its source', ageSheet.querySelectorAll('.news-source').length === 2);
    check('the source is the feed’s own name', ageSheet.querySelector('.news-source').textContent === 'Fictional Gazette');

    // -- external links ------------------------------------------------------
    const anchors = ageSheet.querySelectorAll('A');
    check('external links still open in a new tab', anchors.length > 0 && anchors.every((a) => a.getAttribute('target') === '_blank'));
    check('and still carry rel="noopener"', anchors.every((a) => /noopener/.test(a.getAttribute('rel') || '')));

    // -- stale: the cards, and a count of feeds -------------------------------
    //
    // Forty feeds means one fails most runs. That is the normal cost of doing
    // business, not an incident — the board says how many answered, and the
    // raw error stays off it entirely.
    const ERR = 'r/bobiverse: HTTP Error 429: Too Many Requests';
    const stalePanel = fakePanel();
    const staleRoot = new El('div');
    news.render(
      staleRoot,
      {
        band: 'HOURLY',
        status: 'stale',
        error: ERR,
        data: {
          cards: bulk.slice(0, 20),
          by_category: CATS.map((c) => ({ name: c.name, emoji: c.emoji, n: 1 })),
          sources: { ok: 36, failed: [ERR, 'another feed: HTTP Error 500'], total: 40 },
          as_of: new Date().toISOString(),
        },
      },
      { id: 'newsstand', actions: stalePanel.actions }
    );
    check('a stale run still renders its cards', btnsOf(staleRoot).length > 0);
    check(
      'and one muted line counts the feeds',
      countOf(staleRoot, 'news-sources') === 1 && staleRoot.querySelector('.news-sources').textContent === '36 of 40 sources answered',
      staleRoot.querySelector('.news-sources') && staleRoot.querySelector('.news-sources').textContent
    );
    check('the raw error never reaches the board', !/429/.test(textOf(staleRoot)) && !/bobiverse/i.test(textOf(staleRoot)));

    // The shell paints tile.error above every tile body. This tile says the
    // same thing better, so it DECLARES that and app.js stands down — rather
    // than the tile reaching back and deleting a node the shell painted,
    // which is the wrong direction of dependency and would break silently
    // the day app.js changed that markup. The shell's half of the contract
    // is tested in tools/test-shell.js.
    check('the module claims its own error line', news.ownsErrorLine === true);

    // Opt-IN: the flag is a thing a tile has to say. Every other module stays
    // silent and keeps the shell's red line.
    const claimers = [...mods.entries()]
      .filter(([, m]) => m.ownsErrorLine !== undefined)
      .map(([tileId]) => tileId);
    check('and it is the only tile that claims one', claimers.join() === 'newsstand', claimers.join() || '(none)');

    // Missing totals must not print "NaN of NaN".
    const vagueRoot = new El('div');
    news.render(
      vagueRoot,
      { band: 'HOURLY', status: 'stale', error: 'something', data: { cards: bulk.slice(0, 5) } },
      { id: 'newsstand', actions: {} }
    );
    check('no sources block still says something honest', /sources/.test(textOf(vagueRoot)) && !/NaN/.test(textOf(vagueRoot)), textOf(vagueRoot));

    // -- error: the last paper stays up --------------------------------------
    news._resetMemory();
    const coldRoot = new El('div');
    news.render(coldRoot, { band: 'HOURLY', status: 'error', error: 'engine down', data: { cards: [] } }, { id: 'newsstand', actions: {} });
    check('error with nothing behind it falls back to the generic card', countOf(coldRoot, 'news-menu-btn') === 0 && countOf(coldRoot, 'generic') + countOf(coldRoot, 'empty') > 0);

    const warmRoot = new El('div');
    news.render(warmRoot, newsTile(bulk.slice(0, 20), { by_category: CATS.map((c) => ({ name: c.name, emoji: c.emoji, n: 1 })), sources: { ok: 40, failed: [], total: 40 } }), { id: 'newsstand', actions: {} });
    const warmBtns = btnsOf(warmRoot).length;
    const afterRoot = new El('div');
    news.render(afterRoot, { band: 'HOURLY', status: 'error', error: 'engine down', data: { cards: [] } }, { id: 'newsstand', actions: {} });
    check('error keeps the last set that rendered', btnsOf(afterRoot).length === warmBtns && warmBtns > 0);
    check('and says it is the last one', /last paper/.test(textOf(afterRoot)) && /40 of 40 sources answered/.test(textOf(afterRoot)), textOf(afterRoot));
    check('the raw error stays off that board too', !/engine down/.test(textOf(afterRoot)));
    news._resetMemory();
  }

  // -- entertainment: the four-face menu ------------------------------------
  //
  // Two things are being tested that no other tile has: a menu whose buttons
  // come from faces the engine may not have built yet, and a count that lives
  // on the DEVICE rather than in the snapshot. So the localStorage the tile
  // reads is a shim here, seeded per case.
  console.log('\nentertainment — the face menu');
  const ent = mods.get('entertainment');
  const entBtns = (root) => root.querySelectorAll('.ent-btn');
  const entLabels = (root) => entBtns(root).map((b) => b.querySelector('.ent-btn-label').textContent);
  const chipOf = (btn) => btn.querySelector('.ent-count');

  // Central business dates, built from parts — the same arithmetic the mock
  // generator uses, and never `new Date('YYYY-MM-DD')`.
  const CT_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  const ctNow = CT_FMT.format(new Date());
  const ymd = (n) => {
    const [y, m, d] = ctNow.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    const p = (v) => String(v).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
  };
  const daysAgoIso = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const entTile = (data) => ({ band: 'DAILY', status: 'ok', data });
  const LS_KEY = 'helm.entertainment.lastOpened';

  if (ent) {
    // -- the board: four buttons, two of them not built yet -------------------
    const shipped = entTile({
      watching: { updated_at: daysAgoIso(30), items: [], errors: null },
      podcasts: { updated_at: daysAgoIso(30), items: [], errors: null },
      top5: null,
      listening: null,
      attribution: 'Data from TMDB',
    });

    const board = withStorage(fakeStorage({ watching: daysAgoIso(1), podcasts: daysAgoIso(1) }), () => {
      const r = new El('div');
      ent.render(r, shipped, { id: 'entertainment', actions: {} });
      return r;
    });

    check('all four faces get a button', entBtns(board).length === 4, String(entBtns(board).length));
    check(
      'in the ruled order',
      entLabels(board).join('|') === 'Watching|Podcasts|Top 5|Listening',
      entLabels(board).join('|')
    );
    check('each wears its own glyph', /📺/.test(entBtns(board)[0].textContent) && /🎧/.test(entBtns(board)[3].textContent));
    // E2: a face the engine has not built is visible as coming, not missing.
    check('a null face is greyed', entBtns(board)[2].className.includes('ent-btn-soon') && entBtns(board)[3].className.includes('ent-btn-soon'));
    check('and says "soon"', entBtns(board)[2].querySelector('.ent-soon').textContent === 'soon');
    check('and cannot be tapped', entBtns(board)[2].getAttribute('disabled') === 'disabled');
    check('a populated face is not greyed', !entBtns(board)[0].className.includes('ent-btn-soon'));
    check('a populated face is tappable', !entBtns(board)[0].getAttribute('disabled'));
    // E8: quiet by default. Nothing new means no chip — not a zero.
    check('an empty face shows no count chip', !chipOf(entBtns(board)[0]) && !chipOf(entBtns(board)[1]));
    check('a greyed face has no count chip', !chipOf(entBtns(board)[2]));
    check('nothing is listed on the board itself', countOf(board, 'ent-row') === 0);

    // -- the counts -----------------------------------------------------------
    console.log('\nentertainment — counts against lastOpened');
    //
    // Opened ten days ago. Of the watching rows, only the one whose last
    // episode aired since then is new; the row with no `last` at all has no
    // arrival stamp of its own and falls back to the face, which is older
    // still. Of the podcasts, the recent instant and the recent date-only both
    // count; the twelve-day-old one does not.
    const SINCE = daysAgoIso(10);
    const counted = entTile({
      watching: {
        updated_at: daysAgoIso(30),
        items: [
          { title: 'Aired since', last: { season: 1, episode: 4, air_date: ymd(-3) } },
          { title: 'Aired long before', last: { season: 1, episode: 1, air_date: ymd(-20) } },
          { title: 'Never aired', last: null },
        ],
      },
      podcasts: {
        updated_at: daysAgoIso(30),
        items: [
          { show: 'A', title: 'fresh instant', published_at: daysAgoIso(0.04), published: ymd(0) },
          { show: 'A', title: 'old instant', published_at: daysAgoIso(12), published: ymd(-12) },
          { show: 'B', title: 'date only, recent', published: ymd(-1) },
        ],
      },
      top5: null,
      listening: null,
    });

    const seen = withStorage(fakeStorage({ watching: SINCE, podcasts: SINCE }), () => {
      const r = new El('div');
      ent.render(r, counted, { id: 'entertainment', actions: {} });
      return r;
    });
    check('watching counts only what aired since it was last opened', chipOf(entBtns(seen)[0]).textContent === '1 new', chipOf(entBtns(seen)[0])?.textContent);
    check('podcasts counts instants and date-only alike', chipOf(entBtns(seen)[1]).textContent === '2 new', chipOf(entBtns(seen)[1])?.textContent);

    // An item with no arrival stamp of its own falls back to the face: the
    // same payload, with a face that refreshed since the last open.
    const freshFace = JSON.parse(JSON.stringify(counted.data));
    freshFace.watching.updated_at = daysAgoIso(1);
    const fell = withStorage(fakeStorage({ watching: SINCE }), () => {
      const r = new El('div');
      ent.render(r, entTile(freshFace), { id: 'entertainment', actions: {} });
      return r;
    });
    check('an item with no stamp of its own follows the face', chipOf(entBtns(fell)[0]).textContent === '2 new', chipOf(entBtns(fell)[0])?.textContent);

    // Never opened here, storage blocked, storage full of junk — all three
    // mean the same thing, and it is never "nothing new".
    const never = withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, counted, { id: 'entertainment', actions: {} });
      return r;
    });
    check('a face never opened on this device counts everything', chipOf(entBtns(never)[0]).textContent === '3 new', chipOf(entBtns(never)[0])?.textContent);

    const blocked = withStorage(fakeStorage(null, { broken: true }), () => {
      const r = new El('div');
      ent.render(r, counted, { id: 'entertainment', actions: {} });
      return r;
    });
    check('storage that throws counts everything rather than nothing', chipOf(entBtns(blocked)[1]).textContent === '3 new', chipOf(entBtns(blocked)[1])?.textContent);

    const junk = withStorage({ getItem: () => 'not json at all', setItem() {} }, () => {
      const r = new El('div');
      ent.render(r, counted, { id: 'entertainment', actions: {} });
      return r;
    });
    check('unparseable storage counts everything', chipOf(entBtns(junk)[0]).textContent === '3 new', chipOf(entBtns(junk)[0])?.textContent);

    // A stamp that is a date-only string rather than an instant — written by
    // some older build, or a hand edit. Comparing a business date against it
    // would be a day wrong forever, so it reads as "never opened here".
    const badStamp = withStorage(fakeStorage({ watching: ymd(-10) }), () => {
      const r = new El('div');
      ent.render(r, counted, { id: 'entertainment', actions: {} });
      return r;
    });
    check('a stamp that is not an instant is not trusted', chipOf(entBtns(badStamp)[0]).textContent === '3 new', chipOf(entBtns(badStamp)[0])?.textContent);

    // No localStorage on the object at all — Node, and any browser that has
    // taken it away. An unguarded reach here is a ReferenceError on a phone.
    const none = withStorage(undefined, () => {
      const r = new El('div');
      let threw = null;
      try { ent.render(r, counted, { id: 'entertainment', actions: {} }); } catch (e) { threw = e; }
      return { r, threw };
    });
    check('no localStorage at all never throws', !none.threw, none.threw && none.threw.message);
    check('and still counts everything as new', chipOf(entBtns(none.r)[0]).textContent === '3 new');

    // -- opening a face -------------------------------------------------------
    console.log('\nentertainment — opening a face');
    const store = fakeStorage({ watching: SINCE, podcasts: SINCE });
    const panel2 = fakePanel();
    const opened = withStorage(store, () => {
      const r = new El('div');
      ent.render(r, counted, { id: 'entertainment', actions: panel2.actions });
      const btn = entBtns(r)[0];
      const chip = chipOf(btn);
      tap(btn);
      return { r, btn, chip };
    });
    check('a tap opens the sheet', panel2.calls.length === 1);
    check('titled with the glyph and the face', panel2.last.title === '📺 Watching', panel2.last.title);
    check('opening stamps the face on this device', !!withStorage(store, () => store.parsed)?.watching);
    check('and leaves the other face alone', withStorage(store, () => store.parsed).podcasts === SINCE);
    check('the chip goes quiet on the spot', opened.chip.className.includes('hidden'));

    // An older shell with no panel action: inert, and nothing is marked seen
    // either — a face cannot be "opened" if it never opened.
    const store2 = fakeStorage({ watching: SINCE });
    const inertEnt = withStorage(store2, () => {
      const r = new El('div');
      let threw = null;
      try {
        ent.render(r, counted, { id: 'entertainment', actions: {} });
        tap(entBtns(r)[0]);
      } catch (e) { threw = e; }
      return threw;
    });
    check('a tap with no panel action never reaches the page', !inertEnt, inertEnt && inertEnt.message);
    check('and does not mark an unopened face as seen', withStorage(store2, () => store2.parsed).watching === SINCE);

    // -- the watching sheet ---------------------------------------------------
    console.log('\nentertainment — the Watching sheet');
    const watchTile = entTile({
      watching: {
        // Deliberately stale, so the only row that can read as new is the one
        // whose own episode aired since — not every row falling back to a
        // face that happened to refresh this morning.
        updated_at: daysAgoIso(40),
        items: [
          {
            title: 'The Quiet Ledger',
            platform: 'Apple TV+',
            link: 'https://example.com/quiet-ledger',
            next: { season: 3, episode: 4, name: 'A Clerical Error', air_date: '2026-03-01' },
            last: { season: 3, episode: 3, air_date: ymd(-5) },
            days: 2,
            status_note: 'airing weekly',
          },
          { title: 'Bell Foundry', platform: 'Max', link: 'https://example.com/bell', next: null, last: null, days: null, status_note: 'schedule not published' },
          { title: 'Northbound', platform: 'Netflix', link: 'javascript:alert(1)', next: { season: 4, episode: 1, name: 'Premiere', air_date: ymd(40) }, last: null, days: 40, status_note: null },
        ],
        errors: ['tmdb timed out for one title'],
      },
      podcasts: null,
      top5: null,
      listening: null,
      attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    });

    const wPanel = fakePanel();
    withStorage(fakeStorage({ watching: SINCE }), () => {
      const r = new El('div');
      ent.render(r, watchTile, { id: 'entertainment', actions: wPanel.actions });
      tap(entBtns(r)[0]);
    });
    const wSheet = wPanel.last.body;
    const wText = textOf(wSheet);
    check('one row per show', countOf(wSheet, 'ent-row') === 3, String(countOf(wSheet, 'ent-row')));
    check('the next episode reads S{n}E{m} · {name}', /S3E4 · A Clerical Error/.test(wText));
    check('a show with nothing scheduled says so', /no episode scheduled/.test(wText));

    // RULE 7, the disqualifying bug. '2026-03-01' is a Sunday; parsed as an
    // instant it lands on Feb 28 for anyone in Central. The date on this row
    // is built from the parts, so it cannot move.
    check('an air date is rendered from its parts', /Sun Mar 1\b/.test(wText), 'expected "Sun Mar 1"');
    check('and never shifts a day under new Date()', !/Feb 28/.test(wText));

    // The chip is airLabel, not dueLabel: an episode is not owed, so it never
    // says "due". Tones are dueLabel's, so three days out looks the same
    // urgency here as it does on Purser.
    const wPills = wSheet.querySelectorAll('.pill');
    check(
      'the chip counts forward, and only where there is a count',
      wPills.map((x) => x.textContent).join('|') === 'in 2d|in 40d',
      wPills.map((x) => x.textContent).join('|')
    );
    check('and it carries the shared tone ladder', wPills[0].className.includes('pill-warn') && wPills[1].className.includes('pill-neutral'));
    check('nothing in the sheet says "due"', !/\bdue\b/i.test(wText));

    // The two wordings the chip exists for, on their own payload so the row
    // counts above stay readable.
    const soonPanel = fakePanel();
    withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, entTile({
        watching: {
          updated_at: daysAgoIso(1),
          items: [
            { title: 'Drops today', platform: 'Hulu', link: 'https://example.com/a', next: { season: 1, episode: 2, name: 'Tonight', air_date: ymd(0) }, days: 0 },
            { title: 'Drops tomorrow', platform: 'Hulu', link: 'https://example.com/b', next: { season: 1, episode: 3, name: 'Then', air_date: ymd(1) }, days: 1 },
          ],
        },
        podcasts: null, top5: null, listening: null,
      }), { id: 'entertainment', actions: soonPanel.actions });
      tap(entBtns(r)[0]);
    });
    const soonPills = soonPanel.last.body.querySelectorAll('.pill');
    check('an episode landing today reads "airs today"', soonPills[0].textContent === 'airs today', soonPills[0].textContent);
    check('and is red, exactly as a bill due today is', soonPills[0].className.includes('pill-bad'));
    check('an episode landing tomorrow reads "tomorrow"', soonPills[1].textContent === 'tomorrow', soonPills[1].textContent);
    check('and is amber', soonPills[1].className.includes('pill-warn'));
    check('a platform chip is printed', countOf(wSheet, 'ent-platform') === 3 && /Apple TV\+/.test(wText));
    check('the status note is carried through', /airing weekly/.test(wText) && /schedule not published/.test(wText));
    check('a row is a link to the platform', wSheet.querySelectorAll('A').some((a) => a.getAttribute('href') === 'https://example.com/quiet-ledger'));
    check('and opens in a new tab, safely', wSheet.querySelectorAll('A').every((a) => a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || '')));
    check('a javascript: link is never a link', !wSheet.querySelectorAll('A').some((a) => /javascript/i.test(a.getAttribute('href') || '')));
    check('but that row still renders', /Northbound/.test(wText));
    check('the episode that aired since last open is marked new', countOf(wSheet, 'ent-new-mark') === 1, String(countOf(wSheet, 'ent-new-mark')));
    check('a face error is reported, not swallowed', /tmdb timed out/.test(wText));
    check('TMDB is credited in the footer', /not endorsed or certified by TMDB/.test(wText));

    // -- the podcasts sheet ---------------------------------------------------
    console.log('\nentertainment — the Podcasts sheet');
    const podTile = entTile({
      watching: null,
      podcasts: {
        updated_at: daysAgoIso(30),
        items: [
          { show: 'Ledger & Lamp', title: 'older lamp', published: ymd(-9), published_at: daysAgoIso(9), duration_min: 44, url: 'https://example.com/lamp-2' },
          { show: 'Mock Fork', title: 'newest fork', published: '2026-03-01', published_at: daysAgoIso(0.04), duration_min: 58, url: 'https://example.com/fork-1' },
          { show: 'Ledger & Lamp', title: 'newer lamp', published: ymd(-2), published_at: daysAgoIso(2), duration_min: null, url: 'https://example.com/lamp-1' },
          { show: 'Mock Fork', title: 'older fork', published: ymd(-13), published_at: daysAgoIso(13), duration_min: 63, url: 'javascript:alert(1)' },
        ],
      },
      top5: null,
      listening: null,
    });

    const pPanel = fakePanel();
    withStorage(fakeStorage({ podcasts: daysAgoIso(5) }), () => {
      const r = new El('div');
      ent.render(r, podTile, { id: 'entertainment', actions: pPanel.actions });
      tap(entBtns(r)[1]);
    });
    const pSheet = pPanel.last.body;
    const pText = textOf(pSheet);
    const heads = pSheet.querySelectorAll('.ent-group-head').map((h) => h.textContent);
    const titles = pSheet.querySelectorAll('.ent-row-title').map((t) => t.textContent);
    check('episodes are grouped by show', heads.join('|') === 'Mock Fork|Ledger & Lamp', heads.join('|'));
    check('shows are ordered by whichever dropped last', heads[0] === 'Mock Fork');
    check('and each show is newest-first inside', titles.join('|') === 'newest fork|older fork|newer lamp|older lamp', titles.join('|'));
    check('a duration is printed', /58 min/.test(pText));
    check('a missing duration is simply absent', !/null min|NaN/.test(pText));
    check('the published date is rendered from its parts', /Sun Mar 1\b/.test(pText));
    check('and never shifts a day', !/Feb 28/.test(pText));
    check('only episodes published since the last open are marked new', countOf(pSheet, 'ent-new-mark') === 2, String(countOf(pSheet, 'ent-new-mark')));
    check('a row links to the episode', pSheet.querySelectorAll('A').some((a) => a.getAttribute('href') === 'https://example.com/fork-1'));
    check('a javascript: episode url is inert', !pSheet.querySelectorAll('A').some((a) => /javascript/i.test(a.getAttribute('href') || '')));
    check('the footer says what "new" actually means, once', (pText.match(/not unheard/g) || []).length === 1);

    // -- the top 5 sheet ------------------------------------------------------
    console.log('\nentertainment — the Top 5 sheet');
    //
    // The face the engine ranks and the page does not: five rows in payload
    // order, numbered 1..5, with every optional field missing on at least one
    // of them. `week_of` is the rule-7 trap — '2026-09-14' is a Monday, and
    // parsed as an instant it renders as Sunday the 13th for anyone Central.
    const top5Tile = entTile({
      watching: null,
      podcasts: null,
      top5: {
        updated_at: daysAgoIso(40),
        week_of: '2026-09-14',
        items: [
          {
            title: 'The Kerosene Clerk',
            year: 2025,
            genre: 'Thriller',
            provider: 'Paramount+',
            link: 'https://example.com/film/kerosene',
            rating: 7.8,
            overview: 'A records officer notices every fire report was filed by the same hand.',
            tmdb_id: 910111,
            poster: 'https://image.example.com/w185/kerosene.jpg',
          },
          { title: 'Nine Miles', year: 2024, genre: 'Spy', provider: 'Netflix', link: 'https://example.com/film/nine', rating: 7.2, overview: 'A courier with one delivery left.', poster: null },
          { title: 'Halyard', year: 2026, genre: 'Science Fiction', provider: 'Apple TV+', link: 'https://example.com/film/halyard', rating: 8.1, overview: 'A tether to geostationary orbit.', poster: 'javascript:alert(1)' },
          { title: 'Cold Harbour', year: 2025, genre: 'Spy', provider: 'Max', link: 'https://example.com/film/cold', rating: null, overview: 'Two retired handlers meet for lunch.', poster: null },
          { title: 'The Long Quiet', year: null, genre: null, provider: null, link: null, rating: 6.9, overview: null, poster: null },
        ],
        errors: null,
      },
      listening: null,
      attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    });

    const tPanel = fakePanel();
    withStorage(fakeStorage({ top5: daysAgoIso(5) }), () => {
      const r = new El('div');
      ent.render(r, top5Tile, { id: 'entertainment', actions: tPanel.actions });
      tap(entBtns(r)[2]);
    });
    const tSheet = tPanel.last.body;
    const tText = textOf(tSheet);
    const tRows = tSheet.querySelectorAll('.ent-row');
    const ranks = tSheet.querySelectorAll('.ent-rank').map((n) => n.textContent);
    const tTitles = tSheet.querySelectorAll('.ent-row-title').map((n) => n.textContent);

    check('the Top 5 face has its own body now, not the generic card', !/tmdb_id:/.test(tText));
    check('five rows', tRows.length === 5, String(tRows.length));
    check('numbered 1 to 5', ranks.join('') === '12345', ranks.join('|'));
    check(
      'in the order the engine ranked them',
      tTitles.join('|') === 'The Kerosene Clerk|Nine Miles|Halyard|Cold Harbour|The Long Quiet',
      tTitles.join('|')
    );
    check('the year rides faint beside the title', /\(2025\)/.test(tText) && /\(2024\)/.test(tText));
    check('a film with no year simply has none', tSheet.querySelectorAll('.ent-year').length === 4, String(tSheet.querySelectorAll('.ent-year').length));
    check('the genre is a quiet second line', tSheet.querySelectorAll('.ent-genre').map((n) => n.textContent).join('|') === 'Thriller|Spy|Science Fiction|Spy');

    // The provider chip is the shared pill in the Watching face's tone.
    const tPills = tSheet.querySelectorAll('.pill');
    check('a provider chip per film that has one', tPills.length === 4, String(tPills.length));
    check('and it is the shared pill in the quiet tone', tPills.every((x) => x.className.includes('pill-neutral')));
    check('reading the service name verbatim', tPills.map((x) => x.textContent).join('|') === 'Paramount+|Netflix|Apple TV+|Max', tPills.map((x) => x.textContent).join('|'));

    // Rating: one decimal behind a star, and nothing at all when it is null —
    // never a confident 0.0 on a film the payload has no rating for.
    const tRatings = tSheet.querySelectorAll('.ent-rating').map((n) => n.textContent);
    check('a rating reads ★ 7.8', tRatings[0] === '★ 7.8', tRatings[0]);
    check('a null rating shows no star at all', tRatings.length === 4, tRatings.join('|'));
    check('and never renders as zero', !/★ 0/.test(tText));

    // The poster, under rule 4's carve-out only.
    const imgs = tSheet.querySelectorAll('IMG');
    check('a film with a poster gets one thumb', imgs.length === 1, String(imgs.length));
    check('lazily, with no referrer', imgs[0].getAttribute('loading') === 'lazy' && imgs[0].getAttribute('referrerpolicy') === 'no-referrer');
    check('and an empty alt, because the title is right there', imgs[0].getAttribute('alt') === '');
    check('at a fixed 40x60 box', imgs[0].getAttribute('width') === '40' && imgs[0].getAttribute('height') === '60');
    check('a javascript: poster is never drawn', !imgs.some((i) => /javascript/i.test(i.getAttribute('src') || '')));
    check('a row with no poster still has its numeral', tRows[1].querySelector('.ent-rank').textContent === '2' && !tRows[1].querySelector('IMG'));

    // The overview, clamped in CSS rather than cut in JS — the text stays whole
    // for Explain and for a copy-paste.
    const overs = tSheet.querySelectorAll('.ent-overview');
    check('an overview per film that has one', overs.length === 4, String(overs.length));
    check('carrying the two-line clamp class', overs[0].className.includes('ent-overview'));
    const CSS_SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'style.css'), 'utf8');
    check('and the stylesheet actually clamps it', /\.ent-overview\s*\{[^}]*-webkit-line-clamp:\s*2/m.test(CSS_SRC));

    // RULE 7 again, on the footer. '2026-09-14' is a Monday; parsed as an
    // instant it is Sunday the 13th in Central.
    check('the week is rendered from its parts', /Week of Mon Sep 14/.test(tText), tText.slice(-200));
    check('and never slips to the day before', !/Sep 13/.test(tText));
    check('TMDB is credited on the same line', /Week of Mon Sep 14 · Data from TMDB/.test(tText));
    check('and the vault attribution sits under it', /not endorsed or certified by TMDB/.test(tText));

    // The whole row is the link, same mechanics as Watching.
    const tLinks = tSheet.querySelectorAll('A');
    check('each film with a link is a whole-row anchor', tLinks.length === 4, String(tLinks.length));
    check('opening in a new tab', tLinks.every((a) => a.getAttribute('target') === '_blank'));
    check('without handing the page a handle back', tLinks.every((a) => /noopener/.test(a.getAttribute('rel') || '')));
    check('a film with no link still renders as a row', /The Long Quiet/.test(tText) && tRows.length === 5);

    // E8: no per-item arrival stamp, so the whole face rides its updated_at —
    // and `week_of` is emphatically not an arrival.
    check('a stale face marks nothing new', countOf(tSheet, 'ent-new-mark') === 0, String(countOf(tSheet, 'ent-new-mark')));
    const freshTop = JSON.parse(JSON.stringify(top5Tile.data));
    freshTop.top5.updated_at = daysAgoIso(1);
    const tFresh = fakePanel();
    const freshBoard = withStorage(fakeStorage({ top5: daysAgoIso(5) }), () => {
      const r = new El('div');
      ent.render(r, entTile(freshTop), { id: 'entertainment', actions: tFresh.actions });
      tap(entBtns(r)[2]);
      return r;
    });
    check('a face refreshed since the last open marks all five', countOf(tFresh.last.body, 'ent-new-mark') === 5, String(countOf(tFresh.last.body, 'ent-new-mark')));
    check('and the button counts the same five', chipOf(entBtns(freshBoard)[2])?.textContent === '5 new', chipOf(entBtns(freshBoard)[2])?.textContent);

    // A face with no picks at all: a plain message, and the credit still stands.
    const tEmpty = fakePanel();
    withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, entTile({ watching: null, podcasts: null, listening: null, top5: { updated_at: daysAgoIso(1), week_of: '2026-09-14', items: [] } }), { id: 'entertainment', actions: tEmpty.actions });
      tap(entBtns(r)[2]);
    });
    check('an empty Top 5 opens to a plain message', /No picks this week/.test(textOf(tEmpty.last.body)));
    check('and still credits TMDB', /Data from TMDB/.test(textOf(tEmpty.last.body)));
    check('and draws no rows', countOf(tEmpty.last.body, 'ent-row') === 0);

    // Unchanged: a top5 the engine has not published is still the greyed
    // "soon" button, not an empty sheet.
    const stillSoon = withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, shipped, { id: 'entertainment', actions: {} });
      return r;
    });
    check('a null top5 face is still greyed, wearing "soon"', entBtns(stillSoon)[2].className.includes('ent-btn-soon') && entBtns(stillSoon)[2].querySelector('.ent-soon').textContent === 'soon');
    check('and still cannot be tapped', entBtns(stillSoon)[2].getAttribute('disabled') === 'disabled');

    // -- the listening sheet --------------------------------------------------
    console.log('\nentertainment — the Listening sheet');
    //
    // The last face to get a body. Books, not bills: the chip counts down in
    // entertainment's voice, and a book already out says so rather than
    // reporting a negative countdown. '2026-12-08' is the rule-7 trap — parsed
    // as an instant it is December 7th for anyone Central.
    const listenTile = entTile({
      watching: null,
      podcasts: null,
      top5: null,
      listening: {
        updated_at: daysAgoIso(40),
        week_of: '2026-09-14',
        status: 'ok',
        series_checked: 17,
        items: [
          {
            series: 'Expedition Nine',
            sequence: '20',
            title: 'Last Ride',
            author: 'Craig Mockson',
            release_date: '2026-12-08',
            days: 81,
            just_out: false,
            asin: 'B0TEST0001',
            link: 'https://example.com/pd/B0TEST0001',
            source: 'audible-catalog',
          },
          {
            series: 'The Grey Ledger',
            sequence: null,
            title: 'Dark Union',
            author: 'Imogen Pell',
            release_date: '2027-02-23',
            days: 158,
            just_out: false,
            asin: 'B0TEST0002',
            link: 'https://example.com/pd/B0TEST0002',
            source: 'audible-catalog',
          },
          {
            series: 'Terminal Watch',
            sequence: '8',
            title: 'State of Exile',
            author: 'Dana Q. Hollis',
            release_date: ymd(-3),
            days: -3,
            just_out: true,
            asin: 'B0TEST0003',
            link: 'https://example.com/pd/B0TEST0003',
            source: 'audible-catalog',
          },
          {
            // Half-missing, and a link that must never become one.
            series: null,
            sequence: null,
            title: 'Avalon Station',
            author: null,
            release_date: null,
            days: null,
            just_out: false,
            asin: null,
            link: 'javascript:alert(1)',
            source: null,
          },
        ],
        errors: null,
      },
      attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    });

    const lPanel = fakePanel();
    withStorage(fakeStorage({ listening: daysAgoIso(5) }), () => {
      const r = new El('div');
      ent.render(r, listenTile, { id: 'entertainment', actions: lPanel.actions });
      tap(entBtns(r)[3]);
    });
    const lSheet = lPanel.last.body;
    const lText = textOf(lSheet);
    const lRows = lSheet.querySelectorAll('.ent-row');
    const lTitles = lSheet.querySelectorAll('.ent-row-title').map((n) => n.textContent);

    check('the Listening face has its own body now, not the generic card', !/asin:/.test(lText));
    check('one row per book', lRows.length === 4, String(lRows.length));
    check(
      'in the order the engine published them',
      lTitles.join('|') === 'Last Ride|Dark Union|State of Exile|Avalon Station',
      lTitles.join('|')
    );

    // The sequence is a label beside the title, and absent when the series
    // does not number that way.
    const seqs = lSheet.querySelectorAll('.ent-seq').map((n) => n.textContent);
    check('a numbered book wears its sequence', seqs[0] === '#20', seqs[0]);
    check('a book with no sequence has no hash at all', seqs.length === 2, seqs.join('|'));
    check('and the hash is never doubled', !/##/.test(lText));

    // Series and author, quiet under the title.
    check('the series is the quiet second line', lSheet.querySelectorAll('.ent-series').map((n) => n.textContent).join('|') === 'Expedition Nine|The Grey Ledger|Terminal Watch');
    check('with the author beside it', lSheet.querySelectorAll('.ent-author').map((n) => n.textContent).join('|') === 'Craig Mockson|Imogen Pell|Dana Q. Hollis');

    // The chip: airLabel's ladder for anything still coming, and the release
    // pill for a book already out — never 'aired 3d ago' about a novel.
    const lPills = lSheet.querySelectorAll('.pill').map((n) => n.textContent);
    check('a countdown chip per dated book', lPills.length === 3, lPills.join('|'));
    check('through the shared airLabel ladder', lPills[0] === 'in 81d' && lPills[1] === 'in 158d', lPills.join('|'));
    check('a just-out book says "out now" instead', lPills[2] === 'out now', lPills[2]);
    check('and never counts backwards at him', !/aired/.test(lText));
    check('the out-now pill reads as good news', lSheet.querySelectorAll('.pill')[2].className.includes('pill-good'));
    check('a book with no days count wears no chip', !lRows[3].querySelector('.pill'));

    // RULE 7. December 8th 2026 is a Tuesday; `new Date('2026-12-08')` is UTC
    // midnight, which is Monday the 7th in Central.
    check('the release date is rendered from its parts', /Tue Dec 8/.test(lText), lText.slice(0, 200));
    check('and never slips to the day before', !/Dec 7/.test(lText));
    check('a book with no date shows none', lSheet.querySelectorAll('.ent-release').length === 3);

    // The source chip: provenance, printed verbatim, and absent when unsaid.
    const lSources = lSheet.querySelectorAll('.ent-source').map((n) => n.textContent);
    check('each row carries its source chip', lSources.length === 3 && lSources.every((t) => t === 'audible-catalog'), lSources.join('|'));

    // The whole row is the Audible link, same mechanics as the other faces.
    const lLinks = lSheet.querySelectorAll('A');
    check('each book with a link is a whole-row anchor', lLinks.length === 3, String(lLinks.length));
    check('opening in a new tab', lLinks.every((a) => a.getAttribute('target') === '_blank'));
    check('without handing the page a handle back', lLinks.every((a) => (a.getAttribute('rel') || '') === 'noopener noreferrer'));
    check('a javascript: link is inert, never an anchor', !lLinks.some((a) => /javascript/i.test(a.getAttribute('href') || '')));
    check('and that book still renders as a row', /Avalon Station/.test(lText) && lRows.length === 4);

    // The footer credits the catalog it actually used, and nobody else.
    check('the footer counts the series watched', /17 series watched · Audible catalog/.test(lText), lText.slice(-120));
    check('and TMDB is not credited on a face with no TMDB in it', !/TMDB/.test(lText));

    // E8: no per-item arrival, so the face rides its own updated_at — and a
    // release date, which is in the FUTURE, is emphatically not an arrival.
    check('a stale face marks nothing new', countOf(lSheet, 'ent-new-mark') === 0, String(countOf(lSheet, 'ent-new-mark')));
    const LISTEN_SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'tiles', 'entertainment.js'), 'utf8');
    check('the module reads no arrival stamp for listening', !/\blistening:\s*\(i\)/.test(LISTEN_SRC));
    const freshListen = JSON.parse(JSON.stringify(listenTile.data));
    freshListen.listening.updated_at = daysAgoIso(1);
    const lFresh = fakePanel();
    const lFreshBoard = withStorage(fakeStorage({ listening: daysAgoIso(5) }), () => {
      const r = new El('div');
      ent.render(r, entTile(freshListen), { id: 'entertainment', actions: lFresh.actions });
      tap(entBtns(r)[3]);
      return r;
    });
    check('a face refreshed since the last open marks all four', countOf(lFresh.last.body, 'ent-new-mark') === 4, String(countOf(lFresh.last.body, 'ent-new-mark')));
    check('and the button counts the same four', chipOf(entBtns(lFreshBoard)[3])?.textContent === '4 new', chipOf(entBtns(lFreshBoard)[3])?.textContent);

    // Nothing coming: a plain sentence, and the footer still stands.
    const lEmpty = fakePanel();
    withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, entTile({ watching: null, podcasts: null, top5: null, listening: { updated_at: daysAgoIso(1), status: 'ok', series_checked: 17, items: [] } }), { id: 'entertainment', actions: lEmpty.actions });
      tap(entBtns(r)[3]);
    });
    check('an empty Listening opens to a plain message', /Nothing upcoming in your series\./.test(textOf(lEmpty.last.body)));
    check('and still names the catalog', /17 series watched · Audible catalog/.test(textOf(lEmpty.last.body)));
    check('and draws no rows', countOf(lEmpty.last.body, 'ent-row') === 0);

    // Unchanged: a listening face the engine has not published is the greyed
    // "soon" button, exactly as before.
    check('a null listening face is still greyed, wearing "soon"', entBtns(stillSoon)[3].className.includes('ent-btn-soon') && entBtns(stillSoon)[3].querySelector('.ent-soon').textContent === 'soon');
    check('and still cannot be tapped', entBtns(stillSoon)[3].getAttribute('disabled') === 'disabled');

    // -- empty and grown ------------------------------------------------------
    console.log('\nentertainment — empty faces and schema growth');
    const emptyPanel = fakePanel();
    withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, shipped, { id: 'entertainment', actions: emptyPanel.actions });
      tap(entBtns(r)[0]);
      tap(entBtns(r)[1]);
    });
    check('an empty watching face opens to a plain message', /Nothing on the shelf/.test(textOf(emptyPanel.calls[0].body)));
    check('an empty podcasts face opens to a plain message', /No new episodes/.test(textOf(emptyPanel.calls[1].body)));
    check('and neither draws a row', countOf(emptyPanel.calls[0].body, 'ent-row') === 0 && countOf(emptyPanel.calls[1].body, 'ent-row') === 0);

    // Rule 9 in this tile's own terms: a face the engine invents next month
    // gets a button and a readable sheet without a page deploy.
    const grownPanel = fakePanel();
    const grown = withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, entTile({
        watching: null, podcasts: null, top5: null, listening: null,
        concerts: { updated_at: daysAgoIso(1), items: [{ title: 'A show at a made-up hall', venue: 'The Mock Room', link: 'https://example.com/gig' }] },
        sources: { tv: 'TMDB' },
        attribution: 'Data from TMDB',
      }), { id: 'entertainment', actions: grownPanel.actions });
      tap(entBtns(r)[4]);
      return r;
    });
    check('an unknown populated face still gets a button', entLabels(grown).join('|') === 'Watching|Podcasts|Top 5|Listening|concerts', entLabels(grown).join('|'));
    check('and opens to what arrived', /A show at a made-up hall/.test(textOf(grownPanel.last.body)) && /The Mock Room/.test(textOf(grownPanel.last.body)));
    check('payload metadata is not mistaken for a face', !entLabels(grown).includes('sources') && !entLabels(grown).includes('attribution'));

    // -- the faint line -------------------------------------------------------
    const footRoot = withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, entTile({
        watching: { updated_at: daysAgoIso(3), items: [] },
        podcasts: { updated_at: new Date(Date.now() - 60000).toISOString(), items: [] },
        top5: null, listening: null,
      }), { id: 'entertainment', actions: {} });
      return r;
    });
    check('one faint line under the grid', countOf(footRoot, 'tile-foot') === 1);
    check('and it reports the OLDEST populated face', /3d ago/.test(textOf(footRoot)), textOf(footRoot));
    const noFoot = withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, entTile({ watching: null, podcasts: null, top5: null, listening: null }), { id: 'entertainment', actions: {} });
      return r;
    });
    check('no populated face means no line at all', countOf(noFoot, 'tile-foot') === 0);

    // -- the owner is never named ---------------------------------------------
    const ENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'tiles', 'entertainment.js'), 'utf8');
    check('the module never reaches for me.name', !/\bme\b\s*[.?[]/.test(ENT_SRC));
    const named = withStorage(fakeStorage(null), () => {
      const r = new El('div');
      ent.render(r, watchTile, { id: 'entertainment', actions: {}, me: { name: 'Matt', role: 'owner' } });
      return r;
    });
    check('and a name in ctx never lands on the board', !/Matt/.test(textOf(named)));
    check('nor does the storage key leak into the page', !new RegExp(LS_KEY).test(textOf(named)));
  }

  // -- today_games: the league menu and its slate ----------------------------
  //
  // This tile renders almost nothing from the snapshot: the payload says WHICH
  // leagues, and every game comes from ESPN via ctx.live.today. So the games
  // below are the committed fake slate (tools/mock-espn.js) put through the
  // REAL normalizer — which means these assertions cover espn.js's broadcast
  // merge as well as the tile.
  console.log('\ntoday_games — the league menu');
  const tg = mods.get('today_games');
  if (tg) {
    check('mke_board is gone from the registry', !/mke_board/.test(REGISTRY_SRC));
    check("today_games sits at position 20, titled Today's Games", /today_games:[^\n]*position: 20[^\n]*title: "Today's Games"/.test(REGISTRY_SRC));
    check('and its module file is gone', !fs.existsSync(path.join(__dirname, '..', 'docs', 'tiles', 'mke_board.js')));

    const { normalizeEvent } = await import('../docs/live/espn.js');
    const { slate, todayGamesPayload } = require('./mock-espn.js');

    // A FIXED date, so kick times and the sheet header are deterministic.
    const DATE_CT = '2026-09-17';
    const RAW = slate(DATE_CT);
    const payload = todayGamesPayload(DATE_CT);

    const liveFor = (slugs, { ok = true, error = null } = {}) => ({
      games: new Map(),
      grades: new Map(),
      today: {
        date_ct: DATE_CT,
        leagues: new Map(
          slugs.map((slug) => [
            slug,
            { games: (RAW.leagues[slug] || []).map((e) => normalizeEvent(e, slug)).filter(Boolean), ok },
          ])
        ),
      },
      fetched_at: '2026-09-17T19:14:00Z',
      error,
    });

    const ALL = ['baseball/mlb', 'soccer/usa.1', 'soccer/eng.1', 'soccer/esp.1'];
    const tgBtns = (root) => root.querySelectorAll('.tg-btn');
    const tgLabels = (root) => tgBtns(root).map((b) => b.querySelector('.tg-btn-label').textContent);
    const chipText = (btn) => {
      const c = btn.querySelector('.tg-count') || btn.querySelector('.tg-idle');
      return c ? c.textContent : '';
    };

    const panel = fakePanel();
    const root = new El('div');
    tg.render(root, { band: 'LIVE', status: 'ok', data: payload }, {
      id: 'today_games',
      actions: panel.actions,
      live: liveFor(ALL),
    });

    check(
      'one button per league, in payload order',
      tgLabels(root).join('|') === 'MLB|MLS|EPL|La Liga',
      tgLabels(root).join('|')
    );
    check('each button wears its emoji', countOf(root, 'tg-emoji') === 4);
    check(
      'the chip counts that league’s games',
      tgBtns(root).map(chipText).join() === '3 games,2 games,no games today,2 games',
      tgBtns(root).map(chipText).join()
    );
    // MLB has one in-progress game; MLS has one; La Liga is all final.
    check('a live-dot only where a game is actually in progress', countOf(root, 'tg-dot') === 2);
    check('the dot is on MLB and MLS', !!tgBtns(root)[0].querySelector('.tg-dot') && !!tgBtns(root)[1].querySelector('.tg-dot'));
    check('not on the all-final league', !tgBtns(root)[3].querySelector('.tg-dot'));
    check('nor on the empty one', !tgBtns(root)[2].querySelector('.tg-dot'));
    check('an empty slate greys its button', tgBtns(root)[2].className.includes('tg-btn-none'));
    check('a live league is tinted live', tgBtns(root)[0].className.includes('tg-btn-live'));
    check('a league with games but none live is tinted on', tgBtns(root)[3].className.includes('tg-btn-on'));

    // The board is a menu: no games on it, one faint line under it.
    check('no game rows in the tile body', countOf(root, 'tg-game') === 0);
    check('one faint line carries the feed time and the date', countOf(root, 'tile-foot') === 1);
    check('and it says both', /feed 2:14 PM/.test(textOf(root)) && /Thu Sep 17/.test(textOf(root)), textOf(root));
    check('nothing on the board reads as undefined', !/undefined/.test(textOf(root)));

    // -- the sheet -----------------------------------------------------------
    console.log('\ntoday_games — the league sheet');
    tap(tgBtns(root)[0]); // MLB
    check('a tap opens the sheet', panel.calls.length === 1);
    check('titled with the emoji, the label and the date', panel.last.title === '⚾ MLB · Thu Sep 17', panel.last.title);

    const sheet = panel.last.body;
    const matchups = sheet.querySelectorAll('.tg-matchup').map((n) => n.textContent);
    check(
      'games are chronological by kick, not payload order',
      matchups.join(' | ') === 'Herons @ Ironsides | Loons @ Nine | Foremen @ Drays',
      matchups.join(' | ')
    );
    check('the matchup uses shortDisplayNames', /Herons @ Ironsides/.test(textOf(sheet)) && !/Harbor Herons/.test(textOf(sheet)));

    const rows = sheet.querySelectorAll('.tg-game');
    const statusOf = (r) => r.querySelector('.tg-status').textContent;
    check('a final row says Final and the score', statusOf(rows[0]) === 'Final  ·  HRN 6 – 5 FIS', statusOf(rows[0]));
    check('a live row says the score and the clock', statusOf(rows[1]) === 'LKL 2 – 4 CCN  ·  Top 7th', statusOf(rows[1]));
    check('a pre row says the kick time in Central', statusOf(rows[2]) === '9:40 PM', statusOf(rows[2]));
    check('the live row gets the green rail', rows[1].classList.contains('tg-game-in'));
    check('the final row greys', rows[0].classList.contains('tg-game-post'));

    // -- the watch chips (G4) ------------------------------------------------
    const chipsOf = (r) => r.querySelectorAll('.tg-chip').map((c) => c.textContent);
    check(
      'a mapped national channel gets a tick and the service',
      chipsOf(rows[1]).includes('✓ YouTube TV'),
      chipsOf(rows[1]).join()
    );
    check(
      'an RSN the map claims is his beats the regional rule',
      chipsOf(rows[1]).includes('✓ CreamCity.TV (regional, yours)'),
      chipsOf(rows[1]).join()
    );
    check(
      'an unmapped name is printed verbatim and unmarked',
      chipsOf(rows[0]).includes('MLB.TV') && !chipsOf(rows[0]).some((c) => /✓ MLB\.TV/.test(c)),
      chipsOf(rows[0]).join()
    );
    check(
      "another team's market feed says it will not be his",
      chipsOf(rows[0]).includes('regional — not yours'),
      chipsOf(rows[0]).join()
    );
    check('a mapped chip is classed mapped', rows[1].querySelectorAll('.tg-chip-mapped').length === 2);
    check('a regional chip is classed regional', rows[0].querySelectorAll('.tg-chip-regional').length === 1);
    check('an unmapped chip is classed raw', rows[0].querySelectorAll('.tg-chip-raw').length === 1);
    check(
      'a name ESPN sent twice is one chip, not two',
      chipsOf(rows[1]).length === 2,
      chipsOf(rows[1]).join()
    );
    check('national listings come first', chipsOf(rows[2])[0] === '✓ Peacock', chipsOf(rows[2]).join());
    check('no chip anywhere reads as undefined', !/undefined/.test(textOf(sheet)));

    // A game ESPN listed with no broadcast at all.
    tap(tgBtns(root)[1]); // MLS
    const mlsRows = panel.last.body.querySelectorAll('.tg-game');
    check('a game with no listing says so rather than nothing', mlsRows[1].querySelector('.tg-chip-none').textContent === 'no listing');
    check('a soccer clock renders as ESPN sent it', /63'/.test(textOf(panel.last.body)));

    // -- an empty slate still opens (G6) -------------------------------------
    tap(tgBtns(root)[2]); // EPL
    check('a league with nothing on still opens its sheet', panel.calls.length === 3);
    check('and says which league has nothing on', /No EPL games today\./.test(textOf(panel.last.body)));
    check('with the date still in the title', /Thu Sep 17/.test(panel.last.title));

    // -- before the band has run ---------------------------------------------
    const cold = new El('div');
    tg.render(cold, { band: 'LIVE', status: 'ok', data: payload }, { id: 'today_games', actions: panel.actions });
    check('with no band yet every league says awaiting feed', countOf(cold, 'tg-idle') === 4);
    check('and no count is invented', countOf(cold, 'tg-count') === 0);
    check('the date is still printed from the payload', /Thu Sep 17/.test(textOf(cold)));
    check('a cold tile never claims no games today', !/no games today/.test(textOf(cold)));

    // -- a league whose feed died --------------------------------------------
    const sick = new El('div');
    const sickPanel = fakePanel();
    tg.render(sick, { band: 'LIVE', status: 'ok', data: payload }, {
      id: 'today_games',
      actions: sickPanel.actions,
      live: liveFor(ALL, { ok: false, error: 'some feeds unavailable' }),
    });
    check('a partial failure is said on the board', /feed unavailable/.test(textOf(sick)));
    tap(tgBtns(sick)[0]);
    check('and in the sheet, over the last slate it had', /feed unavailable/.test(textOf(sickPanel.last.body)));
    check('the last slate is still rendered', sickPanel.last.body.querySelectorAll('.tg-game').length === 3);

    // -- schema growth and hostile shapes -----------------------------------
    const grown = new El('div');
    tg.render(grown, { band: 'LIVE', status: 'ok', data: {
      date_ct: DATE_CT,
      leagues: [{ id: 'ncaaf', slug: 'football/college-football' }, { slug: '' }, { id: 'dupe', slug: 'baseball/mlb', label: 'MLB' }, { id: 'dupe2', slug: 'baseball/mlb', label: 'again' }],
    } }, { id: 'today_games', actions: {}, live: liveFor(['baseball/mlb']) });
    check('a league with no label gets one from its slug', /COLLEGE-FOOTBALL/.test(textOf(grown)));
    check('a league with no slug is dropped', tgLabels(grown).length === 2, tgLabels(grown).join());
    check('a slug listed twice gets one button', tgLabels(grown).filter((l) => l === 'MLB').length === 1);
    check('a league with no emoji still renders', !/undefined/.test(textOf(grown)));

    const noLeagues = new El('div');
    tg.render(noLeagues, { band: 'LIVE', status: 'ok', data: { date_ct: DATE_CT, leagues: [] } }, { id: 'today_games', actions: {} });
    check('no leagues at all says so', /No leagues on the board\./.test(textOf(noLeagues)));

    // Rule 7: a date_ct that is not a plain date renders verbatim, unparsed.
    const oddDate = new El('div');
    tg.render(oddDate, { band: 'LIVE', status: 'ok', data: { ...payload, date_ct: '2026-9-7' } }, { id: 'today_games', actions: {}, live: liveFor(ALL) });
    check('an off-shape date_ct is printed as text, never parsed', /2026-9-7/.test(textOf(oddDate)));

    // A postponed game is not "pre" — it must not show a kick time.
    const dead = JSON.parse(JSON.stringify(RAW.leagues['baseball/mlb'][2]));
    dead.competitions[0].status.type = { state: 'pre', name: 'STATUS_POSTPONED', completed: false, detail: 'Postponed', shortDetail: 'Postponed' };
    const deadPanel = fakePanel();
    const deadRoot = new El('div');
    tg.render(deadRoot, { band: 'LIVE', status: 'ok', data: payload }, {
      id: 'today_games',
      actions: deadPanel.actions,
      live: {
        games: new Map(),
        grades: new Map(),
        today: { date_ct: DATE_CT, leagues: new Map([['baseball/mlb', { games: [normalizeEvent(dead, 'baseball/mlb')], ok: true }]]) },
        fetched_at: '2026-09-17T19:14:00Z',
        error: null,
      },
    });
    tap(tgBtns(deadRoot)[0]);
    check('a postponed game says postponed, not a kick time', /Postponed/.test(textOf(deadPanel.last.body)));
    check('and is not counted as live', countOf(deadRoot, 'tg-dot') === 0);

    // -- watchChips directly (G4), for the cases a row cannot reach ----------
    console.log('\ntoday_games — watch chips, case by case');
    {
      const game = (broadcasts, home = 'CCN', away = 'LKL') => ({
        home: { abbr: home }, away: { abbr: away }, broadcasts,
      });
      const chips = (bc, map = payload.watch_map, locals = payload.local_teams, slug = 'baseball/mlb') =>
        tg.watchChips(game(bc), map, locals, slug).map((c) => `${c.kind}:${c.text}`);

      check(
        'a local team\u2019s own feed that the map has NOT claimed is printed plainly',
        chips([{ name: 'Nine Sports', market: 'Home' }]).join() === 'raw:Nine Sports',
        chips([{ name: 'Nine Sports', market: 'Home' }]).join()
      );
      check(
        'the local-team check ignores abbreviation casing',
        chips([{ name: 'Nine Sports', market: 'Home' }], payload.watch_map, { 'baseball/mlb': ['ccn'] }).join() === 'raw:Nine Sports'
      );
      check(
        'a league with no local_teams entry treats every market feed as somebody else\u2019s',
        chips([{ name: 'Nine Sports', market: 'Home' }], payload.watch_map, {}).join() === 'regional:regional \u2014 not yours'
      );
      check(
        'two other-market feeds collapse into one regional chip',
        chips([{ name: 'A Sports', market: 'Home' }, { name: 'B Sports', market: 'Away' }], payload.watch_map, {}).length === 1
      );
      check(
        'a National market is never called regional, mapped or not',
        chips([{ name: 'Unknown Channel', market: 'National' }]).join() === 'raw:Unknown Channel'
      );
      check('a blank name is dropped rather than rendered empty', chips([{ name: '   ', market: 'National' }]).length === 0);
      check('a game with no broadcasts key at all yields no chips', tg.watchChips({}, {}, {}, 'x').length === 0);
      check('a null watch_map does not throw', tg.watchChips(game([{ name: 'FS1', market: 'National' }]), null, null, 'x').length === 1);
      check(
        'a watch_map value that is not a string is treated as unmapped',
        chips([{ name: 'FS1', market: 'National' }], { FS1: null }).join() === 'raw:FS1'
      );
      check('and the mapping is exact, not fuzzy', chips([{ name: 'fs1', market: 'National' }]).join() === 'raw:fs1');
    }

    // -- no sheet to open ----------------------------------------------------
    const inert = new El('div');
    let threw = null;
    try {
      tg.render(inert, { band: 'LIVE', status: 'ok', data: payload }, { id: 'today_games', actions: {}, live: liveFor(ALL) });
      tap(tgBtns(inert)[0]);
    } catch (e) { threw = e; }
    check('a tap with no panel action never reaches the page', !threw, threw && threw.message);
  }

  // -- reminders specifics ---------------------------------------------------
  console.log('\nreminders');
  const rem = mods.get('reminders');
  if (rem) {
    // Deliberately emitted in the wrong order, including the case the engine's
    // `overdue` flag exists for: due today at 09:00, already missed.
    const items = [
      { title: 'next week', list: 'Home', due: '2026-09-24', due_time: null, days: 7, overdue: false, flagged: false, priority: 'none' },
      { title: 'undated flagged', list: 'Someday', due: null, due_time: null, days: null, overdue: false, flagged: true, priority: 'none' },
      { title: 'today later', list: 'Shop', due: '2026-09-17', due_time: '16:30', days: 0, overdue: false, flagged: false, priority: 'none' },
      { title: 'missed this morning', list: 'Shop', due: '2026-09-17', due_time: '09:00', days: 0, overdue: true, flagged: false, priority: 'high' },
      { title: 'badly overdue', list: 'Shop', due: '2026-09-08', due_time: null, days: -9, overdue: true, flagged: true, priority: 'high' },
      { title: 'undated plain', list: 'Someday', due: null, due_time: null, days: null, overdue: false, flagged: false, priority: null },
      { title: 'tomorrow', list: 'Home', due: '2026-09-18', due_time: '09:15', days: 1, overdue: false, flagged: false, priority: 'none' },
    ];
    const root = new El('div');
    rem.render(root, { band: 'DAILY', status: 'ok', data: { items, count: 7, overdue: 2, due_soon: 4, source: 'test' } }, { id: 'reminders', actions: {} });

    const titles = root.querySelectorAll('.rem-title').map((n) => n.textContent);
    check(
      'overdue first, then due-soon by nearest, then undated',
      titles.join(' | ') === 'badly overdue | missed this morning | today later | tomorrow | next week | undated flagged | undated plain',
      titles.join(' | ')
    );
    check('the worst miss leads the overdue block', titles[0] === 'badly overdue');
    check('undated sinks to the bottom', titles.slice(-2).every((t) => t.startsWith('undated')));
    check('a flagged undated item outranks an unflagged one', titles[5] === 'undated flagged');

    // The engine's `overdue` outranks a non-negative day count.
    const rows = root.querySelectorAll('.rem-row');
    check('a missed-this-morning item is grouped overdue, not "due today"', rows[1].classList.contains('rem-overdue'));
    check('an item due later today is NOT marked overdue', !rows[2].classList.contains('rem-overdue'));
    check('it wears a "past due" chip rather than "due today"', /past due/.test(rows[1].textContent) && !/due today/.test(rows[1].textContent));
    check('a later-today item still reads "due today"', /due today/.test(rows[2].textContent));

    check('days-out renders as a chip', /9d overdue/.test(rows[0].textContent));
    check('tomorrow reads as tomorrow', /due tomorrow/.test(root.textContent));
    check('a far date is a plain day count', /7d/.test(root.textContent));
    check('flagged items carry the mark', root.querySelectorAll('.rem-flag').length === 2);
    check('the mark is labelled for screen readers', root.querySelector('.rem-flag').getAttribute('aria-label') === 'flagged');
    check('an undated item gets no days chip', !/\dd/.test(rows[6].textContent));

    // Rule 7: a Central date-only string is rendered from its parts, verbatim.
    check('the due date renders as text, never a parsed instant', /Sep 8/.test(rows[0].textContent));
    check('a due time renders in 12h Central', /9:15 AM/.test(root.textContent));
    check('priority "none" is not rendered as a chip', !/none/.test(root.textContent));
    check('a real priority is', /high/.test(root.textContent));
    check('the engine counts are reported', /7 open/.test(root.textContent) && /2 overdue/.test(root.textContent));

    // Every item undated: no headings for empty groups, no crash.
    const root2 = new El('div');
    rem.render(root2, { band: 'DAILY', status: 'ok', data: { items: items.filter((i) => i.days === null) } }, { id: 'reminders', actions: {} });
    check('an all-undated list renders one group only', root2.querySelectorAll('.rem-heading').length === 1);
    check('and it is the undated one', root2.querySelector('.rem-heading').textContent === 'No date');

    const root3 = new El('div');
    rem.render(root3, { band: 'DAILY', status: 'ok', data: { items: [] } }, { id: 'reminders', actions: {} });
    check('an empty list says so', /Nothing on the list/.test(root3.textContent));

    // A half-built item must not take the tile down.
    const root4 = new El('div');
    rem.render(root4, { band: 'DAILY', status: 'ok', data: { items: [{}, null, { title: 'ok' }] } }, { id: 'reminders', actions: {} });
    check('items with no fields at all still render', root4.querySelectorAll('.rem-row').length === 2);
    check('a titleless item is labelled, not blank', /\(untitled\)/.test(root4.textContent));
  }


  // -- local_events: the Lake Country week ----------------------------------
  //
  // Everything this module decides is a boundary: which day groups reach the
  // board, what the "+N more" button is accountable for, which rows of a
  // multi-day fest wear "cont.", and what a stale feed looks like next to a
  // dead one. So the cases below are built around today's Central date rather
  // than a fixed one — the tile is wrong the moment "today" stops meaning
  // today, and a fixture frozen to 2026 would never catch it.
  console.log('\nlocal_events — the Lake Country week');
  const lc = mods.get('local_events');
  const lcTap = (btn) => btn.listeners.click[0]({ stopPropagation() {} });
  const lcRows = (node) => node.querySelectorAll('.lc-row');
  const lcHeads = (node) => node.querySelectorAll('.lc-day-head').map((h) => h.textContent);
  const lcMore = (node) => node.querySelector('.lc-more');

  if (lc) {
    const day = (date, label, events) => ({ date, label, events });
    const ev = (title, extra = {}) => ({
      time: '06:00 PM - 09:00 PM',
      title,
      venue: 'The Green',
      address: 'somewhere',
      link: `https://example.com/${encodeURIComponent(title)}`,
      source: 'Visit Nowhere',
      blurb: `blurb for ${title}`,
      multi_day: false,
      ...extra,
    });
    const lcTile = (data, status = 'ok', error = null) => ({ band: 'DAILY', status, error, data });

    // A full week: two today, one tomorrow, and four spread across the rest.
    const week = {
      title: 'Lake Country',
      window: { from: ymd(0), to: ymd(7) },
      count: 7,
      days: [
        day(ymd(0), 'TODAY-LABEL', [ev('Beach Bands'), ev('Beer Garden')]),
        day(ymd(1), 'TOMORROW-LABEL', [ev('Fallfest', { multi_day: true })]),
        day(ymd(2), 'DAY-TWO', [ev('Fallfest', { multi_day: true }), ev('Farmers Market', { time: '' })]),
        day(ymd(3), 'DAY-THREE', [ev('Fallfest', { multi_day: true })]),
        day(ymd(6), 'DAY-SIX', [ev('Fireworks')]),
      ],
      sources: ['Visit Nowhere'],
      errors: [],
    };

    const panel = fakePanel();
    const board = new El('div');
    lc.render(board, lcTile(week), { id: 'local_events', actions: panel.actions });

    // -- what reaches the board ---------------------------------------------
    check('only today and tomorrow are grouped onto the board', lcHeads(board).join('|') === 'TODAY-LABEL|TOMORROW-LABEL', lcHeads(board).join('|'));
    check('the day heading is the engine’s label, printed verbatim', lcHeads(board)[0] === 'TODAY-LABEL');
    check('and their rows come with them', lcRows(board).length === 3, String(lcRows(board).length));
    check('a row reads time · title · venue', /6:00 PM.*·.*Beach Bands.*·.*The Green/.test(lcRows(board)[0].textContent), lcRows(board)[0].textContent);
    check('nothing from later in the week is on the board', !/Fireworks|Farmers Market/.test(textOf(board)));
    check('no blurb on the board', !/blurb for/.test(textOf(board)));
    check('no source line on the board', countOf(board, 'lc-source') === 0);

    // -- the +N more button --------------------------------------------------
    check('the rest of the week is behind one button', !!lcMore(board));
    check('and the button counts every row it is hiding', lcMore(board).textContent === '+4 more', lcMore(board).textContent);

    // -- links ---------------------------------------------------------------
    const a0 = lcRows(board)[0];
    check('the whole row is an anchor', a0.tagName === 'A');
    check('pointed at the event’s own link', a0.getAttribute('href') === 'https://example.com/Beach%20Bands', a0.getAttribute('href'));
    check('opening in a new tab', a0.getAttribute('target') === '_blank');
    check('without handing over a window handle', /noopener/.test(a0.getAttribute('rel')), a0.getAttribute('rel'));

    // -- the sheet -----------------------------------------------------------
    lcTap(lcMore(board));
    check('the button opens the shared sheet', panel.calls.length === 1);
    check('titled Lake Country', panel.last.title === 'Lake Country');
    const sheet = panel.last.body;
    check('the sheet holds the whole week, not just the rest', lcHeads(sheet).join('|') === 'TODAY-LABEL|TOMORROW-LABEL|DAY-TWO|DAY-THREE|DAY-SIX', lcHeads(sheet).join('|'));
    check('every event in the window is in it', lcRows(sheet).length === 7, String(lcRows(sheet).length));
    check('the sheet adds the blurb under each row', countOf(sheet, 'lc-blurb') === 7);
    check('and the source in small text', countOf(sheet, 'lc-source') === 7);
    check('the rows keep the same format', /6:00 PM.*·.*Beach Bands.*·.*The Green/.test(lcRows(sheet)[0].textContent));
    check('the board is unchanged by opening it', lcRows(board).length === 3);

    // -- multi_day: "cont." on every day after the first ---------------------
    const contOf = (node) => lcRows(node).map((r) => (/cont\./.test(r.textContent) ? '1' : '0')).join('');
    check('the fest’s first day carries no cont. mark', !/cont\./.test(lcRows(board)[2].textContent), lcRows(board)[2].textContent);
    // rows in week order: bands, garden, fest d1, fest d2, market, fest d3, fireworks
    check('days two and three of the fest do', contOf(sheet) === '0001010', contOf(sheet));
    check('and nothing else on the week does', contOf(sheet).split('1').length - 1 === 2, contOf(sheet));
    // A single-day event is never marked, however many rows share a day.
    const single = new El('div');
    lc.render(single, lcTile({ days: [day(ymd(0), 'D', [ev('Twice'), ev('Twice')])] }), { id: 'local_events', actions: {} });
    check('a repeated title without multi_day is never marked cont.', !/cont\./.test(textOf(single)));

    // -- grouping: a day with nothing on it is not a heading -----------------
    const holes = new El('div');
    lc.render(holes, lcTile({ days: [day(ymd(0), 'REAL', [ev('Only')]), day(ymd(1), 'HOLLOW', []), day(ymd(2), 'JUNK', [{}, null])] }), { id: 'local_events', actions: {} });
    check('an empty day group renders no heading', lcHeads(holes).join('|') === 'REAL', lcHeads(holes).join('|'));
    check('a titleless event is dropped rather than rendered blank', lcRows(holes).length === 1);

    // -- today and tomorrow are picked by DATE, not by position --------------
    //
    // The engine only emits days that have something on them, so days[0] is
    // often the weekend. A quiet Tuesday must read as a quiet Tuesday.
    const later = new El('div');
    const laterPanel = fakePanel();
    lc.render(later, lcTile({ days: [day(ymd(2), 'SATURDAY', [ev('Fest'), ev('Market')])] }), { id: 'local_events', actions: laterPanel.actions });
    check('a week that starts later leaves the board’s day groups empty', lcHeads(later).length === 0);
    check('and says which kind of empty it is', /nothing today or tomorrow/.test(textOf(later)));
    check('but never says the week is empty', !/nothing on the calendars/.test(textOf(later)));
    check('the whole week is then behind the button', lcMore(later).textContent === '+2 more', lcMore(later).textContent);
    lcTap(lcMore(later));
    check('and the sheet still holds it', lcRows(laterPanel.last.body).length === 2);

    // -- the board's height budget ------------------------------------------
    const flood = new El('div');
    lc.render(flood, lcTile({ days: [day(ymd(0), 'BUSY', Array.from({ length: 9 }, (_, i) => ev(`Thing ${i}`)))] }), { id: 'local_events', actions: {} });
    check('one enormous day is trimmed to the tile’s height', lcRows(flood).length === 6, String(lcRows(flood).length));
    check('and the trimmed rows are counted by the button, not lost', lcMore(flood).textContent === '+3 more', lcMore(flood).textContent);

    // -- an empty window -----------------------------------------------------
    for (const [label, data] of [['no days key', {}], ['an empty days list', { days: [] }], ['days with no events', { days: [day(ymd(0), 'D', [])] }]]) {
      const none = new El('div');
      lc.render(none, lcTile(data), { id: 'local_events', actions: {} });
      check(`${label} reads as an empty window`, /nothing on the calendars this week/.test(textOf(none)), textOf(none));
      check(`${label} offers no button into an empty sheet`, !lcMore(none));
    }

    // -- stale vs error ------------------------------------------------------
    //
    // Two different failures and they must not look alike: `stale` means one
    // feed of three fell over and the rows Matt does have are real; `error`
    // means nothing arrived worth laying out.
    console.log('\nlocal_events — stale vs error');
    const stale = new El('div');
    lc.render(stale, lcTile(week, 'stale', 'delafield feed timed out'), { id: 'local_events', actions: {} });
    check('a stale tile still renders its rows', lcRows(stale).length === 3);
    check('and still offers the rest of the week', !!lcMore(stale));
    check('with a small warning mark beside them', countOf(stale, 'lc-warn') === 1);
    check('whose tooltip is the error', stale.querySelector('.lc-warn').getAttribute('title') === 'delafield feed timed out');
    check('and which is labelled for screen readers', /delafield feed timed out/.test(stale.querySelector('.lc-warn').getAttribute('aria-label')));

    // The Worker had no word for it, but the payload did.
    const stale2 = new El('div');
    lc.render(stale2, lcTile({ ...week, errors: ['visit-ocon 503', 'hartland parse'] }, 'stale', null), { id: 'local_events', actions: {} });
    check('a stale tile with no tile.error falls back to the payload’s errors', stale2.querySelector('.lc-warn').getAttribute('title') === 'visit-ocon 503 · hartland parse', stale2.querySelector('.lc-warn').getAttribute('title'));
    const stale3 = new El('div');
    lc.render(stale3, lcTile({ ...week, errors: [] }, 'stale', null), { id: 'local_events', actions: {} });
    check('and with neither, the mark still explains itself', !!stale3.querySelector('.lc-warn').getAttribute('title'));
    // Nothing on at all AND a feed down: both facts survive.
    const staleEmpty = new El('div');
    lc.render(staleEmpty, lcTile({ days: [] }, 'stale', 'all three timed out'), { id: 'local_events', actions: {} });
    check('an empty stale window says both things', /nothing on the calendars/.test(textOf(staleEmpty)) && countOf(staleEmpty, 'lc-warn') === 1);

    const bad = new El('div');
    lc.render(bad, lcTile(week, 'error', 'every feed refused'), { id: 'local_events', actions: {} });
    check('an error tile lays out no rows of its own', lcRows(bad).length === 0);
    check('no day headings', lcHeads(bad).length === 0);
    check('no way into a sheet that would be a lie', !lcMore(bad));
    check('it falls back to the rule-9 generic card', countOf(bad, 'generic') === 1);
    check('which surfaces what the payload did carry', /window/.test(textOf(bad)) && /count/.test(textOf(bad)));
    const badEmpty = new El('div');
    lc.render(badEmpty, lcTile({}, 'error', 'every feed refused'), { id: 'local_events', actions: {} });
    check('an error tile with no data at all still renders something', /No data/.test(textOf(badEmpty)));

    // -- rule 10 and the ragged rows ----------------------------------------
    console.log('\nlocal_events — hostile rows');
    const ragged = new El('div');
    lc.render(ragged, lcTile({ days: [day(ymd(0), 'D', [
      ev('Junk link', { link: 'javascript:alert(1)' }),
      ev('No link', { link: null }),
      ev('No time', { time: '' }),
      ev('No venue', { venue: '' }),
      { title: 'Bare' },
    ])] }), { id: 'local_events', actions: {} });
    check('a javascript: link is never an anchor', !ragged.querySelectorAll('A').some((a) => /javascript/i.test(a.getAttribute('href') || '')));
    check('but the row survives as text', /Junk link/.test(textOf(ragged)));
    check('a row with no link is a div, not a dead anchor', lcRows(ragged)[1].tagName === 'DIV');
    check('a timeless row prints no leading separator', !/^\s*·/.test(lcRows(ragged)[2].textContent), lcRows(ragged)[2].textContent);
    check('a venueless row prints no trailing separator', !/·\s*$/.test(lcRows(ragged)[3].textContent), lcRows(ragged)[3].textContent);
    check('a row with nothing but a title still renders', /Bare/.test(lcRows(ragged)[4].textContent) && !/·/.test(lcRows(ragged)[4].textContent));

    // -- rule 7: the times are the engine's strings, verbatim ---------------
    const verbatim = new El('div');
    lc.render(verbatim, lcTile({ days: [day(ymd(0), 'Sat 9/19', [ev('X', { time: '08:00 AM - 12:00 PM' })])] }), { id: 'local_events', actions: {} });
    check('a time range is printed exactly as it arrived', /08:00 AM - 12:00 PM/.test(textOf(verbatim)), textOf(verbatim));
    check('and the label with it', /Sat 9\/19/.test(textOf(verbatim)));

    // -- no sheet to open ----------------------------------------------------
    const inertLc = new El('div');
    let lcThrew = null;
    try {
      lc.render(inertLc, lcTile(week), { id: 'local_events', actions: {} });
      lcTap(lcMore(inertLc));
    } catch (e) { lcThrew = e; }
    check('a tap with no panel action never reaches the page', !lcThrew, lcThrew && lcThrew.message);

    // -- L6: nothing is remembered ------------------------------------------
    // A calendar is not a backlog. The module must not touch storage at all —
    // which is also why it cannot throw in private mode.
    // Comments stripped first: the header SAYS "no localStorage", and a header
    // saying so is the opposite of a violation.
    const LC_SRC = fs
      .readFileSync(path.join(__dirname, '..', 'docs', 'tiles', 'local_events.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    check('the module never touches localStorage', !/localStorage/.test(LC_SRC));
    check('and ships no "new since opened" badge', !/new-mark|badge/.test(LC_SRC));
  }


  // -- wss_tape: the Crew Tape ----------------------------------------------
  //
  // The tile is a glance and a log at once: the chips have to agree with the
  // rows, the rows have to stay in the engine's order, and the five-row
  // budget has to hand everything it cut to the button. The accents are the
  // other half of the glance — one colour per actor, the same on the chip and
  // on every row that actor touched — so those are asserted as a relationship
  // rather than against a fixed palette slot.
  console.log('\nwss_tape — the Crew Tape');
  const tape = mods.get('wss_tape');
  const tapeTap = (btn) => btn.listeners.click[0]({ stopPropagation() {} });
  const tapeRows = (node) => node.querySelectorAll('.tape-row');
  const tapeChips = (node) => node.querySelectorAll('.tape-chip');
  const tapeMore = (node) => node.querySelector('.tape-more');
  const accentOf = (node) => [...node.classList.set].find((c) => /^tape-a\d$/.test(c));
  // Every part but the first opens with its own separator dot (the dot wraps
  // with the part it introduces), so a part's text is read without it.
  const bare = (node) => node.textContent.replace(/^\u00b7/, '');

  if (tape) {
    // Invented crew, invented customers, invented serials (rule 1).
    const item = (time_ct, actor, extra = {}) => ({
      ts: daysAgoIso(0),
      time_ct,
      actor,
      action: 'ticket_update',
      kind: 'ticket',
      id: 'S1104',
      unit: null,
      who: 'Mock Chemical Co.',
      summary: 'stage IN-PROGRESS → NEEDS-QUOTE',
      evt: 'mk1a2b',
      ...extra,
    });
    const tapeTile = (data, status = 'ok', error = null) => ({ band: 'DAILY', status, error, data });

    // Twelve items, newest first, three actors — the shape the engine emits.
    const TIMES = ['15:42', '15:05', '14:57', '13:30', '12:41', '11:27', '10:58', '10:12', '09:44', '09:03', '08:16', '07:52'];
    const ACTORS = ['Rae', 'Kit', 'Rae', 'Odis', 'Kit', 'Rae', 'Odis', 'Kit', 'Rae', 'Odis', 'Kit', 'Rae'];
    const day = {
      title: 'Crew Tape',
      date: ymd(0),
      count: 12,
      by_actor: [{ name: 'Rae', n: 5 }, { name: 'Kit', n: 4 }, { name: 'Odis', n: 3 }],
      items: TIMES.map((t, i) => item(t, ACTORS[i], { id: `S11${String(i).padStart(2, '0')}` })),
      yesterday: { date: ymd(-1), count: 9, by_actor: [{ name: 'Rae', n: 4 }, { name: 'Kit', n: 3 }, { name: 'Mission Control', n: 2 }] },
      last_fleet_run_ct: '16:38',
      source: 'test',
    };

    const panel = fakePanel();
    const board = new El('div');
    tape.render(board, tapeTile(day), { id: 'wss_tape', actions: panel.actions });

    // -- the glance ----------------------------------------------------------
    check('one chip per actor, in the payload’s order', tapeChips(board).map((c) => c.querySelector('.tape-chip-name').textContent).join('|') === 'Rae|Kit|Odis', tapeChips(board).map((c) => c.textContent).join('|'));
    check('each chip carries that actor’s count', tapeChips(board).map((c) => c.querySelector('.tape-chip-n').textContent).join() === '5,4,3', tapeChips(board).map((c) => c.textContent).join());
    check('and reads as "name n"', tapeChips(board)[0].textContent === 'Rae 5', tapeChips(board)[0].textContent);

    // -- the five-row budget -------------------------------------------------
    check('five rows reach the board', tapeRows(board).length === 5, String(tapeRows(board).length));
    check('newest first, untouched', tapeRows(board).map((r) => r.querySelector('.tape-time').textContent).join() === TIMES.slice(0, 5).join(), tapeRows(board).map((r) => r.querySelector('.tape-time').textContent).join());
    check('the rest is behind one button', !!tapeMore(board));
    check('which counts every row it is hiding', tapeMore(board).textContent === '+7 more', tapeMore(board).textContent);

    // -- a row reads time · actor · id who · summary -------------------------
    const r0 = tapeRows(board)[0];
    check('a row reads time · actor · id who · summary', /15:42.*·.*Rae.*·.*S1100.*Mock Chemical Co\..*·.*NEEDS-QUOTE/.test(r0.textContent), r0.textContent);
    check('the clock string is printed verbatim', r0.querySelector('.tape-time').textContent === '15:42');

    // -- accents: one per actor, chip and row agree --------------------------
    const chipAccent = (name) => accentOf(tapeChips(board).find((c) => c.querySelector('.tape-chip-name').textContent === name));
    const rowAccents = tapeRows(board).map((r) => ({ actor: bare(r.querySelector('.tape-actor')), accent: accentOf(r.querySelector('.tape-actor')) }));
    check('every actor wears an accent', rowAccents.every((r) => !!r.accent) && tapeChips(board).every((c) => !!accentOf(c)));
    check('a row wears the same accent as its chip', rowAccents.every((r) => r.accent === chipAccent(r.actor)), JSON.stringify(rowAccents));
    check('two different actors are not the same colour by accident', new Set(['Rae', 'Kit', 'Odis'].map(chipAccent)).size === 3, ['Rae', 'Kit', 'Odis'].map(chipAccent).join());
    // The accent is a pure hash, so it must survive a second render unchanged.
    const again = new El('div');
    tape.render(again, tapeTile(day), { id: 'wss_tape', actions: {} });
    check('and the same name lands on the same accent every render', accentOf(again.querySelectorAll('.tape-chip')[0]) === chipAccent('Rae'));

    // -- the footer ----------------------------------------------------------
    check('a muted footer says how fresh the tape is', /as of 16:38 CT/.test(textOf(board)), textOf(board));
    const noRun = new El('div');
    tape.render(noRun, tapeTile({ ...day, last_fleet_run_ct: null }), { id: 'wss_tape', actions: {} });
    check('with no run time the footer is omitted entirely', !/as of/.test(textOf(noRun)) && countOf(noRun, 'tape-asof') === 0);

    // -- the sheet -----------------------------------------------------------
    tapeTap(tapeMore(board));
    check('the button opens the shared sheet', panel.calls.length === 1);
    check('titled Crew Tape', panel.last.title === 'Crew Tape');
    const sheet = panel.last.body;
    check('the sheet holds the whole day, not just the remainder', tapeRows(sheet).length === 12, String(tapeRows(sheet).length));
    check('in the same order', tapeRows(sheet).map((r) => r.querySelector('.tape-time').textContent).join() === TIMES.join());
    check('with the same chips at the top of it', tapeChips(sheet).map((c) => c.textContent).join('|') === 'Rae 5|Kit 4|Odis 3', tapeChips(sheet).map((c) => c.textContent).join('|'));
    check('the board is unchanged by opening it', tapeRows(board).length === 5);

    // A day that fits needs no way into a sheet that would hold the same rows.
    const short = new El('div');
    tape.render(short, tapeTile({ ...day, count: 3, items: day.items.slice(0, 3) }), { id: 'wss_tape', actions: {} });
    check('a day that fits offers no button', !tapeMore(short) && tapeRows(short).length === 3);
    // Exactly five is still a day that fits.
    const five = new El('div');
    tape.render(five, tapeTile({ ...day, count: 5, items: day.items.slice(0, 5) }), { id: 'wss_tape', actions: {} });
    check('and neither does a day of exactly five', !tapeMore(five) && tapeRows(five).length === 5);

    // -- what a row does with a missing part ---------------------------------
    console.log('\nwss_tape — ragged rows');
    const ragged = new El('div');
    tape.render(ragged, tapeTile({
      ...day,
      count: 5,
      items: [
        item('14:57', 'Rae', { id: 'S1042', who: '', summary: 'stage IN-PROGRESS → CLOSED' }),
        item('13:30', 'Odis', { id: 'S1008', unit: '112900', who: 'Fictional Foods' }),
        item('12:41', 'Mission Control', { kind: 'lead', id: 'L1077', who: 'Nowhere Logistics', summary: 'opened NEW' }),
        item('11:27', '', { id: 'S1101', who: 'Invented Plating' }),
        item('', 'Kit', { id: '', who: '', summary: 'reserve set for the week' }),
      ],
    }), { id: 'wss_tape', actions: {} });
    const rr = tapeRows(ragged);
    check('a closed ticket renders its id alone', countOf(rr[0], 'tape-who') === 0 && rr[0].querySelector('.tape-id').textContent === 'S1042');
    check('and prints no empty slot where the customer was', bare(rr[0].querySelector('.tape-what')) === 'S1042', bare(rr[0].querySelector('.tape-what')));
    check('a ticket that names a serial wears it as a mono suffix', rr[1].querySelector('.tape-unit').textContent === '112900');
    check('after the id, before the customer', /S1008.*112900.*Fictional Foods/.test(rr[1].textContent), rr[1].textContent);
    check('a serial-less row grows no unit suffix', countOf(rr[0], 'tape-unit') === 0 && countOf(rr[2], 'tape-unit') === 0);
    check('the intake bot is an actor like any other', bare(rr[2].querySelector('.tape-actor')) === 'Mission Control' && !!accentOf(rr[2].querySelector('.tape-actor')));
    check('an actorless row prints no leading separator', !/^\s*·/.test(rr[3].textContent), rr[3].textContent);
    check('and a row with neither an id nor a customer still renders', countOf(rr[4], 'tape-what') === 0 && /reserve set for the week/.test(rr[4].textContent), rr[4].textContent);
    // An item with nothing to say is a timestamp on a blank line, not an event.
    const hollow = new El('div');
    tape.render(hollow, tapeTile({ ...day, count: 2, items: [item('09:00', 'Kit', { id: '', summary: '' }), item('08:00', 'Rae')] }), { id: 'wss_tape', actions: {} });
    check('an item with neither an id nor a summary is dropped', tapeRows(hollow).length === 1);

    // The engine caps a summary at 140 characters; the board cannot recover if
    // it ever does not, so the module holds the same line.
    const long = new El('div');
    tape.render(long, tapeTile({ ...day, count: 1, items: [item('09:00', 'Kit', { summary: 'x'.repeat(400) })] }), { id: 'wss_tape', actions: {} });
    check('a runaway summary is clipped rather than left to push the board', long.querySelector('.tape-summary').textContent.length <= 141, String(long.querySelector('.tape-summary').textContent.length));
    check('and says it was clipped', /…$/.test(long.querySelector('.tape-summary').textContent));

    // -- a quiet day ---------------------------------------------------------
    console.log('\nwss_tape — a quiet day');
    const quiet = new El('div');
    tape.render(quiet, tapeTile({ title: 'Crew Tape', date: ymd(0), count: 0, by_actor: [], items: [], yesterday: day.yesterday, last_fleet_run_ct: '06:10' }), { id: 'wss_tape', actions: {} });
    check('an empty day says so plainly', /quiet so far/.test(textOf(quiet)));
    check('and lays out no rows', tapeRows(quiet).length === 0 && !tapeMore(quiet));
    check('with one muted line of yesterday', quiet.querySelector('.tape-yesterday').textContent === 'yesterday: 9 · Rae 4 · Kit 3 · Mission Control 2', quiet.querySelector('.tape-yesterday').textContent);
    check('the footer still says how fresh the tape is', /as of 06:10 CT/.test(textOf(quiet)));

    for (const [label, yesterday] of [['a quiet yesterday too', { date: ymd(-1), count: 0, by_actor: [] }], ['no yesterday at all', undefined], ['a yesterday of junk', { count: 'lots' }]]) {
      const alone = new El('div');
      tape.render(alone, tapeTile({ count: 0, items: [], yesterday }), { id: 'wss_tape', actions: {} });
      check(`${label} leaves "quiet so far" standing alone`, /quiet so far/.test(textOf(alone)) && countOf(alone, 'tape-yesterday') === 0, textOf(alone));
    }
    // A count the parser got wrong must not out-vote the items themselves.
    const counted = new El('div');
    tape.render(counted, tapeTile({ ...day, count: 0 }), { id: 'wss_tape', actions: {} });
    check('a wrong count never hides rows the payload does carry', tapeRows(counted).length === 5 && !/quiet so far/.test(textOf(counted)));
    const uncounted = new El('div');
    tape.render(uncounted, tapeTile({ count: 12, items: [], yesterday: day.yesterday }), { id: 'wss_tape', actions: {} });
    check('and a count with no items still reads as quiet', /quiet so far/.test(textOf(uncounted)));

    // -- stale vs error ------------------------------------------------------
    console.log('\nwss_tape — stale vs error');
    const stale = new El('div');
    tape.render(stale, tapeTile(day, 'stale', 'the 16:38 run half-finished'), { id: 'wss_tape', actions: {} });
    check('a stale tape still renders its rows', tapeRows(stale).length === 5);
    check('with a small warning mark beside them', countOf(stale, 'tape-warn') === 1);
    check('whose tooltip is the reason', stale.querySelector('.tape-warn').getAttribute('title') === 'the 16:38 run half-finished');
    const stale2 = new El('div');
    tape.render(stale2, tapeTile(day, 'stale', null), { id: 'wss_tape', actions: {} });
    check('and with no reason given, the mark still explains itself', !!stale2.querySelector('.tape-warn').getAttribute('title'));

    const bad = new El('div');
    tape.render(bad, tapeTile(day, 'error', 'no run report for today'), { id: 'wss_tape', actions: {} });
    check('an error tile lays out no rows of its own', tapeRows(bad).length === 0 && tapeChips(bad).length === 0);
    check('no way into a sheet that would be a lie', !tapeMore(bad));
    check('it falls back to the rule-9 generic card', countOf(bad, 'generic') === 1);
    check('which surfaces what the payload did carry', /count/.test(textOf(bad)) && /last_fleet_run_ct/.test(textOf(bad)));

    // -- rule 9: the payload is allowed to grow ------------------------------
    const grown = new El('div');
    tape.render(grown, tapeTile({
      ...day,
      count: 1,
      items: [{ ...item('14:57', 'Rae'), shift: 'second', applied_by_run: 'run-2026-09-17-1638' }],
      window: { from: ymd(0) },
      schema_note: 'v2 someday',
    }), { id: 'wss_tape', actions: {} });
    check('an unknown key on the payload changes nothing', tapeRows(grown).length === 1 && !/v2 someday/.test(textOf(grown)));
    check('and an unknown key on an item changes nothing', !/second|run-2026/.test(textOf(grown)), textOf(grown));

    // -- no sheet to open ----------------------------------------------------
    const inertTape = new El('div');
    let tapeThrew = null;
    try {
      tape.render(inertTape, tapeTile(day), { id: 'wss_tape', actions: {} });
      tapeTap(tapeMore(inertTape));
    } catch (e) { tapeThrew = e; }
    check('a tap with no panel action never reaches the page', !tapeThrew, tapeThrew && tapeThrew.message);

    // -- T7: nothing is remembered ------------------------------------------
    // A day's tape is not a backlog: no badges, no "new since opened", and no
    // storage to hold either. Comments stripped first — the header SAYS "no
    // localStorage", and a header saying so is the opposite of a violation.
    const TAPE_SRC = fs
      .readFileSync(path.join(__dirname, '..', 'docs', 'tiles', 'wss_tape.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    check('the module never touches localStorage', !/localStorage/.test(TAPE_SRC));
    check('and ships no badge or "new since opened" mark', !/new-mark|badge/.test(TAPE_SRC));
    check('and never parses a date string it was handed', !/new Date/.test(TAPE_SRC));
  }

  // -- bets_live: the marquee board -----------------------------------------
  //
  // v1.6.0's two load-bearing claims are that the header is the sum of the
  // rows (B5) and that a locked pill never regresses (B3, in test-graders).
  // The first is asserted here by adding up what the DOM actually prints,
  // rather than by calling the same function the tile called.
  console.log('\nbets_live — the header, the form line and the board');
  const bets = mods.get('bets_live');
  const betsTile = (data, status = 'ok') => ({ band: 'DAILY', updated_at: '2026-09-18T21:00:00.000Z', status, error: null, data });
  const statOf = (root, label) =>
    root.querySelectorAll('.stat').find((s) => s.querySelector('.stat-label').textContent === label);
  const statValue = (root, label) => statOf(root, label).querySelector('.stat-value').textContent;
  const unitsCells = (root) => root.querySelectorAll('.ticket-units').map((n) => n.textContent);

  /** What a printed figure contributes to the lean: unsigned figures do not. */
  const contribution = (text) => {
    const m = String(text).match(/^([+−])(\d+(?:\.\d+)?)u$/);
    if (!m) return 0;
    return (m[1] === '+' ? 1 : -1) * Number(m[2]);
  };

  const gameIn = (over = {}) => ({ state: 'in', dead: false, detail: 'Q3 4:12', period: 3, clock: '4:12', home: { abbr: 'FIS', score: 17 }, away: { abbr: 'HKS', score: 20 }, ...over });
  const gamePost = (over = {}) => gameIn({ state: 'post', detail: 'Final', ...over });
  const gamePre = (over = {}) => gameIn({ state: 'pre', detail: '', home: { abbr: 'FIS', score: 0 }, away: { abbr: 'HKS', score: 0 }, ...over });

  const tkt = (over = {}) => ({
    id: 'bt-1',
    league: 'football/nfl',
    espn_event_id: 'ev-live',
    game: 'Harbor Kestrels at Foundry Ironsides',
    kick_ct: '2026-09-18 15:25',
    market: 'spread',
    side: 'away',
    line: -3.5,
    player: null,
    label: 'Kestrels -3.5',
    stake_u: 0.5,
    price: 125,
    class: 'core',
    sport: '🏈',
    to_win_u: 0.62,
    ...over,
  });

  const FORM = {
    window_days: 7,
    since: '2026-09-12',
    record: '14-9',
    wins: 14,
    losses: 9,
    net_u: 4.71,
    win_pct: 61,
    streak: 'W5',
    last: [
      { r: 'W', u: 1.23, d: '2026-09-17', s: '⚽', label: 'Cross Harbor ML' },
      { r: 'L', u: -0.5, d: '2026-09-17', s: '🏈', label: 'Sentinels +3' },
      { r: 'W', u: 0.48, d: '2026-09-16', s: '⚾', label: 'Drays -1.5' },
      { r: 'W', u: 0.91, d: '2026-09-16', s: '🏈', label: 'Kestrels over 24.5' },
      { r: 'W', u: 0.64, d: '2026-09-15', s: '🏀', label: 'Foremen -6.5' },
      { r: 'L', u: -1.0, d: '2026-09-15', s: '⚽', label: 'Riverbend ML' },
      { r: 'W', u: 0.45, d: '2026-09-14', s: '⚾', label: 'Under 8.5' },
      { r: 'W', u: 0.71, d: '2026-09-13', s: '⚽', label: 'BTTS' },
      { r: 'L', u: -0.75, d: '2026-09-13', s: '🏈', label: 'Vasquez anytime TD' },
      { r: 'W', u: 1.35, d: '2026-09-12', s: '🏀', label: 'Current ML' },
    ],
  };

  if (bets) {
    // -- B5: the header is the sum of the rows -------------------------------
    //
    // A deliberately mixed board: a cover, a bust, a push, a game still to
    // come, a finished win, and one ticket the Bookie could not price.
    const MIXED = [
      tkt({ id: 'm-lead', to_win_u: 0.62, stake_u: 0.5 }),
      tkt({ id: 'm-trail', to_win_u: 0.95, stake_u: 1.0 }),
      tkt({ id: 'm-push', to_win_u: 0.48, stake_u: 0.5 }),
      tkt({ id: 'm-pre', espn_event_id: 'ev-pre', to_win_u: 1.35, stake_u: 1.0, kick_ct: '2026-09-18 19:15' }),
      tkt({ id: 'm-win', espn_event_id: 'ev-post', to_win_u: 1.82, stake_u: 2.0 }),
      tkt({ id: 'm-lose', espn_event_id: 'ev-post', to_win_u: 0.42, stake_u: 0.75 }),
      tkt({ id: 'm-nopdice', to_win_u: null, price: null, stake_u: 0.25 }),
    ];
    const MIXED_GRADES = new Map([
      ['m-lead', { state: 'lead', label: 'COVERING', why: 'by 3' }],
      ['m-trail', { state: 'trail', label: 'TRAILING', why: 'short by 1' }],
      ['m-push', { state: 'push', label: 'PUSH', why: 'on the number' }],
      ['m-pre', { state: 'pre', label: 'PRE', why: 'not started' }],
      ['m-win', { state: 'win', label: 'WIN', why: 'final' }],
      ['m-lose', { state: 'lose', label: 'LOSS', why: 'final' }],
      ['m-nopdice', { state: 'lead', label: 'COVERING', why: 'by 3' }],
    ]);
    const MIXED_GAMES = new Map([
      ['ev-live', gameIn()],
      ['ev-pre', gamePre()],
      ['ev-post', gamePost()],
    ]);

    const mixedRoot = new El('div');
    bets.render(mixedRoot, betsTile({ bankroll_u: 42.5, open_u: 6, record: '11-9-1', tickets: MIXED, form: FORM }), {
      id: 'bets_live',
      actions: {},
      live: { grades: MIXED_GRADES, games: MIXED_GAMES, fetched_at: '2026-09-18T21:05:00.000Z', error: null },
    });

    const cells = unitsCells(mixedRoot);
    check('every ticket prints a units figure', cells.length === MIXED.length, cells.join('|'));
    const summed = cells.reduce((n, t) => n + contribution(t), 0);
    // +0.62 − 1.00 + 0 + 0 + 1.82 − 0.75 + 0 = +0.69
    check('the rows add up to what the header says (B5)', statValue(mixedRoot, 'lean now') === `+${summed.toFixed(2)}u`, `${statValue(mixedRoot, 'lean now')} vs ${summed}`);
    check('and that is the arithmetic, not just agreement', Math.abs(summed - 0.69) < 1e-9, String(summed));
    check('closed counts the finished games only', statValue(mixedRoot, 'closed') === '+1.07u', statValue(mixedRoot, 'closed'));
    check('the bankroll stays a plain number (B9)', statValue(mixedRoot, 'bankroll') === '42.5u');
    check('and wears no colour', statOf(mixedRoot, 'bankroll').className === 'stat');
    check('nothing on the tile editorialises about it', !/slow down|drawdown|careful/i.test(textOf(mixedRoot)));

    // -- B4: the figure per state -------------------------------------------
    // Rows are in BOARD order, not array order: the live card comes first
    // (B7), so the two finished tickets are last.
    check('a covering ticket shows what it returns, signed up', cells[0] === '+0.62u', cells[0]);
    check('a trailing ticket shows the stake at risk, signed down', cells[1] === '−1.00u', cells[1]);
    check('a push is exactly nothing', cells[2] === '0.00u', cells[2]);
    check('an unpriced ticket shows the stake even while leading (B4)', cells[3] === '0.25u', cells[3]);
    check('and therefore leans nowhere', contribution(cells[3]) === 0);
    check('a ticket yet to start shows its plain stake', cells[4] === '1.00u', cells[4]);
    check('a won ticket shows the return', cells[5] === '+1.82u', cells[5]);
    check('a lost ticket shows the stake', cells[6] === '−0.75u', cells[6]);
    const tones = mixedRoot.querySelectorAll('.ticket-units').map((n) => n.className);
    check('the winning side is green', tones[0].includes('ticket-units-good') && tones[5].includes('ticket-units-good'));
    check('the losing side is red', tones[1].includes('ticket-units-bad') && tones[6].includes('ticket-units-bad'));
    check('the undecided are neither', tones[2].includes('ticket-units-flat') && tones[4].includes('ticket-units-idle'));
    check('the stake and price line survives beside it', /0\.5u @ \+125/.test(textOf(mixedRoot)));
    check('and an unpriced ticket says so rather than printing undefined', / @ —/.test(textOf(mixedRoot)));
    check('no "undefined" anywhere on the board', !/undefined/.test(textOf(mixedRoot)));
    check('no "NaN" either', !/NaN/.test(textOf(mixedRoot)));
    check('the footer still says lean, not settlement', /This is a lean, not a settlement\./.test(textOf(mixedRoot)));
    check('and never says settled', !/settled/i.test(textOf(mixedRoot)));

    // -- B1/B6: the form line ------------------------------------------------
    console.log('\nbets_live — 7-day form (B1, B6)');
    const formEl = mixedRoot.querySelector('.bets-form');
    check('the form line is drawn', !!formEl);
    check('it reads window, record, net and rate', formEl.querySelector('.form-summary').textContent === '7d 14-9  ·  +4.71u  ·  61%', formEl.querySelector('.form-summary').textContent);
    check('the streak chip names the streak', formEl.querySelector('.form-streak').textContent.includes('W5'));
    check('a winning streak is hot', formEl.querySelector('.form-streak').className.includes('form-streak-hot'));
    check('and carries its glyph', /🔥/.test(formEl.textContent));
    const dots = mixedRoot.querySelectorAll('.form-dot');
    check('ten dots, one per settled ticket', dots.length === 10);
    check('newest first, in the engine\'s order', dots.map((d) => (d.className.includes('form-dot-w') ? 'W' : 'L')).join('') === 'WLWWWLWWLW', dots.map((d) => (d.className.includes('form-dot-w') ? 'W' : 'L')).join(''));
    check('each dot carries its own row in the tooltip', dots[0].getAttribute('title') === '2026-09-17 ⚽ Cross Harbor ML +1.23u', dots[0].getAttribute('title'));
    check('a loss reads as a loss', dots[1].getAttribute('title') === '2026-09-17 🏈 Sentinels +3 −0.50u', dots[1].getAttribute('title'));
    check('and says which it was to a screen reader', /^won —/.test(dots[0].getAttribute('aria-label')) && /^lost —/.test(dots[1].getAttribute('aria-label')));
    check('the date is printed verbatim, never reformatted (rule 7)', /2026-09-17/.test(dots[0].getAttribute('title')));

    const coldRoot = new El('div');
    bets.render(coldRoot, betsTile({ tickets: [], form: { ...FORM, streak: 'L3', net_u: -2.5, record: '4-9', win_pct: 31 } }), { id: 'bets_live', actions: {} });
    check('a losing streak is cold', coldRoot.querySelector('.form-streak').className.includes('form-streak-cold'));
    check('and carries the other glyph', /🧊/.test(textOf(coldRoot)) && /L3/.test(textOf(coldRoot)));
    check('a negative week is signed down', /−2.50u/.test(textOf(coldRoot)), textOf(coldRoot));

    for (const [label, form] of [['null', null], ['missing', undefined], ['a string', 'good week'], ['an array', []]]) {
      const noForm = new El('div');
      bets.render(noForm, betsTile({ tickets: [], form }), { id: 'bets_live', actions: {} });
      check(`form ${label} hides the whole line rather than showing zeros`, countOf(noForm, 'bets-form') === 0);
    }
    const partial = new El('div');
    bets.render(partial, betsTile({ tickets: [], form: { record: '3-1', last: [{ r: 'W', u: 1 }] } }), { id: 'bets_live', actions: {} });
    check('a form with no window still prints its record', /3-1/.test(textOf(partial)) && !/undefined/.test(textOf(partial)));
    check('and no streak chip it was not given', countOf(partial, 'form-streak') === 0);
    const oddStreak = new El('div');
    bets.render(oddStreak, betsTile({ tickets: [], form: { ...FORM, streak: 'S3' } }), { id: 'bets_live', actions: {} });
    check('a streak spelling this file cannot colour gets no chip', countOf(oddStreak, 'form-streak') === 0);
    const longForm = new El('div');
    bets.render(longForm, betsTile({ tickets: [], form: { ...FORM, last: [...FORM.last, ...FORM.last] } }), { id: 'bets_live', actions: {} });
    check('never more than ten dots, whatever the engine sends', countOf(longForm, 'form-dot') === 10);

    // -- B2/B7: the game cards ----------------------------------------------
    console.log('\nbets_live — sport, and live-first order (B2, B7)');
    const ORDER = [
      tkt({ id: 'o-post', espn_event_id: 'ev-post', game: 'POST GAME', kick_ct: '2026-09-18 12:00' }),
      tkt({ id: 'o-late', espn_event_id: 'ev-late', game: 'LATE GAME', kick_ct: '2026-09-18 7:30 PM', sport: '🏀' }),
      tkt({ id: 'o-early', espn_event_id: 'ev-early', game: 'EARLY GAME', kick_ct: '2026-09-18 11:00 AM', sport: '⚾' }),
      tkt({ id: 'o-live', espn_event_id: 'ev-live', game: 'LIVE GAME', kick_ct: '2026-09-18 15:25' }),
      tkt({ id: 'o-dead', espn_event_id: 'ev-dead', game: 'DEAD GAME', kick_ct: '2026-09-18 09:00' }),
    ];
    const orderRoot = new El('div');
    bets.render(orderRoot, betsTile({ tickets: ORDER }), {
      id: 'bets_live',
      actions: {},
      live: {
        grades: new Map(ORDER.map((t) => [t.id, { state: 'pre', label: 'PRE', why: 'not started' }])),
        games: new Map([
          ['ev-post', gamePost()],
          ['ev-late', gamePre()],
          ['ev-early', gamePre()],
          ['ev-live', gameIn()],
          ['ev-dead', { ...gamePre(), dead: true, detail: 'Postponed' }],
        ]),
        fetched_at: null,
        error: null,
      },
    });
    const cardTitles = orderRoot.querySelectorAll('.game-title').map((t) => t.textContent);
    check(
      'in-play first, then upcoming by kick, then decided',
      cardTitles.map((t) => t.replace(/[^A-Z ]/g, '').trim()).join('|') === 'LIVE GAME|EARLY GAME|LATE GAME|POST GAME|DEAD GAME',
      cardTitles.join('|')
    );
    check('a 7:30 PM kick sorts after an 11:00 AM one', cardTitles[1].includes('EARLY') && cardTitles[2].includes('LATE'));
    check('the sport rides in front of the matchup', cardTitles[0].startsWith('🏈'), cardTitles[0]);
    check('each card wears its own sport', orderRoot.querySelectorAll('.game-sport').map((s) => s.textContent).join('') === '🏈⚾🏀🏈🏈', orderRoot.querySelectorAll('.game-sport').map((s) => s.textContent).join(''));
    const noSport = new El('div');
    bets.render(noSport, betsTile({ tickets: [tkt({ sport: undefined })] }), { id: 'bets_live', actions: {} });
    check('a ticket with no sport simply has none', countOf(noSport, 'game-sport') === 0 && /Harbor Kestrels/.test(textOf(noSport)));

    // Tickets under one card keep the log's order.
    const grouped = new El('div');
    bets.render(grouped, betsTile({ tickets: [tkt({ id: 'g1', label: 'FIRST' }), tkt({ id: 'g2', label: 'SECOND' }), tkt({ id: 'g3', label: 'THIRD' })] }), { id: 'bets_live', actions: {} });
    check('one card per game, not one per ticket', countOf(grouped, 'game') === 1);
    check('and its tickets keep snapshot order', grouped.querySelectorAll('.ticket-label').map((n) => n.textContent).join('|') === 'FIRST|SECOND|THIRD');

    // -- B8: the state-flip pulse -------------------------------------------
    console.log('\nbets_live — the state-flip pulse (B8)');
    const pulseTicket = tkt({ id: 'pulse-1' });
    const pass = (state) => {
      const root = new El('div');
      bets.render(root, betsTile({ tickets: [pulseTicket] }), {
        id: 'bets_live',
        actions: {},
        live: { grades: new Map([['pulse-1', { state, label: state.toUpperCase(), why: 'x' }]]), games: new Map([['ev-live', gameIn()]]), fetched_at: null, error: null },
      });
      return root.querySelector('.ticket').className;
    };
    check('the first sight of a ticket never flashes', !/flip-/.test(pass('lead')));
    check('the same state again does not flash either', !/flip-/.test(pass('lead')));
    check('a move toward the money glows green', /flip-up/.test(pass('win')));
    check('and only for one render', !/flip-/.test(pass('win')));
    check('a move away from it glows red', /flip-down/.test(pass('trail')));
    check('a further slide still glows red', /flip-down/.test(pass('lose')));
    const sideways = (() => {
      const root = new El('div');
      bets.render(root, betsTile({ tickets: [tkt({ id: 'pulse-2' })] }), { id: 'bets_live', actions: {}, live: { grades: new Map([['pulse-2', { state: 'pre', label: 'PRE', why: '' }]]), games: new Map(), fetched_at: null, error: null } });
      const second = new El('div');
      bets.render(second, betsTile({ tickets: [tkt({ id: 'pulse-2' })] }), { id: 'bets_live', actions: {}, live: { grades: new Map([['pulse-2', { state: 'push', label: 'PUSH', why: '' }]]), games: new Map(), fetched_at: null, error: null } });
      return second.querySelector('.ticket').className;
    })();
    check('pre to push is not a direction, so no glow', !/flip-/.test(sideways), sideways);
    // Losing the band and getting it back must not read as a state change.
    const forget = (() => {
      const root = new El('div');
      bets.render(root, betsTile({ tickets: [tkt({ id: 'pulse-3' })] }), { id: 'bets_live', actions: {}, live: { grades: new Map([['pulse-3', { state: 'lead', label: 'COVERING', why: '' }]]), games: new Map(), fetched_at: null, error: null } });
      const ungraded = new El('div');
      bets.render(ungraded, betsTile({ tickets: [tkt({ id: 'pulse-3' })] }), { id: 'bets_live', actions: {} });
      const back = new El('div');
      bets.render(back, betsTile({ tickets: [tkt({ id: 'pulse-3' })] }), { id: 'bets_live', actions: {}, live: { grades: new Map([['pulse-3', { state: 'win', label: 'WIN', why: '' }]]), games: new Map(), fetched_at: null, error: null } });
      return back.querySelector('.ticket').className;
    })();
    check('a grade arriving after an ungraded pass is not a flip', !/flip-/.test(forget), forget);
    const BETS_SRC = fs
      .readFileSync(path.join(__dirname, '..', 'docs', 'tiles', 'bets_live.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    check('the pulse is remembered in memory only, never stored', !/localStorage|sessionStorage/.test(BETS_SRC));

    // -- degradation ---------------------------------------------------------
    console.log('\nbets_live — no band, no tickets');
    const bare = new El('div');
    bets.render(bare, betsTile({ bankroll_u: 42.5, open_u: 6, record: '11-9-1', tickets: [tkt({ id: 'bare-1' })] }), { id: 'bets_live', actions: {} });
    check('with no grader running, lean now is a dash', statValue(bare, 'lean now') === '—');
    check('and closed is too', statValue(bare, 'closed') === '—');
    check('the row says it is not graded yet', /not graded yet/.test(textOf(bare)));
    check('and still shows the stake', unitsCells(bare)[0] === '0.50u');
    const allPre = new El('div');
    bets.render(allPre, betsTile({ tickets: [tkt({ id: 'pre-only' })] }), {
      id: 'bets_live',
      actions: {},
      live: { grades: new Map([['pre-only', { state: 'pre', label: 'PRE', why: 'not started' }]]), games: new Map(), fetched_at: null, error: null },
    });
    check('a graded board that leans nowhere says 0.00u, not a dash', statValue(allPre, 'lean now') === '0.00u');
    const none = new El('div');
    bets.render(none, betsTile({ tickets: [] }), { id: 'bets_live', actions: {} });
    check('an empty board says so', /No open tickets/.test(textOf(none)));
    check('and still carries its header', countOf(none, 'bets-stats') === 1);
    const downed = new El('div');
    bets.render(downed, betsTile({ tickets: [tkt({ id: 'down-1' })] }), { id: 'bets_live', actions: {}, live: { grades: new Map(), games: new Map(), fetched_at: null, error: 'espn http 503' } });
    check('a dead feed says so without blanking the board', /feed unavailable/.test(textOf(downed)) && countOf(downed, 'ticket') === 1);
  }

  // -- cards: the desk ------------------------------------------------------
  //
  // The tile is a two-button menu and the listings are in the sheet, so the
  // assertions split the same way. The two that matter most are the ones that
  // could quietly cost money: the badge must only count flags standing on a
  // book the engine still trusts, and every figure on a row must be the
  // engine's own — an `all_in` this page computed would look exactly like a
  // real one and be wrong.
  console.log('\ncards — the desk menu');
  const cards = mods.get('cards');
  const cardsTap = (btn) => btn.listeners.click[0]({ stopPropagation() {} });
  const cardsTile = (data, status = 'ok', error = null) => ({
    band: 'HOURLY',
    updated_at: '2026-09-18T21:00:00.000Z',
    status,
    error,
    data,
  });

  /**
   * Freeze the clock. The amber dot is a comparison against Central wall time
   * NOW, and a test that built its fixtures from the real clock would flip on
   * whichever minute it happened to run in. `new Date()` resolves the global
   * at call time, so replacing it reaches inside lib/fmt.js.
   */
  function withNow(iso, fn) {
    const Real = Date;
    class Frozen extends Real {
      constructor(...a) { super(...(a.length ? a : [iso])); }
      static now() { return Real.parse(iso); }
    }
    global.Date = Frozen;
    try { return fn(); } finally { global.Date = Real; }
  }
  /**
   * A clock that can be wound forward, and STAYS installed until it is put
   * back. `withNow` freezes an instant for the length of one call, which is
   * right for a render; a countdown has to be watched moving across several,
   * so this one is installed, advanced, and restored by hand.
   */
  function windClock(startIso) {
    const Real = Date;
    let t = Real.parse(startIso);
    class Wound extends Real {
      constructor(...a) { super(...(a.length ? a : [t])); }
      static now() { return t; }
    }
    global.Date = Wound;
    return {
      advance: (ms) => { t += ms; },
      restore: () => { global.Date = Real; },
    };
  }

  // 22:30Z is 17:30 Central — so 19:29 is 1h59 out and 19:31 is 2h01 out.
  // Each auction carries BOTH end times, as the engine now publishes them:
  // the wall stamp is printed, the instant is counted from, and the two
  // describe the same moment (19:29 CDT is 00:29Z the next day).
  const NOW_UTC = '2026-09-18T22:30:00.000Z';
  const ENDS_SOON = '2026-09-18T19:29';
  const ENDS_SOON_UTC = '2026-09-19T00:29:00.000Z';
  const ENDS_LATER = '2026-09-18T19:31';
  const ENDS_LATER_UTC = '2026-09-19T00:31:00.000Z';

  /** One invented listing. Everything the engine decides is passed in. */
  const listing = (over = {}) => ({
    item_id: '9000-0001',
    title: 'Invented Player Prism Foundry RC Refractor PSA 9',
    player: 'Invented Player',
    rung: 'RC refractor',
    fmv: 260,
    tag: 'SOLID',
    lane: 'FLIP',
    type: 'BIN',
    price: 129,
    ship: 4.99,
    all_in: 133.99,
    pct_fmv: 0.51,
    max: 169,
    gate: 0.65,
    book_age_days: 3,
    book_state: 'fresh',
    ends_ct: null,
    ends_utc: null,
    seller: 'mock_seller',
    seller_fb: 1204,
    listed: '2026-09-16',
    url: 'https://example.com/mock/cards/1',
    image: 'https://example.com/mock/cards/1.jpg',
    band: null,
    new: false,
    ...over,
  });

  const FLAGS = [
    listing({ item_id: 'f1', title: 'FLAG-ONE', type: 'BIN' }),
    listing({
      item_id: 'f2',
      title: 'FLAG-TWO',
      type: 'OBO',
      pct_fmv: 0.71,
      band: 'OVER BAND',
      max: 182,
      all_in: 199.5,
      new: true,
    }),
    listing({
      item_id: 'f3',
      title: 'FLAG-THREE',
      book_state: 'aging',
      book_age_days: 30,
      url: 'javascript:alert(1)',
      image: null,
    }),
  ];
  const AUCTIONS = [
    listing({ item_id: 'a1', title: 'AUCTION-ONE', type: 'AUCTION', price: 410, ends_ct: ENDS_SOON, ends_utc: ENDS_SOON_UTC, book_state: 'fresh', pct_fmv: 0.47 }),
    listing({ item_id: 'a2', title: 'AUCTION-TWO', type: 'AUCTION', price: 31, ends_ct: ENDS_LATER, ends_utc: ENDS_LATER_UTC, new: true }),
  ];
  const UNBOOKED = [
    { player: 'Unbooked One', rung: 'rookie auto', book_age_days: 61, cheapest_all_in: 88.25, url: 'https://example.com/mock/cards/search-1' },
    { player: 'Unbooked Two', rung: 'prizm silver', book_age_days: 44, cheapest_all_in: null, url: null },
  ];

  const deskData = (over = {}) => ({
    watch: {
      updated_at: '2026-09-18T21:42:00.000Z',
      targets: 14,
      booked: 12,
      fresh: 9,
      oldest_book_days: 30,
      calls: 26,
      flags: FLAGS,
      auctions: AUCTIONS,
      unbooked: UNBOOKED,
      errors: [],
      ...over,
    },
    shop: null,
    sources: { listings: 'eBay Browse API', fmv: 'mock comp engine', shop: 'pending' },
    footer: 'lean, not an appraisal',
  });

  const cardBtns = (root) => root.querySelectorAll('.cards-btn');
  const labelsOf = (root) => cardBtns(root).map((b) => b.querySelector('.cards-btn-label').textContent);

  if (cards) withTimers((timers) => {
    const panel = fakePanel();
    const root = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData()), { id: 'cards', actions: panel.actions });
      return r;
    });

    check('three buttons, in the spec\'s order', labelsOf(root).join('|') === 'Watch|Shop|PC', labelsOf(root).join('|'));
    check('the board carries no listings of its own', countOf(root, 'cards-row') === 0);
    // This fixture carries no `pc`, deliberately: everything in this block is
    // the Watch regression, and it must read exactly as it did before the
    // third face existed. The PC line is asserted in its own block below.
    check('one faint line for the one live face', countOf(root, 'tile-foot') === 1);
    check(
      'and it counts targets, fresh books and the feed time',
      /14 targets/.test(textOf(root)) && /9 fresh books/.test(textOf(root)) && /feed \d/.test(textOf(root)),
      textOf(root)
    );

    // -- the badge: fresh flags, and nothing else ----------------------------
    //
    // Three flags, one of them on a 30-day-old book, plus two auctions. Only
    // the two fresh flags may be counted: a percentage resting on a stale book
    // is a guess, and a current bid is not a price.
    const badge = root.querySelector('.cards-count');
    check('the badge counts fresh flags only', badge && badge.textContent.startsWith('2'), badge && badge.textContent);
    check('so an aging flag is not in it', !/3/.test(badge.textContent));
    check('and no auction is either', !/4|5/.test(badge.textContent));
    check('a fresh flag marked new puts a new mark on the badge', countOf(root, 'cards-count-new') === 1);

    const quiet = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({ flags: [], auctions: [] })), { id: 'cards', actions: {} });
      return r;
    });
    check(
      'nothing fresh means no badge at all, not a zero',
      countOf(quiet, 'cards-count') === 0 && !/\d/.test(cardBtns(quiet)[0].textContent),
      cardBtns(quiet)[0].textContent
    );

    const staleNew = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({
        flags: [listing({ item_id: 'f1', new: false }), listing({ item_id: 'f3', book_state: 'aging', book_age_days: 30, new: true })],
      })), { id: 'cards', actions: {} });
      return r;
    });
    check('a new mark on an AGING flag does not reach the badge', countOf(staleNew, 'cards-count-new') === 0);
    check('though the flag itself still counts as a flag, not as fresh', staleNew.querySelector('.cards-count').textContent === '1');

    // -- the amber dot: 1h59 vs 2h01 -----------------------------------------
    check('an auction 1h59 out raises the amber dot', countOf(root, 'cards-dot') === 1);
    const later = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({ auctions: [AUCTIONS[1]] })), { id: 'cards', actions: {} });
      return r;
    });
    check('2h01 out does not', countOf(later, 'cards-dot') === 0);
    const none = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({ auctions: [] })), { id: 'cards', actions: {} });
      return r;
    });
    check('and no auctions at all certainly does not', countOf(none, 'cards-dot') === 0);
    // A stamp the engine has not cleared out yet is at least as urgent as one
    // two hours away — it must not go quiet at the moment it matters most.
    const past = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({ auctions: [listing({ type: 'AUCTION', ends_ct: '2026-09-18T16:00', ends_utc: '2026-09-18T21:00:00.000Z' })] })), { id: 'cards', actions: {} });
      return r;
    });
    check('an auction already past still shows the dot', countOf(past, 'cards-dot') === 1);

    // -- shop: a face that does not exist yet --------------------------------
    const shopBtn = cardBtns(root)[1];
    check('shop: null is a button, not a blank', shopBtn.querySelector('.cards-btn-label').textContent === 'Shop');
    check('greyed, wearing "soon"', shopBtn.className.includes('cards-btn-soon') && /soon/.test(shopBtn.textContent));
    check('and inert', shopBtn.getAttribute('disabled') === 'disabled');

    // -- the Watch sheet -----------------------------------------------------
    console.log('\ncards — the Watch sheet');
    withNow(NOW_UTC, () => cardsTap(cardBtns(root)[0]));
    check('a tap opens the sheet', panel.calls.length === 1);
    check('titled with the emoji and the face', panel.last.title === '🎯 Watch');
    const sheet = panel.last.body;
    const rowTitles = sheet.querySelectorAll('.cards-title').map((t) => t.textContent);
    check(
      'flags then auctions, each in the order the engine sent them',
      rowTitles.join('|') === 'FLAG-ONE|FLAG-TWO|FLAG-THREE|AUCTION-ONE|AUCTION-TWO',
      rowTitles.join('|')
    );
    check('both sections are headed', sheet.querySelectorAll('.cards-head').map((h) => h.textContent).join('|') === 'Flags|Auctions');

    // -- every figure is the payload's ---------------------------------------
    //
    // `all_in` on FLAG-TWO is deliberately NOT price + ship. The page must
    // print what it was given: a number this file computed would be
    // indistinguishable from a real one, and wrong.
    const allIns = sheet.querySelectorAll('.cards-allin').map((n) => n.textContent);
    check('all_in comes from the payload verbatim', allIns[1] === '$199.50', allIns[1]);
    check('never recomputed from price + ship', !/\$133\.99/.test(allIns[1]) && !/\$186\.50/.test(textOf(sheet)));
    check('and every row has one', allIns.length === 5);
    const maxes = sheet.querySelectorAll('.cards-chip-max').map((n) => n.textContent);
    check('MAX comes from the payload verbatim', maxes[1] === 'MAX $182.00', maxes[1]);
    check('never recomputed from fmv × gate', !/MAX \$169\.00/.test(maxes[1]));

    // -- the gate, and the tick ----------------------------------------------
    check('a fresh flag under the gate is green', countOf(sheet, 'cards-fmv-good') === 1);
    check('a flag over the gate is not', /71% of FMV/.test(textOf(sheet)) && countOf(sheet, 'cards-fmv-good') === 1);
    check('an aging book loses the tick', sheet.querySelectorAll('.cards-fmv')[2].className.includes('cards-fmv-muted'));
    check('and says how old it is', /book 30d old/.test(textOf(sheet)));
    check('an auction is never green', sheet.querySelectorAll('.cards-fmv').slice(3).every((c) => c.className.includes('cards-fmv-muted')));
    check('a percentage is printed as a percentage', /51% of FMV \$260\.00/.test(textOf(sheet)), textOf(sheet).slice(0, 200));

    // -- chips ----------------------------------------------------------------
    check('an OBO listing says so', countOf(sheet, 'cards-chip-obo') === 1);
    check('an OVER BAND listing says so', sheet.querySelector('.cards-chip-band').textContent === 'OVER BAND');
    check('a new listing wears a new mark', countOf(sheet, 'cards-new-mark') === 2);
    check('the seller and its feedback are shown', /mock_seller/.test(textOf(sheet)) && /1,204 fb/.test(textOf(sheet)));

    // -- the end time: Central, formatted off the instant --------------------
    //
    // 00:29Z and 00:31Z on the 19th are 7:29 PM and 7:31 PM Central on the
    // 18th. The wall stamp the payload also carries is NOT what is printed —
    // it is the pre-v1.6 fallback and nothing else.
    check('the row prints Central clock time', /ends 7:29 PM/.test(textOf(sheet)) && /ends 7:31 PM/.test(textOf(sheet)), textOf(sheet).slice(0, 200));
    for (const a of AUCTIONS) {
      check(`the raw ends_ct ${a.ends_ct} is not on the page`, !textOf(sheet).includes(a.ends_ct));
    }
    const ends = sheet.querySelectorAll('.cards-ends');
    check('the auction inside two hours is amber', ends[0].className.includes('cards-ends-soon'));
    check('the one two days out is not', !ends[1].className.includes('cards-ends-soon'));
    check('no ends line on a flag', ends.length === 2);

    // -- links ---------------------------------------------------------------
    const anchors = sheet.querySelectorAll('A');
    check('a row with a url is a link', anchors.length >= 4);
    check('every link opens a new tab', anchors.every((a) => a.getAttribute('target') === '_blank'));
    check('and never hands over a handle on this page', anchors.every((a) => /noopener/.test(a.getAttribute('rel') || '')));
    check('a javascript: url is inert, and the row survives', !anchors.some((a) => /javascript/i.test(a.getAttribute('href') || '')) && /FLAG-THREE/.test(textOf(sheet)));
    const imgs = sheet.querySelectorAll('IMG');
    check('a photo is a photo', imgs.length === 4 && imgs[0].getAttribute('src') === 'https://example.com/mock/cards/1.jpg');
    check('its alt is the title, as text', imgs[0].getAttribute('alt') === 'FLAG-ONE');
    check('it leaks no referrer and waits to load', imgs[0].getAttribute('referrerpolicy') === 'no-referrer' && imgs[0].getAttribute('loading') === 'lazy');
    check('a listing with no photo still holds the space', countOf(sheet, 'cards-thumb-none') === 1);

    // -- no book: folded shut ------------------------------------------------
    const fold = sheet.querySelector('.cards-fold');
    check('the no-book list is behind one button', !!fold && /No book \(2\)/.test(fold.textContent));
    check('and is collapsed by default', sheet.querySelector('.cards-nb').classList.contains('hidden'));
    check('it says so to a screen reader too', fold.getAttribute('aria-expanded') === 'false');
    cardsTap(fold);
    check('tapping unfolds it', !sheet.querySelector('.cards-nb').classList.contains('hidden'));
    check('and flips the state', fold.getAttribute('aria-expanded') === 'true');
    check('the rows read player · rung — book age · cheapest', /Unbooked One/.test(textOf(sheet)) && /book 61d old/.test(textOf(sheet)) && /cheapest \$88\.25/.test(textOf(sheet)));
    check('a target with no cheapest simply does not mention one', !/cheapest —/.test(textOf(sheet)));
    check('a no-book row with a url is tappable', sheet.querySelectorAll('.cards-nb-row').some((r) => r.tagName === 'A'));
    check('and one without stays a plain row', sheet.querySelectorAll('.cards-nb-row').some((r) => r.tagName === 'DIV'));

    // -- the footer, once ----------------------------------------------------
    check('one footer, at the bottom', countOf(sheet, 'cards-foot') === 1);
    check('the vault\'s words plus eBay\'s credit', sheet.querySelector('.cards-foot').textContent === 'lean, not an appraisal · eBay data via Browse API', sheet.querySelector('.cards-foot').textContent);

    // -- nothing anywhere reads as a bug -------------------------------------
    check('no "undefined" on the board or in the sheet', !/undefined/.test(textOf(root)) && !/undefined/.test(textOf(sheet)));
    check('no "NaN" either', !/NaN/.test(textOf(root)) && !/NaN/.test(textOf(sheet)));

    // -- empty states --------------------------------------------------------
    console.log('\ncards — empty, ragged and degraded');
    const emptyPanel = fakePanel();
    const emptyRoot = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({ flags: [], auctions: [], unbooked: [] })), { id: 'cards', actions: emptyPanel.actions });
      return r;
    });
    withNow(NOW_UTC, () => cardsTap(cardBtns(emptyRoot)[0]));
    check('no flags says so plainly', /Nothing under the gate right now/.test(textOf(emptyPanel.last.body)));
    check('no auctions omits the section entirely', !/Auctions/.test(textOf(emptyPanel.last.body)));
    check('no unbooked omits the fold', countOf(emptyPanel.last.body, 'cards-fold') === 0);
    check('the footer still appears exactly once', countOf(emptyPanel.last.body, 'cards-foot') === 1);

    // A payload with holes in every field: the row must still lay out, and no
    // hole may render as a zero, an "undefined" or a "NaN".
    const raggedPanel = fakePanel();
    const raggedRoot = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile({
        watch: {
          flags: [{ item_id: 'x', book_state: 'fresh' }, { title: 'HALF', price: 10, book_state: 'fresh' }],
          auctions: [{ title: 'NO-END', type: 'AUCTION' }],
          unbooked: [{ player: 'Bare' }, {}, null, 'nope'],
        },
      }), { id: 'cards', actions: raggedPanel.actions });
      return r;
    });
    withNow(NOW_UTC, () => cardsTap(cardBtns(raggedRoot)[0]));
    const ragged = raggedPanel.last.body;
    check('a row missing everything still lays out', countOf(ragged, 'cards-row') === 3);
    check('and says so rather than printing undefined', /\(untitled listing\)/.test(textOf(ragged)));
    check('no "undefined" survives a half-missing payload', !/undefined/.test(textOf(ragged)) && !/undefined/.test(textOf(raggedRoot)));
    check('no "NaN" survives it either', !/NaN/.test(textOf(ragged)) && !/NaN/.test(textOf(raggedRoot)));
    check('a missing amount reads as unknown, never as $0.00', /—/.test(textOf(ragged)) && !/\$0\.00/.test(textOf(ragged)));
    check('an auction with no end time prints no ends line', countOf(ragged, 'cards-ends') === 0);
    check('junk in the unbooked list is dropped, not rendered', countOf(ragged, 'cards-nb-row') === 1);
    check('a payload with no footer still credits eBay', ragged.querySelector('.cards-foot').textContent === 'eBay data via Browse API');

    // -- stale vs error ------------------------------------------------------
    const staleRoot = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData({ errors: ['eBay Browse API: 3 of 14 searches rate-limited (429)'] }), 'stale', 'the 06:00 pull did not finish'), { id: 'cards', actions: panel.actions });
      return r;
    });
    check('a stale desk still renders its menu', cardBtns(staleRoot).length === 3 && !!staleRoot.querySelector('.cards-count'));
    check('with a small warning mark', countOf(staleRoot, 'cards-warn') === 1);
    check('whose tooltip is the reason', staleRoot.querySelector('.cards-warn').getAttribute('title') === 'the 06:00 pull did not finish');
    withNow(NOW_UTC, () => cardsTap(cardBtns(staleRoot)[0]));
    check('the sheet reports what the feed could not reach', /rate-limited/.test(textOf(panel.last.body)));
    const noReason = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData(), 'stale', null), { id: 'cards', actions: {} });
      return r;
    });
    check('and with no reason given, the mark still explains itself', !!noReason.querySelector('.cards-warn').getAttribute('title'));

    const bad = new El('div');
    cards.render(bad, cardsTile(deskData(), 'error', 'the listing pull failed outright'), { id: 'cards', actions: {} });
    check('an error tile lays out no desk of its own', cardBtns(bad).length === 0 && countOf(bad, 'cards-row') === 0);
    check('it falls back to the rule-9 generic card', countOf(bad, 'generic') === 1);

    // -- rule 9: the payload is allowed to grow ------------------------------
    const grown = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile({ watch: { flags: [listing({ grade_note: 'PSA pop 12' })], targets: 3 }, shop: { queue: 2, note: 'shipped' }, footer: 'x' }), { id: 'cards', actions: panel.actions });
      return r;
    });
    check('a shop face that arrives stops saying "soon"', countOf(grown, 'cards-btn-soon') === 1 && cardBtns(grown).length === 3);
    withNow(NOW_UTC, () => cardsTap(cardBtns(grown)[1]));
    // A shop face carrying fields this page has never heard of, and none of
    // the ones it looks for: the sheet opens, says what it honestly knows,
    // and neither throws nor invents a storefront out of `queue` and `note`.
    check('and opens its own sheet rather than nothing', /Nothing listed right now/.test(textOf(panel.last.body)));
    check('without choking on fields it does not know', !/undefined|NaN/.test(textOf(panel.last.body)));
    const noWatch = new El('div');
    cards.render(noWatch, cardsTile({ shop: null }), { id: 'cards', actions: {} });
    check('a payload with no watch face greys that button too', countOf(noWatch, 'cards-btn-soon') === 3);

    // -- no sheet to open ----------------------------------------------------
    let cardsThrew = null;
    try {
      const inert = withNow(NOW_UTC, () => {
        const r = new El('div');
        cards.render(r, cardsTile(deskData()), { id: 'cards', actions: {} });
        return r;
      });
      cardsTap(cardBtns(inert)[0]);
    } catch (e) { cardsThrew = e; }
    check('a tap with no panel action never reaches the page', !cardsThrew, cardsThrew && cardsThrew.message);

    // -- rule 7: nothing here parses a date ----------------------------------
    const CARDS_SRC = fs
      .readFileSync(path.join(__dirname, '..', 'docs', 'tiles', 'cards.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const CARDS_CSS = fs.readFileSync(path.join(__dirname, '..', 'docs', 'style.css'), 'utf8');
    check('the module never parses a date string', !/new Date|Date\.parse/.test(CARDS_SRC));
    // The engine's arithmetic is the engine's. A number computed here would
    // be indistinguishable from a real one on the screen, and wrong.
    check('it never adds price and ship into an all-in', !/(price|ship)\s*\+\s*[a-z]*\.?(ship|price)/i.test(CARDS_SRC));
    check('nor multiplies an FMV by the gate', !/(fmv\s*\*|\*\s*[a-z]*\.?gate)/i.test(CARDS_SRC));
    check('and never reformats ends_ct', !/ends_ct[\s\S]{0,60}(ctKick|ctClock|prettyDate)/.test(CARDS_SRC));
    // The invariant, stated as a scan as well as proven by the spy below:
    // the wall stamp is never handed to anything that reads a date. It is
    // printed raw on the one row that has nothing else, and that is all.
    check('nor hands endsCt to a date reader', !/(msUntil|ctTime|Date\.parse|new Date)\s*\(\s*[a-z]*\.?endsCt/i.test(CARDS_SRC));
    check('the end time is formatted off the instant', /ctTime\(\s*item\.endsUtc\s*\)/.test(CARDS_SRC));
    check('and the countdown counted off it too', /msUntil\(\s*item\.endsUtc\s*\)/.test(CARDS_SRC));
    check('it holds no state between renders', !/localStorage/.test(CARDS_SRC));

    // -- v1.6.0: the live countdown ------------------------------------------
    //
    // The countdown is counted from `ends_utc`, a real instant with an offset
    // on it. `ends_ct` is the same moment written as Central wall text with NO
    // offset, and it stays text forever: a browser handed it would guess a
    // zone and guess the phone's, which is rule 7's disqualifying bug. So the
    // two are tested as two different things — one is arithmetic, the other is
    // a string that has to survive to the screen untouched.
    console.log('\ncards — live auction countdowns');

    const MIN = 60000;
    const HOUR = 3600000;
    const CLOCK = '2026-09-20T18:00:00.000Z';
    // Relative to the wound clock as it stands, so a fixture written as
    // "90 minutes out" is still 90 minutes out after the clock has moved on.
    const at = (ms) => new Date(Date.now() + ms).toISOString();

    // One wound clock for the whole section. Everything below reads it, so a
    // row built at 18:00 and repainted at 19:00 disagrees by exactly an hour
    // and not by however long the test suite happened to take.
    const clock = windClock(CLOCK);
    const opened = [];

    const auction = (label, ms, over = {}) =>
      listing({
        item_id: label,
        title: label,
        type: 'AUCTION',
        // Deliberately not a clean stamp: the page prints this string, it
        // does not understand it, and the test should prove that.
        ends_ct: `2026-09-20T13:00 (${label})`,
        ends_utc: at(ms),
        ...over,
      });

    /**
     * Render the board, tap Watch, and hand back both halves.
     *
     * Every sheet opened before this one is shut first, because the shell
     * only ever has one panel up — and because a test that let three sheets
     * tick at once could not tell "one interval per sheet" from "three".
     */
    function openWatch(auctions) {
      for (const v of opened) v.panel.close();
      const pnl = fakePanel();
      const board = new El('div');
      cards.render(board, cardsTile(deskData({ flags: [], auctions, unbooked: [] })), {
        id: 'cards',
        actions: pnl.actions,
      });
      cardsTap(cardBtns(board)[0]);
      const view = { board, panel: pnl, get sheet() { return pnl.last.body; } };
      opened.push(view);
      return view;
    }

    const valuesOf = (sheet) => sheet.querySelectorAll('.cards-countdown-value').map((n) => n.textContent);
    const only = (view) => valuesOf(view.sheet)[0];

    try {
      // -- every rung of the ladder, and both sides of every boundary --------
      const LADDER = [
        ['25h', 25 * HOUR, '1d 1h'],
        ['24h', 24 * HOUR, '24h 00m'],
        ['3h07m', 3 * HOUR + 7 * MIN, '3h 07m'],
        ['59m', 59 * MIN, '59m'],
        ['15m', 15 * MIN, '15m'],
        ['14m59s', 14 * MIN + 59000, '14m 59s'],
        ['1s', 1000, '0m 01s'],
        ['zero', 0, 'ended'],
        ['negative', -90 * MIN, 'ended'],
      ];
      const ladder = openWatch(LADDER.map(([label, ms]) => auction(label, ms)));
      const rungs = valuesOf(ladder.sheet);
      check('every auction row carries a countdown', rungs.length === LADDER.length, String(rungs.length));
      LADDER.forEach(([label, , want], i) => {
        check(`${label} out reads "${want}"`, rungs[i] === want, rungs[i]);
      });

      // -- amber: on at 1h59, off at 2h01, on the row AND the board dot ------
      const inside = openWatch([auction('INSIDE', HOUR + 59 * MIN)]);
      check('1h59 out turns the row amber', countOf(inside.sheet, 'cards-ends-soon') === 1);
      check('and raises the dot on the board', countOf(inside.board, 'cards-dot') === 1);
      const outside = openWatch([auction('OUTSIDE', 2 * HOUR + MIN)]);
      check('2h01 out leaves the row plain', countOf(outside.sheet, 'cards-ends-soon') === 0);
      check('and the board quiet', countOf(outside.board, 'cards-dot') === 0);
      const exact = openWatch([auction('EXACT', 2 * HOUR)]);
      check('exactly two hours is still inside the window', countOf(exact.sheet, 'cards-ends-soon') === 1);

      // -- zero: grey, "ended", and still on the page ------------------------
      //
      // The row leaves the board on the engine's next pass, never mid-scroll
      // under Matt's thumb.
      const done = openWatch([auction('DONE', -5 * MIN)]);
      check('a lot that has run out says "ended"', only(done) === 'ended', only(done));
      check('and is still in the DOM', countOf(done.sheet, 'cards-row') === 1 && /DONE/.test(textOf(done.sheet)));
      check('greyed rather than amber', countOf(done.sheet, 'cards-ends-done') === 1 && countOf(done.sheet, 'cards-ends-soon') === 0);
      check('the whole row greys, not just its clock', countOf(done.sheet, 'cards-row-ended') === 1);

      // -- the displayed time comes off the instant, in Central --------------
      //
      // The invariant used to be "ends_ct reaches the DOM character for
      // character". That was the wrong invariant: `ends_ct` is not a display
      // field at all now, it is the pre-v1.6 fallback. The invariant that
      // matters is the one below and in the Date spy further down — `ends_ct`
      // is never handed to Date, Date.parse or msUntil.
      const stamps = openWatch([
        auction('S1', 90 * MIN),
        auction('S2', 3 * 24 * HOUR),
        auction('S3', -MIN),
        listing({ item_id: 'S4', title: 'S4', type: 'AUCTION', ends_ct: '2026-09-20T19:48', ends_utc: null }),
      ]);
      check('every auction row keeps an end-time line', countOf(stamps.sheet, 'cards-ends') === 4);
      // CLOCK is 18:00Z, which is 1:00 PM Central; S1 is 90 minutes past it.
      check('a row with an instant prints Central clock time', /ends 2:30 PM/.test(textOf(stamps.sheet)), textOf(stamps.sheet).slice(0, 240));
      check('the fixtures\' raw wall stamps stay off the page', !textOf(stamps.sheet).includes('2026-09-20T13:00'));
      // No row with an instant may leak a machine-readable timestamp: not the
      // wall stamp, not the ISO instant it is formatted from.
      const withInstant = stamps.sheet.querySelectorAll('.cards-ends').slice(0, 3);
      for (const [i, line] of withInstant.entries()) {
        check(
          `row S${i + 1} renders no raw ISO string`,
          !/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(line.textContent),
          line.textContent
        );
      }
      check('and each of them reads as a clock time', withInstant.every((l) => /ends \d{1,2}:\d{2} (AM|PM)/.test(l.textContent)), withInstant.map((l) => l.textContent).join(' | '));
      // The one row that has no instant is the one place ends_ct still shows,
      // raw and unparsed — a pre-v1.6 payload must not lose its end time.
      check('the legacy row alone prints the raw wall stamp', textOf(stamps.sheet).includes('ends 2026-09-20T19:48'));

      // -- and the device's own timezone does not get a vote -----------------
      //
      // This is a CENTRAL board. Matt opening it from a hotel in Tokyo, or on
      // a laptop whose clock is still set to last week's trip, must read the
      // same auction end time he would read at his desk. `ctTime` pins
      // America/Chicago in the formatter rather than taking the device's
      // zone, so flipping TZ underneath a render must change nothing at all.
      const zoned = (tz) => {
        const had = process.env.TZ;
        process.env.TZ = tz;
        try {
          const v = openWatch([auction('TZ', 90 * MIN)]);
          return v.sheet.querySelector('.cards-ends-at').textContent;
        } finally {
          if (had === undefined) delete process.env.TZ; else process.env.TZ = had;
        }
      };
      const central = zoned('America/Chicago');
      check('the end time reads Central at Matt\'s desk', central === 'ends 2:30 PM', central);
      for (const tz of ['Asia/Tokyo', 'UTC', 'Europe/Berlin', 'Pacific/Kiritimati']) {
        const seenTz = zoned(tz);
        check(`and identically with the device set to ${tz}`, seenTz === central, seenTz);
      }

      // -- a pre-v1.6 payload: the old line, and no breakage -----------------
      const legacy = openWatch([listing({ item_id: 'OLD', title: 'OLD', type: 'AUCTION', ends_ct: '2026-09-20T19:48', ends_utc: null })]);
      check('a row with no instant renders the legacy ends line', /ends 2026-09-20T19:48/.test(textOf(legacy.sheet)));
      check('and no countdown at all', countOf(legacy.sheet, 'cards-countdown') === 0);
      check('nor amber, which it could not honestly claim', countOf(legacy.sheet, 'cards-ends-soon') === 0);
      check('nor a dot on the board', countOf(legacy.board, 'cards-dot') === 0);
      // A field the engine sent as junk is the same case: no guess, no throw.
      let junkThrew = null;
      let junk = null;
      try {
        junk = openWatch([listing({ item_id: 'JUNK', title: 'JUNK', type: 'AUCTION', ends_ct: '2026-09-20T19:48', ends_utc: 'tomorrow evening' })]);
      } catch (e) { junkThrew = e; }
      check('an unreadable ends_utc falls back rather than throwing', !junkThrew, junkThrew && junkThrew.message);
      check('and prints no countdown off it', !!junk && countOf(junk.sheet, 'cards-countdown') === 0);
      // The wall stamp is not an instant and must never be treated as one,
      // even by accident: a row given ONLY ends_ct counts from nothing.
      const wallOnly = openWatch([listing({ item_id: 'WALL', title: 'WALL', type: 'AUCTION', ends_ct: '2026-09-20T13:30', ends_utc: '2026-09-20T13:30' })]);
      check('an offsetless ends_utc is refused like the wall stamp it is', countOf(wallOnly.sheet, 'cards-countdown') === 0);
      check('and the row falls back to printing it', /ends 2026-09-20T13:30/.test(textOf(wallOnly.sheet)));

      // -- one interval per sheet, and none after it closes ------------------
      const before = timers.created;
      const ticking = openWatch([auction('T1', 3 * 24 * HOUR), auction('T2', 4 * 24 * HOUR), auction('T3', 5 * 24 * HOUR)]);
      check('three rows share one interval', timers.created - before === 1, String(timers.created - before));
      check('and only one is live', timers.live.size === 1);
      check('it beats every 30s while everything is days out', [...timers.live][0].ms === 30000);
      check('the sheet listens for the tab coming back', docListenerCount('visibilitychange') === 1);
      ticking.panel.close();
      check('closing the sheet clears the interval', timers.live.size === 0);
      check('and lets go of the visibility listener', docListenerCount('visibilitychange') === 0);

      // A sheet with nothing to count starts no timer at all.
      const quietSheet = openWatch([listing({ item_id: 'NOEND', title: 'NOEND', type: 'AUCTION' })]);
      check('a sheet with no live lot runs no clock', timers.live.size === 0);
      check('and registers no listener', docListenerCount('visibilitychange') === 0);
      quietSheet.panel.close();

      // Opening a second sheet must not leave the first one's clock behind.
      const first = openWatch([auction('X1', 3 * 24 * HOUR)]);
      check('an open sheet holds one timer', timers.live.size === 1);
      first.panel.actions.openPanel('again', (body) => { body.appendChild(new El('div')); });
      check('opening another sheet tears the first one down', timers.live.size === 0);
      check('and takes its listener with it', docListenerCount('visibilitychange') === 0);

      // -- the cadence: 1s inside the hour, 30s outside ----------------------
      const cadence = openWatch([auction('C1', 61 * MIN)]);
      check('an hour and one minute out beats every 30s', [...timers.live][0].ms === 30000);
      clock.advance(2 * MIN);
      timers.beat();
      check('crossing into the hour speeds it to 1s', [...timers.live][0].ms === 1000);
      check('still exactly one timer, never two', timers.live.size === 1);
      check('and the figure moved with the clock', only(cadence) === '59m', only(cadence));
      clock.advance(44 * MIN + 30000);
      timers.beat();
      check('inside the last quarter-hour the seconds appear', only(cadence) === '14m 30s', only(cadence));
      check('and the row has gone amber on the way', countOf(cadence.sheet, 'cards-ends-soon') === 1);
      clock.advance(15 * MIN);
      timers.beat();
      check('past the hammer it reads ended', only(cadence) === 'ended', only(cadence));
      check('grey, not amber', countOf(cadence.sheet, 'cards-ends-done') === 1 && countOf(cadence.sheet, 'cards-ends-soon') === 0);
      check('and the row is still on the page', countOf(cadence.sheet, 'cards-row') === 1 && /C1/.test(textOf(cadence.sheet)));
      check('greyed whole', countOf(cadence.sheet, 'cards-row-ended') === 1);
      cadence.panel.close();

      // -- a phone that slept --------------------------------------------------
      //
      // Up to thirty seconds of a visibly wrong countdown on wake is thirty
      // seconds too many, so the return to the foreground repaints at once.
      const woken = openWatch([auction('W1', 4 * 24 * HOUR + 3 * HOUR)]);
      check('it starts where it should', only(woken) === '4d 3h', only(woken));
      clock.advance(24 * HOUR);
      check('a slept day leaves the figure stale until something fires', only(woken) === '4d 3h');
      fireDocEvent('visibilitychange');
      check('coming back repaints without waiting for the next beat', only(woken) === '3d 3h', only(woken));
      woken.panel.close();
      check('and the woken sheet leaves nothing behind', timers.live.size === 0 && docListenerCount('visibilitychange') === 0);

      // -- nothing anywhere reads as a bug -----------------------------------
      for (const [label, view] of [['the ladder', ladder], ['the stamps', stamps], ['the legacy row', legacy], ['a finished row', done]]) {
        const t = `${textOf(view.sheet)} ${textOf(view.board)}`;
        check(`no "undefined", "NaN" or "Invalid Date" in ${label}`, !/undefined|NaN|Invalid Date/.test(t), t.slice(0, 160));
      }
    } finally {
      for (const v of opened) v.panel.close();
      clock.restore();
    }

    check('every sheet opened in the countdown tests has been shut', timers.live.size === 0, String(timers.live.size));
    check('and no document listener outlives them', docListenerCount('visibilitychange') === 0);

    // -- rule 7, proven at runtime as well as by the source scan -------------
    //
    // The scan above says this module never writes `new Date`. This says
    // something stronger: across a full render and sheet build, no Date
    // anywhere underneath it — lib/fmt.js included — was ever handed a value
    // that came out of `ends_ct`.
    const CT_STAMPS = ['2026-09-20T19:48', '2026-09-20 19:48'];
    // Minted once, off the real clock, so the fixture and the assertion below
    // are the same string down to the millisecond.
    const SPY_END = at(90 * MIN);
    const seen = [];
    const spyPanel = fakePanel();
    (() => {
      const Real = Date;
      const fixed = Real.parse(CLOCK);
      class Spy extends Real {
        constructor(...a) { if (a.length) seen.push(a[0]); super(...(a.length ? a : [fixed])); }
        static now() { return fixed; }
        static parse(v) { seen.push(v); return Real.parse(v); }
      }
      global.Date = Spy;
      try {
        const r = new El('div');
        cards.render(r, cardsTile(deskData({
          auctions: [
            listing({ item_id: 'P1', title: 'P1', type: 'AUCTION', ends_ct: CT_STAMPS[0], ends_utc: SPY_END }),
            listing({ item_id: 'P2', title: 'P2', type: 'AUCTION', ends_ct: CT_STAMPS[1], ends_utc: null }),
          ],
        })), { id: 'cards', actions: spyPanel.actions });
        cardsTap(cardBtns(r)[0]);
      } finally { global.Date = Real; }
    })();
    check(
      'no Date was ever constructed or parsed from an ends_ct value',
      !seen.some((v) => CT_STAMPS.includes(v)),
      JSON.stringify(seen.filter((v) => typeof v === 'string'))
    );
    check('the instant, on the other hand, was read', seen.includes(SPY_END), JSON.stringify(seen.filter((v) => typeof v === 'string')));
    spyPanel.close();

    // -- and the section leaves the page as it found it ----------------------
    panel.close();
    emptyPanel.close();
    raggedPanel.close();
    check('no interval survives this file', timers.live.size === 0, String(timers.live.size));
    check('and no document listener does either', docListenerCount('visibilitychange') === 0);

    // -- the PC net: a third face that must not look like the first ---------
    //
    // Watch asks "is this under 65% of book". PC asks "does this exist". A
    // bookend has no matched-grade tape behind it, so it has no FMV, no
    // percentage and no gate — and the single most likely way to get this
    // tile wrong is to make a PC row read like a cleared flag. Most of what
    // is below is that: assertions about what must NOT be on the screen.
    console.log('\ncards — the PC bookend net');

    const find = (over = {}) => ({
      item_id: 'p1',
      title: 'PC-ONE',
      player: 'Invented Player',
      serial: '10/10',
      num: 10,
      den: 10,
      one_of_one: false,
      grade: 'PSA 10',
      type: 'BIN',
      price: 650,
      ship: 4.99,
      all_in: 654.99,
      ends_ct: null,
      ends_utc: null,
      seller: 'cardvault',
      seller_fb: 2410,
      listed: '2026-09-19',
      url: 'https://example.com/mock/pc/1',
      image: 'https://example.com/mock/pc/1.jpg',
      new: false,
      ...over,
    });

    const FINDS = [
      find({ item_id: 'b1', title: 'BOOK-ONE', serial: '1/25', num: 1, den: 25, new: true }),
      find({ item_id: 'b2', title: 'BOOK-TWO', serial: '5/5', num: 5, den: 5, type: 'OBO', grade: 'BGS 9.5' }),
      find({ item_id: 'b3', title: 'BOOK-THREE', serial: '50/50', num: 50, den: 50, ship: null, all_in: null, image: null }),
      find({ item_id: 'o1', title: 'ONE-ONE', serial: '1/1', num: 1, den: 1, one_of_one: true, grade: 'PSA 9' }),
      find({
        item_id: 'o2',
        title: 'ONE-TWO',
        serial: '1/1',
        num: 1,
        den: 1,
        one_of_one: true,
        type: 'AUCTION',
        price: 920,
        ship: 15,
        all_in: 935,
        ends_ct: '2026-09-20T13:40',
        ends_utc: '2026-09-20T18:40:00.000Z',
      }),
    ];

    const pcData = (over = {}, rest = {}) => ({
      watch: null,
      shop: null,
      pc: {
        updated_at: '2026-09-20T12:13:05Z',
        players: 26,
        calls: 121,
        total_found: 108,
        counts: { one_of_one: 29, bookend: 79, shown: 5 },
        finds: FINDS,
        errors: [],
        ...over,
      },
      pc_footer: 'No book, no gate — a bookend is one of one by definition. Price is yours to judge.',
      ...rest,
    });

    /**
     * Board + PC sheet, on the same wound clock the countdown tests use.
     *
     * Shuts every sheet opened before it, because the shell only ever has
     * one panel up — and because a test that let two sheets tick at once
     * could not tell "one interval per sheet" from "two".
     */
    const pcOpened = [];
    function openPc(over = {}, rest = {}) {
      for (const v of pcOpened) v.panel.close();
      const pnl = fakePanel();
      const board = new El('div');
      cards.render(board, cardsTile(pcData(over, rest)), { id: 'cards', actions: pnl.actions });
      cardsTap(cardBtns(board)[2]);
      const view = { board, panel: pnl, sheet: pnl.last.body };
      pcOpened.push(view);
      return view;
    }

    const pcClock = windClock('2026-09-20T18:00:00.000Z');
    let pcView = null;
    try {
      pcView = openPc();
      const pcBoard = pcView.board;
      const pcSheet = pcView.sheet;

      // -- the board -------------------------------------------------------
      check('the PC face is the third button', labelsOf(pcBoard).join('|') === 'Watch|Shop|PC', labelsOf(pcBoard).join('|'));
      check('and it opens its own sheet', pcView.panel.last.title === '🎖️ PC');
      check('the chip counts arrivals, not finds', pcBoard.querySelector('.cards-count').textContent.startsWith('1'), pcBoard.querySelector('.cards-count').textContent);
      check('the faint line counts the two classes', /79 bookends/.test(textOf(pcBoard)) && /29 1\/1s/.test(textOf(pcBoard)), textOf(pcBoard));
      const quietPc = new El('div');
      cards.render(quietPc, cardsTile(pcData({ finds: FINDS.map((f) => ({ ...f, new: false })) })), { id: 'cards', actions: {} });
      check('nothing new means no chip at all, not a zero', countOf(quietPc, 'cards-count') === 0);
      check('but the button is still tappable', !cardBtns(quietPc)[2].getAttribute('disabled'));
      const noFinds = new El('div');
      cards.render(noFinds, cardsTile(pcData({ finds: [] })), { id: 'cards', actions: {} });
      check('zero finds is the same: no chip, live button', countOf(noFinds, 'cards-count') === 0 && !cardBtns(noFinds)[2].getAttribute('disabled'));

      // -- pc: null ---------------------------------------------------------
      let nullThrew = null;
      let noPc = null;
      try {
        noPc = new El('div');
        cards.render(noPc, cardsTile({ watch: null, shop: null, pc: null }), { id: 'cards', actions: {} });
      } catch (e) { nullThrew = e; }
      check('pc: null never throws', !nullThrew, nullThrew && nullThrew.message);
      check('it greys the button, exactly as shop does', countOf(noPc, 'cards-btn-soon') === 3 && /soon/.test(cardBtns(noPc)[2].textContent));
      check('and that button is inert', cardBtns(noPc)[2].getAttribute('disabled') === 'disabled');
      check('with no PC line under the menu', !/bookends/.test(textOf(noPc)));

      // -- two sections, bookends first --------------------------------------
      const heads = pcSheet.querySelectorAll('.cards-head').map((h) => h.textContent);
      check('two sections, bookends before one-of-ones', heads.join('|') === 'Bookends (3)|One of ones (2)', heads.join('|'));
      const pcTitles = pcSheet.querySelectorAll('.cards-title').map((t) => t.textContent);
      check('and the rows land in the right ones', pcTitles.join('|') === 'BOOK-ONE|BOOK-TWO|BOOK-THREE|ONE-ONE|ONE-TWO', pcTitles.join('|'));
      const lists = pcSheet.querySelectorAll('.pc-list');
      check('a 5/5 is a bookend, not a one-of-one', /BOOK-TWO/.test(lists[0].textContent) && !/BOOK-TWO/.test(lists[1].textContent));
      check('a 1/1 is a one-of-one, not a bookend', /ONE-ONE/.test(lists[1].textContent) && !/ONE-ONE/.test(lists[0].textContent));
      check('every find is a row', countOf(pcSheet, 'pc-row') === 5);

      // -- the badges: serial anchors, grade second --------------------------
      const serials = pcSheet.querySelectorAll('.pc-serial').map((n) => n.textContent);
      for (const f of FINDS) {
        check(`serial "${f.serial}" appears exactly as delivered`, serials.some((t) => t.includes(f.serial)), serials.join(' | '));
      }
      const grades = pcSheet.querySelectorAll('.pc-grade').map((n) => n.textContent);
      for (const f of FINDS) {
        check(`grade "${f.grade}" appears exactly as delivered`, grades.some((t) => t.includes(f.grade)), grades.join(' | '));
      }
      check('every row carries both badges', serials.length === 5 && grades.length === 5);
      check('a one-of-one wears the 1/1 badge', countOf(pcSheet, 'pc-one') === 2);
      check('and a 5/5 does not', !lists[0].querySelectorAll('.pc-serial').some((n) => n.classList.contains('pc-one')));
      check('an OBO listing says so', countOf(pcSheet, 'cards-chip-obo') === 1);
      check('a BIN listing says nothing', countOf(pcSheet, 'cards-chip') === 1);
      const noGrade = openPc({ finds: [find({ item_id: 'ng', title: 'NO-GRADE', grade: null })] });
      check('a row with no grade still renders', /NO-GRADE/.test(textOf(noGrade.sheet)) && countOf(noGrade.sheet, 'pc-row') === 1);
      check('it just loses the chip', countOf(noGrade.sheet, 'pc-grade') === 0);
      check('and nothing invents a "raw" affordance', !/\braw\b/i.test(textOf(noGrade.sheet)));
      noGrade.panel.close();

      // -- NOTHING here may read as a Watch flag -----------------------------
      //
      // This is the ruling, stated as a scan. A PC row that looked like a
      // cleared gate would be telling Matt the engine had an opinion about a
      // price it has never seen a comp for.
      for (const banned of ['cards-fmv', 'cards-fmv-good', 'cards-check', 'cards-chip-max', 'cards-chip-band', 'cards-bookage']) {
        check(`no .${banned} anywhere in the PC sheet`, countOf(pcSheet, banned) === 0);
      }
      // The rows and the section headers — everything the footer does not
      // say. The footer is excluded deliberately: it is the vault's own line
      // and it uses the word "gate" to tell Matt there ISN'T one, which is
      // the opposite of the failure this scan is looking for.
      const pcRowsText = pcSheet.querySelectorAll('.pc-list, .cards-head').map((n) => n.textContent).join(' ');
      check('no ✓ on the rows', !/✓/.test(pcRowsText));
      check('no percentage of anything', !/%/.test(pcRowsText) && !/of FMV/i.test(pcRowsText));
      check('no MAX bid', !/\bMAX\b/.test(pcRowsText));
      check('and no gate language on the rows', !/\bgate\b/i.test(pcRowsText));
      check('nor anywhere but the vault\'s own footer line', !/\bgate\b/i.test(textOf(pcSheet).replace(pcSheet.querySelector('.cards-foot').textContent, '')));
      // The footer says the same thing in Matt's words, once.
      check('the footer is the vault\'s line plus eBay\'s credit', pcSheet.querySelector('.cards-foot').textContent === 'No book, no gate — a bookend is one of one by definition. Price is yours to judge. · eBay data via Browse API', pcSheet.querySelector('.cards-foot').textContent);
      check('said exactly once', countOf(pcSheet, 'cards-foot') === 1);

      // -- amber means one of one here, and only that ------------------------
      check('the auction row never goes amber', countOf(pcSheet, 'cards-ends-soon') === 0);
      check('even though it is forty minutes out', /40m/.test(textOf(pcSheet)), textOf(pcSheet).slice(0, 400));
      check('and the board raises no auction dot from this face', countOf(pcBoard, 'cards-dot') === 0);

      // -- money, and the shipping nobody stated -----------------------------
      const monies = pcSheet.querySelectorAll('.cards-money').map((n) => n.textContent);
      check('a known shipping cost reaches an all-in', /\$654\.99/.test(monies[0]), monies[0]);
      check('an unknown one says so', /\+ ship\?/.test(monies[2]), monies[2]);
      check('and stops there — no arrow, no invented total', !/→/.test(monies[2]) && !/—/.test(monies[2]), monies[2]);
      check('never printing null or NaN for it', !/null|NaN|undefined/i.test(monies[2]), monies[2]);
      check('an auction leads with the bid, not a price', /bid \$920\.00/.test(monies[4]), monies[4]);
      check('the seller line carries the listed date verbatim', /listed 2026-09-19/.test(textOf(pcSheet)));
      check('and an arrival wears the new mark', countOf(pcSheet, 'cards-new-mark') === 1);

      // -- photos, links -----------------------------------------------------
      const pcImgs = pcSheet.querySelectorAll('IMG');
      check('a photo is a photo', pcImgs.length === 4 && pcImgs[0].getAttribute('src') === 'https://example.com/mock/pc/1.jpg');
      check('and leaks no referrer', pcImgs.every((i) => i.getAttribute('referrerpolicy') === 'no-referrer'));
      check('a find with no photo holds the space instead', countOf(pcSheet, 'cards-thumb-none') === 1);
      check('no broken img is emitted for it', pcImgs.every((i) => !!i.getAttribute('src')));
      const pcLinks = pcSheet.querySelectorAll('A');
      check('every row is a link', pcLinks.length === 5);
      check('opening a new tab, with no handle on this page', pcLinks.every((a) => a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || '')));
      const junkUrl = openPc({ finds: [find({ item_id: 'j', title: 'JUNK-URL', url: 'javascript:alert(1)' })] });
      check('a javascript: url is inert, and the row survives', junkUrl.sheet.querySelectorAll('A').length === 0 && /JUNK-URL/.test(textOf(junkUrl.sheet)));
      junkUrl.panel.close();

      // -- "Showing X of Y" ---------------------------------------------------
      check('the sheet says what the caps held back', /Showing 5 of 108/.test(textOf(pcSheet)), textOf(pcSheet).slice(0, 200));
      const allShown = openPc({ total_found: 5, counts: { one_of_one: 2, bookend: 3, shown: 5 } });
      check('and says nothing when it is showing everything', !/Showing/.test(textOf(allShown.sheet)));
      allShown.panel.close();
      const overShown = openPc({ total_found: 3, counts: { one_of_one: 2, bookend: 3, shown: 5 } });
      check('nor when the counts disagree the other way', !/Showing/.test(textOf(overShown.sheet)));
      overShown.panel.close();

      // -- empty, ragged, half-broken -----------------------------------------
      const emptyPc = openPc({ finds: [] });
      check('an empty net says so rather than going blank', /Nothing graded and numbered 1\/N or N\/N/.test(textOf(emptyPc.sheet)));
      check('with no section headers over nothing', countOf(emptyPc.sheet, 'cards-head') === 0);
      check('and the footer still appears once', countOf(emptyPc.sheet, 'cards-foot') === 1);
      emptyPc.panel.close();

      const erroring = openPc({ errors: ['eBay Browse API: 6 of 121 searches rate-limited (429)'] });
      check('what the net could not reach is said at the top', /feed trouble: eBay Browse API: 6 of 121/.test(textOf(erroring.sheet)));
      check('and the finds it DID get still render', countOf(erroring.sheet, 'pc-row') === 5);
      erroring.panel.close();

      let raggedThrew = null;
      let raggedPc = null;
      try {
        raggedPc = openPc({ finds: [{ item_id: 'r' }, { title: 'HALF', price: 10 }, null, 'nope'], counts: null, total_found: null });
      } catch (e) { raggedThrew = e; }
      check('a half-missing payload never throws', !raggedThrew, raggedThrew && raggedThrew.message);
      check('every entry still lays out as a row', raggedPc && countOf(raggedPc.sheet, 'pc-row') === 4);
      check('a find with no title says so', /\(untitled listing\)/.test(textOf(raggedPc.sheet)));
      check('no "undefined" survives it', !/undefined/.test(textOf(raggedPc.sheet)));
      check('no "NaN" either', !/NaN/.test(textOf(raggedPc.sheet)));
      check('and no "null" printed as a word', !/\bnull\b/.test(textOf(raggedPc.sheet)));
      raggedPc.panel.close();

      // -- the countdown, same machinery minus the amber -----------------------
      const ticking = openPc({ finds: [find({ item_id: 't', title: 'TICK', type: 'AUCTION', ends_ct: '2026-09-20T13:40', ends_utc: '2026-09-20T18:40:00.000Z', one_of_one: true, serial: '1/1', num: 1, den: 1 })] });
      const tickValue = () => ticking.sheet.querySelector('.cards-countdown-value').textContent;
      check('an auction here counts down', tickValue() === '40m', tickValue());
      check('and prints Central clock time beside it', /ends 1:40 PM/.test(textOf(ticking.sheet)), textOf(ticking.sheet).slice(0, 300));
      check('on one shared interval, like the Watch sheet', timers.live.size === 1);
      pcClock.advance(26 * MIN);
      timers.beat();
      check('inside the last quarter-hour the seconds appear', tickValue() === '14m 00s', tickValue());
      check('still without a hint of amber', countOf(ticking.sheet, 'cards-ends-soon') === 0);
      pcClock.advance(15 * MIN);
      timers.beat();
      check('past the hammer it reads ended', tickValue() === 'ended', tickValue());
      check('greyed, and still on the page', countOf(ticking.sheet, 'cards-ends-done') === 1 && /TICK/.test(textOf(ticking.sheet)));
      ticking.panel.close();
      check('and the sheet lets its clock go', timers.live.size === 0);

      // -- nothing anywhere reads as a bug -------------------------------------
      const pcText = `${textOf(pcSheet)} ${textOf(pcBoard)}`;
      check('no "undefined", "NaN" or "Invalid Date" on the PC face', !/undefined|NaN|Invalid Date/.test(pcText), pcText.slice(0, 160));
    } finally {
      for (const v of pcOpened) v.panel.close();
      pcClock.restore();
    }
    check('no PC sheet is left ticking', timers.live.size === 0, String(timers.live.size));
    check('and none is left listening', docListenerCount('visibilitychange') === 0);

    // -- the ruling, as a source scan ----------------------------------------
    //
    // The class scans above catch a PC row that LOOKS like a flag. This
    // catches the likelier mistake a year from now: someone reaching for
    // `listingRow` because the two sheets have rows in them.
    check('the PC sheet builds its own rows', /function pcRow\(/.test(CARDS_SRC));
    // Everything from planFind to the generic face body is the PC net's own
    // code. If `listingRow` ever appears in there, someone has reached for
    // the Watch row because both sheets have rows in them — which is exactly
    // the mistake the ruling names.
    const PC_REGION = CARDS_SRC.slice(CARDS_SRC.indexOf('function planFind('), CARDS_SRC.indexOf('function planShopItem('));
    check('and never borrows the Watch row', PC_REGION.length > 500 && !/listingRow/.test(PC_REGION), String(PC_REGION.length));
    check('nor its gate chip', !/fmvChip|cards-fmv|cards-chip-max/.test(PC_REGION));

    // The 1/1 badge's gold and the auction amber are two different tokens
    // holding two different values, and this is what keeps them that way.
    const warnToken = (CARDS_CSS.match(/--warn:\s*([^;]+);/) || [])[1];
    const pcOneToken = (CARDS_CSS.match(/--pc-one:\s*([^;]+);/) || [])[1];
    check('the 1/1 badge has a colour token of its own', !!pcOneToken, String(pcOneToken));
    check('and it is not the auction amber', !!warnToken && warnToken.trim() !== (pcOneToken || '').trim(), `${warnToken} vs ${pcOneToken}`);
    check('the badge never reaches for --warn', !/\.pc-one\b[^{]*\{[^}]*var\(--warn\)/.test(CARDS_CSS));

    // -- the shop: Matt's own storefront, and the ruling about age ----------
    //
    // Shop is neither a gate nor a collection. Most of what is below is about
    // what must NOT be on the screen: no FMV, no ✓, no MAX, no serial, no
    // grade — and above all NO COLOUR ON THE AGE. Matt owns this board and
    // has ruled that it does not narrate his own shop back at him, so
    // `days_listed` is a plain grey number at three days and at three
    // hundred. A red 45 would be an opinion the page has no standing to hold.
    console.log('\ncards — the shop');

    const shopItem = (over = {}) => ({
      item_id: 's1',
      title: '2024 Cosmic Chrome Jackson Chourio Planetary Pursuit',
      price: 179,
      type: 'BIN',
      offers: false,
      listed: '2026-08-06',
      days_listed: 45,
      url: 'https://example.com/mock/shop/1',
      image: 'https://example.com/mock/shop/1.jpg',
      ...over,
    });

    const LISTINGS = [
      // Titles carry no format words on purpose: the chip assertions below
      // read the sheet's text, and a row called "SHOP-BIN" would answer them
      // for the wrong reason.
      shopItem({ item_id: 'l1', title: 'OFFERS-ONE', type: 'OBO', offers: true }),
      shopItem({ item_id: 'l2', title: 'LOT-AUCTION', type: 'AUCTION', price: 61.5, days_listed: 2 }),
      // No age at all, and no photo: two different fields the engine is
      // allowed not to have, on two different rows.
      shopItem({ item_id: 'l3', title: 'NO-DAYS', type: 'OBO', offers: true, listed: null, days_listed: null }),
      shopItem({ item_id: 'l4', title: 'PLAIN-ONE', price: 22, days_listed: 365, image: null }),
    ];
    const GONE = [
      { item_id: 'g1', title: 'GONE-ONE', price: 410, listed: '2026-07-24', gone_since: '2026-09-18' },
      { item_id: 'g2', title: 'GONE-TWO', price: 96, listed: '2026-05-23', gone_since: '2026-09-14' },
    ];

    const shopData = (over = {}, rest = {}) => ({
      watch: null,
      pc: null,
      shop: {
        updated_at: '2026-09-20T12:04:00.000Z',
        seller: 'mock_storefront',
        active: 4,
        calls: 1,
        listings: LISTINGS,
        gone: GONE,
        errors: [],
        note: 'active listings + sold-detection',
        ...over,
      },
      shop_footer:
        'Active listings and sold-detection. Watchers and pending offers live in the eBay app — see C6.',
      ...rest,
    });

    const shopOpened = [];
    function openShop(over = {}, rest = {}) {
      for (const v of shopOpened) v.panel.close();
      const pnl = fakePanel();
      const board = new El('div');
      cards.render(board, cardsTile(shopData(over, rest)), { id: 'cards', actions: pnl.actions });
      cardsTap(cardBtns(board)[1]);
      const view = { board, panel: pnl, sheet: pnl.last.body };
      shopOpened.push(view);
      return view;
    }

    let shopView = null;
    try {
      shopView = openShop();
      const shopBoard = shopView.board;
      const shopSheet = shopView.sheet;

      // -- the board ---------------------------------------------------------
      check('the shop face is the second button', labelsOf(shopBoard).join('|') === 'Watch|Shop|PC', labelsOf(shopBoard).join('|'));
      check('it is live, not greyed', !cardBtns(shopBoard)[1].className.includes('cards-btn-soon'));
      check('and it opens its own sheet', shopView.panel.last.title === '🏷️ Shop');
      check('the chip is the engine\'s active count', shopBoard.querySelector('.cards-count').textContent === '4', shopBoard.querySelector('.cards-count').textContent);
      check('the faint line says what is listed', /4 listed/.test(textOf(shopBoard)), textOf(shopBoard));
      check('and what has dropped off', /2 dropped off/.test(textOf(shopBoard)), textOf(shopBoard));
      // A storefront has nothing ending in two hours. The dot means exactly
      // one thing on this tile and it is not this face's to raise.
      check('no amber dot on this face', countOf(shopBoard, 'cards-dot') === 0);

      const noneGone = openShop({ gone: [] });
      check('nothing dropped off says nothing, rather than "0 dropped off"', !/dropped off/.test(textOf(noneGone.board)), textOf(noneGone.board));
      check('but still says what is listed', /4 listed/.test(textOf(noneGone.board)));
      noneGone.panel.close();

      // -- shop: null --------------------------------------------------------
      let shopNullThrew = null;
      let noShop = null;
      try {
        noShop = new El('div');
        cards.render(noShop, cardsTile({ watch: null, shop: null, pc: null }), { id: 'cards', actions: {} });
      } catch (e) { shopNullThrew = e; }
      check('shop: null never throws', !shopNullThrew, shopNullThrew && shopNullThrew.message);
      check('it keeps today\'s greyed "soon" button', countOf(noShop, 'cards-btn-soon') === 3 && /soon/.test(cardBtns(noShop)[1].textContent));
      check('and that button is inert', cardBtns(noShop)[1].getAttribute('disabled') === 'disabled');
      check('with no shop line under the menu', !/listed/.test(textOf(noShop)));

      // -- the Listed section ------------------------------------------------
      const shopHeads = shopSheet.querySelectorAll('.cards-head').map((h) => h.textContent);
      check('two sections, listed then gone', shopHeads.join('|') === 'Listed (4)|No longer active', shopHeads.join('|'));
      const shopTitles = shopSheet.querySelectorAll('.shop-row').map((r) => r.querySelector('.cards-title').textContent);
      check('every listing is a row, in the order delivered', shopTitles.join('|') === 'OFFERS-ONE|LOT-AUCTION|NO-DAYS|PLAIN-ONE', shopTitles.join('|'));
      const shopLines = shopSheet.querySelectorAll('.shop-line').map((n) => n.textContent);
      check('a row leads with its asking price', /\$179\.00/.test(shopLines[0]), shopLines[0]);

      // -- the chips ---------------------------------------------------------
      check('a listing that takes offers says OBO', countOf(shopSheet, 'cards-chip-obo') === 2, String(countOf(shopSheet, 'cards-chip-obo')));
      check('and an auction says AUCTION instead', /AUCTION/.test(shopLines[1]) && !/OBO/.test(shopLines[1]), shopLines[1]);
      check('the format chip is the neutral tone, never a ranked one', shopSheet.querySelectorAll('.cards-chip').every((c) => !/max|band/.test(c.className)));
      check('a plain BIN says neither', !/OBO|AUCTION/.test(shopLines[3]), shopLines[3]);
      check('and never spells out "BIN"', !/\bBIN\b/.test(textOf(shopSheet)));
      // `offers` is the field that decides the OBO chip, not `type`.
      const noOffers = openShop({ listings: [shopItem({ type: 'OBO', offers: false })] });
      check('offers: false wears no OBO chip, whatever the type says', countOf(noOffers.sheet, 'cards-chip-obo') === 0);
      noOffers.panel.close();
      const auctionOffers = openShop({ listings: [shopItem({ type: 'AUCTION', offers: true })] });
      check('an auction that also takes offers still reads AUCTION', /AUCTION/.test(textOf(auctionOffers.sheet)) && countOf(auctionOffers.sheet, 'cards-chip-obo') === 0);
      auctionOffers.panel.close();

      // -- the age: a number, never a verdict --------------------------------
      check('a listing says how long it has been up', /45 days/.test(shopLines[0]), shopLines[0]);
      const oneDay = openShop({ listings: [shopItem({ days_listed: 1 })] });
      check('and one day up is not "1 days"', /\b1 day(?!s)/.test(oneDay.sheet.querySelector('.shop-line').textContent), oneDay.sheet.querySelector('.shop-line').textContent);
      oneDay.panel.close();
      const noDays = shopLines[2];
      check('a listing with no age drops the clause entirely', !/day/.test(noDays), noDays);
      check('printing no "null", "NaN" or "undefined" in its place', !/null|NaN|undefined/i.test(noDays), noDays);
      // THE RULING, as an assertion. Every row in this sheet — including one
      // that has been up for a year — must carry the same neutral classes.
      // No warn, no danger, no stale, no "aged" anything.
      const ageBanned = ['warn', 'cards-warn', 'danger', 'bad', 'stale', 'cards-stale', 'shop-days-warn', 'shop-days-old', 'cards-ends-soon'];
      for (const cls of ageBanned) {
        check(`no .${cls} on any shop row, at any age`, countOf(shopSheet, cls) === 0);
      }
      const ancient = openShop({ listings: [shopItem({ item_id: 'old', title: 'ANCIENT', days_listed: 365 })] });
      check('a listing 365 days old still renders', /365 days/.test(textOf(ancient.sheet)));
      check('with the same class as a fresh one', ancient.sheet.querySelector('.shop-days').className === 'shop-days', ancient.sheet.querySelector('.shop-days').className);
      check('and no warning class anywhere on its row', ageBanned.every((c) => countOf(ancient.sheet, c) === 0));
      check('nor any word editorialising about it', !/\bstale\b|\bold\b|no offers|sitting/i.test(textOf(ancient.sheet)), textOf(ancient.sheet).slice(0, 200));
      ancient.panel.close();

      // -- photos and links ---------------------------------------------------
      const shopImgs = shopSheet.querySelectorAll('IMG');
      check('a photo is a photo', shopImgs.length === 3 && shopImgs[0].getAttribute('src') === 'https://example.com/mock/shop/1.jpg');
      check('and leaks no referrer', shopImgs.every((i) => i.getAttribute('referrerpolicy') === 'no-referrer'));
      check('a listing with no photo holds the space instead', countOf(shopSheet, 'cards-thumb-none') === 1);
      check('no broken img is emitted for it', shopImgs.every((i) => !!i.getAttribute('src')));
      const shopLinks = shopSheet.querySelectorAll('.shop-row');
      check('every live listing is tappable', shopLinks.length === 4 && shopLinks.every((r) => r.tagName === 'A'));
      check('opening a new tab, with no handle on this page', shopLinks.every((a) => a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || '')));
      const junkShop = openShop({ listings: [shopItem({ title: 'JUNK-URL', url: 'javascript:alert(1)' })] });
      check('a javascript: url is inert, and the row survives', junkShop.sheet.querySelectorAll('A').length === 0 && /JUNK-URL/.test(textOf(junkShop.sheet)));
      junkShop.panel.close();

      // -- No longer active ---------------------------------------------------
      //
      // NOT "Sold". eBay's public data cannot tell a sale from an expiry, and
      // a header that claimed otherwise would be the page asserting a fact it
      // does not have.
      check('the dropped-off section is headed "No longer active"', shopHeads.includes('No longer active'));
      check('and the word "Sold" is on no section header', !shopSheet.querySelectorAll('.cards-head').some((h) => /Sold/.test(h.textContent)), shopHeads.join('|'));
      check('the ambiguity is said out loud, once', countOf(shopSheet, 'shop-note') === 1 && /can't tell them apart/.test(textOf(shopSheet)));
      const goneRows = shopSheet.querySelectorAll('.shop-gone-row');
      check('every gone listing is a row', goneRows.length === 2);
      check('carrying its title', /GONE-ONE/.test(goneRows[0].textContent) && /GONE-TWO/.test(goneRows[1].textContent));
      check('its last asking price', /\$410\.00/.test(goneRows[0].textContent), goneRows[0].textContent);
      // A Central business date, printed exactly as delivered — rule 7.
      check('and how long it has been gone, verbatim', /since 2026-09-18/.test(goneRows[0].textContent), goneRows[0].textContent);
      // The listing is gone and its URL 404s, so a link would be a promise
      // the page cannot keep.
      check('a gone row is not a link', goneRows.every((r) => r.tagName === 'DIV'));
      check('and carries no click handler either', goneRows.every((r) => !r.listeners || !r.listeners.click));
      const goneLess = openShop({ gone: [] });
      check('nothing gone means no section at all', !/No longer active/.test(textOf(goneLess.sheet)));
      check('nor the muted line under it', countOf(goneLess.sheet, 'shop-note') === 0);
      check('nor an empty state pretending something is missing', countOf(goneLess.sheet, 'shop-gone-row') === 0);
      goneLess.panel.close();

      // -- NOTHING here may read as a Watch flag or a PC find -----------------
      for (const banned of [
        'cards-fmv', 'cards-fmv-good', 'cards-fmv-muted', 'cards-check', 'cards-chip-max',
        'cards-chip-band', 'cards-bookage', 'cards-row', 'cards-money', 'cards-allin',
        'cards-nb-row', 'cards-fold', 'cards-ends', 'cards-countdown',
        'pc-row', 'pc-list', 'pc-serial', 'pc-grade', 'pc-one', 'pc-line', 'pc-marks', 'pc-showing',
      ]) {
        check(`no .${banned} anywhere in the shop sheet`, countOf(shopSheet, banned) === 0);
      }
      const shopRowsText = shopSheet.querySelectorAll('.shop-list, .shop-gone, .cards-head').map((n) => n.textContent).join(' ');
      check('no ✓ on the rows', !/✓/.test(shopRowsText));
      check('no percentage of anything', !/%/.test(shopRowsText) && !/of FMV/i.test(shopRowsText));
      check('no MAX bid', !/\bMAX\b/.test(shopRowsText));
      check('no gate language', !/\bgate\b/i.test(textOf(shopSheet)));
      check('no serial and no grade', !/\bPSA \d|\bBGS \d|\bSGC \d/.test(shopRowsText) && !/⬥|◆|★/.test(shopRowsText));
      // Out of scope by ruling: both need OAuth and the legacy Trading API,
      // and eBay's own app already pushes them. No stub promising them later.
      // The footer is excluded deliberately: it is the vault's own line, and
      // it names watchers and offers to say they live in the eBay app — the
      // opposite of the affordance this scan is looking for.
      check('no watchers on the rows', !/watcher/i.test(shopRowsText));
      check('no pending offers on the rows', !/pending offer/i.test(shopRowsText));
      check('and nothing promising either "soon"', !/soon|coming/i.test(shopRowsText));

      // -- the footer ---------------------------------------------------------
      check('one footer, at the bottom', countOf(shopSheet, 'cards-foot') === 1);
      check(
        'the vault\'s words plus eBay\'s credit',
        shopSheet.querySelector('.cards-foot').textContent ===
          "Active listings and sold-detection. Watchers and pending offers live in the eBay app — see C6. · eBay data via Browse API",
        shopSheet.querySelector('.cards-foot').textContent
      );
      const noFooter = openShop({}, { shop_footer: null });
      check('a payload with no footer still credits eBay', noFooter.sheet.querySelector('.cards-foot').textContent === 'eBay data via Browse API');
      noFooter.panel.close();

      // -- empty, ragged, half-broken -----------------------------------------
      const emptyShop = openShop({ listings: [], gone: [], active: 0 });
      check('an empty shop says so rather than going blank', /Nothing listed right now/.test(textOf(emptyShop.sheet)));
      check('the section is still headed, at zero', /Listed \(0\)/.test(textOf(emptyShop.sheet)));
      check('with no gone section over nothing', !/No longer active/.test(textOf(emptyShop.sheet)));
      check('and the footer still appears once', countOf(emptyShop.sheet, 'cards-foot') === 1);
      check('the board still shows the chip', emptyShop.board.querySelector('.cards-count').textContent === '0');
      check('and the faint line', /0 listed/.test(textOf(emptyShop.board)));
      emptyShop.panel.close();

      const shopErrors = openShop({ errors: ['eBay Browse API: the storefront sweep timed out'] });
      check('what the sweep could not reach is said at the top', /feed trouble: eBay Browse API: the storefront sweep timed out/.test(textOf(shopErrors.sheet)));
      check('and the listings it DID get still render', countOf(shopErrors.sheet, 'shop-row') === 4);
      shopErrors.panel.close();

      let raggedShopThrew = null;
      let raggedShop = null;
      try {
        raggedShop = openShop({
          listings: [{ item_id: 'r' }, { title: 'HALF', price: 10 }, null, 'nope'],
          gone: [{ item_id: 'g' }, null],
          active: null,
        });
      } catch (e) { raggedShopThrew = e; }
      check('a half-missing payload never throws', !raggedShopThrew, raggedShopThrew && raggedShopThrew.message);
      check('every entry still lays out as a row', raggedShop && countOf(raggedShop.sheet, 'shop-row') === 4);
      check('a listing with no title says so', /\(untitled listing\)/.test(textOf(raggedShop.sheet)));
      check('a gone entry with nothing in it still lays out', countOf(raggedShop.sheet, 'shop-gone-row') === 2);
      check('no "undefined" survives it', !/undefined/.test(textOf(raggedShop.sheet)));
      check('no "NaN" either', !/NaN/.test(textOf(raggedShop.sheet)));
      check('and no "null" printed as a word', !/\bnull\b/.test(textOf(raggedShop.sheet)));
      check('an active count that never arrived raises no chip', countOf(raggedShop.board, 'cards-count') === 0);
      raggedShop.panel.close();

      // -- nothing ticks in here ----------------------------------------------
      //
      // A storefront moves slowly and has no hammer coming. A countdown here
      // would be the tile inventing urgency it has no evidence for.
      check('the shop sheet starts no clock', timers.live.size === 0, String(timers.live.size));
      check('and registers no visibility listener', docListenerCount('visibilitychange') === 0);

      // -- all three faces at once, and none of them bleeds -------------------
      //
      // The regression that matters: turning Shop on must not change a pixel
      // of Watch or PC. Every fixture in the two blocks above is shop-free on
      // purpose; this is the one board that carries all three.
      const allPanel = fakePanel();
      const allThree = withNow(NOW_UTC, () => {
        const r = new El('div');
        const d = deskData();
        d.shop = shopData().shop;
        d.shop_footer = shopData().shop_footer;
        d.pc = pcData().pc;
        d.pc_footer = pcData().pc_footer;
        cards.render(r, cardsTile(d), { id: 'cards', actions: allPanel.actions });
        return r;
      });
      check('three live buttons', labelsOf(allThree).join('|') === 'Watch|Shop|PC' && countOf(allThree, 'cards-btn-soon') === 0);
      check('three faint lines, one per face', countOf(allThree, 'tile-foot') === 3, String(countOf(allThree, 'tile-foot')));
      check('in the menu\'s order', /14 targets[\s\S]*4 listed[\s\S]*79 bookends/.test(textOf(allThree)), textOf(allThree));
      check('the Watch dot still rises from the Watch face', countOf(allThree, 'cards-dot') === 1);

      withNow(NOW_UTC, () => cardsTap(cardBtns(allThree)[0]));
      const watchAgain = allPanel.last.body;
      check('the Watch sheet is untouched by the new face', countOf(watchAgain, 'cards-row') === 5 && countOf(watchAgain, 'cards-fmv-good') === 1);
      check('and carries no shop row', countOf(watchAgain, 'shop-row') === 0 && countOf(watchAgain, 'shop-gone-row') === 0);
      withNow(NOW_UTC, () => cardsTap(cardBtns(allThree)[2]));
      const pcAgain = allPanel.last.body;
      check('the PC sheet is untouched too', countOf(pcAgain, 'pc-row') === 5 && countOf(pcAgain, 'pc-serial') === 5);
      check('and carries no shop row', countOf(pcAgain, 'shop-row') === 0 && countOf(pcAgain, 'shop-gone-row') === 0);
      allPanel.close();

      // -- a tap with no panel action -----------------------------------------
      let shopTapThrew = null;
      try {
        const inertShop = new El('div');
        cards.render(inertShop, cardsTile(shopData()), { id: 'cards', actions: {} });
        cardsTap(cardBtns(inertShop)[1]);
      } catch (e) { shopTapThrew = e; }
      check('a shop tap with no panel action never reaches the page', !shopTapThrew, shopTapThrew && shopTapThrew.message);

      // -- nothing anywhere reads as a bug ------------------------------------
      const shopText = `${textOf(shopSheet)} ${textOf(shopBoard)}`;
      check('no "undefined", "NaN" or "Invalid Date" on the shop face', !/undefined|NaN|Invalid Date/.test(shopText), shopText.slice(0, 160));
    } finally {
      for (const v of shopOpened) v.panel.close();
    }
    check('no shop sheet is left ticking', timers.live.size === 0, String(timers.live.size));
    check('and none is left listening', docListenerCount('visibilitychange') === 0);

    // -- the ruling, as a source scan ----------------------------------------
    //
    // The class scans above catch a shop row that LOOKS like a flag or a
    // find. This catches the likelier mistake a year from now: someone
    // reaching for `listingRow` or `pcRow` because all three sheets have rows
    // in them — and someone reaching for a colour on the age.
    check('the shop sheet builds its own rows', /function shopRow\(/.test(CARDS_SRC));
    const SHOP_REGION = CARDS_SRC.slice(CARDS_SRC.indexOf('function planShopItem('), CARDS_SRC.indexOf('function soonButton('));
    check('and never borrows the Watch row', SHOP_REGION.length > 500 && !/listingRow/.test(SHOP_REGION), String(SHOP_REGION.length));
    check('nor the PC one', !/pcRow|serialBadge|gradeChip/.test(SHOP_REGION));
    check('nor the gate chip', !/fmvChip|cards-fmv|cards-chip-max|cards-chip-band/.test(SHOP_REGION));
    check('nor a countdown', !/msUntil|countdown|endsLine|startClock/.test(SHOP_REGION));
    // The age ruling, held at the source: there is no branch on `days` that
    // picks a class, and no warn token within reach of one.
    check('the age is never branched on for a class', !/days\s*[<>]=?|days_listed\s*[<>]=?/.test(SHOP_REGION), SHOP_REGION.slice(0, 80));
    // Every class this region emits is a bare string literal — no template,
    // no ternary — so there is no branch anywhere that could pick a tone from
    // an age. That is the age ruling held at the source rather than at the
    // DOM. (The one `warn` in here is `staleMark`'s tile-level rule-8 mark,
    // which is about the FEED, not about any row.)
    const SHOP_CLASSES = [...SHOP_REGION.matchAll(/cls:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    check('every class it emits is a bare literal', SHOP_CLASSES.length > 5 && SHOP_CLASSES.every((c) => /^'[a-z0-9 -]+'$/.test(c)), SHOP_CLASSES.join(' | '));
    check('so no branch can pick a tone from an age', !/cards-warn|--warn|-danger|-stale|shop-days-/.test(SHOP_REGION));
    check('the shop stylesheet colours no age either', !/\.shop-days[^{]*\{[^}]*var\(--(warn|bad)\)/.test(CARDS_CSS));
    check('and defines exactly one rule for it', (CARDS_CSS.match(/\.shop-days\b/g) || []).length === 1, String((CARDS_CSS.match(/\.shop-days\b/g) || []).length));
    // Out of scope by ruling — not "later", not a stub.
    check('the module names no watcher affordance', !/watcher/i.test(CARDS_SRC));
    check('nor a pending-offer one', !/pending_offer|pendingOffer/i.test(CARDS_SRC));
  });

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('\ntest run crashed:', e && e.stack); process.exit(1); });
