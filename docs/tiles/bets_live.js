/**
 * bets_live — the marquee tile.
 *
 * Published DAILY, graded LIVE in the browser: the snapshot supplies the
 * tickets and the numbers, `ctx.live` supplies the games and the grades, and
 * every pill on the board moves on the band's 45-second tick.
 *
 * WORDING RULE (non-negotiable): this tile says *lean*, never *settled*. A
 * different system settles bets. This page is the scoreboard's opinion, and
 * the footer says so under every board.
 *
 * v1.6.0 — the facelift (vault spec `Bets-Live-Tile-Spec.md`, rulings B1–B9).
 *
 * WHO DOES THE ARITHMETIC (B4, and it is the whole design). The Bookie logs
 * the price and publishes `ticket.to_win_u` — units returned on a winner, from
 * the logged American price. The page does NO odds math: there is no payout
 * helper in this codebase any more. That is not fastidiousness. The Bet-Log is
 * what Matt reads this board against, and two implementations of the same sum
 * eventually disagree by a cent and then the board is the thing he stops
 * trusting.
 *
 * ONE NUMBER PER ROW, SUMMED IN THE HEADER (B5). `ticketUnits()` decides what
 * a ticket is worth right now, the row prints it, and "lean now" is the sum of
 * exactly those values. Header and rows reconcile by construction rather than
 * by two functions that agree today — a test asserts it on a mixed board.
 *
 * A ticket with no `to_win_u` (the Bookie could not parse a price) shows its
 * plain stake in every state and contributes ZERO in either direction. Half a
 * figure is worse than none: a −0.50u in the header that no row accounts for
 * would make the sum look broken, which is the one thing the design above is
 * for.
 *
 * FORM IS THE ENGINE'S, ENTIRELY (B1/B6). `data.form` is built from the
 * Bookie's § Settled rows — W/L only, voids and pushes excluded. The page's
 * own live leans never feed it, because the tile leans and the Bookie settles.
 * Nothing in here recomputes a record, a streak or a percentage; `form` is
 * rendered and nothing else, and when it is null the line simply does not
 * exist.
 *
 * LAST CARD (B10). `form.last_card` is the most recent settled card, off the
 * Bookie's `State/Settled.csv` — the morning report in one line, and every
 * ticket on it one tap away. Every figure on it is the engine's: the record,
 * the net and each row's units are printed as given, the page adds nothing up
 * and checks nothing against anything. It carries no staleness logic either:
 * it is always *the last card*, and its own date says which one.
 *
 * RULE 7: `kick_ct` is a Central wall-clock string in two spellings ('15:25'
 * from the mock, '6:05 PM' from the engine) and is printed by `ctKick()` as
 * text. Ordering needs it as a number, which `kickKey()` gets from the parts —
 * nothing here is handed `new Date(string)`.
 *
 * RULE 10: labels, team names, the sport emoji and every grader `why` land via
 * textContent. ESPN text is untrusted exactly like snapshot text is.
 */

import { el, pill, empty } from '../lib/dom.js';
// The streak chip is shared with `bets_ledger` — see lib/bets.js.
import { streakChip } from '../lib/bets.js';
import {
  units,
  exactUnits,
  signedUnits,
  odds,
  line,
  ctKick,
  ctTime,
  kickDate,
  kickKey,
  dayLabel,
  ctToday,
  shortDay,
} from '../lib/fmt.js';

/** grader state -> [pill label, tone]. The graders carry their own label too. */
const STATE_PILL = {
  pre: ['PRE', 'neutral'],
  lead: ['LEADING', 'good'],
  trail: ['TRAILING', 'warn'],
  even: ['TIED', 'neutral'],
  win: ['WIN', 'win'],
  lose: ['LOSS', 'bad'],
  push: ['PUSH', 'neutral'],
  dead: ['DEAD', 'dead'],
  unsupported: ['N/A', 'na'],
};

/**
 * How good a state is, for deciding which way a pill just moved (B8).
 *
 * Only the sign of the difference is used, so the exact numbers do not matter
 * — what matters is that `lead -> win` reads as upward and `lead -> even` does
 * not read as anything at all.
 */
const DIRECTION = {
  win: 2,
  lead: 1,
  pre: 0,
  push: 0,
  even: 0,
  unsupported: 0,
  trail: -1,
  lose: -2,
  dead: -2,
};

