import { length2 } from "./sim";
import type { Vec2 } from "./protocol";

/** World collision radii (XZ plane circles). */
export const COLLISION = {
  playerRadius: 0.45,
  /** Practice dummy cylinder (~0.5 visual radius). Not scaled with hub. */
  dummyRadius: 0.55,
} as const;

export type CircleCollider = {
  id: string;
  shape?: "circle";
  x: number;
  z: number;
  radius: number;
};

/** Oriented box on the XZ plane (yaw around Y). */
export type BoxCollider = {
  id: string;
  shape: "box";
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  yaw: number;
};

/**
 * Mesh footprint collider: world pose + local-space boundary segments
 * and an occupancy grid for "inside solid" push-out.
 * `segs` is flat [ax,az,bx,bz, ...]; mask is packed bits row-major.
 */
export type MeshCollider = {
  id: string;
  shape: "mesh";
  x: number;
  z: number;
  yaw: number;
  scale: number;
  /** Broadphase AABB center/half in local space (unscaled). */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  ox: number;
  oz: number;
  cell: number;
  cols: number;
  rows: number;
  /** Packed bit mask (Uint8Array), 1 = solid. */
  mask: Uint8Array;
  segs: Float32Array;
};

export type StaticCollider = CircleCollider | BoxCollider | MeshCollider;

/** Hub solids live in hubVillage (buildings / trees / rocks / stands). */
export { hubStaticColliders as baseCityStaticColliders } from "./hubVillage";

function isBox(c: StaticCollider): c is BoxCollider {
  return c.shape === "box";
}

function isMesh(c: StaticCollider): c is MeshCollider {
  return c.shape === "mesh";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Match Three.js `Object3D` with `rotation.y = yaw`:
 *   x' =  lx * cos + lz * sin
 *   z' = -lx * sin + lz * cos
 */
export function localToWorldXZ(
  originX: number,
  originZ: number,
  yaw: number,
  lx: number,
  lz: number,
): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: originX + lx * c + lz * s,
    z: originZ - lx * s + lz * c,
  };
}

/** Inverse of {@link localToWorldXZ}. */
export function worldToLocalXZ(
  originX: number,
  originZ: number,
  yaw: number,
  wx: number,
  wz: number,
): Vec2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = wx - originX;
  const dz = wz - originZ;
  return {
    x: dx * c - dz * s,
    z: dx * s + dz * c,
  };
}

/** Push `pos` (circle of `radius`) out of an overlapping obstacle. */
export function separateFromCircle(pos: Vec2, radius: number, obstacle: CircleCollider): Vec2 {
  const dx = pos.x - obstacle.x;
  const dz = pos.z - obstacle.z;
  const dist = length2(dx, dz);
  const minDist = radius + obstacle.radius;
  if (dist >= minDist) return pos;
  if (dist < 1e-8) {
    return { x: obstacle.x + minDist, z: obstacle.z };
  }
  const scale = minDist / dist;
  return { x: obstacle.x + dx * scale, z: obstacle.z + dz * scale };
}

export function separateFromBox(pos: Vec2, radius: number, box: BoxCollider): Vec2 {
  let { x: lx, z: lz } = worldToLocalXZ(box.x, box.z, box.yaw, pos.x, pos.z);

  const closestX = clamp(lx, -box.halfX, box.halfX);
  const closestZ = clamp(lz, -box.halfZ, box.halfZ);
  let ox = lx - closestX;
  let oz = lz - closestZ;
  const distSq = ox * ox + oz * oz;

  if (distSq < 1e-12) {
    const penX = box.halfX - Math.abs(lx);
    const penZ = box.halfZ - Math.abs(lz);
    if (penX < penZ) {
      lx = lx >= 0 ? box.halfX + radius : -box.halfX - radius;
    } else {
      lz = lz >= 0 ? box.halfZ + radius : -box.halfZ - radius;
    }
  } else {
    const dist = Math.sqrt(distSq);
    if (dist >= radius) return pos;
    const push = radius / dist;
    lx = closestX + ox * push;
    lz = closestZ + oz * push;
  }

  return localToWorldXZ(box.x, box.z, box.yaw, lx, lz);
}

