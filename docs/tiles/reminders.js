/**
 * reminders — what is overdue, what is coming, and what has no date at all.
 *
 * Order is the whole point of this tile: overdue first, then dated by how soon,
 * then the undated tail. A reminder that slipped yesterday must never sit below
 * one due next week because the engine happened to list it second.
 *
 * Rule 7 lives here in force. `due` is a date-only Central string and `due_time`
 * is a Central wall clock — neither is an instant, and neither is ever handed to
 * `new Date()`. `prettyDate` and `ctClock` are text in, text out. The `days`
 * count comes from the engine, which knows what "today" means in Central; this
 * page does not recompute it and cannot get it wrong.
 *
 * `overdue` is the engine's call and outranks the sign of `days`: a reminder due
 * at 09:00 this morning is `days: 0` and `overdue: true`, and belongs at the top
 * with the rest of the misses, not under "due today".
 */

import { el, empty, pill } from '../lib/dom.js';
import { prettyDate, ctClock, dueLabel } from '../lib/fmt.js';

/** Overdue → dated → undated. Lower sorts higher. */
function bucket(item) {
  if (item.overdue || (typeof item.days === 'number' && item.days < 0)) return 0;
  if (typeof item.days === 'number') return 1;
  return 2;
}

/**
 * Sort key inside a bucket. Overdue leads with the worst miss, dated leads with
 * the nearest, and both break ties on flagged-then-title so the order is stable
 * and reproducible rather than dependent on how the engine emitted the list.
 */
function compare(a, b) {
  const ba = bucket(a);
  const bb = bucket(b);
  if (ba !== bb) return ba - bb;

  if (ba !== 2) {
    const da = typeof a.days === 'number' ? a.days : 0;
    const db = typeof b.days === 'number' ? b.days : 0;
    if (da !== db) return da - db;
  }
  if (!!b.flagged !== !!a.flagged) return b.flagged ? 1 : -1;
  return String(a.title ?? '').localeCompare(String(b.title ?? ''));
}

/** The days-out chip. Engine `overdue` wins over a non-negative day count. */
function daysChip(item) {
  if (typeof item.days === 'number' && item.days < 0) {
    return pill(dueLabel(item.days).text, 'bad');
  }
  // Due earlier today: past its time, but still today's date.
  if (item.overdue) return pill('past due', 'bad');
  const label = dueLabel(item.days);
  if (!label) return null;
  return pill(label.text, label.tone);
}

/** 'Thu Sep 17 · 9:00 AM', or just the date, or nothing. */
function whenText(item) {
  if (!item.due) return '';
  const date = prettyDate(item.due);
  const time = item.due_time ? ctClock(item.due_time) : '';
  return time ? `${date} · ${time}` : date;
}

function itemRow(item) {
  const when = whenText(item);
  const priority = typeof item.priority === 'string' ? item.priority.trim().toLowerCase() : '';
  const meta = [when, item.list].filter(Boolean).join('  ·  ');

  return el('div', { cls: `rem-row ${item.overdue ? 'rem-overdue' : ''}`.trim() }, [
    el('div', { cls: 'rem-main' }, [
      el('div', { cls: 'rem-title-line' }, [
        // The flag is the mark. A glyph, not an icon font and not an image —
        // rule 4 allows neither — with a label for anything not reading pixels.
        item.flagged
          ? el('span', {
              cls: 'rem-flag',
              text: '⚑',
              attrs: { title: 'flagged', 'aria-label': 'flagged' },
            })
          : null,
        el('span', { cls: 'rem-title', text: String(item.title ?? '(untitled)') }),
      ]),
      meta ? el('div', { cls: 'rem-meta', text: meta }) : null,
    ]),
    el('div', { cls: 'rem-side' }, [
      // "none" is Reminders' way of saying no priority; it is not news.
      priority && priority !== 'none' ? pill(priority, priority === 'high' ? 'warn' : 'neutral') : null,
      daysChip(item),
    ]),
  ]);
}

const GROUPS = [
  { rank: 0, label: 'Overdue' },
  { rank: 1, label: 'Coming up' },
  { rank: 2, label: 'No date' },
];

export function render(el_, tile) {
  const data = tile.data && typeof tile.data === 'object' && !Array.isArray(tile.data) ? tile.data : {};
  const items = Array.isArray(data.items) ? data.items.filter((i) => i && typeof i === 'object') : [];

  if (!items.length) {
    el_.appendChild(empty('Nothing on the list.'));
    return;
  }

  const sorted = [...items].sort(compare);

  for (const group of GROUPS) {
    const inGroup = sorted.filter((i) => bucket(i) === group.rank);
    if (!inGroup.length) continue;
    el_.appendChild(el('h4', { cls: 'rem-heading', text: group.label }));
    el_.appendChild(el('div', { cls: 'rem-group' }, inGroup.map(itemRow)));
  }

  // Counts come from the engine; they are reported, not recomputed, so a
  // disagreement between them and the list is visible rather than papered over.
  const foot = [];
  if (typeof data.count === 'number') foot.push(`${data.count} open`);
  if (typeof data.overdue === 'number') foot.push(`${data.overdue} overdue`);
  if (typeof data.due_soon === 'number') foot.push(`${data.due_soon} due within 7 days`);
  if (data.source) foot.push(String(data.source));
  if (foot.length) el_.appendChild(el('p', { cls: 'tile-foot', text: foot.join(' · ') }));
}
