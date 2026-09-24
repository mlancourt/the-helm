#!/usr/bin/env node
/**
 * The Helm — fake snapshot generator. Node, zero deps.
 *
 *   node tools/make-mock-data.js            > docs/mock/helm-data.json
 *   node tools/make-mock-data.js --pending  > docs/mock/pending.json
 *   node tools/make-mock-data.js --espn     > docs/mock/espn-today.json
 *   node tools/make-mock-data.js --cards-stale > docs/mock/cards-stale.json
 *   node tools/make-mock-data.js --newsstand-stale > docs/mock/newsstand-stale.json
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

/**
 * The Monday of the Central week 'YYYY-MM-DD' falls in — what the Top 5's
 * `week_of` is. Read off the parts with Date.UTC (rule 7); a date-only string
 * is never handed to `new Date()`.
 */
function mondayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

/**
 * 'YYYY-MM-DD' -> 'Sat 9/19', the way the engine writes a day heading for the
 * Lake Country tile. Built from the parts with Date.UTC — rule 7: a date-only
 * string is never handed to `new Date()`.
 */
function ctLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${m}/${d}`;
}

/**
 * Central WALL-CLOCK stamp, `minutes` from now: 'YYYY-MM-DDTHH:MM'.
 *
 * The shape the engine publishes an auction's `ends_ct` in — already converted
 * to Central, so the page can print it verbatim (rule 7). Built here through
 * Intl with an explicit America/Chicago, exactly as lib/fmt.js does it, so the
 * "ends inside two hours" fixture is genuinely inside two hours wherever the
 * generator is run.
 */
const CT_STAMP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function ctStampIn(minutes) {
  const p = {};
  for (const part of CT_STAMP.formatToParts(new Date(Date.now() + minutes * 60000))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * The same moment as a real UTC instant — an auction's `ends_utc` (v1.6.0).
 *
 * The countdown is counted from this and the wall stamp above is printed, so
 * the two MUST describe the same moment or the mock would teach the tile a
 * lie. Both are minted from one `Date.now() + minutes`, and the seconds are
 * flattened to :00 so the instant lands on the same minute the wall stamp
 * names rather than up to 59 seconds past it.
 */
function utcStampIn(minutes) {
  const t = Date.now() + minutes * 60000;
  return new Date(t - (t % 60000)).toISOString();
}

const nowIso = () => new Date().toISOString();
const agoIso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const aheadIso = (mins) => new Date(Date.now() + mins * 60000).toISOString();

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
            // B2/B4 — the Bookie's Sport column, and the units a winner
            // returns at the logged price. The page prints both and computes neither.
            sport: '🏈',
            to_win_u: 1.82,
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
            sport: '🏈',
            to_win_u: 0.95,
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
            sport: '🏈',
            to_win_u: 1.35,
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
            sport: '🏀',
            to_win_u: 1.03,
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
            sport: '⚽',
            to_win_u: 0.42,
          },
          {
            // No price in the log, so the Bookie publishes no `to_win_u`. The
            // row shows its plain stake in every state and leans nowhere —
            // the page will not invent a return it was not given (B4).
            id: 'tkt-mock-006',
            league: 'basketball/nba',
            espn_event_id: EVT.nba1,
            game: 'Lakeshore Current at Granite City Foremen',
            kick_ct: `${TODAY} 20:00`,
            market: 'spread',
            side: 'away',
            line: 4.5,
            player: null,
            label: 'Current +4.5',
            stake_u: 0.5,
            price: null,
            class: 'lean',
            sport: '🏀',
            to_win_u: null,
          },
        ],
        /**
         * B1/B6 — the 7-day form, from the Bookie's § Settled rows. Invented
         * here, exactly as the engine shapes it: W/L only (voids and pushes
         * never reach it), newest first, at most ten.
         *
         * The page renders this and recomputes none of it — its own live leans
         * must never feed the record, because the tile leans and the Bookie
         * settles.
         */
        form: {
          window_days: 7,
          since: addDays(TODAY, -6),
          record: '14-9',
          wins: 14,
          losses: 9,
          net_u: 4.71,
          win_pct: 61,
          streak: 'W5',
          last: [
            { r: 'W', u: 1.23, d: addDays(TODAY, -1), s: '⚽', label: 'Cross Harbor ML (reg. time)' },
            { r: 'W', u: 0.48, d: addDays(TODAY, -1), s: '⚾', label: 'Drays -1.5 run line' },
            { r: 'W', u: 0.91, d: addDays(TODAY, -2), s: '🏈', label: 'Kestrels team total over 24.5' },
            { r: 'W', u: 0.64, d: addDays(TODAY, -2), s: '🏀', label: 'Foremen -6.5' },
            { r: 'W', u: 0.71, d: addDays(TODAY, -3), s: '⚽', label: 'Riverbend both teams to score' },
            { r: 'L', u: -1.0, d: addDays(TODAY, -3), s: '🏈', label: 'Sentinels +3 (1H)' },
            { r: 'W', u: 0.45, d: addDays(TODAY, -4), s: '⚾', label: 'Under 8.5' },
            { r: 'L', u: -0.5, d: addDays(TODAY, -5), s: '🏀', label: 'Current ML' },
            { r: 'L', u: -0.75, d: addDays(TODAY, -5), s: '🏈', label: 'Vasquez anytime TD' },
            { r: 'W', u: 1.35, d: addDays(TODAY, -6), s: '⚽', label: 'Harbor Rovers ML' },
          ],
        },
        source: 'mock generator — invented tickets and an invented settled log',
      }),

      // The Ledger: the look-back, DAILY. Every figure here is the engine's —
      // records, nets, ROI, the curve, the streak, the reconcile gap. The page
      // lays them out and computes none of them, so the mock's job is to put
      // one of every SHAPE on the board: a curve that crosses 100 in both
      // directions, a class under the floor so `class_other` has something to
      // sum, all three price buckets, all six receipts, and a non-zero gap so
      // the sheet's reconcile line renders.
      bets_ledger: tile('DAILY', betsLedger()),

      // Today's Games: the engine publishes only the league list, the watch
      // map and the Central date. Every game comes from ESPN in the browser —
      // from docs/mock/espn-today.json under `?mock=1`. The two are generated
      // from the same file so the broadcast names hit this watch map.
      today_games: tile('LIVE', todayGamesPayload(TODAY, TOMORROW)),

      // Weather: configuration plus ONE offline copy, exactly as the engine
      // publishes it (W2/W11). Every live number on the face comes from
      // api.weather.gov in the browser — and `?mock=1` reaches it not at all
      // (see app.js), so the mock lands on the fallback path by construction.
      weather: tile('LIVE', weatherPayload()),

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

      // Lake Country. Every village, venue, band and festival below is
      // invented; the shape is the engine's (L3/L5) and the links go nowhere.
      //
      // The week is built to exercise the module rather than to look tidy:
      // today and tomorrow are on the board, a three-day fest is pre-expanded
      // so days two and three earn their "cont." mark, one row has no time at
      // all (an all-day market), and the rest of the week sits behind "+N more".
      local_events: tile('DAILY', {
        title: 'Lake Country',
        window: { from: TODAY, to: addDays(TODAY, 7) },
        count: 8,
        days: [
          {
            date: TODAY,
            label: ctLabel(TODAY),
            events: [
              {
                date: TODAY,
                time: '05:30 PM - 08:30 PM',
                title: 'Bands on the Mock Beach — The Invented Tides',
                venue: 'Mock Lakefront Bandshell',
                address: '100 Made Up Ave, Mockville, WI 53000',
                link: 'https://example.com/mock/bands-on-the-beach',
                source: 'Visit Mockville',
                blurb: 'Invented copy. A made-up band plays a made-up bandshell; bring a chair that does not exist.',
                multi_day: false,
              },
              {
                date: TODAY,
                time: '06:00 PM - 09:00 PM',
                title: 'Village Green Beer Garden',
                venue: 'Mock Village Green',
                address: '7 Fictional St, Mockville, WI 53000',
                link: 'https://example.com/mock/beer-garden',
                source: 'City of Mockville',
                blurb: 'Invented copy. Rotating taps from breweries that do not exist, weather that also does not exist.',
                multi_day: false,
              },
            ],
          },
          {
            date: TOMORROW,
            label: ctLabel(TOMORROW),
            events: [
              {
                date: TOMORROW,
                time: '10:00 AM - 10:00 PM',
                title: 'Mock Harvest Fallfest',
                venue: 'Invented County Fairgrounds',
                address: 'W000 County Road Nowhere, Mockville, WI 53000',
                link: 'https://example.com/mock/fallfest',
                source: 'Visit Mockville',
                blurb: 'Invented copy. Three days of a festival nobody is holding, in a county nobody lives in.',
                multi_day: true,
              },
            ],
          },
          {
            date: addDays(TODAY, 2),
            label: ctLabel(addDays(TODAY, 2)),
            events: [
              {
                date: addDays(TODAY, 2),
                // No time: an all-day listing, which must not print a stray separator.
                time: '',
                title: 'Summer Farmers Market',
                venue: '155 Fictional Ave',
                address: '155 Fictional Ave, Mockville, WI 53000',
                link: 'https://example.com/mock/farmers-market',
                source: 'City of Mockford',
                blurb: 'Invented copy. Produce, kettle corn, and a man selling birdhouses who is not real.',
                multi_day: false,
              },
              {
                date: addDays(TODAY, 2),
                time: '10:00 AM - 10:00 PM',
                title: 'Mock Harvest Fallfest',
                venue: 'Invented County Fairgrounds',
                address: 'W000 County Road Nowhere, Mockville, WI 53000',
                link: 'https://example.com/mock/fallfest',
                source: 'Visit Mockville',
                blurb: 'Invented copy. Day two: the carnival rides that do not exist open at noon.',
                multi_day: true,
              },
            ],
          },
          {
            date: addDays(TODAY, 3),
            label: ctLabel(addDays(TODAY, 3)),
            events: [
              {
                date: addDays(TODAY, 3),
                time: '11:00 AM - 06:00 PM',
                title: 'Mock Harvest Fallfest',
                venue: 'Invented County Fairgrounds',
                address: 'W000 County Road Nowhere, Mockville, WI 53000',
                link: 'https://example.com/mock/fallfest',
                source: 'Visit Mockville',
                blurb: 'Invented copy. Day three, and the parade of imaginary tractors closes it out.',
                multi_day: true,
              },
              {
                date: addDays(TODAY, 3),
                time: '01:00 PM - 03:00 PM',
                title: 'Rally for Made-Up Vets',
                venue: 'Mock Memorial Park',
                address: '1 Nonexistent Pkwy, Mockford, WI 53000',
                link: 'https://example.com/mock/rally',
                source: 'City of Mockford',
                blurb: 'Invented copy. A procession that is not happening, for a cause that is.',
                multi_day: false,
              },
            ],
          },
          {
            date: addDays(TODAY, 6),
            label: ctLabel(addDays(TODAY, 6)),
            events: [
              {
                date: addDays(TODAY, 6),
                time: '07:00 PM - 09:00 PM',
                title: 'Fireworks Over the Fictional Lake',
                venue: 'Mock Lakefront Bandshell',
                address: '100 Made Up Ave, Mockville, WI 53000',
                link: 'https://example.com/mock/fireworks',
                source: 'Visit Mockville',
                blurb: 'Invented copy. Best watched from a pier this generator also made up.',
                multi_day: false,
              },
            ],
          },
        ],
        sources: ['Visit Mockville', 'City of Mockville', 'City of Mockford'],
        errors: [],
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

      // The morning brief. The payload is built by captainsLogPayload() below
      // — see its header for what each item in the default set is there to
      // exercise.
      captains_log: tile('DAILY', captainsLogPayload()),

      dinner: tile('DAILY', {
        date: TODAY,
        meal: 'Sheet-pan sausage and peppers',
        notes: 'Start the oven at 5:15 or it slips past bedtime.',
        verdict: null,
      }),

      // The Due Stack (producer rebuilt 2026-09-21). Every card, bill, balance
      // and masked tail below is invented; the SHAPE is the statement-ledger
      // producer's. It sweeps the rows the module has to get right: a manual
      // card whose reminder has already fired, a manual card whose reminder is
      // still ahead, two autopay cards, three fixed household bills, one row
      // with its amount withheld, and a `due` that is the PAY date rather than
      // a statement date. `days_out` is the count the engine made in Central —
      // the page prints it and never recomputes it.
      purser_due: tile('DAILY', {
        known_through: addDays(TODAY, -2),
        items: [
          { kind: 'bill', emoji: '🏠', name: 'Mortgage', full_name: 'Invented Savings Bank — mortgage', amount: 2184.0, amount_display: true, due: TODAY, days_out: 0, tone: 'fund', pay_mode: 'autopay', reminder: null },
          { kind: 'card', emoji: '🟦', name: 'Blue card', full_name: 'Made-Up Blue Cash (…6543)', amount: 412.88, amount_display: true, due: addDays(TODAY, 1), days_out: 1, tone: 'act', pay_mode: 'manual', reminder: addDays(TODAY, -1) },
          { kind: 'bill', emoji: '💡', name: 'Electric', full_name: 'Nowhere Power & Light', amount: 143.62, amount_display: true, due: addDays(TODAY, 4), days_out: 4, tone: 'fund', pay_mode: 'autopay', reminder: null },
          { kind: 'card', emoji: '🟩', name: 'Shop card', full_name: 'Pretend Rewards Visa (…2201)', amount: 1290.4, amount_display: false, due: addDays(TODAY, 9), days_out: 9, tone: 'act', pay_mode: 'manual', reminder: addDays(TODAY, 6) },
          { kind: 'bill', emoji: '📶', name: 'Internet', full_name: 'Fictional Fiber', amount: 89.99, amount_display: true, due: addDays(TODAY, 12), days_out: 12, tone: 'fund', pay_mode: 'autopay', reminder: null },
          { kind: 'card', emoji: '✈️', name: 'Travel card', full_name: 'Imaginary Skies Signature (…8812)', amount: 76.12, amount_display: true, due: addDays(TODAY, 23), days_out: 23, tone: 'fund', pay_mode: 'autopay', reminder: null },
          { kind: 'card', emoji: '🟪', name: 'Store card', full_name: 'Invented Hardware Co. card (…4470)', amount: 318.05, amount_display: true, due: addDays(TODAY, 41), days_out: 41, tone: 'act', pay_mode: 'manual', reminder: null },
        ],
        totals: {
          next_45d: 4514.96,
          next_14d: 4120.79,
          manual: 2021.33,
          auto: 2493.63,
        },
        ur_available: 148200,
        streak: { clean_statements: 31, since: '2024-02-01' },
        unscheduled: [
          { emoji: '🛡️', name: 'Umbrella policy', amount: 412.0, why: 'annual premium; no pay day in the config' },
          { emoji: '🧾', name: 'Village taxes', amount: 1877.4, why: 'billed twice a year; dates vary' },
        ],
      }),

      // Crew Tape. Every crew member, customer and serial below is invented —
      // the shape is the Fleet engine's (T2/T6) and nothing in it names anyone
      // real. Twelve items so the board's eight-row budget bites and "+4 more"
      // has something to open; one row carries a unit serial on a ticket, one
      // has lost its customer (a closed ticket), and the intake bot appears
      // under its own name.
      wss_tape: tile('DAILY', {
        title: 'Crew Tape',
        date: TODAY,
        count: 12,
        by_actor: [
          { name: 'Rae', n: 5 },
          { name: 'Kit', n: 4 },
          { name: 'Odis', n: 3 },
        ],
        items: [
          { ts: agoIso(18), time_ct: '15:42', actor: 'Rae', action: 'ticket_update', kind: 'ticket', id: 'S1104', unit: null, who: 'Mock Chemical Co.', summary: 'stage IN-PROGRESS \u2192 NEEDS-QUOTE', evt: 'mk1a2b' },
          { ts: agoIso(55), time_ct: '15:05', actor: 'Kit', action: 'readiness', kind: 'unit', id: '148021', unit: null, who: 'Invented Floor Scrubber 2024', summary: 'readiness NEEDS-PREP \u2192 READY', evt: 'mk3c4d' },
          { ts: agoIso(63), time_ct: '14:57', actor: 'Rae', action: 'ticket_update', kind: 'ticket', id: 'S1098', unit: '112900', who: 'Fictional Foods', summary: 'stage WAITING-ON-CUSTOMER \u2192 IN-PROGRESS', evt: 'mk5e6f' },
          { ts: agoIso(150), time_ct: '13:30', actor: 'Odis', action: 'lead_update', kind: 'lead', id: 'L1077', unit: null, who: 'Nowhere Logistics', summary: 'value set; stage CONTACTED \u2192 QUOTED', evt: 'mk7g8h' },
          { ts: agoIso(199), time_ct: '12:41', actor: 'Kit', action: 'ticket_update', kind: 'ticket', id: 'S1101', unit: null, who: 'Made-Up Metal Works', summary: 'parts ordered; stage NEEDS-PARTS \u2192 WAITING-ON-PARTS', evt: 'mk9i0j' },
          { ts: agoIso(273), time_ct: '11:27', actor: 'Rae', action: 'ticket_close', kind: 'ticket', id: 'S1042', unit: null, who: '', summary: 'stage IN-PROGRESS \u2192 CLOSED', evt: 'mkak1l' },
          { ts: agoIso(302), time_ct: '10:58', actor: 'Odis', action: 'readiness', kind: 'unit', id: '146533', unit: null, who: 'Invented Ride-On Sweeper 2021', summary: 'readiness READY \u2192 IN-SERVICE', evt: 'mkbm2n' },
          { ts: agoIso(348), time_ct: '10:12', actor: 'Kit', action: 'ticket_update', kind: 'ticket', id: 'S1103', unit: null, who: 'Invented Plating', summary: 'note added; tech scheduled for the morning run', evt: 'mkco3p' },
          { ts: agoIso(376), time_ct: '09:44', actor: 'Rae', action: 'lead_update', kind: 'lead', id: 'L1074', unit: null, who: 'Pretend Packaging', summary: 'stage NEW \u2192 CONTACTED', evt: 'mkdq4r' },
          { ts: agoIso(417), time_ct: '09:03', actor: 'Odis', action: 'ticket_update', kind: 'ticket', id: 'S1099', unit: '113044', who: 'Mock Chemical Co.', summary: 'stage NEEDS-PARTS \u2192 IN-PROGRESS', evt: 'mkes5t' },
          { ts: agoIso(464), time_ct: '08:16', actor: 'Kit', action: 'ticket_open', kind: 'ticket', id: 'S1105', unit: null, who: 'Fictional Foods', summary: 'opened RECEIVED \u2014 brush drive noise', evt: 'mkfu6v' },
          { ts: agoIso(488), time_ct: '07:52', actor: 'Rae', action: 'other', kind: 'other', id: '\u2014', unit: null, who: '', summary: 'reserve set for the week', evt: 'mkgw7x' },
        ],
        yesterday: {
          date: addDays(TODAY, -1),
          count: 9,
          by_actor: [
            { name: 'Rae', n: 4 },
            { name: 'Kit', n: 3 },
            { name: 'Mission Control', n: 2 },
          ],
        },
        last_fleet_run_ct: '16:38',
        source: 'mock generator (applied lines only)',
      }),

      /**
       * The card desk. Every player, rung, price and seller below is invented;
       * "eBay" is the real service the engine pulls from and is named as such
       * in `sources` and in the footer, which is where the credit belongs.
       *
       * The three flags cover the three things the Watch face has to get
       * right: one plain BIN under the gate, one OBO that is also brand new,
       * and one whose comp book has gone 30 days stale (so it keeps its
       * percentage and loses the tick and the badge) and is OVER BAND besides.
       */
      cards: tile('HOURLY', cardsWatch()),

      newsstand: tile('HOURLY', newsstandPayload(), 'ok', agoIso(23)),

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

        // Five invented films, already in rank order — the engine ranks them
        // and the page never re-sorts. Service names are real (the tile has to
        // prove a chip reading "Paramount+" fits); every title, blurb, rating
        // and id below is made up. Posters are null on purpose: the mock must
        // never reach out to image.tmdb.org, and the rank-numeral-alone row is
        // the one worth seeing here.
        top5: {
          updated_at: agoIso(11 * 60),
          week_of: mondayOf(TODAY),
          items: [
            {
              title: 'The Kerosene Clerk',
              year: 2025,
              genre: 'Thriller',
              provider: 'Paramount+',
              link: 'https://example.com/mock/film/kerosene-clerk',
              rating: 7.8,
              overview:
                'A records officer at a shuttered refinery notices that every fire report for the last decade was filed by the same hand, and starts pulling on the thread from the wrong end.',
              tmdb_id: 910111,
              poster: null,
            },
            {
              title: 'Nine Miles of Bad Road',
              year: 2024,
              genre: 'Thriller · Spy',
              provider: 'Netflix',
              link: 'https://example.com/mock/film/nine-miles',
              rating: 7.2,
              overview:
                'A courier with one delivery left discovers the address does not exist, and neither, on paper, does she.',
              tmdb_id: 910222,
              poster: null,
            },
            {
              title: 'Halyard',
              year: 2026,
              genre: 'Science Fiction',
              provider: 'Apple TV+',
              link: 'https://example.com/mock/film/halyard',
              rating: 8.1,
              overview:
                'The first crewed tether to geostationary orbit is a month from its ribbon-cutting when the engineer who built it asks for it to be cut instead.',
              tmdb_id: 910333,
              poster: null,
            },
            {
              // Rating absent: the star is hidden, never rendered as 0.0.
              title: 'Cold Harbour Provisional',
              year: 2025,
              genre: 'Spy',
              provider: 'Max',
              link: 'https://example.com/mock/film/cold-harbour',
              rating: null,
              overview:
                'Two retired handlers meet for lunch every Thursday for thirty years. On the last Thursday, only one of them orders.',
              tmdb_id: 910444,
              poster: null,
            },
            {
              // Half-missing on purpose — the row still has to lay out.
              title: 'The Long Quiet',
              year: null,
              genre: null,
              provider: 'Hulu',
              link: null,
              rating: 6.9,
              overview: null,
              tmdb_id: 910555,
              poster: null,
            },
          ],
          errors: null,
        },

        // Four invented books in four invented series. The rows exercise the
        // sheet: one already out (the "out now" pill instead of a countdown),
        // one close enough for the amber chip, one months away, and one
        // half-missing — no sequence, no author, no link — because a series
        // Audible numbers loosely is the normal case, not the odd one.
        // Sorted by release date ascending, the way the engine publishes it.
        listening: {
          updated_at: agoIso(13 * 60),
          week_of: mondayOf(TODAY),
          status: 'ok',
          series_checked: 17,
          items: [
            {
              series: 'The Salvage Fleet',
              sequence: '12',
              title: 'Deadweight Tonnage',
              author: 'R. J. Mockton',
              release_date: addDays(TODAY, -2),
              days: -2,
              just_out: true,
              asin: 'B0MOCK0001',
              link: 'https://example.com/mock/pd/B0MOCK0001',
              source: 'audible-catalog',
            },
            {
              series: 'Cartwright & Fen',
              sequence: null,
              title: 'The Second Tuesday',
              author: 'Imogen Pell',
              release_date: addDays(TODAY, 4),
              days: 4,
              just_out: false,
              asin: 'B0MOCK0002',
              link: 'https://example.com/mock/pd/B0MOCK0002',
              source: 'audible-catalog',
            },
            {
              series: 'Longwater',
              sequence: '4.5',
              title: 'A Short Passage',
              author: 'Dana Q. Hollis',
              release_date: addDays(TODAY, 81),
              days: 81,
              just_out: false,
              asin: 'B0MOCK0003',
              link: 'https://example.com/mock/pd/B0MOCK0003',
              source: 'audible-catalog',
            },
            {
              series: 'The Ninth Watch',
              sequence: '3',
              title: 'Dark Union Station',
              author: null,
              release_date: addDays(TODAY, 158),
              days: 158,
              just_out: false,
              asin: 'B0MOCK0004',
              link: null,
              source: null,
            },
          ],
          errors: null,
        },

        sources: { tv: 'TMDB', podcasts: 'RSS via iTunes Search', movies: 'TMDB discover + watch/providers', books: 'Audible catalog' },
        attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
      }),

      watch_bill: tile('DAILY', watchBillPayload()),

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
        // The subscription's weekly meters — NOT the API dollars above. Both
        // are invented; the severities are hand-set so the mock exercises a
        // normal bar and a warning one side by side.
        plan: {
          state: 'ok',
          plan: 'max',
          limits: [
            {
              kind: 'weekly_all',
              label: 'Weekly · all models',
              percent: 48,
              severity: 'normal',
              resets_at: aheadIso(4 * 24 * 60),
            },
            {
              kind: 'weekly_scoped',
              label: 'Weekly · Fable',
              percent: 81,
              severity: 'warning',
              resets_at: aheadIso(4 * 24 * 60),
            },
          ],
          fetched_at: agoIso(12),
          note: null,
          source: 'mock generator — invented percentages, not a real plan',
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

/**
 * The `cards` payload, on its own so the stale variant can degrade the same
 * data rather than a second invented copy of it. Every figure is made up.
 */
function cardsWatch() {
  return {
    watch: {
      updated_at: agoIso(18),
      targets: 14,
      booked: 12,
      fresh: 9,
      oldest_book_days: 30,
      calls: 26,
      flags: [
        {
          item_id: '2864-0001',
          title: '2019 Prism Foundry Kestrel Vance RC Refractor PSA 9 — sharp corners',
          player: 'Kestrel Vance',
          rung: 'RC refractor',
          fmv: 260,
          tag: 'SOLID',
          lane: 'FLIP',
          type: 'BIN',
          price: 129,
          ship: 4.99,
          all_in: 133.99,
          pct_fmv: 0.51,
          max: 169,
          gate: 0.65,
          book_age_days: 3,
          book_state: 'fresh',
          ends_ct: null,
          ends_utc: null,
          seller: 'northport_cardworks',
          seller_fb: 1204,
          listed: addDays(TODAY, -2),
          url: 'https://example.com/mock/cards/2864-0001',
          image: 'https://example.com/mock/cards/2864-0001.jpg',
          band: null,
          new: false,
        },
        {
          item_id: '2864-0002',
          title: 'Marisol Quint Signature Patch /99 — Harbor Kestrels',
          player: 'Marisol Quint',
          rung: 'patch auto /99',
          fmv: 410,
          tag: 'SOLID',
          lane: 'H',
          type: 'OBO',
          price: 232,
          ship: 0,
          all_in: 232,
          pct_fmv: 0.57,
          max: 266,
          gate: 0.65,
          book_age_days: 1,
          book_state: 'fresh',
          ends_ct: null,
          ends_utc: null,
          seller: 'lakeside_slabs',
          seller_fb: 88,
          listed: TODAY,
          url: 'https://example.com/mock/cards/2864-0002',
          image: null,
          band: null,
          new: true,
        },
        {
          item_id: '2864-0003',
          title: 'Dov Ferreira Ironsides Rookie Auto BGS 9.5 — gem subs',
          player: 'Dov Ferreira',
          rung: 'rookie auto',
          fmv: 180,
          tag: 'THIN',
          lane: 'FLIP',
          type: 'BIN',
          price: 111,
          ship: 6.5,
          all_in: 117.5,
          pct_fmv: 0.65,
          max: 117,
          gate: 0.65,
          book_age_days: 30,
          book_state: 'aging',
          ends_ct: null,
          ends_utc: null,
          seller: 'attic_finds_wi',
          seller_fb: 41,
          listed: addDays(TODAY, -9),
          url: 'https://example.com/mock/cards/2864-0003',
          image: 'https://example.com/mock/cards/2864-0003.jpg',
          band: 'OVER BAND',
          new: false,
        },
      ],
      auctions: [
        {
          item_id: '2864-0101',
          title: 'Kestrel Vance Prism Foundry Gold /10 — no reserve',
          player: 'Kestrel Vance',
          rung: 'gold /10',
          fmv: 900,
          tag: 'SOLID',
          lane: 'H',
          type: 'AUCTION',
          price: 410,
          ship: 12,
          all_in: 422,
          pct_fmv: 0.47,
          max: 585,
          gate: 0.65,
          book_age_days: 3,
          book_state: 'fresh',
          // Inside the two-hour window, outside the last quarter-hour: amber,
          // and the countdown reads in hours and minutes ('1h 30m').
          ends_ct: ctStampIn(90),
          ends_utc: utcStampIn(90),
          seller: 'bayfield_auctions',
          seller_fb: 5310,
          listed: addDays(TODAY, -6),
          url: 'https://example.com/mock/cards/2864-0101',
          image: 'https://example.com/mock/cards/2864-0101.jpg',
          band: null,
          new: false,
        },
        {
          item_id: '2864-0103',
          title: 'Sable Nkemdi Ironsides Holo /25 — bidding closes shortly',
          player: 'Sable Nkemdi',
          rung: 'holo /25',
          fmv: 520,
          tag: 'SOLID',
          lane: 'H',
          type: 'AUCTION',
          price: 246,
          ship: 8.5,
          all_in: 254.5,
          pct_fmv: 0.49,
          max: 338,
          gate: 0.65,
          book_age_days: 1,
          book_state: 'fresh',
          // The last quarter of an hour — the one window where the seconds
          // are a fact Matt can act on, so the countdown shows them.
          ends_ct: ctStampIn(8),
          ends_utc: utcStampIn(8),
          seller: 'bayfield_auctions',
          seller_fb: 5310,
          listed: addDays(TODAY, -4),
          url: 'https://example.com/mock/cards/2864-0103',
          image: 'https://example.com/mock/cards/2864-0103.jpg',
          band: null,
          new: true,
        },
        {
          item_id: '2864-0102',
          title: 'Dov Ferreira Ironsides Rookie Auto raw — starts at a dollar',
          player: 'Dov Ferreira',
          rung: 'rookie auto',
          fmv: 180,
          tag: 'THIN',
          lane: 'FLIP',
          type: 'AUCTION',
          price: 31,
          ship: 5,
          all_in: 36,
          pct_fmv: 0.2,
          max: 117,
          gate: 0.65,
          book_age_days: 4,
          book_state: 'fresh',
          // Three days out: the days form ('3d 0h'), no amber, and the sheet
          // stays on its thirty-second beat because of it. The two extra
          // minutes are so a freshly generated mock still reads '3d 0h'
          // rather than flipping to '2d 23h' the moment it is opened.
          ends_ct: ctStampIn(3 * 1440 + 2),
          ends_utc: utcStampIn(3 * 1440 + 2),
          seller: 'attic_finds_wi',
          seller_fb: 41,
          listed: addDays(TODAY, -1),
          url: 'https://example.com/mock/cards/2864-0102',
          image: null,
          band: null,
          new: true,
        },
        {
          item_id: '2864-0104',
          title: 'Ines Okafor Prism Foundry Refractor — older cached listing',
          player: 'Ines Okafor',
          rung: 'refractor',
          fmv: 240,
          tag: 'THIN',
          lane: 'FLIP',
          type: 'AUCTION',
          price: 96,
          ship: 4.5,
          all_in: 100.5,
          pct_fmv: 0.42,
          max: 156,
          gate: 0.65,
          book_age_days: 6,
          book_state: 'fresh',
          // A pre-v1.6.0 row: wall stamp, no instant. The tile must print
          // 'ends …' exactly as it always did and raise no countdown, no
          // amber and no error — a snapshot still in the service worker's
          // cache is not a broken snapshot.
          ends_ct: ctStampIn(5 * 60),
          ends_utc: null,
          seller: 'attic_finds_wi',
          seller_fb: 41,
          listed: addDays(TODAY, -3),
          url: 'https://example.com/mock/cards/2864-0104',
          image: 'https://example.com/mock/cards/2864-0104.jpg',
          band: null,
          new: false,
        },
      ],
      unbooked: [
        { player: 'Ines Okafor', rung: 'rookie auto', book_age_days: 61, cheapest_all_in: 88.25, url: 'https://example.com/mock/cards/search-okafor' },
        { player: 'Teo Brandt', rung: 'prizm silver', book_age_days: 44, cheapest_all_in: null, url: null },
      ],
      errors: [],
    },
    shop: cardsShop(),
    shop_footer:
      'Active listings and sold-detection. Watchers and pending offers live in the eBay app — see C6.',
    pc: cardsPc(),
    pc_footer: 'No book, no gate — a bookend is one of one by definition. Price is yours to judge.',
    sources: { listings: 'eBay Browse API', fmv: 'mock comp engine', shop: 'eBay Browse API' },
    footer: 'lean, not an appraisal — every figure is the engine\'s',
  };
}

/**
 * The Shop face's payload — Matt's own storefront.
 *
 * INVENTED throughout: the cards, the players, the item ids. The service name
 * (eBay) is real because the footer credits it; nothing here is a listing
 * anyone has ever had up.
 *
 * The fixture exercises every branch the face has, so it carries on purpose:
 * four live listings — one AUCTION, two that take offers, one plain BIN —
 * with one whose `days_listed` never arrived (the days clause must vanish,
 * not print "null days"), one with no photo (the grey box, never a broken
 * img), and one that has been up most of a year (which must look exactly like
 * the three-day-old one: the age is never coloured). Plus two that have
 * dropped off the board, so the `No longer active` section has something to
 * say. `active` matches the list rather than being an independent number —
 * an honest mock is easier to read a bug out of.
 */
function cardsShop() {
  return {
    updated_at: agoIso(22),
    seller: 'mock_storefront',
    active: 4,
    calls: 1,
    // Newest-listed first, as the engine delivers it. The page must not
    // re-sort, so the mock is deliberately not in price or age order.
    listings: [
      {
        item_id: '5512-0001',
        title: '2024 Prism Foundry Kestrel Vance Planetary Pursuit /99 PSA 9',
        price: 179,
        type: 'OBO',
        offers: true,
        listed: addDays(TODAY, -3),
        days_listed: 3,
        url: 'https://example.com/mock/shop/5512-0001',
        image: 'https://example.com/mock/shop/5512-0001.jpg',
      },
      {
        item_id: '5512-0002',
        // No age on this one: the engine could not date the listing, so the
        // row drops the clause entirely.
        title: 'Marisol Quint Ironsides Rookie Auto — no reserve',
        price: 61.5,
        type: 'AUCTION',
        offers: false,
        listed: null,
        days_listed: null,
        url: 'https://example.com/mock/shop/5512-0002',
        image: 'https://example.com/mock/shop/5512-0002.jpg',
      },
      {
        item_id: '5512-0003',
        // No photo: a grey box of the same size, never a broken img.
        title: 'Dov Ferreira Prism Foundry Sapphire Wave — corners sharp',
        price: 44,
        type: 'OBO',
        offers: true,
        listed: addDays(TODAY, -214),
        days_listed: 214,
        url: 'https://example.com/mock/shop/5512-0003',
        image: null,
      },
      {
        item_id: '5512-0004',
        title: 'Teo Brandt Ironsides Base RC — lot of 4',
        price: 22,
        type: 'BIN',
        offers: false,
        listed: addDays(TODAY, -31),
        days_listed: 31,
        url: 'https://example.com/mock/shop/5512-0004',
        image: 'https://example.com/mock/shop/5512-0004.jpg',
      },
    ],
    // Sold or expired — eBay's public data cannot say which, and neither
    // does the tile.
    gone: [
      {
        item_id: '5512-0091',
        title: 'Ines Okafor Prism Foundry Gold Wave /10 BGS 9.5',
        price: 410,
        listed: addDays(TODAY, -58),
        gone_since: addDays(TODAY, -2),
      },
      {
        item_id: '5512-0092',
        title: 'Sable Nkemdi Ironsides Emerald Parallel PSA 10',
        price: 96,
        listed: addDays(TODAY, -120),
        gone_since: addDays(TODAY, -6),
      },
    ],
    errors: [],
    note: 'active listings + sold-detection; watchers and offers need OAuth',
  };
}

/**
 * The PC net's payload — the personal-collection bookend face.
 *
 * INVENTED throughout: the players, the products, the sellers. Real service
 * name (eBay) and real eBay-ish shapes, because those are what the module
 * parses; nothing here is a card anyone owns.
 *
 * The fixture exists to exercise every branch the tile has, so it carries on
 * purpose: three bookends (a 1/N, an N/N and one with unknown shipping), two
 * one-of-ones (a BIN and an auction closing in about forty minutes), one
 * arrival, one OBO, one with no photo — and a `counts.shown` deliberately
 * below `total_found`, so the "Showing X of Y" line has something to say.
 */
function cardsPc({ errors = [] } = {}) {
  return {
    updated_at: agoIso(18),
    players: 26,
    calls: 121,
    // UNCLIPPED totals: the caps are per class and per seller, so what the
    // net found and what it lists are two different numbers on purpose.
    total_found: 108,
    counts: { one_of_one: 29, bookend: 79, shown: 6 },
    finds: [
      // -- bookends: the target ------------------------------------------
      {
        item_id: '7731-0001',
        title: '2023 Prism Foundry #334 Kestrel Vance GOLD Wave BOOKEND',
        player: 'Kestrel Vance',
        serial: '10/10',
        num: 10,
        den: 10,
        one_of_one: false,
        grade: 'PSA 10',
        type: 'BIN',
        price: 650,
        ship: 4.99,
        all_in: 654.99,
        ends_ct: null,
        ends_utc: null,
        seller: 'cardvault_mn',
        seller_fb: 2410,
        listed: addDays(TODAY, -1),
        url: 'https://example.com/mock/pc/7731-0001',
        image: 'https://example.com/mock/pc/7731-0001.jpg',
        new: true,
      },
      {
        item_id: '7731-0002',
        title: 'Marisol Quint Ironsides Emerald Parallel — first card of the run',
        player: 'Marisol Quint',
        serial: '1/25',
        num: 1,
        den: 25,
        one_of_one: false,
        grade: 'BGS 9.5',
        type: 'OBO',
        price: 288,
        ship: 6.5,
        all_in: 294.5,
        ends_ct: null,
        ends_utc: null,
        seller: 'lakeside_slabs',
        seller_fb: 88,
        listed: addDays(TODAY, -4),
        url: 'https://example.com/mock/pc/7731-0002',
        image: 'https://example.com/mock/pc/7731-0002.jpg',
        new: false,
      },
      {
        item_id: '7731-0003',
        // Shipping the listing never stated: the row must say `+ ship?` and
        // stop, with no arrow pointing at a total nobody computed.
        title: 'Dov Ferreira Prism Foundry Sapphire /50 — last serial',
        player: 'Dov Ferreira',
        serial: '50/50',
        num: 50,
        den: 50,
        one_of_one: false,
        grade: 'SGC 9',
        type: 'BIN',
        price: 175,
        ship: null,
        all_in: null,
        ends_ct: null,
        ends_utc: null,
        seller: 'attic_finds_wi',
        seller_fb: 41,
        listed: addDays(TODAY, -11),
        url: 'https://example.com/mock/pc/7731-0003',
        image: null,
        new: false,
      },
      // -- one of ones: the bonus class ----------------------------------
      {
        item_id: '7731-0101',
        title: 'Ines Okafor Ironsides Black Shield 1/1 — the only one printed',
        player: 'Ines Okafor',
        serial: '1/1',
        num: 1,
        den: 1,
        one_of_one: true,
        grade: 'PSA 9',
        type: 'BIN',
        price: 1450,
        ship: 12,
        all_in: 1462,
        ends_ct: null,
        ends_utc: null,
        seller: 'northport_cardworks',
        seller_fb: 1204,
        listed: addDays(TODAY, -2),
        url: 'https://example.com/mock/pc/7731-0101',
        image: 'https://example.com/mock/pc/7731-0101.jpg',
        new: false,
      },
      {
        item_id: '7731-0102',
        title: 'Teo Brandt Prism Foundry Superfractor 1/1 — no reserve',
        player: 'Teo Brandt',
        serial: '1/1',
        num: 1,
        den: 1,
        one_of_one: true,
        grade: 'BGS 9',
        type: 'AUCTION',
        price: 920,
        ship: 15,
        all_in: 935,
        // Inside forty minutes. On the Watch sheet that would be amber; here
        // it must NOT be, because amber on this sheet means one of one.
        ends_ct: ctStampIn(40),
        ends_utc: utcStampIn(40),
        seller: 'bayfield_auctions',
        seller_fb: 5310,
        listed: addDays(TODAY, -6),
        url: 'https://example.com/mock/pc/7731-0102',
        image: 'https://example.com/mock/pc/7731-0102.jpg',
        new: false,
      },
      {
        item_id: '7731-0103',
        title: 'Sable Nkemdi Ironsides Printing Plate Cyan 1/1',
        player: 'Sable Nkemdi',
        serial: '1/1',
        num: 1,
        den: 1,
        one_of_one: true,
        grade: 'PSA 8',
        type: 'BIN',
        price: 410,
        ship: 5,
        all_in: 415,
        ends_ct: null,
        ends_utc: null,
        seller: 'cardvault_mn',
        seller_fb: 2410,
        listed: addDays(TODAY, -8),
        url: 'https://example.com/mock/pc/7731-0103',
        image: 'https://example.com/mock/pc/7731-0103.jpg',
        new: false,
      },
    ],
    errors,
  };
}

/**
 * The weather tile's payload — configuration + one offline copy (W2/W11).
 *
 * INVENTED: the place, the gridpoint, the station, the radar site. Real NWS
 * *shapes* and real token vocabulary, because those are what the module parses;
 * no real coordinates for a house, because this is a public repo.
 *
 * The radar `loop` points at docs/mock/radar-placeholder.svg — a local asset,
 * NEVER the live NWS URL. `?mock=1` must reach no origin at all, and a mock
 * that pulls a real 1 MB GIF off a federal server to render fake weather is
 * not a mock (W10 / rule 4).
 *
 * `alerts` decides which of the three tiers the fixture shows:
 *   []            the clean board
 *   [watch]       amber chip, inside the tile (the default snapshot)
 *   [warning]     red row AND the board banner, on the 60-second clock
 * and `fallback: null` is the only case that may say "feed unavailable".
 */
function weatherPayload({ alerts = [watchAlert()], fallback = true } = {}) {
  const data = {
    title: 'Weather',
    place: 'Mockton',
    point: { lat: 40.0, lon: -90.0 },
    grid: {
      office: 'MCK',
      x: 42,
      y: 17,
      forecast: 'https://api.weather.gov/gridpoints/MCK/42,17/forecast',
      hourly: 'https://api.weather.gov/gridpoints/MCK/42,17/forecast/hourly',
    },
    zone: 'XXZ000',
    county: 'XXC000',
    alerts_url: 'https://api.weather.gov/alerts/active?point=40.0000,-90.0000',
    station: { id: 'KMCK', name: 'Mockton Municipal Airport', obs: 'https://api.weather.gov/stations/KMCK/observations/latest' },
    radar: {
      site: 'KMCK',
      label: 'Mockton (KMCK)',
      // LOCAL. Never radar.weather.gov from the mock path.
      loop: './mock/radar-placeholder.svg',
      w: 600,
      h: 550,
      behind_min: 4,
    },
    sun: { date: TODAY, sunrise_ct: '06:38', sunset_ct: '18:57' },
    glyphs: {
      skc: '☀️', few: '🌤️', sct: '⛅', bkn: '🌥️',
      ovc: '☁️', rain: '🌧️', rain_showers: '🌦️',
      tsra: '⛈️', tsra_sct: '⛈️', tsra_hi: '⛈️',
      snow: '🌨️', fzra: '🧊', fog: '🌫️',
      wind_bkn: '💨', hot: '🥵', cold: '🥶',
    },
    warn_events: [
      'Tornado Warning',
      'Severe Thunderstorm Warning',
      'Flash Flood Warning',
      'Flood Warning',
      'Winter Storm Warning',
      'Blizzard Warning',
      'Ice Storm Warning',
      'High Wind Warning',
    ],
    mute: ['Special Marine Warning', 'Beach Hazards Statement'],
    clock: { normal_s: 300, warned_s: 60, forecast_s: 1800 },
    fallback: null,
  };

  if (!fallback) return data;

  data.fallback = {
    as_of: agoIso(34),
    now: {
      source: 'KMCK',
      temp_f: 61,
      short: 'Light Rain and Fog/Mist',
      glyph_token: 'rain',
      wind: '9 mph E',
      rh: 100,
      dew_f: 61,
      obs_time_ct: '7:45 AM',
    },
    days: WX_DAYS.map((d, i) => ({
      date: addDays(TODAY, i),
      label: i === 0 ? 'Today' : ctLabel(addDays(TODAY, i)).split(' ')[0],
      ...d,
    })),
    alerts,
  };
  return data;
}

/** Seven invented days, in the shape the engine folds day/night into (W8). */
const WX_DAYS = [
  { glyph_token: 'tsra', hi_f: 69, lo_f: 59, pop: 83, short: 'Showers And Thunderstorms Likely',
    detail: 'Showers and thunderstorms likely before 9am, then a chance of showers and thunderstorms. Cloudy, with a high near 69. Southeast wind 5 to 10 mph. Chance of precipitation is 80%.' },
  { glyph_token: 'rain_showers', hi_f: 66, lo_f: 52, pop: 46, short: 'Chance Rain Showers then Cloudy',
    detail: 'A chance of rain showers before 10am. Cloudy, with a high near 66. Northeast wind 10 to 15 mph, with gusts as high as 30 mph.' },
  { glyph_token: 'bkn', hi_f: 62, lo_f: 48, pop: 7, short: 'Mostly Cloudy',
    detail: 'Mostly cloudy, with a high near 62. Northeast wind 10 to 15 mph.' },
  { glyph_token: 'bkn', hi_f: 61, lo_f: 47, pop: 7, short: 'Partly Sunny',
    detail: 'Partly sunny, with a high near 61. Northeast wind 5 to 15 mph.' },
  { glyph_token: 'sct', hi_f: 64, lo_f: 48, pop: 4, short: 'Mostly Sunny',
    detail: 'Mostly sunny, with a high near 64. Partly cloudy, with a low around 48.' },
  { glyph_token: 'sct', hi_f: 66, lo_f: 49, pop: 4, short: 'Mostly Sunny',
    detail: 'Mostly sunny, with a high near 66. Partly cloudy, with a low around 49.' },
  { glyph_token: 'skc', hi_f: 70, lo_f: 50, pop: 3, short: 'Sunny',
    detail: 'Sunny, with a high near 70. Partly cloudy, with a low around 50.' },
];

/** An invented Flood Watch — amber, inside the tile, no banner (W6). */
function watchAlert() {
  return {
    id: 'mock-alert-watch',
    event: 'Flood Watch',
    tier: 'watch',
    severity: 'Severe',
    headline: 'Flood Watch issued by NWS Mockton (invented)',
    description:
      '* WHAT...Flooding caused by excessive rainfall is possible.\n\n' +
      '* WHERE...Portions of invented county.\n\n' +
      '* WHEN...Through this evening.\n\n' +
      '* ADDITIONAL DETAILS...\n- This alert is fake. Every word of it was written by the mock generator.\n- http://example.com/mock/flood',
    instruction: 'You should monitor later forecasts and be alert for possible Flood Warnings.',
    areaDesc: 'Invented County, XX',
    onset: agoIso(300),
    ends: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
    url: 'https://api.weather.gov/alerts/urn:oid:0.0.0.0.mock.watch',
  };
}

/** An invented Tornado Warning — red, AND the board banner, AND the 60s clock. */
function warnAlert() {
  return {
    id: 'mock-alert-warn',
    event: 'Tornado Warning',
    tier: 'warn',
    severity: 'Extreme',
    headline: 'Tornado Warning issued by NWS Mockton (invented)',
    description:
      'The National Weather Service in Mockton has issued a Tornado Warning for invented county.\n\n' +
      'At 100 PM, a severe thunderstorm capable of producing a tornado was located over nowhere, moving northeast at 30 mph.\n\n' +
      'This alert is fake. Every word of it was written by the mock generator.',
    instruction: 'TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building.',
    areaDesc: 'Invented County, XX',
    onset: agoIso(12),
    ends: new Date(Date.now() + 40 * 60000).toISOString(),
    url: 'https://api.weather.gov/alerts/urn:oid:0.0.0.0.mock.warn',
  };
}

/** An invented advisory — the grey line, the quietest of the three tiers. */
function advisoryAlert() {
  return {
    id: 'mock-alert-advisory',
    event: 'Dense Fog Advisory',
    tier: 'advisory',
    severity: 'Minor',
    headline: 'Dense Fog Advisory issued by NWS Mockton (invented)',
    description: 'Visibility one quarter mile or less in dense fog. This alert is fake.',
    instruction: 'If driving, slow down, use your low beams and leave plenty of distance ahead of you.',
    areaDesc: 'Invented County, XX',
    onset: agoIso(90),
    ends: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    url: 'https://api.weather.gov/alerts/urn:oid:0.0.0.0.mock.advisory',
  };
}

/**
 * The three other weather fixtures, as whole snapshots (`?mock=weather-warn`
 * and friends). Only the weather tile differs; everything else on the board
 * stays exactly as the default mock, so what changed on screen is never in
 * doubt.
 */
function weatherSnapshot(payload) {
  const snap = snapshot();
  snap.tiles.weather = tile('LIVE', payload);
  return snap;
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

/**
 * The newsstand, as raw RSS (v2, 2026-09-19).
 *
 * The engine stopped curating: ~150 cards from ~40 feeds arrive newest-first
 * with `lens` always null and `synopsis` null whenever the feed did not
 * bother. The mock has to be that shape or `?mock=1` stops exercising the
 * tile it is there to exercise. Four things it must get right:
 *
 *   - INTERLEAVED. The payload is one list in time order, not a list grouped
 *     by category. That is the whole reason `by_category` exists, and a mock
 *     that happened to arrive grouped would let a first-mention-ordered menu
 *     pass by accident.
 *   - AGED ACROSS EVERY RUNG. The ages below fan out non-linearly — minutes
 *     at the head, then hours, yesterday, weekdays, and a tail past a week —
 *     so every rung of `ageChip()` is on screen at once. A few cards carry no
 *     `published_at` at all, which must render as no chip rather than a gap.
 *   - `n` AGREES WITH THE CARDS. `by_category` is the config's order, and
 *     its counts are derived here from the cards actually emitted rather than
 *     typed — a mock whose summary disagreed with its own body would teach
 *     the tile the wrong lesson.
 *   - ONE CARD WITH NO CATEGORY, so the trailing Uncategorised bucket is
 *     always on the board.
 *
 * Rule 1: every outlet, headline, URL and number below is invented. The
 * outlets are named in the house style of the rest of this file — Mock,
 * Invented, Fictional, Pretend, Nowhere — precisely so no one can mistake one
 * for a real masthead. Nothing here describes a real story.
 *
 * Deterministic: no Math.random, so regenerating the mock does not churn the
 * diff.
 */
const NEWS_FEED = [
  {
    name: 'Local News', emoji: '\u{1F3D9}️', n: 22,
    outlets: ['Mock Ledger', 'Nowhere Chronicle', 'Pretend Post'],
    subjects: ['The invented county board', 'A made-up village committee', 'The fictional water utility', 'Mock County planners', 'An imaginary school district'],
    predicates: ['approves the long-delayed riverfront plan', 'puts the levy question back on the ballot', 'signs off on a roundabout nobody wanted', 'delays the budget vote a third time', 'buys the old mill site for a dollar'],
    filler: 'The vote, the board and the parcel are all invented for this fixture.',
  },
  {
    name: 'Local Sports', emoji: '\u{1F3DF}️', n: 14,
    outlets: ['Mock Wire', 'Invented Dispatch'],
    subjects: ['The Lakeshore Current', 'Granite City Foremen', 'Cedar Valley Drays', 'North Pike Sentinels', 'Foundry Ironsides'],
    predicates: ['take the conference opener in overtime', 'lose their starting keeper for the season', 'name a first-year head coach', 'move their home dates to the new turf', 'run their unbeaten streak to nine'],
    filler: 'Every club, result and player in this card was made up by the generator.',
  },
  {
    name: 'National Politics', emoji: '\u{1F3DB}️', n: 16,
    outlets: ['The Made-Up Times', 'Pretend Post', 'Mock Ledger'],
    subjects: ['A fictional committee', 'The invented appropriations bill', 'An imaginary caucus', 'The made-up rules panel', 'A nonexistent working group'],
    predicates: ['clears its first procedural hurdle', 'stalls over a single line item', 'gets a markup date at last', 'loses two votes it was counting on', 'is rewritten a fourth time'],
    filler: 'No real body, bill or vote is described here.',
  },
  {
    name: 'Tech', emoji: '\u{1F4BB}', n: 19,
    outlets: ['Mock Review', 'Invented Dispatch', 'Fictional Gazette'],
    subjects: ['Small-shop automation', 'An invented file format', 'A made-up scheduling library', 'The fictional standards group', 'An imaginary handset maker'],
    predicates: ['is getting cheap faster than expected', 'ships a release nobody asked for', 'drops support for a decade-old runtime', 'wins an argument it started in 2019', 'quietly doubles its storage tier'],
    filler: 'Every product, version and company in this card is invented.',
  },
  {
    name: 'Business', emoji: '\u{1F4BC}', n: 13,
    outlets: ['Mock Wire', 'Fictional Gazette'],
    subjects: ['Regional freight rates', 'An invented equipment dealer', 'The made-up parts distributor', 'A fictional leasing arm', 'Nowhere Logistics'],
    predicates: ['flatten after a long climb', 'opens a third branch on a hunch', 'loses its largest account to a rival', 'raises prices and says so plainly', 'buys back a warehouse it sold in 2021'],
    filler: 'No real market, carrier, rate or company is described here.',
  },
  {
    name: 'Markets', emoji: '\u{1F4C8}', n: 11,
    outlets: ['Mock Wire', 'The Made-Up Times'],
    subjects: ['The invented index', 'A fictional commodity', 'The pretend bond desk', 'An imaginary sector fund', 'Made-up spot pricing'],
    predicates: ['closes flat for a fourth straight week', 'gives back a month in an afternoon', 'finds a floor nobody trusts', 'is being read as the top rather than a pause', 'ends the quarter roughly where it started'],
    filler: 'Every figure here was made up; money never moves from this page.',
  },
  {
    name: 'Soccer', emoji: '⚽', n: 15,
    outlets: ['Invented Dispatch', 'Mock Review'],
    subjects: ['A fictional second-division side', 'The invented cup holders', 'An imaginary promotion chase', 'The made-up derby', 'A pretend academy graduate'],
    predicates: ['goes down to ten and wins anyway', 'is decided by a goal in the ninth minute of added time', 'ends goalless and nobody minds', 'gets a replay after a floodlight failure', 'signs for a fee that is also invented'],
    filler: 'No real club, match or player appears in this card.',
  },
  {
    name: 'Science', emoji: '\u{1F52C}', n: 9,
    outlets: ['Mock Quarterly', 'Fictional Gazette'],
    subjects: ['An invented survey', 'A made-up replication attempt', 'The fictional field station', 'An imaginary instrument', 'A pretend long-run study'],
    predicates: ['finds rather less than the press release claimed', 'holds up on the third try', 'loses a decade of data to a bad tape', 'is cheaper than the thing it replaces', 'reaches its twentieth year quietly'],
    filler: 'No real study, result or institution is described here.',
  },
  {
    name: 'Space', emoji: '\u{1F680}', n: 8,
    outlets: ['Mock Quarterly', 'Invented Dispatch'],
    subjects: ['An invented launch window', 'A fictional lander', 'The made-up ground station', 'An imaginary constellation operator', 'A pretend sample return'],
    predicates: ['slips a fortnight for weather', 'phones home a day late', 'is retired after outliving its brief by years', 'files for a hundred more slots', 'comes back with less than hoped'],
    filler: 'Every mission, vehicle and date here is invented.',
  },
  {
    name: 'Gaming', emoji: '\u{1F3AE}', n: 10,
    outlets: ['Mock Review', 'Fictional Gazette'],
    subjects: ['An invented studio', 'A made-up remaster', 'The fictional handheld', 'An imaginary tournament', 'A pretend early-access title'],
    predicates: ['delays its sequel into next autumn', 'runs better on the old hardware', 'cuts its entry fee in half', 'ships without the mode it advertised', 'quietly becomes the best-selling thing they make'],
    filler: 'No real studio, title or platform is described here.',
  },
  {
    name: 'Books', emoji: '\u{1F4DA}', n: 7,
    outlets: ['Mock Quarterly', 'Pretend Post'],
    subjects: ['An invented novelist', 'A made-up translation', 'The fictional prize jury', 'An imaginary backlist', 'A pretend debut'],
    predicates: ['finishes a trilogy eleven years late', 'is better than the original and says so', 'shortlists nothing anyone expected', 'outsells the new releases again', 'arrives with no marketing at all'],
    filler: 'Every author, title and prize in this card is invented.',
  },
  {
    name: 'Odd Lots', emoji: '\u{1F3A9}', n: 6,
    outlets: ['Pretend Post', 'Nowhere Chronicle'],
    subjects: ['An invented auction house', 'A made-up hobbyist', 'The fictional museum basement', 'An imaginary estate sale', 'A pretend collector'],
    predicates: ['sells a filing cabinet for rather too much', 'catalogues nine thousand bottle caps', 'turns up a map nobody had missed', 'goes to a single bidder in four minutes', 'gives the lot away rather than split it'],
    filler: 'Nothing in this card happened.',
  },
];

/**
 * Minutes-old for the k-th card. Non-linear on purpose: k^1.9 puts the head of
 * the list minutes old, the middle in hours, and the tail past a week, so
 * every rung of the age chip — now / 12m / 3h / yesterday / Tue / 9/12 — is
 * visible in one screenshot.
 */
const newsAge = (k) => 5 + Math.round(Math.pow(k, 1.9));

const newsSlug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * The raw-RSS payload. `stale` swaps in a run where two feeds did not answer,
 * which is what the "38 of 40 sources answered" footer is for.
 */
function newsstandPayload({ stale = false } = {}) {
  // Build per category, then interleave by age — the engine publishes one
  // time-ordered list, not a grouped one.
  const built = [];
  for (const cat of NEWS_FEED) {
    for (let i = 0; i < cat.n; i++) {
      const subject = cat.subjects[i % cat.subjects.length];
      const predicate = cat.predicates[(i + Math.floor(i / cat.predicates.length)) % cat.predicates.length];
      const title = `${subject} ${predicate}`;
      built.push({
        title,
        outlet: cat.outlets[i % cat.outlets.length],
        category: cat.name,
        emoji: cat.emoji,
        filler: cat.filler,
        slug: newsSlug(title),
      });
    }
  }

  // One stable interleave: deal round-robin across the categories, which is
  // roughly what forty feeds polled at once produce.
  const byCat = new Map(NEWS_FEED.map((c) => [c.name, built.filter((b) => b.category === c.name)]));
  const order = [];
  for (let round = 0; order.length < built.length; round++) {
    for (const c of NEWS_FEED) {
      const list = byCat.get(c.name);
      if (round < list.length) order.push(list[round]);
    }
  }

  const cards = order.map((b, k) => ({
    title: b.title,
    // Roughly one feed in five publishes no description at all.
    synopsis: k % 5 === 3 ? null : `Invented copy. ${b.title}. ${b.filler} No real person, organisation or event is described, and every number in it was made up by tools/make-mock-data.js.`,
    source: b.outlet,
    url: `https://example.com/mock/news/${b.slug}`,
    // Raw RSS, no model: the lens is gone and stays gone.
    lens: null,
    category: b.category,
    emoji: b.emoji,
    // A handful of feeds send no date. No stamp must mean no chip.
    published_at: k % 23 === 11 ? null : agoIso(newsAge(k)),
  }));

  // The one card with no category at all, so the trailing Uncategorised
  // bucket is always on the board and the module never invents a glyph.
  cards.splice(4, 0, {
    title: 'A slow argument for keeping one analog habit',
    synopsis: 'Invented copy. A short essay, kept deliberately brief here so the clamp has a card that does not need it.',
    source: 'Mock Quarterly',
    url: 'https://example.com/mock/news/analog-habit',
    lens: null,
    category: null,
    emoji: null,
    published_at: agoIso(41),
  });

  // Counted off the cards that actually exist, never typed — a summary that
  // disagreed with its own body would teach the tile the wrong lesson.
  const by_category = NEWS_FEED.map((c) => ({
    name: c.name,
    emoji: c.emoji,
    n: cards.filter((x) => x.category === c.name).length,
  }));

  const failed = stale
    ? [
        'r/invented-subreddit: HTTP Error 429: Too Many Requests',
        'Nowhere Chronicle RSS: timed out after 10s',
      ]
    : [];

  return {
    cards,
    as_of: agoIso(23),
    count: cards.length,
    by_category,
    sources: { ok: 40 - failed.length, failed, total: 40 },
    refresh_note: null,
    source: 'mock generator — raw RSS shape, no model',
  };
}

