#!/usr/bin/env node
/**
 * The Helm — weather tile tests. Node 18+, zero deps, no browser.
 *
 *   node tools/test-weather.js
 *
 * Every case the Weather spec's Page section names, plus the two standing
 * guards that are cheap to assert and expensive to discover on a phone: no
 * innerHTML anywhere in the module (rule 10 — government text is still
 * untrusted content), and no `new Date()` on a 'YYYY-MM-DD' (rule 7).
 *
 * The NWS payloads below are REAL SHAPES with INVENTED CONTENT. The shapes
 * come from the 2026-09-19 verification log in the spec — the dual icon form,
 * the metric observation with an empty textDescription, `linescores`-style
 * absent keys — because those are precisely what the normalizers must survive.
 * Nothing here is a real forecast for a real place.
 */

const fs = require('node:fs');
const path = require('node:path');

const { El } = require('./dom-shim.js');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const textOf = (node) => node.textContent;
const countOf = (node, cls) => node.querySelectorAll('.' + cls).length;
const oneOf = (node, cls) => node.querySelector('.' + cls);

/** A fake detail sheet, so "did anything open?" is a thing a test can ask. */
function fakePanel() {
  const calls = [];
  return {
    calls,
    get last() {
      return calls[calls.length - 1] || null;
    },
    actions: {
      openPanel(title, build) {
        const body = new El('div');
        build(body);
        calls.push({ title, body });
      },
    },
  };
}

/** Run `fn` with a given navigator in place, and always put it back. */
function withNavigator(nav, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'navigator');
  const prev = global.navigator;
  // Node 18+ defines a read-only `navigator` on globalThis; redefine rather
  // than assign so the shim lands either way.
  Object.defineProperty(global, 'navigator', { value: nav, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(global, 'navigator', { value: prev, configurable: true, writable: true });
    else delete global.navigator;
  }
}

// ------------------------------------------------------------ NWS fixtures

const ICON = (d, token) => `https://api.weather.gov/icons/land/${d}/${token}?size=medium`;

/**
 * Forecast periods, day/night alternating, starting with whichever half the
 * caller asks for. `startFrom` is a real instant with an offset — which is the
 * one kind of date this codebase is allowed to parse (rule 7 / W12).
 */
function periods({ startISO, count, firstIsDay = true }) {
  const out = [];
  let t = Date.parse(startISO);
  for (let i = 0; i < count; i++) {
    const day = firstIsDay ? i % 2 === 0 : i % 2 === 1;
    out.push({
      number: i + 1,
      name: day ? 'Dayname' : 'Dayname Night',
      startTime: new Date(t).toISOString(),
      endTime: new Date(t + 12 * 3600 * 1000).toISOString(),
      isDaytime: day,
      temperature: day ? 70 + i : 50 + i,
      temperatureUnit: 'F',
      probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: day ? 20 + i : 40 + i },
      shortForecast: day ? 'Mostly Sunny' : 'Partly Cloudy',
      detailedForecast: day ? 'Invented daytime prose.' : 'Invented overnight prose.',
      icon: ICON(day ? 'day' : 'night', day ? 'sct' : 'bkn'),
    });
    t += 12 * 3600 * 1000;
  }
  return out;
}

const CFG = {
  warnEvents: ['Tornado Warning', 'Severe Thunderstorm Warning', 'Flood Warning'],
  mute: ['Special Marine Warning', 'Beach Hazards Statement'],
};

const alertFeature = (event, extra = {}) => ({
  '@id': `https://api.weather.gov/alerts/urn:oid:0.0.0.0.test.${event.replace(/\s+/g, '-')}`,
  properties: {
    id: `urn:oid:test:${event}`,
    event,
    severity: 'Severe',
    headline: `${event} issued by NWS Testville (invented)`,
    description: 'Line one.\nLine two.\n\nhttp://example.com/invented',
    instruction: 'Invented instruction.',
    areaDesc: 'Invented County, XX',
    onset: '2026-09-19T08:00:00-05:00',
    ends: '2026-09-19T19:00:00-05:00',
    ...extra,
  },
});

