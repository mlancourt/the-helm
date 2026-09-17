/**
 * mke_board — one row per Milwaukee-area team: opponent, score or next kick,
 * countdown.
 *
 * The snapshot only supplies the watchlist ({abbr, league}); everything on the
 * right-hand side comes from ESPN in the browser. Until M3 wires that up the
 * rows render with an honest placeholder rather than inventing a fixture.
 */

import { el, empty } from '../lib/dom.js';
import { ctTime } from '../lib/fmt.js';

const LEAGUE_LABEL = {
  'football/nfl': 'NFL',
  'baseball/mlb': 'MLB',
  'basketball/nba': 'NBA',
  'hockey/nhl': 'NHL',
  'soccer/usa.1': 'MLS',
  'basketball/mens-college-basketball': 'NCAAM',
};

function leagueLabel(slug) {
  return LEAGUE_LABEL[slug] || String(slug || '').split('/').pop().toUpperCase();
}

function teamRow(team, entry) {
  const left = el('div', { cls: 'mke-left' }, [
    el('span', { cls: 'mke-abbr', text: team.abbr || '—' }),
    el('span', { cls: 'mke-league', text: leagueLabel(team.league) }),
  ]);

  let right;
  if (!entry) {
    right = el('span', { cls: 'mke-idle', text: 'awaiting feed' });
  } else if (entry.state === 'in') {
    right = el('div', { cls: 'mke-right' }, [
      el('span', { cls: 'mke-opp', text: entry.opponent || '' }),
      el('span', { cls: 'mke-score live', text: `${entry.score || ''} · ${entry.detail || 'live'}` }),
    ]);
  } else if (entry.state === 'post') {
    right = el('div', { cls: 'mke-right' }, [
      el('span', { cls: 'mke-opp', text: entry.opponent || '' }),
      el('span', { cls: 'mke-score', text: `${entry.score || ''} · final` }),
    ]);
  } else if (entry.state === 'pre') {
    right = el('div', { cls: 'mke-right' }, [
      el('span', { cls: 'mke-opp', text: entry.opponent || '' }),
      el('span', { cls: 'mke-score', text: [entry.kick, entry.countdown].filter(Boolean).join(' · ') }),
    ]);
  } else {
    right = el('span', { cls: 'mke-idle', text: 'no game today' });
  }

  return el('div', { cls: 'mke-row' }, [left, right]);
}

export function render(el_, tile, ctx) {
  const teams = Array.isArray(tile.data?.teams) ? tile.data.teams : [];
  if (!teams.length) {
    el_.appendChild(empty('No teams on the board.'));
    return;
  }

  const board = ctx.live?.board || null;
  el_.appendChild(
    el(
      'div',
      { cls: 'mke' },
      teams.map((t) => teamRow(t, board ? board.get(`${t.league}:${t.abbr}`) : null))
    )
  );

  if (!board) {
    el_.appendChild(el('p', { cls: 'tile-foot', text: 'Scores arrive with the LIVE band (M3).' }));
  } else if (ctx.live?.error) {
    el_.appendChild(el('p', { cls: 'tile-foot warn-text', text: 'feed unavailable — showing last known' }));
  } else if (ctx.live?.fetched_at) {
    el_.appendChild(el('p', { cls: 'tile-foot', text: `feed ${ctTime(ctx.live.fetched_at)}` }));
  }
}