/**
 * The same snapshot with two feeds down: `status: stale` plus the reason the
 * Worker would carry. The tile renders every card it does have and says "38
 * of 40 sources answered" — and the raw error, which is on the tile here,
 * must NOT reach the board (the module owns that line; see app.js
 * `ownsErrorLine`). `?mock=newsstand-stale` is how that path gets looked at.
 */
function newsstandStaleSnapshot() {
  const snap = snapshot();
  snap.tiles.newsstand = {
    band: 'HOURLY',
    updated_at: agoIso(23),
    status: 'stale',
    error: 'r/invented-subreddit: HTTP Error 429: Too Many Requests',
    data: newsstandPayload({ stale: true }),
  };
  return snap;
}

/**
 * The same snapshot with the card desk half-broken: `status: stale` plus the
 * reason. The rows Matt DOES have are still real, so the tile renders them and
 * wears a ⚠︎ (rule 8) — `?mock=cards-stale` is how that path gets looked at
 * without waiting for eBay to rate-limit the engine for real.
 */
function cardsStaleSnapshot() {
  const snap = snapshot();
  const data = cardsWatch();
  data.watch.errors = ['eBay Browse API: 3 of 14 searches rate-limited (429)'];
  snap.tiles.cards = {
    band: 'HOURLY',
    updated_at: agoIso(96),
    status: 'stale',
    error: 'eBay Browse API rate-limited the 06:00 pull — 11 of 14 targets answered',
    data,
  };
  return snap;
}

