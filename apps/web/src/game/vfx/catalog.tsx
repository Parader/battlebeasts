import type { MutableRefObject } from "react";
import { Room } from "colyseus.js";
import type { OneShotEffect } from "./types";
import { BoltCastEffect } from "./effects/boltCast";
import { BoltImpactEffect } from "./effects/boltImpact";
import { BoltProjectileEffect } from "./effects/boltProjectile";
import { CrescentCastEffect } from "./effects/crescentCast";

export type ProjectileVfxId = "bolt";
export type CastVfxId = "bolt" | "crescent";

/** Abilities that use the catalog projectile mesh instead of the legacy sphere. */
export const CATALOG_PROJECTILES = new Set<string>(["bolt"]);

/** Abilities with dedicated cast one-shots (muzzle / swoop). */
export const CATALOG_CAST_FX = new Set<string>(["bolt", "crescent"]);

/**
 * Melee abilities that spawn follow-caster swoops from combat_fx
 * instead of muzzle timing + ground burst rings.
 */
export const CATALOG_MELEE_SWOOP = new Set<string>(["crescent"]);

export function hasCatalogProjectile(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_PROJECTILES.has(abilityId);
}

export function hasCatalogCastFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_CAST_FX.has(abilityId);
}

export function usesMeleeSwoopFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_MELEE_SWOOP.has(abilityId);
}

export type VfxFollowContext = {
  room: Room | null;
  localSessionId: string | null;
  /** Local predicted pose — smoother than schema for the local caster. */
  predictedRef?: MutableRefObject<{ x: number; z: number; yaw: number }>;
};

export function renderOneShot(shot: OneShotEffect, ctx: VfxFollowContext) {
  if (shot.kind === "cast") {
    if (usesMeleeSwoopFx(shot.abilityId)) {
      return <CrescentCastEffect key={shot.key} shot={shot} follow={ctx} />;
    }
    return <BoltCastEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  return <BoltImpactEffect key={shot.key} shot={shot} />;
}

export { BoltProjectileEffect, BoltCastEffect, BoltImpactEffect, CrescentCastEffect };
