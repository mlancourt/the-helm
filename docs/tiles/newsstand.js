/**
 * newsstand — a compact card list. Links open in a new tab.
 *
 * extLink() refuses anything that is not http(s), so a snapshot carrying a
 * javascript: or data: URL renders as inert text instead of a live link.
 *
 * Four fields carry the editorial weight, and all four are the engine's:
 *   emoji     drawn straight from the card, never mapped from `category` here.
 *             A new category the vault invents must not arrive on this page
 *             wearing the wrong glyph, or none (rule 9).
 *   category  a chip, tinted by a small palette and falling back to neutral.
 *   synopsis  a paragraph, several hundred characters. Clamped to three lines
 *             so twenty-four cards still scan on a phone, and expanded by a
 *             tap — nothing is hidden, it is just folded.
 *   lens      why this matters to Matt. Kept last and kept distinct, because
 *             it is the vault's opinion rather than the source's reporting.
 *
 * The filter chips above the list are DERIVED from the cards, never from a
 * list in this file — a category the vault invents tomorrow shows up on its
 * own, wearing its own emoji, with no page deploy (rule 9). The chip set is
 * the categories actually present, in the order the payload first mentions
 * them, behind an "All" chip. Filtering hides cards rather than rebuilding
 * the list, so an expanded synopsis survives a round trip through a chip.
 *
 * The last-picked chip is remembered in localStorage: a per-viewer
 * convenience, not state. Every read and write is wrapped, and a private
 * window, a cleared store, or a remembered category that is no longer in the
 * payload all fall back to All.
 *
 * Rule 10: every one of them lands via textContent. An emoji is untrusted text
 * exactly like a headline is.
 */

import { el, empty, extLink } from '../lib/dom.js';
import { ago } from '../lib/fmt.js';

/**
 * Chip tints. A category with no entry here renders neutral rather than
 * unstyled — the engine owns this taxonomy and will grow it without asking.
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
 * Two spellings of one category are one chip. The payload's own casing is what
 * gets printed; this key only decides sameness.
 */
function catKey(category) {
  return String(category).trim().toLowerCase();
}

const ALL = '*';
const LS_FILTER = 'helm.newsstand.filter';

function readFilter() {
  try {
    return localStorage.getItem(LS_FILTER) || ALL;
  } catch {
    // Private window, blocked site data, or no storage at all.
    return ALL;
  }
}

function writeFilter(key) {
  try {
    localStorage.setItem(LS_FILTER, key);
  } catch {
    /* the filter still works for this visit, it just will not be remembered */
  }
}

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
          // Don't let the expand ride up into the card's Explain handler.
          e.stopPropagation();
          const open = body.classList.toggle('clamped') === false;
          more.textContent = open ? 'less' : 'more';
        },
      },
    });
    // Only offer "more" when there is actually more. The card is not in the
    // document yet when render() runs, so the overflow test waits a tick —
    // a timer rather than requestAnimationFrame, because rAF does not fire at
    // all in a backgrounded tab and the button would never be evaluated. If
    // there is still no layout (a hidden tile), the button is left alone
    // rather than hidden on a guess.
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
 * The categories actually present, in first-mention order:
 *   key -> {label, emoji}
 *
 * The label is the payload's own spelling and the emoji is the payload's own
 * glyph — the first one offered for that category, so a card that forgot its
 * emoji does not blank the chip for every card that remembered.
 */
function categoriesIn(entries) {
  const cats = new Map();
  for (const e of entries) {
    if (!e.key) continue;
    const emoji = e.card.emoji ? String(e.card.emoji) : '';
    const seen = cats.get(e.key);
    if (!seen) cats.set(e.key, { label: String(e.card.category).trim(), emoji });
    else if (!seen.emoji && emoji) seen.emoji = emoji;
  }
  return cats;
}

/**
 * The chip row. Returns null when there is nothing to filter by, so a payload
 * of uncategorised cards gets no empty rail above it.
 */
function filterRow(entries) {
  const cats = categoriesIn(entries);
  if (!cats.size) return null;

  // A remembered category the vault has since dropped is not an error — it is
  // just no longer on offer. Fall back to All.
  let active = readFilter();
  if (active !== ALL && !cats.has(active)) active = ALL;

  const chips = [];

  function apply(key) {
    let last = null;
    for (const e of entries) {
      // An uncategorised card belongs to no chip but All.
      const show = key === ALL || e.key === key;
      if (show) e.node.classList.remove('hidden');
      else e.node.classList.add('hidden');
      // :last-child is structural and a hidden card still holds that slot, so
      // the last VISIBLE card is marked here to drop its trailing hairline.
      e.node.classList.remove('news-last');
      if (show) last = e.node;
    }
    if (last) last.classList.add('news-last');
    for (const c of chips) {
      const on = c.key === key;
      if (on) c.node.classList.add('news-filter-on');
      else c.node.classList.remove('news-filter-on');
      c.node.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function chip(key, label, emoji) {
    const node = el(
      'button',
      {
        cls: 'news-filter',
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            // Don't let the tap ride up into the card's Explain handler.
            e.stopPropagation();
            apply(key);
            writeFilter(key);
          },
        },
      },
      [
        emoji ? el('span', { cls: 'news-emoji', attrs: { 'aria-hidden': 'true' }, text: emoji }) : null,
        el('span', { text: label }),
      ]
    );
    chips.push({ key, node });
    return node;
  }

  const row = el('div', { cls: 'news-filters', attrs: { role: 'group', 'aria-label': 'Filter by category' } }, [
    chip(ALL, 'All', ''),
    ...[...cats].map(([key, { label, emoji }]) => chip(key, label, emoji)),
  ]);

  apply(active);
  return row;
}

export function render(el_, tile) {
  const data = tile.data || {};
  const cards = Array.isArray(data.cards) ? data.cards : [];

  if (!cards.length) {
    el_.appendChild(empty('No cards.'));
    return;
  }

  // One entry per card: the node, and the category key it answers to.
  const entries = cards.map((c) => ({
    card: c || {},
    key: c && c.category ? catKey(c.category) : '',
    node: card(c || {}),
  }));

  const row = filterRow(entries);
  if (row) el_.appendChild(row);

  el_.appendChild(el('div', { cls: 'news' }, entries.map((e) => e.node)));

  const foot = [];
  if (data.as_of) foot.push(`as of ${ago(data.as_of)}`);
  if (typeof data.count === 'number') foot.push(`${data.count} cards`);
  if (data.refresh_note) foot.push(String(data.refresh_note));
  if (foot.length) el_.appendChild(el('p', { cls: 'tile-foot', text: foot.join(' · ') }));
}