/** `shop: null` — the engine degraded, and the face greyed back to "soon". */
function cardsNoShopSnapshot() {
  const snap = snapshot();
  const data = cardsWatch();
  data.shop = null;
  snap.tiles.cards = { band: 'HOURLY', updated_at: agoIso(18), status: 'ok', error: null, data };
  return snap;
}

/**
 * A quiet shop: nothing listed and nothing dropped off.
 *
 * The empty state has to say so rather than opening a blank sheet, and the
 * `No longer active` section has to be absent rather than headed over nothing.
 */
function cardsShopEmptySnapshot() {
  const snap = snapshot();
  const data = cardsWatch();
  data.shop = cardsShop();
  data.shop.listings = [];
  data.shop.gone = [];
  data.shop.active = 0;
  snap.tiles.cards = { band: 'HOURLY', updated_at: agoIso(18), status: 'ok', error: null, data };
  return snap;
}

/** `pc: null` — the face greyed to "soon". */
function cardsNoPcSnapshot() {
  const snap = snapshot();
  const data = cardsWatch();
  data.pc = null;
  snap.tiles.cards = { band: 'HOURLY', updated_at: agoIso(18), status: 'ok', error: null, data };
  return snap;
}

/** The net half-answered: the finds it DID get, and the reason for the rest. */
function cardsPcErrorsSnapshot() {
  const snap = snapshot();
  const data = cardsWatch();
  data.pc = cardsPc({
    errors: ['eBay Browse API: 6 of 121 player searches rate-limited (429)', 'grading lookup timed out for 2 listings'],
  });
  snap.tiles.cards = { band: 'HOURLY', updated_at: agoIso(18), status: 'stale', error: 'the 06:00 PC sweep did not finish', data };
  return snap;
}


