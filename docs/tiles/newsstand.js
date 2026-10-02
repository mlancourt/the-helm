/**
 * newsstand — a category menu. The stories live in a sheet, not on the board.
 *
 * The tile used to list every card inline, which made it several times the
 * height of every other tile and turned the board into a scroll. So the tile
 * body is now a menu: one button per category actually present in the payload,
 * with a count. Tapping one opens a bottom sheet holding that category's
 * cards, with the card rendering unchanged — title, source, age, clamped
 * synopsis, lens, link.
 *
 * RAW RSS (v2, 2026-09-19). The engine stopped curating: it now pours up to
 * 200 cards from ~40 feeds straight through, newest first, and `lens` is
 * always null. Four consequences, all of them handled here rather than by
 * trimming the payload:
 *
 *   - ORDER comes from `data.by_category` when the engine sends it — that is
 *     the feed config's own order, which is the order Matt thinks in. Counts
 *     never come from `by_category.n`; they are counted off the cards that
 *     actually arrived, so a button can never promise a story the sheet does
 *     not hold. Without `by_category` the menu falls back to first-mention
 *     order, exactly as before.
 *   - NO CAP. A sheet holding 40 stories is a long sheet; it scrolls. Hiding
 *     the tail of a category behind nothing at all is worse than scrolling,
 *     and there is no "+N more" to put it behind.
 *   - THE SOURCE NAME IS REQUIRED on every row. With a handful of curated
 *     cards it was decoration; with forty feeds it is the difference between
 *     a headline you can weigh and one you cannot.
 *   - NULLS ARE ABSENCES. `lens: null` and `synopsis: null` are the normal
 *     case now, and a card carrying only a title is a valid card. Nothing here
 *     may ever print the word "null".
 *
 * The menu is DERIVED from what arrived, never from a list in this file — a
 * category the vault invents tomorrow shows up on its own, wearing its own
 * emoji, with no page deploy (rule 9).
 *
 * There is no "All" button. Cards the vault left without a category would
 * have no button to live under, so they get one last bucket rather than
 * falling off the board — a menu that silently drops stories is worse than
 * one extra button.
 *
 * THE NEW PILL (N10, 2026-10-02). Each button may carry a brass pill counting
 * stories published since Matt last opened that category ON THIS DEVICE — a
 * UTC stamp per category in localStorage, the entertainment tile's E8
 * pattern. Rules:
 *   - Opening a category stamps it now and the pill goes on the spot.
 *   - Nothing new means NO pill. Not "0". The menu is quiet by default.
 *   - A category with no stamp yet is BASELINED at first sight, not shouted:
 *     seventeen buttons all wearing their full count on day one is noise,
 *     not news. (E8 goes the other way for its three faces; this menu has
 *     seventeen buttons, so the quiet default wins here.) A device whose
 *     storage is blocked re-baselines every load and simply never shows a
 *     pill — quiet, never wrong.
 *   - `published_at` is the only clock. A card with no stamp is never new.
 *   - Inside the sheet, a new row wears a small "new" mark so the pill's
 *     promise is visible once you tap through.
 *
 * ALL BUTTONS ARE THE SAME COLOUR (N10). The old per-category tint palette was
 * written for the curated era's nine categories; with seventeen it tinted
 * three buttons (Local News, Local Sports, Tech) and left fourteen grey, which
 * read as "highlighted" rather than "categorised". The palette and the tone
 * classes are gone; the chip inside the sheet is neutral too.
 *
 * The fields that carry the editorial weight are all the engine's:
 *   emoji        drawn from the card first, then from `by_category`, never
 *                mapped from `category` here. A new category the vault invents
 *                must not arrive on this page wearing the wrong glyph (rule 9).
 *   category     a button on the board and a chip in the sheet, tinted by a
 *                small palette and falling back to neutral.
 *   source       the feed's name. Small, muted, beside the chip — the same
 *                shape `local_events` gives a venue.
 *   published_at a UTC instant -> the age chip ('now', '12m', '3h',
 *                'yesterday', 'Tue', '9/12') via `ageChip()` in lib/fmt.js.
 *                No stamp, no chip; an unparseable stamp, no chip.
 *   synopsis     a paragraph. Clamped to three lines so a long category still
 *                scans on a phone, and expanded by a tap — nothing is hidden,
 *                it is just folded. Often null now.
 *   lens         why this matters to Matt. Kept last and kept distinct,
 *                because it is the vault's opinion rather than the source's
 *                reporting. Always null since the raw-RSS switch; the render
 *                stays, because the field may come back and rule 9 says a
 *                module tolerates the payload it is given.
 *
 * DEGRADED (rule 8). Forty feeds means a feed fails most runs, and a partial
 * paper is still a paper:
 *   stale  the cards render, plus one muted line — "36 of 40 sources
 *          answered". The raw error goes nowhere near the board; which feed
 *          threw which HTTP code is the engine's business, not Matt's.
 *   error  nothing new arrived, so the last set this module rendered is kept
 *          on screen (module memory, this page load only) under the same
 *          line. With nothing to fall back on, rule 9's generic card.
 *
 * extLink() refuses anything that is not http(s), so a snapshot carrying a
 * javascript: or data: URL renders as inert text instead of a live link.
 *
 * Rule 10: every one of them lands via textContent. An emoji is untrusted text
 * exactly like a headline is.
 */

