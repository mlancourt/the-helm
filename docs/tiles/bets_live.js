/**
 * bets_live — the marquee tile.
 *
 * Published DAILY, graded LIVE in the browser. M2 renders the ticket board
 * from the snapshot alone; M3 supplies `ctx.live.grades` and `ctx.live.games`
 * and every PRE pill below starts moving. The shape of that handoff is fixed
 * here so M3 is a fill-in, not a rewrite.
 *
 * WORDING RULE (non-negotiable): this tile says *lean*, never *settled*. A
 * different system settles bets. This page is the scoreboard's opinion.
 */

import { el, pill, empty } from '../lib/dom.js';
import { units, odds, line, ctKick, ctTime, kickDate, dayLabel, ctToday } from '../lib/fmt.js';
import { payoutMultiple } from '../live/graders.js';

/** grader state -> [pill label, tone]. M3's graders return the label too. */
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
 * Net units if every current lean held. Tickets with no grade contribute 0 —
 * an ungraded board leans nowhere, which is the honest answer before kickoff.
 */
function leanUnits(tickets, grades) {
  if (!grades) return null;
  let net = 0;
  let graded = 0;
  for (const t of tickets) {
    const g = grades.get(t.id);
    if (!g) continue;
    const stake = Number(t.stake_u) || 0;
    if (g.state === 'win' || g.state === 'lead') {
      net += stake * payoutMultiple(t.price);
      graded++;
    } else if (g.state === 'lose' || g.state === 'trail') {
      net -= stake;
      graded++;
    } else if (g.state === 'push' || g.state === 'dead' || g.state === 'even') {
      // A tie, a push, and a dead game all lean nowhere — counted as graded
      // so the figure is not mistaken for "nothing has started yet".
      graded++;
    }
  }
  return graded ? net : null;
}

function headerStats(data, grades, games) {
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const lean = leanUnits(tickets, grades);

  // "Closed" = stake riding on games ESPN reports as final.
  let closed = 0;
  if (games) {
    for (const t of tickets) {
      const g = games.get(String(t.espn_event_id));
      if (g && g.state === 'post') closed += Number(t.stake_u) || 0;
    }
  }

  const stat = (label, value, tone = '') =>
    el('div', { cls: `stat ${tone}`.trim() }, [
      el('span', { cls: 'stat-value', text: value }),
      el('span', { cls: 'stat-label', text: label }),
    ]);

  return el('div', { cls: 'bets-stats' }, [
    stat('bankroll', units(data.bankroll_u)),
    stat('open', units(data.open_u)),
    stat(
      'lean now',
      lean === null ? '—' : `${lean > 0 ? '+' : ''}${units(lean)}`,
      lean === null ? '' : lean > 0 ? 'good' : lean < 0 ? 'bad' : ''
    ),
    stat('closed', games ? units(closed) : '—'),
    stat('record', data.record || '—'),
  ]);
}

/** One ticket row: class stripe, label, why, pill, stake@price. */
function ticketRow(ticket, grade) {
  const [label, tone] = STATE_PILL[grade?.state] || STATE_PILL.pre;
  const cls = String(ticket.class || 'core');

  const bits = [];
  if (ticket.market) bits.push(String(ticket.market).replace(/_/g, ' '));
  if (ticket.line !== null && ticket.line !== undefined) bits.push(line(ticket.line));
  if (ticket.player) bits.push(String(ticket.player));

  return el('div', { cls: `ticket stripe-${cls}` }, [
    el('div', { cls: 'ticket-main' }, [
      el('div', { cls: 'ticket-label', text: ticket.label || bits.join(' ') || 'ticket' }),
      el('div', {
        cls: 'ticket-why',
        // Before M3 there is no grade, and inventing one would be a lie about
        // money. "not graded yet" is the honest pre-grader state.
        text: grade?.why || (grade ? '' : 'not graded yet'),
      }),
    ]),
    el('div', { cls: 'ticket-side' }, [
      pill(grade?.label || label, tone),
      el('div', {
        cls: 'ticket-stake',
        text: `${units(ticket.stake_u)} @ ${odds(ticket.price) || '—'}`,
      }),
    ]),
  ]);
}

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

/** Game header: score and clock once live, kick time before. */
function gameHeader(sample, game, today) {
  const title = el('div', { cls: 'game-title', text: sample.game || 'game' });

  let statusText;
  let statusTone = 'pre';
  if (!game) {
    statusText = kickText(sample, today);
  } else if (game.state === 'pre') {
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

export function render(el_, tile, ctx) {
  const data = tile.data || {};
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const grades = ctx.live?.grades || null;
  const games = ctx.live?.games || null;

  el_.appendChild(headerStats(data, grades, games));

  if (!tickets.length) {
    el_.appendChild(empty('No open tickets.'));
    return;
  }

  // One card per game, tickets grouped under it. Grouped by espn_event_id and
  // never by team name — ESPN abbreviations drift (OLM, BES, LEVS).
  const byGame = new Map();
  for (const t of tickets) {
    const key = String(t.espn_event_id ?? `no-event:${t.id}`);
    if (!byGame.has(key)) byGame.set(key, []);
    byGame.get(key).push(t);
  }

  const today = ctToday();
  const board = el('div', { cls: 'games' });
  for (const [key, group] of byGame) {
    const game = games ? games.get(key) : null;
    board.appendChild(
      el('div', { cls: 'game' }, [
        gameHeader(group[0], game, today),
        el('div', { cls: 'tickets' }, group.map((t) => ticketRow(t, grades ? grades.get(t.id) : null))),
      ])
    );
  }
  el_.appendChild(board);

  const stamp = ctx.live?.fetched_at ? ` · feed ${ctTime(ctx.live.fetched_at)}` : '';
  el_.appendChild(
    el('p', {
      cls: 'tile-foot',
      text: `This is a lean, not a settlement.${stamp}`,
    })
  );

  if (ctx.live?.error) {
    el_.appendChild(el('p', { cls: 'tile-foot warn-text', text: 'feed unavailable — showing last known' }));
  }
}
