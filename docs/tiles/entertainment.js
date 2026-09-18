/**
 * entertainment — a menu tile, same pattern as the newsstand.
 *
 * Four faces: 📺 Watching · 🎙️ Podcasts · 🎬 Top 5 · 🎧 Listening. The board
 * shows four buttons and one faint line; everything else lives in a sheet.
 * Nothing about entertainment is urgent enough to earn board height.
 *
 * The faces are FIXED here, not derived from the payload, because the payload
 * is how a face says it does not exist yet: `top5` and `listening` arrive as
 * `null` until the engine builds them, and a face that is null is still a
 * button — greyed, wearing "soon". A menu derived from the data alone would
 * quietly drop them and Matt would have no idea they were coming. (A face the
 * engine invents later and populates does still get a button, via rule 9 —
 * see `extraFaces`.)
 *
 * THE COUNT CHIP (E8). A face's chip counts items that arrived since Matt last
 * opened that face ON THIS DEVICE — a timestamp per face in localStorage, not
 * in the snapshot, because "have I seen this" is a property of the phone in
 * his hand and not of the vault. Rules that follow from that:
 *
 *   - Storage that is missing, blocked, or corrupt means the face has never
 *     been opened here, so everything counts as new. Never zero — a silent
 *     tile because private mode ate the key is worse than an over-eager chip.
 *   - Nothing new means NO chip. Not "0". The tile is quiet by default.
 *   - Opening a face stamps it, and the chip disappears on the spot rather
 *     than waiting for the next snapshot.
 *
 * What counts as "arrived" is per face, and only two faces have a real answer:
 * a podcast episode has `published_at`, and a show has `last.air_date` (the
 * episode that dropped). Anything else — a weekly top 5, an Audible release
 * date, whatever ships in 2027 — has no per-item arrival stamp, so the whole
 * face falls back to its own `updated_at`. A release_date is deliberately NOT
 * treated as an arrival: it is in the future, and every item would read new
 * forever.
 *
 * Rule 7: `air_date`, `published` and `release_date` are date-only Central
 * strings and are rendered from their parts by `prettyDate`. Where one has to
 * be compared against a `lastOpened` instant, the INSTANT is converted down to
 * its Central date (`ctDate`) and the two date strings are compared as text.
 * No date-only string is ever handed to `new Date()`.
 *
 * Rule 10: every title, show name, episode name and platform lands via
 * textContent, and every link goes through `safeUrl` — including the ones that
 * wrap a whole row.
 *
 * Rule 4, the listing-image carve-out: a Top 5 row may carry a TMDB `poster`
 * URL, and that is the ONLY external asset this tile touches. It is an <img>
 * and never a script, style or fetch; it goes through the same `safeUrl` guard
 * as a link, so anything that is not http(s) is simply not drawn; it carries
 * `referrerpolicy="no-referrer"` and `loading="lazy"`; and the service worker
 * leaves cross-origin requests alone, so it is never cached. A film with no
 * poster shows its rank numeral alone — a broken-image box is worse than no
 * image at all.
 */

import { el, empty, pill, safeUrl } from '../lib/dom.js';
import { prettyDate, airLabel, ago, ctTime, ctDate } from '../lib/fmt.js';

/**
 * The faces, in Matt's build order (E2). `tone` picks the button tint; the
 * emoji is ours rather than the payload's, because unlike a newsstand category
 * these four are named in the spec and not invented by the engine.
 */
const FACES = [
  { key: 'watching', emoji: '📺', label: 'Watching', tone: 'screen' },
  { key: 'podcasts', emoji: '🎙️', label: 'Podcasts', tone: 'mic' },
  { key: 'top5', emoji: '🎬', label: 'Top 5', tone: 'film' },
  { key: 'listening', emoji: '🎧', label: 'Listening', tone: 'audio' },
];

const FACE_KEYS = new Set(FACES.map((f) => f.key));

/** Keys in `data` that are payload metadata, never faces. */
const NOT_A_FACE = new Set(['sources', 'attribution', 'errors', 'updated_at']);

const LS_KEY = 'helm.entertainment.lastOpened';
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A plain object, or {} — the payload is untrusted in shape as well as text. */
function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function items(face) {
  return Array.isArray(face.items) ? face.items.filter((i) => i && typeof i === 'object') : [];
}

// --------------------------------------------------------------- last opened

/**
 * {face: '<UTC ISO>'} — per device, never in the snapshot.
 *
 * Every read is defended: Safari private mode throws on access, the key may be
 * absent, and whatever is in there was written by an older version of this
 * file. Any of those means "not opened here yet".
 */
