import { BufferAttribute, type BufferGeometry } from "three";

/**
 * How far each vertex sits from the flag pole. The cloth waves by this
 * distance; the pole and the crossbar it hangs from stay at 0.
 *
 * The pole is not the mesh origin on these kits — adventure-island flags hang
 * beside it, stone-age poles sit a few centimetres off, and some banners have
 * two. The crossbar is a thin horizontal stick at the top of the cloth, and
 * it has to be frozen separately or the whole top of the flag swings.
 */
export function attachClothReach(geometry: BufferGeometry): void {
  const pos = geometry.getAttribute("position");
  if (!pos || pos.count < 4) return;

  const count = pos.count;
  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const ySpan = Math.max(yMax - yMin, 1e-4);
  const horiz = Math.max(xMax - xMin, zMax - zMin, 1e-4);
  const cell = Math.max(horiz * 0.02, 0.02);

  const bottom: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    if (y <= yMin + ySpan * 0.22) bottom.push(i);
    if (y >= yMax - ySpan * 0.18) top.push(i);
  }

  const poles = poleCenters(pos, count, bottom, top, cell, ySpan);
  // The detected shaft is the core of the pole. The base and the finial flare
  // wider than that, and those verts were still waving. Grow the still radius
  // out to the base, and stop before it can swallow the cloth.
  const cap = Math.max(cell * 12, horiz * 0.2);
  for (const pole of poles) {
    let flare = 0;
    let hits = 0;
    const band = bottom.length ? bottom : top;
    for (const index of band) {
      const dist = Math.hypot(pos.getX(index) - pole.x, pos.getZ(index) - pole.z);
      if (dist > cell * 12) continue;
      hits++;
      if (dist > flare) flare = dist;
    }
    if (hits >= 3) pole.rad = Math.min(Math.max(pole.rad, flare * 1.25), cap);
  }
  const reach = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let best = Infinity;
    let rad = 0;
    for (const pole of poles) {
      const dist = Math.hypot(x - pole.x, z - pole.z);
      if (dist < best) {
        best = dist;
        rad = pole.rad;
      }
    }
    reach[i] = Math.max(0, best - rad);
  }
  freezeCrossbar(pos, count, reach, ySpan, cell);
  const existing = geometry.getAttribute("envReach");
  if (existing && existing.count === count) {
    (existing.array as Float32Array).set(reach);
    existing.needsUpdate = true;
  } else {
    geometry.setAttribute("envReach", new BufferAttribute(reach, 1));
  }
}

/** The stick the cloth hangs from. Vertices on it stay put. */
function freezeCrossbar(
  pos: { getX(i: number): number; getY(i: number): number; getZ(i: number): number; count: number },
  count: number,
  reach: Float32Array,
  ySpan: number,
  cell: number,
): void {
  const free: number[] = [];
  for (let i = 0; i < count; i++) {
    if (reach[i] > cell) free.push(i);
  }
  if (free.length < 6) return;
  let top = -Infinity;
  for (const index of free) {
    const y = pos.getY(index);
    if (y > top) top = y;
  }
  const bandH = Math.max(ySpan * 0.05, cell * 3);
  const band: number[] = [];
  for (const index of free) {
    if (pos.getY(index) >= top - bandH) band.push(index);
  }
  if (band.length < 4) return;
  let bx = 0;
  let by = 0;
  let bz = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const index of band) {
    const x = pos.getX(index);
    const y = pos.getY(index);
    const z = pos.getZ(index);
    bx += x;
    by += y;
    bz += z;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const n = band.length;
  bx /= n;
  by /= n;
  bz /= n;
  const alongX = xMax - xMin >= zMax - zMin;
  const radii: number[] = [];
  for (const index of band) {
    const dy = pos.getY(index) - by;
    const other = alongX ? pos.getZ(index) - bz : pos.getX(index) - bx;
    radii.push(Math.hypot(dy, other));
  }
  radii.sort((a, b) => a - b);
  const barR = Math.max(radii[Math.floor(radii.length * 0.75)]! * 1.25, cell);
  const yCut = top - barR * 3;
  for (let i = 0; i < count; i++) {
    if (reach[i] <= 0 || pos.getY(i) < yCut) continue;
    const dy = pos.getY(i) - by;
    const other = alongX ? pos.getZ(i) - bz : pos.getX(i) - bx;
    if (Math.hypot(dy, other) <= barR) reach[i] = 0;
  }
}