/**
 * A settled-history payload, invented end to end (hard rule 1).
 *
 * LEDGER_CURVE crosses 100 twice on purpose: the sparkline's stroke colour is
 * the sign of net-since-slate, and a curve that only ever sat above the line
 * would never exercise the other half of that decision.
 */
const LEDGER_CURVE = [
  101.72, 102.21, 100.64, 99.18, 98.05, 99.42, 101.1, 103.36,
  102.48, 104.9, 106.11, 107.35, 105.02, 103.77, 104.58, 104.34,
];

function ledgerRec(record, net, staked, roi, winPct) {
  const [wins, losses] = record.split('-').map(Number);
  return {
    n: wins + losses,
    wins,
    losses,
    record,
    net_u: net,
    staked_u: staked,
    roi_pct: roi,
    win_pct: winPct,
  };
}

function betsLedger() {
  const slate = addDays(TODAY, -31);
  // One point per settled day, oldest first, ending yesterday.
  const curve = LEDGER_CURVE.map((u, i) => ({ d: addDays(TODAY, -(LEDGER_CURVE.length - i)), u }));
  return {
    as_of: TODAY,
    slate_day: slate,
    // The Bookie's ledger line, which is NOT the curve's last point — the two
    // disagree by the gap below, and L10 says the Bookie wins.
    bankroll_u: 105.24,
    streak: 'L4',
    windows: {
      '7d': { ...ledgerRec('17-19', 0.96, 27.0, 3.6, 47), since: addDays(TODAY, -6) },
      '30d': { ...ledgerRec('32-33', 2.62, 45.25, 5.8, 49), since: addDays(TODAY, -29) },
      slate: { ...ledgerRec('33-33', 4.34, 46.25, 9.4, 50), since: slate },
    },
    curve,
    hwm: { d: curve[11].d, u: 107.35 },
    lwm: { d: curve[4].d, u: 98.05 },
    by_sport: [
      { s: '🏈', ...ledgerRec('8-4', 3.21, 9.0, 35.7, 67) },
      { s: '⚾', ...ledgerRec('4-3', 2.01, 5.5, 36.5, 57) },
      { s: '⚽', ...ledgerRec('21-26', -0.88, 31.75, -2.8, 45) },
    ],
    by_class: [
      { tag: 'user-independent-read', ...ledgerRec('4-0', 2.63, 2.75, 95.6, 100) },
      { tag: 'road-dog-rest-edge', ...ledgerRec('5-2', 1.44, 4.5, 32.0, 71) },
      { tag: 'first-half-under', ...ledgerRec('3-3', 0.21, 3.0, 7.0, 50) },
      { tag: 'total-fade-public', ...ledgerRec('4-6', -0.62, 5.0, -12.4, 40) },
      { tag: 'key-number-hook', ...ledgerRec('1-4', -2.18, 3.25, -67.1, 20) },
    ],
    class_min_n: 3,
    // A class at 2-0 is hiding in here until its third ticket — the floor
    // doing its job, and the reason this line exists at all.
    class_other: { classes: 24, ...ledgerRec('10-17', -1.84, 12.75, -14.4, 37) },
    price: {
      dog: ledgerRec('13-21', -1.24, 19.5, -6.4, 38),
      fav: ledgerRec('18-11', 4.33, 25.25, 17.1, 62),
      even: ledgerRec('2-0', 1.5, 1.5, 100.0, 100),
    },
    receipts: {
      best_ticket: {
        d: addDays(TODAY, -4),
        s: '⚽',
        label: 'UNDER 2.5 goals (reg. time)',
        game: 'Cross Harbor SC at Riverbend FC',
        u: 1.99,
      },
      worst_ticket: {
        d: addDays(TODAY, -2),
        s: '🏈',
        label: 'Sentinels -3.5 (1H)',
        game: 'Cedar Valley Drays at North Pike Sentinels',
        u: -1.5,
      },
      best_day: { d: addDays(TODAY, -4), net_u: 4.87, record: '4-0', n: 4 },
      worst_day: { d: addDays(TODAY, -2), net_u: -1.81, record: '3-6', n: 9 },
      longest_w: { n: 6, from: addDays(TODAY, -12), to: addDays(TODAY, -8) },
      // A skid that started and ended the same day — the row collapses to one
      // date rather than printing it twice.
      longest_l: { n: 5, from: addDays(TODAY, -3), to: addDays(TODAY, -3) },
      biggest_stake: { d: addDays(TODAY, -9), s: '🏀', label: 'Foremen ML', game: 'Lakeshore Current at Granite City Foremen', u: 1.03 },
    },
    passes: { '7d': 14, '30d': 20, slate: 23 },
    reconcile: {
      rows_net_u: 4.34,
      rows_record: '33-33',
      ledger_net_u: 5.24,
      ledger_record: '35-33',
      gap_u: 0.9,
    },
    voids: 3,
    rows: 66,
    source: 'mock generator — an invented settled log',
  };
}

