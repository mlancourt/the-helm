/**
 * calendar — today and tomorrow, two-tone by calendar (family / wss).
 *
 * `date` and `time_ct` are Central strings straight from the vault. The date
 * goes through dayLabel (parts-based, never parsed); the time is printed as
 * given, because it is already Central and re-deriving it could only break it.
 */

import { el, empty } from '../lib/dom.js';
import { dayLabel, ctToday } from '../lib/fmt.js';

function eventRow(evt) {
  const cal = String(evt.cal || '').toLowerCase();
  const tone = cal === 'family' ? 'family' : cal === 'wss' ? 'wss' : 'other';
  return el('div', { cls: `cal-event cal-${tone}` }, [
    el('span', { cls: 'cal-time', text: evt.time_ct || '' }),
    el('span', { cls: 'cal-title', text: evt.title || '' }),
  ]);
}

export function render(el_, tile) {
  const days = Array.isArray(tile.data?.days) ? tile.data.days : [];
  if (!days.length) {
    el_.appendChild(empty('Nothing scheduled.'));
    return;
  }

  const today = ctToday();
  for (const day of days) {
    const events = Array.isArray(day.events) ? day.events : [];
    el_.appendChild(el('div', { cls: 'cal-day', text: dayLabel(day.date, today) }));
    if (!events.length) {
      el_.appendChild(el('p', { cls: 'empty', text: 'Clear.' }));
      continue;
    }
    el_.appendChild(el('div', { cls: 'cal-events' }, events.map(eventRow)));
  }
}