/**
 * ticket id -> the state it was rendered with last pass.
 *
 * Module memory, deliberately (B8): a pulse is a thing that happens between
 * two passes of one session. Persisting it would mean a phone unlocked hours
 * later flashing green at a bet that turned in the meantime — a notification,
 * which this tile is not. Nothing here is written to storage.
 */
const lastStates = new Map();

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A finite number, or null. Never 0 for a missing field — these are units. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------- the per-ticket sum

/**
 * What one ticket is worth right now: `{value, text, tone}` (B4).
 *
 * `value` is what the header adds up and `text` is what the row prints, from
 * one decision — see the header note. `tone` picks the colour: green for a
 * lean toward the money, red away from it, grey for a ticket that is not
 * saying anything yet.
 */
export function ticketUnits(ticket, grade) {
  const stake = num(ticket && ticket.stake_u);
  const toWin = num(ticket && ticket.to_win_u);
  const state = (grade && grade.state) || 'pre';
  const idle = { value: 0, text: stake === null ? '—' : exactUnits(stake), tone: 'idle' };

  // No price parsed upstream, so there is no honest return to show. The stake
  // stands in, in every state, and the ticket leans nowhere (B4).
  if (toWin === null) return idle;

  if (state === 'lead' || state === 'win') {
    return { value: toWin, text: signedUnits(toWin), tone: 'good' };
  }
  if (state === 'trail' || state === 'lose' || state === 'dead') {
    if (stake === null) return idle;
    return { value: -stake, text: signedUnits(-stake), tone: 'bad' };
  }
  // A push and a tie are both worth exactly nothing, and say so as a figure
  // rather than as a blank — 0.00u is a number, an empty cell is a bug.
  if (state === 'push' || state === 'even') {
    return { value: 0, text: '0.00u', tone: 'flat' };
  }
  // pre, unsupported: nothing decided, nothing risked yet on the screen.
  return idle;
}

/**
 * Net units if every current lean held — the signed sum of the rows (B5).
 *
 * `null` only when there is no grader running at all: an ungraded board leans
 * nowhere and must say "—" rather than a confident 0.00u. Once the band is up,
 * a board of PRE tickets genuinely does lean nowhere, and 0.00u is the truth.
 */
function leanUnits(tickets, grades) {
  if (!grades) return null;
  let net = 0;
  for (const t of tickets) net += ticketUnits(t, grades.get(t.id)).value;
  return net;
}

/**
 * The same sum, over games ESPN reports as final.
 *
 * Still a lean — the book settles, not this page — but the game is over, so
 * it is worth telling apart from the part of the board that can still move.
 */
function closedUnits(tickets, grades, games) {
  if (!games || !grades) return null;
  let net = 0;
  let any = false;
  for (const t of tickets) {
    const game = games.get(String(t.espn_event_id));
    if (!game || game.state !== 'post') continue;
    any = true;
    net += ticketUnits(t, grades.get(t.id)).value;
  }
  return any ? net : 0;
}

// -------------------------------------------------------------------- header

function stat(label, value, tone = '') {
  return el('div', { cls: `stat ${tone}`.trim() }, [
    el('span', { cls: 'stat-value', text: value }),
    el('span', { cls: 'stat-label', text: label }),
  ]);
}

/** A signed units stat: green above zero, red below, plain at zero or unknown. */
function signedStat(label, value) {
  if (value === null) return stat(label, '—');
  return stat(label, signedUnits(value), value > 0 ? 'good' : value < 0 ? 'bad' : '');
}

function headerStats(data, grades, games) {
  const tickets = arr(data.tickets);
  return el('div', { cls: 'bets-stats' }, [
    // B9: the bankroll is a plain number. No colour, no drawdown, no comment —
    // the Bookie's charter says scoreboard, not a leash, and so does this tile.
    stat('bankroll', units(data.bankroll_u)),
    stat('open', units(data.open_u)),
    signedStat('lean now', leanUnits(tickets, grades)),
    signedStat('closed', closedUnits(tickets, grades, games)),
    stat('record', str(data.record) || '—'),
  ]);
}

/**
 * One settled ticket as a dot. The whole row's story lives in the tooltip
 * (B6) — a form guide is read as a shape first and interrogated second.
 */
function formDot(row) {
  const won = str(row.r).toUpperCase() === 'W';
  const u = num(row.u);
  const title = [str(row.d), str(row.s), str(row.label), u === null ? '' : signedUnits(u)]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');
  return el('span', {
    cls: `form-dot form-dot-${won ? 'w' : 'l'}`,
    attrs: {
      title: title || (won ? 'won' : 'lost'),
      // The dot is a colour; a screen reader needs the word.
      'aria-label': `${won ? 'won' : 'lost'}${title ? ` — ${title}` : ''}`,
    },
  });
}