function readLastOpened() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * A stored stamp, only if it is a real UTC instant.
 *
 * Whatever is in localStorage was written by some version of this file on some
 * day, and a date-only string in there would compare a day wrong forever.
 * Anything that is not an instant reads as "never opened here", which counts
 * everything as new — the conservative direction.
 */
function instantOrNone(v) {
  if (typeof v !== 'string' || YMD_RE.test(v)) return '';
  return Number.isFinite(Date.parse(v)) ? v : '';
}

/** Stamp one face. A failure here costs a chip, never the page. */
function writeLastOpened(key, iso) {
  try {
    const all = readLastOpened();
    all[key] = iso;
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* no storage: the chip simply keeps counting */
  }
}

// -------------------------------------------------------------------- newness

/**
 * When an item arrived, or null when this face has no per-item answer.
 * Returns either a UTC ISO instant or a date-only Central string; `newerThan`
 * handles both.
 */
const ARRIVED = {
  podcasts: (i) => i.published_at || i.published || null,
  watching: (i) => obj(i.last).air_date || null,
};

/**
 * true / false / null — null meaning "this stamp cannot answer", which sends
 * the caller to the face-level fallback.
 */
function newerThan(stamp, sinceIso) {
  if (!stamp) return null;
  const s = String(stamp);
  if (YMD_RE.test(s)) {
    // A business date against an instant: bring the instant down to the
    // Central day it fell on and compare text. Strictly greater, so a day
    // already seen does not re-announce itself on every render.
    const seen = ctDate(sinceIso);
    return seen ? s > seen : null;
  }
  const t = Date.parse(s);
  const u = Date.parse(sinceIso);
  if (!Number.isFinite(t) || !Number.isFinite(u)) return null;
  return t > u;
}

/** Is this one item new? Falls back to the face's own freshness. */
function itemIsNew(faceKey, item, sinceIso, faceFresh) {
  if (!sinceIso) return true; // never opened on this device
  const stamp = ARRIVED[faceKey] ? ARRIVED[faceKey](item) : null;
  const verdict = newerThan(stamp, sinceIso);
  return verdict === null ? faceFresh : verdict;
}

/** How many of a face's items are new since `sinceIso`. */
function countNew(faceKey, faceData, list, sinceIso) {
  if (!sinceIso) return list.length;
  const faceFresh = newerThan(faceData.updated_at, sinceIso) === true;
  let n = 0;
  for (const item of list) if (itemIsNew(faceKey, item, sinceIso, faceFresh)) n++;
  return n;
}

// ----------------------------------------------------------------- sheet bits

