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
