import type { MutableRefObject } from "react";
import { Room } from "colyseus.js";
import type { OneShotEffect } from "./types";
import { BoltCastEffect } from "./effects/boltCast";
import { BoltImpactEffect } from "./effects/boltImpact";
import { BoltProjectileEffect } from "./effects/boltProjectile";

export type ProjectileVfxId = "bolt";

/** Abilities that use the catalog projectile mesh instead of the legacy sphere. */
export const CATALOG_PROJECTILES = new Set<string>(["bolt"]);

export function hasCatalogProjectile(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_PROJECTILES.has(abilityId);
}

export type VfxFollowContext = {
  room: Room | null;
  localSessionId: string | null;
  /** Local predicted pose — smoother than schema for the local caster. */
  predictedRef?: MutableRefObject<{ x: number; z: number; yaw: number }>;
};

export function renderOneShot(shot: OneShotEffect, ctx: VfxFollowContext) {
  if (shot.kind === "cast") {
    return <BoltCastEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  return <BoltImpactEffect key={shot.key} shot={shot} />;
}

export { BoltProjectileEffect, BoltCastEffect, BoltImpactEffect };