/** The whole row is the link — or is not a link at all, if the URL is junk. */
function linkRow(href, cls, kids) {
  const safe = safeUrl(href);
  if (!safe) return el('div', { cls }, kids);
  return el('a', { cls: `${cls} ent-row-link`, attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' } }, kids);
}

const newMark = () => el('span', { cls: 'ent-new-mark', text: 'new' });

/** A face's own errors, reported rather than swallowed (rule 8). */
function errorsInto(body, errors) {
  const list = Array.isArray(errors) ? errors.filter(Boolean) : [];
  if (!list.length) return;
  body.appendChild(
    el('p', { cls: 'ent-errors', text: `feed trouble: ${list.map((e) => String(e)).join(' · ')}` })
  );
}

// -------------------------------------------------------------- watching face

/** 'S6E3 · The Name', or the honest alternative. */
function episodeText(next) {
  const s = Number(next.season);
  const e = Number(next.episode);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'no episode scheduled';
  const name = next.name ? ` · ${String(next.name)}` : '';
  return `S${s}E${e}${name}`;
}

function watchRow(item, isNew) {
  const next = obj(item.next);
  const chip = airLabel(item.days);
  const air = next.air_date ? prettyDate(next.air_date) : '';

  const meta = [air, item.status_note ? String(item.status_note) : ''].filter(Boolean).join('  ·  ');

  return linkRow(item.link, 'ent-row', [
    el('div', { cls: 'ent-row-main' }, [
      el('div', { cls: 'ent-row-title-line' }, [
        el('span', { cls: 'ent-row-title', text: String(item.title ?? '(untitled)') }),
        isNew ? newMark() : null,
      ]),
      el('div', { cls: 'ent-row-sub', text: episodeText(next) }),
      meta ? el('div', { cls: 'ent-row-meta', text: meta }) : null,
    ]),
    el('div', { cls: 'ent-row-side' }, [
      item.platform ? el('span', { cls: 'ent-platform', text: String(item.platform) }) : null,
      chip ? pill(chip.text, chip.tone) : null,
    ]),
  ]);
}

function watchingBody(faceData, list, sinceIso, attribution) {
  const faceFresh = newerThan(faceData.updated_at, sinceIso) === true;
  return (body) => {
    if (!list.length) {
      body.appendChild(empty('Nothing on the shelf.'));
    } else {
      body.appendChild(
        el('div', { cls: 'ent-list' }, list.map((i) => watchRow(i, itemIsNew('watching', i, sinceIso, faceFresh))))
      );
    }
    errorsInto(body, faceData.errors);
    // TMDB's terms require the attribution wherever their data is shown, and
    // it is the vault's string, printed verbatim.
    if (attribution) body.appendChild(el('p', { cls: 'ent-foot', text: String(attribution) }));
  };
}

// -------------------------------------------------------------- podcasts face

/**
 * A sort key for an episode. Never rendered — only compared — so the date-only
 * branch may use Date.UTC on the parts, which is pure calendar arithmetic and
 * not a timezone conversion.
 */
function publishedRank(item) {
  const t = Date.parse(item.published_at);
  if (Number.isFinite(t)) return t;
  const p = String(item.published ?? '');
  if (YMD_RE.test(p)) {
    const [y, m, d] = p.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  return -Infinity; // undated sinks
}

/** Shows, each newest-first inside, ordered by whichever show dropped last. */
function groupByShow(list) {
  const groups = new Map();
  for (const item of list) {
    const label = String(item.show ?? '').trim();
    const key = label.toLowerCase() || ' unnamed';
    let g = groups.get(key);
    if (!g) {
      g = { key, label: label || 'Unnamed show', episodes: [] };
      groups.set(key, g);
    }
    g.episodes.push(item);
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.episodes.sort((a, b) => publishedRank(b) - publishedRank(a));
    g.newest = g.episodes.length ? publishedRank(g.episodes[0]) : -Infinity;
  }
  out.sort((a, b) => b.newest - a.newest || a.label.localeCompare(b.label));
  return out;
}

function episodeRow(item, isNew) {
  const bits = [];
  if (item.published) bits.push(prettyDate(item.published));
  const mins = Number(item.duration_min);
  if (Number.isFinite(mins) && mins > 0) bits.push(`${Math.round(mins)} min`);

  return linkRow(item.url, 'ent-row', [
    el('div', { cls: 'ent-row-main' }, [
      el('div', { cls: 'ent-row-title-line' }, [
        el('span', { cls: 'ent-row-title', text: String(item.title ?? '(untitled)') }),
        isNew ? newMark() : null,
      ]),
      bits.length ? el('div', { cls: 'ent-row-meta', text: bits.join('  ·  ') }) : null,
    ]),
  ]);
}

function podcastsBody(faceData, list, sinceIso) {
  const faceFresh = newerThan(faceData.updated_at, sinceIso) === true;
  return (body) => {
    if (!list.length) {
      body.appendChild(empty('No new episodes.'));
    } else {
      for (const group of groupByShow(list)) {
        body.appendChild(el('h4', { cls: 'ent-group-head', text: group.label }));
        body.appendChild(
          el(
            'div',
            { cls: 'ent-list' },
            group.episodes.map((e) => episodeRow(e, itemIsNew('podcasts', e, sinceIso, faceFresh)))
          )
        );
      }
    }
    errorsInto(body, faceData.errors);
    // Said once, because the badge promises less than it looks like it does:
    // the page can see a publish date and cannot see a play.
    body.appendChild(
      el('p', { cls: 'ent-foot', text: 'New means published since you last opened this, not unheard.' })
    );
  };
}

// ------------------------------------------------------------------ top5 face

/**
 * TMDB's vote average as '★ 8.2', or nothing at all.
 *
 * `Number(null)` is 0, so a guard of Number.isFinite alone would print a
 * confident '★ 0.0' on a film the payload simply has no rating for. Absent
 * must read as absent — the star is hidden, not zeroed.
 */
function ratingText(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `★ ${n.toFixed(1)}`;
}

/**
 * '(2024)', or nothing.
 *
 * A release year is a number and not a date: it is never parsed, never
 * formatted through Intl, and never handed to `new Date()` (rule 7).
 */
function yearText(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `(${Math.trunc(n)})`;
}

/**
 * One film. The rank is the row's position in the payload — the engine has
 * already ranked them, and the page does not re-sort or re-score anything.
 */
function top5Row(item, rank, isNew) {
  const poster = safeUrl(item.poster);
  const rating = ratingText(item.rating);
  const year = yearText(item.year);
  const genre = item.genre ? String(item.genre) : '';
  const provider = item.provider ? String(item.provider) : '';
  const overview = item.overview ? String(item.overview) : '';

  return linkRow(item.link, 'ent-row ent-top5-row', [
    el('div', { cls: 'ent-top5-gutter' }, [
      el('span', { cls: 'ent-rank', text: String(rank) }),
      // Rule 4's carve-out, and only under it: an <img>, a vetted http(s) URL,
      // no referrer, lazy. Absent or refused means the numeral stands alone.
      poster
        ? el('img', {
            cls: 'ent-poster',
            attrs: {
              src: poster,
              alt: '',
              loading: 'lazy',
              referrerpolicy: 'no-referrer',
              width: '40',
              height: '60',
            },
          })
        : null,
    ]),
    el('div', { cls: 'ent-row-main' }, [
      el('div', { cls: 'ent-row-title-line' }, [
        el('span', { cls: 'ent-row-title', text: String(item.title ?? '(untitled)') }),
        year ? el('span', { cls: 'ent-year', text: year }) : null,
        isNew ? newMark() : null,
        rating ? el('span', { cls: 'ent-rating', text: rating }) : null,
      ]),
      genre || provider
        ? el('div', { cls: 'ent-top5-sub' }, [
            genre ? el('span', { cls: 'ent-genre', text: genre }) : null,
            // The same quiet chip the Watching face gives a platform: this is
            // the same fact — where the thing can be watched.
            provider ? pill(provider, 'neutral') : null,
          ])
        : null,
      overview ? el('div', { cls: 'ent-overview', text: overview }) : null,
    ]),
  ]);
}

/**
 * The weekly five.
 *
 * Newness is the face-level fallback and nothing cleverer: a top 5 has no
 * per-item arrival stamp, and `week_of` is emphatically not one — it is the
 * Monday the list belongs to, not the moment a film showed up, and treating it
 * as an arrival would mark all five new every render for a week.
 */
function top5Body(faceData, list, sinceIso, attribution) {
  const faceFresh = newerThan(faceData.updated_at, sinceIso) === true;
  // Rule 7: `week_of` is a date-only Central string, so it goes through
  // prettyDate, which builds the words from the parts. `new Date(week_of)`
  // would render the Monday as the Sunday before it for anyone in Central.
  const week = faceData.week_of ? prettyDate(faceData.week_of) : '';

  return (body) => {
    if (!list.length) {
      body.appendChild(empty('No picks this week.'));
    } else {
      body.appendChild(
        el(
          'div',
          { cls: 'ent-list' },
          list.map((item, i) => top5Row(item, i + 1, itemIsNew('top5', item, sinceIso, faceFresh)))
        )
      );
    }
    errorsInto(body, faceData.errors);
    body.appendChild(
      el('p', { cls: 'ent-foot', text: week ? `Week of ${week} · Data from TMDB` : 'Data from TMDB' })
    );
    // And the vault's own attribution string under it, verbatim, exactly as
    // the Watching face prints it.
    if (attribution) body.appendChild(el('p', { cls: 'ent-foot', text: String(attribution) }));
  };
}

// --------------------------------------------------------------- generic face

/**
 * A face with no renderer of its own — `top5` and `listening` the day the
 * engine lights them up, or anything after that. Rule 9: the sheet shows what
 * arrived rather than nothing, and a page deploy makes it pretty later.
 */
function genericBody(faceData, list, sinceIso, attribution) {
  const faceFresh = newerThan(faceData.updated_at, sinceIso) === true;
  return (body) => {
    if (!list.length) {
      body.appendChild(empty('Nothing here yet.'));
    } else {
      body.appendChild(
        el(
          'div',
          { cls: 'ent-list' },
          list.map((item) => {
            const title = item.title || item.name || item.series || item.show || '(untitled)';
            const meta = Object.entries(item)
              .filter(([k, v]) => k !== 'title' && (typeof v === 'string' || typeof v === 'number'))
              .map(([k, v]) => `${k}: ${v}`)
              .join('  ·  ');
            return linkRow(item.link || item.url, 'ent-row', [
              el('div', { cls: 'ent-row-main' }, [
                el('div', { cls: 'ent-row-title-line' }, [
                  el('span', { cls: 'ent-row-title', text: String(title) }),
                  itemIsNew('', item, sinceIso, faceFresh) ? newMark() : null,
                ]),
                meta ? el('div', { cls: 'ent-row-meta', text: meta }) : null,
              ]),
            ]);
          })
        )
      );
    }
    errorsInto(body, faceData.errors);
    if (attribution) body.appendChild(el('p', { cls: 'ent-foot', text: String(attribution) }));
  };
}

// ---------------------------------------------------------------------- menu

function bodyFor(faceKey, faceData, list, sinceIso, attribution) {
  if (faceKey === 'watching') return watchingBody(faceData, list, sinceIso, attribution);
  if (faceKey === 'podcasts') return podcastsBody(faceData, list, sinceIso);
  if (faceKey === 'top5') return top5Body(faceData, list, sinceIso, attribution);
  return genericBody(faceData, list, sinceIso, attribution);
}

/**
 * Faces the engine grew that this file has never heard of. Only counted when
 * they look like a populated face — an object carrying an `items` array — so
 * an unrelated key the payload sprouts does not become a phantom button.
 */
function extraFaces(data) {
  const out = [];
  for (const [key, value] of Object.entries(data)) {
    if (FACE_KEYS.has(key) || NOT_A_FACE.has(key)) continue;
    if (!Array.isArray(obj(value).items)) continue;
    out.push({ key, emoji: '', label: key, tone: 'neutral' });
  }
  return out;
}

export function render(root, tile, ctx) {
  const data = obj(tile.data);
  const attribution = typeof data.attribution === 'string' ? data.attribution : '';
  const lastOpened = readLastOpened();
  const openPanel = ctx && ctx.actions && typeof ctx.actions.openPanel === 'function' ? ctx.actions.openPanel : null;

  const buttons = [];
  const stamps = [];

  for (const face of [...FACES, ...extraFaces(data)]) {
    const raw = data[face.key];
    const live = raw && typeof raw === 'object' && !Array.isArray(raw);

    if (!live) {
      // Declared in the spec, not built by the engine yet. A button, so the
      // face is visible as coming; disabled, so the tap goes nowhere honest.
      buttons.push(
        el('button', { cls: 'ent-btn ent-btn-soon', attrs: { type: 'button', disabled: 'disabled' } }, [
          face.emoji ? el('span', { cls: 'ent-emoji', attrs: { 'aria-hidden': 'true' }, text: face.emoji }) : null,
          el('span', { cls: 'ent-btn-label', text: face.label }),
          el('span', { cls: 'ent-soon', text: 'soon' }),
        ])
      );
      continue;
    }

    const faceData = obj(raw);
    const list = items(faceData);
    const since = instantOrNone(lastOpened[face.key]);
    const n = countNew(face.key, faceData, list, since);
    if (faceData.updated_at) stamps.push(faceData.updated_at);

    // Quiet when nothing is new: no chip at all, not a zero.
    const chip = n > 0 ? el('span', { cls: 'ent-count', text: `${n} new` }) : null;

    const title = face.emoji ? `${face.emoji} ${face.label}` : face.label;
    const build = bodyFor(face.key, faceData, list, since, attribution);

    buttons.push(
      el(
        'button',
        {
          cls: `ent-btn ent-btn-${face.tone}`,
          attrs: { type: 'button' },
          on: {
            click: (e) => {
              // Don't let the tap ride up into the card's Explain handler.
              e.stopPropagation();
              // No sheet to open (the test harness, an older shell): inert
              // rather than broken, and nothing is marked seen either.
              if (!openPanel) return;
              openPanel(title, build);
              writeLastOpened(face.key, new Date().toISOString());
              // Seen. The chip goes now rather than at the next snapshot.
              if (chip) chip.classList.add('hidden');
            },
          },
        },
        [
          face.emoji ? el('span', { cls: 'ent-emoji', attrs: { 'aria-hidden': 'true' }, text: face.emoji }) : null,
          el('span', { cls: 'ent-btn-label', text: face.label }),
          chip,
        ]
      )
    );
  }

  root.appendChild(el('div', { cls: 'ent-menu', attrs: { role: 'group', 'aria-label': 'Entertainment' } }, buttons));

  // The oldest face is the honest one: the tile is only as current as its
  // stalest populated face, and a fresh podcast list must not make a
  // three-day-old episode schedule look fresh too.
  const oldest = stamps
    .map((s) => ({ s, t: Date.parse(s) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t)[0];
  if (oldest) {
    root.appendChild(
      el('p', { cls: 'tile-foot', text: `oldest face updated ${ago(oldest.s)} · ${ctTime(oldest.s)} CT` })
    );
  }
}
