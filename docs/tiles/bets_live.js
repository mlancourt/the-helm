/**
 * bets_live — the marquee tile.
 *
 * Published DAILY, graded LIVE in the browser: the snapshot supplies the
 * tickets and the numbers, `ctx.live` supplies the games and the grades, and
 * every pill on the board moves on the band's 20-second tick (B14).
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
 * THE COVER BAR (B11–B13, v1.24.0). Under every row, a thin bar centred on
 * the line: a fill from the centre notch whose side and colour are the PILL's
 * (never a second opinion off the number) and whose length is the grader's
 * own `margin` against a per-sport scale, over a track that drains as the
 * game runs. It is a picture of the row's `why` — aria-hidden, no text, and
 * no new number: lean-now still sums the row figures and nothing else (B15).
 *
 * THE PULSE (B14). One muted `graded 12s ago` in the header, repainted every
 * 5 s by exactly one interval. The render returns its teardown to the shell,
 * and the module also clears its own last timer at the top of every render,
 * so two renders can never leave two clocks.
 *
 * PARLAYS (B16–B20, v1.28.0). A `market: "parlay"` ticket is its own card,
 * never merged into a game card: `🎟️ {game}` with the stake @ the slip's
 * price and a `{won}/{n} legs ✓` chip, a chip per game with its state dot,
 * one row per leg in slip order (label · the abbr of the game the player was
 * found in · the live stat · pill · its own cover bar), and a footer row that
 * carries the TICKET's pill and units figure — the one row lean-now sums.
 * Legs print no units. The ticket state is the strict AND of the legs
 * (`graders.js` → `parlayState`), so TRAILING and the new ALIVE are both
 * `0.00u`: one leg up out of three is not a lean on the payout. `payout_x`
 * and `to_win_u` are printed as the engine sent them — nothing here prices
 * a parlay.
 *
 * THE SITUATION LINE (B21). A live 🏈 card adds `{abbr} ball · {down &
 * distance}` (+ `🔴 RZ`) and the last play under it; a live ⚾ card adds
 * `T5 · 1 out · 1st, 3rd`. Off the scoreboard's own `situation` — no new
 * fetch — and each missing field hides its own segment.
 *
 * RULE 10: labels, team names, the sport emoji and every grader `why` land via
 * textContent. ESPN text is untrusted exactly like snapshot text is.
 */

import { el, pill, empty } from '../lib/dom.js';
// Pure functions only — no fetch, no clock. The tile still never fetches.
import { gameProgress, sportOf, LEG_STAT } from '../live/graders.js';
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
  // B19: a parlay with nothing lost and a game still to play.
  alive: ['ALIVE', 'alive'],
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
  alive: 0,
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

  // B19: a parlay that is trailing or alive has lost nothing yet and is not
  // leaning on the payout either — the AND is strict, so it reads 0.00u.
  if (ticket.market === 'parlay' && (state === 'trail' || state === 'alive')) {
    return { value: 0, text: '0.00u', tone: 'flat' };
  }

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
    if (!ticketFinal(t, games)) continue;
    any = true;
    net += ticketUnits(t, grades.get(t.id)).value;
  }
  return any ? net : 0;
}

/** Is every game this ticket rides on final? A parlay needs all of its own. */
function ticketFinal(t, games) {
  if (t.market === 'parlay') {
    const gs = parlayGames(t);
    return gs.length > 0 && gs.every((g) => {
      const game = games.get(String(g.espn_event_id));
      return !!game && game.state === 'post';
    });
  }
  const game = games.get(String(t.espn_event_id));
  return !!game && game.state === 'post';
}

