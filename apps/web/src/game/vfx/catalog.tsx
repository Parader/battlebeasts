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
import { SilenceSweepEffect } from "./effects/silenceSweep";
import { HandShieldRetaliateEffect } from "./effects/handShieldRetaliate";
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
import { HolyGroundEffect } from "./effects/holyGround";
import { PortalBlinkEffect } from "./effects/portalBlink";
import { VolcanoRockEffect } from "./effects/volcanoRock";
import { BloodRushTrailEffect } from "./effects/bloodRushTrail";
import { SpiritReturnTrailEffect } from "./effects/spiritReturnTrail";
import { MagmaOrbsCastEffect } from "./effects/magmaOrbsCast";
import { ShroomBurstEffect } from "./effects/shroomBurst";
import { ArcThreadEffect } from "./effects/arcThread";
import { SoulMarkRuptureEffect } from "./effects/soulMarkRupture";
import { SoulMarkProjectileEffect } from "./effects/soulMarkProjectile";
import { VoidDiscProjectileEffect } from "./effects/voidDiscProjectile";
import { RunicShardProjectileEffect } from "./effects/runicShardProjectile";
import { RunicShardShatterEffect } from "./effects/runicShardShatter";
import { OrbitingWispHitEffect } from "./effects/orbitingWispHit";
import { AstralChainProjectileEffect } from "./effects/astralChainProjectile";
import { AstralChainBreakEffect } from "./effects/astralChainBreak";
import { UndergroundPulseEffect } from "./effects/undergroundPulse";
import {
  SlipstreamLaneEffect,
  SlipstreamTailwindEffect,
} from "./effects/slipstreamLane";
import {
  SoulRelaySelfHealEffect,
  SoulRelayProjectileEffect,
  SoulRelayTriggerEffect,
  SoulRelayOutOfRangeEffect,
} from "./effects/soulRelay";
import { CrushingSigilEffect } from "./effects/crushingSigil";
import { GravityWellEffect } from "./effects/gravityWell";
import { PrismLanceImpactEffect } from "./effects/prismLanceImpact";
import { SoulSeverHitEffect, SoulSeverSnapEffect } from "./effects/soulSeverSnap";
import { ArcBladeEffect, ArcBladeHitEffect, ArcBladeOuterPulseEffect } from "./effects/arcBlade";
import { BloomingPathBlossomEffect } from "./effects/bloomingPathBlossom";
import { BloomingPathTrailLingerEffect } from "./effects/bloomingPathTrailLinger";
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

export type ProjectileVfxId = "bolt" | "grasp" | "chainJump" | "poisonDart" | "soulMark" | "voidDisc" | "runicShard" | "astralChain";
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
  | "silenceSweep"
  | "handShield"
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

export function usesSilenceSweepFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "silenceSweep";
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

export function usesHolyGroundFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "holyGround";
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
  // Projectile mesh is the cast visual — don't fall back to bolt muzzle orb.
  soulMark: () => null,
  prismLance: () => null,
  soulSever: () => null,
  voidDisc: () => null,
  runicShard: () => null,
  astralChain: () => null,
  bloomingPath: () => null,
};