/** The 10-dot strip, newest left — the engine's order, untouched. */
function formStrip(last) {
  const rows = arr(last).filter((x) => x && typeof x === 'object');
  if (!rows.length) return null;
  return el(
    'div',
    { cls: 'form-strip', attrs: { 'aria-label': 'last settled tickets, newest first' } },
    rows.slice(0, 10).map(formDot)
  );
}

/**
 * `7d 14-9 · +4.71u · 61%` plus the streak chip and the strip (B1/B6).
 *
 * Every figure is `form`'s own. When `form` is null — the engine could not
 * parse § Settled — the whole line is absent rather than showing zeros, which
 * would read as a losing week rather than as a missing one.
 */
function formLine(form) {
  if (!form || typeof form !== 'object' || Array.isArray(form)) return null;

  const bits = [];
  const days = num(form.window_days);
  const record = str(form.record).trim();
  if (record) bits.push(days === null ? record : `${days}d ${record}`);
  const net = num(form.net_u);
  if (net !== null) bits.push(signedUnits(net));
  const winPct = num(form.win_pct);
  if (winPct !== null) bits.push(`${Math.round(winPct)}%`);

  const chip = streakChip(form.streak);
  const strip = formStrip(form.last);
  if (!bits.length && !chip && !strip) return null;

  return el('div', { cls: 'bets-form' }, [
    bits.length ? el('span', { cls: 'form-summary', text: bits.join('  ·  ') }) : null,
    chip,
    strip,
  ]);
}

/** A settled result -> its row tone. W and L are the only two with a sign. */
function resultTone(r) {
  const s = str(r).trim().toUpperCase();
  if (s === 'W') return 'good';
  if (s === 'L') return 'bad';
  // PUSH, VOID, NO ACTION — and anything the Bookie adds later. None of them
  // moved money, so none of them gets a colour that says it did.
  return 'flat';
}

/**
 * One ticket on the last card: sport · label · final · signed units (B10).
 *
 * `u` is printed exactly as the engine sent it. A push or a void with no `u`
 * at all still reads `0.00u` — B10 asks for the figure, and a blank cell
 * beside a settled ticket reads as a missing result rather than a null one.
 */
function lastCardRow(t) {
  const tone = resultTone(t.r);
  const u = num(t.u);
  const text = u !== null ? signedUnits(u) : tone === 'flat' ? '0.00u' : '—';
  const sport = str(t.s).trim();
  const final = str(t.final).trim();
  const result = str(t.r).trim();
  return el(
    'div',
    {
      cls: `lastcard-row lastcard-${tone}`,
      attrs: { title: [str(t.game).trim(), result].filter(Boolean).join(' · ') || null },
    },
    [
      sport ? el('span', { cls: 'lastcard-sport', attrs: { 'aria-hidden': 'true' }, text: sport }) : null,
      el('span', { cls: 'lastcard-label', text: str(t.label) || str(t.game) || 'ticket' }),
      final ? el('span', { cls: 'lastcard-final', text: final }) : null,
      el('span', { cls: `lastcard-units lastcard-units-${tone}`, text }),
    ]
  );
}

/**
 * `Last card · Thu 9/24 · 4-1 · +3.58u`, folded over the card's tickets (B10).
 *
 * A button rather than a tappable div so it is a real control to a screen
 * reader and a keyboard; the click stops at the button, so it never reaches
 * the card and a tap here is never mistaken for the start of a long-press.
 * Collapsed by default, and whether it is open lives on the node alone — the
 * next render is a fresh line, folded again, which is what a board that
 * refreshes under the reader should do.
 */
function lastCardLine(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null;

  const bits = ['Last card'];
  const date = str(card.date).trim();
  if (date) bits.push(shortDay(date));
  const record = str(card.record).trim();
  if (record) bits.push(record);
  const net = num(card.net_u);

  const rows = el(
    'div',
    { cls: 'lastcard-tickets hidden' },
    arr(card.tickets).filter((t) => t && typeof t === 'object').map(lastCardRow)
  );
  const toggle = el(
    'button',
    {
      cls: 'lastcard-toggle',
      attrs: { type: 'button', 'aria-expanded': 'false' },
      on: {
        click: (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const open = rows.classList.toggle('hidden') === false;
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        },
      },
    },
    [
      el('span', { cls: 'lastcard-summary', text: bits.join('  ·  ') }),
      net === null
        ? null
        : el('span', { cls: `lastcard-net lastcard-net-${net >= 0 ? 'good' : 'bad'}`, text: `  ·  ${signedUnits(net)}` }),
    ]
  );
  return el('div', { cls: 'bets-lastcard' }, [toggle, rows]);
}

