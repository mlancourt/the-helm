/**
 * watch_bill — "Watch Bill". One row per recurring scheduled task on the Mac
 * mini: what it is, when it last fired, and the doc it produced.
 *
 * Contract: the build prompt of 2026-09-24 (rulings WB1–WB10; WB10 is the
 * display-only ruling this file lives under).
 *
 * THE DIVISION OF LABOUR. The engine reads the mini's own scheduler file
 * (read-only) plus the `watch-bill.json` doc map, decides each task's state —
 * including the 90-minute grace window that separates `due` from `missed` —
 * sorts the list, counts it, and builds every `obsidian://` link. This module
 * sorts nothing, counts nothing and builds no URL. The only judgement it makes
 * is how many rows fit on the board.
 *
 * TONE. Exactly one: `missed` is bad. Everything else is neutral, and in
 * particular `fired` is NOT green — a board of green checks is noise, and the
 * time printed beside the task IS the confirmation.
 *
 * RULE 7. Every time on this tile is a real UTC instant from the engine, and
 * every one reaches the page through `ctWeekday()` + `ctTime()`, which pin
 * Central. Nothing in this module is handed to `new Date()`.
 *
 * LINKS. `doc.obsidian_url` is used exactly as delivered. The scheme is
 * `obsidian:`, which `safeUrl()` (http/https only) would rightly refuse, so
 * this field — and only this field — is vetted here by `obsidianHref()`: an
 * `obsidian://` URL passes untouched, anything else renders as inert text.
 * No target="_blank": iOS hands the custom scheme straight to the app.
 *
 * WB10 — DISPLAY ONLY. No run-now, no retry, no toggles, no age counters, no
 * "N days since", no staleness copy about the tasks. The doc link is the only
 * interactive thing on a row.
 *
 * RULE 10: labels, doc names and folder paths land via textContent.
 */

import { el, genericCard } from '../lib/dom.js';
import { ctTime, ctWeekday } from '../lib/fmt.js';

/** How many rows reach the board before the rest roll into "+N more". */
const INLINE_MAX_ROWS = 5;

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The doc's link, vetted for THIS field only — or null.
 *
 * Returns the string exactly as delivered; it is tested, never rebuilt.
 */
function obsidianHref(v) {
  const href = str(v).trim();
  return /^obsidian:\/\//i.test(href) ? href : null;
}

/** `Thu 4:04 AM` for an instant, Central pinned — or '' when it will not parse. */
function stamp(iso) {
  const day = ctWeekday(str(iso));
  const time = ctTime(str(iso));
  return day && time ? `${day} ${time}` : '';
}

/**
 * The right-hand {when} of a row, by state. Tone is `bad` for a missed slot
 * and nothing otherwise — there is deliberately no good tone to reach for.
 */
function whenOf(task) {
  switch (str(task.state)) {
    case 'fired':
      return { text: stamp(task.last_run_at), bad: false };
    case 'due':
      return { text: 'running…', bad: false };
    case 'missed': {
      const at = stamp(task.missed_slot);
      return { text: at ? `🔴 missed ${at}` : '🔴 missed', bad: true };
    }
    case 'not_yet': {
      const at = stamp(task.next_run_at);
      return { text: at ? `next ${at}` : '', bad: false };
    }
    case 'paused':
      return { text: 'paused', bad: false };
    default:
      return { text: '', bad: false };
  }
}

/** The header: the non-zero counts, printed as the engine counted them. */
const COUNT_ORDER = [
  ['missed', (n) => `🔴 ${n} missed`],
  ['due', (n) => `${n} due`],
  ['fired', (n) => `${n} fired`],
  ['not_yet', (n) => `${n} not yet`],
  ['paused', (n) => `${n} paused`],
];

function countsLine(data) {
  const counts = obj(data.counts);
  const parts = [];
  for (const [key, say] of COUNT_ORDER) {
    const n = num(counts[key]);
    if (n > 0) parts.push(say(n));
  }
  if (!parts.length) return null;
  return el('p', { cls: 'wb-counts', text: parts.join(' · ') });
}

// -------------------------------------------------------------------- parts

function sep() {
  return el('span', { cls: 'wb-sep', attrs: { 'aria-hidden': 'true' }, text: ' · ' });
}

/** Line 2: the doc link (or "no new doc"), then the folder, muted. */
function subLine(task) {
  const folder = str(task.folder).trim();
  const doc = task.doc && typeof task.doc === 'object' ? task.doc : null;
  const kids = [];

  if (doc) {
    const name = str(doc.name);
    const href = obsidianHref(doc.obsidian_url);
    const title = str(doc.rel_path) || null;
    kids.push(
      href
        ? el('a', { cls: 'wb-doc', text: name, attrs: { href, title } })
        : el('span', { cls: 'wb-doc', text: name, attrs: { title } })
    );
  } else if (str(task.state) === 'fired') {
    kids.push(el('span', { cls: 'wb-nodoc', text: 'no new doc' }));
  }

  if (folder) {
    if (kids.length) kids.push(sep());
    kids.push(el('span', { cls: 'wb-folder', text: folder }));
  }

  return kids.length ? el('div', { cls: 'wb-sub' }, kids) : null;
}

function taskRow(task) {
  const when = whenOf(task);
  const emoji = str(task.emoji);
  const label = str(task.label) || str(task.id);
  return el('div', { cls: 'wb-row' }, [
    el('div', { cls: 'wb-line' }, [
      el('span', { cls: 'wb-name', text: emoji ? `${emoji} ${label}` : label }),
      when.text ? el('span', { cls: when.bad ? 'wb-when wb-bad' : 'wb-when', text: when.text }) : null,
    ]),
    subLine(task),
  ]);
}

// --------------------------------------------------------------------- sheet

function sheetBody(tasks, note) {
  return (body) => {
    body.appendChild(el('div', { cls: 'wb wb-detail' }, tasks.map(taskRow)));
    if (note) body.appendChild(el('p', { cls: 'tile-foot wb-note', text: note }));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data);

  // Rule 9: the scheduler file is not there to read. Print what the payload
  // did carry rather than inventing a shape for it.
  if (str(tile && tile.status) === 'error') {
    genericCard(root, tile || {});
    return;
  }

  // Payload order, untouched — the engine sorted it.
  const tasks = arr(data.tasks).filter((t) => t && typeof t === 'object' && !Array.isArray(t));

  const counts = countsLine(data);
  if (counts) root.appendChild(counts);

  if (!tasks.length) {
    root.appendChild(el('p', { cls: 'empty', text: 'No scheduled tasks.' }));
    return;
  }

  const inline = tasks.slice(0, INLINE_MAX_ROWS);
  root.appendChild(el('div', { cls: 'wb' }, inline.map(taskRow)));

  const rest = tasks.length - inline.length;
  if (rest > 0) {
    const openPanel =
      ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
    const title = str(data.title) || 'Watch Bill';
    const build = sheetBody(tasks, str(data.note).trim());

    root.appendChild(
      el('button', {
        cls: 'wb-more',
        text: `+${rest} more`,
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            e.stopPropagation();
            if (!openPanel) return;
            openPanel(title, build);
          },
        },
      })
    );
  }
}
