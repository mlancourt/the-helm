/**
 * weather — the one screen Matt checks before he decides whether to hook up
 * the trailer (Weather spec, W1–W15). Registry #14, LIVE band.
 *
 * THE DIVISION OF LABOUR (W2), the same one `today_games` runs on: the engine
 * publishes CONFIGURATION — the gridpoint, the station, the radar site, the
 * glyph map, the alert vocabulary — plus one offline `fallback` copy. Every
 * live number comes from api.weather.gov in the browser, on the weather band's
 * clock. This module never fetches; live/nws.js does that and live/band.js
 * decides when.
 *
 * PREFER LIVE, FALL BACK, AND ONLY THEN GIVE UP (W11). Three states and they
 * are deliberately distinguishable:
 *   live      the band has something — render it plainly
 *   fallback  the band has nothing — render the engine's copy GREYED, with the
 *             `as of` it was published with, so nothing on screen pretends to
 *             be current
 *   neither   "feed unavailable", and only then
 * A tile that goes white because a federal endpoint hiccupped is a broken tile.
 *
 * RULE 4's amendment lives in live/nws.js (fetch) and in radarBox() below
 * (`<img>` only — never fetched, never script, never service-worker cached,
 * `referrerpolicy="no-referrer"`, lazy, and a tap-to-load placeholder on a
 * metered connection, because a 1 MB GIF is not something to spend somebody's
 * data on without asking).
 *
 * RULE 7 (W12): `sun.date` and each day's `date` are Central calendar strings
 * and are rendered from their parts — never `new Date()`. Alert and forecast
 * timestamps are real instants carrying an offset, so they go through
 * `ctTime`, which is allowed to parse them.
 *
 * RULE 10 (W12): every NWS string — headline, description, instruction,
 * shortForecast, areaDesc — lands via textContent. Government text is still
 * untrusted content, and these descriptions really do arrive with hard line
 * breaks and a bare URL inside them (`white-space: pre-line`, no autolinking).
 *
 * The tile files nothing (W14). No events, no writes, no money. The only link
 * out is the NWS's own page for an active alert.
 */

import { el, empty, extLink, pill } from '../lib/dom.js';
import { ctClock, ctTime, prettyDate } from '../lib/fmt.js';
import { alertTier, glyph, radarSrc, sourceLabel } from '../live/nws.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** '69' -> '69°', null -> '—'. A missing temperature is never a zero. */
function deg(v) {
  const n = num(v);
  return n === null ? '—' : `${Math.round(n)}°`;
}

// ------------------------------------------------------------------- state

/**
 * Which copy of the weather is on screen, and whether it is current.
 *
 * ONE function, because the face, the sheet and the board banner must never
 * disagree about that — a banner drawn from a live warning while the face
 * greys out the fallback would be the tile arguing with itself.
 */
export function resolve(tile, weather) {
  const data = obj(obj(tile).data);
  const w = obj(weather);

  const dress = (alerts) => {
    const muted = new Set(arr(data.mute).map((m) => str(m).trim().toLowerCase()));
    return arr(alerts)
      .map((raw) => {
        const a = obj(raw);
        const event = str(a.event).trim();
        if (!event || muted.has(event.toLowerCase())) return null;
        return {
          ...a,
          event,
          // The engine tiers its fallback already; a payload that did not is
          // tiered here against the same vocabulary rather than rendered grey
          // by default.
          tier: str(a.tier) || alertTier(event, data.warn_events),
          id: str(a.id) || `${event}|${str(a.onset)}|${str(a.ends)}`,
        };
      })
      .filter(Boolean);
  };

  if (w.ok) {
    return {
      live: true,
      partial: !!w.partial,
      alerts: dress(w.alerts),
      now: obj(w.now).source ? obj(w.now) : null,
      days: arr(w.days),
      as_of: str(w.fetched_at),
    };
  }

  const fb = obj(data.fallback);
  if (fb.as_of || fb.now || fb.days || fb.alerts) {
    return {
      live: false,
      partial: false,
      alerts: dress(fb.alerts),
      now: obj(fb.now).source ? obj(fb.now) : null,
      days: arr(fb.days),
      as_of: str(fb.as_of),
    };
  }

  return null; // live gone AND no offline copy — the only "feed unavailable"
}

/**
 * The active Warning, for the board banner (W6) — or null.
 *
 * Exported for app.js, which draws the banner above the tile grid. It is a
 * plain fact about the current view and it opens nothing: the Helm is opened
 * for a reason and does not get to hijack it.
 */