/**
 * The thin log: a Ledger with barely anything in it.
 *
 * Two curve points (the fewest that can be a line), no class above the floor,
 * no receipts at all and a reconcile that agrees. Every optional block on this
 * tile is optional, and this is the fixture that proves the sections hide
 * rather than render empty frames (rule 9).
 */
function betsLedgerThin() {
  const slate = addDays(TODAY, -3);
  return {
    as_of: TODAY,
    slate_day: slate,
    bankroll_u: 100.4,
    streak: null,
    windows: {
      '7d': { ...ledgerRec('1-1', 0.4, 1.0, null, 50), since: slate },
      slate: { ...ledgerRec('1-1', 0.4, 1.0, null, 50), since: slate },
    },
    curve: [
      { d: addDays(TODAY, -2), u: 99.5 },
      { d: addDays(TODAY, -1), u: 100.4 },
    ],
    hwm: null,
    lwm: null,
    by_sport: [],
    by_class: [],
    class_min_n: 3,
    class_other: null,
    price: { dog: null, fav: null, even: { n: 0, record: '0-0', net_u: 0 } },
    receipts: {
      best_ticket: null,
      worst_ticket: null,
      best_day: null,
      worst_day: null,
      longest_w: null,
      longest_l: null,
    },
    passes: { '7d': 0, '30d': 0, slate: 0 },
    reconcile: { rows_net_u: 0.4, rows_record: '1-1', ledger_net_u: 0.4, ledger_record: '1-1', gap_u: 0 },
    voids: 0,
    rows: 2,
    source: 'mock generator — a thin invented log',
  };
}