import { el, empty, extLink, genericCard } from '../lib/dom.js';
import { ago, ageChip } from '../lib/fmt.js';

const arr = (v) => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------- last opened

/** {categoryKey: '<UTC ISO>'} — per device, never in the snapshot (N10). */
const LS_KEY = 'helm.newsstand.lastOpened';

/**
 * Every read is defended: Safari private mode throws on access, the key may
 * be absent, and whatever is in there was written by an older version of this
 * file. Any of those reads as "no stamps".
 */
function readLastOpened() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Write the whole map back. A failure here costs a pill, never the page. */
function writeLastOpened(all) {
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* no storage: no pills on this device */
  }
}

/**
 * A stored stamp as epoch ms, or NaN when it is not a real instant. A
 * date-only string parses in JS (as UTC midnight) but would compare a day
 * wrong forever, so it reads as no stamp — the entertainment tile's rule.
 */
function stampMs(v) {
  if (typeof v !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(v)) return NaN;
  return Date.parse(v);
}

/** true when the card was published after `sinceMs`; never true without a stamp. */
function isNew(c, sinceMs) {
  if (!Number.isFinite(sinceMs)) return false;
  const t = Date.parse(str(c.published_at));
  return Number.isFinite(t) && t > sinceMs;
}

/**
 * A payload value as display text, or ''.
 *
 * `String(null)` is the word "null", and with a payload where half the fields
 * are legitimately null that is not a theoretical risk — it is what the tile
 * would print on most cards. Everything user-visible goes through here.
 */
function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Two spellings of one category are one button. The payload's own casing is
 * what gets printed; this key only decides sameness.
 */
function catKey(category) {
  return str(category).trim().toLowerCase();
}

/**
 * The bucket for cards the vault sent without a category. A Symbol, so no
 * category the engine ever invents can collide with it.
 */
const NO_CATEGORY = Symbol('uncategorised');
const NO_CATEGORY_LABEL = 'Uncategorised';

function categoryChip(category, emoji) {
  return el('span', { cls: 'news-cat news-cat-neutral' }, [
    emoji ? el('span', { cls: 'news-emoji', attrs: { 'aria-hidden': 'true' }, text: emoji }) : null,
    el('span', { text: str(category) }),
  ]);
}

