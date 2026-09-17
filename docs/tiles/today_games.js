/**
 * today_games — a menu tile. One button per league Matt follows; the slate
 * lives in a sheet. Replaces `mke_board` (Today's Games spec, G1).
 *
 * Matt's ruling, in his words: the local-team scoreboard told him things he
 * already knew. What he wanted instead was the day's slate per league, with
 * kick times, live scores, and — the part no scoreboard app gets right for one
 * particular person — whether HE can actually watch it.
 *
 * THE DIVISION OF LABOUR. The engine publishes only the league list, the watch
 * map, and the Central date (G5); it never fetches a schedule. Every game, and
 * every score on it, comes from ESPN in the browser on the LIVE band's clock,
 * shared with `bets_live` so one tick serves both tiles. So this module reads
 * `tile.data` for WHICH leagues and `ctx.live.today` for WHAT is on.
 *
 * HOW TO WATCH (G4) is the only judgement in here, and it is three-way:
 *   ✓ <service>            the broadcast name is in `watch_map` — he has it
 *   <raw name>             not in the map, printed verbatim and unmarked,
 *                          because a hand-kept map missing an entry is not
 *                          the same as him not having the channel
 *   regional — not yours   a Home/Away market feed for a team that is not in
 *                          `local_teams[slug]` — another city's RSN, which
 *                          will black out
 * Mapped wins over regional on purpose: the map is how the vault says "this
 * particular RSN IS mine" (Brewers.TV), and that statement must outrank the
 * geography.
 *
 * RULE 7: `date_ct` is a Central calendar string. It is rendered from its
 * parts by `prettyDate` and converted to ESPN's `dates=` by string ops in
 * espn.js. It is never handed to `new Date()`. Kick times are a different kind
 * of time — `startDate` is a real UTC instant off `event.date`, so it goes
 * through `ctTime`, which parses it and formats it in Central.
 *
 * RULE 10: every team name, status string and broadcast name is ESPN's text
 * and lands via textContent. There are no links: broadcast names are channel
 * names, not URLs, and inventing one would be guessing.
 */

import { el, empty } from '../lib/dom.js';
import { ctTime, prettyDate } from '../lib/fmt.js';

/** A plain object, or {} — the payload is untrusted in shape as well as text. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

const str = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * The leagues, in payload order (G6: the buttons are the payload's list, not
 * a list of what happens to have games). A league with no slug is dropped —
 * there is nothing to fetch for it and nothing to title it with.
 */
function leaguesOf(data) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(data.leagues) ? data.leagues : []) {
    const l = obj(raw);
    const slug = str(l.slug);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      // Label falls back to the tail of the slug rather than to blank, so a
      // league the vault adds tomorrow gets a readable button with no deploy.
      label: str(l.label) || slug.split('/').pop().toUpperCase(),
      emoji: str(l.emoji),
    });
  }
  return out;
}

/** `${emoji} ${label}`, or just the label when the payload sent no emoji. */
function leagueTitle(league) {
  return league.emoji ? `${league.emoji} ${league.label}` : league.label;
}

// ------------------------------------------------------------------ watching

/**
 * One game's watch chips: `[{text, kind}]`, deduped, national first (the order
 * espn.js already put the broadcasts in).
 *
 * `kind` is only a class name — `mapped`, `regional`, or `raw`.
 */
