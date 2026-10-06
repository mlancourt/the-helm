#!/usr/bin/env node
/**
 * The Helm — the invented ESPN slate behind `?mock=1`, and the `today_games`
 * payload that goes with it. Node, zero deps, CommonJS (it is a tool, and
 * tools/ speaks require).
 *
 * WHY THIS FILE EXISTS. `today_games` renders almost nothing from the snapshot:
 * the engine publishes the league list and the watch map, and every game comes
 * from ESPN in the browser. So a mock snapshot alone cannot show the tile
 * working — the pre / in / post rows and the three watch-chip verdicts would
 * only appear on a day when the real slate happened to supply them. This is
 * the other half: a fake scoreboard, in ESPN's real response shape, that the
 * page loads instead of the live feed when `?mock=1`.
 *
 * It lives beside the snapshot generator because the two have to agree. The
 * broadcast NAMES below are chosen against the watch map below, so between
 * them they exercise every branch of the chip logic:
 *
 *   FS1              -> ✓ YouTube TV                (mapped, national)
 *   CreamCity.TV     -> ✓ CreamCity.TV (…, yours)   (mapped, and its market
 *                                                    is Home for a local team
 *                                                    — the map wins either way)
 *   MLB.TV           -> MLB.TV                      (unmapped, printed as-is)
 *   Herons.TV        -> regional — not yours        (Away market, away team
 *                                                    is not in local_teams)
 *   (no broadcasts)  -> no listing
 *
 * EVERY team, game, score and channel-that-is-not-a-real-channel below is
 * invented. League slugs are real because ESPN's API needs them; event ids are
 * fake but wear ESPN's real shapes (9 digits for US leagues, 6 for soccer) so
 * they cannot collide with a real game.
 *
 * Rule 7: the Central date arrives as a 'YYYY-MM-DD' string and is never
 * handed to `new Date()`. `ctInstant` below builds a real UTC instant for a
 * Central wall-clock time out of the parts, using Intl with an explicit zone
 * to measure the offset — which is how you get "7:10 PM Central today" right
 * without assuming a fixed offset.
 */

const CT = 'America/Chicago';

const CT_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: CT,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * A Central wall-clock time ('YYYY-MM-DD', 'HH:MM') -> the UTC ISO instant.
 *
 * Guess the instant as if Central were UTC, ask Intl what that instant reads
 * as in Central, and shift by the difference. Two passes settle it even across
 * a DST boundary.
 */
function ctInstant(ymd, hhmm) {
  const [Y, M, D] = String(ymd).split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  const want = Date.UTC(Y, M - 1, D, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = CT_PARTS.formatToParts(new Date(t)).reduce((a, x) => ((a[x.type] = x.value), a), {});
    const got = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    const diff = want - got;
    if (!diff) break;
    t += diff;
  }
  return new Date(t).toISOString();
}

// ------------------------------------------------------------ the tile payload

/** The four leagues of spec G2, with invented-but-plausible emoji. */
const LEAGUES = [
  { id: 'mlb', slug: 'baseball/mlb', label: 'MLB', emoji: '⚾' },
  { id: 'mls', slug: 'soccer/usa.1', label: 'MLS', emoji: '⚽' },
  { id: 'epl', slug: 'soccer/eng.1', label: 'EPL', emoji: '\u{1F3F4}' },
  { id: 'laliga', slug: 'soccer/esp.1', label: 'La Liga', emoji: '\u{1F1EA}\u{1F1F8}' },
];

/**
 * Service and channel names are real where a chip has to look like the real
 * thing; the two `.TV` feeds are invented, because a fake regional is the
 * whole point of the regional case.
 */
const SERVICES = ['YouTube TV', 'Apple TV+', 'ESPN+', 'Peacock', 'Paramount+', 'Max'];