function card(c, fresh = false) {
  const bits = [];
  const category = str(c.category).trim();
  const emoji = str(c.emoji).trim();
  const source = str(c.source).trim();
  const synopsis = str(c.synopsis).trim();
  const lens = str(c.lens).trim();
  const age = ageChip(c.published_at);

  const head = el('div', { cls: 'news-head' }, [
    // No category to hang it on, but an emoji anyway: still show the emoji.
    !category && emoji
      ? el('span', { cls: 'news-emoji news-emoji-lone', attrs: { 'aria-hidden': 'true' }, text: emoji })
      : null,
    extLink(c.url, str(c.title).trim() || '(untitled)', 'news-title'),
  ]);
  bits.push(head);

  // Chip, source, age. Each part is omitted when it is not there rather than
  // rendered empty — an empty span still costs a gap in a flex row.
  const meta = [];
  if (fresh) meta.push(el('span', { cls: 'news-new-mark', text: 'new' }));
  if (category) meta.push(categoryChip(category, emoji));
  if (source) meta.push(el('span', { cls: 'news-source', text: source }));
  if (age) meta.push(el('span', { cls: 'news-age', text: age, attrs: { title: str(c.published_at) } }));
  if (meta.length) bits.push(el('div', { cls: 'news-meta' }, meta));

  if (synopsis) {
    const body = el('p', { cls: 'news-synopsis clamped', text: synopsis });
    const more = el('button', {
      cls: 'link-btn news-more',
      text: 'more',
      attrs: { type: 'button' },
      on: {
        click: (e) => {
          e.stopPropagation();
          const open = body.classList.toggle('clamped') === false;
          more.textContent = open ? 'less' : 'more';
        },
      },
    });
    // Only offer "more" when there is actually more. The card is not laid out
    // when render() runs, so the overflow test waits a tick — a timer rather
    // than requestAnimationFrame, because rAF does not fire at all in a
    // backgrounded tab and the button would never be evaluated. If there is
    // still no layout, the button is left alone rather than hidden on a guess.
    setTimeout(() => {
      if (body.clientHeight > 0 && body.scrollHeight <= body.clientHeight + 1) {
        more.classList.add('hidden');
      }
    }, 0);

    bits.push(body, more);
  }

  // The lens is the vault's read on why this matters — last, and visually its
  // own thing, so it is never mistaken for the source's words.
  if (lens) bits.push(el('p', { cls: 'news-lens', text: lens }));

  return el('div', { cls: 'news-card' }, bits);
}

/**
 * The categories actually present, each carrying its own cards:
 * [{key, label, emoji, tone, cards}]
 *
 * Order is `by_category`'s where the engine sent one — its list is the feed
 * config's order — with any category the cards mention but the list forgot
 * appended in first-mention order, and Uncategorised always last. A
 * `by_category` entry with no cards behind it gets no button: the count is the
 * cards', so a button with nothing under it would be a lie one tap deep.
 *
 * The label is the payload's own spelling and the emoji is the payload's own
 * glyph — the first one a card offered for that category, falling back to
 * `by_category`'s, so a category whose every card forgot its emoji still wears
 * one.
 */
function groupByCategory(cards, byCategory) {
  const groups = new Map();
  for (const raw of cards) {
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const label = str(c.category).trim();
    const keyed = !!label;
    const key = keyed ? catKey(label) : NO_CATEGORY;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label: keyed ? label : NO_CATEGORY_LABEL,
        emoji: keyed ? str(c.emoji).trim() : '',
        cards: [],
      };
      groups.set(key, g);
    } else if (!g.emoji && keyed) {
      g.emoji = str(c.emoji).trim();
    }
    g.cards.push(c);
  }

  // The engine's order first, then whatever the cards mentioned that it did
  // not. A Set rather than splicing, so a `by_category` that repeats a name
  // cannot emit the same button twice.
  const ordered = [];
  const placed = new Set();
  for (const raw of arr(byCategory)) {
    const entry = raw && typeof raw === 'object' ? raw : {};
    const key = catKey(entry.name);
    if (!key || placed.has(key)) continue;
    const g = groups.get(key);
    if (!g) continue;
    if (!g.emoji) g.emoji = str(entry.emoji).trim();
    placed.add(key);
    ordered.push(g);
  }
  for (const g of groups.values()) {
    if (g.key === NO_CATEGORY || placed.has(g.key)) continue;
    ordered.push(g);
  }

  // Uncategorised is a fallback, not a category — it sorts last however early
  // the payload happened to mention one.
  const rest = groups.get(NO_CATEGORY);
  if (rest) ordered.push(rest);
  return ordered;
}

