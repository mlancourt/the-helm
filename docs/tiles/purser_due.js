/**
 * purser_due — The Due Stack.
 *
 * Everything leaving Matt's accounts in the next 45 days, one row each,
 * soonest first, coloured by what it asks OF HIM. That last clause is the
 * whole tile.
 *
 * The producer was rebuilt on 2026-09-21. It used to scrape the Purser's
 * open-loop prose for the literal word "DUE" and publish one card for four
 * days while reporting `status: ok`; it now parses the statement ledger by
 * column name and adds a config of fixed household bills. So the payload this
 * module reads has nothing in common with the old `{card, autopay,
 * reminder_armed}` shape, and nothing here should be carried back from it.
 *
 * TONE HAS EXACTLY TWO VALUES, AND THEY ARE NOT ABOUT TIME.
 *
 *   act   manual — Matt has to do something.        warn
 *   fund  autopay — it only needs cash in the account.  ok
 *
 * That is read off `item.tone` and from nowhere else. `pay_mode` carries the
 * same information and is deliberately never branched on: one source, so the
 * face cannot disagree with itself. There is no third state for "due soon",
 * and `days_out` is NEVER coloured, bolded or badged at any value — not at 0,
 * not at 45. The number is information; a colour would be an opinion. Same
 * standing ruling as `cards.days_listed`, held here the same three ways: a
 * class scan at the DOM, a source scan over every `cls:` in the file, and a
 * scan of the tile's own stylesheet block.
 *
 * A `reminder` that has come due escalates WITHIN the act tone — a small ⏰
 * beside the dot — and never becomes a new state.
 *
 * NOTHING HERE ACTS (hard rule 6, and the Purser's charter). No pay button,
 * no mark-paid, no dismiss, no undo, no event posted. Money never moves from
 * the Helm, and this tile does not even pretend to be where it might.
 *
 * NOTHING HERE HAS AN OPINION. No runway, no days-of-cash, no "big month", no
 * "cutting it close", no count of bills unpaid. The rows are the report.
 *
 * RULE 7: `due`, `known_through`, `reminder` and `streak.since` are Central
 * 'YYYY-MM-DD' strings. `due` is already the PAY date — the day the money
 * actually leaves, which for an auto-drafted card is NOT its statement due
 * date — and it is printed, never recomputed. There is no `new Date` and no
 * `Date.parse` in this file, and a test asserts there never will be.
 *
 * RULE 10: names, `why` strings and every other snapshot string land via
 * textContent, through `el()`.
 */

import { el } from '../lib/dom.js';
import { usd, shortDate, daysOutText, ctToday } from '../lib/fmt.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A plain object, or null. An array is not one — hostile payloads send both. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** A finite number, or null. Never 0 for a missing field — this is money. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The one place a tone is chosen, and it is chosen from `item.tone`.
 *
 * Two values and a fallback for a payload that carries neither. There is no
 * branch on `days_out` and no branch on `amount` here or anywhere else in the
 * file: the moment a colour starts depending on how soon or how large a line
 * is, the tile has an opinion and the ruling is gone.
 */
function toneOf(item) {
  const t = str(item && item.tone);
  if (t === 'act') return 'act';
  if (t === 'fund') return 'fund';
  return 'none';
}

/**
 * Has a set reminder come due? Lexical comparison on two 'YYYY-MM-DD'
 * strings, which is exactly right for zero-padded ISO dates and needs no
 * parsing at all (rule 7). Anything that is not a date-only string is no
 * reminder.
 */
function reminderDue(item, today) {
  const r = str(item && item.reminder);
  if (!YMD.test(r) || !YMD.test(today)) return false;
  return r <= today;
}

// ------------------------------------------------------------------ the face