const WATCH_MAP = {
  ESPN: 'YouTube TV',
  'ESPN Deportes': 'YouTube TV',
  FS1: 'YouTube TV',
  FOX: 'YouTube TV',
  'ESPN+': 'ESPN+',
  Peacock: 'Peacock',
  'Apple TV': 'Apple TV+',
  'MLS Season Pass': 'Apple TV+',
  // The map is also how the vault says "this particular RSN IS mine".
  'CreamCity.TV': 'CreamCity.TV (regional, yours)',
};

/** The one team whose Home/Away feed is his. Invented abbreviation. */
const LOCAL_TEAMS = { 'baseball/mlb': ['CCN'] };

/**
 * `nextCt` is the engine's `date_next_ct` (published as of 2026-09-21) — the
 * Central day after `todayCt`. The ENGINE computes it, in Central; this file
 * is handed both and does no arithmetic of its own, which is also why the
 * page can do none.
 */
function todayGamesPayload(todayCt, nextCt) {
  return {
    title: "Today's Games",
    date_ct: todayCt,
    date_next_ct: nextCt,
    leagues: LEAGUES,
    services: SERVICES,
    watch_map: WATCH_MAP,
    local_teams: LOCAL_TEAMS,
  };
}

// ----------------------------------------------------------- the fake slate

/**
 * The parlay games (B16–B21). Three invented NFL games — one live, one still
 * to come, one final — that the two mock parlays in make-mock-data.js ride
 * on, plus the box scores their legs are graded off.
 */
const PARLAY_EVT = { live: '401990501', pre: '401990502', post: '401990503' };

/**
 * A box-score block, ESPN's shape. The `keys` arrays below are deliberately
 * NOT in ESPN's order (live sample 10/4: rushing is attempts, yards, avg, td,
 * long) — the graders must find a column by its key, never its position.
 */
const block = (name, keys, rows) => ({
  name,
  keys,
  athletes: rows.map(([id, displayName, byKey]) => ({
    athlete: { id, displayName },
    stats: keys.map((k) => String(byKey[k] ?? '0')),
  })),
});
const RUSH_KEYS = ['rushingTouchdowns', 'longRushing', 'yardsPerRushAttempt', 'rushingAttempts', 'rushingYards'];
const PASS_KEYS = ['QBRating', 'interceptions', 'passingYards', 'completions/passingAttempts', 'passingTouchdowns'];
const REC_KEYS = ['receivingYards', 'longReception', 'receptions', 'receivingTargets', 'receivingTouchdowns'];

function parlaySummaries() {
  return {
    // LIVE, Q3: Okafor has 47 rush yds (O59.5 trailing); Lindqvist has thrown
    // for 212 (O199.5 cashed mid-game); Kowalczyk has 2 catches (O2.5
    // trailing). Bell — on the SGP's under — is in no block at all: a player
    // missing from a started box score has recorded none of it.
    [PARLAY_EVT.live]: {
      scoringPlays: [
        { type: { abbreviation: 'TD', text: 'Rushing Touchdown' }, text: 'Renny Okafor 3 Yd Run (Tad Moss Kick)', period: { number: 1 }, homeScore: 0, awayScore: 7 },
      ],
      boxscore: {
        players: [
          {
            team: { id: '91', abbreviation: 'HRK' },
            statistics: [
              block('passing', PASS_KEYS, [['9001', 'Sven Lindqvist', { passingYards: 212, 'completions/passingAttempts': '17/24', passingTouchdowns: 1 }]]),
              block('rushing', RUSH_KEYS, [['9002', 'Renny Okafor', { rushingYards: 47, rushingAttempts: 11, rushingTouchdowns: 1, longRushing: 14 }]]),
              block('receiving', REC_KEYS, [['9003', 'Dariusz Kowalczyk', { receptions: 2, receivingYards: 38, receivingTargets: 4 }]]),
            ],
          },
          {
            team: { id: '92', abbreviation: 'FDI' },
            statistics: [block('rushing', RUSH_KEYS, [['9004', 'Abel Strand', { rushingYards: 22, rushingAttempts: 6 }]])],
          },
        ],
      },
    },
    // FINAL: Ibáñez — accented in the box score, plain on the slip — scored.
    [PARLAY_EVT.post]: {
      scoringPlays: [
        { type: { abbreviation: 'TD', text: 'Passing Touchdown' }, text: 'Tomás Ibáñez 18 Yd pass from Cole Varga (Ike Dunn Kick)', period: { number: 2 }, homeScore: 7, awayScore: 0 },
      ],
      boxscore: {
        players: [
          {
            team: { id: '95', abbreviation: 'CVD' },
            statistics: [block('receiving', REC_KEYS, [['9011', 'Tomás Ibáñez', { receptions: 5, receivingYards: 71, receivingTouchdowns: 1 }]])],
          },
        ],
      },
    },
  };
}

