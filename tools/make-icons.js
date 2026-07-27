/* =========================================================================
   tools/make-icons.js — writes the PWA icons.

   The icon is the app: three colour bands in the same 26/32/42 proportion the
   cards use. Full-bleed, so it survives any maskable crop iOS or Android
   applies. Encodes PNG directly (zlib is in node) rather than pulling in an
   image library for four flat rectangles.

     node tools/make-icons.js
   ========================================================================= */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'icons');

/* olive layer / cream top / tan bottom — three clearly separated values so it
   still reads as three bands at 40px on a home screen. */
const BANDS = [
  { hex: '#55603A', share: 26 },
  { hex: '#F3F1ED', share: 32 },
  { hex: '#A8814F', share: 42 },
];

/* ---------- PNG encoding ------------------------------------------------ */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8 bits per channel
  ihdr[9] = 2;  // truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- the artwork ------------------------------------------------- */
const toRGB = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function bandedSquare(size) {
  const total = BANDS.reduce((a, b) => a + b.share, 0);
  const rows = [];
  let used = 0;
  BANDS.forEach((band, i) => {
    const height = i === BANDS.length - 1 ? size - used : Math.round((band.share / total) * size);
    used += height;
    for (let y = 0; y < height; y++) rows.push(toRGB(band.hex));
  });

  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    const [r, g, b] = rows[y];
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
    }
  }
  return encodePNG(size, size, buf);
}

/* ---------- write ------------------------------------------------------- */
mkdirSync(iconDir, { recursive: true });

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
];

for (const [name, size] of targets) {
  const png = bandedSquare(size);
  writeFileSync(join(iconDir, name), png);
  console.log(`icons/${name}  ${size}×${size}  ${png.length} bytes`);
}
