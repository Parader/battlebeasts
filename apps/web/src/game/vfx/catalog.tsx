import type { MutableRefObject } from "react";
import { Room } from "colyseus.js";
import type { OneShotEffect } from "./types";
import { BoltCastEffect } from "./effects/boltCast";
import { BoltImpactEffect } from "./effects/boltImpact";
import { BoltProjectileEffect } from "./effects/boltProjectile";
import { CrescentCastEffect } from "./effects/crescentCast";
import { CrescentImpactEffect } from "./effects/crescentImpact";
import { SmashCrackEffect } from "./effects/smashCrack";
import { GustWaveEffect } from "./effects/gustWave";
import { FrostBallProjectileEffect } from "./effects/frostBallProjectile";
import { FrostBallCastEffect } from "./effects/frostBallCast";

export type ProjectileVfxId = "bolt" | "frostBall";
export type CastVfxId = "bolt" | "crescent" | "frostBall";
export type ImpactVfxId = "bolt" | "crescent" | "smash" | "gust";

/** Abilities that use the catalog projectile mesh instead of the legacy sphere. */
export const CATALOG_PROJECTILES = new Set<string>(["bolt", "frostBall"]);

/** Abilities with dedicated cast one-shots (muzzle / swoop / hand charge). */
export const CATALOG_CAST_FX = new Set<string>(["bolt", "crescent", "frostBall"]);

/** Abilities with dedicated hit impact one-shots (not landing AoE cracks). */
export const CATALOG_IMPACT_FX = new Set<string>(["bolt", "crescent"]);

/**
 * Melee abilities that spawn follow-caster swoops from combat_fx
 * instead of muzzle timing + ground burst rings.
 */
export const CATALOG_MELEE_SWOOP = new Set<string>(["crescent"]);

/** AoE abilities that replace the legacy expanding ground ring. */
export const CATALOG_AOE_CRACK = new Set<string>(["smash"]);

/** AoE that skips legacy ring; VFX is owned by SpellVfxBridge (timed to anim). */
export const CATALOG_AOE_BRIDGED = new Set<string>(["gust"]);

export function hasCatalogProjectile(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_PROJECTILES.has(abilityId);
}

export function hasCatalogCastFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_CAST_FX.has(abilityId);
}

export function hasCatalogImpactFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_IMPACT_FX.has(abilityId);
}

export function usesMeleeSwoopFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_MELEE_SWOOP.has(abilityId);
}

export function usesAoeCrackFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_AOE_CRACK.has(abilityId);
}

export function usesBridgedAoeFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_AOE_BRIDGED.has(abilityId);
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
    if (shot.abilityId === "frostBall") {
      return <FrostBallCastEffect key={shot.key} shot={shot} follow={ctx} />;
    }
    return <BoltCastEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (shot.abilityId === "crescent") {
    return <CrescentImpactEffect key={shot.key} shot={shot} />;
  }
  if (shot.abilityId === "smash") {
    return <SmashCrackEffect key={shot.key} shot={shot} />;
  }
  if (shot.abilityId === "gust") {
    return <GustWaveEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  return <BoltImpactEffect key={shot.key} shot={shot} />;
}

export {
  BoltProjectileEffect,
  BoltCastEffect,
  BoltImpactEffect,
  CrescentCastEffect,
  CrescentImpactEffect,
  SmashCrackEffect,
  GustWaveEffect,
  FrostBallProjectileEffect,
  FrostBallCastEffect,
};
