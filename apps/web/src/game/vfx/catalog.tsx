import { ABILITIES, abilityEffectKind, COMBAT_FX_VARIANT_WALL_HIT } from "@battlebeasts/shared";
import type { MutableRefObject, ReactNode } from "react";
import { Room } from "colyseus.js";
import type { OneShotEffect } from "./types";
import { BoltCastEffect } from "./effects/boltCast";
import { BoltImpactEffect } from "./effects/boltImpact";
import { BoltProjectileEffect } from "./effects/boltProjectile";
import { CrescentCastEffect } from "./effects/crescentCast";
import { CrescentImpactEffect } from "./effects/crescentImpact";
import { SmashCrackEffect } from "./effects/smashCrack";
import { GustWaveEffect } from "./effects/gustWave";
import { FrostBallCastEffect } from "./effects/frostBallCast";
import { FireballCastEffect } from "./effects/fireballCast";
import { FireballBurnGroundEffect } from "./effects/fireballBurnGround";
import { BarrierCastEffect } from "./effects/barrierCast";
import { GraspProjectileEffect } from "./effects/graspProjectile";
import { ChainJumpProjectileEffect } from "./effects/chainJumpProjectile";
import { SpikesPopEffect } from "./effects/spikesPop";
import { FrostMistConeEffect } from "./effects/frostMistCone";
import { HealSwooshEffect } from "./effects/healSwoosh";
import { HealBeamEffect } from "./effects/healBeam";
import { LifeLeechEffect } from "./effects/lifeLeech";
import { PoisonDartCastEffect } from "./effects/poisonDartCast";
import { PoisonDartProjectileEffect } from "./effects/poisonDartProjectile";
import { IceLanceCastEffect } from "./effects/iceLanceCast";
import { IceLanceExplodeEffect } from "./effects/iceLanceExplode";
import { FirewallGroundEffect } from "./effects/firewallGround";
import { PoisonCloudGroundEffect } from "./effects/poisonCloudGround";
import { SmokeBombGroundEffect } from "./effects/smokeBombGround";
import { PortalBlinkEffect } from "./effects/portalBlink";
import { VolcanoRockEffect } from "./effects/volcanoRock";
import { BloodRushTrailEffect } from "./effects/bloodRushTrail";
import { SpiritReturnTrailEffect } from "./effects/spiritReturnTrail";
import { MagmaOrbsCastEffect } from "./effects/magmaOrbsCast";
import { ShroomBurstEffect } from "./effects/shroomBurst";
import { WallFizzleEffect } from "./effects/wallFizzle";
import {
  getAbilityVfxProfile,
  profileAoeCrackIds,
  profileBridgedAoeIds,
  profileCastAbilityIds,
  profileCatalogImpactIds,
  profileIceLanceExplodeIds,
  profileMeleeSwoopIds,
  profileOwnedByCastProjectileIds,
  profileProjectileCatalogIds,
} from "./profiles/registry";

export type ProjectileVfxId = "bolt" | "grasp" | "chainJump" | "poisonDart";
export type CastVfxId =
  | "bolt"
  | "crescent"
  | "frostBall"
  | "fireball"
  | "barrier"
  | "poisonDart"
  | "iceLance";
export type ImpactVfxId =
  | "bolt"
  | "crescent"
  | "smash"
  | "gust"
  | "spikes"
  | "frostMist"
  | "groove"
  | "healBeam"
  | "lifeLeech"
  | "poisonDart"
  | "firewall"
  | "portal"
  | "iceLance"
  | "volcano"
  | "bloodRush"
  | "spiritForm"
  | "magmaOrbs";

export type VfxFollowContext = {
  room: Room | null;
  localSessionId: string | null;
  /** Local predicted pose — smoother than schema for the local caster. */
  predictedRef?: MutableRefObject<{ x: number; z: number; yaw: number }>;
};

type ShotRenderer = (shot: OneShotEffect, ctx: VfxFollowContext) => ReactNode;