/** "Local News" with its glyph — the sheet's title, and the button's wording. */
function headingFor(group) {
  return group.emoji ? `${group.emoji} ${group.label}` : group.label;
}

/**
 * Fills a sheet body with one category's cards — all of them.
 *
 * There is deliberately no slice here. Raw RSS puts up to 200 cards in the
 * payload and a busy category can hold forty; the sheet is a scrolling sheet,
 * and a cap would drop stories with nothing on screen to say it had.
 */
function sheetBody(group, sinceMs) {
  return (body) => {
    body.appendChild(el('div', { cls: 'news' }, group.cards.map((c) => card(c, isNew(c, sinceMs)))));
  };
}

function menuButton(group, ctx, sinceMs) {
  // The sheet is built against the stamp as it stood when the board drew, so
  // the rows marked "new" are exactly the ones the pill counted.
  const fresh = group.cards.filter((c) => isNew(c, sinceMs)).length;
  // Quiet when nothing is new: no pill at all, not a zero.
  const pill = fresh > 0 ? el('span', { cls: 'news-menu-new', text: String(fresh) }) : null;
  return el(
    'button',
    {
      cls: 'news-menu-btn',
      attrs: { type: 'button' },
      on: {
        click: (e) => {
          // Don't let the tap ride up into the card's Explain handler.
          e.stopPropagation();
          const open = ctx && ctx.actions && ctx.actions.openPanel;
          // No sheet to open (the test harness, an older shell): the menu is
          // inert rather than broken, and nothing is marked seen either.
          if (typeof open !== 'function') return;
          open(headingFor(group), sheetBody(group, sinceMs));
          // Seen. The pill goes now rather than at the next snapshot.
          const all = readLastOpened();
          all[String(group.key)] = new Date().toISOString();
          writeLastOpened(all);
          if (pill) pill.classList.add('hidden');
        },
      },
    },
    [
      group.emoji
        ? el('span', { cls: 'news-emoji', attrs: { 'aria-hidden': 'true' }, text: group.emoji })
        : null,
      el('span', { cls: 'news-menu-label', text: group.label }),
      pill,
      el('span', { cls: 'news-menu-dot', attrs: { 'aria-hidden': 'true' }, text: '·' }),
      el('span', { cls: 'news-menu-count', text: String(group.cards.length) }),
    ]
  );
}

// ------------------------------------------------------------------ degraded

/**
 * `data.sources` -> "36 of 40 sources answered", or ''.
 *
 * `total` is trusted when it is there and reconstructed from ok + failed when
 * it is not, because a count of feeds that answered is meaningless without the
 * count it is out of. The failure LIST is never rendered: it is a line of HTTP
 * codes and feed slugs, and the board is not an incident report.
 */
function sourcesLine(sources) {
  const s = sources && typeof sources === 'object' ? sources : {};
  const ok = Number(s.ok);
  const failed = arr(s.failed).length;
  const total = Number.isFinite(Number(s.total)) ? Number(s.total) : (Number.isFinite(ok) ? ok + failed : NaN);
  if (!Number.isFinite(ok) || !Number.isFinite(total) || total <= 0) return '';
  return `${ok} of ${total} sources answered`;
}