/** The three parlay games as scoreboard events, on `todayCt`. */
function parlayEvents(at) {
  return [
    event({
      id: PARLAY_EVT.live,
      date: at('12:00'),
      state: 'in',
      shortDetail: '3rd Quarter',
      period: 3,
      clock: '8:41',
      venue: 'Harbor Field',
      away: { abbr: 'HRK', name: 'Harbor Kestrels', short: 'Kestrels', score: 17, linescores: [7, 3, 7] },
      home: { abbr: 'FDI', name: 'Foundry Ironsides', short: 'Ironsides', score: 10, linescores: [0, 10, 0] },
      situation: {
        down: 2,
        distance: 7,
        downDistanceText: '2nd & 7 at FDI 14',
        isRedZone: true,
        possession: `${PARLAY_EVT.live}-away`,
        lastPlay: { text: ' (Shotgun) S.Lindqvist pass short right to D.Kowalczyk to FDI 14 for 9 yards (A.Strand). The longest play-by-play line the feed sends' },
      },
    }),
    event({
      id: PARLAY_EVT.pre,
      date: at('19:20'),
      state: 'pre',
      venue: 'Pike Bowl',
      away: { abbr: 'NPS', name: 'North Pike Sentinels', short: 'Sentinels', score: 0 },
      home: { abbr: 'LKL', name: 'Lakeshore Loons', short: 'Loons', score: 0 },
    }),
    event({
      id: PARLAY_EVT.post,
      date: at('12:00'),
      state: 'post',
      venue: 'Drayworks Stadium',
      away: { abbr: 'GCF', name: 'Granite City Foremen', short: 'Foremen', score: 13, linescores: [3, 3, 7, 0] },
      home: { abbr: 'CVD', name: 'Cedar Valley Drays', short: 'Drays', score: 24, linescores: [7, 7, 3, 7] },
    }),
  ];
}

const STATUS = {
  pre: { state: 'pre', name: 'STATUS_SCHEDULED', completed: false, detail: 'Scheduled', shortDetail: 'Scheduled' },
  in: { state: 'in', name: 'STATUS_IN_PROGRESS', completed: false, detail: 'In Progress', shortDetail: 'In Progress' },
  post: { state: 'post', name: 'STATUS_FINAL', completed: true, detail: 'Final', shortDetail: 'Final' },
};

/**
 * One event in ESPN's shape. Scores are STRINGS, as ESPN sends them; that is
 * gotcha #1 in live/espn.js and the mock must not paper over it.
 */