function ledgerThinSnapshot() {
  const snap = snapshot();
  snap.tiles.bets_ledger = tile('DAILY', betsLedgerThin());
  return snap;
}

/* ------------------------------------------------- captains_log — the brief
 *
 * The morning brief, invented end to end (hard rule 1). Every headline, body,
 * name and dollar figure below is made up; the SHAPE is the framework's.
 *
 * The default payload sweeps what the face has to get right in one go: two
 * note items with ordinals, five radar items so the "+ N more →" row has
 * something to hide, a tagged item in each section so both act chips light, a
 * resolved item that must be struck in the sheet and absent from the face and
 * from `live_count`, and — the trap — a headline with " — " INSIDE it. The
 * engine splits headline from body on the bold run, not on the dash, so an em
 * dash is a legitimate character in a headline and the tile must render it
 * whole rather than cutting the headline in half at the first one.
 *
 * `headline_exact: false` rides on one item and must be invisible: it renders
 * identically to a `true`, which is exactly what the class scan in
 * tools/test-tiles.js checks.
 */

const CLOG_NOTES = [
  {
    ordinal: 'One',
    emoji: '⚓',
    headline: 'The Fairhaven quote — the one you parked on Friday — needs a number today',
    body:
      'They asked twice and the second ask copied their operations lead, which is the tell that it has moved off the maybe pile. The machine list has not changed since the walkthrough, so the only open item is what you want the freight line to read. Nothing else in the inbox is waiting on you this morning.',
    tag: 'act / defer / drop',
    resolved: false,
    headline_exact: true,
  },
  {
    ordinal: 'Two',
    emoji: '🧭',
    headline: 'Three weeks of half-finished notes are all the same note',
    body:
      'The Tuesday captures keep circling the same decision and none of them ends in one. That is a signal about the decision, not about the note-taking: it has no owner and no date, so it regenerates every week. Give it either and it stops.',
    tag: 'act / defer / drop',
    resolved: false,
    headline_exact: false,
  },
];