/** A parlay's games, tolerating an older snapshot that sent none (rule 9). */
function parlayGames(t) {
  return arr(t && t.games).filter((g) => g && typeof g === 'object');
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

// ---------------------------------------------------------------- cover bar

/**
 * How many points reach the edge of the bar (B11): per SPORT, not per market.
 * A 14-point football cover and a 3-run baseball cover both read as "all the
 * way" — the scale is the sport's own sense of a comfortable margin.
 */
const COVER_SCALE = {
  football: 14,
  basketball: 14,
  baseball: 3,
  hockey: 3,
  soccer: 3,
};
const DEFAULT_SCALE = 14;

/**
 * Parlay stat legs (B20) scale by the STAT, not the sport: forty rushing
 * yards over the line is as comfortable as a hundred passing.
 */
const MARKET_SCALE = {
  player_rush_yds: 40,
  player_pass_yds: 100,
  player_rec_yds: 50,
  player_rec: 3,
};

/** Markets that are hit-or-not (B12): no distance, so no partial fill. */
const BINARY = new Set(['anytime_td', 'anytime_goal', 'btts']);

/** The pill's side of the story. Only these five states draw a fill. */
const BAR_TONE = { lead: 'good', win: 'good', trail: 'bad', lose: 'bad' };

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * The bar's geometry as data — `{track, tone, side, fill}` — so the tests can
 * read the decision without a layout engine.
 *
 *   track  0..1 of the row still to play, anchored left (B13)
 *   tone   'good' | 'bad' | 'muted' — from the grade's STATE, never the margin
 *   side   'right' | 'left' | 'full' | null
 *   fill   0..1 of the WHOLE row (a half-row from the notch is 0.5)
 */
export function coverBar(ticket, grade, game) {
  const progress = game ? gameProgress(game, (ticket && ticket.league) || game.league) : null;
  // pre, unmatched, or unknowable: the whole game is still ahead.
  const track = progress === null ? 1 : 1 - progress;

  const state = grade && grade.state;
  const tone = BAR_TONE[state] || null;
  if (!tone) return { track, tone: 'muted', side: null, fill: 0 };

  if (BINARY.has(ticket && ticket.market)) {
    // B12: red the whole way until it hits, green the whole way after.
    return { track, tone, side: 'full', fill: 1 };
  }

  const side = tone === 'good' ? 'right' : 'left';
  // B11: a locked result is final — it wears the whole half, whatever the
  // number it locked on.
  if (state === 'win' || state === 'lose') return { track, tone, side, fill: 0.5 };

  const margin = num(grade.margin);
  if (margin === null || margin === 0) return { track, tone, side: null, fill: 0 };
  const scale =
    MARKET_SCALE[ticket && ticket.market] || COVER_SCALE[sportOf(ticket && ticket.league)] || DEFAULT_SCALE;
  return { track, tone, side, fill: Math.min(Math.abs(margin) / scale, 1) * 0.5 };
}

/** The bar itself. Decorative-with-meaning: the `why` above says the number. */
function coverBarEl(ticket, grade, game) {
  const b = coverBar(ticket, grade, game);
  return el('div', { cls: `cover-bar cover-${b.tone}`, attrs: { 'aria-hidden': 'true' } }, [
    b.track > 0 ? el('div', { cls: 'cover-track', attrs: { style: `width:${pct(b.track)}` } }) : null,
    b.side ? el('div', { cls: `cover-fill cover-fill-${b.side}`, attrs: { style: `width:${pct(b.fill)}` } }) : null,
    el('div', { cls: 'cover-notch' }),
  ]);
}

// -------------------------------------------------------------------- pulse

/** The one repaint interval this module may own. Cleared on every render. */
let stampTimer = null;

function stopStamp() {
  if (stampTimer !== null) clearInterval(stampTimer);
  stampTimer = null;
}

const SECOND_MS = 1000;

/** `graded 12s ago`, or `graded 3m ago` once seconds stop being useful. */
export function gradedAgo(fetchedAt, now = Date.now()) {
  const t = Date.parse(String(fetchedAt || ''));
  if (!Number.isFinite(t)) return '';
  const s = Math.floor(Math.max(0, now - t) / SECOND_MS);
  return s < 60 ? `graded ${s}s ago` : `graded ${Math.floor(s / 60)}m ago`;
}

/**
 * The header stamp (B14). The band's own error string wins — the lag becomes
 * a number, and a dead feed says so in the band's words, not this module's.
 * No fetched_at and no error: nothing at all.
 */
function pulseStamp(live) {
  if (!live) return null;
  if (live.error) return el('div', { cls: 'bets-graded bets-graded-error', text: String(live.error) });
  if (!live.fetched_at) return null;
  const text = gradedAgo(live.fetched_at);
  if (!text) return null;
  const node = el('div', { cls: 'bets-graded', text });
  stampTimer = setInterval(() => {
    node.textContent = gradedAgo(live.fetched_at);
  }, 5000);
  return node;
}

// --------------------------------------------------------------------- rows

/**
 * One ticket row: class stripe, label, why, pill, its units figure, stake@price.
 *
 * `flip` is B8's one-shot glow — a class, not a state: the CSS animation runs
 * once and the class is never removed, because the node itself is replaced on
 * the next render.
 */
function ticketRow(ticket, grade, flip, game) {
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
    // B11: last in the row, full width under everything above.
    coverBarEl(ticket, grade, game),
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

  const situation = game && game.state === 'in' ? situationLines(game, sample.league) : [];
  return el('div', { cls: 'game-head' }, [
    title,
    el('div', { cls: `game-status game-${statusTone}`, text: statusText }),
    ...situation.map((text, i) => el('div', { cls: i ? 'game-lastplay' : 'game-situation', text })),
  ]);
}

const LAST_PLAY_MAX = 70;

/**
 * The situation line (B21): `[situation, lastPlay?]` as plain strings, or []
 * when there is nothing to say. Only while the game is `in`; every segment
 * hides on its own when ESPN left its field out, and no `situation` at all
 * is no line at all.
 *
 *   🏈  `DET ball · 2nd & 7 at CAR 31 · 🔴 RZ`, then the last play (≤ 70 chars)
 *   ⚾  `T5 · 1 out · 1st, 3rd`
 */
export function situationLines(game, league) {
  const s = game && game.situation;
  if (!game || game.state !== 'in' || !s || typeof s !== 'object') return [];
  const sport = sportOf(game.league || league);
  const out = [];
  if (sport === 'football') {
    const segs = [];
    if (s.possession) segs.push(`${str(s.possession)} ball`);
    if (str(s.downDistanceText).trim()) segs.push(str(s.downDistanceText).trim());
    if (s.isRedZone === true) segs.push('🔴 RZ');
    if (segs.length) out.push(segs.join(' · '));
    const play = str(s.lastPlay).trim();
    if (play) out.push(play.length > LAST_PLAY_MAX ? `${play.slice(0, LAST_PLAY_MAX).trimEnd()}…` : play);
    // The last play alone, with no down to hang it under, still reads.
    return out;
  }
  if (sport === 'baseball') {
    const segs = [];
    const half = /^\s*top/i.test(str(game.detail)) ? 'T' : /^\s*bot/i.test(str(game.detail)) ? 'B' : '';
    const inning = num(game.period);
    if (half && inning) segs.push(`${half}${inning}`);
    const outs = num(s.outs);
    if (outs !== null) segs.push(`${outs} out`);
    const bases = [
      [s.onFirst, '1st'],
      [s.onSecond, '2nd'],
      [s.onThird, '3rd'],
    ];
    const on = bases.filter(([v]) => v === true).map(([, b]) => b);
    if (on.length) segs.push(on.join(', '));
    if (segs.length) out.push(segs.join(' · '));
  }
  return out;
}

// ------------------------------------------------------------------ parlays

/** The live readout for one leg: `47 yds`, `2 rec`, `TD ✓`, or `—`. */
function legReadout(leg, lg) {
  if (!lg || lg.state === 'pre' || lg.state === 'unsupported') return '—';
  if (leg.market === 'anytime_td') return lg.state === 'win' ? 'TD ✓' : 'no TD';
  const spec = LEG_STAT[leg.market];
  const stat = num(lg.stat);
  return spec && stat !== null ? `${stat} ${spec[2]}` : '—';
}

/** One game on a parlay: `DET@CAR` with its state dot, and the kick when pre. */
function parlayGameChip(meta, game, today) {
  const state = !game || game.dead ? 'pre' : game.state;
  const name = `${str(meta.away).trim()}@${str(meta.home).trim()}`;
  const label = name === '@' ? str(meta.game) || 'game' : name;
  return el('span', { cls: 'parlay-game', attrs: { title: str(meta.game) || null } }, [
    el('span', { cls: `parlay-dot parlay-dot-${state}`, attrs: { 'aria-label': state === 'in' ? 'live' : state === 'post' ? 'final' : 'not started' } }),
    el('span', { text: label }),
    state === 'pre' && meta.kick_ct ? el('span', { cls: 'parlay-kick', text: kickText(meta, today) }) : null,
  ]);
}

/** One leg: label · found-game abbr · stat · pill, and its own cover bar (B17/B20). */
function legRow(leg, lg, gameFor) {
  const [label, tone] = STATE_PILL[lg && lg.state] || STATE_PILL.pre;
  const game = lg ? gameFor(lg.gameId) : null;
  const abbr = lg ? str(lg.gameAbbr).trim() : '';
  return el('div', { cls: 'ticket parlay-leg' }, [
    el('div', { cls: 'ticket-main' }, [
      el('div', { cls: 'ticket-label' }, [
        el('span', { text: str(leg.label) || str(leg.player) || 'leg' }),
        abbr ? el('span', { cls: 'parlay-abbr', text: abbr }) : null,
      ]),
      el('div', { cls: 'ticket-why', text: lg ? str(lg.why) : 'not graded yet' }),
    ]),
    el('div', { cls: 'ticket-side' }, [
      pill((lg && lg.label) || label, tone),
      el('div', { cls: 'parlay-stat', text: legReadout(leg, lg) }),
    ]),
    coverBarEl({ market: leg.market, league: game ? game.league : '' }, lg, game),
  ]);
}

/**
 * The parlay's own card (B17). Its legs are the picture; the footer row is
 * the ticket — pill and units figure, the figure lean-now adds up.
 */
function parlayCard(ticket, grade, flip, games, today) {
  const metas = parlayGames(ticket);
  const legs = arr(ticket.legs).filter((l) => l && typeof l === 'object');
  const legGrades = grade && Array.isArray(grade.legs) ? grade.legs : [];
  const liveOf = (meta) => (games ? games.get(String(meta.espn_event_id)) || null : null);
  const gameFor = (id) => {
    if (games && id) return games.get(String(id)) || null;
    // A one-game parlay has only one clock to drain with.
    return metas.length === 1 ? liveOf(metas[0]) : null;
  };

  const [plabel, ptone] = STATE_PILL[grade && grade.state] || STATE_PILL.pre;
  const u = ticketUnits(ticket, grade);
  const won = legGrades.filter((g) => g && g.state === 'win').length;
  const stake = num(ticket.stake_u);
  const price = odds(ticket.price) || str(ticket.price).trim() || '—';
  const payout = num(ticket.payout_x);

  const head = el('div', { cls: 'game-head' }, [
    el('div', { cls: 'parlay-head' }, [
      el('div', { cls: 'game-title' }, [
        el('span', { cls: 'game-sport', attrs: { 'aria-hidden': 'true' }, text: '🎟️' }),
        el('span', { text: str(ticket.game) || str(ticket.label) || 'parlay' }),
      ]),
      el('div', { cls: 'parlay-right' }, [
        el('span', { cls: 'parlay-stake', text: `${stake === null ? '—' : `${stake}u`} @ ${price}` }),
        legs.length ? el('span', { cls: 'parlay-legs-chip', text: `${won}/${legs.length} legs ✓` }) : null,
      ]),
    ]),
    metas.length ? el('div', { cls: 'parlay-games' }, metas.map((m) => parlayGameChip(m, liveOf(m), today))) : null,
  ]);

  const rows = legs.length
    ? legs.map((leg, i) => legRow(leg, grade ? legGrades[i] || null : null, gameFor))
    : // Rule 9: an older snapshot's parlay with no legs is a label and an
      // honest "grading unsupported", never a throw.
      [
        el('div', { cls: 'ticket parlay-leg' }, [
          el('div', { cls: 'ticket-main' }, [
            el('div', { cls: 'ticket-label', text: str(ticket.label) || 'parlay' }),
            el('div', { cls: 'ticket-why', text: 'grading unsupported' }),
          ]),
          el('div', { cls: 'ticket-side' }, [pill(STATE_PILL.unsupported[0], STATE_PILL.unsupported[1])]),
        ]),
      ];

  const cls = str(ticket.class) || 'core';
  const foot = el('div', { cls: `ticket parlay-foot stripe-${cls}${flip}` }, [
    el('div', { cls: 'ticket-main' }, [
      el('div', { cls: 'ticket-label', text: legs.length ? str(ticket.label) || 'parlay' : 'parlay' }),
      el('div', { cls: 'ticket-why', text: payout === null ? '' : `pays ${payout}x` }),
    ]),
    el('div', { cls: 'ticket-side' }, [
      pill((grade && grade.label) || plabel, ptone),
      el('div', { cls: `ticket-units ticket-units-${u.tone}`, text: u.text }),
    ]),
  ]);

  return el('div', { cls: 'game game-parlay' }, [head, el('div', { cls: 'tickets' }, [...rows, foot])]);
}

/** Where a parlay sits on the board: any game in -> in play; all final -> decided. */
function parlayRank(ticket, games) {
  const states = parlayGames(ticket).map((m) => {
    const g = games ? games.get(String(m.espn_event_id)) : null;
    return !g ? 'pre' : g.dead ? 'post' : g.state;
  });
  if (states.includes('in')) return 0;
  if (states.length && states.every((s) => s === 'post')) return 2;
  return 1;
}

/** A parlay's kick for ordering: its next unstarted game, else its own kick_ct. */
function parlayKick(ticket, games) {
  const next = parlayGames(ticket)
    .filter((m) => {
      const g = games ? games.get(String(m.espn_event_id)) : null;
      return !g || g.state === 'pre';
    })
    .map((m) => kickKey(m.kick_ct))
    .filter((k) => Number.isFinite(k));
  return next.length ? Math.min(...next) : kickKey(ticket.kick_ct);
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
      const ra = a.card.rank;
      const rb = b.card.rank;
      if (ra !== rb) return ra - rb;
      if (ra === 1) {
        const ka = a.card.kick;
        const kb = b.card.kick;
        if (ka !== kb) return ka - kb;
      }
      return a.i - b.i;
    })
    .map((x) => x.card);
}

