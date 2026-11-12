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
 *
 * v1.49.0 — HIS NOTES AND MONEY OUT (vault spec `Purser-Money-Desk-Tile-Spec`,
 * PM1–PM8). Two additive keys, and the due stack itself does not change:
 *
 *   heads_up   the Purser's own notes for TODAY, as he wrote them. P7 as
 *              amended by PM2: the tile still has no opinion — it prints his.
 *              Up to three headlines on the face (+N more inside the same tap
 *              target), the whole of each in the sheet. An urgent note wears
 *              the act tone on its mark (PM5); a file the engine could not
 *              read says so in the act tone (PM6). `null`, or `notes: []` with
 *              no `problem`, draws nothing at all — no "no notes" line, no
 *              count, no badge.
 *   money_out  the bank feed's own sum for yesterday: label, amount, count.
 *              It carries its own date, so a stale feed shows an old date
 *              rather than a wrong number; `fresh: false` mutes the row. Its
 *              `through_label` is the second freshness line (PM4), under the
 *              ledger's own.
 *
 * PM8: every number and every label is the engine's. `out_total` goes through
 * `usd()` only when it is a real number (never `$NaN`, never `$0.00` for a
 * missing one); the labels print verbatim. Every string — headline, body,
 * evidence (merchant names off a bank feed), kind, problem — is untrusted and
 * lands through textContent (PM7). Still no buttons, no events, no posts.
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

// ---------------------------------------------- the Purser's notes (PM1–PM7)
//
// Everything in this region reads `heads_up`, and nothing outside it does.
// The note's `kind` is a word the Purser chose; it is printed on a quiet chip
// in the sheet and branched on nowhere.

const FACE_NOTES = 3;

/** A snapshot value as display text: strings and finite numbers, else ''. */
function words(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** The heads_up block's notes, as objects; anything else vanishes. */
function notesOf(data) {
  const hu = obj(data.heads_up);
  return hu ? arr(hu.notes).map(obj).filter(Boolean) : [];
}

/**
 * The mark: the act tone when the Purser said urgent, quiet otherwise. Two
 * literal class sets, picked by a statement — PM5 allows no third tone, and
 * the urgent one is the act dot's own token (the stylesheet test compares).
 */
function noteMark(note) {
  if (note.urgent === true) {
    return el('span', { cls: 'purser-note-mark purser-note-mark-urgent', attrs: { 'aria-label': 'urgent' } });
  }
  return el('span', { cls: 'purser-note-mark', attrs: { 'aria-hidden': 'true' } });
}

/** Face: up to three headlines, in the engine's order, then a quiet "+N more". */
function notesFace(data) {
  const notes = notesOf(data);
  if (!notes.length) return null;
  const rows = notes.slice(0, FACE_NOTES).map((n) =>
    el('div', { cls: 'purser-note' }, [noteMark(n), el('span', { cls: 'purser-note-head', text: words(n.headline) || '—' })])
  );
  const more = notes.length - FACE_NOTES;
  // Text inside the face, which is already the tap target — not a control.
  if (more > 0) rows.push(el('div', { cls: 'purser-note-more', text: `+${more} more` }));
  return el('div', { cls: 'purser-notes' }, rows);
}

/** PM6: a file the engine could not read says so, in the act tone. */
function problemRow(data) {
  const hu = obj(data.heads_up);
  const text = hu ? words(hu.problem) : '';
  if (!text) return null;
  return el('p', { cls: 'purser-problem', text });
}

/** Sheet: headline, the kind chip, the body, then the evidence lines, faint. */
function noteSheetRow(note) {
  const kind = words(note.kind);
  const evidence = arr(note.evidence).map(words).filter(Boolean);
  return el('div', { cls: 'purser-from-note' }, [
    el('div', { cls: 'purser-from-top' }, [
      noteMark(note),
      el('span', { cls: 'purser-from-head', text: words(note.headline) || '—' }),
      kind ? el('span', { cls: 'purser-note-kind', text: kind }) : null,
    ]),
    words(note.body) ? el('p', { cls: 'purser-from-body', text: words(note.body) }) : null,
    ...evidence.map((e) => el('div', { cls: 'purser-from-evidence', text: e })),
  ]);
}

/** The sheet's first section, drawn only when there are notes. */
function notesSheet(data) {
  const notes = notesOf(data);
  if (!notes.length) return null;
  const label = words(obj(data.heads_up).label);
  return el('div', { cls: 'purser-from' }, [
    el('h3', { cls: 'purser-sec-head', text: label ? `From the Purser · ${label}` : 'From the Purser' }),
    ...notes.map(noteSheetRow),
  ]);
}

// ------------------------------------------------------ money out (PM3/PM4)

/** A real number or null — strictly: a string, a boolean or NaN is not money. */
function money(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * `Money out Wed 11/11 · $269.45 · 10 charges (2 pending)`.
 *
 * The amount is the engine's sum, formatted and nothing more; a missing or
 * non-numeric one leaves no element behind. `fresh: false` mutes the whole
 * row — the date on it already says how old it is.
 */
function moneyOutRow(data) {
  const mo = obj(data.money_out);
  if (!mo) return null;
  const label = words(mo.label);
  const amount = money(mo.out_total);
  const count = money(mo.count);
  const pending = money(mo.pending_count);
  if (!label && amount === null && count === null) return null;

  const charges = count === null ? '' : `${count} ${count === 1 ? 'charge' : 'charges'}`;
  const row = el('div', { cls: 'purser-out' }, [
    el('span', { cls: 'purser-out-label', text: label ? `Money out ${label}` : 'Money out' }),
    amount === null ? null : el('span', { cls: 'purser-out-amount', text: usd(amount) }),
    charges
      ? el('span', { cls: 'purser-out-count', text: pending !== null && pending > 0 ? `${charges} (${pending} pending)` : charges })
      : null,
  ]);
  if (mo.fresh === false) row.classList.add('purser-out-old');
  return row;
}

/** PM4: the bank feed's clock, under the ledger's. Only with a label to print. */
function feedThroughLine(data) {
  const mo = obj(data.money_out);
  const through = mo ? words(mo.through_label) : '';
  if (!through) return null;
  return el('p', { cls: 'tile-foot', text: `bank feed through ${through}` });
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
      // PM: his notes lead, and only when there are any; the sheet as it
      // always was follows, with the money-out row beside the totals.
      notesSheet(data),
      totalsBlock(data.totals),
      moneyOutRow(data),
      chips.length ? el('div', { cls: 'purser-chips' }, chips) : null,
      unscheduledSection(data),
    ].filter(Boolean);

    for (const p of parts) body.appendChild(p);
    body.appendChild(knownThroughLine(data));
    const feedLine = feedThroughLine(data);
    if (feedLine) body.appendChild(feedLine);
  };
}

// ---------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile && tile.data) || {};
  const items = arr(data.items);
  const openPanel =
    ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;

  const face = el('div', { cls: 'purser-face' });

  // PM1/PM6 — his notes, then a file the engine could not read. Both draw
  // nothing when there is nothing to say.
  const notes = notesFace(data);
  if (notes) face.appendChild(notes);
  const problem = problemRow(data);
  if (problem) face.appendChild(problem);

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
  // PM3 — yesterday's money out sits under the stack, above the two clocks.
  const out = moneyOutRow(data);
  if (out) face.appendChild(out);
  face.appendChild(knownThroughLine(data));
  // PM4 — the bank feed's clock, under the ledger's.
  const feedLine = feedThroughLine(data);
  if (feedLine) face.appendChild(feedLine);

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
