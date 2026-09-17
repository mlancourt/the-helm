#!/usr/bin/env node
/**
 * The Helm — PWA icon generator. Node, zero deps (zlib is built in).
 *
 *   node tools/make-icons.js
 *
 * Draws a ship's wheel procedurally and writes real PNGs. No external icon
 * fonts, no CDN, no brand marks — rule 4 means the glyph has to be ours, and
 * "no build step for the page" means the PNGs are committed artifacts.
 *
 * iOS home-screen install needs a genuine PNG apple-touch-icon (it will not
 * take an SVG), which is why this exists at all.
 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

// ------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer of w*h*4. Returns a complete PNG buffer. */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- the glyph

const BG = [15, 20, 26]; // #0f141a — matches the app background
const FG = [201, 162, 39]; // #c9a227 — brass

/**
 * Coverage of the ship's-wheel glyph at a point, 0..1, by supersampling.
 * Geometry is expressed as fractions of the canvas so it scales exactly.
 *
 * The whole wheel fits inside 62% of the canvas width, which keeps it within
 * the 80%-diameter safe circle that maskable icons get cropped to.
 */
function wheelCoverage(px, py, size, samples = 4) {
  const c = size / 2;
  const S = size; // shorthand for fractional geometry
  const rimR = 0.235 * S; // rim centreline radius
  const rimT = 0.042 * S; // rim thickness
  const hubR = 0.062 * S; // centre hub radius
  const hubHole = 0.024 * S; // hub bore
  const spokeW = 0.030 * S; // spoke width
  const pegGap = 0.012 * S; // gap between rim and handle
  const pegLen = 0.055 * S; // handle length
  const pegW = 0.034 * S; // handle width

  let hits = 0;
  const step = 1 / samples;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = px + (sx + 0.5) * step - c;
      const y = py + (sy + 0.5) * step - c;
      const dist = Math.hypot(x, y);

      // rim
      if (Math.abs(dist - rimR) <= rimT / 2) {
        hits++;
        continue;
      }
      // hub (an annulus, so the wheel reads as a wheel and not a lollipop)
      if (dist <= hubR && dist >= hubHole) {
        hits++;
        continue;
      }

      // eight spokes and eight handles, every 45 degrees
      let on = false;
      for (let k = 0; k < 8 && !on; k++) {
        const a = (k * Math.PI) / 4;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const along = x * cos + y * sin;
        const perp = -x * sin + y * cos;

        if (Math.abs(perp) <= spokeW / 2 && along >= 0 && along <= rimR) on = true;
        else if (
          Math.abs(perp) <= pegW / 2 &&
          along >= rimR + rimT / 2 + pegGap &&
          along <= rimR + rimT / 2 + pegGap + pegLen
        ) {
          on = true;
        }
      }
      if (on) hits++;
    }
  }
  return hits / (samples * samples);
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = wheelCoverage(x, y, size);
      const i = (y * size + x) * 4;
      // Composite brass over the opaque background. Opaque throughout so
      // maskable cropping never exposes a transparent corner.
      buf[i] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      buf[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      buf[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      buf[i + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'docs', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const [size, name] of [
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
  [180, 'apple-touch-icon.png'], // iOS home screen
]) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`${name.padEnd(22)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