type Pole = { x: number; z: number; rad: number; n: number; span: number };

function poleCenters(
  pos: { getX(i: number): number; getY(i: number): number; getZ(i: number): number },
  count: number,
  bottom: number[],
  top: number[],
  cell: number,
  ySpan: number,
): Pole[] {
  const fromBottom = thinShafts(pos, count, bottom, cell, ySpan);
  const pool = fromBottom.length ? fromBottom : thinShafts(pos, count, top, cell, ySpan);
  if (!pool.length) return [{ x: 0, z: 0, rad: cell, n: 1, span: ySpan }];

  const bestN = Math.max(...pool.map((pole) => pole.n));
  const kept = pool.filter((pole) => pole.n >= bestN * 0.45);
  kept.sort((a, b) => b.span - a.span);
  const merged: Pole[] = [];
  for (const pole of kept) {
    const near = merged.find((other) => Math.hypot(other.x - pole.x, other.z - pole.z) < cell * 4);
    if (!near) merged.push(pole);
  }
  return merged.slice(0, 4);
}

function thinShafts(
  pos: { getX(i: number): number; getY(i: number): number; getZ(i: number): number },
  count: number,
  band: number[],
  cell: number,
  ySpan: number,
): Pole[] {
  const bins = new Map<string, number[]>();
  for (const index of band) {
    const key = Math.round(pos.getX(index) / cell) + "," + Math.round(pos.getZ(index) / cell);
    const list = bins.get(key);
    if (list) list.push(index);
    else bins.set(key, [index]);
  }
  const seeds = [...bins.values()].filter((list) => list.length >= 3);
  const used = new Set<number>();
  const clusters: Pole[] = [];
  for (let i = 0; i < seeds.length; i++) {
    if (used.has(i)) continue;
    const members: number[] = [];
    const ix = centroid(pos, seeds[i]);
    for (let j = i; j < seeds.length; j++) {
      const other = centroid(pos, seeds[j]);
      if (Math.hypot(other.x - ix.x, other.z - ix.z) <= cell * 3) {
        used.add(j);
        members.push(...seeds[j]);
      }
    }
    const center = centroid(pos, members);
    let rad = 0;
    for (const index of members) {
      rad = Math.max(rad, Math.hypot(pos.getX(index) - center.x, pos.getZ(index) - center.z));
    }
    const horizLimit = cell * 2.2;
    if (rad > horizLimit) continue;
    const shaft = Math.max(rad * 2.2, cell * 0.8);
    let y0 = Infinity;
    let y1 = -Infinity;
    let n = 0;
    for (let v = 0; v < count; v++) {
      if (Math.hypot(pos.getX(v) - center.x, pos.getZ(v) - center.z) > shaft) continue;
      n++;
      const y = pos.getY(v);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const span = y1 - y0;
    if (span < ySpan * 0.35) continue;
    clusters.push({ x: center.x, z: center.z, rad: shaft, n, span });
  }
  return clusters;
}

function centroid(
  pos: { getX(i: number): number; getZ(i: number): number },
  indices: number[],
): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const index of indices) {
    x += pos.getX(index);
    z += pos.getZ(index);
  }
  const n = Math.max(indices.length, 1);
  return { x: x / n, z: z / n };
}

/** Cloth vertex chunk. `envReach` is written by `attachClothReach`. */
export const CLOTH_WAVE = `#include <begin_vertex>
float envAmp = smoothstep(0.04, 0.16, envReach) * min(envReach, 2.0);
float envWave = sin(uEnvTime * 2.4 + position.y * 1.6 + envAmp * 2.0);
transformed.x += envWave * envAmp * 0.45;
transformed.z += cos(uEnvTime * 1.7 + position.y * 1.1) * envAmp * 0.2;`;
