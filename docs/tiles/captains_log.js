/**
 * captains_log — the morning brief.
 *
 * Another system in Matt's vault writes this at 06:02 every morning and has
 * fired 75 straight mornings. It is the first thing he reads. The engine
 * publishes it as `tiles.captains_log`.
 *
 * THIS TILE SUMMARIZES NOTHING. The brief is written headline-first and the
 * engine has already split headline from body. There is no model here, no
 * shortening of meaning, no cleverness — the face lays out what it was handed
 * and the sheet shows the whole of it. The only judgement in this file is
 * WHICH rows fit on the board, which is the same judgement `local_events`
 * makes for the same reason: a card is not a scroll.
 *
 * EVERY STRING ARRIVES AS PLAIN TEXT. The engine has already stripped every
 * markdown token and every [[wikilink]]. There is deliberately no stripper in
 * here: `**` or `[[` reaching the DOM is a bug in the producer, and papering
 * over it on the page would hide the one place it is visible.
 *
 * WHAT IS NEVER READ, AND WHY:
 *
 *   headline_exact  an engine-internal quality flag. A `false` renders
 *                   IDENTICALLY to a `true` — no asterisk, no "(truncated)",
 *                   no different tone, no title attribute. Matt must never be
 *                   able to see it, so this file never mentions it at all and
 *                   a source scan says so.
 *   emitted         presence is the signal. A section with nothing in it
 *                   renders nothing; a section the framework skipped today
 *                   arrives in `omitted[]` and gets its one dim line there.
 *
 * COUNTS (hard point 3). `resolved: true` items are excluded from `live_count`
 * by the engine, so nothing on this tile ever counts a raw `items.length`:
 *
 *   the brief's count   `live_count`, printed as it arrived, never recomputed.
 *   a section's count   that section's LIVE items — the engine publishes no
 *                       per-section number, and counting the resolved ones
 *                       back in would put a figure on the face that
 *                       contradicts `live_count` two lines away.
 *
 * The face therefore shows live items only. Resolved ones are finished work;
 * they are in the sheet, in payload order, dimmed and struck through.
 *
 * NO BUTTONS (hard point 5). `tag` is a display chip and nothing more — there
 * is no act/defer/drop control, no build_request, and this tile files no
 * events of any kind. The face is a tappable div, not a `<button>`, so the
 * shell's long-press-to-Explain still reaches it — same pattern as
 * `purser_due` and `bets_ledger`.
 *
 * NOTHING HERE HAS AN OPINION (hard point 9, standing ruling 9/11 + 9/16). No
 * age counter, no "day 3", no "still open", no urgency word the tile invents.
 * The brief says all of that in its own words when it means it. The single
 * exception is the not-today line, and that is not urgency — it is the tile
 * saying what it is showing, which it owes (hard point 2).
 *
 * RULE 7, THE DISQUALIFYING ONE: `brief_date` is a Central 'YYYY-MM-DD'
 * string and is NEVER handed to `new Date()`. The face label is built from
 * `weekday` and a slice of that string, both already Central and both the
 * engine's own; `shortDate()` is pure string arithmetic. There is no
 * `new Date`, no `Date.parse` and no clock in this file, and a test asserts
 * there never will be.
 *
 * RULE 10: this is the longest untrusted string on the board and it quotes
 * real email text. Every headline, body, title and footer lands via
 * textContent, through `el()`.
 */

import { el, empty } from '../lib/dom.js';
import { shortDate } from '../lib/fmt.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A plain object, or null. An array is not one — hostile payloads send both. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** How many radar-shaped rows the board gets before the rest roll into "+ N more". */
const FACE_ROWS = 3;

/**
 * The live items of a section, in payload order.
 *
 * `resolved` is the engine's word for "this one is done", and the engine has
 * already sorted those last and already left them out of `live_count`. The
 * face follows it on both counts; the sheet shows them all.
 */
function liveItems(section) {
  return arr(section && section.items).map(obj).filter((i) => i && i.resolved !== true);
}

/** Does anything in this section carry a tag? Then the section wears the chip. */
function hasTag(section) {
  return arr(section && section.items).some((i) => {
    const o = obj(i);
    return !!o && str(o.tag) !== '';
  });
}

/**
 * The brief shown is not today's.
 *
 * Two signals, either of which is the engine saying the same thing, and
 * either is enough: `status: "stale"` on the tile, or `is_today: false` in
 * the payload. Taking the union is the safe direction — a brief written in
 * today-tense and shown as today's when it is yesterday's is worse than an
 * empty tile, so a false positive costs a grey line and a false negative
 * costs Matt his morning.
 */
function notToday(tile, data) {
  return str(tile && tile.status) === 'stale' || data.is_today === false;
}

