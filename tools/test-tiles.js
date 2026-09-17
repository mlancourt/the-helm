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

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

main().catch((e) => { console.error('\ntest run crashed:', e && e.stack); process.exit(1); });