/** The weather tile payload the page meets. Invented place, invented grid. */
function cfgTile(overrides = {}) {
  return {
    band: 'LIVE',
    status: 'ok',
    updated_at: new Date().toISOString(),
    data: {
      title: 'Weather',
      place: 'Testville',
      grid: { office: 'TST', x: 1, y: 2, forecast: 'https://api.weather.gov/gridpoints/TST/1,2/forecast', hourly: 'https://api.weather.gov/gridpoints/TST/1,2/forecast/hourly' },
      alerts_url: 'https://api.weather.gov/alerts/active?point=40.0000,-90.0000',
      station: { id: 'KTST', name: 'Testville Field', obs: 'https://api.weather.gov/stations/KTST/observations/latest' },
      radar: { site: 'KTST', label: 'Testville (KTST)', loop: 'https://radar.weather.gov/ridge/standard/KTST_loop.gif', w: 600, h: 550, behind_min: 4 },
      sun: { date: '2026-09-19', sunrise_ct: '06:38', sunset_ct: '18:57' },
      glyphs: { sct: 'A', bkn: 'B', tsra: 'C', rain: 'D' },
      warn_events: CFG.warnEvents,
      mute: CFG.mute,
      clock: { normal_s: 300, warned_s: 60, forecast_s: 1800 },
      fallback: {
        as_of: '2026-09-19T13:18:03Z',
        now: { source: 'KTST', temp_f: 61, short: 'Invented Fallback Sky', glyph_token: 'rain', wind: '9 mph E', rh: 100, dew_f: 61, obs_time_ct: '7:45 AM' },
        days: [
          { date: '2026-09-19', label: 'Today', glyph_token: 'tsra', hi_f: 69, lo_f: 59, pop: 83, short: 'Invented', detail: 'Invented fallback prose.' },
          { date: '2026-09-20', label: 'Sun', glyph_token: 'sct', hi_f: 66, lo_f: 52, pop: 4, short: 'Invented', detail: 'Invented fallback prose.' },
        ],
        alerts: [],
      },
      ...overrides,
    },
  };
}

/** The shape live/band.js hands the tile. */
const liveState = (over = {}) => ({
  alerts: [],
  now: { source: 'KTST', temp_f: 58, short: 'Invented Live Sky', glyph_token: 'sct', wind: '5 mph N', rh: 71, dew_f: 49, obs_time_ct: '9:45 AM' },
  days: [{ date: '2026-09-19', label: 'Today', glyph_token: 'sct', hi_f: 72, lo_f: 55, pop: 20, short: 'Invented', detail: 'Invented live prose.' }],
  ok: true,
  partial: false,
  error: null,
  fetched_at: new Date().toISOString(),
  ...over,
});

// ------------------------------------------------------------------- tests

