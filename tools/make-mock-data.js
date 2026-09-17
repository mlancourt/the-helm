#!/usr/bin/env node
/**
 * The Helm — fake snapshot generator. Node, zero deps.
 *
 *   node tools/make-mock-data.js            > docs/mock/helm-data.json
 *   node tools/make-mock-data.js --pending  > docs/mock/pending.json
 *   node tools/make-mock-data.js --espn     > docs/mock/espn-today.json
 *   node tools/make-mock-data.js --events   > two POST /api/event bodies
 *
 * The `--espn` slate is the other half of `today_games`: that tile's games all
 * come from ESPN in the browser, so a snapshot alone cannot show it working.
 * See tools/mock-espn.js.
 *
 * EVERY value below is invented. No real bets, balances, people, feeds, or
 * calendar items ever land in this repo. League slugs and team abbreviations
 * are real because ESPN's API needs them; the games, lines, and money are not.
 *
 * Rule 7: business dates are plain 'YYYY-MM-DD' Central strings. We do date
 * arithmetic on the parts via Date.UTC and never hand a date-only string to
 * `new Date()`.
 */

const { todayGamesPayload, slate } = require('./mock-espn.js');

const CT_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const pad = (n) => String(n).padStart(2, '0');

/** Today's Central business date as 'YYYY-MM-DD'. */
function ctToday() {
  return CT_YMD.format(new Date());
}

/** Calendar arithmetic on a 'YYYY-MM-DD' string. Returns a string. */
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const nowIso = () => new Date().toISOString();
const agoIso = (mins) => new Date(Date.now() - mins * 60000).toISOString();

const TODAY = ctToday();
const TOMORROW = addDays(TODAY, 1);

// Invented event ids in ESPN's real shapes: 9-digit for US leagues, 6-digit
// for soccer. These will not resolve against the live API — that is the point.
const EVT = {
  nfl1: '401770114',
  nfl2: '401770119',
  nba1: '401810422',
  soccer1: '731204',
};

function tile(band, data, status = 'ok', updatedAt = nowIso()) {
  return { band, updated_at: updatedAt, status, error: null, data };
}