// --------------------------------------------------------------------- tile

export function render(el_, tile, ctx) {
  // Whatever the last render started, it ends here — one clock, ever.
  stopStamp();

  const data = (tile && tile.data) || {};
  const tickets = arr(data.tickets).filter((t) => t && typeof t === 'object');
  const grades = (ctx && ctx.live && ctx.live.grades) || null;
  const games = (ctx && ctx.live && ctx.live.games) || null;

  el_.appendChild(headerStats(data, grades, games));
  const pulse = pulseStamp(ctx && ctx.live);
  if (pulse) el_.appendChild(pulse);
  const form = formLine(data.form);
  if (form) el_.appendChild(form);
  // B10: under the form strip. Absent on an older engine's snapshot, and
  // absent when there is no settled row to report.
  const lastCard = data.form && typeof data.form === 'object' ? lastCardLine(data.form.last_card) : null;
  if (lastCard) el_.appendChild(lastCard);

  if (!tickets.length) {
    el_.appendChild(empty('No open tickets.'));
    rememberStates(tickets, grades);
    return stopStamp;
  }

  // One card per game, tickets grouped under it. Grouped by espn_event_id and
  // never by team name — ESPN abbreviations drift (OLM, BES, LEVS).
  // A parlay is its own card, never merged into a game card (B17) — its
  // espn_event_id is games[0]'s and means nothing on its own.
  const byGame = new Map();
  const parlays = [];
  for (const t of tickets) {
    if (t.market === 'parlay') {
      parlays.push({ parlay: t, rank: parlayRank(t, games), kick: parlayKick(t, games) });
      continue;
    }
    const key = String(t.espn_event_id ?? `no-event:${t.id}`);
    if (!byGame.has(key)) byGame.set(key, { key, sample: t, game: null, tickets: [] });
    byGame.get(key).tickets.push(t);
  }
  for (const card of byGame.values()) {
    card.game = games ? games.get(card.key) || null : null;
    card.rank = cardRank(card.game);
    card.kick = kickKey(card.sample.kick_ct);
  }

  const today = ctToday();
  const board = el('div', { cls: 'games' });
  for (const card of sortCards([...byGame.values(), ...parlays])) {
    if (card.parlay) {
      const t = card.parlay;
      const grade = grades ? grades.get(t.id) : null;
      board.appendChild(parlayCard(t, grade, grade ? flipClass(String(t.id), grade.state) : '', games, today));
      continue;
    }
    board.appendChild(
      el('div', { cls: 'game' }, [
        gameHeader(card.sample, card.game, today),
        el(
          'div',
          { cls: 'tickets' },
          // Snapshot order within a card — the Bet-Log's order (B7).
          card.tickets.map((t) => {
            const grade = grades ? grades.get(t.id) : null;
            return ticketRow(t, grade, grade ? flipClass(String(t.id), grade.state) : '', card.game);
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

  // The shell calls this before the next render (and the top of render does
  // the same), so the stamp's interval never outlives its node.
  return stopStamp;
}