function sampleSolid(mesh: MeshCollider, lx: number, lz: number): boolean {
  const sx = lx / mesh.scale;
  const sz = lz / mesh.scale;
  const col = Math.floor((sx - mesh.ox) / mesh.cell);
  const row = Math.floor((sz - mesh.oz) / mesh.cell);
  if (col < 0 || row < 0 || col >= mesh.cols || row >= mesh.rows) return false;
  const bit = row * mesh.cols + col;
  return (mesh.mask[bit >> 3]! & (1 << (bit & 7))) !== 0;
}

function pushFromSegment(
  lx: number,
  lz: number,
  radius: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { lx: number; lz: number; hit: boolean } {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = lx - ax;
  const apz = lz - az;
  const abLenSq = abx * abx + abz * abz;
  let t = abLenSq > 1e-12 ? (apx * abx + apz * abz) / abLenSq : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  let ox = lx - cx;
  let oz = lz - cz;
  const distSq = ox * ox + oz * oz;
  if (distSq >= radius * radius) return { lx, lz, hit: false };
  if (distSq < 1e-12) {
    // On the segment — push along segment normal (perpendicular)
    const len = Math.sqrt(abLenSq);
    if (len < 1e-8) return { lx: lx + radius, lz, hit: true };
    ox = -abz / len;
    oz = abx / len;
    return { lx: cx + ox * radius, lz: cz + oz * radius, hit: true };
  }
  const dist = Math.sqrt(distSq);
  const push = radius / dist;
  return { lx: cx + ox * push, lz: cz + oz * push, hit: true };
}

/**
 * Circle vs mesh footprint: collide against boundary segments; if the
 * center is inside the solid occupancy, eject to the nearest edge.
 */
export function separateFromMesh(pos: Vec2, radius: number, mesh: MeshCollider): Vec2 {
  let { x: lx, z: lz } = worldToLocalXZ(mesh.x, mesh.z, mesh.yaw, pos.x, pos.z);

  // Broadphase in local scaled space
  const scl = mesh.scale;
  const bbCx = mesh.cx * scl;
  const bbCz = mesh.cz * scl;
  const bbHx = mesh.hx * scl + radius;
  const bbHz = mesh.hz * scl + radius;
  if (Math.abs(lx - bbCx) > bbHx || Math.abs(lz - bbCz) > bbHz) {
    return pos;
  }

  let moved = false;
  const segs = mesh.segs;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i]! * scl;
    const az = segs[i + 1]! * scl;
    const bx = segs[i + 2]! * scl;
    const bz = segs[i + 3]! * scl;
    const r = pushFromSegment(lx, lz, radius, ax, az, bx, bz);
    if (r.hit) {
      lx = r.lx;
      lz = r.lz;
      moved = true;
    }
  }

  if (sampleSolid(mesh, lx, lz)) {
    // Inside solid — find nearest boundary point and sit just outside.
    let bestDist = Infinity;
    let nx = lx;
    let nz = lz;
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i]! * scl;
      const az = segs[i + 1]! * scl;
      const bx = segs[i + 2]! * scl;
      const bz = segs[i + 3]! * scl;
      const abx = bx - ax;
      const abz = bz - az;
      const apx = lx - ax;
      const apz = lz - az;
      const abLenSq = abx * abx + abz * abz;
      let t = abLenSq > 1e-12 ? (apx * abx + apz * abz) / abLenSq : 0;
      t = clamp(t, 0, 1);
      const qx = ax + abx * t;
      const qz = az + abz * t;
      const ox = lx - qx;
      const oz = lz - qz;
      const d = ox * ox + oz * oz;
      if (d >= bestDist) continue;
      bestDist = d;
      let dirX: number;
      let dirZ: number;
      if (d < 1e-12) {
        const len = Math.sqrt(abLenSq) || 1;
        dirX = -abz / len;
        dirZ = abx / len;
      } else {
        const dist = Math.sqrt(d);
        dirX = ox / dist;
        dirZ = oz / dist;
      }
      let candX = qx + dirX * radius;
      let candZ = qz + dirZ * radius;
      if (sampleSolid(mesh, candX, candZ)) {
        candX = qx - dirX * radius;
        candZ = qz - dirZ * radius;
      }
      nx = candX;
      nz = candZ;
    }
    if (Number.isFinite(bestDist)) {
      lx = nx;
      lz = nz;
      moved = true;
    }
  }

  if (!moved) return pos;
  return localToWorldXZ(mesh.x, mesh.z, mesh.yaw, lx, lz);
}

