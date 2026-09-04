/**
 * Generate a 512×128 wind-streak texture (white wisps on transparent bg).
 * Pure Node — no dependencies (writes raw PNG).
 * Run: node tools/gen-wind-texture.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 512;
const H = 128;
const pixels = Buffer.alloc(W * H * 4, 0); // RGBA

function hash(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function setPixel(x, y, r, g, b, a) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return;
  const off = (iy * W + ix) * 4;
  // Additive blend
  const oldA = pixels[off + 3] / 255;
  const newA = a;
  const outA = Math.min(1, oldA + newA * (1 - oldA));
  if (outA <= 0) return;
  pixels[off] = Math.min(255, pixels[off] + r * newA * 255);
  pixels[off + 1] = Math.min(255, pixels[off + 1] + g * newA * 255);
  pixels[off + 2] = Math.min(255, pixels[off + 2] + b * newA * 255);
  pixels[off + 3] = Math.min(255, Math.round(outA * 255));
}

function drawSoftDot(cx, cy, radius, alpha) {
  const r2 = Math.ceil(radius);
  for (let dy = -r2; dy <= r2; dy++) {
    for (let dx = -r2; dx <= r2; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const a = alpha * falloff * falloff;
      setPixel(cx + dx, cy + dy, 1, 1, 1, a);
    }
  }
}

// Wispy horizontal streaks
for (let i = 0; i < 45; i++) {
  const seed = i * 17 + 3;
  const y0 = hash(seed) * H;
  const thick = 0.8 + hash(seed + 1) * 3.0;
  const alpha = 0.12 + hash(seed + 2) * 0.4;
  const waveAmp = hash(seed + 3) * 8;
  const waveFreq = 0.008 + hash(seed + 4) * 0.025;
  const startX = hash(seed + 5) * W * 0.25;
  const endX = startX + W * (0.35 + hash(seed + 6) * 0.65);
  const phase = hash(seed + 7) * Math.PI * 2;

  for (let x = startX; x <= endX; x += 0.8) {
    const frac = (x - startX) / (endX - startX);
    const edgeFade = Math.min(1, frac * 5, (1 - frac) * 5);
    const y = y0 + Math.sin(x * waveFreq + phase) * waveAmp * edgeFade;
    drawSoftDot(x, y, thick, alpha * edgeFade * 0.5);
  }
}

// Wider blurry wisps
for (let i = 0; i < 15; i++) {
  const seed = i * 31 + 100;
  const y0 = hash(seed) * H;
  const thick = 5 + hash(seed + 1) * 8;
  const alpha = 0.03 + hash(seed + 2) * 0.06;
  const startX = hash(seed + 5) * W * 0.15;
  const endX = startX + W * (0.5 + hash(seed + 6) * 0.5);
  const waveAmp = hash(seed + 3) * 10;
  const waveFreq = 0.005 + hash(seed + 4) * 0.01;
  const phase = hash(seed + 7) * Math.PI * 2;

  for (let x = startX; x <= endX; x += 1.5) {
    const frac = (x - startX) / (endX - startX);
    const edgeFade = Math.min(1, frac * 4, (1 - frac) * 4);
    const y = y0 + Math.sin(x * waveFreq + phase) * waveAmp * edgeFade;
    drawSoftDot(x, y, thick, alpha * edgeFade);
  }
}

// Scattered particles
for (let i = 0; i < 80; i++) {
  const seed = i * 43 + 200;
  const x = hash(seed) * W;
  const y = hash(seed + 1) * H;
  const r = 0.6 + hash(seed + 2) * 2.0;
  const a = 0.08 + hash(seed + 3) * 0.2;
  drawSoftDot(x, y, r, a);
}

// Encode PNG manually
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crc32Table[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}
const crc32Table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crc32Table[n] = c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// IDAT — filter type 0 (None) per row
const rawRows = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  rawRows[y * (1 + W * 4)] = 0; // filter None
  pixels.copy(rawRows, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}
const compressed = zlib.deflateSync(rawRows, { level: 9 });

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([
  sig,
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", compressed),
  pngChunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "apps", "web", "public", "textures", "wind-streak.png");
fs.writeFileSync(out, png);
console.log(`Written ${png.length} bytes to ${out}`);
