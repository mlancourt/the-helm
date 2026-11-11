/**
 * The one sparkline geometry, shared by every hand-drawn sparkline on the page
 * (rule 3 — no chart library): `wss_traffic`'s face and sheet (S13) and
 * `bets_live`'s sweat line (B30). Pure: values in, an SVG path out.
 */

const round = (n) => Math.round(n * 10) / 10;

/**
 * The ONLY arithmetic on the series: min/max of what is drawn, to pixels.
 * `invert` turns the Y axis over so a lower number sits higher; a null lifts
 * the pen. `span` ({lo, hi}), when given, fixes the scale instead of reading
 * it off the data — the sweat line is always 0–1. Returns null when there is
 * nothing to draw.
 */
export function sparkGeometry(vals, box, base, invert, span = null) {
  const have = vals.filter((v) => v !== null);
  if (!have.length) return null;
  const range = base === null ? have : have.concat([base]);
  let lo = span ? span.lo : Math.min(...range);
  let hi = span ? span.hi : Math.max(...range);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const n = vals.length;
  const xAt = (i) => (n === 1 ? box.w / 2 : box.px + ((box.w - box.px * 2) * i) / (n - 1));
  const frac = (v) => (invert ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo));
  const yAt = (v) => box.py + frac(v) * (box.h - box.py * 2);

  let d = '';
  let pen = false;
  let last = null;
  vals.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += (pen ? 'L' : 'M') + round(xAt(i)) + ' ' + round(yAt(v)) + ' ';
    pen = true;
    last = i;
  });
  return { d: d.trim(), last, x: xAt(last), y: yAt(vals[last]), yAt };
}
