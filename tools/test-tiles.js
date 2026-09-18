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

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { for (const x of c) if (x) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  contains(c) { return this.set.has(c); }
  toggle(c) { if (this.set.has(c)) { this.set.delete(c); return false; } this.set.add(c); return true; }
  get value() { return [...this.set].join(' '); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attrs = {};
    this.listeners = {};
    this.classList = new ClassList(this);
    this._text = '';
    // Layout does not exist here; the newsstand's overflow probe must survive
    // that rather than assume a real box.
    this.clientHeight = 0;
    this.scrollHeight = 0;
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return this.classList.value; }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; }
  appendChild(n) { this.childNodes.push(n); return n; }
  removeChild(n) { this.childNodes = this.childNodes.filter((c) => c !== n); return n; }
  get firstChild() { return this.childNodes[0] || null; }
  get previousSibling() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  querySelectorAll(sel) { return all(this).filter((n) => matches(n, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function all(node, out = []) {
  for (const c of node.childNodes) { if (c instanceof El) { out.push(c); all(c, out); } }
  return out;
}
function matches(node, sel) {
  return sel.split(',').map((s) => s.trim()).some((s) =>
    s.startsWith('.') ? node.classList.contains(s.slice(1)) : node.tagName === s.toUpperCase()
  );
}

class TextNode {
  constructor(t) { this._text = String(t); }
  get textContent() { return this._text; }
}

global.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => new TextNode(t),
};

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
  return {
    calls,
    get last() { return calls[calls.length - 1] || null; },
    actions: {
      openPanel(title, build) {
        const body = new El('div');
        build(body);
        calls.push({ title, body });
      },
    },
  };
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
  // 22:30Z is 17:30 Central — so 19:29 is 1h59 out and 19:31 is 2h01 out.
  const NOW_UTC = '2026-09-18T22:30:00.000Z';
  const ENDS_SOON = '2026-09-18T19:29';
  const ENDS_LATER = '2026-09-18T19:31';

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
    listing({ item_id: 'a1', title: 'AUCTION-ONE', type: 'AUCTION', price: 410, ends_ct: ENDS_SOON, book_state: 'fresh', pct_fmv: 0.47 }),
    listing({ item_id: 'a2', title: 'AUCTION-TWO', type: 'AUCTION', price: 31, ends_ct: ENDS_LATER, new: true }),
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

  if (cards) {
    const panel = fakePanel();
    const root = withNow(NOW_UTC, () => {
      const r = new El('div');
      cards.render(r, cardsTile(deskData()), { id: 'cards', actions: panel.actions });
      return r;
    });

    check('two buttons, in the spec\'s order', labelsOf(root).join('|') === 'Watch|Shop', labelsOf(root).join('|'));
    check('the board carries no listings of its own', countOf(root, 'cards-row') === 0);
    check('one faint line under the menu', countOf(root, 'tile-foot') === 1);
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
      cards.render(r, cardsTile(deskData({ auctions: [listing({ type: 'AUCTION', ends_ct: '2026-09-18T16:00' })] })), { id: 'cards', actions: {} });
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

    // -- ends_ct: verbatim, amber inside two hours ---------------------------
    for (const a of AUCTIONS) {
      check(`ends_ct ${a.ends_ct} appears exactly as given`, textOf(sheet).includes(`ends ${a.ends_ct}`));
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
    check('a stale desk still renders its menu', cardBtns(staleRoot).length === 2 && !!staleRoot.querySelector('.cards-count'));
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
    check('a shop face that arrives stops saying "soon"', countOf(grown, 'cards-btn-soon') === 0 && cardBtns(grown).length === 2);
    withNow(NOW_UTC, () => cardsTap(cardBtns(grown)[1]));
    check('and opens as a generic card rather than nothing', /queue/.test(textOf(panel.last.body)) && /shipped/.test(textOf(panel.last.body)));
    const noWatch = new El('div');
    cards.render(noWatch, cardsTile({ shop: null }), { id: 'cards', actions: {} });
    check('a payload with no watch face greys that button too', countOf(noWatch, 'cards-btn-soon') === 2);

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
    check('the module never parses a date string', !/new Date|Date\.parse/.test(CARDS_SRC));
    // The engine's arithmetic is the engine's. A number computed here would
    // be indistinguishable from a real one on the screen, and wrong.
    check('it never adds price and ship into an all-in', !/(price|ship)\s*\+\s*[a-z]*\.?(ship|price)/i.test(CARDS_SRC));
    check('nor multiplies an FMV by the gate', !/(fmv\s*\*|\*\s*[a-z]*\.?gate)/i.test(CARDS_SRC));
    check('and never reformats ends_ct', !/ends_ct[\s\S]{0,60}(ctKick|ctClock|prettyDate)/.test(CARDS_SRC));
    check('it holds no state between renders', !/localStorage/.test(CARDS_SRC));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('\ntest run crashed:', e && e.stack); process.exit(1); });