// ------------------------------------------------------------------ the face

/**
 * 'Mon 9/21 · 06:11'.
 *
 * Both halves are the engine's, both already Central, and neither is parsed:
 * the weekday is the first three characters of `weekday`, the date is
 * `shortDate()` splitting the 'YYYY-MM-DD' string on '-', and the clock is
 * the first token of `generated_at_ct`. That last one drops the zone tag for
 * width on a phone; the sheet prints `generated_at_ct` whole. A slice of a
 * given string, never a reformat of a parsed instant (rule 7).
 */
function stampText(data) {
  const wd = str(data.weekday).slice(0, 3);
  const day = [wd, shortDate(str(data.brief_date))].filter(Boolean).join(' ');
  const clock = str(data.generated_at_ct).trim().split(/\s+/)[0] || '';
  return [day, clock].filter(Boolean).join(' · ');
}

/** Hard point 2: the face carries its own date, and says the date is not today's. */
function notTodayLine(data) {
  const when = [str(data.weekday), str(data.brief_date)].filter(Boolean).join(' ');
  return el('div', { cls: 'clog-not-today' }, [
    el('span', { cls: 'clog-not-today-mark', attrs: { 'aria-hidden': 'true' }, text: '⚠︎' }),
    el('span', { text: when ? `${when} — not today's brief` : "not today's brief" }),
  ]);
}

/**
 * One row.
 *
 * `clamp` is the whole difference between the two kinds. A note is one of at
 * most two and it is the point of the brief, so its headline runs to as many
 * lines as it needs. A radar item is a glance, so it gets two lines and an
 * ellipsis — the rest of it is one tap away and never lost.
 *
 * The emoji span is always drawn, even when the payload has none, so the
 * headlines line up down the card. It is `aria-hidden`: the headline beside
 * it already carries the meaning, and a screen reader announcing "anchor" is
 * noise. Two glyphs is a legitimate value and fits — the slot is a minimum,
 * not a clip.
 */
function itemRow(item, clamp) {
  const o = obj(item) || {};
  return el('div', { cls: 'clog-item' }, [
    el('span', { cls: 'clog-emoji', attrs: { 'aria-hidden': 'true' }, text: str(o.emoji) }),
    el('div', {
      cls: clamp ? 'clog-headline clog-clamp' : 'clog-headline',
      text: str(o.headline),
    }),
  ]);
}

/**
 * A section on the face: its own title, its live count, and the act chip.
 *
 * `kind: 'note'` lays out unclamped and uncapped. EVERYTHING ELSE — radar, and
 * any `id`/`kind` the framework grows next week (hard point 8) — lays out as
 * the capped, clamped rows, because an unknown section could be any length and
 * a board that a new section can take over is a board that needs a deploy the
 * morning the framework self-tunes. The section still renders under its own
 * `title`, whatever that title is.
 */
function faceSection(section) {
  const s = obj(section) || {};
  const live = liveItems(s);
  // No rows, no heading. An empty section is not news, and a bare title with
  // nothing under it reads like a tile that failed.
  if (!live.length) return null;

  const isNote = str(s.kind) === 'note';
  const shown = isNote ? live : live.slice(0, FACE_ROWS);
  const hidden = live.length - shown.length;

  const marks = [el('span', { cls: 'clog-count', text: String(live.length) })];
  // Literal, per the contract: the section holds something tagged. The tag
  // itself — act / defer / drop — is shown per item in the sheet.
  if (hasTag(s)) marks.push(el('span', { cls: 'clog-act', text: 'act' }));

  return el('div', { cls: 'clog-sec' }, [
    el('div', { cls: 'clog-sec-head' }, [
      el('h3', { cls: 'clog-sec-title', text: str(s.title) || str(s.id) || 'Section' }),
      el('div', { cls: 'clog-sec-marks' }, marks),
    ]),
    el('div', { cls: 'clog-items' }, shown.map((i) => itemRow(i, !isNote))),
    // Not a button and not its own tap target: the whole face already opens
    // the sheet, and a nested control inside it would only give the same
    // gesture two owners.
    hidden > 0 ? el('div', { cls: 'clog-more', text: `+ ${hidden} more →` }) : null,
  ]);
}

/** One dim line per section the framework did not emit today. */
function omittedLine(entry) {
  const o = obj(entry) || {};
  const name = str(o.title) || str(o.id);
  return el('div', { cls: 'clog-omitted', text: `${name || 'Section'} — omitted today` });
}

// ----------------------------------------------------------------- the sheet

