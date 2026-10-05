/**
 * calendar — today featured, today and tomorrow's events two-tone by calendar
 * (family / wss), and the next day off at the bottom.
 *
 * `date` and `time_ct` are Central strings straight from the vault. The date
 * goes through dayLabel (parts-based, never parsed); the time is printed as
 * given, because it is already Central and re-deriving it could only break it.
 *
 * v1.32.0 (vault Calendar-Tile-Spec K1–K9): `today` and `holiday` are the
 * ENGINE'S words. `today.weekday` / `today.label` ("Monday" / "October 5") and
 * `holiday.days_out` were all worked out in Central by the engine; this module
 * prints them and does no calendar arithmetic of its own — no `new Date`, no
 * month table, no counting to Christmas. The countdown is a plain muted line:
 * no colour, no urgency at any number (K7).
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

/** K2 — "Monday  October 5", verbatim, or nothing when the engine sent none. */
function todayHead(today) {
  if (!today || typeof today !== 'object') return null;
  const weekday = typeof today.weekday === 'string' ? today.weekday : '';
  const label = typeof today.label === 'string' ? today.label : '';
  if (!weekday && !label) return null;
  return el('div', { cls: 'cal-today' }, [
    weekday ? el('span', { cls: 'cal-weekday', text: weekday }) : null,
    label ? el('span', { cls: 'cal-date', text: label }) : null,
  ]);
}

/** K3 — the next day off, one line; `days_out` is the engine's count. */
function holidayLine(h) {
  if (!h || typeof h !== 'object' || typeof h.name !== 'string' || !h.name) return null;
  const n = h.days_out;
  if (!Number.isInteger(n) || n < 0) return null;
  const when = n === 0 ? 'is today' : n === 1 ? 'is tomorrow' : `in ${n} days`;
  const emoji = typeof h.emoji === 'string' && h.emoji ? `${h.emoji} ` : '';
  return el('div', {
    cls: 'cal-holiday',
    text: `${emoji}${h.name} ${when}`,
    attrs: { title: typeof h.date === 'string' ? h.date : null },
  });
}

export function render(el_, tile) {
  const data = tile.data && typeof tile.data === 'object' ? tile.data : {};
  const head = todayHead(data.today);
  if (head) el_.appendChild(head);

  const days = Array.isArray(data.days) ? data.days : [];
  if (!days.length) {
    el_.appendChild(empty('Nothing scheduled.'));
  } else {
    const today = ctToday();
    for (const day of days) {
      if (!day || typeof day !== 'object') continue;
      const events = Array.isArray(day.events) ? day.events.filter((e) => e && typeof e === 'object') : [];
      el_.appendChild(el('div', { cls: 'cal-day', text: dayLabel(day.date, today) }));
      if (!events.length) {
        el_.appendChild(el('p', { cls: 'empty', text: 'Clear.' }));
        continue;
      }
      el_.appendChild(el('div', { cls: 'cal-events' }, events.map(eventRow)));
    }
  }

  const foot = holidayLine(data.holiday);
  if (foot) el_.appendChild(foot);
}
