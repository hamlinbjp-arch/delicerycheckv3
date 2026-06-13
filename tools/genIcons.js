// tools/genIcons.js — generate placeholder PWA icons (no deps; pure zlib PNG encoder).
// A white checkmark on the brand green. Writes public/icon-192.png, icon-512.png, and
// apple-touch-icon.png (180). Re-run after changing the art; commit the PNGs.
//
// Run: `node tools/genIcons.js`

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public");

const BG = [26, 127, 55];   // #1a7f37 brand green
const FG = [255, 255, 255]; // white check

// CRC32 (PNG chunk checksums).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Distance from point P to segment AB, for rasterizing thick strokes.
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function makePng(size) {
  // Checkmark polyline (two segments) in normalized coords, scaled to `size`.
  const s = size;
  const a = [0.27 * s, 0.55 * s];
  const b = [0.43 * s, 0.71 * s];
  const c = [0.74 * s, 0.34 * s];
  const half = 0.055 * s; // stroke half-thickness

  // Raw image: each scanline prefixed with filter byte 0, RGB pixels.
  const raw = Buffer.alloc((s * 3 + 1) * s);
  let o = 0;
  for (let y = 0; y < s; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < s; x++) {
      const d = Math.min(
        distToSeg(x, y, a[0], a[1], b[0], b[1]),
        distToSeg(x, y, b[0], b[1], c[0], c[1])
      );
      const col = d <= half ? FG : BG;
      raw[o++] = col[0];
      raw[o++] = col[1];
      raw[o++] = col[2];
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  writeFileSync(join(OUT, name), makePng(size));
  console.log(`wrote public/${name} (${size}×${size})`);
}
