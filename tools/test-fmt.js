#!/usr/bin/env node
/**
 * The Helm — date/format unit tests. Node, zero deps.
 *
 *   node tools/test-fmt.js
 *
 * Rule 7 is the disqualifying bug: a date-only business string must never be
 * shifted by a timezone. These tests run under TZ=America/Chicago and under
 * TZ=Asia/Tokyo (where a naive `new Date("2026-09-17")` misrenders in the
 * opposite direction), and the answers must be identical in both.
 */

const { execFileSync } = require('node:child_process');

if (!process.env.HELM_TZ_CHILD) {
  // Re-run this file once per timezone, then compare the transcripts.
  const zones = ['America/Chicago', 'Asia/Tokyo', 'UTC', 'Pacific/Kiritimati'];
  const outputs = zones.map((tz) =>
    execFileSync(process.execPath, [__filename], {
      env: { ...process.env, TZ: tz, HELM_TZ_CHILD: '1' },
    }).toString()
  );
  console.log(outputs[0]);
  let ok = true;
  for (let i = 1; i < zones.length; i++) {
    const same = outputs[i] === outputs[0];
    console.log(`  ${same ? 'ok  ' : 'FAIL'} identical output under TZ=${zones[i]}`);
    if (!same) {
      ok = false;
      console.log('--- expected ---\n' + outputs[0] + '--- got ---\n' + outputs[i]);
    }
  }
  console.log(ok ? '\nall timezones agree' : '\nTIMEZONE DRIFT — rule 7 violated');
  process.exit(ok && !outputs[0].includes('FAIL') ? 0 : 1);
}

