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
  const { ctDateCompact, ctDayOf, onCtDate } = await import('../docs/live/espn.js');

  // ------------------------------------------------- the Central-day filter
  //
  // The shared function both slate paths use. Pure, so it is tested here
  // rather than inferred from a rendered sheet.
  console.log('onCtDate — one Central day, exactly');
  {
    const ev = (startDate) => ({ id: startDate, startDate });
    const list = [
      ev('2026-09-16T17:15Z'), // 12:15 PM CT, the 16th
      ev('2026-09-17T03:05Z'), // 10:05 PM CT, the 16th — next day in UTC
      ev('2026-09-17T17:15Z'), // the 17th
      ev('2026-09-16T04:30Z'), // 11:30 PM CT, the 15th
    ];
    check('a UTC instant maps to its Central day', ctDayOf('2026-09-17T03:05Z') === '20260916');
    check('and a plain daytime one to the obvious answer', ctDayOf('2026-09-16T17:15Z') === '20260916');
    check('junk maps to nothing rather than to 1970', ctDayOf('not-a-time') === '' && ctDayOf(null) === '');
    // Rule 7, stated as a fact rather than a hope: an offsetless calendar
    // string handed to this function comes back a day EARLY, because that is
    // what the browser does with it. Which is exactly why nothing on the page
    // hands it one — `onCtDate` takes the calendar date as its second
    // argument and compares it as a string.
    check('a date-only string comes back a day early, as JS insists', ctDayOf('2026-09-16') === '20260915', ctDayOf('2026-09-16'));

    check('the dashed form filters', onCtDate(list, '2026-09-16').length === 2);
    check('the compact form filters the same', onCtDate(list, '20260916').length === 2);
    check('a late Central kick stays on its Central day', onCtDate(list, '2026-09-16').some((e) => e.id === '2026-09-17T03:05Z'));
    check('a game 24h later is out', !onCtDate(list, '2026-09-16').some((e) => e.id === '2026-09-17T17:15Z'));
    check('and one the evening before is out', !onCtDate(list, '2026-09-16').some((e) => e.id === '2026-09-16T04:30Z'));
    check('an unreadable date filters nothing rather than everything', onCtDate(list, 'whenever').length === 4);
    check('and so does no date at all', onCtDate(list, null).length === 4);
    check('an event with no stamp is kept — we cannot prove it is wrong', onCtDate([{ id: 'x' }], '2026-09-16').length === 1);
    check('a non-array is survived', onCtDate(null, '2026-09-16').length === 0);
    check('the input array is never mutated', (() => { const a = [...list]; onCtDate(a, '2026-09-16'); return a.length === 4; })());
  }

  // Real events, with state forced where a scenario needs it.
  const nflPost = FIX.nfl_post_raw;                       // TB 27 @ CIN 33, final
  const nflPre = FIX.nfl_pre_raw;                         // DET @ BUF, scheduled
  const mlbPost = FIX.mlb_post_raw;                       // SF 6 @ STL 5, final
  /**
   * A fixture clone moved to a different instant.
   *
   * The board path now filters its slate to the Central day it is dated for
   * (ESPN's `dates=` is a hint, not a filter), so a fixture from a fixed day
   * in the past only reaches the board when the snapshot is dated to match.
   * That is the point of the filter, so the tests date their snapshots rather
   * than the filter loosening.
   */
  const redate = (raw, iso) => {
    const c = JSON.parse(JSON.stringify(raw));
    c.date = iso;
    if (c.competitions?.[0]) c.competitions[0].date = iso;
    return c;
  };

  // mlb_post_raw is 2026-09-16T17:15Z — 12:15 PM Central on the 16th.
  const MLB_DAY = '2026-09-16';

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
  check('a live game polls at 20s (B14)', nextDelay({ anyLive: true, anyPre: false }) === LIVE_MS);
  check('20s is actually 20 seconds (B14; was 45)', LIVE_MS === 20000);
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
    // 2026-10-02: tickets are queried on their OWN kick_ct day, not today's —
    // a Saturday CFB ticket on a Friday board was never on today's slate.
    const req = requirements(snapshotWith([
      tkt({ id: 'fri', league: 'football/college-football', kick_ct: '2026-10-02 6:00 PM' }),
      tkt({ id: 'sat', league: 'football/college-football', kick_ct: '2026-10-03' }),
    ], []));
    const plan = req.plan.map((p) => `${p.league}|${p.date}`);
    check('a ticket is queried on its own kick_ct day', plan.includes('football/college-football|20261003'), plan.join(' '));
    check('two game days in one league are two calls', plan.includes('football/college-football|20261002') && plan.length === 2, plan.join(' '));
  }
  {
    const req = requirements(snapshotWith([tkt({ kick_ct: 'Sat 11 AM' })], []));
    check('an unreadable kick_ct falls back to today', req.plan.length === 1 && req.plan[0].date === ctDateCompact(), JSON.stringify(req.plan));
  }
  {
    // Both events on the SAME Central day as the snapshot, so the filter is
    // not what is under test here.
    const second = redate(nflPre, '2026-09-17T00:15Z'); // 7:15 PM CT on the 16th
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost, second], 'soccer/usa.1': [] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([], ['baseball/mlb', 'soccer/usa.1'], MLB_DAY));
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
    const res = await band.runOnce(snapshotWith([], ['baseball/mlb'], MLB_DAY));
    check('a live game on the board alone polls at 20s', nextDelay(res) === LIVE_MS);
  }
  {
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost] } });
    const band = createLiveBand(() => {});
    const res = await band.runOnce(snapshotWith([], ['baseball/mlb'], MLB_DAY));
    check('an all-final board stops the loop', nextDelay(res) === 0);
  }
  {
    // One league's call dies. Its last slate must survive with the feed
    // flagged — "no games today" would be a lie told by the network.
    let got = null;
    stubFetch({ scoreboards: { 'baseball/mlb': [mlbPost], 'soccer/usa.1': [] } });
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([], ['baseball/mlb', 'soccer/usa.1'], MLB_DAY));
    stubFetch({ scoreboards: { 'soccer/usa.1': [] }, fail: new Set(['baseball/mlb']) });
    await band.runOnce(snapshotWith([], ['baseball/mlb', 'soccer/usa.1'], MLB_DAY));
    const mlb = got.today.leagues.get('baseball/mlb');
    check('the last good slate is kept', mlb.games.length === 1);
    check('and that league is marked not-ok', mlb.ok === false);
    check('the healthy league is still ok', got.today.leagues.get('soccer/usa.1').ok === true);
    check('the pass is flagged as partial', got.error === 'some feeds unavailable');
  }

  // ------------------------------------------- the date filter (today path)
  //
  // ESPN's `dates=` is a HINT. A thin day comes back with its neighbour
  // attached, which today has been getting away with because a populated day
  // groups plausibly. The board must show the day it is DATED for.
  console.log('\nthe board shows one Central day and no other');
  {
    const onDay = mlbPost;                                   // 12:15 PM CT, the 16th
    const dayAfter = redate(nflPre, '2026-09-17T17:15Z');    // 12:15 PM CT, the 17th
    stubFetch({ scoreboards: { 'baseball/mlb': [onDay, dayAfter] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([], ['baseball/mlb'], MLB_DAY));
    const slate = got.today.leagues.get('baseball/mlb').games;
    check('an event 24h off the board date is dropped', slate.length === 1, `${slate.length} games`);
    check('and it is the right one that stayed', slate[0].id === String(mlbPost.id));
  }
  {
    // A game late enough in Central to be the NEXT day in UTC still belongs
    // to the Central day — the filter measures the zone, not the Z.
    const lateCt = redate(mlbPost, '2026-09-17T03:05Z'); // 10:05 PM CT on the 16th
    stubFetch({ scoreboards: { 'baseball/mlb': [lateCt] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([], ['baseball/mlb'], MLB_DAY));
    check('a late Central kick is not thrown into tomorrow', got.today.leagues.get('baseball/mlb').games.length === 1);
  }
  {
    // The ticket path is deliberately NOT filtered: a ticket names a game by
    // id, and which calendar day the board is showing is none of its concern.
    stubFetch({ scoreboards: { 'football/nfl': [nflPost] } });
    let got = null;
    const band = createLiveBand((s) => (got = s));
    await band.runOnce(snapshotWith([tkt()], ['football/nfl'], MLB_DAY));
    check('a ticket still grades off a game the board filtered out', got.grades.get('t1').state === 'win');
    check('though the board itself does not show it', got.today.leagues.get('football/nfl').games.length === 0);
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
    check('baseline: the live game polls at 20s', nextDelay(good) === LIVE_MS);
    stubFetch({ fail: new Set(['*']) });
    const blip = await band.runOnce(snapshotWith([tkt()]));
    check('a blip mid-game HOLDS the 20s cadence', nextDelay(blip) === LIVE_MS);
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
    check('so the loop drops to 20s', nextDelay(res) === LIVE_MS);
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

  // ------------------------------------------------- v1.4: college, filtered
  console.log('\ntoday_games v1.4 — the college board filter (C2–C7)');
  {
    const { slate, todayGamesPayload, COLLEGE_EVT } = require('./mock-espn.js');
    const { boardFilter, ticketIds, ticketedGames } = await import('../docs/live/board-filter.js');
    const { normalizeEvent } = await import('../docs/live/espn.js');
    const DAY = '2026-11-07';
    const RAW = slate(DAY, '2026-11-08', '2026-11-09');
    const LEAGUES = todayGamesPayload(DAY, '2026-11-08').leagues;
    const CFB = LEAGUES.find((l) => l.slug === 'football/college-football');
    const CBB = LEAGUES.find((l) => l.slug === 'basketball/mens-college-basketball');
    const norm = (slug) => RAW.leagues[slug].map((e) => normalizeEvent(e, slug));
    const cfb = norm(CFB.slug);
    const cbb = norm(CBB.slug);
    const ids = (gs) => gs.map((g) => g.id).sort().join();

    // C3: the two facts on every side.
    const byId = (gs, id) => gs.find((g) => g.id === id);
    check('rank: curatedRank 12 -> 12', byId(cfb, COLLEGE_EVT.cfbRank).away.rank === 12);
    check('rank: curatedRank 99 (unranked) -> null', byId(cfb, COLLEGE_EVT.cfbRank).home.rank === null);
    check('conf: conferenceId carried as a string', byId(cfb, COLLEGE_EVT.cfbConf).home.conf === '5');
    {
      const e = JSON.parse(JSON.stringify(RAW.leagues[CBB.slug][0]));
      const c = e.competitions[0].competitors;
      c[0].curatedRank = { current: 17 };
      delete c[1].curatedRank;
      delete c[1].team.conferenceId;
      const g = normalizeEvent(e, CBB.slug);
      const sides = [g.home, g.away];
      const ranked = sides.find((x) => x.rank === 17);
      const bare = sides.find((x) => x !== ranked);
      check('rank: curatedRank 17 -> 17', !!ranked);
      check('rank: a missing curatedRank -> null', bare.rank === null);
      check('conf: a missing conferenceId -> empty string', bare.conf === '');
      for (const v of [0, 26, '7', 'x', null]) {
        c[0].curatedRank = { current: v };
        const r = normalizeEvent(e, CBB.slug);
        const got = [r.home.rank, r.away.rank];
        check(`rank: curatedRank ${JSON.stringify(v)} -> ${v === '7' ? 7 : 'null'}`, v === '7' ? got.includes(7) : got.every((x) => x === null));
      }
    }
    {
      const pro = normalizeEvent(RAW.leagues['baseball/mlb'][0], 'baseball/mlb');
      check('NFL/MLB sides carry rank null and conf ""', pro.home.rank === null && pro.away.rank === null && pro.home.conf === '' && pro.away.conf === '');
    }

    // C2/C4/C5: the pure filter.
    check('CFB filter keeps the ranked game and the conference game, drops the mid-majors', ids(boardFilter(cfb, CFB.filter, new Set())) === [COLLEGE_EVT.cfbRank, COLLEGE_EVT.cfbConf].sort().join());
    check('NCAAB filter drops both mid-major games with no ticket', ids(boardFilter(cbb, CBB.filter, new Set())) === [COLLEGE_EVT.cbbRank, COLLEGE_EVT.cbbConf].sort().join());
    check('a ticket keeps a game the filter would drop', boardFilter(cbb, CBB.filter, new Set([COLLEGE_EVT.cbbPinned])).some((g) => g.id === COLLEGE_EVT.cbbPinned));
    check('the ticket set keeps nothing else extra', boardFilter(cbb, CBB.filter, new Set([COLLEGE_EVT.cbbPinned])).length === 3);
    check('top alone: rank clause only', ids(boardFilter(cfb, { top: 25 }, null)) === COLLEGE_EVT.cfbRank);
    check('top narrower than the rank drops it', boardFilter(cfb, { top: 10, conferences: [] }, null).length === 0);
    check('conferences alone: conference clause only', ids(boardFilter(cfb, { conferences: ['5'] }, null)) === COLLEGE_EVT.cfbConf);
    check('conference ids compare as strings (5 matches "5")', ids(boardFilter(cfb, { conferences: [5] }, null)) === COLLEGE_EVT.cfbConf);
    check('an empty conf never matches an empty-string entry', boardFilter([normalizeEvent(RAW.leagues['baseball/mlb'][0], 'baseball/mlb')], { conferences: [''] }, null).length === 0);
    for (const [name, f] of [['undefined', undefined], ['null', null], ['a string', 'top25'], ['an array', [25]], ['{}', {}], ['top NaN, conferences not an array', { top: NaN, conferences: 'x' }], ['top "25" (a string)', { top: '25' }]]) {
      check(`absent/garbage filter (${name}) keeps everything`, boardFilter(cfb, f, null).length === cfb.length);
    }
    check('garbage games never throw', (() => { try { return boardFilter(null, CFB.filter).length === 0 && boardFilter([null, 3, 'x', {}], CFB.filter, 'nope').length === 0; } catch { return false; } })());
    check('returns a new array', boardFilter(cfb, null) !== cfb);

    // ticketIds / ticketedGames — the moved helper.
    const snapT = { tiles: { bets_live: { data: { tickets: [{ id: 't1', label: 'A', espn_event_id: '11' }, { id: 't2', market: 'parlay', label: 'P', games: [{ espn_event_id: '22' }, { espn_event_id: '11' }] }] } } } };
    check('ticketedGames: singles by id, parlays by each game', JSON.stringify([...ticketedGames(snapT)]) === JSON.stringify([['11', ['A', 'P']], ['22', ['P']]]));
    check('ticketIds is the Set of those keys', ticketIds(snapT) instanceof Set && [...ticketIds(snapT)].join() === '11,22');
    check('ticketIds of nothing is empty', ticketIds(null).size === 0 && ticketIds({ tiles: { bets_live: { data: { tickets: 'x' } } } }).size === 0);

    // C7: groups= on the URL.
    {
      const calls = stubFetch({});
      const espn = await import('../docs/live/espn.js');
      await espn.fetchScoreboard('football/college-football', '20261107');
      await espn.fetchScoreboard('basketball/mens-college-basketball', '20261107');
      await espn.fetchScoreboard('football/nfl', '20261107');
      check('CFB scoreboard URL carries groups=80', /college-football\/scoreboard\?.*&groups=80$/.test(calls[0]), calls[0]);
      check('NCAAB scoreboard URL carries groups=50', /mens-college-basketball\/scoreboard\?.*&groups=50$/.test(calls[1]), calls[1]);
      check('NFL scoreboard URL carries neither', !/groups=/.test(calls[2]), calls[2]);
    }

    // requirements() passes `filter` through untouched.
    {
      const snap = snapshotWith([], LEAGUES, DAY);
      const req = requirements(snap);
      check('requirements carries each league’s filter', req.leagues.find((l) => l.slug === CFB.slug).filter === CFB.filter);
      check('a league with no filter carries undefined', req.leagues.find((l) => l.slug === 'baseball/mlb').filter === undefined);
    }

    // C4: the band filters byLeague, never the ticket path.
    {
      const scoreboards = { [CFB.slug]: RAW.leagues[CFB.slug], [CBB.slug]: RAW.leagues[CBB.slug] };
      stubFetch({ scoreboards });
      let got = null;
      const band = createLiveBand((x) => (got = x));
      const tkt = { id: 'tc', league: CBB.slug, espn_event_id: COLLEGE_EVT.cbbPinned, kick_ct: `${DAY} 12:00`, market: 'ml', side: 'away', label: 'Hollow Creek ML', stake_u: 1, to_win_u: 1.2 };
      await band.runOnce(snapshotWith([tkt], [CFB, CBB], DAY));
      check('CFB board count is the filtered count (2 of 3)', got.today.leagues.get(CFB.slug).games.length === 2);
      check('NCAAB board count is filtered + the ticket (3 of 4)', got.today.leagues.get(CBB.slug).games.length === 3);
      check('the pinned game is on the board', got.today.leagues.get(CBB.slug).games.some((g) => g.id === COLLEGE_EVT.cbbPinned));
      check('the dropped CFB game is NOT on the board', !got.today.leagues.get(CFB.slug).games.some((g) => g.id === COLLEGE_EVT.cfbDrop));
      check('…but live.games still holds it (the ticket path is never filtered)', got.games.has(COLLEGE_EVT.cfbDrop) && got.games.has(COLLEGE_EVT.cbbDrop));
      check('the ticket still grades off its game', got.grades.get('tc')?.state === 'win', got.grades.get('tc')?.state);
    }
    {
      // A dropped LIVE game holds no clock: CFB alone, with its ranked and
      // conference games pre/post and only the dropped mid-major `in`.
      stubFetch({ scoreboards: { [CFB.slug]: RAW.leagues[CFB.slug] } });
      const band = createLiveBand(() => {});
      const res = await band.runOnce(snapshotWith([], [CFB], DAY));
      check('a dropped in-progress game does not make anyLive true', res.anyLive === false && res.anyPre === true);
      stubFetch({ scoreboards: { [CFB.slug]: RAW.leagues[CFB.slug] } });
      const unf = await createLiveBand(() => {}).runOnce(snapshotWith([], [{ ...CFB, filter: undefined }], DAY));
      check('…while the same slate unfiltered does', unf.anyLive === true);
    }
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})();