export function watchChips(game, watchMap, localTeams, slug) {
  const map = obj(watchMap);
  const locals = new Set(
    (Array.isArray(obj(localTeams)[slug]) ? obj(localTeams)[slug] : []).map((t) => str(t).toUpperCase())
  );

  const out = [];
  const seen = new Set();
  const push = (text, kind) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ text, kind });
  };

  for (const raw of Array.isArray(game?.broadcasts) ? game.broadcasts : []) {
    const name = str(obj(raw).name).trim();
    if (!name) continue;

    // The vault's map wins first — including for an RSN it has claimed.
    const mapped = str(map[name]).trim();
    if (mapped) {
      push(`✓ ${mapped}`, 'mapped');
      continue;
    }

    // A market-specific feed for somebody else's team will black out here.
    const market = str(obj(raw).market);
    if (market === 'Home' || market === 'Away') {
      const side = market === 'Home' ? obj(game.home) : obj(game.away);
      if (!locals.has(str(side.abbr).toUpperCase())) {
        push('regional — not yours', 'regional');
        continue;
      }
    }

    push(name, 'raw');
  }

  return out;
}

// -------------------------------------------------------------------- slate

/**
 * Kick order. Compared, never rendered, so parsing is fine: `startDate` is a
 * UTC instant off `event.date` and carries a Z. A game with no usable stamp
 * sinks to the bottom rather than jumping to 1970.
 */
function kickRank(game) {
  const t = Date.parse(game?.startDate);
  return Number.isFinite(t) ? t : Infinity;
}

function sortByKick(games) {
  return [...(Array.isArray(games) ? games : [])].sort((a, b) => kickRank(a) - kickRank(b));
}

/** "Brewers @ Pirates" — shortDisplayNames, per the spec. */
function matchupText(game) {
  const away = str(obj(game.away).short) || str(obj(game.away).abbr) || '—';
  const home = str(obj(game.home).short) || str(obj(game.home).abbr) || '—';
  return `${away} @ ${home}`;
}

/** "MIL 3 – 2 PIT", away-first, the way the matchup reads. */
function scoreText(game) {
  const a = obj(game.away);
  const h = obj(game.home);
  const aa = str(a.abbr) || str(a.short) || 'A';
  const ha = str(h.abbr) || str(h.short) || 'H';
  return `${aa} ${Number(a.score) || 0} – ${Number(h.score) || 0} ${ha}`;
}

/**
 * The right-hand side of a row: {text, tone}.
 *
 * A postponed or cancelled game is not "pre" — nothing is coming — so it says
 * what ESPN said rather than printing a kick time for a game that will not
 * happen.
 */
function statusOf(game) {
  if (game.dead) return { text: str(game.shortDetail) || str(game.detail) || 'postponed', tone: 'dead' };
  if (game.state === 'in') {
    const clock = str(game.shortDetail) || str(game.detail) || str(game.clock) || 'live';
    return { text: `${scoreText(game)}  ·  ${clock}`, tone: 'in' };
  }
  if (game.state === 'post') return { text: `Final  ·  ${scoreText(game)}`, tone: 'post' };
  // pre: the kick, in Central. '' rather than a guess when the stamp is junk.
  return { text: ctTime(game.startDate) || 'time TBD', tone: 'pre' };
}

function gameRow(game, data, slug) {
  const status = statusOf(game);
  const chips = watchChips(game, data.watch_map, data.local_teams, slug);

  return el('div', { cls: `tg-game tg-game-${status.tone}` }, [
    el('div', { cls: 'tg-game-main' }, [
      el('div', { cls: 'tg-matchup', text: matchupText(game) }),
      chips.length
        ? el(
            'div',
            { cls: 'tg-watch' },
            chips.map((c) => el('span', { cls: `tg-chip tg-chip-${c.kind}`, text: c.text }))
          )
        : el('div', { cls: 'tg-watch' }, [el('span', { cls: 'tg-chip tg-chip-none', text: 'no listing' })]),
    ]),
    el('div', { cls: 'tg-side' }, [el('span', { cls: `tg-status tg-status-${status.tone}`, text: status.text })]),
  ]);
}

/** The sheet body for one league. */
function leagueBody(league, entry, data) {
  const games = sortByKick(entry.games);
  return (body) => {
    if (!entry.ok) {
      body.appendChild(
        el('p', { cls: 'tg-warn', text: `${league.label} feed unavailable — showing the last slate it sent.` })
      );
    }
    if (!games.length) {
      body.appendChild(empty(`No ${league.label} games today.`));
      return;
    }
    body.appendChild(el('div', { cls: 'tg-list' }, games.map((g) => gameRow(g, data, league.slug))));
  };
}

