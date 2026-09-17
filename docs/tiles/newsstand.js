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

function categoryChip(category, emoji) {
  const tone = CATEGORY_TONE[String(category).trim().toLowerCase()] || 'neutral';
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

export function render(el_, tile) {
  const data = tile.data || {};
  const cards = Array.isArray(data.cards) ? data.cards : [];

  if (!cards.length) {
    el_.appendChild(empty('No cards.'));
    return;
  }

  el_.appendChild(el('div', { cls: 'news' }, cards.map(card)));

  const foot = [];
  if (data.as_of) foot.push(`as of ${ago(data.as_of)}`);
  if (typeof data.count === 'number') foot.push(`${data.count} cards`);
  if (data.refresh_note) foot.push(String(data.refresh_note));
  if (foot.length) el_.appendChild(el('p', { cls: 'tile-foot', text: foot.join(' · ') }));
}
