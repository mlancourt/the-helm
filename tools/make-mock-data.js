#!/usr/bin/env node
/**
 * The Helm — fake snapshot generator. Node, zero deps.
 *
 *   node tools/make-mock-data.js            > docs/mock/helm-data.json
 *   node tools/make-mock-data.js --events   > two POST /api/event bodies
 *
 * EVERY value below is invented. No real bets, balances, people, feeds, or
 * calendar items ever land in this repo. League slugs and team abbreviations
 * are real because ESPN's API needs them; the games, lines, and money are not.
 *
 * Rule 7: business dates are plain 'YYYY-MM-DD' Central strings. We do date
 * arithmetic on the parts via Date.UTC and never hand a date-only string to
 * `new Date()`.
 */

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

      mke_board: tile('LIVE', {
        teams: [
          { abbr: 'MIL', league: 'baseball/mlb' },
          { abbr: 'MIL', league: 'basketball/nba' },
          { abbr: 'GB', league: 'football/nfl' },
          { abbr: 'MARQ', league: 'basketball/mens-college-basketball' },
        ],
      }),

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
          cards: [
            { title: 'Regional freight rates flatten after a long climb', source: 'Mock Wire', url: 'https://example.com/mock/freight-rates', lens: 'business' },
            { title: 'Small-shop automation is getting cheap faster than expected', source: 'Mock Review', url: 'https://example.com/mock/shop-automation', lens: 'trade' },
            { title: 'A slow argument for keeping one analog habit', source: 'Mock Quarterly', url: 'https://example.com/mock/analog-habit', lens: 'long' },
          ],
        },
        'ok',
        agoIso(23)
      ),

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

const out = process.argv.includes('--events') ? mockEvents() : snapshot();
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