// --------------------------------------------------------------------- rows

/**
 * One ticket row: class stripe, label, why, pill, its units figure, stake@price.
 *
 * `flip` is B8's one-shot glow — a class, not a state: the CSS animation runs
 * once and the class is never removed, because the node itself is replaced on
 * the next render.
 */
function ticketRow(ticket, grade, flip) {
  const [label, tone] = STATE_PILL[grade && grade.state] || STATE_PILL.pre;
  const cls = str(ticket.class) || 'core';
  const u = ticketUnits(ticket, grade);

  const bits = [];
  if (ticket.market) bits.push(str(ticket.market).replace(/_/g, ' '));
  if (ticket.line !== null && ticket.line !== undefined) bits.push(line(ticket.line));
  if (ticket.player) bits.push(str(ticket.player));

  return el('div', { cls: `ticket stripe-${cls}${flip}` }, [
    el('div', { cls: 'ticket-main' }, [
      el('div', { cls: 'ticket-label', text: str(ticket.label) || bits.join(' ') || 'ticket' }),
      el('div', {
        cls: 'ticket-why',
        // With no band running there is no grade, and inventing one would be a
        // lie about money. "not graded yet" is the honest pre-grader state.
        text: (grade && grade.why) || (grade ? '' : 'not graded yet'),
      }),
    ]),
    el('div', { cls: 'ticket-side' }, [
      pill((grade && grade.label) || label, tone),
      el('div', { cls: `ticket-units ticket-units-${u.tone}`, text: u.text }),
      el('div', {
        cls: 'ticket-stake',
        text: `${units(ticket.stake_u)} @ ${odds(ticket.price) || '—'}`,
      }),
    ]),
  ]);
}

/**
 * The one-shot pulse class for a ticket whose pill just moved (B8).
 *
 * A ticket seen for the first time never pulses: the first grade is not a
 * change, and a board that flashes on open is a board nobody reads.
 */
function flipClass(id, state) {
  if (!lastStates.has(id)) return '';
  const prev = lastStates.get(id);
  if (prev === state) return '';
  const delta = (DIRECTION[state] ?? 0) - (DIRECTION[prev] ?? 0);
  if (delta > 0) return ' flip-up';
  if (delta < 0) return ' flip-down';
  return '';
}

/** Remember this pass's states, and forget tickets that have left the board. */
function rememberStates(tickets, grades) {
  const seen = new Set();
  for (const t of tickets) {
    const id = String(t.id);
    seen.add(id);
    const g = grades ? grades.get(t.id) : null;
    // No grade means the band is not running for this ticket. Forgetting it is
    // what stops the first real grade from arriving as a flash.
    if (g && g.state) lastStates.set(id, g.state);
    else lastStates.delete(id);
  }
  for (const id of [...lastStates.keys()]) if (!seen.has(id)) lastStates.delete(id);
}

// -------------------------------------------------------------------- cards

/**
 * Kick time, with the day attached whenever it is not today.
 *
 * A bare "7:30 PM" on a ticket for tomorrow night reads as tonight, which is
 * exactly the kind of quiet wrongness that makes someone distrust the board.
 */
function kickText(sample, today) {
  const time = ctKick(sample.kick_ct);
  const date = kickDate(sample.kick_ct);
  if (!date || date === today) return time;
  return `${dayLabel(date, today)} ${time}`;
}

/** Game header: the sport, the matchup, and the score or the kick time. */
function gameHeader(sample, game, today) {
  const sport = str(sample.sport).trim();
  const title = el('div', { cls: 'game-title' }, [
    // B2: the sport's own emoji, from the Bet-Log's Sport column, before the
    // away team. It is payload text like any other — never mapped from the
    // league here, so a sport the Bookie adds tomorrow arrives wearing its own.
    sport ? el('span', { cls: 'game-sport', attrs: { 'aria-hidden': 'true' }, text: sport }) : null,
    el('span', { text: str(sample.game) || 'game' }),
  ]);

  let statusText;
  let statusTone = 'pre';
  if (!game || game.state === 'pre') {
    statusText = kickText(sample, today);
  } else if (game.state === 'in') {
    statusTone = 'in';
    const score = `${game.away?.abbr ?? ''} ${game.away?.score ?? ''} – ${game.home?.score ?? ''} ${game.home?.abbr ?? ''}`;
    statusText = `${score.trim()}  ·  ${game.detail || game.clock || 'live'}`;
  } else {
    statusTone = 'post';
    const score = `${game.away?.abbr ?? ''} ${game.away?.score ?? ''} – ${game.home?.score ?? ''} ${game.home?.abbr ?? ''}`;
    statusText = `${score.trim()}  ·  final`;
  }

  return el('div', { cls: 'game-head' }, [
    title,
    el('div', { cls: `game-status game-${statusTone}`, text: statusText }),
  ]);
}