/**
 * One row. ONE row builder — a fixed bill (`kind: 'bill'`) and a card
 * (`kind: 'card'`) come through here identically, and `kind` is not branched
 * on anywhere. They are the same thing to Matt: money leaving on a date.
 *
 *   {emoji}  {name}                    {amount}
 *            {M/D} · {days out}            {dot}
 *
 * The amount appears only when the engine says it may (`amount_display`). A
 * withheld figure is withheld ENTIRELY — not blurred, not '$—', not zero.
 * `full_name` (which is where the ledger's own masked tail, "(…6543)", lives)
 * rides along as the row's title and never onto the face.
 */
function itemRow(item, today) {
  const o = obj(item) || {};
  const tone = toneOf(o);
  const amount = o.amount_display ? usd(o.amount) : '';
  const meta = [shortDate(o.due), daysOutText(o.days_out)].filter(Boolean).join('  ·  ');
  const full = str(o.full_name);

  const dot = el('span', { cls: `purser-dot purser-dot-${tone}`, attrs: { 'aria-hidden': 'true' } });

  return el('div', { cls: 'purser-row', attrs: { title: full || null } }, [
    el('span', { cls: 'purser-emoji', attrs: { 'aria-hidden': 'true' }, text: str(o.emoji) || '•' }),
    el('div', { cls: 'purser-main' }, [
      el('div', { cls: 'purser-name', text: str(o.name) || '—' }),
      // The days count wears one class, always. See the header.
      el('div', { cls: 'purser-meta' }, [el('span', { cls: 'purser-days', text: meta })]),
    ]),
    el('div', { cls: 'purser-side' }, [
      // No element at all when the figure is withheld — an empty span would
      // leave a gap that reads like a number that failed to arrive.
      amount ? el('span', { cls: 'purser-amount', text: amount }) : null,
      el('div', { cls: 'purser-marks' }, [
        // The escalation, inside the act tone: the reminder has come due, so
        // the row says so. Still `act`, still the same dot — a louder version
        // of one state, never a new one.
        reminderDue(o, today) && tone === 'act'
          ? el('span', { cls: 'purser-alarm', attrs: { 'aria-label': 'reminder due' }, text: '⏰' })
          : null,
        dot,
      ]),
    ]),
  ]);
}

/**
 * The honest line, and it is always present.
 *
 * Not decoration: a card whose next statement the Purser has not logged yet is
 * simply absent from the rows above, and this is the only thing on the tile
 * that says how far the ledger actually reaches. A missing date says so out
 * loud rather than leaving the line off, which would read as "current".
 */
function knownThroughLine(data) {
  const k = str(data.known_through);
  return el('p', { cls: 'tile-foot', text: k ? `ledger current through ${k}` : 'ledger date unknown' });
}

// ----------------------------------------------------------------- the sheet

/**
 * The totals block.
 *
 * Plainly labelled, and no commentary on the numbers — not a comparison, not a
 * share, not a verdict on whether a month is heavy. The four the engine names
 * come first in a fixed order; anything else it has grown appears after them
 * under its own key, because a number the producer publishes and the page
 * silently drops is worse than one with an ugly label (rule 9).
 */
const TOTAL_LABELS = [
  ['next_45d', 'next 45 days'],
  ['next_14d', 'next 14 days'],
  ['manual', 'manual'],
  ['auto', 'autopay'],
];

function totalsBlock(totals) {
  const t = obj(totals);
  if (!t) return null;

  const rows = [];
  const seen = new Set();
  for (const [key, label] of TOTAL_LABELS) {
    seen.add(key);
    const v = num(t[key]);
    if (v === null) continue;
    rows.push(
      el('div', { cls: 'purser-total' }, [
        el('span', { cls: 'purser-total-label', text: label }),
        el('span', { cls: 'purser-total-value', text: usd(v) }),
      ])
    );
  }
  for (const [key, raw] of Object.entries(t)) {
    if (seen.has(key)) continue;
    const v = num(raw);
    if (v === null) continue;
    rows.push(
      el('div', { cls: 'purser-total' }, [
        el('span', { cls: 'purser-total-label', text: key }),
        el('span', { cls: 'purser-total-value', text: usd(v) }),
      ])
    );
  }
  if (!rows.length) return null;
  return el('div', { cls: 'purser-totals' }, rows);
}

