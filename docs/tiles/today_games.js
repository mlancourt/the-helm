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
 * TOMORROW (v1.1, 2026-09-21). One muted line under the grid opens the same
 * slate view pointed at `date_next_ct`. It is deliberately the cheapest thing
 * that could work:
 *   - NO count on the line. A count means fetching all eight leagues on board
 *     load, every load, for a number nobody asked for. The line says
 *     "tomorrow" and costs nothing until it is tapped.
 *   - NO clock behind the sheet. Tomorrow's games do not move, so there is
 *     nothing to poll: the sheet fetches once when it opens and stops. It is
 *     not registered with `live/band.js` and starts no timer.
 *   - ONE combined sheet, not a second menu. Eight taps to find out nobody
 *     plays tomorrow is not a feature.
 *
 * THE ONE FETCH THIS MODULE DOES. Everywhere else on this board a tile reads
 * and the band fetches, because the band owns a CLOCK. Tomorrow has no clock,
 * so there is nothing for the band to own; wiring a second (league, date) plan
 * into it to serve a sheet that may never open would be the more complicated
 * answer, not the safer one. The call still goes through `live/espn.js` —
 * which builds the URL, coalesces duplicates and keys by league AND date, so
 * tomorrow can never be served today's slate — and `ctx.actions.fetchScoreboard`
 * overrides it so `?mock=1` reaches no origin at all.
 *
 * RULE 7: `date_ct` and `date_next_ct` are Central calendar strings. They are
 * rendered from their parts by `prettyDate` and converted to ESPN's `dates=`
 * by string ops in espn.js. Neither is ever handed to `new Date()`, and
 * tomorrow is NEVER computed here — the engine already worked it out in
 * Central, which is the only place that knows when Central's day rolls over.
 * Kick times are a different kind of time: `startDate` is a real UTC instant
 * off `event.date`, so it goes through `ctTime`, which parses it and formats
 * it in Central.
 *
 * THE BOARD (v1.2, 2026-10-06, spec O1–O9). Under each game, one row of three
 * chips — spread · total · moneyline — off the odds object ESPN already sends
 * in the SAME scoreboard call (DraftKings; one book across all eight leagues,
 * so the numbers compare). No new origin, no key, no extra request: the
 * normalizer in live/espn.js carries it as `game.odds` and this module prints
 * it. A final adds what the game did to the number (`covered` / `Over` /
 * `push`); a moved spread or total says where it opened (`was -8.5`). No odds
 * → no row, exactly as with the watch chips. Prices are strings and stay
 * strings; the only number parsed here is a LINE, and only to say which side
 * of it the final landed on. The Bookie grades tickets; this is the slate.
 *
 * RULE 10: every team name, status string, broadcast name and price is ESPN's
 * text and lands via textContent. There are no links: broadcast names are
 * channel names, not URLs, and inventing one would be guessing.
 */

import { el, empty, clear } from '../lib/dom.js';
import { ctTime, prettyDate } from '../lib/fmt.js';
import { compactCtDate, onCtDate, fetchScoreboard as realFetchScoreboard } from '../live/espn.js';

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

// --------------------------------------------------------------------- odds

/**
 * The one number this module parses: a line like "-9.5", "+1.5", "47.5" or
 * "2.5" -> a finite number, or null for anything else ("EVEN", "", "PK").
 * Prices are never parsed — they are printed as ESPN wrote them.
 */
