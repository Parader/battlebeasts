import type { MapWater } from "./mapDoc";

/**
 * Triangle mesh for a drawn river or pond, in world XZ with a fixed height.
 *
 * A pond fills its loop. A river is a ribbon of the stored width. The same
 * positions feed the editor, the Three match view, and the Babylon view.
 */

export type WaterMeshData = {
  positions: Float32Array;
  indices: Uint32Array;
};

const WATER_Y = 0.06;

export function buildWaterMesh(water: Pick<MapWater, "points" | "closed" | "width">): WaterMeshData | null {
  const points = water.points;
  if (water.closed && points.length >= 3) return fillPolygon(points);
  if (points.length >= 2) return ribbon(points, Math.max(0.25, water.width));
  return null;
}

function fillPolygon(points: ReadonlyArray<readonly [number, number]>): WaterMeshData | null {
  const tris = triangulate(points);
  if (!tris.length) return null;
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    positions[i * 3] = points[i]![0];
    positions[i * 3 + 1] = WATER_Y;
    positions[i * 3 + 2] = points[i]![1];
  }
  return { positions, indices: Uint32Array.from(tris) };
}

function ribbon(points: ReadonlyArray<readonly [number, number]>, width: number): WaterMeshData | null {
  const half = width / 2;
  const n = points.length;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const { left, right } = offsetAt(points, i, half);
    positions[i * 6] = left[0];
    positions[i * 6 + 1] = WATER_Y;
    positions[i * 6 + 2] = left[1];
    positions[i * 6 + 3] = right[0];
    positions[i * 6 + 4] = WATER_Y;
    positions[i * 6 + 5] = right[1];
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/** Left and right bank of one river vertex, with the corner miter clamped. */
function offsetAt(
  points: ReadonlyArray<readonly [number, number]>,
  index: number,
  half: number,
): { left: [number, number]; right: [number, number] } {
  const n = points.length;
  const prev = points[Math.max(0, index - 1)]!;
  const here = points[index]!;
  const next = points[Math.min(n - 1, index + 1)]!;
  const inX = here[0] - prev[0];
  const inZ = here[1] - prev[1];
  const outX = next[0] - here[0];
  const outZ = next[1] - here[1];
  const inL = Math.hypot(inX, inZ) || 1;
  const outL = Math.hypot(outX, outZ) || 1;
  const n1x = -inZ / inL;
  const n1z = inX / inL;
  const n2x = -outZ / outL;
  const n2z = outX / outL;
  let mx = n1x + n2x;
  let mz = n1z + n2z;
  const ml = Math.hypot(mx, mz);
  if (ml < 1e-4) {
    mx = n1x;
    mz = n1z;
  } else {
    mx /= ml;
    mz /= ml;
  }
  const denom = mx * n1x + mz * n1z;
  const scale = Math.min(2.5, Math.abs(denom) > 0.3 ? 1 / denom : 1);
  const ox = mx * half * scale;
  const oz = mz * half * scale;
  return {
    left: [here[0] + ox, here[1] + oz],
    right: [here[0] - ox, here[1] - oz],
  };
}

/** Ear clip. Returns triangle indices, or nothing when the loop will not clip. */
function triangulate(points: ReadonlyArray<readonly [number, number]>): number[] {
  const n = points.length;
  if (n < 3) return [];
  const idx = points.map((_, i) => i);
  if (signedArea(points) < 0) idx.reverse();
  const tris: number[] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      if (!isEar(points, idx, i0, i1, i2)) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  if (idx.length === 3) tris.push(idx[0]!, idx[1]!, idx[2]!);
  return tris;
}

function signedArea(points: ReadonlyArray<readonly [number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

function isEar(
  points: ReadonlyArray<readonly [number, number]>,
  rest: number[],
  i0: number,
  i1: number,
  i2: number,
): boolean {
  const a = points[i0]!;
  const b = points[i1]!;
  const c = points[i2]!;
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross <= 1e-8) return false;
  for (const j of rest) {
    if (j === i0 || j === i1 || j === i2) continue;
    if (inside(points[j]!, a, b, c)) return false;
  }
  return true;
}

function inside(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): boolean {
  const c1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const c2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const c3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return c1 > 1e-8 && c2 > 1e-8 && c3 > 1e-8;
}
