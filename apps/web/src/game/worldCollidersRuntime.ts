import {
  baseCityStaticColliders,
  type StaticCollider,
} from "@battlebeasts/shared";

/**
 * Latest static colliders used by local prediction — shared with caster-only
 * telegraphs (Portal landing marker) so aim previews stop at walls.
 */
let staticColliders: readonly StaticCollider[] = baseCityStaticColliders();

export function setWorldStaticColliders(colliders: readonly StaticCollider[]): void {
  staticColliders = colliders;
}

export function getWorldStaticColliders(): readonly StaticCollider[] {
  return staticColliders;
}