function event({ id, date, away, home, state, shortDetail, period = 0, clock = '0:00', venue, broadcasts = [], geo = [], situation = null, odds = null }) {
  const side = (t, homeAway) => {
    const c = {
      id: `${id}-${homeAway}`,
      homeAway,
      score: String(t.score ?? 0),
      team: { abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short },
    };
    // linescores is absent pre-game and for soccer (gotcha #2).
    if (t.linescores) c.linescores = t.linescores.map((v, i) => ({ value: v, displayValue: String(v), period: i + 1 }));
    if (state === 'post') c.winner = Number(t.score) > Number((homeAway === 'home' ? away : home).score);
    return c;
  };

  const st = { ...STATUS[state] };
  if (shortDetail) {
    st.detail = shortDetail;
    st.shortDetail = shortDetail;
  }

  return {
    id: String(id),
    uid: `s:1~l:1~e:${id}`,
    date,
    name: `${away.name} at ${home.name}`,
    shortName: `${away.abbr} @ ${home.abbr}`,
    competitions: [
      {
        id: String(id),
        date,
        venue: { fullName: venue, address: { city: 'Nowhere', state: 'Invented' }, indoor: false },
        competitors: [side(home, 'home'), side(away, 'away')],
        status: { period, displayClock: clock, type: st },
        broadcasts,
        geoBroadcasts: geo,
        // B21: only a live game carries one, and `possession` is a TEAM id.
        ...(situation ? { situation } : {}),
        // O1: ESPN sends ONE provider's board as `odds[0]`; absent when the
        // book never opened (and on every game ESPN has archived).
        ...(odds ? { odds: [odds] } : {}),
      },
    ],
    status: { period, displayClock: clock, type: st },
  };
}

const tv = (name, market) => ({ type: { shortName: 'TV' }, market: { type: market }, media: { shortName: name } });
const stream = (name, market) => ({ type: { shortName: 'STREAMING' }, market: { type: market }, media: { shortName: name } });

/**
 * One DraftKings board in ESPN's shape (Today's Games O1/O2), verified on the
 * 2026-10-06 NFL · MLB · EPL · La Liga · Serie A · UCL · UEL scoreboards —
 * identical across sports; soccer adds `draw`. Every value is a STRING, as
 * ESPN sends it, and the total lines carry their `o`/`u` prefix.
 *
 *   odds({ spread: ['-1.5', '+150', '+1.5', '-180'], total: ['8.5', '-110', '-110'],
 *          ml: ['-130', '+110'], open: { spread: […], total: […] } })
 *
 * `spread` is [homeLine, homePrice, awayLine, awayPrice]; `total` is
 * [line, overPrice, underPrice]; `ml` is [home, away] or [home, away, draw].
 * `open` reuses the first two shapes; when omitted, open === close.
 */
function odds({ spread, total, ml, open = {}, provider = 'DraftKings' }) {
  const leg = (line, price) => ({ line, odds: price });
  const sp = (s) => (s ? { home: leg(s[0], s[1]), away: leg(s[2], s[3]) } : null);
  const tt = (t) => (t ? { over: leg(`o${t[0]}`, t[1]), under: leg(`u${t[0]}`, t[2]) } : null);
  const both = (make, close, openV) => {
    const c = make(close);
    const o = make(openV || close);
    if (!c) return undefined;
    const out = {};
    for (const k of Object.keys(c)) out[k] = { open: o[k], close: c[k] };
    return out;
  };
  const mlObj = (m) => {
    if (!m) return undefined;
    const out = { home: { open: { odds: m[0] }, close: { odds: m[0] } }, away: { open: { odds: m[1] }, close: { odds: m[1] } } };
    if (m[2]) out.draw = { open: { odds: m[2] }, close: { odds: m[2] } };
    return out;
  };
  const favHome = spread && Number(spread[0]) <= Number(spread[2]);
  const o = {
    provider: { id: '2000', name: provider, priority: 1 },
    details: spread ? `${favHome ? 'HOME' : 'AWAY'} ${favHome ? spread[0] : spread[2]}` : '',
    overUnder: total ? Number(total[0]) : undefined,
    spread: spread ? Number(favHome ? spread[0] : spread[2]) : undefined,
    // The flat legacy fields: ESPN now sends these empty beside the objects.
    homeTeamOdds: { favorite: !!favHome, underdog: !favHome, moneyLine: undefined, spreadOdds: undefined },
    awayTeamOdds: { favorite: !favHome, underdog: !!favHome, moneyLine: undefined, spreadOdds: undefined },
  };
  const ps = both(sp, spread, open.spread);
  if (ps) o.pointSpread = { displayName: 'Spread', shortDisplayName: 'Spread', ...ps };
  const tot = both(tt, total, open.total);
  if (tot) o.total = { displayName: 'Total', shortDisplayName: 'Total', ...tot };
  const m = mlObj(ml);
  if (m) o.moneyline = { displayName: 'Moneyline', shortDisplayName: 'ML', ...m };
  return o;
}

