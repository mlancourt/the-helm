#!/usr/bin/env node
/**
 * The Helm — LIVE band controller tests. Node 18+, zero deps.
 *
 *   node tools/test-band.js
 *
 * `fetch` is stubbed so the whole loop runs offline and deterministically. The
 * payloads handed to the stub are the REAL ESPN fixtures, so the controller is
 * exercised against the shapes it will actually meet.
 *
 * What is worth testing here is not the arithmetic (graders.js covers that) but
 * the decisions: which leagues get fetched, when a summary is worth its weight,
 * how often to poll, and what happens when the feed dies.
 */

const fs = require('node:fs');
const path = require('node:path');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'espn-real.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Install a fetch stub that records every call. */
function stubFetch({ scoreboards = {}, summaries = {}, fail = new Set() } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url));
    const league = u.pathname.replace('/apis/site/v2/sports/', '').replace(/\/(scoreboard|summary)$/, '');
    if (fail.has(league) || fail.has('*')) throw new Error('network down');
    if (u.pathname.endsWith('/scoreboard')) {
      // Keyed by league alone: the DATE the band asked for is asserted from
      // the recorded URL, not served differently, so a wrong date shows up as
      // a failed assertion rather than as an empty slate.
      return { ok: true, json: async () => ({ events: scoreboards[league] || [] }) };
    }
    if (u.pathname.endsWith('/summary')) {
      const id = u.searchParams.get('event');
      return { ok: true, json: async () => summaries[id] || {} };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return calls;
}

/**
 * `leagues` are today_games' league list — `[{id, slug, label, emoji}]` — and
 * `dateCt` its Central date string. Both default to absent, which is how the
 * pre-today_games cases in here stay exactly the cases they were.
 */
const snapshotWith = (tickets, leagues = null, dateCt = null) => {
  const tiles = { bets_live: { band: 'DAILY', status: 'ok', data: { tickets } } };
  if (leagues) {
    tiles.today_games = {
      band: 'LIVE',
      status: 'ok',
      data: {
        leagues: leagues.map((l) => (typeof l === 'string' ? { id: l, slug: l, label: l, emoji: '' } : l)),
        ...(dateCt ? { date_ct: dateCt } : {}),
        watch_map: {},
        local_teams: {},
      },
    };
  }
  return { schema: 1, tiles };
};

