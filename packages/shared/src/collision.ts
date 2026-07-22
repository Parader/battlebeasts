import { BASE_CITY_PORTALS, PRACTICE_DUMMY } from "./stands";
import { length2 } from "./sim";
import type { Vec2 } from "./protocol";

/** World collision radii (XZ plane circles). */
export const COLLISION = {
  playerRadius: 0.45,
  dummyRadius: 0.7,
  portalRadius: 1.05,
} as const;

export type CircleCollider = {
  id: string;
  x: number;
  z: number;
  radius: number;
};

export function baseCityStaticColliders(): CircleCollider[] {
  return [
    {
      id: "practice_dummy",
      x: PRACTICE_DUMMY.x,
      z: PRACTICE_DUMMY.z,
      radius: COLLISION.dummyRadius,
    },
    ...BASE_CITY_PORTALS.map((p) => ({
      id: p.id,
      x: p.x,
      z: p.z,
      radius: COLLISION.portalRadius,
    })),
  ];
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

/**
 * Resolve overlaps against static + dynamic circles.
 * Multiple iterations help when wedged between several colliders.
 */
export function resolveCollisions(
  pos: Vec2,
  radius: number,
  staticColliders: readonly CircleCollider[],
  dynamicColliders: readonly CircleCollider[] = [],
  iterations = 4,
): Vec2 {
  let p = { x: pos.x, z: pos.z };
  for (let i = 0; i < iterations; i++) {
    for (const c of staticColliders) {
      if (c.id === "self") continue;
      p = separateFromCircle(p, radius, c);
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
  staticColliders: readonly CircleCollider[],
  dynamicColliders: readonly CircleCollider[] = [],
): Vec2 {
  // Try full move; if blocked, try axis slides for less sticky feel
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