const IMPACT_RENDERERS: Record<string, ShotRenderer> = {
  crescent: (shot) => <CrescentImpactEffect key={shot.key} shot={shot} />,
  smash: (shot) => <SmashCrackEffect key={shot.key} shot={shot} />,
  gust: (shot, ctx) => <GustWaveEffect key={shot.key} shot={shot} follow={ctx} />,
  arcBlade: (shot, ctx) => {
    const v = shot.variant ?? 0;
    if (v === 2) return <ArcBladeOuterPulseEffect key={shot.key} shot={shot} />;
    // Bridged cast follows the owner; hit flashes are world-anchored.
    if (shot.followOwnerId) {
      return <ArcBladeEffect key={shot.key} shot={shot} follow={ctx} />;
    }
    return <ArcBladeHitEffect key={shot.key} shot={shot} />;
  },
  portal: (shot) => <PortalBlinkEffect key={shot.key} shot={shot} />,
  iceLance: (shot) => <IceLanceExplodeEffect key={shot.key} shot={shot} />,
  poisonDart: (shot) => <BoltImpactEffect key={shot.key} shot={shot} />,
  bolt: (shot) => <BoltImpactEffect key={shot.key} shot={shot} />,
  volcano: (shot) => <VolcanoRockEffect key={shot.key} shot={shot} />,
  bloodRush: (shot, ctx) => <BloodRushTrailEffect key={shot.key} shot={shot} follow={ctx} />,
  spiritForm: (shot, ctx) => <SpiritReturnTrailEffect key={shot.key} shot={shot} follow={ctx} />,
  magmaOrbs: (shot, ctx) => <MagmaOrbsCastEffect key={shot.key} shot={shot} follow={ctx} />,
  shrooms: (shot) => <ShroomBurstEffect key={shot.key} shot={shot} />,
  arcThread: (shot, ctx) => <ArcThreadEffect key={shot.key} shot={shot} follow={ctx} />,
  soulMark: (shot) => <SoulMarkRuptureEffect key={shot.key} shot={shot} />,
  runicShard: (shot) =>
    (shot.variant ?? 0) === 1 ? (
      <RunicShardShatterEffect key={shot.key} shot={shot} />
    ) : (
      <BoltImpactEffect key={shot.key} shot={shot} />
    ),
  orbitingWisp: (shot) => <OrbitingWispHitEffect key={shot.key} shot={shot} />,
  astralChain: (shot) => <AstralChainBreakEffect key={shot.key} shot={shot} />,
  undergroundPulse: (shot) => <UndergroundPulseEffect key={shot.key} shot={shot} />,
  slipstream: (shot) =>
    (shot.variant ?? 0) === 1 || (shot.variant ?? 0) === 2 ? (
      <SlipstreamTailwindEffect key={shot.key} shot={shot} />
    ) : (
      <SlipstreamLaneEffect key={shot.key} shot={shot} />
    ),
  soulRelay: (shot) => {
    const v = shot.variant ?? 0;
    if (v === 1) return <SoulRelayProjectileEffect key={shot.key} shot={shot} />;
    if (v === 2) return <SoulRelayTriggerEffect key={shot.key} shot={shot} />;
    if (v === 3) return <SoulRelayOutOfRangeEffect key={shot.key} shot={shot} />;
    return <SoulRelaySelfHealEffect key={shot.key} shot={shot} />;
  },
  crushingSigil: (shot) => <CrushingSigilEffect key={shot.key} shot={shot} />,
  gravityWell: (shot) => <GravityWellEffect key={shot.key} shot={shot} />,
  prismLance: (shot) => <PrismLanceImpactEffect key={shot.key} shot={shot} />,
  soulSever: (shot) =>
    (shot.variant ?? 0) === 1 ? (
      <SoulSeverSnapEffect key={shot.key} shot={shot} />
    ) : (
      <SoulSeverHitEffect key={shot.key} shot={shot} />
    ),
  bloomingPath: (shot) =>
    (shot.variant ?? 0) === 1 ? (
      <BloomingPathTrailLingerEffect key={shot.key} shot={shot} />
    ) : (
      <BloomingPathBlossomEffect key={shot.key} shot={shot} />
    ),
  poisonCloud: (shot) => <PoisonCloudGroundEffect key={shot.key} shot={shot} />,
  smokeBomb: (shot) => <SmokeBombGroundEffect key={shot.key} shot={shot} />,
  holyGround: (shot) => <HolyGroundEffect key={shot.key} shot={shot} />,
  fireball: (shot) => <FireballBurnGroundEffect key={shot.key} shot={shot} />,
  silenceSweep: (shot, ctx) => <SilenceSweepEffect key={shot.key} shot={shot} follow={ctx} />,
  handShield: (shot, ctx) => <HandShieldRetaliateEffect key={shot.key} shot={shot} follow={ctx} />,
};

function renderByEffectKind(shot: OneShotEffect, ctx: VfxFollowContext): ReactNode | null {
  if (usesSpikeFx(shot.abilityId)) {
    return <SpikesPopEffect key={shot.key} shot={shot} />;
  }
  if (usesFrostMistFx(shot.abilityId)) {
    return <FrostMistConeEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesSilenceSweepFx(shot.abilityId)) {
    return <SilenceSweepEffect key={shot.key} shot={shot} follow={ctx} />;
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
  if (usesHolyGroundFx(shot.abilityId)) {
    return <HolyGroundEffect key={shot.key} shot={shot} />;
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
    // Prefer no muzzle over a wrong bolt orb riding along catalog projectiles.
    if (import.meta.env.DEV) {
      console.warn(`[vfx] missing cast renderer for abilityId=${shot.abilityId}; skipping muzzle`);
    }
    return null;
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
  SilenceSweepEffect,
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
  ArcThreadEffect,
  SoulMarkProjectileEffect,
  SoulMarkRuptureEffect,
  VoidDiscProjectileEffect,
  RunicShardProjectileEffect,
  RunicShardShatterEffect,
  AstralChainProjectileEffect,
  AstralChainBreakEffect,
};