(async () => {
  const { createLiveBand, nextDelay, requirements, LIVE_MS, PRE_MS } = await import('../docs/live/band.js');
  const { ctDateCompact } = await import('../docs/live/espn.js');

  // Real events, with state forced where a scenario needs it.
  const nflPost = FIX.nfl_post_raw;                       // TB 27 @ CIN 33, final
  const nflPre = FIX.nfl_pre_raw;                         // DET @ BUF, scheduled
  const mlbPost = FIX.mlb_post_raw;                       // SF 6 @ STL 5, final
  const asLive = (raw) => {
    const c = JSON.parse(JSON.stringify(raw));
    c.competitions[0].status.type = { ...c.competitions[0].status.type, state: 'in', completed: false, detail: 'Q3 4:12' };
    return c;
  };

  const tkt = (over) => ({
    id: 't1', league: 'football/nfl', espn_event_id: nflPost.id,
    market: 'ml', side: 'home', stake_u: 1, price: -110, ...over,
  });

  // ------------------------------------------------------------ cadence
  console.log('cadence');
  check('a live game polls at 45s', nextDelay({ anyLive: true, anyPre: false }) === LIVE_MS);
  check('45s is actually 45 seconds', LIVE_MS === 45000);
  check('all-pre polls at 5 min', nextDelay({ anyLive: false, anyPre: true }) === PRE_MS);
  check('5 min is actually 5 minutes', PRE_MS === 300000);
  check('all-final stops', nextDelay({ anyLive: false, anyPre: false }) === 0);
  check('a live game wins over a pending one', nextDelay({ anyLive: true, anyPre: true }) === LIVE_MS);

  // ------------------------------------------------------ grading a pass
  console.log('\none pass over real payloads');
  {
    stubFetch({ scoreboards: { 'football/nfl': [nflPost] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    const res = await band.runOnce(snapshotWith([tkt()]));
    check('grades are keyed by ticket id', got.grades.has('t1'));
    check('the real final grades as a WIN (CIN 33)', got.grades.get('t1').state === 'win');
    check('games are keyed by ESPN event id', got.games.has(String(nflPost.id)));
    check('fetched_at is stamped', typeof got.fetched_at === 'string');
    check('no error on a clean pass', got.error === null);
    check('a finished game reports no live and no pre', res.anyLive === false && res.anyPre === false);
    check('which means the loop stops', nextDelay(res) === 0);
  }

  // --------------------------------------------------- event-id matching
  console.log('\nmatching is by event id, never by name');
  {
    stubFetch({ scoreboards: { 'football/nfl': [nflPost] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    // Right teams, wrong id: this must NOT match.
    await band.runOnce(snapshotWith([tkt({ espn_event_id: '999999999', game: 'Tampa Bay Buccaneers at Cincinnati Bengals' })]));
    check('a wrong id does not match on team names', got.grades.get('t1').state === 'pre');
    check('and says no event matched', /no ESPN event matched/.test(got.grades.get('t1').why));
  }

  // ------------------------------------------------------ summary gating
  console.log('\nsummaries are fetched only when they can help');
  {
    const calls = stubFetch({
      scoreboards: { 'football/nfl': [nflPre] },
      summaries: { [nflPre.id]: { scoringPlays: FIX.nfl_scoring_plays } },
    });
    const band = createLiveBand(() => {});
    await band.runOnce(snapshotWith([tkt({ espn_event_id: nflPre.id, market: 'anytime_td', player: 'Chase Brown' })]));
    check('no summary fetch for a pre-game ticket', !calls.some((c) => c.includes('/summary')));
  }
  {
    const calls = stubFetch({
      scoreboards: { 'football/nfl': [nflPost] },
      summaries: { [nflPost.id]: { scoringPlays: FIX.nfl_scoring_plays } },
    });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([tkt({ market: 'anytime_td', player: 'Chase Brown' })]));
    check('summary IS fetched once the game is under way', calls.some((c) => c.includes('/summary')));
    check('and the scorer grades a WIN', got.grades.get('t1').state === 'win');
  }
  {
    const calls = stubFetch({ scoreboards: { 'football/nfl': [nflPost] } });
    const band = createLiveBand(() => {});
    await band.runOnce(snapshotWith([tkt({ market: 'ml' })]));
    check('no summary fetch for a market that does not need one', !calls.some((c) => c.includes('/summary')));
  }
  {
    // Two tickets on the same game: one summary, not two.
    const calls = stubFetch({
      scoreboards: { 'football/nfl': [nflPost] },
      summaries: { [nflPost.id]: { scoringPlays: FIX.nfl_scoring_plays } },
    });
    const band = createLiveBand(() => {});
    await band.runOnce(
      snapshotWith([
        tkt({ id: 'a', market: 'anytime_td', player: 'Chase Brown' }),
        tkt({ id: 'b', market: 'anytime_td', player: 'Baker Mayfield' }),
      ])
    );
    check('one summary per game, not per ticket', calls.filter((c) => c.includes('/summary')).length === 1);
  }

  // ----------------------------------------------------- league fan-out
  console.log('\nleague fan-out');
  {
    const calls = stubFetch({ scoreboards: { 'football/nfl': [nflPost], 'baseball/mlb': [mlbPost] } });
    const band = createLiveBand(() => {});
    await band.runOnce(
      snapshotWith([tkt({ id: 'a' }), tkt({ id: 'b', league: 'baseball/mlb', espn_event_id: mlbPost.id })])
    );
    const sb = calls.filter((c) => c.includes('/scoreboard'));
    check('one scoreboard call per distinct league', sb.length === 2, `got ${sb.length}`);
    check('every scoreboard call passes dates=', sb.every((c) => /[?&]dates=\d{8}/.test(c)));
    check('and a limit', sb.every((c) => /[?&]limit=/.test(c)));
  }
  {
    const calls = stubFetch({ scoreboards: {} });
    const band = createLiveBand(() => {});
    await band.runOnce(snapshotWith([]));
    check('nothing to watch means no fetches at all', calls.length === 0);
  }

  // -------------------------------------------------- today_games slates
  //
  // The whole point of G5: `bets_live` and `today_games` are served by ONE
  // tick. So what is tested here is the PLAN — which calls get made, with
  // which date — and the per-league slate the tile reads.
  console.log('\ntoday_games — one tick serves both tiles');
  {
    const today = ctDateCompact();
    const req = requirements(snapshotWith([tkt({ league: 'baseball/mlb' })], ['baseball/mlb', 'soccer/usa.1']));
    check('a league a ticket and the board share is ONE call', req.plan.length === 2, `plan ${req.plan.length}`);
    check('and both calls are dated today', req.plan.every((p) => p.date === today));
    check('the board leagues come through in payload order', req.leagues.map((l) => l.slug).join() === 'baseball/mlb,soccer/usa.1');
  }
  {
    // RULE 7: `dates=` is built from date_ct by string ops. A snapshot dated
    // to a day that is not today must be queried as THAT day, unshifted —
    // `new Date('2026-01-02')` would send 20260101 to anyone in Central.
    const calls = stubFetch({ scoreboards: { 'baseball/mlb': [] } });
    const band = createLiveBand(() => {});
    await band.runOnce(snapshotWith([], ['baseball/mlb'], '2026-01-02'));
    check('dates= is the payload date, character for character', calls.some((c) => /[?&]dates=20260102(&|$)/.test(c)), calls.join(' '));
    check('and the day is not shifted backwards', !calls.some((c) => /dates=20260101/.test(c)));
  }
  {
    const req = requirements(snapshotWith([], ['baseball/mlb'], 'not-a-date'));
    check('an unusable date_ct falls back to today rather than querying junk', req.boardDate === ctDateCompact());
  }
  {
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost, nflPre], 'soccer/usa.1': [] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([], ['baseball/mlb', 'soccer/usa.1']));
    check('every followed league gets an entry', got.today.leagues.size === 2);
    check('the slate is the whole league, not just ticketed games', got.today.leagues.get('baseball/mlb').games.length === 2);
    check('a league with nothing on gets an empty slate, not a missing one', got.today.leagues.get('soccer/usa.1').games.length === 0);
    check('a healthy league is marked ok', got.today.leagues.get('soccer/usa.1').ok === true);
    check('the payload date rides along for the tile header', typeof got.today.date_ct === 'string');
  }
  {
    // A board game under way drives the cadence even with no tickets at all.
    stubFetch({ scoreboards: { 'baseball/mlb': [asLive(mlbPost)] } });
    const band = createLiveBand(() => {});
    const res = await band.runOnce(snapshotWith([], ['baseball/mlb']));
    check('a live game on the board alone polls at 45s', nextDelay(res) === LIVE_MS);
  }
  {
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost] } });
    const band = createLiveBand(() => {});
    const res = await band.runOnce(snapshotWith([], ['baseball/mlb']));
    check('an all-final board stops the loop', nextDelay(res) === 0);
  }
  {
    // One league's call dies. Its last slate must survive with the feed
    // flagged — "no games today" would be a lie told by the network.
    let got = null;
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost], 'soccer/usa.1': [] } });
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([], ['baseball/mlb', 'soccer/usa.1']));
    stubFetch({ scoreboards: { 'soccer/usa.1': [] }, fail: new Set(['baseball/mlb']) });
    await band.runOnce(snapshotWith([], ['baseball/mlb', 'soccer/usa.1']));
    const mlb = got.today.leagues.get('baseball/mlb');
    check('the last good slate is kept', mlb.games.length === 1);
    check('and that league is marked not-ok', mlb.ok === false);
    check('the healthy league is still ok', got.today.leagues.get('soccer/usa.1').ok === true);
    check('the pass is flagged as partial', got.error === 'some feeds unavailable');
  }

  // ----------------------------------------------------------- failures
  console.log('\nfeed failures');
  {
    stubFetch({ scoreboards: { 'football/nfl': [nflPost] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([tkt()]));
    const goodGrade = got.grades.get('t1').state;

    // Now the whole feed dies.
    stubFetch({ fail: new Set(['*']) });
    await band.runOnce(snapshotWith([tkt()]));
    check('last good grades survive a total feed failure', got.grades.get('t1').state === goodGrade);
    check('and the error flag is raised', got.error === 'feed unavailable');
    check('grades are not wiped to zero', got.grades.size === 1);
  }
  {
    // A blip mid-game must not slow the loop down to 5 minutes.
    stubFetch({ scoreboards: { 'football/nfl': [asLive(nflPost)] } });
    const band = createLiveBand(() => {});
    const good = await band.runOnce(snapshotWith([tkt()]));
    check('baseline: the live game polls at 45s', nextDelay(good) === LIVE_MS);
    stubFetch({ fail: new Set(['*']) });
    const blip = await band.runOnce(snapshotWith([tkt()]));
    check('a blip mid-game HOLDS the 45s cadence', nextDelay(blip) === LIVE_MS);
  }
  {
    // But a blip when nothing was live should not invent a fast cadence.
    stubFetch({ scoreboards: { 'football/nfl': [nflPre] } });
    const band = createLiveBand(() => {});
    await band.runOnce(snapshotWith([tkt({ espn_event_id: nflPre.id })]));
    stubFetch({ fail: new Set(['*']) });
    const blip = await band.runOnce(snapshotWith([tkt({ espn_event_id: nflPre.id })]));
    check('a blip with nothing live stays at 5 min', nextDelay(blip) === PRE_MS);
  }
  {
    // One league down, one up: the healthy one must still grade.
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost] }, fail: new Set(['football/nfl']) });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(
      snapshotWith([tkt({ id: 'a' }), tkt({ id: 'b', league: 'baseball/mlb', espn_event_id: mlbPost.id, side: 'away' })])
    );
    check('a healthy league still grades', got.grades.get('b').state === 'win');
    check('the dead league degrades to no-match', got.grades.get('a').state === 'pre');
    check('partial failure is flagged', got.error === 'some feeds unavailable');
  }

  // ----------------------------------------------------- live scheduling
  console.log('\nan in-progress game');
  {
    stubFetch({ scoreboards: { 'football/nfl': [asLive(nflPost)] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    const res = await band.runOnce(snapshotWith([tkt()]));
    check('an in-progress game is detected', res.anyLive === true);
    check('so the loop drops to 45s', nextDelay(res) === LIVE_MS);
    check('and the grade is a lean, not a result', got.grades.get('t1').state === 'lead');
    check('the pill reads LEADING', got.grades.get('t1').label === 'LEADING');
  }
  {
    stubFetch({ scoreboards: { 'football/nfl': [nflPre] } });
    const band = createLiveBand(() => {});
    const res = await band.runOnce(snapshotWith([tkt({ espn_event_id: nflPre.id })]));
    check('a scheduled game keeps the 5 min cadence', nextDelay(res) === PRE_MS);
  }
  {
    // A game only this board cares about drives the cadence, not the slate.
    stubFetch({ scoreboards: { 'football/nfl': [nflPost, asLive(nflPre)] } });
    const band = createLiveBand(() => {});
    const res = await band.runOnce(snapshotWith([tkt()])); // ticket on the FINAL game only
    check('an unrelated live game does not speed up the loop', nextDelay(res) === 0);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})();