/** 💎 1,204 UR available. Absent when the engine has no figure — never a zero. */
function urChip(data) {
  const v = num(data.ur_available);
  if (v === null) return null;
  return el('span', { cls: 'purser-chip', text: `💎 ${v.toLocaleString('en-US')} UR available` });
}

/**
 * 🔥 14 statements · $0 interest · since 2025-04-01.
 *
 * Dropped whole when the run is zero or the engine never named a start: "0
 * statements since null" is not a streak, and printing it would invent one.
 * The date is printed verbatim (rule 7).
 */
function streakChip(streak) {
  const s = obj(streak);
  if (!s) return null;
  const n = num(s.clean_statements);
  const since = str(s.since);
  if (n === null || n === 0 || !since) return null;
  const noun = n === 1 ? 'statement' : 'statements';
  return el('span', { cls: 'purser-chip', text: `🔥 ${n} ${noun} · $0 interest · since ${since}` });
}

/**
 * The unscheduled tail: bills with no pay-day set in the config.
 *
 * Plain rows — emoji, name, amount, and the engine's own `why` verbatim. No
 * tone, because there is no date for one to be about, and no affordance to go
 * and set one: the config is the vault's, and this tile reports.
 */
function unscheduledRow(raw) {
  const o = obj(raw) || {};
  const amount = num(o.amount);
  return el('div', { cls: 'purser-uns-row' }, [
    el('span', { cls: 'purser-emoji', attrs: { 'aria-hidden': 'true' }, text: str(o.emoji) || '•' }),
    el('div', { cls: 'purser-main' }, [
      el('div', { cls: 'purser-name', text: str(o.name) || '—' }),
      el('div', { cls: 'purser-why', text: str(o.why) }),
    ]),
    amount === null ? null : el('span', { cls: 'purser-amount', text: usd(amount) }),
  ]);
}

function unscheduledSection(data) {
  const rows = arr(data.unscheduled);
  if (!rows.length) return null;
  return el('div', { cls: 'purser-sec' }, [
    el('h3', { cls: 'purser-sec-head', text: 'No pay day set' }),
    ...rows.map(unscheduledRow),
  ]);
}

/** The whole sheet, as a builder the shell calls with a body to fill. */
function sheetBody(data) {
  return (body) => {
    const chips = [urChip(data), streakChip(data.streak)].filter(Boolean);
    const parts = [
      totalsBlock(data.totals),
      chips.length ? el('div', { cls: 'purser-chips' }, chips) : null,
      unscheduledSection(data),
    ].filter(Boolean);

    for (const p of parts) body.appendChild(p);
    body.appendChild(knownThroughLine(data));
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data) || {};
  const items = arr(data.items);
  const openPanel =
    ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;

  const face = el('div', { cls: 'purser-face' });

  if (items.length) {
    const today = ctToday();
    // The order is already right — soonest first, ties by amount descending,
    // decided by the engine in Central. Re-sorting here would be the page
    // second-guessing a count it cannot make as well.
    face.appendChild(el('div', { cls: 'purser' }, items.map((i) => itemRow(i, today))));
  }

  // An empty stack is legitimate and quiet: no "all clear", no "nothing due",
  // no green tick. Absence of rows is not news, and the ledger line below is
  // the only thing worth saying about it.
  face.appendChild(knownThroughLine(data));

  if (openPanel) {
    // The whole face is the tap target, not a <button> — a button here would
    // swallow the shell's long-press-to-Explain, which every tile owes.
    const open = () => openPanel('Purser — Due', sheetBody(data));
    face.setAttribute('role', 'button');
    face.setAttribute('tabindex', '0');
    face.setAttribute('aria-label', 'Open the due stack breakdown');
    face.addEventListener('click', open);
    face.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        open();
      }
    });
    face.classList.add('purser-tappable');
  }

  root.appendChild(face);
}
