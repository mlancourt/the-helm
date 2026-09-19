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
 * There is no "All" button and nothing is remembered on the device: the sheet
 * is transient, so there is no per-viewer state worth keeping. Cards the vault
 * left without a category would have no button to live under, so they get one
 * last bucket rather than falling off the board — a menu that silently drops
 * stories is worse than one extra button.
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

/**
 * Button and chip tints. A category with no entry here renders neutral rather
 * than unstyled — the engine owns this taxonomy and will grow it without
 * asking.
 */
const CATEGORY_TONE = {
  'local news': 'local',
  'local sports': 'sport',
  'national politics': 'civic',
  tech: 'tech',
  business: 'money',
  markets: 'money',
};

const arr = (v) => (Array.isArray(v) ? v : []);

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
  const tone = CATEGORY_TONE[catKey(category)] || 'neutral';
  return el('span', { cls: `news-cat news-cat-${tone}` }, [
    emoji ? el('span', { cls: 'news-emoji', attrs: { 'aria-hidden': 'true' }, text: emoji }) : null,
    el('span', { text: str(category) }),
  ]);
}

function card(c) {
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
        tone: keyed ? CATEGORY_TONE[key] || 'neutral' : 'neutral',
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
function sheetBody(group) {
  return (body) => {
    body.appendChild(el('div', { cls: 'news' }, group.cards.map((c) => card(c))));
  };
}

function menuButton(group, ctx) {
  return el(
    'button',
    {
      cls: `news-menu-btn news-menu-${group.tone}`,
      attrs: { type: 'button' },
      on: {
        click: (e) => {
          // Don't let the tap ride up into the card's Explain handler.
          e.stopPropagation();
          const open = ctx && ctx.actions && ctx.actions.openPanel;
          // No sheet to open (the test harness, an older shell): the menu is
          // inert rather than broken.
          if (typeof open === 'function') open(headingFor(group), sheetBody(group));
        },
      },
    },
    [
      group.emoji
        ? el('span', { cls: 'news-emoji', attrs: { 'aria-hidden': 'true' }, text: group.emoji })
        : null,
      el('span', { cls: 'news-menu-label', text: group.label }),
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
 * The shell prints `tile.error` above the body for every tile before the
 * module runs. For a forty-feed aggregator that string is the normal cost of
 * doing business — one feed rate-limited — and putting it on the board turns a
 * working tile into a red one. So the newsstand takes its own body back and
 * says "36 of 40 sources answered" instead.
 *
 * Only this tile's body, only its own direct children, and only when there is
 * a sources line to say it better.
 */
function hushShellError(root) {
  // A real DOM hands back a live NodeList, the test shim hands back an array;
  // both spread, and both must be COPIED before removing from them.
  if (!root || !root.childNodes) return;
  for (const kid of Array.from(root.childNodes)) {
    if (kid && kid.classList && typeof kid.classList.contains === 'function' && kid.classList.contains('card-error')) {
      root.removeChild(kid);
    }
  }
}

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
    el_.appendChild(
      el(
        'div',
        { cls: 'news-menu', attrs: { role: 'group', 'aria-label': 'Newsstand categories' } },
        groups.map((g) => menuButton(g, ctx))
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
    // Said in this module's own words, so the shell's copy of the raw error
    // does not also stand on the board.
    hushShellError(el_);
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
