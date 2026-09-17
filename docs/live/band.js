/**
 * LIVE band controller: fetch, grade, schedule, repeat.
 *
 * Owns the polling cadence and assembles the `ctx.live` object the LIVE tiles
 * read. espn.js fetches, graders.js judges, this decides when and how often.
 *
 * Cadence (per the brief):
 *   45s   while any relevant game is in progress
 *   5min  while everything is still pre
 *   stop  once every relevant game is post
 *
 * On a fetch error the LAST GOOD grades are kept and an error flag is raised,
 * so the tile shows "feed unavailable" over the previous numbers rather than
 * blanking or, worse, showing zeros as if they were scores.
 */

import { fetchScoreboard, fetchSummary, ctDateCompact } from './espn.js';
import { gradeTicket, NEEDS_SUMMARY } from './graders.js';
import { ctTime } from '../lib/fmt.js';

export const LIVE_MS = 45 * 1000;
export const PRE_MS = 5 * 60 * 1000;

/**
 * The cadence rule, pulled out so it can be tested directly:
 *   45s while any relevant game is in progress
 *   5min while everything is still pre
 *   0 (stop) once every relevant game is final
 */
export function nextDelay({ anyLive, anyPre }) {
  if (anyLive) return LIVE_MS;
  if (anyPre) return PRE_MS;
  return 0;
}