export function activeWarning(tile, weather) {
  const view = resolve(tile, weather);
  if (!view) return null;
  const warn = view.alerts.find((a) => a.tier === 'warn');
  if (!warn) return null;
  const until = ctTime(warn.ends);
  return {
    id: str(warn.id),
    event: warn.event,
    ends: str(warn.ends),
    text: `⚠️ ${warn.event}${until ? ` · until ${until}` : ''}`,
    more: Math.max(0, view.alerts.length - 1),
  };
}

// ------------------------------------------------------------------ alerts

const TIER_TONE = { warn: 'bad', watch: 'warn', advisory: 'neutral' };

function alertLine(alert) {
  const until = ctTime(alert.ends);
  return `${alert.event}${until ? ` · until ${until}` : ''}`;
}

/** The face's alert row: red band / amber chip / grey line, plus a `+N`. */
function alertRow(view, open) {
  const first = view.alerts[0];
  if (!first) return null;

  const kids = [
    el('span', { cls: 'wx-alert-text', text: alertLine(first) }),
    view.alerts.length > 1 ? el('span', { cls: 'wx-alert-more', text: `+${view.alerts.length - 1}` }) : null,
  ];

  // A button only when there is a sheet to open — inert rather than broken
  // where there is not (the test harness, an older shell).
  if (!open) return el('div', { cls: `wx-alert wx-alert-${first.tier}` }, kids);
  return el(
    'button',
    {
      cls: `wx-alert wx-alert-${first.tier}`,
      attrs: { type: 'button' },
      on: {
        click: (e) => {
          e.stopPropagation();
          open();
        },
      },
    },
    kids
  );
}

/** One alert in full, for the sheet (W13). */
function alertDetail(alert) {
  const bits = [];
  if (alert.onset || alert.ends) {
    const from = ctTime(alert.onset);
    const to = ctTime(alert.ends);
    bits.push(`${from ? `from ${from}` : ''}${from && to ? ' ' : ''}${to ? `until ${to}` : ''}`.trim());
  }
  if (alert.areaDesc) bits.push(alert.areaDesc);

  return el('section', { cls: `wx-sheet-alert wx-alert-${alert.tier}` }, [
    el('div', { cls: 'wx-sheet-alert-head' }, [
      el('span', { cls: 'wx-sheet-alert-event', text: alert.event }),
      pill(alert.tier, TIER_TONE[alert.tier] || 'neutral'),
    ]),
    bits.length ? el('div', { cls: 'wx-sheet-alert-when', text: bits.join(' · ') }) : null,
    alert.headline ? el('p', { cls: 'wx-sheet-alert-headline', text: alert.headline }) : null,
    // pre-line, not markup: the NWS sends hard line breaks and a bare URL.
    alert.description ? el('p', { cls: 'wx-pre', text: alert.description }) : null,
    alert.instruction ? el('p', { cls: 'wx-pre wx-instruction', text: alert.instruction }) : null,
    alert.url ? extLink(alert.url, 'the NWS alert', 'wx-alert-link') : null,
  ]);
}

// ------------------------------------------------------------------- radar

/** Srcs this session has already asked for — see radarBox(). */
const radarRequested = new Set();

/**
 * Is this connection one we should not spend a megabyte on without asking?
 *
 * Rule 4's one-bar-of-LTE promise is not negotiable for a 1 MB GIF (W10).
 * Everything here is optional and behind a try: `navigator.connection` does
 * not exist on iOS at all, and its absence must read as "no reason to worry",
 * not as an error.
 */
function thrifty() {
  try {
    const nav = typeof navigator === 'undefined' ? null : navigator;
    const c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    if (!c) return false;
    if (c.saveData === true) return true;
    return /^(slow-2g|2g|3g)$/.test(str(c.effectiveType));
  } catch {
    return false;
  }
}

/**
 * The radar box (W10).
 *
 * `<img>` and nothing else — radar.weather.gov is not CORS-open, so JS could
 * not read these pixels if it wanted to, which is precisely why there is no
 * map library in this repo and never needs to be.
 *
 * Fixed aspect box so the layout does not jump when ~1 MB finally lands; the
 * image is requested only when the tile reaches the viewport; and a connection
 * that has told us it is metered gets a tap-to-load button and NO request at
 * all. `radarRequested` remembers what this session already pulled, so a
 * re-render inside the same cache bucket sets the src straight away rather
 * than waiting on the observer a second time.
 *
 * No timestamp is drawn beside it: the image carries its own in the pixels.
 */