function separateFromStatic(pos: Vec2, radius: number, obstacle: StaticCollider): Vec2 {
  if (isMesh(obstacle)) return separateFromMesh(pos, radius, obstacle);
  if (isBox(obstacle)) return separateFromBox(pos, radius, obstacle);
  return separateFromCircle(pos, radius, obstacle);
}

/**
 * Resolve overlaps against static + dynamic colliders.
 * Multiple iterations help when wedged between several solids.
 */
export function resolveCollisions(
  pos: Vec2,
  radius: number,
  staticColliders: readonly StaticCollider[],
  dynamicColliders: readonly CircleCollider[] = [],
  iterations = 4,
): Vec2 {
  let p = { x: pos.x, z: pos.z };
  for (let i = 0; i < iterations; i++) {
    for (const c of staticColliders) {
      if (c.id === "self") continue;
      p = separateFromStatic(p, radius, c);
    }
    for (const c of dynamicColliders) {
      p = separateFromCircle(p, radius, c);
    }
  }
  return p;
}

/** Other players as solid circles (skip self / disconnected / dead). */
export function playerCollidersExcept(
  players: Iterable<[string, { x: number; z: number; disconnected?: boolean; hp?: number }]>,
  exceptId: string,
): CircleCollider[] {
  const out: CircleCollider[] = [];
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    if (p.disconnected) continue;
    if (typeof p.hp === "number" && p.hp <= 0) continue;
    out.push({
      id,
      x: p.x,
      z: p.z,
      radius: COLLISION.playerRadius,
    });
  }
  return out;
}

/** Move then collide — shared by server tick + client prediction. */
export function moveAndCollide(
  from: Vec2,
  desired: Vec2,
  radius: number,
  staticColliders: readonly StaticCollider[],
  dynamicColliders: readonly CircleCollider[] = [],
): Vec2 {
  const full = resolveCollisions(desired, radius, staticColliders, dynamicColliders);
  const blocked =
    length2(full.x - desired.x, full.z - desired.z) > 1e-4 &&
    length2(desired.x - from.x, desired.z - from.z) > 1e-4;

  if (!blocked) return full;

  const onlyX = resolveCollisions(
    { x: desired.x, z: from.z },
    radius,
    staticColliders,
    dynamicColliders,
  );
  const onlyZ = resolveCollisions(
    { x: from.x, z: desired.z },
    radius,
    staticColliders,
    dynamicColliders,
  );
  const dx = length2(onlyX.x - from.x, onlyX.z - from.z);
  const dz = length2(onlyZ.x - from.x, onlyZ.z - from.z);
  if (dx >= dz && dx > 1e-6) return onlyX;
  if (dz > 1e-6) return onlyZ;
  return resolveCollisions(from, radius, staticColliders, dynamicColliders);
}

/**
 * Sweep `from` → `to` in small steps so dashes can't teleport through solids.
 * Stops early when a step is mostly blocked.
 */
export function sweepMove(
  from: Vec2,
  to: Vec2,
  radius: number,
  staticColliders: readonly StaticCollider[],
  dynamicColliders: readonly CircleCollider[] = [],
  maxStep = 0.22,
): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = length2(dx, dz);
  if (dist < 1e-8) {
    return resolveCollisions(from, radius, staticColliders, dynamicColliders);
  }

  const steps = Math.max(1, Math.ceil(dist / maxStep));
  let p = { x: from.x, z: from.z };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const desired = { x: from.x + dx * t, z: from.z + dz * t };
    const next = moveAndCollide(p, desired, radius, staticColliders, dynamicColliders);
    const moved = length2(next.x - p.x, next.z - p.z);
    const want = length2(desired.x - p.x, desired.z - p.z);
    p = next;
    if (want > 1e-4 && moved < want * 0.2) break;
  }
  return p;
}

/** Decode base64 occupancy mask from bake JSON. */
export function decodeMeshMask(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