export function createLiveBand(onUpdate) {
  let timer = null;
  let running = false;
  let generation = 0; // guards against a slow fetch landing after a newer one
  let lastAnyLive = false; // what the last SUCCESSFUL cycle saw

  /** Last good state. Kept across errors on purpose. */
  let live = {
    games: new Map(), // espn_event_id -> normalized game
    grades: new Map(), // ticket.id -> {state,label,why}
    board: new Map(), // "<league>:<abbr>" -> row for mke_board
    fetched_at: null,
    error: null,
  };

  const getState = () => live;

  /** What the current snapshot actually needs from ESPN. */
  function requirements(snapshot) {
    const tiles = snapshot?.tiles || {};
    const tickets = Array.isArray(tiles.bets_live?.data?.tickets) ? tiles.bets_live.data.tickets : [];
    const teams = Array.isArray(tiles.mke_board?.data?.teams) ? tiles.mke_board.data.teams : [];

    const leagues = new Set();
    for (const t of tickets) if (t?.league) leagues.add(String(t.league));
    for (const t of teams) if (t?.league) leagues.add(String(t.league));

    return { tickets, teams, leagues: [...leagues] };
  }

  function buildBoard(teams, byLeague) {
    const board = new Map();
    for (const team of teams) {
      const league = String(team?.league || '');
      const abbr = String(team?.abbr || '');
      const events = byLeague.get(league) || [];

      // mke_board matches by abbreviation because the snapshot names the team
      // that way. Tickets never do — they match by event id, because ESPN
      // abbreviations drift (OLM, BES, LEVS).
      const game = events.find((e) => e.home.abbr === abbr || e.away.abbr === abbr);
      if (!game) {
        board.set(`${league}:${abbr}`, { state: 'none' });
        continue;
      }

      const isHome = game.home.abbr === abbr;
      const us = isHome ? game.home : game.away;
      const them = isHome ? game.away : game.home;

      board.set(`${league}:${abbr}`, {
        state: game.state,
        opponent: `${isHome ? 'vs' : '@'} ${them.abbr}`,
        score: game.state === 'pre' ? '' : `${us.score}–${them.score}`,
        detail: game.detail,
        // startDate is a UTC ISO instant (it carries a Z), so it is safe to
        // parse — unlike the snapshot's date-only Central strings. All of that
        // judgement lives in lib/fmt.js; this file does not do dates.
        kick: ctTime(game.startDate),
        countdown: game.state === 'pre' ? countdown(game.startDate) : '',
        eventId: game.id,
      });
    }
    return board;
  }

  function countdown(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const mins = Math.round((t - Date.now()) / 60000);
    if (mins <= 0) return 'about to start';
    if (mins < 60) return `in ${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }

  async function cycle(snapshot) {
    const gen = ++generation;
    const { tickets, teams, leagues } = requirements(snapshot);

    if (!leagues.length) {
      live = { ...live, fetched_at: new Date().toISOString(), error: null };
      onUpdate(live);
      return { anyLive: false, anyPre: false };
    }

    const byLeague = new Map();
    const games = new Map();
    let failures = 0;

    // One scoreboard per league. A league that fails does not sink the others.
    await Promise.all(
      leagues.map(async (league) => {
        try {
          const events = await fetchScoreboard(league, ctDateCompact());
          byLeague.set(league, events);
          for (const e of events) games.set(e.id, e);
        } catch {
          failures++;
          byLeague.set(league, []);
        }
      })
    );

    if (gen !== generation) return { anyLive: false, anyPre: false }; // superseded

    // Every league failed: keep the last good grades and raise the flag.
    if (failures === leagues.length) {
      live = { ...live, error: 'feed unavailable' };
      onUpdate(live);
      // Hold the previous cadence rather than backing off. A blip in the middle
      // of a live game is exactly when dropping to 5-minute polling is worst —
      // the score would sit there going stale while the game moved on.
      return { anyLive: lastAnyLive, anyPre: true };
    }

    // Tickets match ONLY by event id. Never by team name.
    const ticketGame = new Map();
    for (const t of tickets) ticketGame.set(t.id, games.get(String(t.espn_event_id)) || null);

    // Summaries are heavy, so fetch one only when a ticket's market needs it
    // AND that game is actually under way. Pre-game summaries carry no
    // scoringPlays key at all, so there would be nothing to learn.
    const summaryFor = new Map();
    const wanted = new Map();
    for (const t of tickets) {
      if (!NEEDS_SUMMARY.has(t.market)) continue;
      const g = ticketGame.get(t.id);
      if (!g || g.state === 'pre') continue;
      wanted.set(g.id, g.league);
    }
    await Promise.all(
      [...wanted].map(async ([eventId, league]) => {
        try {
          summaryFor.set(eventId, await fetchSummary(league, eventId));
        } catch {
          // Leave it unset: the grader reports "waiting on scoring plays"
          // rather than claiming the player did not score.
        }
      })
    );

    if (gen !== generation) return { anyLive: false, anyPre: false };

    const grades = new Map();
    for (const t of tickets) {
      const g = ticketGame.get(t.id);
      grades.set(t.id, gradeTicket(t, g, g ? summaryFor.get(g.id) : undefined));
    }

    live = {
      games,
      grades,
      board: buildBoard(teams, byLeague),
      fetched_at: new Date().toISOString(),
      error: failures ? 'some feeds unavailable' : null,
    };
    onUpdate(live);

    // Cadence is decided by the games that are actually relevant to this
    // board, not by the whole league slate.
    const relevant = new Set();
    for (const t of tickets) {
      const g = ticketGame.get(t.id);
      if (g) relevant.add(g);
    }
    for (const [, row] of live.board) {
      if (row.eventId && games.has(row.eventId)) relevant.add(games.get(row.eventId));
    }

    let anyLive = false;
    let anyPre = false;
    for (const g of relevant) {
      if (g.dead) continue;
      if (g.state === 'in') anyLive = true;
      else if (g.state === 'pre') anyPre = true;
    }
    lastAnyLive = anyLive;
    return { anyLive, anyPre };
  }

  async function tick(getSnapshot) {
    if (!running) return;
    let next = PRE_MS;
    try {
      next = nextDelay(await cycle(getSnapshot()));
    } catch {
      live = { ...live, error: 'feed unavailable' };
      onUpdate(live);
      next = PRE_MS;
    }
    if (!running || !next) return;
    timer = setTimeout(() => tick(getSnapshot), next);
  }

  return {
    getState,
    /** One pass, no scheduling. The seam the tests drive. */
    runOnce: (snapshot) => cycle(snapshot),
    /** Start (or restart) the loop against a snapshot getter. */
    start(getSnapshot) {
      this.stop();
      running = true;
      tick(getSnapshot);
    },
    stop() {
      running = false;
      clearTimeout(timer);
      timer = null;
    },
    /** One immediate pass — used when the tab comes back to the foreground. */
    refreshNow(getSnapshot) {
      if (!running) return;
      clearTimeout(timer);
      tick(getSnapshot);
    },
  };
}