/**
 * Board order (B7): in-play first, then upcoming by kick, then decided.
 *
 * A postponed game sorts with the decided ones — nothing is going to happen to
 * it today, and it must not sit above a game that is actually on.
 *
 * Ties keep the snapshot's order, which is the Bet-Log's order: the sort is
 * done on `{card, i}` pairs rather than with a comparator that returns 0,
 * because Array#sort is only stable by specification, not by folklore, and the
 * log's order is the one thing here that came from a human.
 */
function cardRank(game) {
  if (!game) return 1; // no ESPN match yet — it is still an upcoming ticket
  if (game.dead) return 2;
  if (game.state === 'in') return 0;
  if (game.state === 'post') return 2;
  return 1;
}

function sortCards(cards) {
  return cards
    .map((card, i) => ({ card, i }))
    .sort((a, b) => {
      const ra = cardRank(a.card.game);
      const rb = cardRank(b.card.game);
      if (ra !== rb) return ra - rb;
      if (ra === 1) {
        const ka = kickKey(a.card.sample.kick_ct);
        const kb = kickKey(b.card.sample.kick_ct);
        if (ka !== kb) return ka - kb;
      }
      return a.i - b.i;
    })
    .map((x) => x.card);
}

// --------------------------------------------------------------------- tile

export function render(el_, tile, ctx) {
  const data = (tile && tile.data) || {};
  const tickets = arr(data.tickets).filter((t) => t && typeof t === 'object');
  const grades = (ctx && ctx.live && ctx.live.grades) || null;
  const games = (ctx && ctx.live && ctx.live.games) || null;

  el_.appendChild(headerStats(data, grades, games));
  const form = formLine(data.form);
  if (form) el_.appendChild(form);
  // B10: under the form strip. Absent on an older engine's snapshot, and
  // absent when there is no settled row to report.
  const lastCard = data.form && typeof data.form === 'object' ? lastCardLine(data.form.last_card) : null;
  if (lastCard) el_.appendChild(lastCard);

  if (!tickets.length) {
    el_.appendChild(empty('No open tickets.'));
    rememberStates(tickets, grades);
    return;
  }

  // One card per game, tickets grouped under it. Grouped by espn_event_id and
  // never by team name — ESPN abbreviations drift (OLM, BES, LEVS).
  const byGame = new Map();
  for (const t of tickets) {
    const key = String(t.espn_event_id ?? `no-event:${t.id}`);
    if (!byGame.has(key)) byGame.set(key, { key, sample: t, game: null, tickets: [] });
    byGame.get(key).tickets.push(t);
  }
  for (const card of byGame.values()) card.game = games ? games.get(card.key) || null : null;

  const today = ctToday();
  const board = el('div', { cls: 'games' });
  for (const card of sortCards([...byGame.values()])) {
    board.appendChild(
      el('div', { cls: 'game' }, [
        gameHeader(card.sample, card.game, today),
        el(
          'div',
          { cls: 'tickets' },
          // Snapshot order within a card — the Bet-Log's order (B7).
          card.tickets.map((t) => {
            const grade = grades ? grades.get(t.id) : null;
            return ticketRow(t, grade, grade ? flipClass(String(t.id), grade.state) : '');
          })
        ),
      ])
    );
  }
  el_.appendChild(board);

  rememberStates(tickets, grades);

  const stamp = ctx && ctx.live && ctx.live.fetched_at ? ` · feed ${ctTime(ctx.live.fetched_at)}` : '';
  el_.appendChild(
    el('p', {
      cls: 'tile-foot',
      text: `This is a lean, not a settlement.${stamp}`,
    })
  );

  if (ctx && ctx.live && ctx.live.error) {
    el_.appendChild(el('p', { cls: 'tile-foot warn-text', text: 'feed unavailable — showing last known' }));
  }
}