(async () => {
  console.log('The Helm — weather tile tests\n');

  const nws = await import('../docs/live/nws.js');
  const wx = await import('../docs/tiles/weather.js');
  const band = await import('../docs/live/band.js');

  // -- W9: glyph tokens ----------------------------------------------------
  console.log('glyph tokens (W9)');
  check('a plain token parses', nws.glyphToken(ICON('day', 'skc')) === 'skc');
  check('a token with a percentage drops it', nws.glyphToken(ICON('day', 'tsra,90')) === 'tsra');
  check(
    'the DUAL form reads the first half, not the night half',
    nws.glyphToken('https://api.weather.gov/icons/land/day/tsra,90/tsra,80?size=medium') === 'tsra'
  );
  check(
    'a dual form whose halves differ still reads the first',
    nws.glyphToken('https://api.weather.gov/icons/land/day/rain_showers,40/bkn?size=medium') === 'rain_showers'
  );
  check('a night icon parses', nws.glyphToken(ICON('night', 'bkn')) === 'bkn');
  check('a null icon is not a crash', nws.glyphToken(null) === '');
  check('an unrecognisable url yields no token', nws.glyphToken('https://example.com/nope.png') === '');
  check('a mapped token becomes its glyph', nws.glyph('tsra', { tsra: 'C' }) === 'C');
  check('an UNKNOWN token falls back to a dot, never to a guess', nws.glyph('fzra_sleet_2030', { tsra: 'C' }) === '•');
  check('no glyph map at all still renders a dot', nws.glyph('sct', null) === '•');

  // -- W8: the day/night fold ---------------------------------------------
  console.log('\nthe seven-day fold (W8)');
  {
    // 14 periods starting with a daytime one: the ordinary morning.
    const rows = nws.foldDays(periods({ startISO: '2026-09-19T06:00:00-05:00', count: 14, firstIsDay: true }), {
      today: '2026-09-19',
    });
    check('fourteen periods fold to SEVEN rows', rows.length === 7, `got ${rows.length}`);
    check('each row carries a high and a low', rows.every((r) => r.hi_f !== null && r.lo_f !== null));
    check('the first row is Today', rows[0].label === 'Today', rows[0].label);
    check('later rows wear a weekday, not a date', /^[A-Z][a-z]{2}$/.test(rows[1].label), rows[1].label);
    check('pop is the higher of the two halves', rows[0].pop === 41, String(rows[0].pop));
    check('the daytime half names the day', rows[0].short === 'Mostly Sunny');
    check('both halves of the prose survive into the detail', /daytime[\s\S]*overnight/.test(rows[0].detail));
  }
  {
    // After 6 PM the NWS has already dropped today's daytime period.
    const rows = nws.foldDays(periods({ startISO: '2026-09-19T18:00:00-05:00', count: 13, firstIsDay: false }), {
      today: '2026-09-19',
    });
    check('after 6 PM the first row is tonight alone', rows[0].lo_f !== null && rows[0].hi_f === null);
    check('and it is labelled Tonight, not Today', rows[0].label === 'Tonight', rows[0].label);
    check('no daytime high is invented for it', rows[0].hi_f === null);
    check('the rest of the week still folds in pairs', rows[1].hi_f !== null && rows[1].lo_f !== null);
  }
  check('no periods at all is an empty strip, not a throw', nws.foldDays(null).length === 0);
  check('a period with no startTime is skipped rather than dated 1970', nws.foldDays([{ temperature: 70 }]).length === 0);

  // -- W6: tiers -----------------------------------------------------------
  console.log('\nalert tiers (W6)');
  check('an event in warn_events is a Warning', nws.alertTier('Tornado Warning', CFG.warnEvents) === 'warn');
  check('matching ignores case', nws.alertTier('tornado warning', CFG.warnEvents) === 'warn');
  check('a Watch is amber', nws.alertTier('Flood Watch', CFG.warnEvents) === 'watch');
  check('an Advisory is grey', nws.alertTier('Dense Fog Advisory', CFG.warnEvents) === 'advisory');
  check('a Statement is grey', nws.alertTier('Special Weather Statement', CFG.warnEvents) === 'advisory');
  check(
    'a Warning the VAULT did not list is not promoted to red',
    nws.alertTier('Dense Fog Warning', CFG.warnEvents) === 'advisory'
  );
  {
    const out = nws.normalizeAlerts(
      {
        features: [
          alertFeature('Dense Fog Advisory'),
          alertFeature('Special Marine Warning'),
          alertFeature('Tornado Warning'),
          alertFeature('Flood Watch'),
          alertFeature('Beach Hazards Statement'),
        ],
      },
      CFG
    );
    check('muted events are dropped entirely', out.every((a) => !/Marine|Beach/.test(a.event)), out.map((a) => a.event).join());
    check('three survive the mute list', out.length === 3, String(out.length));
    check('the loudest sorts first', out[0].tier === 'warn' && out[1].tier === 'watch' && out[2].tier === 'advisory',
      out.map((a) => a.tier).join());
    check('the NWS prose is carried through untouched', out[0].description.includes('\n'));
    check('a non-http alert url is refused rather than rendered', nws.normalizeAlerts(
      { features: [alertFeature('Flood Watch', { id: 'javascript:alert(1)' })] }, CFG
    )[0].url.startsWith('https://'));
    check('`ends` falls back to `expires` when the NWS sends none', nws.normalizeAlerts(
      { features: [alertFeature('Flood Watch', { ends: null, expires: '2026-09-19T22:00:00-05:00' })] }, CFG
    )[0].ends === '2026-09-19T22:00:00-05:00');
  }
  check('an empty document is an empty list', nws.normalizeAlerts({}, CFG).length === 0);
  check('junk in place of a document does not throw', nws.normalizeAlerts('nope', CFG).length === 0);

  // -- W7: the now-line ----------------------------------------------------
  console.log('\nthe now-line and its source label (W7)');
  const NOW = Date.parse('2026-09-19T14:00:00Z');
  const obs = (over = {}) => ({
    properties: {
      timestamp: new Date(NOW - 15 * 60000).toISOString(),
      textDescription: 'Light Rain and Fog/Mist',
      icon: ICON('day', 'rain'),
      temperature: { value: 16, unitCode: 'wmoUnit:degC' },
      windSpeed: { value: 14.4, unitCode: 'wmoUnit:km_h-1' },
      windDirection: { value: 90, unitCode: 'wmoUnit:degree_(angle)' },
      relativeHumidity: { value: 100, unitCode: 'wmoUnit:percent' },
      dewpoint: { value: 16, unitCode: 'wmoUnit:degC' },
      ...over,
    },
  });
  const hourly = [
    {
      startTime: new Date(NOW - 20 * 60000).toISOString(),
      endTime: new Date(NOW + 40 * 60000).toISOString(),
      temperature: 62,
      temperatureUnit: 'F',
      shortForecast: 'Showers And Thunderstorms',
      icon: ICON('day', 'tsra,80'),
      windSpeed: '10 mph',
      windDirection: 'SE',
      relativeHumidity: { value: 93 },
      dewpoint: { value: 16, unitCode: 'wmoUnit:degC' },
    },
  ];

  {
    const line = nws.nowLine(obs(), nws.hourlyNow(hourly, NOW), NOW);
    check('a fresh, talkative observation wins', line.source === 'obs');
    check('and it is converted out of metric', line.temp_f === 61, String(line.temp_f));
    check('wind comes out in mph with a compass point', line.wind === '9 mph E', line.wind);
    check('the dewpoint converts too', line.dew_f === 61, String(line.dew_f));
    check('the label names the station and the time', nws.sourceLabel(line, { id: 'KTST' }) === 'KTST · 8:45 AM',
      nws.sourceLabel(line, { id: 'KTST' }));
  }
  {
    // The exact failure the spec caught live: 200, but an hour old.
    const stale = obs({ timestamp: new Date(NOW - 80 * 60000).toISOString() });
    const line = nws.nowLine(stale, nws.hourlyNow(hourly, NOW), NOW);
    check('an observation older than 75 minutes is NOT "now"', line.source === 'forecast');
    check('the hourly period takes over', line.temp_f === 62, String(line.temp_f));
    check('and the label RELABELS to say so', nws.sourceLabel(line, { id: 'KTST' }) === 'forecast');
  }
  {
    const mute = obs({ textDescription: '' });
    const line = nws.nowLine(mute, nws.hourlyNow(hourly, NOW), NOW);
    check('an observation with an empty textDescription falls back too', line.source === 'forecast');
    check('the forecast line carries the hourly wind verbatim', line.wind === '10 mph SE', line.wind);
  }
  {
    const line = nws.nowLine(null, nws.hourlyNow(hourly, NOW), NOW);
    check('no observation at all still produces a now-line', line && line.source === 'forecast');
    check('nothing at all produces null rather than a fake line', nws.nowLine(null, null, NOW) === null);
  }
  {
    const later = [
      { startTime: new Date(NOW + 3600000).toISOString(), endTime: new Date(NOW + 7200000).toISOString(), temperature: 99 },
      { startTime: new Date(NOW - 600000).toISOString(), endTime: new Date(NOW + 600000).toISOString(), temperature: 55 },
    ];
    check(
      'the hourly period is chosen by its WINDOW, never by being periods[0]',
      nws.hourlyNow(later, NOW).temperature === 55
    );
    check('no period covers now -> null, not the nearest guess', nws.hourlyNow(later, NOW + 99 * 3600000) === null);
  }

  // -- W10: the radar cache-buster ----------------------------------------
  console.log('\nthe radar url (W10)');
  const LOOP = 'https://radar.weather.gov/ridge/standard/KTST_loop.gif';
  {
    const a = nws.radarSrc(LOOP, 60000 * 1000);
    const b = nws.radarSrc(LOOP, 60000 * 1000 + 30000);
    const c = nws.radarSrc(LOOP, 60000 * 1001);
    check('the cache-buster is stable inside one minute', a === b, `${a} vs ${b}`);
    check('and changes with the minute', a !== c);
    check('it is a query parameter on the real url', a.startsWith(LOOP + '?t='));
    check(
      'a wider step holds for that many minutes',
      nws.radarSrc(LOOP, 60000 * 1000, 4) === nws.radarSrc(LOOP, 60000 * 1003, 4) &&
        nws.radarSrc(LOOP, 60000 * 1000, 4) !== nws.radarSrc(LOOP, 60000 * 1004, 4)
    );
    check('a non-http loop is refused, not rendered', nws.radarSrc('javascript:alert(1)') === '');
    check('a missing loop is refused', nws.radarSrc(null) === '');
  }

  // -- W5: the clock -------------------------------------------------------
  console.log('\nthe alert clock (W5)');
  {
    const clock = { normal_s: 300, warned_s: 60, forecast_s: 1800 };
    const warned = [{ tier: 'warn' }];
    const watched = [{ tier: 'watch' }, { tier: 'advisory' }];
    check('no alerts -> the normal clock', band.weatherDelay([], clock) === 300000);
    check('a Watch does NOT speed the clock up', band.weatherDelay(watched, clock) === 300000);
    check('a Warning drops it to 60 seconds', band.weatherDelay(warned, clock) === 60000);
    check('and it restores when the warning drops out of the feed', band.weatherDelay([], clock) === 300000);
    check('a payload with no clock uses the defaults', band.weatherDelay([]) === band.WX_NORMAL_MS);
    check('an absurd interval is floored to the default, not honoured', band.weatherDelay([], { normal_s: 1 }) === band.WX_NORMAL_MS);
  }

  // -- the band ------------------------------------------------------------
  console.log('\nthe weather band');
  {
    const snap = { schema: 1, tiles: { weather: cfgTile() } };
    const calls = [];
    const deps = {
      fetchAlerts: async (url) => { calls.push('alerts'); return nws.normalizeAlerts({ features: [alertFeature('Tornado Warning')] }, CFG); },
      fetchForecast: async () => { calls.push('forecast'); return nws.foldDays(periods({ startISO: '2026-09-19T06:00:00-05:00', count: 14 }), { today: '2026-09-19' }); },
      fetchHourly: async () => { calls.push('hourly'); return hourly; },
      fetchObservation: async () => { calls.push('obs'); return obs(); },
      now: () => NOW,
    };
    let last = null;
    const b = band.createWeatherBand((s) => { last = s; }, deps);
    const delay = await b.runOnce(snap);
    check('one cycle fetches all four documents', calls.sort().join() === 'alerts,forecast,hourly,obs', calls.join());
    check('it hands the tile live values', last.ok === true && last.days.length === 7 && last.now.source === 'obs');
    check('a Warning in hand sets the 60-second clock', delay === 60000, String(delay));

    calls.length = 0;
    await b.runOnce(snap);
    check('the forecast is NOT refetched on the next alert tick', !calls.includes('forecast') && !calls.includes('hourly'));
    check('alerts and the observation are', calls.sort().join() === 'alerts,obs', calls.join());
  }
  {
    // Every endpoint down. Nothing empties; the tile is told to fall back.
    const snap = { schema: 1, tiles: { weather: cfgTile() } };
    const dead = async () => { throw new Error('network down'); };
    let last = null;
    const b = band.createWeatherBand((s) => { last = s; }, {
      fetchAlerts: dead, fetchForecast: dead, fetchHourly: dead, fetchObservation: dead, now: () => NOW,
    });
    await b.runOnce(snap);
    check('every endpoint down raises the flag', last.error === 'feed unavailable');
    check('and leaves the band with nothing live to show', last.ok === false);
  }
  {
    // Alerts land, the rest do not. The good value must survive.
    const snap = { schema: 1, tiles: { weather: cfgTile() } };
    const dead = async () => { throw new Error('network down'); };
    let last = null;
    const b = band.createWeatherBand((s) => { last = s; }, {
      fetchAlerts: async () => nws.normalizeAlerts({ features: [alertFeature('Flood Watch')] }, CFG),
      fetchForecast: dead, fetchHourly: dead, fetchObservation: dead, now: () => NOW,
    });
    await b.runOnce(snap);
    check('a partial failure keeps what DID land', last.ok === true && last.alerts.length === 1);
    check('and says so rather than claiming the feed is fine', last.partial === true && last.error === null);
  }
  {
    const b = band.createWeatherBand(() => { throw new Error('should not be called'); }, {});
    check('a snapshot with no weather tile fetches nothing', (await b.runOnce({ schema: 1, tiles: {} })) === band.WX_NORMAL_MS);
  }
  check('weatherConfig refuses an array payload', band.weatherConfig({ tiles: { weather: { data: [1, 2] } } }) === null);

  // -- the face ------------------------------------------------------------
  console.log('\nthe face — live, fallback, and gone (W11)');
  {
    const root = new El('div');
    const panel = fakePanel();
    wx.render(root, cfgTile(), { id: 'weather', actions: panel.actions, weather: liveState() });
    check('live values are on the face', /Invented Live Sky/.test(textOf(root)));
    check('the fallback copy is NOT', !/Invented Fallback Sky/.test(textOf(root)));
    check('nothing is greyed', countOf(root, 'wx-fallback') === 0);
    check('the footer says when it was fetched', /fetched/.test(textOf(root)));
    check('rendering opens no sheet', panel.calls.length === 0);
  }
  {
    // The band has nothing: the engine's offline copy, greyed, with its as_of.
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: { ok: false, error: 'feed unavailable' } });
    check('a dead feed renders the ENGINE fallback', /Invented Fallback Sky/.test(textOf(root)));
    check('greyed', countOf(root, 'wx-fallback') === 1);
    check('with its own as_of beside it', /as of/.test(textOf(root)));
    check('and it does NOT say "feed unavailable"', !/feed unavailable/i.test(textOf(root)));
  }
  {
    // No band at all — the first paint, before the first tick.
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {} });
    check('no band yet still renders the fallback rather than nothing', /Invented Fallback Sky/.test(textOf(root)));
  }
  {
    // Both gone. The ONLY case allowed to say it.
    const root = new El('div');
    wx.render(root, cfgTile({ fallback: null }), { id: 'weather', actions: {}, weather: { ok: false } });
    check('live gone AND no offline copy says "feed unavailable"', /feed unavailable/i.test(textOf(root)));
    check('and draws no radar box it cannot fill', countOf(root, 'wx-radar') === 0);
  }
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState({ partial: true }) });
    check('a partial feed says which half is missing', /part of the feed is unavailable/.test(textOf(root)));
  }

  console.log('\nthe face — the alert row (W6)');
  {
    const warnState = liveState({ alerts: nws.normalizeAlerts({ features: [alertFeature('Tornado Warning'), alertFeature('Dense Fog Advisory')] }, CFG) });
    const root = new El('div');
    const panel = fakePanel();
    wx.render(root, cfgTile(), { id: 'weather', actions: panel.actions, weather: warnState });
    check('a Warning paints the red row', countOf(root, 'wx-alert-warn') === 1);
    check('and the row says the event and its until', /Tornado Warning/.test(textOf(root)) && /until/.test(textOf(root)));
    check('the quieter alert collects in a +N chip', oneOf(root, 'wx-alert-more').textContent === '+1');
    check('rendering it opens NOTHING', panel.calls.length === 0);
    oneOf(root, 'wx-alert').listeners.click[0]({ stopPropagation() {} });
    check('tapping it opens the sheet', panel.calls.length === 1);
    check('and the sheet carries the alert in full', /Invented instruction/.test(textOf(panel.last.body)));
  }
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState({ alerts: nws.normalizeAlerts({ features: [alertFeature('Flood Watch')] }, CFG) }) });
    check('a Watch is amber, inside the tile', countOf(root, 'wx-alert-watch') === 1 && countOf(root, 'wx-alert-warn') === 0);
  }
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState({ alerts: nws.normalizeAlerts({ features: [alertFeature('Dense Fog Advisory')] }, CFG) }) });
    check('an Advisory is the grey line', countOf(root, 'wx-alert-advisory') === 1);
  }
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState() });
    check('no alert means no alert row at all', countOf(root, 'wx-alert') === 0);
  }

  // -- the board banner ----------------------------------------------------
  console.log('\nthe board banner (W6) — warn only, and it opens nothing');
  {
    const warn = nws.normalizeAlerts({ features: [alertFeature('Tornado Warning'), alertFeature('Flood Watch')] }, CFG);
    const got = wx.activeWarning(cfgTile(), liveState({ alerts: warn }));
    check('a Warning produces a banner', !!got);
    check('it names the event and its until', /Tornado Warning/.test(got.text) && /until/.test(got.text));
    check('it counts the rest', got.more === 1);
    check('it carries an id, so a NEW warning outlives a dismissal', !!got.id);
    check('a Watch alone produces NO banner', wx.activeWarning(cfgTile(), liveState({ alerts: nws.normalizeAlerts({ features: [alertFeature('Flood Watch')] }, CFG) })) === null);
    check('an Advisory alone produces no banner', wx.activeWarning(cfgTile(), liveState({ alerts: nws.normalizeAlerts({ features: [alertFeature('Dense Fog Advisory')] }, CFG) })) === null);
    check('no alerts, no banner', wx.activeWarning(cfgTile(), liveState()) === null);
    check('no tile at all is not a crash', wx.activeWarning(null, null) === null);
  }
  {
    // The banner reads the SAME view the face does — including the offline copy.
    const tile = cfgTile();
    tile.data.fallback.alerts = [{ event: 'Tornado Warning', tier: 'warn', ends: '2026-09-19T19:00:00-05:00' }];
    check('a Warning in the offline copy still paints the banner', !!wx.activeWarning(tile, { ok: false }));
  }
  {
    // A muted event must not reach the banner even if the engine left it in.
    const tile = cfgTile();
    tile.data.fallback.alerts = [{ event: 'Special Marine Warning', tier: 'warn', ends: null }];
    check('a muted event never reaches the banner', wx.activeWarning(tile, { ok: false }) === null);
  }
  {
    // A payload that forgot to tier its alert is tiered here, not defaulted grey.
    const tile = cfgTile();
    tile.data.fallback.alerts = [{ event: 'Flood Warning', ends: null }];
    check('an untiered Warning is still classified as one', wx.activeWarning(tile, { ok: false }).event === 'Flood Warning');
  }
  check(
    'app.js renders the banner from the MODULE export, never a static import',
    !/from '\.\/tiles\/weather\.js'/.test(read('docs', 'app.js')) && /activeWarning/.test(read('docs', 'app.js'))
  );
  check('the dismissal is never persisted', !/localStorage[\s\S]{0,200}banner/i.test(read('docs', 'app.js')));

  // -- the seven-day strip on the face -------------------------------------
  console.log('\nthe strip and the now-line on the face');
  {
    const root = new El('div');
    wx.render(root, cfgTile(), {
      id: 'weather',
      actions: {},
      weather: liveState({
        days: [
          { date: '2026-09-19', label: 'Tonight', glyph_token: 'sct', hi_f: null, lo_f: 55, pop: 60, short: 'x', detail: 'y' },
          { date: '2026-09-20', label: 'Sun', glyph_token: 'bkn', hi_f: 66, lo_f: 52, pop: 9, short: 'x', detail: 'y' },
        ],
      }),
    });
    const rows = root.querySelectorAll('.wx-day');
    check('one row per day', rows.length === 2);
    const his = root.querySelectorAll('.wx-day-hi').map((n) => n.textContent);
    check('a tonight-only row prints no high', his[0] === '—', his[0]);
    check('an ordinary row prints both', his[1] === '66°' && root.querySelectorAll('.wx-day-lo')[1].textContent === '52°');
    const pops = root.querySelectorAll('.wx-day-pop').map((n) => n.textContent);
    check('a pop at or above 15% is printed', pops[0] === '60%', pops[0]);
    check('a pop under 15% is not worth the ink', pops[1] === '', `"${pops[1]}"`);

    // W9's unknown-token path, on the face: a dot, and the shortForecast in
    // the sheet carrying the meaning the glyph map could not.
    const unknownPanel = fakePanel();
    const unknown = new El('div');
    wx.render(unknown, cfgTile(), {
      id: 'weather',
      actions: unknownPanel.actions,
      weather: liveState({ days: [{ date: '2026-09-19', label: 'Today', glyph_token: 'fzra_sleet_2030', hi_f: 60, lo_f: 40, pop: 0, short: 'Invented Unknown Sky', detail: 'y' }] }),
    });
    check('an unknown glyph token renders the dot on the face', oneOf(unknown, 'wx-day-glyph').textContent === '•');
    oneOf(unknown, 'wx-more').listeners.click[0]({ stopPropagation() {} });
    check('and the shortForecast carries the meaning instead', /Invented Unknown Sky/.test(textOf(unknownPanel.last.body)));
  }
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState() });
    check('the now-line always says where it came from', /KTST · 9:45 AM/.test(textOf(oneOf(root, 'wx-now'))));
    check('and carries wind, humidity and dewpoint when it has them', /5 mph N/.test(textOf(root)) && /71%/.test(textOf(root)) && /dew 49/.test(textOf(root)));
  }
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState({ now: { source: 'forecast', temp_f: null, short: 'x', wind: '', rh: null, dew_f: null } }) });
    check('a missing temperature reads as unknown, never as zero', /—/.test(textOf(oneOf(root, 'wx-now-temp'))));
    check('and the label says forecast', /forecast/.test(textOf(oneOf(root, 'wx-now'))));
  }

  // -- the radar box -------------------------------------------------------
  console.log('\nthe radar box (W10)');
  {
    const root = new El('div');
    wx.render(root, cfgTile(), { id: 'weather', actions: {}, weather: liveState() });
    const img = oneOf(root, 'wx-radar-img');
    check('the face carries a radar image', !!img);
    check('it is an <img>, never a fetch', img.tagName === 'IMG');
    check('with no referrer', img.getAttribute('referrerpolicy') === 'no-referrer');
    check('and lazy loading', img.getAttribute('loading') === 'lazy');
    check('its src is the RIDGE loop with a cache-buster', /radar\.weather\.gov[\s\S]*\?t=\d+/.test(img.getAttribute('src')));
    check('the box reserves the payload\'s own aspect ratio', /aspect-ratio: 600 \/ 550/.test(oneOf(root, 'wx-radar').getAttribute('style')));
    check('no second timestamp is drawn beside it', !/\bUTC\b|\bZ\b\s*$/.test(textOf(oneOf(root, 'wx-radar'))));
  }
  {
    // Save-Data. A different loop url, so this session has not already pulled it.
    const tile = cfgTile();
    tile.data.radar = { ...tile.data.radar, loop: 'https://radar.weather.gov/ridge/standard/KSAVE_loop.gif' };
    const root = withNavigator({ connection: { saveData: true } }, () => {
      const r = new El('div');
      wx.render(r, tile, { id: 'weather', actions: {}, weather: liveState() });
      return r;
    });
    check('Save-Data renders a tap-to-load placeholder', countOf(root, 'wx-radar-tap') === 1);
    check('and issues NO image request', countOf(root, 'wx-radar-img') === 0);
    check('the button says what it will cost', /1 MB/.test(textOf(root)));
  }
  {
    const tile = cfgTile();
    tile.data.radar = { ...tile.data.radar, loop: 'https://radar.weather.gov/ridge/standard/K3G_loop.gif' };
    const root = withNavigator({ connection: { effectiveType: '3g' } }, () => {
      const r = new El('div');
      wx.render(r, tile, { id: 'weather', actions: {}, weather: liveState() });
      return r;
    });
    check('3G gets the same treatment', countOf(root, 'wx-radar-tap') === 1 && countOf(root, 'wx-radar-img') === 0);
  }
  {
    const tile = cfgTile();
    tile.data.radar = { ...tile.data.radar, loop: 'https://radar.weather.gov/ridge/standard/K4G_loop.gif' };
    const root = withNavigator({ connection: { effectiveType: '4g' } }, () => {
      const r = new El('div');
      wx.render(r, tile, { id: 'weather', actions: {}, weather: liveState() });
      return r;
    });
    check('4G loads it without asking', !!oneOf(root, 'wx-radar-img').getAttribute('src'));
  }
  {
    const tile = cfgTile();
    tile.data.radar = { site: 'KTST', loop: 'javascript:alert(1)' };
    const root = new El('div');
    wx.render(root, tile, { id: 'weather', actions: {}, weather: liveState() });
    check('a non-http loop renders a placeholder, not a link', countOf(root, 'wx-radar-img') === 0 && countOf(root, 'wx-radar-ph') === 1);
  }

  // -- the sheet -----------------------------------------------------------
  console.log('\nthe sheet (W13)');
  {
    const panel = fakePanel();
    const root = new El('div');
    wx.render(root, cfgTile(), {
      id: 'weather',
      actions: panel.actions,
      weather: liveState({ alerts: nws.normalizeAlerts({ features: [alertFeature('Tornado Warning')] }, CFG) }),
    });
    oneOf(root, 'wx-more').listeners.click[0]({ stopPropagation() {} });
    check('the sheet is titled with the place', panel.last.title === 'Weather · Testville', panel.last.title);
    const body = panel.last.body;
    check('the radar leads it, full width', countOf(body, 'wx-radar-full') === 1);
    check('then the alert in full', /Line one/.test(textOf(body)) && /Invented instruction/.test(textOf(body)));
    check('then the seven days with their detail', /Invented live prose/.test(textOf(body)));
    check('then sunrise and sunset', /6:38 AM/.test(textOf(body)) && /6:57 PM/.test(textOf(body)));
    check('the footer names both stations and the fetch', /KTST/.test(textOf(body)) && /fetched/.test(textOf(body)));
    check('a shared radar/station id is printed once, not twice', !/KTST \u00b7 KTST/.test(textOf(body)));
    const dayLabels = body.querySelectorAll('.wx-sheet-day-label').map((n) => n.textContent);
    check('a day whose label repeats its own weekday prints it once', !dayLabels.some((l) => /^(\w{3}) \u00b7 \1 /.test(l)), dayLabels.join(' | '));
    check('but Today keeps its name beside the date', /^Today \u00b7 /.test(dayLabels[0]), dayLabels[0]);
    const link = body.querySelector('.wx-alert-link');
    check('the alert links out, in a new tab, safely', link.tagName === 'A' && link.getAttribute('rel').includes('noopener') && link.getAttribute('target') === '_blank');
  }

  // -- standing guards -----------------------------------------------------
  console.log('\nstanding guards (rules 7 and 10)');
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const WX_SRC = strip(read('docs', 'tiles', 'weather.js'));
  const NWS_SRC = strip(read('docs', 'live', 'nws.js'));

  check('the tile module contains no innerHTML', !/innerHTML/.test(WX_SRC));
  check('nor does the fetch module', !/innerHTML/.test(NWS_SRC));
  check('the tile never builds markup from a string', !/insertAdjacentHTML|outerHTML|document\.write/.test(WX_SRC));
  check('the tile never parses a bare YYYY-MM-DD', !/new Date\(\s*[a-zA-Z_$][\w.$]*\.date\b/.test(WX_SRC));
  check('the tile names no api.weather.gov url — that is the band\'s job', !/api\.weather\.gov/.test(WX_SRC));
  check('the tile module does not fetch at all', !/\bfetch\s*\(/.test(WX_SRC));
  check('the tile holds no state between renders but the radar set', (WX_SRC.match(/^const \w+ = new Set\(\)/gm) || []).length <= 1);
  check('nothing here uses localStorage', !/localStorage/.test(WX_SRC) && !/localStorage/.test(NWS_SRC));
  check('the fetch module sends no custom header', !/headers\s*:/.test(NWS_SRC));
  check('and asks for no credentials', /credentials: 'omit'/.test(NWS_SRC));
  check('the service worker never caches weather.gov', /weather\.gov/.test(read('docs', 'sw.js')) && /hostname\.endsWith\('weather\.gov'\)/.test(read('docs', 'sw.js')));

  // -- the registry and the retirement -------------------------------------
  console.log('\nthe registry (W1)');
  const REG = read('docs', 'tiles', '_registry.js');
  check('weather is registered at position 14, LIVE', /weather:\s*\{\s*band:\s*'LIVE',\s*position:\s*14/.test(REG));
  check('radar is retired from the registry', !/\bradar:/.test(REG));
  check('and its module is gone from the tree', !fs.existsSync(path.join(__dirname, '..', 'docs', 'tiles', 'radar.js')));
  check('the service worker no longer precaches it', !/tiles\/radar\.js/.test(read('docs', 'sw.js')));
  check('the service worker precaches the new modules', /tiles\/weather\.js/.test(read('docs', 'sw.js')) && /live\/nws\.js/.test(read('docs', 'sw.js')));
  // This tile shipped in 1.9.0, so the page must be AT LEAST that — the check
  // is here to catch a deploy that forgot the version, not to freeze it. A
  // literal was tripping every later bump and teaching whoever hit it to edit
  // the test rather than read it. The version's own shape, and the rule that
  // nobody hardcodes it, are tools/test-shell.js's business.
  const APP_VERSION = (read('docs', 'config.js').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  const rank = (v) => String(v).split('.').map(Number).reduce((a, n) => a * 1000 + (n || 0), 0);
  check(`APP_VERSION is at least 1.9.0 (${APP_VERSION})`, !!APP_VERSION && rank(APP_VERSION) >= rank('1.9.0'), APP_VERSION);

  // -- the mock ------------------------------------------------------------
  console.log('\nthe mock (no external fetch on the mock path)');
  {
    const mock = JSON.parse(read('docs', 'mock', 'helm-data.json'));
    const data = mock.tiles.weather.data;
    check('the default mock carries a weather tile', !!data);
    check('and no radar tile survives in it', !mock.tiles.radar);
    check('its radar loop is a LOCAL asset', data.radar.loop.startsWith('./mock/'));
    check('never the live NWS url', !/radar\.weather\.gov/.test(JSON.stringify(mock)));
    check('the placeholder asset exists', fs.existsSync(path.join(__dirname, '..', 'docs', 'mock', 'radar-placeholder.svg')));
    check('the default fixture shows the Watch', data.fallback.alerts[0].tier === 'watch');
    check('the warn fixture shows a Warning', JSON.parse(read('docs', 'mock', 'weather-warn.json')).tiles.weather.data.fallback.alerts[0].tier === 'warn');
    check('the clear fixture shows nothing', JSON.parse(read('docs', 'mock', 'weather-clear.json')).tiles.weather.data.fallback.alerts.length === 0);
    check('the down fixture has no offline copy at all', JSON.parse(read('docs', 'mock', 'weather-down.json')).tiles.weather.data.fallback === null);
    check('app.js hands the mock path a refusing NWS client', /mockNws/.test(read('docs', 'app.js')));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('\ntest run crashed:', e && e.stack);
  process.exit(1);
});