/**
 * `{leagues: {<slug>: [event]}, summaries: {}}` — what docs/mock/espn-today.json
 * holds and what app.js hands the LIVE band in place of the real feed.
 *
 * Deliberately NOT in kick order: sorting by `start` is the tile's job and the
 * mock should be able to catch it not doing it.
 */
function slate(todayCt, nextCt, afterCt) {
  const at = (hhmm) => ctInstant(todayCt, hhmm);
  const tmr = (hhmm) => ctInstant(nextCt, hhmm);
  // The day AFTER tomorrow. ESPN's `dates=` is a hint, so a thin date comes
  // back with its neighbour attached — the one event below dated here is the
  // neighbour, and the tomorrow sheet must drop it.
  const after = (hhmm) => ctInstant(afterCt, hhmm);

  return {
    _comment:
      'INVENTED ESPN SLATE for ?mock=1. Real league slugs and response shapes; every team, score, channel and event id is fake. Regenerate with: node tools/make-mock-data.js --espn > docs/mock/espn-today.json',
    date_ct: todayCt,
    date_next_ct: nextCt,
    leagues: {
      'baseball/mlb': [
        // in progress, and his: a national channel he has plus the regional
        // the vault has claimed. Out of order on purpose (19:10 kick listed
        // before the 13:10 one).
        event({
          id: '401998201',
          date: at('19:10'),
          state: 'in',
          shortDetail: 'Top 7th',
          period: 7,
          venue: 'Cream City Yard',
          away: { abbr: 'LKL', name: 'Lakeshore Loons', short: 'Loons', score: 2, linescores: [0, 1, 0, 0, 1, 0, 0] },
          home: { abbr: 'CCN', name: 'Cream City Nine', short: 'Nine', score: 4, linescores: [1, 0, 2, 0, 0, 1, 0] },
          broadcasts: [
            { market: 'national', names: ['FS1'] },
            { market: 'home', names: ['CreamCity.TV'] },
          ],
          // The same two names again, which is how ESPN really does it — the
          // normalizer must dedupe rather than print each twice.
          geo: [tv('FS1', 'National'), stream('CreamCity.TV', 'Home')],
          // O4: a live game shows the pre-game board as it closed — no result,
          // no movement note (opened where it closed).
          odds: odds({ spread: ['-1.5', '+140', '+1.5', '-165'], total: ['8', '-105', '-115'], ml: ['-150', '+130'] }),
        }),
        // final, and not his: an unmapped national stream plus the AWAY team's
        // own regional feed.
        event({
          id: '401998202',
          date: at('13:10'),
          state: 'post',
          venue: 'Foundry Field',
          away: { abbr: 'HRN', name: 'Harbor Herons', short: 'Herons', score: 6, linescores: [2, 0, 0, 3, 0, 0, 1, 0, 0] },
          home: { abbr: 'FIS', name: 'Foundry Ironsides', short: 'Ironsides', score: 5, linescores: [0, 1, 1, 0, 2, 0, 1, 0, 0] },
          broadcasts: [
            { market: 'national', names: ['MLB.TV'] },
            { market: 'away', names: ['Herons.TV'] },
          ],
          geo: [stream('MLB.TV', 'National'), stream('Herons.TV', 'Away')],
          // O4: a final says what the game did to the number. FIS -1.5 lost
          // 5–6, so the Herons covered; 11 runs clears 8.5, so Over.
          odds: odds({ spread: ['-1.5', '+150', '+1.5', '-180'], total: ['8.5', '-110', '-110'], ml: ['-130', '+110'] }),
        }),
        // still to come: mapped national, and somebody else's regional.
        event({
          id: '401998203',
          date: at('21:40'),
          state: 'pre',
          venue: 'Drayworks Park',
          away: { abbr: 'GCF', name: 'Granite City Foremen', short: 'Foremen', score: 0 },
          home: { abbr: 'CVD', name: 'Cedar Valley Drays', short: 'Drays', score: 0 },
          broadcasts: [
            { market: 'national', names: ['Peacock'] },
            { market: 'away', names: ['Foremen Sports Net'] },
          ],
          geo: [stream('Peacock', 'National'), tv('Foremen Sports Net', 'Away')],
          // O5: the book moved. The favourite flipped (home opened +1.5, now
          // -1.5) and the total came down half a run — both say where they
          // opened. The moneyline moved too and deliberately says nothing.
          odds: odds({
            spread: ['-1.5', '+165', '+1.5', '-200'],
            total: ['7.5', '-110', '-110'],
            ml: ['-125', '+105'],
            open: { spread: ['+1.5', '-190', '-1.5', '+160'], total: ['8', '-110', '-110'] },
          }),
        }),
      ],

      'soccer/usa.1': [
        event({
          id: '742118',
          date: at('19:30'),
          state: 'pre',
          venue: 'Riverbend Grounds',
          away: { abbr: 'CHS', name: 'Cross Harbor SC', short: 'Cross Harbor', score: 0 },
          home: { abbr: 'RVB', name: 'Riverbend FC', short: 'Riverbend', score: 0 },
          broadcasts: [{ market: 'national', names: ['MLS Season Pass'] }],
          geo: [stream('MLS Season Pass', 'National')],
          // Soccer: a three-way moneyline with a Draw, and a goal line.
          odds: odds({ spread: ['-0.5', '-105', '+0.5', '-115'], total: ['2.5', '-115', '-105'], ml: ['+115', '+230', '+240'] }),
        }),
        // No broadcasts key at all — the honest "no listing" case, and the one
        // a tile that assumes the key exists falls over on.
        event({
          id: '742119',
          date: at('20:00'),
          state: 'in',
          shortDetail: "63'",
          period: 2,
          clock: "63'",
          venue: 'Pike Street Stadium',
          away: { abbr: 'NPS', name: 'North Pike Sentinels', short: 'Sentinels', score: 1 },
          home: { abbr: 'SWU', name: 'Slack Water United', short: 'Slack Water', score: 1 },
        }),
      ],

      // Not a today_games league — only the mock parlays ride on these.
      'football/nfl': parlayEvents(at),

      // Nothing on today. The button greys and says so, and still opens (G6).
      'soccer/eng.1': [],

      'soccer/esp.1': [
        // Both La Liga games are done: a league with a slate and no live game
        // must show its count and NO dot. (The live soccer case is MLS above.)
        event({
          id: '731447',
          date: at('14:00'),
          state: 'post',
          venue: 'Estadio Inventado',
          away: { abbr: 'ALM', name: 'Almendro CF', short: 'Almendro', score: 0 },
          home: { abbr: 'VDM', name: 'Val de Mar', short: 'Val de Mar', score: 3 },
          broadcasts: [{ market: 'national', names: ['ESPN Deportes', 'ESPN+'] }],
          geo: [tv('ESPN Deportes', 'National'), stream('ESPN+', 'National')],
        }),
        event({
          id: '731448',
          date: at('09:00'),
          state: 'post',
          venue: 'Campo del Faro',
          away: { abbr: 'PTF', name: 'Puerto Faro', short: 'Puerto Faro', score: 1 },
          home: { abbr: 'MNT', name: 'Montaraz', short: 'Montaraz', score: 1 },
          broadcasts: [
            { market: 'national', names: ['Movistar Plus+'] },
            { market: 'home', names: ['Canal Montaraz'] },
          ],
          geo: [tv('Movistar Plus+', 'National'), tv('Canal Montaraz', 'Home')],
        }),
      ],
    },
    /**
     * TOMORROW (today_games v1.1). The same shape, the next Central day, and
     * four cases the sheet has to get right:
     *
     *   baseball/mlb   two games — and a THIRD dated the day after, which
     *                  ESPN really does attach to a thin `dates=` and which
     *                  the sheet's Central-date filter must drop.
     *   soccer/usa.1   one game with NO broadcasts key at all: tomorrow's
     *                  listings mostly do not exist yet, and a row with
     *                  nothing to say must say nothing.
     *   soccer/eng.1   nothing on. No heading, no "no games" line.
     *   soccer/esp.1   one game, so the grouping has a league after the empty
     *                  one and payload order can be seen to hold.
     */
    leagues_next: {
      'baseball/mlb': [
        event({
          id: '401998211',
          date: tmr('18:40'),
          state: 'pre',
          venue: 'Cream City Yard',
          away: { abbr: 'GCF', name: 'Granite City Foremen', short: 'Foremen', score: 0 },
          home: { abbr: 'CCN', name: 'Cream City Nine', short: 'Nine', score: 0 },
          broadcasts: [
            { market: 'national', names: ['FS1'] },
            { market: 'home', names: ['CreamCity.TV'] },
          ],
          geo: [tv('FS1', 'National'), stream('CreamCity.TV', 'Home')],
          // O7: tomorrow's rows carry the board too — same row builder.
          odds: odds({ spread: ['-1.5', '+120', '+1.5', '-140'], total: ['9', '-110', '-110'], ml: ['-170', '+145'] }),
        }),
        // Listed before the 18:40 game on purpose: sorting by kick is the
        // sheet's job on this path too.
        event({
          id: '401998212',
          date: tmr('13:10'),
          state: 'pre',
          venue: 'Foundry Field',
          away: { abbr: 'LKL', name: 'Lakeshore Loons', short: 'Loons', score: 0 },
          home: { abbr: 'FIS', name: 'Foundry Ironsides', short: 'Ironsides', score: 0 },
          broadcasts: [{ market: 'away', names: ['Loons Sports Net'] }],
          geo: [tv('Loons Sports Net', 'Away')],
        }),
        // The neighbour. A day later, and it must never reach the sheet.
        event({
          id: '401998213',
          date: after('19:05'),
          state: 'pre',
          venue: 'Drayworks Park',
          away: { abbr: 'HRN', name: 'Harbor Herons', short: 'Herons', score: 0 },
          home: { abbr: 'CVD', name: 'Cedar Valley Drays', short: 'Drays', score: 0 },
          broadcasts: [{ market: 'national', names: ['Peacock'] }],
          geo: [stream('Peacock', 'National')],
        }),
      ],

      'soccer/usa.1': [
        event({
          id: '742131',
          date: tmr('19:30'),
          state: 'pre',
          venue: 'Pike Street Stadium',
          away: { abbr: 'RVB', name: 'Riverbend FC', short: 'Riverbend', score: 0 },
          home: { abbr: 'SWU', name: 'Slack Water United', short: 'Slack Water', score: 0 },
        }),
      ],

      'soccer/eng.1': [],

      'soccer/esp.1': [
        event({
          id: '731461',
          date: tmr('14:00'),
          state: 'pre',
          venue: 'Estadio Inventado',
          away: { abbr: 'MNT', name: 'Montaraz', short: 'Montaraz', score: 0 },
          home: { abbr: 'ALM', name: 'Almendro CF', short: 'Almendro', score: 0 },
          broadcasts: [{ market: 'national', names: ['ESPN+'] }],
          geo: [stream('ESPN+', 'National')],
        }),
      ],
    },

    // Only the parlay games carry summaries. The single mock tickets name
    // events this slate does not hold, and "no ESPN event matched" is the
    // honest answer for them.
    summaries: parlaySummaries(),
  };
}

module.exports = { LEAGUES, SERVICES, WATCH_MAP, LOCAL_TEAMS, todayGamesPayload, slate, ctInstant, PARLAY_EVT, parlaySummaries };