function radarBox(radar, { full = false } = {}) {
  const r = obj(radar);
  const w = num(r.w) || 600;
  const h = num(r.h) || 550;
  const box = el('div', {
    cls: `wx-radar${full ? ' wx-radar-full' : ''}`,
    attrs: { style: `aspect-ratio: ${w} / ${h};` },
  });

  // The cache-buster steps on the RADAR's own cadence rather than every
  // minute: the product is ~4 minutes behind and only refreshes every few
  // minutes, so a per-minute bust would cost four times the data for none of
  // the information.
  const src = radarSrc(r.loop, Date.now(), num(r.behind_min) || 1);
  if (!src) {
    box.appendChild(el('div', { cls: 'wx-radar-ph', text: 'No radar in this payload.' }));
    return box;
  }

  const label = str(r.label) || str(r.site) || 'NWS';
  const img = el('img', {
    cls: 'wx-radar-img',
    attrs: {
      alt: `Weather radar loop — ${label}`,
      width: w,
      height: h,
      loading: 'lazy',
      decoding: 'async',
      // The homepage's URL never reaches the radar host.
      referrerpolicy: 'no-referrer',
    },
  });

  const ph = el('div', { cls: 'wx-radar-ph', text: `radar · ${label}` });

  const load = () => {
    radarRequested.add(src);
    img.addEventListener('load', () => ph.classList.add('wx-hide'));
    img.addEventListener('error', () => {
      ph.textContent = 'radar unavailable';
    });
    img.setAttribute('src', src);
  };

  if (thrifty() && !radarRequested.has(src)) {
    box.appendChild(
      el('button', {
        cls: 'wx-radar-tap',
        attrs: { type: 'button' },
        text: `Tap to load radar (~1 MB) · ${label}`,
        on: {
          click: (e) => {
            e.stopPropagation();
            const btn = e.currentTarget || e.target;
            if (btn && btn.classList) btn.classList.add('wx-hide');
            box.appendChild(ph);
            box.appendChild(img);
            load();
          },
        },
      })
    );
    return box;
  }

  box.appendChild(ph);
  box.appendChild(img);

  if (radarRequested.has(src) || typeof IntersectionObserver === 'undefined') {
    load();
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        load();
      },
      { rootMargin: '200px' }
    );
    io.observe(box);
  }

  return box;
}

// ---------------------------------------------------------------- the face

function nowBlock(view, data) {
  const now = obj(view.now);
  const meta = [];
  if (str(now.wind)) meta.push(str(now.wind));
  if (num(now.rh) !== null) meta.push(`${Math.round(num(now.rh))}%`);
  if (num(now.dew_f) !== null) meta.push(`dew ${deg(now.dew_f)}`);

  return el('div', { cls: 'wx-now' }, [
    el('span', { cls: 'wx-now-glyph', attrs: { 'aria-hidden': 'true' }, text: glyph(now.glyph_token, data.glyphs) }),
    el('span', { cls: 'wx-now-temp', text: deg(now.temp_f) }),
    el('div', { cls: 'wx-now-text' }, [
      el('div', { cls: 'wx-now-short', text: str(now.short) || '—' }),
      el('div', { cls: 'wx-now-meta' }, [
        meta.length ? el('span', { text: meta.join(' · ') }) : null,
        // W7: the line always says where it came from. A stale observation is
        // never presented as "now" without its stamp beside it.
        el('span', { cls: 'wx-now-src', text: sourceLabel(now, data.station) }),
      ]),
    ]),
  ]);
}

/** One row of the seven-day strip (W8). pop under 15% is not worth the ink. */
function dayRow(day, glyphs) {
  const d = obj(day);
  const pop = num(d.pop);
  return el('div', { cls: 'wx-day' }, [
    el('span', { cls: 'wx-day-label', text: str(d.label) || prettyDate(str(d.date)).split(' ')[0] }),
    el('span', { cls: 'wx-day-glyph', attrs: { 'aria-hidden': 'true' }, text: glyph(d.glyph_token, glyphs) }),
    el('span', { cls: 'wx-day-temp' }, [
      // A night-only first row carries NO high. Inventing one out of the low
      // would be the tile making something up (W8).
      el('span', { cls: 'wx-day-hi', text: deg(d.hi_f) }),
      el('span', { cls: 'wx-day-sep', text: '/' }),
      el('span', { cls: 'wx-day-lo', text: deg(d.lo_f) }),
    ]),
    el('span', { cls: 'wx-day-pop', text: pop !== null && pop >= 15 ? `${Math.round(pop)}%` : '' }),
  ]);
}

// --------------------------------------------------------------- the sheet

/** 'Today · Fri Sep 19' / 'Wed Sep 23' — never 'Wed · Wed Sep 23'. */
function sheetDayLabel(d) {
  const date = prettyDate(str(d.date));
  const label = str(d.label);
  return label && !date.startsWith(label) ? `${label} · ${date}` : date || label;
}

