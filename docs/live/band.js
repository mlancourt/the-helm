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
 * TWO TILES, ONE TICK (Today's Games spec, G5). `bets_live` wants the games
 * its tickets name; `today_games` wants every game in each league it follows.
 * Those overlap — a Brewers ticket and the MLB slate are the same scoreboard
 * call — so this file does not ask per tile. It builds ONE plan of (league,
 * date) pairs, deduped, fetches each exactly once, and hands the same events
 * to both. espn.js coalesces anything that still arrives twice.
 *
 * Two dates, not one, because the two tiles date their slates differently:
 * tickets are graded against today as the browser reckons it in Central, and
 * the board is dated by the snapshot's own `date_ct`. They are the same string
 * on every ordinary day, which is why the ordinary day costs one call per
 * league; when a stale snapshot makes them differ, two calls is the correct
 * answer rather than one wrong one.
 *
 * On a fetch error the LAST GOOD grades and games are kept and an error flag
 * is raised, so the tiles show "feed unavailable" over the previous numbers
 * rather than blanking or, worse, showing zeros as if they were scores.
 */

import {
  fetchScoreboard as realFetchScoreboard,
  fetchSummary as realFetchSummary,
  ctDateCompact,
  compactCtDate,
} from './espn.js';
import { gradeTicket, NEEDS_SUMMARY } from './graders.js';

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

/**
 * What the current snapshot needs from ESPN: the tickets to grade, the leagues
 * to board, and the deduped list of scoreboard calls that covers both.
 *
 * Exported because it is the whole sharing decision in one pure function, and
 * "one call per league per tick" is a claim worth testing directly.
 */
export function requirements(snapshot, now = new Date()) {
  const tiles = snapshot?.tiles || {};
  const tickets = Array.isArray(tiles.bets_live?.data?.tickets) ? tiles.bets_live.data.tickets : [];

  const board = tiles.today_games?.data || {};
  const rawLeagues = Array.isArray(board.leagues) ? board.leagues : [];

  // RULE 7: the board's date comes off the snapshot as a Central calendar
  // string and is turned into ESPN's `dates=` by removing two dashes. It is
  // never parsed. A payload with no usable date_ct falls back to today rather
  // than querying a nonsense date.
  const ticketDate = ctDateCompact(now);
  const boardDate = compactCtDate(board.date_ct) || ticketDate;

  const plan = new Map(); // "league|date" -> {league, date}
  const add = (league, date) => {
    if (!league) return;
    plan.set(`${league}|${date}`, { league, date });
  };

  for (const t of tickets) add(String(t?.league || ''), ticketDate);

  const leagues = [];
  for (const l of rawLeagues) {
    const slug = String(l?.slug || '');
    if (!slug || leagues.some((x) => x.slug === slug)) continue;
    leagues.push({ slug, id: String(l?.id || slug), label: String(l?.label || ''), emoji: String(l?.emoji || '') });
    add(slug, boardDate);
  }

  return {
    tickets,
    leagues,
    ticketDate,
    boardDate,
    dateCt: typeof board.date_ct === 'string' ? board.date_ct : '',
    plan: [...plan.values()],
  };
}

export function createLiveBand(onUpdate, deps = {}) {
  // Injected only so `?mock=1` can drive the band off a committed fake slate
  // and so the tests can run offline. The real path takes the defaults; there
  // is no mock branch inside this file.
  const fetchScoreboard = deps.fetchScoreboard || realFetchScoreboard;
  const fetchSummary = deps.fetchSummary || realFetchSummary;

  let timer = null;
  let running = false;
  let generation = 0; // guards against a slow fetch landing after a newer one
  let lastAnyLive = false; // what the last SUCCESSFUL cycle saw

  /** Last good state. Kept across errors on purpose. */
  let live = {
    games: new Map(), // espn_event_id -> normalized game
    grades: new Map(), // ticket.id -> {state,label,why}
    today: { date_ct: '', leagues: new Map() }, // slug -> {games, ok}
    fetched_at: null,
    error: null,
  };

  const getState = () => live;

  async function cycle(snapshot) {
    const gen = ++generation;
    const req = requirements(snapshot);

    if (!req.plan.length) {
      live = { ...live, fetched_at: new Date().toISOString(), error: null };
      onUpdate(live);
      return { anyLive: false, anyPre: false };
    }

    const results = new Map(); // "league|date" -> events
    const games = new Map();
    let failures = 0;

    // One call per (league, date). A league that fails does not sink the rest.
    await Promise.all(
      req.plan.map(async ({ league, date }) => {
        try {
          const events = await fetchScoreboard(league, date);
          results.set(`${league}|${date}`, events);
          for (const e of events) games.set(e.id, e);
        } catch {
          failures++;
        }
      })
    );

    if (gen !== generation) return { anyLive: false, anyPre: false }; // superseded

    // Every call failed: keep the last good grades and raise the flag.
    if (failures === req.plan.length) {
      live = { ...live, error: 'feed unavailable' };
      onUpdate(live);
      // Hold the previous cadence rather than backing off. A blip in the middle
      // of a live game is exactly when dropping to 5-minute polling is worst —
      // the score would sit there going stale while the game moved on.
      return { anyLive: lastAnyLive, anyPre: true };
    }

    // Tickets match ONLY by event id. Never by team name.
    const ticketGame = new Map();
    for (const t of req.tickets) ticketGame.set(t.id, games.get(String(t.espn_event_id)) || null);

    // Summaries are heavy, so fetch one only when a ticket's market needs it
    // AND that game is actually under way. Pre-game summaries carry no
    // scoringPlays key at all, so there would be nothing to learn.
    const summaryFor = new Map();
    const wanted = new Map();
    for (const t of req.tickets) {
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
    for (const t of req.tickets) {
      const g = ticketGame.get(t.id);
      grades.set(t.id, gradeTicket(t, g, g ? summaryFor.get(g.id) : undefined));
    }

    // The board, one entry per league it follows. A league whose call failed
    // keeps the games it had and says the feed is down (rule 8) — the tile
    // must not report "no games today" because the network hiccuped.
    const byLeague = new Map();
    for (const { slug } of req.leagues) {
      const events = results.get(`${slug}|${req.boardDate}`);
      if (events) {
        byLeague.set(slug, { games: events, ok: true });
      } else {
        const prev = live.today?.leagues?.get(slug);
        byLeague.set(slug, { games: prev?.games || [], ok: false });
      }
    }

    live = {
      games,
      grades,
      today: { date_ct: req.dateCt, leagues: byLeague },
      fetched_at: new Date().toISOString(),
      error: failures ? 'some feeds unavailable' : null,
    };
    onUpdate(live);

    // Cadence is decided by the games that are actually relevant — the ones a
    // ticket names, plus every game on a followed league's slate, because the
    // board is a live scoreboard and G5 says it updates on this clock.
    const relevant = new Set();
    for (const t of req.tickets) {
      const g = ticketGame.get(t.id);
      if (g) relevant.add(g);
    }
    for (const [, entry] of byLeague) for (const g of entry.games) relevant.add(g);

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