/**
 * This tile reports its own trouble; the shell must not also paint the red
 * `tile.error` line above it (app.js `ownsErrorLine`).
 *
 * For a forty-feed aggregator a failed feed is the normal cost of doing
 * business, and a raw "r/whatever: HTTP Error 429" across the top turns a
 * working tile into a red one. "36 of 40 sources answered" is the same fact
 * in the form Matt can actually act on, and it is the only form that reaches
 * the board.
 *
 * Declared rather than done: an earlier cut had this module delete the node
 * the shell had already painted, which worked and was the wrong direction of
 * dependency — it would have broken silently the day app.js changed that
 * markup. A flag the shell reads keeps the shell the only thing that touches
 * the shell's own DOM.
 */
export const ownsErrorLine = true;

/**
 * The last set this module successfully drew, so `status: error` has something
 * to keep on screen.
 *
 * Module memory, not localStorage (the category-menu ruling: nothing about the
 * newsstand is remembered on the device). It survives a re-render and dies
 * with the page load, which is exactly the lifetime of "what Matt is currently
 * looking at".
 */
let lastGood = null;

// ---------------------------------------------------------------------- tile

export function render(el_, tile, ctx) {
  const t = tile && typeof tile === 'object' ? tile : {};
  const data = t.data && typeof t.data === 'object' && !Array.isArray(t.data) ? t.data : {};
  const status = str(t.status);
  const live = arr(data.cards);

  // `error` means nothing new arrived. Yesterday's paper beats a blank card,
  // so the last set drawn this page load is kept; with nothing behind us,
  // rule 9's generic card prints what the payload does carry.
  const degraded = status === 'error' || status === 'stale';
  const fromMemory = status === 'error' && !live.length && lastGood;
  const cards = fromMemory ? lastGood.cards : live;
  const sources = fromMemory ? lastGood.sources : data.sources;

  if (status === 'error' && !cards.length) {
    genericCard(el_, t);
    return;
  }

  const groups = groupByCategory(cards, fromMemory ? lastGood.by_category : data.by_category);

  if (!degraded && live.length) {
    lastGood = { cards: live, sources: data.sources, by_category: data.by_category };
  }

  if (!groups.length) {
    // Still say WHY there is no paper when the run was a bad one — an empty
    // tile beside a silent footer reads as a tile that forgot to load.
    el_.appendChild(empty('No paper yet.'));
  } else {
    // Stamps as of this draw. A category never opened on this device is
    // baselined now (N10). Keys are String(g.key): the category key, or
    // "Symbol(uncategorised)" for the fallback bucket — the same spelling the
    // tap handler writes, so the two can never disagree.
    const stamps = readLastOpened();
    let baselined = false;
    for (const g of groups) {
      const k = String(g.key);
      if (!Number.isFinite(stampMs(stamps[k]))) {
        stamps[k] = new Date().toISOString();
        baselined = true;
      }
    }
    if (baselined) writeLastOpened(stamps);
    el_.appendChild(
      el(
        'div',
        { cls: 'news-menu', attrs: { role: 'group', 'aria-label': 'Newsstand categories' } },
        groups.map((g) => menuButton(g, ctx, stampMs(stamps[String(g.key)])))
      )
    );
  }

  if (degraded) {
    const line = sourcesLine(sources);
    const words = fromMemory
      ? line
        ? `showing the last paper · ${line}`
        : 'showing the last paper'
      : line || 'some sources did not answer';
    // The board's whole account of what went wrong. The shell stands down for
    // this tile — see `ownsErrorLine` above.
    el_.appendChild(el('p', { cls: 'tile-foot news-sources', text: words }));
  }

  const foot = [];
  if (data.as_of) foot.push(`as of ${ago(data.as_of)}`);
  if (data.refresh_note) foot.push(str(data.refresh_note));
  if (foot.length) el_.appendChild(el('p', { cls: 'tile-foot', text: foot.join(' · ') }));
}

/** Test seam: drop the module's memory of the last good paper. */
export function _resetMemory() {
  lastGood = null;
}
