/**
 * local_events — "Lake Country". What is on around town in the next week.
 *
 * Spec: 06-AI-Stack/The-Helm/Local-Tile-Spec.md, rulings L1–L6.
 *
 * THE DIVISION OF LABOUR. The engine does all of the work: it pulls the
 * CivicPlus calendar feeds, expands a multi-day fest into one row per day,
 * applies the mute list and the family screen, and hands this module a list
 * that is already grouped by day and already in order. So there is no sorting,
 * no filtering and no date arithmetic on the events in here — the only
 * judgement this file makes is WHICH of those groups fit on the board.
 *
 * WHICH ONES FIT (L6). A week's calendar is not a backlog, and the tile is
 * held to the menu tiles' height: today and tomorrow go on the board, and
 * everything else lives behind one "+N more" button that opens the shared
 * bottom sheet with the whole week. Two consequences worth stating:
 *
 *   - Today and tomorrow are picked BY DATE, not by position. The engine only
 *     emits days that have something on them, so `days[0]` is often Saturday.
 *     A quiet Tuesday must read as a quiet Tuesday, not silently promote the
 *     weekend onto the board under the wrong heading.
 *   - N counts everything not on the board, which on a festival weekend
 *     includes rows trimmed off today itself (INLINE_MAX_ROWS). The button is
 *     the only way in, so it has to account for every row it is hiding.
 *
 * "CONT." (L3). A multi-day event arrives pre-expanded, one row per day, each
 * flagged `multi_day`. The mark goes on every day after the first, so a fest
 * does not read as five separate fests. First is judged by first APPEARANCE in
 * `days` — which is all we can honestly know, since a fest that started before
 * the window opens mid-run and its true first day is not in the payload.
 *
 * RULE 7: `date` is a Central business date and `label` ("Sat 9/19") is the
 * engine's own rendering of it — printed verbatim, never rebuilt. `time` is a
 * Central clock string ("08:00 AM - 12:00 PM", or a range, or blank) and is
 * likewise printed as it arrived. Nothing on this tile is handed to
 * `new Date()`. The one date comparison is today/tomorrow, and that is text
 * against text: `ctToday()` and `addDays()` are pure calendar arithmetic.
 *
 * RULE 8: `status: stale` means a feed errored and the others answered — the
 * rows Matt does have are worth more than a blank card, so they render and a
 * small ⚠︎ carries the reason in its tooltip. `status: error` means there is
 * nothing to lay out, so the tile falls back to rule 9's generic card rather
 * than inventing a shape for a payload that did not arrive.
 *
 * RULE 10: every title, venue, time and blurb lands via textContent, and the
 * row's own anchor goes through `safeUrl` — a row whose link is junk stays a
 * row, it just stops being tappable.
 *
 * No localStorage and no badges (L6). "Have I seen this" is the entertainment
 * tile's problem; a calendar is not a queue.
 */

import { el, empty, genericCard, safeUrl } from '../lib/dom.js';
import { ctToday, addDays } from '../lib/fmt.js';

/**
 * How many rows today + tomorrow may put on the board before the rest roll
 * into "+N more".
 *
 * L6 pins this tile to the menu tiles' height, and "today and tomorrow" is
 * usually enough on its own to keep that promise — but a Saturday in
 * September is not usual, and eight rows would make this the tallest card on
 * the board. Six is about the height of a two-row button menu.
 */
const INLINE_MAX_ROWS = 6;

/** A plain object, or {} — the payload is untrusted in shape as well as text. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * The payload's days, cleaned up and with each row told whether it is a
 * continuation: [{date, label, events: [{...event, cont}]}]
 *
 * Order is the engine's, start to finish — this is where "first appearance"
 * is decided, so the pass has to run over the whole week exactly once and in
 * the order the engine published. Doing it per view would let the same fest
 * read as a first day on the board and a continuation in the sheet.
 *
 * A day whose events all fell away (junk entries, or an empty list the engine
 * emitted anyway) is dropped: a heading with nothing under it is a bug that
 * looks like a design.
 */
function planDays(data) {
  const seen = new Set();
  const out = [];

  for (const rawDay of arr(data.days)) {
    const day = obj(rawDay);
    const events = [];

    for (const rawEvent of arr(day.events)) {
      const e = obj(rawEvent);
      const title = str(e.title).trim();
      // A row with no title has nothing to say and nothing to tap; the time
      // and venue alone would read as a blank line with a date on it.
      if (!title) continue;

      // The one thing two rows of the same fest reliably share. Venue is not
      // in the key: a festival that moves from the park to Main Street on
      // Sunday is still the same festival.
      const key = title.toLowerCase();
      const cont = !!e.multi_day && seen.has(key);
      seen.add(key);

      events.push({
        title,
        time: str(e.time).trim(),
        venue: str(e.venue).trim(),
        link: str(e.link),
        source: str(e.source).trim(),
        blurb: str(e.blurb).trim(),
        cont,
      });
    }

    if (!events.length) continue;
    out.push({
      date: str(day.date),
      // The engine's own wording for the heading. No label means no heading
      // worth printing, so the date string stands in rather than a blank bar.
      label: str(day.label) || str(day.date),
      events,
    });
  }

  return out;
}

// ---------------------------------------------------------------------- rows

/** The "cont." mark a multi-day event wears on every day but its first. */
function contMark() {
  return el('span', {
    cls: 'lc-cont',
    text: 'cont.',
    attrs: { title: 'continues from an earlier day' },
  });
}