const CLOG_RADAR = [
  {
    ordinal: null,
    emoji: '📞',
    headline: 'Kestrel Supply expects a call back before noon — they left a voicemail Friday and an email Sunday night',
    body: 'Second attempt. The voicemail names a delivery window, the email does not.',
    tag: 'act / defer / drop',
    resolved: false,
    headline_exact: true,
  },
  {
    ordinal: null,
    emoji: '📦',
    headline: 'The rebuilt pump ships Tuesday, which puts it on the dock the morning you are out',
    body: 'Nobody has been told to expect it.',
    tag: null,
    resolved: false,
    headline_exact: true,
  },
  {
    ordinal: null,
    emoji: '🗓️',
    headline: 'Two calendar items overlap at 2:00 and one of them is the one with four people on it',
    body: '',
    tag: null,
    resolved: false,
    headline_exact: true,
  },
  {
    ordinal: null,
    emoji: '🧾',
    headline: 'The Fairhaven invoice is thirty-one days out',
    body: 'First month past terms. No note in the thread about why.',
    // A menu with an option withheld — the brief offered no defer on this
    // one, so the chip must not grow one.
    tag: 'act / drop',
    resolved: false,
    headline_exact: true,
  },
  {
    ordinal: null,
    emoji: '🛠️',
    headline: 'The shop light over bay two is still out',
    body: 'Third morning it has come up. It is a ladder and a bulb.',
    tag: null,
    resolved: false,
    headline_exact: true,
  },
  // Sorted last by the engine, excluded from live_count, and struck in the
  // sheet. The face must not show it at all.
  {
    ordinal: null,
    emoji: '✅',
    headline: 'The Monroe paperwork went out Friday afternoon',
    body: 'Closed itself. Confirmation is in the thread.',
    tag: null,
    resolved: true,
    headline_exact: true,
  },
];

