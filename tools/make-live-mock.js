#!/usr/bin/env node
/**
 * The Helm — live-schedule mock generator. Node 18+, zero deps.
 *
 *   node tools/make-live-mock.js > docs/mock/live.local.json
 *   # then open ?mock=live.local
 *
 * Builds a snapshot whose tickets carry REAL espn_event_ids from today's real
 * slate, so the LIVE band can be watched grading an actual game. This is the
 * only way to prove the graders work end to end; a fabricated event id can
 * only ever prove they do not crash.
 *
 * The *output* is gitignored (`*.local.*`). Everything invented here — stakes,
 * prices, bankroll, lines — is fake, as always. The schedule is public data.
 *
 * Lines are chosen near the current score so that a live game produces a mix
 * of COVERING and TRAILING rather than five identical pills.
 *
 * It also lists the same leagues under `today_games`, so that tile renders the
 * REAL slate with REAL broadcast names — the only way to see whether the watch
 * map actually covers what ESPN sends on a given night.
 */

const { WATCH_MAP, SERVICES } = require('./mock-espn.js');

const LEAGUES = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const DEFAULT_LEAGUES = ['baseball/mlb', 'football/nfl', 'football/college-football'];

const ctDateCompact = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');

const ctStamp = (iso) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

async function scoreboard(league, date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard?dates=${date}&limit=60`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${league}: http ${res.status}`);
  const j = await res.json();
  return (j.events || []).map((e) => {
    const c = e.competitions[0];
    const side = (ha) => {
      const t = (c.competitors || []).find((x) => x.homeAway === ha) || {};
      return { abbr: t.team?.abbreviation || '', score: Number(t.score) || 0 };
    };
    return {
      id: String(e.id), league, name: e.name, shortName: e.shortName,
      date: e.date, state: c.status?.type?.state || 'pre',
      detail: c.status?.type?.detail || '',
      home: side('home'), away: side('away'),
    };
  });
}

(async () => {
  const date = ctDateCompact();
  const leagues = LEAGUES.length ? LEAGUES : DEFAULT_LEAGUES;

  const all = [];
  for (const lg of leagues) {
    try {
      all.push(...(await scoreboard(lg, date)));
    } catch (e) {
      process.stderr.write(`  skipped ${lg}: ${e.message}\n`);
    }
  }
  if (!all.length) {
    process.stderr.write('No events on the real slate today. Nothing to grade.\n');
    process.exit(1);
  }

  // Prefer games that are actually under way — that is the whole point.
  const live = all.filter((g) => g.state === 'in');
  const pre = all.filter((g) => g.state === 'pre');
  const post = all.filter((g) => g.state === 'post');
  const picked = [...live, ...post, ...pre].slice(0, 4);

  process.stderr.write(
    `slate ${date}: ${live.length} live, ${pre.length} upcoming, ${post.length} final` +
      ` — building tickets against ${picked.map((g) => g.shortName).join(', ')}\n`
  );

  const tickets = [];
  let n = 0;
  for (const g of picked) {
    const id = () => `tkt-live-${String(++n).padStart(3, '0')}`;
    const total = g.home.score + g.away.score;
    const margin = g.home.score - g.away.score;
    const football = g.league.startsWith('football');

    tickets.push({
      id: id(), league: g.league, espn_event_id: g.id,
      game: g.name, kick_ct: ctStamp(g.date),
      market: 'ml', side: 'home', line: null, player: null,
      label: `${g.home.abbr} ML`, stake_u: 1.5, price: -135, class: 'core',
    });
    tickets.push({
      id: id(), league: g.league, espn_event_id: g.id,
      game: g.name, kick_ct: ctStamp(g.date),
      market: 'spread', side: 'away',
      // Sit the line near the live margin so the pill is interesting.
      line: g.state === 'in' ? margin + 0.5 : football ? 3.5 : 1.5,
      player: null,
      label: `${g.away.abbr} ${(g.state === 'in' ? margin + 0.5 : football ? 3.5 : 1.5) > 0 ? '+' : ''}${g.state === 'in' ? margin + 0.5 : football ? 3.5 : 1.5}`,
      stake_u: 1, price: -110, class: 'lean',
    });
    tickets.push({
      id: id(), league: g.league, espn_event_id: g.id,
      game: g.name, kick_ct: ctStamp(g.date),
      market: 'total_over', side: null,
      line: g.state === 'in' ? total + 1.5 : football ? 44.5 : 8.5,
      player: null,
      label: `Over ${g.state === 'in' ? total + 1.5 : football ? 44.5 : 8.5}`,
      stake_u: 1, price: -105, class: 'lean',
    });
    tickets.push({
      id: id(), league: g.league, espn_event_id: g.id,
      game: g.name, kick_ct: ctStamp(g.date),
      market: 'btts', side: null, line: null, player: null,
      label: 'Both teams to score', stake_u: 0.5, price: -120, class: 'flier',
    });
    if (football) {
      tickets.push({
        id: id(), league: g.league, espn_event_id: g.id,
        game: g.name, kick_ct: ctStamp(g.date),
        market: 'spread_1h', side: 'home', line: -1.5, player: null,
        label: `${g.home.abbr} -1.5 (1H)`, stake_u: 1, price: -115, class: 'lean',
      });
      tickets.push({
        id: id(), league: g.league, espn_event_id: g.id,
        game: g.name, kick_ct: ctStamp(g.date),
        market: 'anytime_td', side: null, line: null,
        // Deliberately a name that will not score, so the LOSS path is visible
        // too. A real ticket would name a real player.
        player: 'Nobody Atall',
        label: 'Atall anytime TD', stake_u: 1, price: 145, class: 'flier',
      });
    }
  }

  const now = new Date().toISOString();
  const ctToday = () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  const snapshot = {
    schema: 1,
    generated_at: now,
    run_id: `run-live-${Date.now().toString(36)}`,
    tz: 'America/Chicago',
    _comment:
      'LIVE VERIFICATION FIXTURE. Real ESPN event ids from a real slate so the graders can be watched against actual games. Stakes, prices, lines and bankroll are invented. Gitignored and regenerated on demand.',
    tiles: {
      bets_live: {
        band: 'DAILY', updated_at: now, status: 'ok', error: null,
        data: { bankroll_u: 42.5, open_u: tickets.reduce((a, t) => a + t.stake_u, 0), record: '11-9-1', tickets },
      },
      today_games: {
        band: 'LIVE', updated_at: now, status: 'ok', error: null,
        data: {
          title: "Today's Games",
          date_ct: ctToday(),
          leagues: leagues.map((slug) => ({
            id: slug.split('/').pop(),
            slug,
            label: slug.split('/').pop().toUpperCase(),
            emoji: '',
          })),
          services: SERVICES,
          watch_map: WATCH_MAP,
          // Real slate, so the regional test wants the real local club: a
          // Brewers feed should read as his, everybody else's as a blackout.
          local_teams: { 'baseball/mlb': ['MIL'] },
        },
      },
    },
  };
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
})();
