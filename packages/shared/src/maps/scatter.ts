/**
 * A painted patch of repeated props: grass, leaves, pebbles.
 *
 * The document stores the discs and the mix, not one record per blade. The
 * same seed always expands to the same points, so a save stays small and the
 * renderer can draw every copy of a model in one instanced batch, with no
 * collider and no shadow.
 */

/** Hard cap so a full-map stroke cannot become tens of thousands of meshes. */
export const SCATTER_MAX_INSTANCES = 2500;

/** Clumps per square metre the brush will ask for. */
export const SCATTER_MAX_DENSITY = 4;

/** How many different models one patch can mix. */
export const SCATTER_MAX_MIX = 6;

/** Discs stored for one stroke. A long drag still covers the ground. */
export const SCATTER_MAX_DABS = 180;

export type MapScatterProp = {
  /** Manifest key. */
  prop: string;
  /**
   * Distance from the model origin down to its base, baked at paint time.
   * Instance height is the ground surface minus this, which is how a placed
   * prop sits, so the runtime does not need the manifest.
   */
  baseY: number;
  pivotX?: number;
  pivotZ?: number;
};

export type MapScatter = {
  id: string;
  /** World XZ discs. Overlap is one cover, not a double planting. */
  dabs: Array<[number, number, number]>;
  props: MapScatterProp[];
  /** Target clumps per square metre, before the instance cap. */
  density: number;
  seed: number;
  scaleMin: number;
  scaleMax: number;
};

export type ScatterInstance = {
  prop: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  pivotX: number;
  pivotZ: number;
};

/** Bilinear sample of a height grid. `u`/`v` are 0..1 across the tile. */
export function sampleGridHeight(
  data: Float32Array,
  resX: number,
  resZ: number,
  u: number,
  v: number,
): number {
  const x = Math.min(resX - 1, Math.max(0, u * resX - 0.5));
  const y = Math.min(resZ - 1, Math.max(0, v * resZ - 0.5));
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const i1 = Math.min(resX - 1, i0 + 1);
  const j1 = Math.min(resZ - 1, j0 + 1);
  const fx = x - i0;
  const fy = y - j0;
  const at = (i: number, j: number) => data[j * resX + i] ?? 0.5;
  const top = at(i0, j0) + (at(i1, j0) - at(i0, j0)) * fx;
  const bottom = at(i0, j1) + (at(i1, j1) - at(i0, j1)) * fx;
  return top + (bottom - top) * fy;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insideDabs(dabs: Array<[number, number, number]>, x: number, z: number): boolean {
  for (const [dx, dz, r] of dabs) {
    if ((x - dx) * (x - dx) + (z - dz) * (z - dz) <= r * r) return true;
  }
  return false;
}

/**
 * Turn a patch into world instances.
 *
 * `surfaceY` is the ground height at a world point. The model's base is
 * subtracted so the clump sits on that surface.
 */
export function expandScatter(
  field: MapScatter,
  surfaceY: (x: number, z: number) => number,
): ScatterInstance[] {
  const props = field.props.filter((p) => p.prop);
  if (!props.length || !field.dabs.length) return [];
  const density = Math.min(SCATTER_MAX_DENSITY, Math.max(0.05, field.density));
  let spacing = 1 / Math.sqrt(density);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z, r] of field.dabs) {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minZ = Math.min(minZ, z - r);
    maxZ = Math.max(maxZ, z + r);
  }

  const MAX_CELLS = 40000;
  let cols = Math.max(1, Math.ceil((maxX - minX) / spacing));
  let rows = Math.max(1, Math.ceil((maxZ - minZ) / spacing));
  if (cols * rows > MAX_CELLS) {
    spacing *= Math.sqrt((cols * rows) / MAX_CELLS);
    cols = Math.max(1, Math.ceil((maxX - minX) / spacing));
    rows = Math.max(1, Math.ceil((maxZ - minZ) / spacing));
  }

  const rand = mulberry32(field.seed || 1);
  const scaleMin = Math.min(field.scaleMin, field.scaleMax);
  const scaleMax = Math.max(field.scaleMin, field.scaleMax);
  const raw: ScatterInstance[] = [];

  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const cx = minX + (ix + 0.5) * spacing;
      const cz = minZ + (iz + 0.5) * spacing;
      if (!insideDabs(field.dabs, cx, cz)) continue;
      const x = cx + (rand() - 0.5) * spacing * 0.8;
      const z = cz + (rand() - 0.5) * spacing * 0.8;
      if (!insideDabs(field.dabs, x, z)) continue;
      const choice = props[Math.floor(rand() * props.length)]!;
      raw.push({
        prop: choice.prop,
        x,
        y: surfaceY(x, z) - choice.baseY,
        z,
        yaw: rand() * Math.PI * 2,
        scale: scaleMin + rand() * (scaleMax - scaleMin),
        pivotX: choice.pivotX ?? 0,
        pivotZ: choice.pivotZ ?? 0,
      });
    }
  }

  if (raw.length <= SCATTER_MAX_INSTANCES) return raw;
  const step = raw.length / SCATTER_MAX_INSTANCES;
  const kept: ScatterInstance[] = [];
  for (let i = 0; i < SCATTER_MAX_INSTANCES; i++) kept.push(raw[Math.floor(i * step)]!);
  return kept;
}