/** W13, in order: radar, the alerts in full, the seven days, sun, footer. */
function sheetBody(view, data) {
  return (body) => {
    body.appendChild(radarBox(data.radar, { full: true }));

    if (view.alerts.length) {
      body.appendChild(el('h3', { cls: 'wx-sheet-head', text: 'Active alerts' }));
      for (const a of view.alerts) body.appendChild(alertDetail(a));
    }

    body.appendChild(el('h3', { cls: 'wx-sheet-head', text: 'Seven days' }));
    if (!view.days.length) {
      body.appendChild(empty('No forecast in hand.'));
    } else {
      for (const raw of view.days) {
        const d = obj(raw);
        body.appendChild(
          el('section', { cls: 'wx-sheet-day' }, [
            el('div', { cls: 'wx-sheet-day-head' }, [
              el('span', { cls: 'wx-day-glyph', attrs: { 'aria-hidden': 'true' }, text: glyph(d.glyph_token, data.glyphs) }),
              // `date` is a Central calendar string: rendered from its parts.
              // The label is only worth printing when it says something the
              // date does not — "Today", "Tonight". A weekday label beside
              // its own date reads as "Wed · Wed Sep 23".
              el('span', { cls: 'wx-sheet-day-label', text: sheetDayLabel(d) }),
              el('span', { cls: 'wx-sheet-day-temp', text: `${deg(d.hi_f)}/${deg(d.lo_f)}` }),
            ]),
            d.short ? el('div', { cls: 'wx-sheet-day-short', text: str(d.short) }) : null,
            d.detail ? el('p', { cls: 'wx-pre wx-sheet-day-detail', text: str(d.detail) }) : null,
          ])
        );
      }
    }

    const sun = obj(data.sun);
    if (sun.sunrise_ct || sun.sunset_ct) {
      body.appendChild(
        el('div', { cls: 'wx-sun' }, [
          el('span', { text: `☀️ ${ctClock(str(sun.sunrise_ct)) || '—'}` }),
          el('span', { text: `🌒 ${ctClock(str(sun.sunset_ct)) || '—'}` }),
        ])
      );
    }

    // Deduped: on a payload whose radar site and reporting station share an
    // identifier, "KMCK · KMCK" is not a footer, it is a bug on screen.
    const foot = [...new Set([str(obj(data.radar).site), str(obj(data.station).id)].filter(Boolean))];
    const stamp = ctTime(view.as_of);
    if (stamp) foot.push(view.live ? `fetched ${stamp}` : `as of ${stamp}`);
    body.appendChild(el('p', { cls: 'tile-foot', text: foot.join(' · ') }));
  };
}

// ---------------------------------------------------------------- the tile

export function render(root, tile, ctx) {
  const data = obj(obj(tile).data);
  const view = resolve(tile, ctx?.weather);

  if (!view) {
    // Live gone AND no offline copy. The ONLY case that says this (W11).
    root.appendChild(empty('Feed unavailable — no live forecast and no offline copy.'));
    return;
  }

  const openPanel = typeof ctx?.actions?.openPanel === 'function' ? ctx.actions.openPanel : null;
  const title = `${str(data.title) || 'Weather'}${str(data.place) ? ` · ${str(data.place)}` : ''}`;
  const open = openPanel ? () => openPanel(title, sheetBody(view, data)) : null;

  const face = el('div', { cls: `wx${view.live ? '' : ' wx-fallback'}` });

  const row = alertRow(view, open);
  if (row) face.appendChild(row);

  if (view.now) face.appendChild(nowBlock(view, data));

  face.appendChild(radarBox(data.radar));

  if (view.days.length) {
    face.appendChild(el('div', { cls: 'wx-days' }, view.days.map((d) => dayRow(d, data.glyphs))));
  } else {
    face.appendChild(empty('No forecast in hand.'));
  }

  if (open) {
    face.appendChild(
      el('button', {
        cls: 'wx-more btn btn-small btn-ghost',
        attrs: { type: 'button' },
        text: 'Full forecast · radar · alerts',
        on: {
          click: (e) => {
            e.stopPropagation();
            open();
          },
        },
      })
    );
  }

  root.appendChild(face);

  // The footer says which copy is on screen, every time. A greyed tile with no
  // `as of` beside it is just a tile that looks broken (rule 8, W11).
  const stamp = ctTime(view.as_of);
  const bits = [];
  if (view.live) {
    if (stamp) bits.push(`fetched ${stamp}`);
  } else {
    bits.push(stamp ? `offline copy · as of ${stamp}` : 'offline copy');
  }
  if (str(data.place)) bits.push(str(data.place));
  root.appendChild(el('p', { cls: `tile-foot${view.live ? '' : ' warn-text'}`, text: bits.join(' · ') }));

  if (view.partial) {
    root.appendChild(el('p', { cls: 'tile-foot warn-text', text: 'part of the feed is unavailable — showing the last good values' }));
  }
}
