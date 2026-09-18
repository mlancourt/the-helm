/**
 * wss_tape — "Crew Tape". The day's applied updates to the WSS Fleet Tracker,
 * newest first: who did what, in order.
 *
 * Spec: 06-AI-Stack/The-Helm/Crew-Tape-Tile-Spec.md, rulings T1–T7 (T7 is the
 * page ruling this file implements).
 *
 * THE TAPE, NOT THE BOARD. The tracker is the board; this is the diff. So the
 * tile answers one question — "what is everyone up to" — and answers it twice
 * over: the actor chips across the top ARE the glance, and the rows under them
 * are that glance spelled out. Nothing here is a work queue, which is why the
 * module has no badges, no counters and no memory (T7). A day's tape is read
 * once and replaced tomorrow.
 *
 * THE DIVISION OF LABOUR. The Fleet engine parses the run reports, filters to
 * applied `✅` lines only (T3/T4), strips dollar figures (T5), resolves ids to
 * customer names against the tracker's own snapshot (T2), and hands this
 * module a list that is already in order, newest first (T6). There is no
 * sorting, no filtering and no date arithmetic in here. The only judgement
 * this file makes is how many rows fit on the board.
 *
 * ACCENTS. Every actor gets a colour, and it is the SAME colour on the chip
 * and on every row that actor touched — that is what turns four names into a
 * shape you can read at arm's length. The colour is a pure hash of the name,
 * so it is stable across renders, across days and across devices without a
 * byte of state: no assignment table to keep, and a crew member who appears
 * for the first time on a Tuesday still lands on the colour they will have
 * next month.
 *
 * RULE 7: `time_ct` ("14:57") and `date` are Central strings the engine
 * already rendered. They are printed exactly as they arrived. The ISO `ts` on
 * each item is the engine's ordering key and is never read here — nothing on
 * this tile is handed to `new Date()`.
 *
 * RULE 8: `status: error` means no run report arrived at all, so there is no
 * shape to lay out and rule 9's generic card takes over. `status: stale` is
 * not emitted today, but if it ever is, the rows are still real — they render
 * with the small ⚠︎ the other tiles use.
 *
 * RULE 10: every actor, id, customer name and summary lands via textContent.
 * The tape carries free text off a vault file; it is data, never markup.
 */

import { el, empty, genericCard } from '../lib/dom.js';

/**
 * How many rows reach the board before the rest roll into "+N more" (T7, as
 * amended).
 *
 * This is the tile's height budget, and eight rows overspent it: at 375px a
 * row almost always takes two lines — `time · actor · id who` does not leave
 * room for the summary beside it — so eight events made this the tallest card
 * on the board by some distance. Five keeps the card in the same band as the
 * menu tiles beside it. Nothing is lost: everything past the fifth row is in
 * the sheet, and the button says how much.
 */
const INLINE_MAX_ROWS = 5;

/**
 * The engine promises a summary of 140 characters or less. This is the guard
 * for the day it does not: the board is a fixed-height card, and one runaway
 * line would push every tile below it off the screen. CSS clamps the row to
 * two lines as well — this clip is the half of that promise a phone cannot
 * recover from on its own.
 */
const SUMMARY_MAX = 140;

/** How many accents the palette carries. Mirrored by .tape-a0…a5 in style.css. */
const ACCENTS = 6;

/** A plain object, or {} — the payload is untrusted in shape as well as text. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A finite number, or null — `n` and `count` arrive from a parser. */
function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * An actor's accent slot, 0…ACCENTS-1.
 *
 * A pure function of the name — see the header. Case-folded so "Mission
 * Control" and "mission control" are one person, and `>>> 0` to keep the
 * running hash an unsigned 32-bit integer rather than drifting into the
 * negatives and out of the palette.
 */
export function accentOf(name) {
  const key = str(name).trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h % ACCENTS;
}

const accentClass = (name) => `tape-a${accentOf(name)}`;

