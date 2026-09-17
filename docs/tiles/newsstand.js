/**
 * newsstand — a compact card list. Links open in a new tab.
 *
 * extLink() refuses anything that is not http(s), so a snapshot carrying a
 * javascript: or data: URL renders as inert text instead of a live link.
 */

import { el, empty, extLink } from '../lib/dom.js';
import { ago } from '../lib/fmt.js';

export function render(el_, tile) {
  const data = tile.data || {};
  const cards = Array.isArray(data.cards) ? data.cards : [];

  if (!cards.length) {
    el_.appendChild(empty('No cards.'));
    return;
  }

  el_.appendChild(
    el(
      'div',
      { cls: 'news' },
      cards.map((c) =>
        el('div', { cls: 'news-card' }, [
          extLink(c.url, c.title || '(untitled)', 'news-title'),
          el('div', { cls: 'news-meta' }, [
            el('span', { cls: 'news-source', text: c.source || '' }),
            c.lens ? el('span', { cls: 'news-lens', text: c.lens }) : null,
          ]),
        ])
      )
    )
  );

  if (data.as_of) {
    el_.appendChild(el('p', { cls: 'tile-foot', text: `as of ${ago(data.as_of)}` }));
  }
}
