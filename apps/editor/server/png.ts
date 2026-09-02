import { deflateSync } from "node:zlib";

/**
 * Minimal PNG encoder for the editor's ground sidecars.
 *
 * Hand-rolled instead of pulled from npm because the need is narrow -- two
 * colour types, no interlacing, no palette -- and because the obvious
 * alternative, encoding in the browser via canvas, silently corrupts the data.
 * A 2D canvas stores premultiplied alpha, so a splat texel that is "all layer
 * 0, zero alpha" round-trips as black and the base layer vanishes. Sending raw
 * bytes here and compressing them properly avoids the whole class of problem.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG colour types we emit. */
const COLOR_TYPE = { gray: 0, rgba: 6 } as const;

/**
 * Encode 8-bit samples as a PNG.
 *
 * `data` is tightly packed, row-major, `channels` bytes per pixel: 4 for a
 * splat map (one layer weight per channel), 1 for a height map.
 */
export function encodePng(
  data: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 4,
): Buffer {
  const expected = width * height * channels;
  if (data.length !== expected) {
    throw new Error(`png: expected ${expected} bytes for ${width}x${height}x${channels}, got ${data.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(channels === 4 ? COLOR_TYPE.rgba : COLOR_TYPE.gray, 9);
  // compression / filter / interlace: the only values the spec allows here.
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  // Filter byte 0 (None) per scanline. These are noise-like weight maps, so
  // the adaptive filters PNG offers would cost time without shrinking much.
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
