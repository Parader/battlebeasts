import {
  baseCityStaticColliders,
  projectileBlockers,
  type BoxCollider,
  type CircleCollider,
  type StaticCollider,
  type WallCollider,
} from "@battlebeasts/shared";

/**
 * Latest static colliders used by local prediction — shared with caster-only
 * telegraphs (Portal landing marker) so aim previews stop at walls.
 */
let staticColliders: readonly StaticCollider[] = baseCityStaticColliders();

/**
 * Projectile-blocking subset, recomputed only when the world changes.
 *
 * Beam and cone effects ask for this every frame, and the map never changes
 * mid-frame, so filtering on each query would be pure waste.
 */
let blockers = projectileBlockers(staticColliders);

export function setWorldStaticColliders(colliders: readonly StaticCollider[]): void {
  staticColliders = colliders;
  blockers = projectileBlockers(colliders);
}

export function getWorldStaticColliders(): readonly StaticCollider[] {
  return staticColliders;
}

/**
 * Walls that stop projectiles.
 *
 * Effects must use this rather than filtering `getWorldStaticColliders`
 * themselves: solids flagged as low cover block movement but not shots, and a
 * telegraph that ignores the flag would stop short of where the ability
 * actually lands.
 */
export function getWorldProjectileWalls(): readonly WallCollider[] {
  return blockers.walls;
}

/** Solid circles (rocks, pillars) that stop projectiles. */
export function getWorldProjectileCircles(): readonly CircleCollider[] {
  return blockers.circles;
}

/** Oriented prop boxes that stop projectiles. */
export function getWorldProjectileBoxes(): readonly BoxCollider[] {
  return blockers.boxes;
}
