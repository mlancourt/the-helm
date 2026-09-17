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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
