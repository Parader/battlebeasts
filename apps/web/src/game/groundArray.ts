import { groundMaterial, type GroundMaterialDef } from "@battlebeasts/shared";
import { assetUrl } from "./assetUrl";

/** Every painted-ground array layer is resampled to this square. */
export const GROUND_ARRAY_SIZE = 512;

const LAYER_BYTES = GROUND_ARRAY_SIZE * GROUND_ARRAY_SIZE * 4;

const decoded = new Map<string, Uint8Array>();

const FLAT_NORMAL = new Uint8Array(LAYER_BYTES);
for (let i = 0; i < FLAT_NORMAL.length; i += 4) {
  FLAT_NORMAL[i] = 128;
  FLAT_NORMAL[i + 1] = 128;
  FLAT_NORMAL[i + 2] = 255;
  FLAT_NORMAL[i + 3] = 255;
}

/**
 * RGBA8, bottom row first, so a DataTexture with flipY off matches the image.
 */
async function decodeLayer(url: string): Promise<Uint8Array> {
  const cached = decoded.get(url);
  if (cached) return cached;
  const response = await fetch(assetUrl(url));
  if (!response.ok) throw new Error(`ground texture ${url} (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = GROUND_ARRAY_SIZE;
  canvas.height = GROUND_ARRAY_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("ground texture canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, GROUND_ARRAY_SIZE, GROUND_ARRAY_SIZE);
  bitmap.close();
  const src = ctx.getImageData(0, 0, GROUND_ARRAY_SIZE, GROUND_ARRAY_SIZE).data;
  const out = new Uint8Array(LAYER_BYTES);
  const row = GROUND_ARRAY_SIZE * 4;
  for (let y = 0; y < GROUND_ARRAY_SIZE; y++) {
    const from = (GROUND_ARRAY_SIZE - 1 - y) * row;
    out.set(src.subarray(from, from + row), y * row);
  }
  decoded.set(url, out);
  return out;
}

export type PackedGroundPalette = {
  ids: string[];
  /** RGBA8 array, depth layers of GROUND_ARRAY_SIZE², bottom-up. */
  diff: Uint8Array;
  nor: Uint8Array;
  /**
   * 256×1 RGBA. R is the array layer, G is tile metres × 4.
   * Indexed by the material's catalog slot.
   */
  info: Uint8Array;
  depth: number;
};

/** Stack the given materials into one array the splat shader can index. */
export async function packGroundPalette(ids: readonly string[]): Promise<PackedGroundPalette> {
  const defs = ids
    .map((id) => groundMaterial(id))
    .filter((def): def is GroundMaterialDef => !!def);
  const depth = Math.max(1, defs.length);
  const diff = new Uint8Array(LAYER_BYTES * depth);
  const nor = new Uint8Array(LAYER_BYTES * depth);
  const info = new Uint8Array(256 * 4);
  for (let slot = 0; slot < 256; slot++) {
    info[slot * 4] = 0;
    info[slot * 4 + 1] = 8 * 4;
    info[slot * 4 + 3] = 255;
  }
  if (!defs.length) {
    for (let i = 0; i < LAYER_BYTES; i += 4) {
      diff[i] = 90;
      diff[i + 1] = 110;
      diff[i + 2] = 70;
      diff[i + 3] = 255;
    }
    nor.set(FLAT_NORMAL);
    return { ids: [], diff, nor, info, depth: 1 };
  }

  await Promise.all(
    defs.map(async (def, layer) => {
      const colour = await decodeLayer(def.diff).catch(() => {
        const fallback = new Uint8Array(LAYER_BYTES);
        for (let i = 0; i < fallback.length; i += 4) {
          fallback[i] = 90;
          fallback[i + 1] = 110;
          fallback[i + 2] = 70;
          fallback[i + 3] = 255;
        }
        return fallback;
      });
      diff.set(colour, layer * LAYER_BYTES);
      const normal = def.nor ? await decodeLayer(def.nor).catch(() => FLAT_NORMAL) : FLAT_NORMAL;
      nor.set(normal, layer * LAYER_BYTES);
      if (def.slot >= 0 && def.slot < 256) {
        info[def.slot * 4] = layer;
        info[def.slot * 4 + 1] = Math.max(1, Math.min(255, Math.round(def.tile * 4)));
        info[def.slot * 4 + 3] = 255;
      }
    }),
  );

  return { ids: defs.map((def) => def.id), diff, nor, info, depth };
}
