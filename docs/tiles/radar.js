/**
 * radar — the engine's plain-language list for the day. Rendered verbatim:
 * no reordering, no truncation, no interpretation. The vault wrote these
 * sentences on purpose.
 */

import { el, empty } from '../lib/dom.js';
import { dayLabel } from '../lib/fmt.js';

export function render(el_, tile) {
  const data = tile.data || {};
  const lines = Array.isArray(data.lines) ? data.lines : [];

  if (data.date) {
    // data.date is a Central 'YYYY-MM-DD' string — formatted from its parts.
    el_.appendChild(el('div', { cls: 'tile-subhead', text: dayLabel(data.date) }));
  }

  if (!lines.length) {
    el_.appendChild(empty('Radar is clear.'));
    return;
  }

  el_.appendChild(
    el(
      'ul',
      { cls: 'radar' },
      lines.map((l) => el('li', { text: String(l) }))
    )
  );

  if (data.source) {
    el_.appendChild(el('p', { cls: 'tile-foot', text: `source: ${data.source}` }));
  }
}