/**
 * '06:11 CDT · v2.9 · scheduled · 7 items'.
 *
 * `live_count` printed exactly as the engine published it (hard point 3).
 * Nothing here adds anything up: hand this tile a payload whose `live_count`
 * disagrees with its own item arrays and it prints the engine's number, which
 * is the only way a disagreement is ever visible.
 */
function metaLine(data) {
  const count = Number(data.live_count);
  const bits = [
    str(data.generated_at_ct),
    str(data.framework_version),
    str(data.run_mode),
    Number.isFinite(count) ? `${count} ${count === 1 ? 'item' : 'items'}` : '',
  ].filter(Boolean);
  if (!bits.length) return null;
  return el('p', { cls: 'clog-meta', text: bits.join(' · ') });
}

/**
 * One full entry: ordinal, headline, body, tag.
 *
 * A resolved item is dimmed and struck through where it sits — the engine has
 * already sorted those last and the payload order is preserved exactly, never
 * re-sorted here.
 *
 * `body` may legitimately be '' and then no element is drawn at all: an empty
 * paragraph would leave a gap that reads like text that failed to arrive.
 */
function sheetEntry(item) {
  const o = obj(item) || {};
  const ord = str(o.ordinal);
  const body = str(o.body);
  const tag = str(o.tag);
  const resolved = o.resolved === true;

  return el('div', { cls: resolved ? 'clog-entry clog-entry-resolved' : 'clog-entry' }, [
    el('div', { cls: 'clog-entry-head' }, [
      el('span', { cls: 'clog-emoji', attrs: { 'aria-hidden': 'true' }, text: str(o.emoji) }),
      el('div', { cls: 'clog-entry-title' }, [
        ord ? el('span', { cls: 'clog-ord', text: ord }) : null,
        el('span', { cls: 'clog-entry-headline', text: str(o.headline) }),
      ]),
    ]),
    body ? el('p', { cls: 'clog-entry-body', text: body }) : null,
    tag ? el('span', { cls: 'clog-tag', text: tag }) : null,
  ]);
}

function sheetSection(section) {
  const s = obj(section) || {};
  const items = arr(s.items);
  if (!items.length) return null;
  return el('div', { cls: 'clog-sheet-sec' }, [
    el('h3', { cls: 'clog-sec-title', text: str(s.title) || str(s.id) || 'Section' }),
    ...items.map(sheetEntry),
  ]);
}

/**
 * The whole brief, in payload order, nothing hidden and nothing collapsed.
 *
 * No search, no filters. It is about 7 KB of text and it scrolls, which is
 * what a brief does on paper too.
 */
function sheetBody(data) {
  return (body) => {
    const parts = [
      metaLine(data),
      ...arr(data.sections).map(sheetSection),
      ...arr(data.omitted).map(omittedLine),
    ].filter(Boolean);
    for (const p of parts) body.appendChild(p);

    // The footer is the brief's OWN bookkeeping, not an item of it — so it
    // comes last, under a rule, small and dim, and it never appears on the
    // face. `source` is the vault path, last of all and monospace, because it
    // is a path and reads as one.
    const footer = str(data.footer);
    const source = str(data.source);
    if (footer || source) {
      body.appendChild(
        el('div', { cls: 'clog-footer' }, [
          footer ? el('p', { cls: 'clog-footer-text', text: footer }) : null,
          source ? el('p', { cls: 'clog-source', text: source }) : null,
        ])
      );
    }
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data) || {};
  const openPanel =
    ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;

  const stale = notToday(tile, data);
  const face = el('div', { cls: stale ? 'clog-face clog-face-stale' : 'clog-face' });

  const stamp = stampText(data);
  if (stamp) face.appendChild(el('div', { cls: 'clog-stamp', text: stamp }));
  if (stale) face.appendChild(notTodayLine(data));

  // Payload order throughout. The framework decides what leads the brief and
  // the page does not get a vote.
  for (const s of arr(data.sections)) {
    const node = faceSection(s);
    if (node) face.appendChild(node);
  }
  for (const o of arr(data.omitted)) face.appendChild(omittedLine(o));

  // Nothing arrived at all — the 06:02 fire did not happen, or the payload is
  // a shape this module cannot lay out. The shell has already printed the
  // engine's own `error` above this, so the card says the one thing left to
  // say rather than standing empty and looking like a tile that crashed.
  if (!face.childNodes.length) face.appendChild(empty('No brief.'));

  if (openPanel) {
    const title = [str(data.weekday), str(data.brief_date)].filter(Boolean).join(' ');
    const open = () => openPanel(title ? `Captain's Log — ${title}` : "Captain's Log", sheetBody(data));
    face.setAttribute('role', 'button');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', "Open the full Captain's Log");
    face.addEventListener('click', open);
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    face.classList.add('clog-tappable');
  }

  root.appendChild(face);
}