function captainsLogPayload({
  notes = CLOG_NOTES,
  radar = CLOG_RADAR,
  omitted = [],
  isToday = true,
  date = TODAY,
  extraSections = [],
} = {}) {
  const sections = [];
  if (notes.length) {
    sections.push({
      id: 'architects-note',
      title: "Architect's Note",
      kind: 'note',
      emitted: true,
      items: notes,
    });
  }
  if (radar.length) {
    sections.push({
      id: 'on-your-radar',
      title: 'On Your Radar Today',
      kind: 'radar',
      emitted: true,
      items: radar,
    });
  }
  for (const s of extraSections) sections.push(s);

  // The engine's own count: live items only, resolved excluded. Computed once
  // HERE, in the generator, so the tile has a number to print and never one
  // to derive.
  const live = sections.reduce(
    (n, s) => n + s.items.filter((i) => i.resolved !== true).length,
    0
  );

  const [, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS_FULL[weekdayIndex(date)];

  return {
    brief_date: date,
    is_today: isToday,
    generated_at_ct: '06:11 CDT',
    framework_version: 'v2.9',
    run_mode: 'scheduled',
    weekday,
    live_count: live,
    sections,
    omitted,
    footer: `Generated by Captain's Log — ${weekday} ${m}/${d}, 06:02 fire · framework v2.9 · 75th consecutive morning`,
    source: `02-Personal/Daily/${date.slice(0, 7)}/${date}-Brief.md`,
  };
}

const WEEKDAYS_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * The weekday of a 'YYYY-MM-DD' Central business date.
 *
 * Rule 7 even in the generator: the parts are split out and counted on a flat
 * UTC calendar, which is arithmetic rather than a timezone conversion. A mock
 * that named the wrong weekday would teach the tile — and its tests — a lie.
 */
function weekdayIndex(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Radar only: the framework skipped the Architect's Note this morning. */
function captainsLogOmittedSnapshot() {
  const snap = snapshot();
  snap.tiles.captains_log = tile(
    'DAILY',
    captainsLogPayload({
      notes: [],
      omitted: [{ id: 'architects-note', title: "Architect's Note" }],
    })
  );
  return snap;
}

/**
 * Yesterday's brief, still on the board.
 *
 * Both signals at once, which is how the engine sends it: `status: stale` and
 * `is_today: false`. Its items are written in today-tense, so the face owes
 * its date and a tone — hard point 2, and the reason this fixture exists.
 */
function captainsLogStaleSnapshot() {
  const snap = snapshot();
  const yesterday = addDays(TODAY, -1);
  snap.tiles.captains_log = {
    band: 'DAILY',
    updated_at: agoIso(26 * 60),
    status: 'stale',
    error: 'brief for 2026-09-21 not found — showing the last one that fired',
    data: captainsLogPayload({ isToday: false, date: yesterday }),
  };
  return snap;
}

/** The 06:02 fire did not happen. Rule 9's generic card, and the error line. */
function captainsLogErrorSnapshot() {
  const snap = snapshot();
  snap.tiles.captains_log = {
    band: 'DAILY',
    updated_at: agoIso(3 * 60),
    status: 'error',
    error: 'vault unreachable — no brief read this morning',
    data: {},
  };
  return snap;
}

/**
 * Hard point 8: the framework self-tunes weekly and WILL grow a section.
 *
 * An id and a kind this module has never heard of, carrying its own title.
 * It must render under that title, with generic rows, and must not need a
 * deploy the morning it appears.
 */
function captainsLogUnknownSnapshot() {
  const snap = snapshot();
  snap.tiles.captains_log = tile(
    'DAILY',
    captainsLogPayload({
      extraSections: [
        {
          id: 'weather-eye',
          title: 'Weather Eye',
          kind: 'forecastish',
          emitted: true,
          items: [
            {
              ordinal: null,
              emoji: '🌬️',
              headline: 'A section the page has never seen, published by a framework that tuned itself overnight',
              body: 'It renders under its own title, with generic rows, and nothing throws.',
              tag: null,
              resolved: false,
              headline_exact: true,
            },
            {
              ordinal: null,
              emoji: null,
              headline: 'And a second row, with no emoji at all',
              body: '',
              tag: 'act / defer / drop',
              resolved: false,
              headline_exact: true,
            },
          ],
        },
      ],
    })
  );
  return snap;
}

/**
 * A morning the Captain's Log withheld options.
 *
 * `tag` is the brief's own decision MENU, not a constant, and this is the
 * fixture that says so: a note offering only 'act', a radar section where
 * every row reads 'act / drop', and the word "defer" nowhere in the payload
 * at all. The tile must print those strings exactly and must never grow the
 * third option back — the menu is the brief's decision about what Matt gets
 * to decide, and a page that widened it would be answering a question the
 * Captain's Log deliberately did not ask.
 */
function captainsLogMenusSnapshot() {
  const snap = snapshot();
  snap.tiles.captains_log = tile(
    'DAILY',
    captainsLogPayload({
      notes: [
        {
          ordinal: 'One',
          emoji: '⚓',
          headline: 'The Fairhaven quote needs a number today — there is no version of this week where it does not',
          body: 'No option but to answer it. The brief says so by offering only the one.',
          tag: 'act',
          resolved: false,
          headline_exact: true,
        },
      ],
      radar: [
        {
          ordinal: null,
          emoji: '📞',
          headline: 'Kestrel Supply is on their second attempt',
          body: 'Call them or let it go; the brief is not offering to park it.',
          tag: 'act / drop',
          resolved: false,
          headline_exact: true,
        },
        {
          ordinal: null,
          emoji: '🧾',
          headline: 'The Fairhaven invoice is thirty-one days out',
          body: 'Same two options.',
          tag: 'act / drop',
          resolved: false,
          headline_exact: true,
        },
        {
          ordinal: null,
          emoji: '🛠️',
          headline: 'The shop light over bay two is still out',
          body: 'No menu on this one at all.',
          tag: null,
          resolved: false,
          headline_exact: true,
        },
      ],
    })
  );
  return snap;
}

/**
 * Watch Bill. Ten invented tasks on an invented host, covering every state
 * the engine emits: one missed (the only red on the tile), one inside the
 * grace window, four fired — one of which produced no new doc — three not yet
 * due and one paused. Already sorted, as the engine sorts it; the page must
 * render it in this order. The vault name and every path are made up, and the
 * obsidian:// links are built HERE, standing in for the engine — the page
 * never builds one.
 */
function watchBillPayload() {
  const vault = 'Mock-Vault';
  const doc = (rel, name, modified) => ({
    name,
    rel_path: rel,
    modified_at: modified,
    obsidian_url: `obsidian://open?vault=${vault}&file=${encodeURIComponent(rel.replace(/\.md$/, ''))}`,
  });
  const task = (id, label, emoji, state, extra = {}) => ({
    id, label, emoji, state,
    last_run_at: null, last_scheduled_for: null, missed_slot: null, next_run_at: null,
    folder: null, doc: null, configured: true,
    ...extra,
  });
  return {
    title: 'Watch Bill',
    host: 'mock-mini.local',
    scheduler_read_at: agoIso(12),
    counts: { missed: 1, due: 1, fired: 4, not_yet: 3, paused: 1 },
    tasks: [
      task('mock-inbox-digest', 'Inbox Digest', '📥', 'missed', {
        last_run_at: agoIso(60 * 26), last_scheduled_for: agoIso(60 * 3), missed_slot: agoIso(60 * 3),
        next_run_at: aheadIso(60 * 21), folder: 'Mock/Inbox/Digests',
      }),
      task('mock-fleet-sweep', 'Fleet Sweep', '🧹', 'due', {
        last_run_at: agoIso(60 * 24), last_scheduled_for: agoIso(20), next_run_at: aheadIso(60 * 24),
        folder: 'Mock/Fleet/Sweeps',
      }),
      task('mock-blog-writer', 'Blog Writer', '✍️', 'fired', {
        last_run_at: agoIso(95), last_scheduled_for: agoIso(100), next_run_at: aheadIso(60 * 24 * 13),
        folder: 'Mock/Marketing/Blog/Reports',
        doc: doc(`Mock/Marketing/Blog/Reports/${TODAY}-invented-floor-care-myths.md`, `${TODAY}-invented-floor-care-myths`, agoIso(90)),
      }),
      task('mock-morning-brief', 'Morning Brief', '⚓', 'fired', {
        last_run_at: agoIso(60 * 5), last_scheduled_for: agoIso(60 * 5 + 2), next_run_at: aheadIso(60 * 19),
        folder: 'Mock/Brief',
        doc: doc(`Mock/Brief/${TODAY}.md`, TODAY, agoIso(60 * 5 - 3)),
      }),
      task('mock-price-watch', 'Price Watch', '🏷️', 'fired', {
        last_run_at: agoIso(60 * 7), last_scheduled_for: agoIso(60 * 7), next_run_at: aheadIso(60 * 17),
        folder: 'Mock/Cards/Watch',
      }),
      task('mock-ledger-close', 'Ledger Close', '📒', 'fired', {
        last_run_at: agoIso(60 * 9), last_scheduled_for: agoIso(60 * 9), next_run_at: aheadIso(60 * 15),
        folder: 'Mock/Bets/Ledger',
        doc: doc(`Mock/Bets/Ledger/${TODAY}-close.md`, `${TODAY}-close`, agoIso(60 * 9 - 1)),
      }),
      task('mock-weekly-review', 'Weekly Review', '🗓️', 'not_yet', {
        last_run_at: agoIso(60 * 24 * 5), next_run_at: aheadIso(60 * 24 * 2), folder: 'Mock/Reviews/Weekly',
      }),
      task('mock-meal-plan', 'Meal Plan', '🍽️', 'not_yet', {
        last_run_at: agoIso(60 * 24 * 6), next_run_at: aheadIso(60 * 30), folder: 'Mock/Home/Meals',
      }),
      task('mock-drift-audit', 'Drift Audit', '🧭', 'not_yet', {
        last_run_at: null, next_run_at: aheadIso(60 * 24 * 4), folder: null,
      }),
      task('mock-seo-crawl', 'SEO Crawl', '🕸️', 'paused', {
        last_run_at: agoIso(60 * 24 * 20), folder: 'Mock/Marketing/SEO',
      }),
    ],
    note: 'recurring tasks on this machine’s scheduler only — invented for the mock',
  };
}

const MODES = [
  ['--events', () => mockEvents()],
  ['--pending', () => mockPending()],
  ['--espn', () => slate(TODAY, TOMORROW, addDays(TODAY, 2))],
  ['--cards-stale', () => cardsStaleSnapshot()],
  ['--cards-no-pc', () => cardsNoPcSnapshot()],
  ['--cards-no-shop', () => cardsNoShopSnapshot()],
  ['--cards-shop-empty', () => cardsShopEmptySnapshot()],
  ['--cards-pc-errors', () => cardsPcErrorsSnapshot()],
  ['--newsstand-stale', () => newsstandStaleSnapshot()],
  // The Ledger with almost nothing settled: every optional block absent.
  ['--ledger-thin', () => ledgerThinSnapshot()],
  // The morning brief's other five faces. The default snapshot carries the
  // normal day — two notes, five radar items, one resolved.
  ['--clog-omitted', () => captainsLogOmittedSnapshot()],
  ['--clog-stale', () => captainsLogStaleSnapshot()],
  ['--clog-error', () => captainsLogErrorSnapshot()],
  ['--clog-unknown', () => captainsLogUnknownSnapshot()],
  // A morning with an option withheld: 'act / drop', and no defer anywhere.
  ['--clog-menus', () => captainsLogMenusSnapshot()],
  // The weather tile's four faces (W6). The default snapshot carries the
  // Watch; these are the other three.
  ['--weather-warn', () => weatherSnapshot(weatherPayload({ alerts: [warnAlert(), advisoryAlert()] }))],
  ['--weather-clear', () => weatherSnapshot(weatherPayload({ alerts: [] }))],
  // Live gone AND no offline copy: the ONLY case allowed to say "feed
  // unavailable" (W11).
  ['--weather-down', () => weatherSnapshot(weatherPayload({ fallback: false }))],
];

const chosen = MODES.find(([flag]) => process.argv.includes(flag));
const mode = chosen ? chosen[1]() : snapshot();
process.stdout.write(JSON.stringify(mode, null, 2) + '\n');