/** Abilities that use the catalog projectile mesh instead of the legacy sphere. */
export const CATALOG_PROJECTILES = new Set<string>(profileProjectileCatalogIds());

/** Abilities with dedicated cast one-shots (muzzle / swoop / hand charge). */
export const CATALOG_CAST_FX = new Set<string>([
  ...profileCastAbilityIds(),
  ...profileMeleeSwoopIds(),
]);

/** Abilities with dedicated hit impact one-shots (not landing AoE cracks). */
export const CATALOG_IMPACT_FX = new Set<string>(profileCatalogImpactIds());

/**
 * Melee abilities that spawn follow-caster swoops from combat_fx
 * instead of muzzle timing + ground burst rings.
 */
export const CATALOG_MELEE_SWOOP = new Set<string>(profileMeleeSwoopIds());

/** AoE abilities that replace the legacy expanding ground ring. */
export const CATALOG_AOE_CRACK = new Set<string>(profileAoeCrackIds());

/** AoE that skips legacy ring; VFX is owned by SpellVfxBridge (timed to anim). */
export const CATALOG_AOE_BRIDGED = new Set<string>(profileBridgedAoeIds());

/** Sticky-detonate frost blast (Ice Lance). */
export const CATALOG_ICE_LANCE_EXPLODE = new Set<string>(profileIceLanceExplodeIds());

/** Projectiles whose mesh is owned by the cast one-shot (not ProjectileRouter). */
export const OWNED_BY_CAST_PROJECTILES = new Set<string>(profileOwnedByCastProjectileIds());

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

export function usesSpikeFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "spikeWave";
}

export function usesFrostMistFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "coneChannel";
}

export function usesGrooveFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "pulseHeal";
}

export function usesHealBeamFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "healBeam";
}

export function usesLifeLeechFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "lifeLeech";
}

export function usesFirewallFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "firewall";
}

export function usesPoisonCloudFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "poisonCloud";
}

export function usesSmokeBombFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "smokeBomb";
}

export function usesVolcanoFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "volcano";
}

export function usesMagmaOrbsFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "magmaOrbs";
}

export function usesIceLanceExplodeFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_ICE_LANCE_EXPLODE.has(abilityId);
}

export function isOwnedByCastProjectile(abilityId: string | undefined): boolean {
  if (!abilityId) return false;
  return (
    OWNED_BY_CAST_PROJECTILES.has(abilityId) ||
    getAbilityVfxProfile(abilityId).projectile === "ownedByCast"
  );
}

const CAST_RENDERERS: Record<string, ShotRenderer> = {
  crescent: (shot, ctx) => <CrescentCastEffect key={shot.key} shot={shot} follow={ctx} />,
  frostBall: (shot, ctx) => <FrostBallCastEffect key={shot.key} shot={shot} follow={ctx} />,
  fireball: (shot, ctx) => <FireballCastEffect key={shot.key} shot={shot} follow={ctx} />,
  iceLance: (shot, ctx) => <IceLanceCastEffect key={shot.key} shot={shot} follow={ctx} />,
  barrier: (shot, ctx) => <BarrierCastEffect key={shot.key} shot={shot} follow={ctx} />,
  poisonDart: (shot, ctx) => <PoisonDartCastEffect key={shot.key} shot={shot} follow={ctx} />,
  bolt: (shot, ctx) => <BoltCastEffect key={shot.key} shot={shot} follow={ctx} />,
};

