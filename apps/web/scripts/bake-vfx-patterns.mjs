/**
 * Bake elemental-sandbox-style procedural patterns to PNG.
 * Run: node apps/web/scripts/bake-vfx-patterns.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../public/assets/vfx/patterns");
const SIZE = 256;

function hash11(p) {
  p = fract(p * 0.1031);
  p = p * (p + 33.33);
  p = p * (p + p);
  return fract(p);
}

function hash21(p) {
  let p3x = fract(p * 0.1031);
  let p3y = fract(p * 0.103);
  let p3z = fract(p * 0.0973);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d;
  p3y += d;
  p3z += d;
  return [fract((p3x + p3y) * p3z), fract((p3x + p3z) * p3y)];
}

function fract(x) {
  return x - Math.floor(x);
}

/** Simplified value noise (good enough for baked tiles). */
function valueNoise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash11(ix + iy * 57.13);
  const b = hash11(ix + 1 + iy * 57.13);
  const c = hash11(ix + (iy + 1) * 57.13);
  const d = hash11(ix + 1 + (iy + 1) * 57.13);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x, y, octaves = 4) {
  let v = 0;
  let a = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    v += a * valueNoise2(px, py);
    px = px * 2.02 + 17.3;
    py = py * 2.02 + 5.1;
    a *= 0.5;
  }
  return v;
}

function ridged2(x, y, octaves = 4) {
  let v = 0;
  let a = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    v += a * (1 - Math.abs(valueNoise2(px, py) * 2 - 1));
    px *= 2.06;
    py *= 2.06;
    a *= 0.5;
  }
  return v;
}

function voronoi2(x, y) {
  const nX = Math.floor(x);
  const nY = Math.floor(y);
  const fX = fract(x);
  const fY = fract(y);
  let f1 = 8;
  let f2 = 8;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [ox, oy] = hash21((nX + i) * 7.13 + (nY + j) * 113.17);
      const rx = i + ox - fX;
      const ry = j + oy - fY;
      const d = Math.sqrt(rx * rx + ry * ry);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash11((nX + i) * 31.7 + (nY + j) * 57.1);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return [f1, f2, id];
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}
const CRC = crcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRGBA(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeGrayAlpha(name, sampleFn) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const { g, a } = sampleFn(u, v, x, y);
      const i = (y * SIZE + x) * 4;
      const gv = Math.max(0, Math.min(255, Math.round(g * 255)));
      const av = Math.max(0, Math.min(255, Math.round(a * 255)));
      rgba[i] = gv;
      rgba[i + 1] = gv;
      rgba[i + 2] = gv;
      rgba[i + 3] = av;
    }
  }
  const path = join(OUT, `${name}.png`);
  writeFileSync(path, encodePngRGBA(SIZE, SIZE, rgba));
  console.log("wrote", path);
}

mkdirSync(OUT, { recursive: true });

// Voronoi ice plates + bright seams at cell edges (sandbox frost field).
writeGrayAlpha("frost-plates", (u, v) => {
  const pX = (u - 0.5) * 6;
  const pY = (v - 0.5) * 6;
  const [f1, f2, id] = voronoi2(pX * 3.2 + 2.1, pY * 3.2 + 0.7);
  const seams = 1 - smoothstep(0, 0.12, f2 - f1);
  const plate = 0.35 + 0.55 * id;
  const g = Math.min(1, plate * 0.5 + seams * 0.95);
  const a = Math.min(1, plate * 0.65 + seams);
  return { g, a };
});

// Domain-warped ridged frost fingers.
writeGrayAlpha("frost-fingers", (u, v) => {
  const pX = (u - 0.5) * 5;
  const pY = (v - 0.5) * 5;
  const warp = fbm2(pX * 0.5, pY * 0.5, 3) * 0.85;
  const fil = ridged2(pX * 2.4 + warp, pY * 2.4 + warp * 0.7, 4);
  const g = smoothstep(0.55, 0.95, fil);
  return { g, a: g };
});

// Ridged cracks — fire fissures, earth splits, ice fracture.
writeGrayAlpha("ridged-cracks", (u, v) => {
  const fil = ridged2(u * 8 + 3.1, v * 8 + 1.4, 5);
  const g = Math.pow(smoothstep(0.5, 0.98, fil), 1.4);
  return { g, a: g };
});

// Soft fbm grain — mist / smoke breakup.
writeGrayAlpha("fbm-soft", (u, v) => {
  const n = fbm2(u * 4, v * 4, 5);
  const g = Math.max(0, Math.min(1, n));
  return { g, a: g };
});

// Sparse sparkle dots (hard-threshold high-frequency noise).
writeGrayAlpha("sparkle-dots", (u, v) => {
  const n = valueNoise2(u * 48 + 9.2, v * 48 + 4.7);
  const g = n > 0.92 ? Math.pow((n - 0.92) / 0.08, 2) : 0;
  return { g, a: g };
});

// Classic dissolve field.
writeGrayAlpha("dissolve-noise", (u, v) => {
  const n = fbm2(u * 6.5 + 1.1, v * 6.5 + 2.3, 4);
  const g = Math.max(0, Math.min(1, n));
  return { g, a: 1 };
});
