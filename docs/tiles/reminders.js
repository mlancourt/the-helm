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
 *
 * v1.33.0 (Matt, 2026-10-05): the face is NOW — overdue, today, tomorrow.
 * Everything further out, and everything undated, sits behind one "Later"
 * toggle. The split reads the engine's `days`, so this page still counts
 * nothing. A miss is never hidden: overdue outranks the window, always.
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

/**
 * On the face: every miss, plus anything due today or tomorrow (`days` 0/1).
 * Behind the toggle: dated two days out or more, and the undated tail.
 */
function isNow(item) {
  if (bucket(item) === 0) return true;
  return typeof item.days === 'number' && item.days <= 1;
}

const NOW_GROUPS = [
  { label: 'Overdue', test: (i) => bucket(i) === 0 },
  { label: 'Today & tomorrow', test: (i) => bucket(i) === 1 },
];
const LATER_GROUPS = [
  { label: 'Coming up', test: (i) => bucket(i) === 1 },
  { label: 'No date', test: (i) => bucket(i) === 2 },
];

/**
 * Open/closed survives the five-minute data refresh: the board re-renders the
 * tile, and a list Matt is reading must not snap shut under his thumb. Module
 * state, page lifetime only — a reload starts closed.
 */
let laterOpen = false;

function groups(list, defs) {
  const out = [];
  for (const g of defs) {
    const inGroup = list.filter(g.test);
    if (!inGroup.length) continue;
    out.push(el('h4', { cls: 'rem-heading', text: g.label }));
    out.push(el('div', { cls: 'rem-group' }, inGroup.map(itemRow)));
  }
  return out;
}

export function render(el_, tile) {
  const data = tile.data && typeof tile.data === 'object' && !Array.isArray(tile.data) ? tile.data : {};
  const items = Array.isArray(data.items) ? data.items.filter((i) => i && typeof i === 'object') : [];

  if (!items.length) {
    el_.appendChild(empty('Nothing on the list.'));
    return;
  }

  const sorted = [...items].sort(compare);
  const now = sorted.filter(isNow);
  const later = sorted.filter((i) => !isNow(i));

  if (now.length) {
    for (const node of groups(now, NOW_GROUPS)) el_.appendChild(node);
  } else {
    el_.appendChild(empty('Nothing due today or tomorrow.'));
  }

  if (later.length) {
    const panel = el('div', { cls: `rem-later${laterOpen ? '' : ' hidden'}` }, groups(later, LATER_GROUPS));
    const toggle = el('button', {
      cls: 'rem-later-toggle',
      text: `Later · ${later.length}`,
      attrs: { type: 'button', 'aria-expanded': laterOpen ? 'true' : 'false' },
      on: {
        click: (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          laterOpen = panel.classList.toggle('hidden') === false;
          toggle.setAttribute('aria-expanded', laterOpen ? 'true' : 'false');
        },
      },
    });
    el_.appendChild(toggle);
    el_.appendChild(panel);
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