function snapshot() {
  return {
    schema: 1,
    generated_at: nowIso(),
    run_id: `run-mock-${Date.now().toString(36)}`,
    tz: 'America/Chicago',
    tiles: {
      bets_live: tile('DAILY', {
        bankroll_u: 42.5,
        open_u: 6.0,
        record: '11-9-1',
        tickets: [
          {
            id: 'tkt-mock-001',
            league: 'football/nfl',
            espn_event_id: EVT.nfl1,
            game: 'Harbor Kestrels at Foundry Ironsides',
            kick_ct: `${TODAY} 15:25`,
            market: 'spread',
            side: 'away',
            line: -3.5,
            player: null,
            label: 'Kestrels -3.5',
            stake_u: 2.0,
            price: -110,
            class: 'core',
          },
          {
            id: 'tkt-mock-002',
            league: 'football/nfl',
            espn_event_id: EVT.nfl1,
            game: 'Harbor Kestrels at Foundry Ironsides',
            kick_ct: `${TODAY} 15:25`,
            market: 'total_over',
            side: null,
            line: 44.5,
            player: null,
            label: 'Over 44.5',
            stake_u: 1.0,
            price: -105,
            class: 'lean',
          },
          {
            id: 'tkt-mock-003',
            league: 'football/nfl',
            espn_event_id: EVT.nfl2,
            game: 'Cedar Valley Drays at North Pike Sentinels',
            kick_ct: `${TODAY} 19:15`,
            market: 'anytime_td',
            side: null,
            line: null,
            player: 'D. Vasquez',
            label: 'Vasquez anytime TD',
            stake_u: 1.0,
            price: 135,
            class: 'flier',
          },
          {
            id: 'tkt-mock-004',
            league: 'basketball/nba',
            espn_event_id: EVT.nba1,
            game: 'Lakeshore Current at Granite City Foremen',
            kick_ct: `${TODAY} 20:00`,
            market: 'ml',
            side: 'home',
            line: null,
            player: null,
            label: 'Foremen ML',
            stake_u: 1.5,
            price: -145,
            class: 'core',
          },
          {
            id: 'tkt-mock-005',
            league: 'soccer/usa.1',
            espn_event_id: EVT.soccer1,
            game: 'Riverbend FC vs Cross Harbor SC',
            kick_ct: `${TOMORROW} 19:30`,
            market: 'btts',
            side: null,
            line: null,
            player: null,
            label: 'Both teams to score',
            stake_u: 0.5,
            price: -120,
            class: 'flier',
          },
        ],
      }),

      // Today's Games: the engine publishes only the league list, the watch
      // map and the Central date. Every game comes from ESPN in the browser —
      // from docs/mock/espn-today.json under `?mock=1`. The two are generated
      // from the same file so the broadcast names hit this watch map.
      today_games: tile('LIVE', todayGamesPayload(TODAY)),

      radar: tile('DAILY', {
        date: TODAY,
        lines: [
          'Shop compressor still cycling short — watch it before the Thursday run.',
          'Two quotes out past 10 days; neither has been nudged.',
          'Weather turns Friday afternoon. Move the outdoor work up.',
          'Nothing on the calendar defends the 9-11 block tomorrow. Guard it.',
        ],
        source: 'mock-generator',
      }),

      calendar: tile('DAILY', {
        days: [
          {
            date: TODAY,
            events: [
              { time_ct: '08:30', title: 'Standup — shop floor', cal: 'wss' },
              { time_ct: '12:00', title: 'Lunch w/ parts rep', cal: 'wss' },
              { time_ct: '17:45', title: "Nora's practice pickup", cal: 'family' },
            ],
          },
          {
            date: TOMORROW,
            events: [
              { time_ct: '09:00', title: 'Deep work block', cal: 'wss' },
              { time_ct: '14:00', title: 'Service call — Cedar Ridge', cal: 'wss' },
              { time_ct: '19:00', title: 'Family movie night', cal: 'family' },
            ],
          },
        ],
      }),

      // Invented reminders, chosen to exercise every branch of the sort:
      // two misses, a today-with-a-time, a tomorrow, a next-week, and two
      // undated — flagged and unflagged, high priority and none.
      reminders: tile('DAILY', {
        count: 7,
        overdue: 2,
        due_soon: 4,
        source: 'mock generator',
        items: [
          { title: 'Nearest due date, should sort under the misses', list: 'Shop', due: TODAY, due_time: '16:30', days: 0, overdue: false, flagged: false, priority: 'none' },
          { title: 'No date at all, and flagged', list: 'Someday', due: null, due_time: null, days: null, overdue: false, flagged: true, priority: 'none' },
          { title: 'Badly overdue, high priority', list: 'Shop', due: addDays(TODAY, -9), due_time: null, days: -9, overdue: true, flagged: true, priority: 'high' },
          { title: 'Due next week', list: 'Home', due: addDays(TODAY, 6), due_time: null, days: 6, overdue: false, flagged: false, priority: 'none' },
          { title: 'Slipped yesterday', list: 'Home', due: addDays(TODAY, -1), due_time: '08:00', days: -1, overdue: true, flagged: false, priority: 'medium' },
          { title: 'Due tomorrow', list: 'Shop', due: addDays(TODAY, 1), due_time: '09:15', days: 1, overdue: false, flagged: false, priority: 'none' },
          { title: 'No date at all, not flagged', list: 'Someday', due: null, due_time: null, days: null, overdue: false, flagged: false, priority: null },
        ],
      }),

      dinner: tile('DAILY', {
        date: TODAY,
        meal: 'Sheet-pan sausage and peppers',
        notes: 'Start the oven at 5:15 or it slips past bedtime.',
        verdict: null,
      }),

      purser_due: tile('DAILY', {
        items: [
          { card: 'Blue card', due: addDays(TODAY, 3), amount: 412.88, amount_display: true, autopay: false, reminder_armed: true },
          { card: 'Shop card', due: addDays(TODAY, 9), amount: 1290.4, amount_display: false, autopay: true, reminder_armed: false },
          { card: 'Travel card', due: addDays(TODAY, 16), amount: 76.12, amount_display: true, autopay: true, reminder_armed: false },
        ],
      }),

      newsstand: tile(
        'HOURLY',
        {
          as_of: agoIso(23),
          count: 4,
          refresh_note: null,
          source: 'mock generator',
          cards: [
            {
              title: 'Regional freight rates flatten after a long climb',
              synopsis:
                'Invented copy. Spot rates on the mock lanes held flat for a fourth straight week after eighteen months of climbing, which carriers in this made-up market are reading as the top rather than a pause. Nothing here describes a real market, a real carrier, or a real rate.',
              source: 'Mock Wire',
              url: 'https://example.com/mock/freight-rates',
              category: 'Business',
              emoji: '\u{1F69B}',
              lens: 'Freight is an input cost, so a flat month reads straight through to the mock P&L.',
            },
            {
              title: 'Small-shop automation is getting cheap faster than expected',
              synopsis:
                'Invented copy. A fictional survey of fictional shops puts payback on entry-level automation under a year for the first time, mostly on the strength of used equipment coming back to market. Every number in this card was made up by tools/make-mock-data.js.',
              source: 'Mock Review',
              url: 'https://example.com/mock/shop-automation',
              category: 'Tech',
              emoji: '\u{1F4BB}',
              lens: 'Cheap automation cuts both ways for a service business: lower cost to run, lower moat.',
            },
            {
              title: 'Mock County approves the long-delayed riverfront plan',
              synopsis:
                'Invented copy. The imaginary board voted 5-2 after a third public hearing, clearing a plan that has been redrawn twice since it was first proposed by nobody in particular. No real municipality, vote, or plan is described here.',
              source: 'Mock Ledger',
              url: 'https://example.com/mock/riverfront',
              category: 'Local News',
              emoji: '\u{1F3D9}\uFE0F',
              lens: '',
            },
            {
              // No category and no emoji: the render module must not invent one.
              title: 'A slow argument for keeping one analog habit',
              synopsis: 'Invented copy. A short essay, kept deliberately brief here so the clamp has a card that does not need it.',
              source: 'Mock Quarterly',
              url: 'https://example.com/mock/analog-habit',
              lens: 'long',
            },
          ],
        },
        'ok',
        agoIso(23)
      ),

      // Entertainment: a menu tile with two faces populated and two still
      // null, which is exactly the shape the engine ships today. Streaming
      // service names are real because the platform chip has to look like the
      // real thing; every show, episode, podcast and date below is invented.
      //
      // The rows are chosen to exercise the sheet: an episode landing today
      // (red chip), one in two days (amber), one months out (neutral), a show
      // with nothing scheduled at all, and a link that is not http(s) and must
      // render as inert text rather than becoming a live one.
      entertainment: tile('DAILY', {
        watching: {
          updated_at: agoIso(95),
          items: [
            {
              title: 'The Quiet Ledger',
              platform: 'Apple TV+',
              link: 'https://example.com/mock/quiet-ledger',
              tmdb_id: 900111,
              next: { season: 3, episode: 4, name: 'A Clerical Error', air_date: addDays(TODAY, 2) },
              last: { season: 3, episode: 3, air_date: addDays(TODAY, -5) },
              days: 2,
              status_note: 'airing weekly',
            },
            {
              title: 'Harbour Lights',
              platform: 'Paramount+',
              link: 'https://example.com/mock/harbour-lights',
              tmdb_id: 900222,
              next: { season: 2, episode: 7, name: 'Slack Water', air_date: TODAY },
              last: { season: 2, episode: 6, air_date: addDays(TODAY, -7) },
              days: 0,
              status_note: null,
            },
            {
              // Nothing scheduled, and the engine says why rather than guessing.
              title: 'Bell Foundry',
              platform: 'Max',
              link: 'https://example.com/mock/bell-foundry',
              tmdb_id: 900333,
              next: null,
              last: { season: 1, episode: 8, air_date: addDays(TODAY, -1) },
              days: null,
              status_note: 'schedule not published',
            },
            {
              title: 'Northbound',
              platform: 'Netflix',
              link: 'javascript:alert(1)',
              tmdb_id: 900444,
              next: { season: 4, episode: 1, name: 'Season premiere', air_date: addDays(TODAY, 74) },
              last: { season: 3, episode: 10, air_date: addDays(TODAY, -190) },
              days: 74,
              status_note: null,
            },
          ],
          errors: null,
        },

        // Invented shows, invented episodes. `published` is the Central
        // business date and `published_at` the instant — both, because the
        // tile compares the instant when it has one and the date when it does
        // not, and the mock has to exercise the pair.
        podcasts: {
          updated_at: agoIso(40),
          items: [
            { show: 'Mock Fork', title: 'The chatbot that filed its own taxes', published: TODAY, published_at: agoIso(3 * 60), duration_min: 58, url: 'https://example.com/mock/pod/fork-1', artwork: null },
            { show: 'The Long Docket', title: 'Case 114: the disappearing deposition', published: addDays(TODAY, -1), published_at: agoIso(26 * 60), duration_min: 71, url: 'https://example.com/mock/pod/docket-1', artwork: null },
            { show: 'Ledger & Lamp', title: 'A very small bank in a very large hurry', published: addDays(TODAY, -2), published_at: agoIso(2 * 1440 + 180), duration_min: 44, url: 'https://example.com/mock/pod/ledger-1', artwork: null },
            { show: 'Mock Fork', title: 'Everyone is building the same agent', published: addDays(TODAY, -3), published_at: agoIso(3 * 1440 + 90), duration_min: 63, url: 'https://example.com/mock/pod/fork-2', artwork: null },
            { show: 'Ledger & Lamp', title: 'The audit nobody asked for', published: addDays(TODAY, -9), published_at: agoIso(9 * 1440), duration_min: null, url: 'https://example.com/mock/pod/ledger-2', artwork: null },
            { show: 'Cold Open Radio', title: 'Twelve minutes of dead air, explained', published: addDays(TODAY, -12), published_at: agoIso(12 * 1440), duration_min: 12, url: 'https://example.com/mock/pod/cold-1', artwork: null },
          ],
          errors: null,
        },

        // Not built yet. The tile renders these two greyed, wearing "soon".
        top5: null,
        listening: null,

        sources: { tv: 'TMDB', podcasts: 'RSS via iTunes Search', movies: 'pending', books: 'pending' },
        attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      }),

      ship_status: tile('DAILY', {
        captains_log_today: true,
        captains_log_file: 'mock-log-2026-01-01.md',
        helm_last_run: '2026-01-01 06:00 CT (run-mock-0600)',
        drift_audit_updated: agoIso(30 * 60),
        ask_today_usd: 0.0137,
        ask_cap_usd: 3,
        pending_count: 2,
        worker_published_at: agoIso(8),
        spend: {
          today_usd: 0.0137,
          month_to_date_usd: 0.8421,
          all_time_usd: 4.2216,
          today_by_service: { newsstand: 0.0089, ask: 0.0048 },
          all_time_by_service: { newsstand: 3.1102, ask: 1.1114 },
          ask_cap_usd: 3,
          basis: 'invented figures from the mock generator — not a bill',
          ledger: 'mock/_runtime/spend-ledger.json',
        },
        kill_switch: 'launchctl unload ~/Library/LaunchAgents/com.example.mock-helm.plist',
      }),

      // Deliberately degraded, so the page's graceful-degradation path is
      // exercised on mock data from day one.
      ask: {
        band: 'ASK',
        updated_at: agoIso(90),
        status: 'stale',
        error: 'no ask backend configured yet (M4)',
        data: {},
      },
    },
  };
}

/** Two events shaped for POST /api/event. Pending is the Worker's business. */
function mockEvents() {
  return [
    { type: 'meal_verdict', payload: { date: TODAY, verdict: 'HIT' } },
    { type: 'mileage', payload: { odometer: 74812, kind: 'business', note: 'Cedar Ridge service call' } },
  ];
}

/**
 * The same two events as the Worker would hand back from /api/data — stamped
 * with {id, ts, actor}. This lets `?mock=1` exercise the pending badge and the
 * withdraw valve without a Worker, and without ever faking an *applied* write.
 */
function mockPending() {
  return mockEvents().map((e, i) => {
    const ts = new Date(Date.now() - (i + 1) * 9 * 60000).toISOString();
    return { id: `${ts}:mock0${i + 1}`, ts, actor: 'Matt', ...e };
  });
}

const mode = process.argv.includes('--events')
  ? mockEvents()
  : process.argv.includes('--pending')
    ? mockPending()
    : process.argv.includes('--espn')
      ? slate(TODAY)
      : snapshot();
process.stdout.write(JSON.stringify(mode, null, 2) + '\n');