function lineNum(v) {
  const s = str(v).trim().replace(/^[ou](?=[\d.+-])/i, '').replace('−', '-');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "DAL -9.5 -110" — abbr, line, price; each part only when present. */
function join(...parts) {
  return parts.filter((p) => p !== null && p !== undefined && String(p) !== '').join(' ');
}

/**
 * One game's odds chips: `[{text, kind}]` — spread, total, moneyline, in that
 * order (Today's Games spec O3). `kind` is a class name only.
 *
 * PRE: the current line. IN: the same line — ESPN carries DraftKings's
 * pre-game board, not a live one, and the tile does not pretend otherwise.
 * POST (O4): the line plus what happened to it — `· HRN covered`, `· Over`,
 * `· push` — from the final score against the closing line. That is the one
 * piece of arithmetic in this module, and it is arithmetic on two facts the
 * row already shows, not a grade: the Bookie settles tickets, this says
 * which side of a number the game landed on.
 *
 * MOVEMENT (O5): when the book opened at a different spread or total, the
 * chip says `· was -8.5`. The moneyline gets no movement note — a price moves
 * every hour and the noise would drown the signal.
 *
 * A game with no odds returns [] and the row draws nothing (O6). A dead game
 * (postponed, cancelled) returns [] too — there is no number to land on.
 */
export function oddsChips(game) {
  const odds = obj(game?.odds);
  if (!game || game.dead || !Object.keys(odds).length) return [];

  const home = obj(game.home);
  const away = obj(game.away);
  const ha = str(home.abbr) || str(home.short) || 'H';
  const aa = str(away.abbr) || str(away.short) || 'A';
  const final = game.state === 'post' && game.completed !== false;
  const hs = Number(home.score) || 0;
  const as = Number(away.score) || 0;

  const out = [];

  // -- spread: the favourite's side (negative line); home when neither is. --
  const sp = obj(odds.spread);
  const spHome = obj(sp.home);
  const spAway = obj(sp.away);
  const hLine = lineNum(spHome.line);
  const aLine = lineNum(spAway.line);
  let spreadText = '';
  if (hLine !== null || aLine !== null) {
    const favHome = aLine === null || (hLine !== null && hLine <= aLine);
    const fav = favHome ? spHome : spAway;
    spreadText = join(favHome ? ha : aa, str(fav.line), str(fav.price));
    const openLeg = obj(obj(obj(odds.open).spread)[favHome ? 'home' : 'away']);
    const openLine = lineNum(openLeg.line);
    const curLine = favHome ? hLine : aLine;
    if (final && hLine !== null) {
      // Home covers when its margin beats its own line: margin + line > 0.
      const edge = hs - as + hLine;
      spreadText += edge === 0 ? ' · push' : ` · ${edge > 0 ? ha : aa} covered`;
    } else if (final && aLine !== null) {
      const edge = as - hs + aLine;
      spreadText += edge === 0 ? ' · push' : ` · ${edge > 0 ? aa : ha} covered`;
    } else if (openLine !== null && curLine !== null && openLine !== curLine) {
      spreadText += ` · was ${str(openLeg.line)}`;
    }
  } else if (str(odds.details)) {
    // An older payload: ESPN's own one-liner ("DAL -9.5"), verbatim.
    spreadText = str(odds.details);
  }
  if (spreadText) out.push({ text: spreadText, kind: 'spread' });

  // -- total ---------------------------------------------------------------
  const tot = obj(odds.total);
  const tLine = str(tot.line);
  if (tLine) {
    const prices = str(tot.over) && str(tot.under) ? `${str(tot.over)}/${str(tot.under)}` : str(tot.over) || str(tot.under);
    let totalText = join(`O/U ${tLine}`, prices);
    const n = lineNum(tLine);
    const openN = lineNum(obj(obj(odds.open).total).line);
    if (final && n !== null) {
      const sum = hs + as;
      totalText += sum === n ? ' · push' : ` · ${sum > n ? 'Over' : 'Under'}`;
    } else if (openN !== null && n !== null && openN !== n) {
      totalText += ` · was ${str(obj(obj(odds.open).total).line)}`;
    }
    out.push({ text: totalText, kind: 'total' });
  }

  // -- moneyline: away first, the way the matchup reads; Draw in the middle
  //    when the book offers one (soccer). --------------------------------------
  const ml = obj(odds.moneyline);
  const legs = [];
  if (str(ml.away)) legs.push(`${aa} ${str(ml.away)}`);
  if (str(ml.draw)) legs.push(`Draw ${str(ml.draw)}`);
  if (str(ml.home)) legs.push(`${ha} ${str(ml.home)}`);
  if (legs.length) out.push({ text: legs.join(' · '), kind: 'ml' });

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

/**
 * One game. The ONLY row shape this tile has — today's sheet and tomorrow's
 * sheet are the same rows pointed at a different date, and a second builder
 * would be a second set of rules to keep in step.
 *
 * A game with NO broadcasts renders no chips and no chip row at all. It used
 * to say "no listing", which was wrong even for today and is actively noisy
 * for tomorrow: ESPN populates broadcasts close to kick, so most of tomorrow's
 * slate has none yet, and forty rows each announcing that ESPN has not decided
 * is forty rows of nothing. Absence is not news — the same standing ruling
 * that keeps `purser_due` silent on an empty stack.
 */
function gameRow(game, data, slug) {
  const status = statusOf(game);
  const chips = watchChips(game, data.watch_map, data.local_teams, slug);
  const odds = oddsChips(game);

  return el('div', { cls: `tg-game tg-game-${status.tone}` }, [
    el('div', { cls: 'tg-game-main' }, [
      el('div', { cls: 'tg-matchup', text: matchupText(game) }),
      chips.length
        ? el(
            'div',
            { cls: 'tg-watch' },
            chips.map((c) => el('span', { cls: `tg-chip tg-chip-${c.kind}`, text: c.text }))
          )
        : null,
      // The board (O3). Same rule as the watch row: no odds, no row.
      odds.length
        ? el(
            'div',
            { cls: 'tg-odds' },
            odds.map((c) => el('span', { cls: `tg-odd tg-odd-${c.kind}`, text: c.text }))
          )
        : null,
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

// ----------------------------------------------------------------- tomorrow

/**
 * The tomorrow sheet: every followed league's slate for `date_next_ct`, in one
 * body, grouped by league in PAYLOAD order and sorted by kick within a league.
 *
 * A league with nothing on renders NOTHING — no heading, no "no games" line.
 * Eight empty headers is the noise this design exists to avoid, and the
 * whole-sheet answer ("No games tomorrow.") is one line, said once.
 *
 * A league whose call FAILED is not a league with nothing on, so it says so:
 * rule 8 forbids reporting an empty slate the network invented. If every
 * league answered and every league was empty, that is the one-line case; if
 * some died, the warnings stand on their own rather than being contradicted
 * by a cheerful "no games".
 *
 * The builder returns a teardown that only sets a flag. There is no timer to
 * clear — that is the point of this sheet — but a fetch in flight when the
 * sheet closes must not paint into a body the shell has moved on from.
 */
function tomorrowBody(leagues, data, dateCt, fetchBoard) {
  const compact = compactCtDate(dateCt);

  return (body) => {
    let cancelled = false;
    body.appendChild(el('p', { cls: 'tg-loading', text: 'Fetching tomorrow’s slate…' }));

    Promise.all(
      leagues.map((league) =>
        Promise.resolve()
          .then(() => fetchBoard(league.slug, compact))
          // ESPN's `dates=` is a hint: a thin day comes back with its
          // neighbours attached. Tomorrow is the thin day.
          .then((events) => ({ league, games: onCtDate(events, compact), ok: true }))
          .catch(() => ({ league, games: [], ok: false }))
      )
    )
      .then((rows) => {
        if (cancelled) return;
        clear(body);
        paintTomorrow(body, rows, data);
      })
      .catch(() => {
        if (cancelled) return;
        clear(body);
        body.appendChild(el('p', { cls: 'tg-warn', text: 'feed unavailable — tomorrow’s slate did not load.' }));
      });

    return () => {
      cancelled = true;
    };
  };
}

function paintTomorrow(body, rows, data) {
  const failed = rows.filter((r) => !r.ok);
  for (const r of failed) {
    body.appendChild(el('p', { cls: 'tg-warn', text: `${r.league.label} feed unavailable.` }));
  }

  const playing = rows.filter((r) => r.ok && r.games.length);
  for (const r of playing) {
    body.appendChild(el('h3', { cls: 'tg-league-head', text: leagueTitle(r.league) }));
    body.appendChild(
      el('div', { cls: 'tg-list' }, sortByKick(r.games).map((g) => gameRow(g, data, r.league.slug)))
    );
  }

  if (!playing.length && !failed.length) body.appendChild(empty('No games tomorrow.'));
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

  // -- the tomorrow line --------------------------------------------------
  //
  // Rendered only when the payload carries a date this page can turn into a
  // `dates=` parameter. An old snapshot with no `date_next_ct` gets no line at
  // all (rule 9: the rest of the tile renders normally), and so does a
  // malformed one — a link that cannot be fetched for is a dead end, and a
  // dead end is worse than an absence.
  //
  // No count, no badge, no dot. A count would mean fetching every league on
  // every board load to answer a question nobody asked.
  const nextCt = str(data.date_next_ct);
  if (compactCtDate(nextCt)) {
    const fetchBoard =
      typeof ctx?.actions?.fetchScoreboard === 'function' ? ctx.actions.fetchScoreboard : realFetchScoreboard;
    const tomorrowTitle = `Tomorrow · ${prettyDate(nextCt)}`;
    const build = tomorrowBody(leagues, data, nextCt, fetchBoard);

    root.appendChild(
      el('button', {
        cls: 'tg-tomorrow',
        attrs: { type: 'button' },
        text: `Tomorrow → ${prettyDate(nextCt)}`,
        on: {
          click: (e) => {
            e.stopPropagation();
            if (!openPanel) return;
            openPanel(tomorrowTitle, build);
          },
        },
      })
    );
  }

  const bits = [];
  if (ctx?.live?.fetched_at) bits.push(`feed ${ctTime(ctx.live.fetched_at)}`);
  if (dateCt) bits.push(prettyDate(dateCt));
  if (bits.length) root.appendChild(el('p', { cls: 'tile-foot', text: bits.join(' · ') }));
  else root.appendChild(el('p', { cls: 'tile-foot', text: 'Scores arrive with the LIVE band.' }));

  if (ctx?.live?.error) {
    root.appendChild(el('p', { cls: 'tile-foot warn-text', text: 'feed unavailable — showing last known' }));
  }
}