// --------------------------------------------------------------------- tile

export function render(root, tile, ctx) {
  const data = obj(tile.data);
  const leagues = leaguesOf(data);
  const openPanel = typeof ctx?.actions?.openPanel === 'function' ? ctx.actions.openPanel : null;

  if (!leagues.length) {
    root.appendChild(empty('No leagues on the board.'));
    return;
  }

  // The date the board is FOR comes from the snapshot, not from the band —
  // the band may not have run yet, and the header must still be honest.
  const dateCt = str(data.date_ct) || str(ctx?.live?.today?.date_ct);
  const byLeague = ctx?.live?.today?.leagues || null;

  const buttons = leagues.map((league) => {
    const entry = byLeague ? byLeague.get(league.slug) : null;
    const games = entry && Array.isArray(entry.games) ? entry.games : [];
    const anyLive = games.some((g) => g && g.state === 'in' && !g.dead);

    // Three states, and they are deliberately distinguishable: no band yet
    // ("awaiting feed" — we do not know), a known-empty slate (greyed, "no
    // games today"), and a slate with games (the count, plus a dot if one is
    // under way). A zero count is never printed as "0 games".
    let chip;
    let tone;
    if (!entry) {
      chip = el('span', { cls: 'tg-idle', text: 'awaiting feed' });
      tone = 'wait';
    } else if (!games.length) {
      chip = el('span', { cls: 'tg-idle', text: 'no games today' });
      tone = 'none';
    } else {
      chip = el('span', { cls: 'tg-count', text: `${games.length} ${games.length === 1 ? 'game' : 'games'}` });
      tone = anyLive ? 'live' : 'on';
    }

    const title = `${leagueTitle(league)}${dateCt ? ` · ${prettyDate(dateCt)}` : ''}`;
    const build = leagueBody(league, entry || { games: [], ok: true }, data);

    return el(
      'button',
      {
        // Greyed when there is nothing on, but still a button: G6 says the tap
        // must open the empty state with the date rather than going dead.
        cls: `tg-btn tg-btn-${tone}`,
        attrs: { type: 'button' },
        on: {
          click: (e) => {
            // Don't let the tap ride up into the card's Explain handler.
            e.stopPropagation();
            // No sheet to open (the test harness, an older shell): inert
            // rather than broken.
            if (!openPanel) return;
            openPanel(title, build);
          },
        },
      },
      [
        league.emoji ? el('span', { cls: 'tg-emoji', attrs: { 'aria-hidden': 'true' }, text: league.emoji }) : null,
        el('span', { cls: 'tg-btn-label', text: league.label }),
        // The dot is decoration; the pill beside it carries the meaning, and
        // "live" is spelled out for anyone who cannot see a green circle.
        anyLive ? el('span', { cls: 'tg-dot', attrs: { 'aria-label': 'live now' }, text: '●' }) : null,
        chip,
      ]
    );
  });

  root.appendChild(el('div', { cls: 'tg-menu', attrs: { role: 'group', 'aria-label': "Today's Games" } }, buttons));

  const bits = [];
  if (ctx?.live?.fetched_at) bits.push(`feed ${ctTime(ctx.live.fetched_at)}`);
  if (dateCt) bits.push(prettyDate(dateCt));
  if (bits.length) root.appendChild(el('p', { cls: 'tile-foot', text: bits.join(' · ') }));
  else root.appendChild(el('p', { cls: 'tile-foot', text: 'Scores arrive with the LIVE band.' }));

  if (ctx?.live?.error) {
    root.appendChild(el('p', { cls: 'tile-foot warn-text', text: 'feed unavailable — showing last known' }));
  }
}
