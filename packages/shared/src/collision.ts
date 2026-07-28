import { length2 } from "./sim";
import type { Vec2 } from "./protocol";

/** World collision radii (XZ plane circles). */
export const COLLISION = {
  playerRadius: 0.45,
  /** Practice dummy cylinder (~0.5 visual radius). Not scaled with hub. */
  dummyRadius: 0.55,
  /**
   * Extra separation so we don't micro-stick / jitter after push-out
   * (float error leaves a hair of overlap every frame).
   */
  skin: 0.02,
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

/** Thin walls from Blender Bezier curves — world XZ segments [ax,az,bx,bz,...]. */
export type WallCollider = {
  id: string;
  shape: "walls";
  segs: Float32Array;
};

export type StaticCollider = CircleCollider | BoxCollider | MeshCollider | WallCollider;

/** Hub solids live in hubVillage (buildings / trees / rocks / stands). */
export { hubStaticColliders as baseCityStaticColliders } from "./hubVillage";

function isBox(c: StaticCollider): c is BoxCollider {
  return c.shape === "box";
}

function isMesh(c: StaticCollider): c is MeshCollider {
  return c.shape === "mesh";
}

function isWalls(c: StaticCollider): c is WallCollider {
  return c.shape === "walls";
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
  const minDist = radius + obstacle.radius + COLLISION.skin;
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
      lx = lx >= 0 ? box.halfX + radius + COLLISION.skin : -box.halfX - radius - COLLISION.skin;
    } else {
      lz = lz >= 0 ? box.halfZ + radius + COLLISION.skin : -box.halfZ - radius - COLLISION.skin;
    }
  } else {
    const dist = Math.sqrt(distSq);
    if (dist >= radius) return pos;
    const push = (radius + COLLISION.skin) / dist;
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
  const sep = radius + COLLISION.skin;
  if (distSq >= sep * sep) return { lx, lz, hit: false };
  if (distSq < 1e-12) {
    // On the segment — push along segment normal (perpendicular)
    const len = Math.sqrt(abLenSq);
    if (len < 1e-8) return { lx: lx + sep, lz, hit: true };
    ox = -abz / len;
    oz = abx / len;
    return { lx: cx + ox * sep, lz: cz + oz * sep, hit: true };
  }
  const dist = Math.sqrt(distSq);
  const push = sep / dist;
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

/** Squared distance from point to segment AB on XZ. */
export function distPointToSegmentSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  let t = abLenSq > 1e-12 ? (apx * abx + apz * abz) / abLenSq : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

/** True if circle overlaps any segment of a wall polyline. */
export function circleHitsWall(x: number, z: number, radius: number, wall: WallCollider): boolean {
  const r2 = radius * radius;
  const segs = wall.segs;
  for (let i = 0; i < segs.length; i += 4) {
    if (distPointToSegmentSq(x, z, segs[i]!, segs[i + 1]!, segs[i + 2]!, segs[i + 3]!) <= r2) {
      return true;
    }
  }
  return false;
}

/** Segment-segment intersection (XZ), excluding near-parallel misses. */
function segmentsCross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const abx = bx - ax;
  const abz = bz - az;
  const cdx = dx - cx;
  const cdz = dz - cz;
  const acx = cx - ax;
  const acz = cz - az;
  const den = abx * cdz - abz * cdx;
  if (Math.abs(den) < 1e-12) return false;
  const t = (acx * cdz - acz * cdx) / den;
  const u = (acx * abz - acz * abx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Projectile blocked by world walls (not players/dummies).
 * Checks end position + sweep of the travel segment against wall polylines.
 */
export function projectileHitsWalls(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
  walls: readonly WallCollider[],
): boolean {
  for (const wall of walls) {
    if (circleHitsWall(toX, toZ, radius, wall)) return true;
    const segs = wall.segs;
    for (let i = 0; i < segs.length; i += 4) {
      if (
        segmentsCross(
          fromX,
          fromZ,
          toX,
          toZ,
          segs[i]!,
          segs[i + 1]!,
          segs[i + 2]!,
          segs[i + 3]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Soft dome that blocks inbound projectiles only (XZ circle). */
export type ProtectionBubbleCollider = {
  /** Stable zone id when available (for spawn-inside pass-through). */
  id?: string;
  x: number;
  z: number;
  radius: number;
};

/** True when a point sits inside (or on) the bubble disc, with optional pad. */
export function pointInProtectionBubble(
  x: number,
  z: number,
  bubble: ProtectionBubbleCollider,
  pad = 0,
): boolean {
  const R = Math.max(0.1, bubble.radius) + pad;
  const dx = x - bubble.x;
  const dz = z - bubble.z;
  return dx * dx + dz * dz <= R * R;
}

/**
 * True when a projectile segment crosses into a protection bubble from outside.
 * Projectiles that start inside may leave freely.
 */
export function projectileEntersProtectionBubble(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  projRadius: number,
  bubble: ProtectionBubbleCollider,
): boolean {
  const R = Math.max(0.1, bubble.radius) + Math.max(0, projRadius);
  const R2 = R * R;
  const fdx = fromX - bubble.x;
  const fdz = fromZ - bubble.z;
  const fromD2 = fdx * fdx + fdz * fdz;
  // Started inside / on shell — outbound and interior travel allowed.
  if (fromD2 <= R2) return false;

  const tdx = toX - bubble.x;
  const tdz = toZ - bubble.z;
  const toD2 = tdx * tdx + tdz * tdz;
  if (toD2 <= R2) return true;

  // Both outside — block chords that cut through the disc (fast projectiles).
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-10) return false;
  const t = Math.max(0, Math.min(1, (-fdx * dx - fdz * dz) / len2));
  const cx = fromX + dx * t - bubble.x;
  const cz = fromZ + dz * t - bubble.z;
  return cx * cx + cz * cz <= R2;
}

export function projectileHitsProtectionBubbles(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  projRadius: number,
  bubbles: readonly ProtectionBubbleCollider[],
  /** Bubble ids that this projectile may freely leave / re-curve through. */
  passBubbleIds?: ReadonlySet<string>,
): boolean {
  for (const b of bubbles) {
    if (b.id && passBubbleIds?.has(b.id)) continue;
    if (projectileEntersProtectionBubble(fromX, fromZ, toX, toZ, projRadius, b)) {
      return true;
    }
  }
  return false;
}

function circleHitsAnyWall(
  x: number,
  z: number,
  radius: number,
  walls: readonly WallCollider[],
): boolean {
  for (const wall of walls) {
    if (circleHitsWall(x, z, radius, wall)) return true;
  }
  return false;
}

/**
 * Last free progress t∈[0,1] along from→to before a wall blocks the circle.
 * Thin walls can be skipped by push-out (flip to far side); this ray test stops that.
 * Returns null when the full segment is clear.
 */
export function lastFreeTBeforeWalls(
  from: Vec2,
  to: Vec2,
  radius: number,
  walls: readonly WallCollider[],
): number | null {
  if (!walls.length) return null;
  if (circleHitsAnyWall(from.x, from.z, radius, walls)) return 0;
  if (!projectileHitsWalls(from.x, from.z, to.x, to.z, radius, walls)) return null;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) * 0.5;
    const mx = from.x + (to.x - from.x) * mid;
    const mz = from.z + (to.z - from.z) * mid;
    if (projectileHitsWalls(from.x, from.z, mx, mz, radius, walls)) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** Clamp a desired end pose so the path does not cross / embed in walls. */
export function clampTargetBeforeWalls(
  from: Vec2,
  to: Vec2,
  radius: number,
  walls: readonly WallCollider[],
): Vec2 {
  const t = lastFreeTBeforeWalls(from, to, radius, walls);
  if (t == null) return to;
  if (t <= 1e-8) return { x: from.x, z: from.z };
  return {
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/** Circle vs world-space wall polylines (Blender CollisionWalls curves). */
export function separateFromWalls(pos: Vec2, radius: number, wall: WallCollider): Vec2 {
  let lx = pos.x;
  let lz = pos.z;
  let moved = false;
  const segs = wall.segs;
  for (let i = 0; i < segs.length; i += 4) {
    const r = pushFromSegment(lx, lz, radius, segs[i]!, segs[i + 1]!, segs[i + 2]!, segs[i + 3]!);
    if (r.hit) {
      lx = r.lx;
      lz = r.lz;
      moved = true;
    }
  }
  if (!moved) return pos;
  return { x: lx, z: lz };
}

function separateFromStatic(pos: Vec2, radius: number, obstacle: StaticCollider): Vec2 {
  if (isMesh(obstacle)) return separateFromMesh(pos, radius, obstacle);
  if (isWalls(obstacle)) return separateFromWalls(pos, radius, obstacle);
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

/** Other players as solid circles (skip self / same account / disconnected / dead). */
export function playerCollidersExcept(
  players: Iterable<
    [string, { x: number; z: number; disconnected?: boolean; hp?: number; id?: string }]
  >,
  exceptId: string,
  /** Account id (`player.id`) — drops match-return ghost seats for the same hunter. */
  exceptUserId?: string | null,
): CircleCollider[] {
  const out: CircleCollider[] = [];
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    if (exceptUserId && p.id && p.id === exceptUserId) continue;
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

/** Practice dummies / world targets as live pose circles (opt-in; not used for hub walk). */
export function targetColliders(
  targets: Iterable<[string, { x: number; z: number; hp?: number }]>,
): CircleCollider[] {
  const out: CircleCollider[] = [];
  for (const [id, t] of targets) {
    if (typeof t.hp === "number" && t.hp <= 0) continue;
    out.push({
      id,
      x: t.x,
      z: t.z,
      radius: COLLISION.dummyRadius,
    });
  }
  return out;
}

/** Players (except self / same account) + optional living targets for walk collision. */
export function unitCollidersExcept(
  players: Iterable<
    [string, { x: number; z: number; disconnected?: boolean; hp?: number; id?: string }]
  >,
  targets: Iterable<[string, { x: number; z: number; hp?: number }]> | null | undefined,
  exceptPlayerId: string,
  exceptUserId?: string | null,
): CircleCollider[] {
  const out = playerCollidersExcept(players, exceptPlayerId, exceptUserId);
  if (targets) out.push(...targetColliders(targets));
  return out;
}

/** Active volcano bodies — walk-block only (dashes still pass). */
export function volcanoColliders(
  volcanoes: Iterable<
    [string, { x: number; z: number; radius?: number; phase?: string }]
  >,
): CircleCollider[] {
  const out: CircleCollider[] = [];
  for (const [id, v] of volcanoes) {
    if (v.phase === "sinking") continue;
    out.push({
      id: `volcano_${id}`,
      shape: "circle",
      x: v.x,
      z: v.z,
      radius: Math.max(0.4, v.radius ?? 1.35),
    });
  }
  return out;
}

/** Unit / dummy bodies — dashes pass through these; walking does not. */
export function isUnitObstacle(c: { id: string; shape?: string }): boolean {
  if (c.id.startsWith("practice_dummy")) return true;
  return false;
}

/**
 * World solids that block forced travel (dash / charge / blink).
 * Excludes unit circles so movement abilities go through enemies.
 */
export function collidersBlockingTravel(
  staticColliders: readonly StaticCollider[],
): StaticCollider[] {
  return staticColliders.filter((c) => !isUnitObstacle(c));
}

/**
 * Sweep for dashes / charges: blocked by walls & world props, passes through units.
 */
export function sweepTravel(
  from: Vec2,
  to: Vec2,
  radius: number,
  staticColliders: readonly StaticCollider[],
  maxStep = 0.22,
): Vec2 {
  return sweepMove(from, to, radius, collidersBlockingTravel(staticColliders), [], maxStep);
}

/** Move then collide with wall-slide — shared by server tick + client prediction. */
export function moveAndCollide(
  from: Vec2,
  desired: Vec2,
  radius: number,
  staticColliders: readonly StaticCollider[],
  dynamicColliders: readonly CircleCollider[] = [],
): Vec2 {
  const want = length2(desired.x - from.x, desired.z - from.z);
  if (want < 1e-8) {
    return resolveCollisions(from, radius, staticColliders, dynamicColliders);
  }

  const full = resolveCollisions(desired, radius, staticColliders, dynamicColliders);
  const blocked = length2(full.x - desired.x, full.z - desired.z) > 1e-4;
  if (!blocked) return full;

  // Axis slides — strong for axis-aligned props.
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

  // Tangent slide along the push-out normal (diagonal walls / Bezier segs).
  let slide: Vec2 | null = null;
  const pushX = full.x - desired.x;
  const pushZ = full.z - desired.z;
  const pushLen = length2(pushX, pushZ);
  if (pushLen > 1e-6) {
    const nx = pushX / pushLen;
    const nz = pushZ / pushLen;
    const vx = desired.x - from.x;
    const vz = desired.z - from.z;
    const into = vx * nx + vz * nz;
    const sx = vx - nx * Math.max(0, into);
    const sz = vz - nz * Math.max(0, into);
    if (length2(sx, sz) > 1e-6) {
      slide = resolveCollisions(
        { x: from.x + sx, z: from.z + sz },
        radius,
        staticColliders,
        dynamicColliders,
      );
    }
  }

  // Prefer the candidate that travels farthest (keeps locomotion fluid along walls).
  let best = full;
  let bestDist = length2(full.x - from.x, full.z - from.z);
  for (const c of [onlyX, onlyZ, slide]) {
    if (!c) continue;
    const d = length2(c.x - from.x, c.z - from.z);
    if (d > bestDist + 1e-6) {
      best = c;
      bestDist = d;
    }
  }
  if (bestDist > 1e-6) return best;
  return resolveCollisions(from, radius, staticColliders, dynamicColliders);
}

/**
 * Sweep `from` → `to` in small steps so dashes can't teleport through solids.
 * Walls are hard-clamped along the ray first (thin polylines flip push-out otherwise).
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
  const walls = staticColliders.filter(isWalls);
  const target = clampTargetBeforeWalls(from, to, radius, walls);

  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const dist = length2(dx, dz);
  if (dist < 1e-8) {
    return resolveCollisions(from, radius, staticColliders, dynamicColliders);
  }

  const steps = Math.max(1, Math.ceil(dist / maxStep));
  let p = { x: from.x, z: from.z };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const desired = { x: from.x + dx * t, z: from.z + dz * t };
    // Re-check walls each step so sliding around other solids can't re-enter a wall cut.
    if (walls.length && projectileHitsWalls(p.x, p.z, desired.x, desired.z, radius, walls)) {
      break;
    }
    const next = moveAndCollide(p, desired, radius, staticColliders, dynamicColliders);
    const moved = length2(next.x - p.x, next.z - p.z);
    const want = length2(desired.x - p.x, desired.z - p.z);
    // Reject wall flip-through: push landed on the far side of a thin wall.
    if (
      walls.length &&
      moved > 1e-4 &&
      projectileHitsWalls(p.x, p.z, next.x, next.z, radius, walls)
    ) {
      break;
    }
    p = next;
    // Only abort when effectively stuck — allow partial slides along walls.
    if (want > 1e-4 && moved < 1e-5) break;
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