/**
 * The payload's items, cleaned up: [{time, actor, id, unit, who, summary}]
 *
 * Order is the engine's, untouched (T6). A row with neither an id nor a
 * summary has nothing to say — it would render as a timestamp on an empty
 * line, which reads as a bug rather than as an event — so it is dropped.
 */
function planItems(data) {
  const out = [];
  for (const raw of arr(data.items)) {
    const item = obj(raw);
    const id = str(item.id).trim();
    let summary = str(item.summary).trim();
    if (!id && !summary) continue;
    if (summary.length > SUMMARY_MAX) summary = `${summary.slice(0, SUMMARY_MAX - 1)}…`;

    out.push({
      time: str(item.time_ct).trim(),
      actor: str(item.actor).trim(),
      id,
      // Only ever set when a ticket event also names a serial.
      unit: str(item.unit).trim(),
      // Empty for a closed ticket or a retired unit — the id then stands alone.
      who: str(item.who).trim(),
      summary,
    });
  }
  return out;
}

/** The header chips: [{name, n}], in the engine's order (already n desc, then name). */
function planChips(data) {
  const out = [];
  for (const raw of arr(data.by_actor)) {
    const entry = obj(raw);
    const name = str(entry.name).trim();
    if (!name) continue;
    out.push({ name, n: num(entry.n) });
  }
  return out;
}

// -------------------------------------------------------------------- parts

/** The dot between two parts of a row. Decoration, so it is hidden from AT. */
function sep() {
  return el('span', { cls: 'tape-sep', attrs: { 'aria-hidden': 'true' }, text: '·' });
}

/**
 * One actor chip: `Josh 5`, in that actor's accent.
 *
 * The count is a separate span so it can be dimmed and tabular without the
 * name changing weight, and a literal space between them keeps the chip
 * readable when it is flattened to text (a screen reader, a copy-paste).
 */
function actorChip(chip) {
  return el('span', { cls: `tape-chip ${accentClass(chip.name)}` }, [
    el('span', { cls: 'tape-chip-name', text: chip.name }),
    chip.n === null ? null : ' ',
    chip.n === null ? null : el('span', { cls: 'tape-chip-n', text: String(chip.n) }),
  ]);
}

/** The chip row — the glance (T7). Null when the day has no actors in it. */
function chipRow(chips) {
  if (!chips.length) return null;
  return el('div', { cls: 'tape-chips' }, chips.map(actorChip));
}

/**
 * One event: `time · actor · id who · summary`.
 *
 * As on the Lake Country rows, the separator belongs to the part that FOLLOWS
 * it: on a 375px screen these wrap, and a dot left at the end of a line reads
 * as a typo where a dot leading the next line reads as a continuation. It also
 * means a row missing its time or its actor simply closes up.
 *
 * `id who` is one unit — the id and the customer it belongs to never want to
 * be split across a line break from each other, and the unit serial hangs off
 * the id as a small mono suffix.
 */
function tapeRow(item) {
  const parts = [];
  const lead = () => (parts.length ? sep() : null);

  if (item.time) parts.push(el('span', { cls: 'tape-time' }, [lead(), el('span', { text: item.time })]));
  if (item.actor) {
    parts.push(
      el('span', { cls: `tape-actor ${accentClass(item.actor)}` }, [lead(), el('span', { text: item.actor })])
    );
  }

  if (item.id || item.who) {
    parts.push(
      el('span', { cls: 'tape-what' }, [
        lead(),
        item.id ? el('span', { cls: 'tape-id', text: item.id }) : null,
        item.unit ? el('span', { cls: 'tape-unit', text: item.unit }) : null,
        item.who ? el('span', { cls: 'tape-who', text: item.who }) : null,
      ])
    );
  }

  if (item.summary) parts.push(el('span', { cls: 'tape-summary' }, [lead(), el('span', { text: item.summary })]));

  return el('div', { cls: 'tape-row' }, parts);
}

