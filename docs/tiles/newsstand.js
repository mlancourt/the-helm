/**
 * newsstand — a category menu. The stories live in a sheet, not on the board.
 *
 * The tile used to list every card inline, which made it several times the
 * height of every other tile and turned the board into a scroll. So the tile
 * body is now a menu: one button per category actually present in the payload,
 * with a count. Tapping one opens a bottom sheet holding that category's
 * cards, with the card rendering unchanged — title, source, clamped synopsis,
 * lens, link.
 *
 * The menu is DERIVED from the cards, never from a list in this file — a
 * category the vault invents tomorrow shows up on its own, wearing its own
 * emoji, with no page deploy (rule 9). Order is first mention.
 *
 * There is no "All" button and nothing is remembered: the sheet is transient,
 * so there is no per-viewer state worth keeping. Cards the vault left without
 * a category would have no button to live under, so they get one last bucket
 * rather than falling off the board — a menu that silently drops stories is
 * worse than one extra button.
 *
 * Four fields carry the editorial weight, and all four are the engine's:
 *   emoji     drawn straight from the card, never mapped from `category` here.
 *             A new category the vault invents must not arrive on this page
 *             wearing the wrong glyph, or none (rule 9).
 *   category  a button on the board and a chip in the sheet, tinted by a small
 *             palette and falling back to neutral.
 *   synopsis  a paragraph, several hundred characters. Clamped to three lines
 *             so a long category still scans on a phone, and expanded by a
 *             tap — nothing is hidden, it is just folded.
 *   lens      why this matters to Matt. Kept last and kept distinct, because
 *             it is the vault's opinion rather than the source's reporting.
 *
 * extLink() refuses anything that is not http(s), so a snapshot carrying a
 * javascript: or data: URL renders as inert text instead of a live link.
 *
 * Rule 10: every one of them lands via textContent. An emoji is untrusted text
 * exactly like a headline is.
 */

import { el, empty, extLink } from '../lib/dom.js';
import { ago } from '../lib/fmt.js';

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

/**
 * Two spellings of one category are one button. The payload's own casing is
 * what gets printed; this key only decides sameness.
 */
function catKey(category) {
  return String(category).trim().toLowerCase();
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
    emoji ? el('span', { cls: 'news-emoji', attrs: { 'aria-hidden': 'true' }, text: String(emoji) }) : null,
    el('span', { text: String(category) }),
  ]);
}

function card(c) {
  const bits = [];

  const head = el('div', { cls: 'news-head' }, [
    // No category to hang it on, but an emoji anyway: still show the emoji.
    !c.category && c.emoji
      ? el('span', { cls: 'news-emoji news-emoji-lone', attrs: { 'aria-hidden': 'true' }, text: String(c.emoji) })
      : null,
    extLink(c.url, c.title || '(untitled)', 'news-title'),
  ]);
  bits.push(head);

  const meta = el('div', { cls: 'news-meta' }, [
    c.category ? categoryChip(c.category, c.emoji) : null,
    el('span', { cls: 'news-source', text: c.source || '' }),
  ]);
  bits.push(meta);

  if (c.synopsis) {
    const body = el('p', { cls: 'news-synopsis clamped', text: String(c.synopsis) });
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
  if (c.lens) bits.push(el('p', { cls: 'news-lens', text: String(c.lens) }));

  return el('div', { cls: 'news-card' }, bits);
}

/**
 * The categories actually present, in first-mention order, each carrying its
 * own cards: [{key, label, emoji, tone, cards}]
 *
 * The label is the payload's own spelling and the emoji is the payload's own
 * glyph — the first one offered for that category, so a card that forgot its
 * emoji does not blank the button for every card that remembered.
 */
function groupByCategory(cards) {
  const groups = new Map();
  for (const raw of cards) {
    const c = raw || {};
    const keyed = !!c.category;
    const key = keyed ? catKey(c.category) : NO_CATEGORY;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label: keyed ? String(c.category).trim() : NO_CATEGORY_LABEL,
        emoji: keyed && c.emoji ? String(c.emoji) : '',
        tone: keyed ? CATEGORY_TONE[key] || 'neutral' : 'neutral',
        cards: [],
      };
      groups.set(key, g);
    } else if (!g.emoji && keyed && c.emoji) {
      g.emoji = String(c.emoji);
    }
    g.cards.push(c);
  }

  // Uncategorised is a fallback, not a category — it sorts last however early
  // the payload happened to mention one.
  const out = [...groups.values()].filter((g) => g.key !== NO_CATEGORY);
  const rest = groups.get(NO_CATEGORY);
  if (rest) out.push(rest);
  return out;
}

/** "Local News" with its glyph — the sheet's title, and the button's wording. */
function headingFor(group) {
  return group.emoji ? `${group.emoji} ${group.label}` : group.label;
}

/** Fills a sheet body with one category's cards. */
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

export function render(el_, tile, ctx) {
  const data = tile.data || {};
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const groups = groupByCategory(cards);

  if (!groups.length) {
    el_.appendChild(empty('No paper yet.'));
    return;
  }

  el_.appendChild(
    el(
      'div',
      { cls: 'news-menu', attrs: { role: 'group', 'aria-label': 'Newsstand categories' } },
      groups.map((g) => menuButton(g, ctx))
    )
  );

  const foot = [];
  if (data.as_of) foot.push(`as of ${ago(data.as_of)}`);
  if (data.refresh_note) foot.push(String(data.refresh_note));
  if (foot.length) el_.appendChild(el('p', { cls: 'tile-foot', text: foot.join(' · ') }));
}