(async () => {
  const fmt = await import('../docs/lib/fmt.js');
  let pass = 0;
  let fail = 0;
  const eq = (name, got, want) => {
    if (got === want) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  };

  console.log('date-only strings never shift');
  // 2026-09-17 is a Thursday. A naive new Date("2026-09-17") in Chicago gives
  // Wed Sep 16; in Tokyo it gives Thu Sep 17 09:00. Both must be Thu Sep 17.
  eq('prettyDate mid-month', fmt.prettyDate('2026-09-17'), 'Thu Sep 17');
  eq('prettyDate first of month', fmt.prettyDate('2026-09-01'), 'Tue Sep 1');
  eq('prettyDate new year', fmt.prettyDate('2027-01-01'), 'Fri Jan 1');
  eq('prettyDate leap day', fmt.prettyDate('2028-02-29'), 'Tue Feb 29');
  eq('prettyDate day after leap day', fmt.prettyDate('2028-03-01'), 'Wed Mar 1');
  eq('prettyDate passes junk through verbatim', fmt.prettyDate('sometime soon'), 'sometime soon');
  eq('prettyDate passes null through as empty', fmt.prettyDate(null), '');

  console.log('\ncalendar arithmetic');
  eq('addDays across a month', fmt.addDays('2026-09-30', 1), '2026-10-01');
  eq('addDays across a year', fmt.addDays('2026-12-31', 1), '2027-01-01');
  eq('addDays backwards', fmt.addDays('2026-01-01', -1), '2025-12-31');
  // DST: US spring-forward 2027 is Mar 14. Adding a day across it must still
  // advance exactly one calendar day, not 23 or 25 hours' worth.
  eq('addDays across spring-forward', fmt.addDays('2027-03-13', 1), '2027-03-14');
  eq('addDays across spring-forward +2', fmt.addDays('2027-03-13', 2), '2027-03-15');
  eq('addDays across fall-back', fmt.addDays('2027-11-06', 1), '2027-11-07');
  eq('daysBetween simple', fmt.daysBetween('2026-09-17', '2026-09-20'), 3);
  eq('daysBetween across DST', fmt.daysBetween('2027-03-13', '2027-03-15'), 2);
  eq('daysBetween negative', fmt.daysBetween('2026-09-20', '2026-09-17'), -3);
  eq('daysBetween same day', fmt.daysBetween('2026-09-17', '2026-09-17'), 0);
  eq('daysBetween rejects junk', fmt.daysBetween('2026-09-17', 'nope'), null);

  console.log('\nan instant, brought down to its Central day');
  // The bridge the entertainment tile's "new" counts stand on: a lastOpened
  // instant against a date-only air_date. Getting this wrong by a day is the
  // same class of bug as rule 7 itself, so it is pinned in every timezone.
  eq('ctDate mid-afternoon Central', fmt.ctDate('2026-09-17T20:30:00Z'), '2026-09-17');
  // 03:00Z is 22:00 the previous evening in Central — the day BEFORE, and the
  // answer must not follow the machine's own clock into tomorrow.
  eq('ctDate after UTC midnight is still yesterday in Central', fmt.ctDate('2026-09-18T03:00:00Z'), '2026-09-17');
  // 05:00Z in September is exactly midnight CDT: the first instant of the day.
  eq('ctDate at Central midnight', fmt.ctDate('2026-09-18T05:00:00Z'), '2026-09-18');
  eq('ctDate one second before Central midnight', fmt.ctDate('2026-09-18T04:59:59Z'), '2026-09-17');
  // Winter is CST, an hour further from UTC.
  eq('ctDate at Central midnight in winter', fmt.ctDate('2026-01-15T06:00:00Z'), '2026-01-15');
  eq('ctDate one second before, in winter', fmt.ctDate('2026-01-15T05:59:59Z'), '2026-01-14');
  eq('ctDate rejects junk', fmt.ctDate('not a time'), '');
  // A date-only string parses as UTC midnight and would answer "yesterday" in
  // Central. Refused, not silently shifted — rule 7's whole point.
  eq('ctDate refuses a date-only string rather than shifting it', fmt.ctDate('2026-09-17'), '');
  eq('ctDate rejects null', fmt.ctDate(null), '');

  console.log('\nrelative day labels');
  eq('dayLabel today', fmt.dayLabel('2026-09-17', '2026-09-17'), 'Today');
  eq('dayLabel tomorrow', fmt.dayLabel('2026-09-18', '2026-09-17'), 'Tomorrow');
  eq('dayLabel yesterday', fmt.dayLabel('2026-09-16', '2026-09-17'), 'Yesterday');
  eq('dayLabel further out', fmt.dayLabel('2026-09-24', '2026-09-17'), 'Thu Sep 24');
  eq('dayLabel across month end', fmt.dayLabel('2026-10-01', '2026-09-30'), 'Tomorrow');

  console.log('\nCentral kick times are reformatted, not parsed');
  eq('ctKick afternoon', fmt.ctKick('2026-09-17 15:25'), '3:25 PM');
  eq('ctKick noon', fmt.ctKick('2026-09-17 12:00'), '12:00 PM');
  eq('ctKick midnight', fmt.ctKick('2026-09-17 00:30'), '12:30 AM');
  eq('ctKick morning', fmt.ctKick('2026-09-17 09:05'), '9:05 AM');
  eq('ctKick passes junk through', fmt.ctKick('TBD'), 'TBD');
  eq('kickDate extracts the date half', fmt.kickDate('2026-09-17 15:25'), '2026-09-17');
  eq('kickDate on junk is empty', fmt.kickDate('TBD'), '');

  console.log('\nUTC instants are safe to parse');
  eq('ctTime renders an instant in Central', fmt.ctTime('2026-09-17T20:25:00.000Z'), '3:25 PM');
  eq('ctTime on junk is empty', fmt.ctTime('not a time'), '');
  eq('ago on junk is empty', fmt.ago('not a time'), '');

  // ctTime is the cards tile's auction end time, so the zone pin is load
  // bearing: the board is Matt's CENTRAL board, and opening it on a laptop in
  // Denver or a phone still set to Tokyo must not shift an auction by an
  // hour. `timeZone: 'America/Chicago'` is hard-coded in the formatter and
  // the locale is hard-coded 'en-US' — neither is read off the device. This
  // whole file is re-run under four timezones and the transcripts are diffed,
  // so if any of that ever started leaking the machine's zone (or its 24-hour
  // clock preference), these lines are where it would show.
  eq('ctTime pins Central, whatever the device thinks', fmt.ctTime('2026-09-21T00:48:00.000Z'), '7:48 PM');
  eq('and the zone, not the device, decides the date it lands on', fmt.ctTime('2026-09-21T04:30:00.000Z'), '11:30 PM');
  eq('an instant with a non-Z offset formats the same', fmt.ctTime('2026-09-20T19:48:00-05:00'), '7:48 PM');
  eq('the same moment written three ways agrees', new Set([
    fmt.ctTime('2026-09-21T00:48:00.000Z'),
    fmt.ctTime('2026-09-20T19:48:00-05:00'),
    fmt.ctTime('2026-09-21T02:48:00+02:00'),
  ]).size, 1);
  eq('midnight Central reads 12 AM, never 24:00', fmt.ctTime('2026-09-21T05:00:00.000Z'), '12:00 AM');
  eq('noon Central reads 12 PM', fmt.ctTime('2026-09-20T17:00:00.000Z'), '12:00 PM');
  // Standard time, not daylight — the pin has to follow Central's own rules
  // rather than a fixed -5 offset.
  eq('and it follows Central across the DST boundary', fmt.ctTime('2027-01-15T01:48:00.000Z'), '7:48 PM');

  // ctWeekday — the other half of the plan meter's reset line. The instant is
  // converted to a CENTRAL calendar date first, so an instant that is
  // Thursday in UTC and still Wednesday in Chicago answers Wed.
  eq('ctWeekday names the Central weekday', fmt.ctWeekday('2026-09-25T14:59:59+00:00'), 'Fri');
  eq('and it reads the Central day, not the UTC one', fmt.ctWeekday('2026-09-25T02:30:00.000Z'), 'Thu');
  eq('ctWeekday on a date-only string refuses', fmt.ctWeekday('2026-09-25'), '');
  eq('ctWeekday on junk is empty', fmt.ctWeekday('next Thursday'), '');
  eq('ctWeekday on nothing is empty', fmt.ctWeekday(null), '');

  console.log('\nnumbers');
  eq('units integer', fmt.units(2), '2u');
  eq('units fractional', fmt.units(1.5), '1.5u');
  eq('units junk', fmt.units(undefined), '—');
  eq('odds negative', fmt.odds(-110), '-110');
  eq('odds positive gets a plus', fmt.odds(135), '+135');
  eq('line negative', fmt.line(-3.5), '-3.5');
  eq('line positive gets a plus', fmt.line(3.5), '+3.5');
  eq('usd', fmt.usd(412.88), '$412.88');
  eq('usd zero is a real zero', fmt.usd(0), '$0.00');
  // A missing amount must never render as a confident $0.00.
  eq('usd null is unknown, not zero', fmt.usd(null), '—');
  eq('usd undefined is unknown', fmt.usd(undefined), '—');
  eq('usd empty string is unknown', fmt.usd(''), '—');
  eq('units null is unknown, not zero', fmt.units(null), '—');
  eq('odds null is blank, not zero', fmt.odds(null), '');
  eq('line null is blank, not zero', fmt.line(null), '');
  eq('line zero is a real zero', fmt.line(0), '0');

  // usdPrecise is the /ask meter's formatter: one ask costs about half a cent,
  // and usd() would round every one of them to $0.00.
  eq('usdPrecise keeps a sub-cent ask visible', fmt.usdPrecise(0.0048), '$0.0048');
  eq('usdPrecise on a real cent is ordinary money', fmt.usdPrecise(0.42), '$0.42');
  eq('usdPrecise on dollars is ordinary money', fmt.usdPrecise(3), '$3.00');
  eq('usdPrecise zero is a real zero', fmt.usdPrecise(0), '$0.00');
  eq('usdPrecise null is unknown, not zero', fmt.usdPrecise(null), '—');
  eq('usdPrecise refuses to round a tiny amount to nothing', fmt.usdPrecise(0.00004), '< $0.0001');
  eq('usdPrecise handles a negative sub-cent', fmt.usdPrecise(-0.0048), '-$0.0048');
  eq('usdPrecise at the cent boundary', fmt.usdPrecise(0.01), '$0.01');

  console.log('\nshort dates (the Purser\'s rows)');
  eq('a pay date is month and day', fmt.shortDate('2026-10-07'), '10/7');
  eq('no leading zeroes on either half', fmt.shortDate('2026-01-04'), '1/4');
  eq('the first of the year', fmt.shortDate('2026-01-01'), '1/1');
  eq('the last day of the year, which UTC-midnight parsing gets wrong', fmt.shortDate('2026-12-31'), '12/31');
  eq('unknown date text is returned verbatim', fmt.shortDate('sometime'), 'sometime');
  eq('and null is empty, not "Invalid Date"', fmt.shortDate(null), '');

  console.log('\ndays-out text (the Purser\'s rows — TEXT, never a tone)');
  // Deliberately not dueLabel: on The Due Stack colour carries manual-vs-
  // autopay, so a days count there must have no tone to reach for at all.
  eq('zero is today', fmt.daysOutText(0), 'today');
  eq('one is tomorrow', fmt.daysOutText(1), 'tomorrow');
  eq('two counts forward', fmt.daysOutText(2), 'in 2 days');
  eq('and so does forty-five', fmt.daysOutText(45), 'in 45 days');
  eq('a date behind us is stated plainly', fmt.daysOutText(-1), '1 day ago');
  eq('in the plural too', fmt.daysOutText(-4), '4 days ago');
  eq('no count means no chip', fmt.daysOutText(null), '');
  eq('junk means no chip', fmt.daysOutText('soon'), '');
  eq('undefined means no chip', fmt.daysOutText(undefined), '');
  eq('and it returns a bare string, with nothing to colour by', typeof fmt.daysOutText(3), 'string');

  console.log('\ndue labels (reminders — the tone ladder purser_due does NOT wear)');
  eq('overdue counts days', fmt.dueLabel(-3).text, '3d overdue');
  eq('overdue is red', fmt.dueLabel(-3).tone, 'bad');
  eq('today is today', fmt.dueLabel(0).text, 'due today');
  eq('today is red', fmt.dueLabel(0).tone, 'bad');
  eq('tomorrow is tomorrow', fmt.dueLabel(1).text, 'due tomorrow');
  eq('tomorrow is amber', fmt.dueLabel(1).tone, 'warn');
  eq('inside five days is amber', fmt.dueLabel(5).tone, 'warn');
  eq('past five days is neutral', fmt.dueLabel(6).tone, 'neutral');
  eq('a day count is a day count', fmt.dueLabel(9).text, '9d');
  eq('no days means no label', fmt.dueLabel(null), null);
  eq('junk days means no label', fmt.dueLabel('soon'), null);

  console.log('\nair labels (entertainment\'s voice, dueLabel\'s tones)');
  // Same urgency ladder, different words: "due" is a bill's word and an
  // episode is not owed. The tone assertions are deliberately written against
  // dueLabel rather than against literals, so the two can never drift apart
  // about what three days out looks like.
  eq('today airs today', fmt.airLabel(0).text, 'airs today');
  eq('tomorrow is just tomorrow', fmt.airLabel(1).text, 'tomorrow');
  eq('further out counts forward', fmt.airLabel(6).text, 'in 6d');
  eq('inside the amber band counts forward too', fmt.airLabel(2).text, 'in 2d');
  eq('a date already past says so', fmt.airLabel(-3).text, 'aired 3d ago');
  eq('no days means no chip', fmt.airLabel(null), null);
  eq('junk days means no chip', fmt.airLabel('soon'), null);
  eq('undefined means no chip', fmt.airLabel(undefined), null);

  for (const n of [-3, 0, 1, 2, 5, 6, 9, 74]) {
    eq(`tone at ${n} days matches dueLabel`, fmt.airLabel(n).tone, fmt.dueLabel(n).tone);
  }

  // The words must NOT match — that is the whole point of the second helper.
  eq('but the wording does not', fmt.airLabel(0).text === fmt.dueLabel(0).text, false);

  // dueLabel itself is untouched: Purser and Reminders keep saying "due".
  eq('dueLabel still says due today', fmt.dueLabel(0).text, 'due today');
  eq('dueLabel still says due tomorrow', fmt.dueLabel(1).text, 'due tomorrow');
  eq('dueLabel still counts bare days', fmt.dueLabel(6).text, '6d');

  console.log('\nCentral wall clock');
  // 'HH:MM' is Central wall time, not an instant: text in, text out.
  eq('morning', fmt.ctClock('09:15'), '9:15 AM');
  eq('afternoon', fmt.ctClock('16:30'), '4:30 PM');
  eq('noon is PM', fmt.ctClock('12:00'), '12:00 PM');
  eq('midnight is 12 AM', fmt.ctClock('00:00'), '12:00 AM');
  eq('junk is blank', fmt.ctClock('half four'), '');
  eq('an impossible hour is blank', fmt.ctClock('25:00'), '');
  eq('null is blank', fmt.ctClock(null), '');

  console.log('\nthe auction countdown — counted from the INSTANT, never the wall stamp');
  // v1.6.0. `ends_ct` has no offset, so a browser handed it guesses a zone and
  // guesses the phone's — that is rule 7's disqualifying bug, and it is why
  // nothing here ever touches it. `ends_utc` carries the offset, so parsing it
  // is exact. The harness runs this file in four timezones and diffs the
  // transcripts: if any of this leaked the machine's zone, these would differ.
  const AT = Date.parse('2026-09-21T00:48:00.000Z');
  const inMs = (ms) => fmt.msUntil('2026-09-21T00:48:00.000Z', AT - ms);

  eq('an instant reads the same in every timezone', inMs(90 * 60000), 90 * 60000);
  eq('a moment already gone counts negative', inMs(-30 * 60000), -30 * 60000);
  eq('the moment itself is zero', inMs(0), 0);
  eq('an offset other than Z is still an instant', fmt.msUntil('2026-09-20T19:48:00-05:00', AT), 0);
  eq('a wall-clock string with no offset is refused', fmt.msUntil('2026-09-20T19:48', AT), null);
  eq('a date-only string is refused too', fmt.msUntil('2026-09-20', AT), null);
  eq('junk is null', fmt.msUntil('tonight', AT), null);
  eq('null is null', fmt.msUntil(null, AT), null);

  // Every rung of the ladder, and both sides of every boundary.
  const HOUR = 3600000;
  eq('over a day counts days and hours', fmt.countdown(25 * HOUR), '1d 1h');
  eq('and drops the minutes entirely', fmt.countdown(2 * 24 * HOUR + 4 * HOUR + 59 * 60000), '2d 4h');
  eq('exactly a day is still hours and minutes', fmt.countdown(24 * HOUR), '24h 00m');
  eq('a second over a day tips into days', fmt.countdown(24 * HOUR + 1000), '1d 0h');
  eq('inside a day reads h and mm', fmt.countdown(3 * HOUR + 7 * 60000), '3h 07m');
  eq('the minutes are padded', fmt.countdown(3 * HOUR + 60000), '3h 01m');
  eq('exactly an hour is the hour form', fmt.countdown(HOUR), '1h 00m');
  eq('a second under an hour is minutes alone', fmt.countdown(HOUR - 1000), '59m');
  eq('59 minutes is minutes alone', fmt.countdown(59 * 60000), '59m');
  eq('it never rounds up into the next unit', fmt.countdown(59 * 60000 + 59000), '59m');
  eq('exactly fifteen minutes shows no seconds', fmt.countdown(15 * 60000), '15m');
  eq('a second under fifteen brings the seconds out', fmt.countdown(14 * 60000 + 59000), '14m 59s');
  eq('the last window counts them down', fmt.countdown(12 * 60000 + 30000), '12m 30s');
  eq('and pads them', fmt.countdown(8 * 60000), '8m 00s');
  eq('one second left still says so', fmt.countdown(1000), '0m 01s');
  eq('zero has ended', fmt.countdown(0), 'ended');
  eq('and so has anything past it', fmt.countdown(-1), 'ended');
  eq('a long way past it too', fmt.countdown(-3 * 24 * HOUR), 'ended');
  // A row with no instant must fall back to the wall stamp, not print a bug.
  eq('nothing to count is ended, never NaN', fmt.countdown(null), 'ended');
  eq('junk is ended too', fmt.countdown('soon'), 'ended');

  eq('no rung ever renders NaN', [25 * HOUR, 3 * HOUR, 59 * 60000, 1000, 0, -1].every((v) => !/NaN|undefined/.test(fmt.countdown(v))), true);

  // The pair that used to do this job is gone: it compared Central wall text
  // against a Central wall "now" because there was no instant to count from.
  // There is one now, so the workaround would only be a second, worse answer.
  eq('the wall-clock workaround is gone', typeof fmt.minutesUntilCt, 'undefined');
  eq('and so is the stamp it needed', typeof fmt.ctNowStamp, 'undefined');

  console.log('\nunits, to two decimals — the Bookie\'s own precision');
  // `units()` rounds to one decimal — right for a bankroll, wrong for a
  // ticket: 0.5u at +125 returns 0.62u, and "0.6u" would disagree with the
  // Bet-Log this board is read against.
  eq('two decimals, always', fmt.exactUnits(0.5), '0.50u');
  eq('a returned figure keeps its cent', fmt.exactUnits(0.62), '0.62u');
  eq('zero is a figure, not a blank', fmt.exactUnits(0), '0.00u');
  eq('a whole number still shows both places', fmt.exactUnits(2), '2.00u');
  eq('missing units read as unknown', fmt.exactUnits(null), '—');
  eq('junk units read as unknown too', fmt.exactUnits('lots'), '—');
  eq('an empty string is not zero', fmt.exactUnits(''), '—');

  eq('a win is signed up', fmt.signedUnits(0.62), '+0.62u');
  eq('a loss is signed down with a real minus', fmt.signedUnits(-0.5), '\u22120.50u');
  eq('and not with a hyphen', fmt.signedUnits(-0.5).includes('-'), false);
  eq('a push carries no sign at all', fmt.signedUnits(0), '0.00u');
  eq('nothing to say stays a dash', fmt.signedUnits(null), '—');
  eq('rounding is half-up at the cent', fmt.signedUnits(1.0345), '+1.03u');

  console.log('\nkick times sort by the clock, not by the alphabet');
  // The engine writes '6:05 PM' and the mock writes '15:25'. Sorting either as
  // text puts the evening game before the morning one.
  eq('12-hour evening is after 12-hour morning',
    fmt.kickKey('2026-09-18 6:05 PM') > fmt.kickKey('2026-09-18 7:30 AM'), true);
  eq('which plain text would get wrong', '2026-09-18 6:05 PM' > '2026-09-18 7:30 AM', false);
  eq('24-hour strings order too',
    fmt.kickKey('2026-09-18 15:25') > fmt.kickKey('2026-09-18 09:15'), true);
  eq('noon is midday', fmt.kickKey('2026-09-18 12:00 PM') - fmt.kickKey('2026-09-18 12:00 AM'), 720 * 60000);
  eq('midnight is the start of the day', fmt.kickKey('2026-09-18 12:00 AM'), fmt.kickKey('2026-09-18 00:00'));
  eq('a later date is later', fmt.kickKey('2026-09-19 08:00') > fmt.kickKey('2026-09-18 23:00'), true);
  eq('an hour apart is an hour apart', fmt.kickKey('2026-09-18 16:25') - fmt.kickKey('2026-09-18 15:25'), 3600000);
  eq('a T separator is a separator', fmt.kickKey('2026-09-18T15:25'), fmt.kickKey('2026-09-18 15:25'));
  eq('junk sorts last', fmt.kickKey('sometime'), Infinity);
  eq('a date with no time sorts last', fmt.kickKey('2026-09-18'), Infinity);
  eq('an impossible hour sorts last', fmt.kickKey('2026-09-18 26:00'), Infinity);
  eq('null sorts last', fmt.kickKey(null), Infinity);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
