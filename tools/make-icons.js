#!/usr/bin/env node
/**
 * The Helm — PWA icon generator. Node, zero deps (zlib is built in).
 *
 *   node tools/make-icons.js
 *
 * Draws the LannyAI mark procedurally and writes real PNGs. No external icon
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
// The LannyAI mark (Matt, 2026-11-11): an L with a crossbar-less "AI" in its
// upper right, inside a plain ring. Two inks on the dark ground — warm white
// for the L and ring, Wren green for the AI. Geometry is in 1024ths of the
// canvas; the ring's outer edge is 0.39 S, inside the 0.40 S maskable circle.
const BG_TOP = [31, 31, 33]; // #1f1f21
const BG_BOT = [9, 9, 10]; // #09090a
const INK = [242, 237, 227]; // #f2ede3 — L + ring
const NOD = [105, 190, 40]; // #69be28 — the AI (--wren)

const STROKE = 60;
const RING = { r: 384, w: 30 };
// The L's rounded corner is a quadratic (322,631.6) → ctrl (322,702) → (392.4,702), walked as short segments.
const CORNER = Array.from({ length: 9 }, (_, i) => {
  const t = i / 8;
  const u = 1 - t;
  return [u * u * 322 + 2 * u * t * 322 + t * t * 392.4, u * u * 631.6 + 2 * u * t * 702 + t * t * 702];
});
const L_PATH = [[322, 322], ...CORNER, [702, 702]];
const AI_PATHS = [
  [[439.2, 517.2], [518.1, 322], [597, 517.2]], // Λ
  [[702, 322], [702, 517.2]], // I
];

function distToSegment(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function onPath(x, y, pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i], pts[i + 1]) <= STROKE / 2) return true;
  }
  return false;
}

/** Coverage of each ink at a pixel, 0..1, by supersampling: [ink, nod]. */
function markCoverage(px, py, size, samples = 4) {
  const k = 1024 / size;
  let ink = 0;
  let nod = 0;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = (px + (sx + 0.5) / samples) * k;
      const y = (py + (sy + 0.5) / samples) * k;
      if (AI_PATHS.some((p) => onPath(x, y, p))) nod++;
      else if (onPath(x, y, L_PATH) || Math.abs(Math.hypot(x - 512, y - 512) - RING.r) <= RING.w / 2) ink++;
    }
  }
  return [ink / (samples * samples), nod / (samples * samples)];
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const g = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const [a, b] = markCoverage(x, y, size);
      const i = (y * size + x) * 4;
      // Opaque throughout so maskable cropping never exposes a transparent corner.
      for (let c = 0; c < 3; c++) {
        const bg = BG_TOP[c] + (BG_BOT[c] - BG_TOP[c]) * g;
        buf[i + c] = Math.round(bg * (1 - a - b) + INK[c] * a + NOD[c] * b);
      }
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