/**
 * Yesterday in one muted line: `yesterday: 18 · Matt 12 · Josh 2` (T7).
 *
 * Only ever shown on a day with nothing on it yet — it is there so an empty
 * tile still says something true about the crew rather than reading as a
 * broken feed. No line at all when yesterday was quiet too.
 */
function yesterdayLine(data) {
  const y = obj(data.yesterday);
  const count = num(y.count);
  if (!count) return null;

  const parts = [`yesterday: ${count}`];
  for (const chip of planChips(y)) parts.push(chip.n === null ? chip.name : `${chip.name} ${chip.n}`);
  return el('p', { cls: 'tile-foot tape-yesterday', text: parts.join(' · ') });
}

/**
 * The freshness footer: `as of 16:38 CT`, muted (T7).
 *
 * `last_fleet_run_ct` is a Central clock string from the engine, printed
 * verbatim. Null until the mini runs both engines on one schedule, and a
 * footer that says "as of null" is worse than no footer, so it is omitted
 * entirely rather than filled in with a guess.
 */
function runFooter(data) {
  const at = str(data.last_fleet_run_ct).trim();
  if (!at) return null;
  return el('p', { cls: 'tile-foot tape-asof', text: `as of ${at} CT` });
}

/**
 * The small ⚠︎ a stale tile wears, or null.
 *
 * The engine does not emit `stale` on this tile today. If it ever does, the
 * rows are still applied events and still true — so they render, and the mark
 * carries the reason in its tooltip, exactly as on the other tiles.
 */
function staleMark(tile) {
  if (str(tile && tile.status) !== 'stale') return null;
  const reason = str(tile && tile.error).trim() || 'the fleet run report was incomplete';
  return el('p', { cls: 'tile-foot tape-stale' }, [
    el('span', {
      cls: 'tape-warn',
      text: '⚠︎',
      attrs: { title: reason, 'aria-label': `run trouble: ${reason}` },
    }),
  ]);
}

// --------------------------------------------------------------------- sheet

/** The sheet body: the same chips, then the whole day's tape. */
function dayBody(chips, items, tile) {
  return (body) => {
    const warn = staleMark(tile);
    if (warn) body.appendChild(warn);
    const kids = [chipRow(chips), el('div', { cls: 'tape-rows' }, items.map(tapeRow))];
    body.appendChild(el('div', { cls: 'tape tape-detail' }, kids));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data);

  // Rule 9: no report file at all (T7). The generic card prints what IS there
  // rather than this module inventing a shape for a payload that never came.
  if (str(tile && tile.status) === 'error') {
    genericCard(root, tile || {});
    return;
  }

  const items = planItems(data);
  const chips = planChips(data);

  // Nothing applied yet today. Not an error and not an empty feed — the crew
  // simply has not pushed anything, which is itself worth saying plainly.
  if (!items.length) {
    root.appendChild(empty('quiet so far'));
    const yesterday = yesterdayLine(data);
    if (yesterday) root.appendChild(yesterday);
    const quietFoot = runFooter(data);
    if (quietFoot) root.appendChild(quietFoot);
    const quietWarn = staleMark(tile);
    if (quietWarn) root.appendChild(quietWarn);
    return;
  }

  const inline = items.slice(0, INLINE_MAX_ROWS);
  const chipsEl = chipRow(chips);
  root.appendChild(
    el('div', { cls: 'tape' }, [chipsEl, el('div', { cls: 'tape-rows' }, inline.map(tapeRow))])
  );

  const rest = items.length - inline.length;
  if (rest > 0) {
    const openPanel =
      ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;
    const title = str(data.title) || 'Crew Tape';
    const build = dayBody(chips, items, tile);

    root.appendChild(
      el('button', {
        cls: 'tape-more',
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

  const foot = runFooter(data);
  if (foot) root.appendChild(foot);
  const warn = staleMark(tile);
  if (warn) root.appendChild(warn);
}