/** The dot between two parts of a row. Decoration, so it is hidden from AT. */
function sep() {
  return el('span', { cls: 'lc-sep', attrs: { 'aria-hidden': 'true' }, text: '\u00b7' });
}

/**
 * One event: `time · title · venue`, the whole row a link.
 *
 * The separator belongs to the part that FOLLOWS it, not the one before. On a
 * 375px screen a row wraps — and a dot left behind on the end of a line reads
 * as a typo, where a dot leading the wrapped line reads as a continuation.
 * It also means a row missing its time or its venue simply closes up instead
 * of printing a stray dot at one end.
 *
 * A URL `safeUrl` refuses leaves the row as a div — still readable, just
 * inert (rule 10).
 */
function eventRow(event) {
  const parts = [];
  // Every part after the first opens with the dot, so the two can never be
  // separated by a line break.
  const lead = () => (parts.length ? sep() : null);

  if (event.time) parts.push(el('span', { cls: 'lc-time' }, [lead(), el('span', { text: event.time })]));

  parts.push(
    el('span', { cls: 'lc-title' }, [
      lead(),
      el('span', { text: event.title }),
      event.cont ? contMark() : null,
    ])
  );

  if (event.venue) parts.push(el('span', { cls: 'lc-venue' }, [lead(), el('span', { text: event.venue })]));

  const safe = safeUrl(event.link);
  if (!safe) return el('div', { cls: 'lc-row' }, parts);
  return el('a', {
    cls: 'lc-row lc-row-link',
    attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' },
  }, parts);
}

/** A day group: the engine's `label` as the heading, then its rows. */
function dayGroup(day, events, { detail = false } = {}) {
  const kids = [el('div', { cls: 'lc-day-head', text: day.label })];

  for (const event of events) {
    kids.push(eventRow(event));
    // The sheet has room for the rest of what the engine sent; the board does
    // not, which is the whole reason the sheet exists.
    if (!detail) continue;
    if (event.blurb) kids.push(el('p', { cls: 'lc-blurb', text: event.blurb }));
    if (event.source) kids.push(el('p', { cls: 'lc-source', text: event.source }));
  }

  return el('div', { cls: 'lc-day' }, kids);
}

/**
 * The small ⚠︎ a stale tile wears, or null.
 *
 * `status: stale` means SOME feed errored — the tooltip is the only place the
 * reason fits without turning a calendar into an incident report. `tile.error`
 * is the Worker's word for it; the payload's own `errors[]` is the fallback,
 * because a mark with an empty tooltip explains nothing.
 */
function staleMark(tile, data) {
  if (str(tile && tile.status) !== 'stale') return null;
  const reason =
    str(tile.error).trim() ||
    arr(data.errors).filter(Boolean).map(String).join(' · ') ||
    'a calendar feed did not answer';
  return el('p', { cls: 'tile-foot lc-stale' }, [
    el('span', {
      cls: 'lc-warn',
      text: '⚠︎',
      attrs: { title: reason, 'aria-label': `feed trouble: ${reason}` },
    }),
  ]);
}

// -------------------------------------------------------------------- sheet

/** The sheet body: the whole week, blurbs and sources and all. */
function weekBody(days, tile, data) {
  return (body) => {
    const warn = staleMark(tile, data);
    if (warn) body.appendChild(warn);
    body.appendChild(el('div', { cls: 'lc lc-detail' }, days.map((d) => dayGroup(d, d.events, { detail: true }))));
  };
}

// --------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data);

  // Rule 9: nothing arrived worth laying out. The generic card prints what IS
  // there instead of this module guessing at a shape.
  if (str(tile && tile.status) === 'error') {
    genericCard(root, tile || {});
    return;
  }

  const days = planDays(data);
  const total = days.reduce((n, d) => n + d.events.length, 0);

  if (!total) {
    root.appendChild(empty('nothing on the calendars this week.'));
    const warn = staleMark(tile, data);
    if (warn) root.appendChild(warn);
    return;
  }

  // By date, not by position — see the header. `ctToday()` is a Central
  // business date and `addDays` is calendar arithmetic on the string; neither
  // parses anything (rule 7).
  const today = ctToday();
  const tomorrow = addDays(today, 1);
  const near = days.filter((d) => d.date === today || d.date === tomorrow);

  // The board's share of the week, trimmed to the tile's height budget.
  const inline = [];
  let shown = 0;
  for (const day of near) {
    if (shown >= INLINE_MAX_ROWS) break;
    const events = day.events.slice(0, INLINE_MAX_ROWS - shown);
    shown += events.length;
    inline.push({ day, events });
  }

  if (inline.length) {
    root.appendChild(
      el('div', { cls: 'lc' }, inline.map(({ day, events }) => dayGroup(day, events)))
    );
  } else {
    // Quiet today and tomorrow, but the week is not empty — say which it is,
    // and let the button carry the rest.
    root.appendChild(empty('nothing today or tomorrow.'));
  }

  const rest = total - shown;
  if (rest > 0) {
    const openPanel =
      ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
    const title = str(data.title) || 'Lake Country';
    const build = weekBody(days, tile, data);

    root.appendChild(
      el('button', {
        cls: 'lc-more',
        text: `+${rest} more`,
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            // Don't let the tap ride up into the card's Explain handler.
            e.stopPropagation();
            // No sheet to open (the test harness, an older shell): inert
            // rather than broken.
            if (!openPanel) return;
            openPanel(title, build);
          },
        },
      })
    );
  }

  const warn = staleMark(tile, data);
  if (warn) root.appendChild(warn);
}