const IMPACT_RENDERERS: Record<string, ShotRenderer> = {
  crescent: (shot) => <CrescentImpactEffect key={shot.key} shot={shot} />,
  smash: (shot) => <SmashCrackEffect key={shot.key} shot={shot} />,
  gust: (shot, ctx) => <GustWaveEffect key={shot.key} shot={shot} follow={ctx} />,
  portal: (shot) => <PortalBlinkEffect key={shot.key} shot={shot} />,
  iceLance: (shot) => <IceLanceExplodeEffect key={shot.key} shot={shot} />,
  poisonDart: (shot) => <BoltImpactEffect key={shot.key} shot={shot} />,
  bolt: (shot) => <BoltImpactEffect key={shot.key} shot={shot} />,
  volcano: (shot) => <VolcanoRockEffect key={shot.key} shot={shot} />,
  bloodRush: (shot, ctx) => <BloodRushTrailEffect key={shot.key} shot={shot} follow={ctx} />,
  spiritForm: (shot, ctx) => <SpiritReturnTrailEffect key={shot.key} shot={shot} follow={ctx} />,
  magmaOrbs: (shot, ctx) => <MagmaOrbsCastEffect key={shot.key} shot={shot} follow={ctx} />,
  shrooms: (shot) => <ShroomBurstEffect key={shot.key} shot={shot} />,
  poisonCloud: (shot) => <PoisonCloudGroundEffect key={shot.key} shot={shot} />,
  smokeBomb: (shot) => <SmokeBombGroundEffect key={shot.key} shot={shot} />,
  fireball: (shot) => <FireballBurnGroundEffect key={shot.key} shot={shot} />,
};

function renderByEffectKind(shot: OneShotEffect, ctx: VfxFollowContext): ReactNode | null {
  if (usesSpikeFx(shot.abilityId)) {
    return <SpikesPopEffect key={shot.key} shot={shot} />;
  }
  if (usesFrostMistFx(shot.abilityId)) {
    return <FrostMistConeEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesHealBeamFx(shot.abilityId)) {
    return <HealBeamEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesLifeLeechFx(shot.abilityId)) {
    return <LifeLeechEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesFirewallFx(shot.abilityId)) {
    return <FirewallGroundEffect key={shot.key} shot={shot} />;
  }
  if (usesPoisonCloudFx(shot.abilityId)) {
    return <PoisonCloudGroundEffect key={shot.key} shot={shot} />;
  }
  if (usesSmokeBombFx(shot.abilityId)) {
    return <SmokeBombGroundEffect key={shot.key} shot={shot} />;
  }
  if (usesGrooveFx(shot.abilityId)) {
    return <HealSwooshEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  return null;
}

export function renderOneShot(shot: OneShotEffect, ctx: VfxFollowContext) {
  if (shot.kind === "cast") {
    if (usesMeleeSwoopFx(shot.abilityId)) {
      return CAST_RENDERERS.crescent!(shot, ctx);
    }
    const cast = CAST_RENDERERS[shot.abilityId];
    if (cast) return cast(shot, ctx);
    if (import.meta.env.DEV) {
      console.warn(`[vfx] missing cast renderer for abilityId=${shot.abilityId}; using bolt muzzle`);
    }
    return CAST_RENDERERS.bolt!(shot, ctx);
  }

  if (shot.variant === COMBAT_FX_VARIANT_WALL_HIT) {
    return <WallFizzleEffect key={shot.key} shot={shot} />;
  }

  const impact = IMPACT_RENDERERS[shot.abilityId];
  if (impact) return impact(shot, ctx);

  const byKind = renderByEffectKind(shot, ctx);
  if (byKind) return byKind;

  if (import.meta.env.DEV) {
    console.warn(`[vfx] missing impact renderer for abilityId=${shot.abilityId}; using bolt impact`);
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
  FrostBallCastEffect,
  BarrierCastEffect,
  GraspProjectileEffect,
  ChainJumpProjectileEffect,
  SpikesPopEffect,
  FrostMistConeEffect,
  HealSwooshEffect,
  HealBeamEffect,
  PoisonDartCastEffect,
  PoisonDartProjectileEffect,
  IceLanceCastEffect,
  IceLanceExplodeEffect,
  FirewallGroundEffect,
  PoisonCloudGroundEffect,
  PortalBlinkEffect,
  VolcanoRockEffect,
  BloodRushTrailEffect,
};
