import { ABILITIES, abilityEffectKind } from "@battlebeasts/shared";
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
import { FrostBallCastEffect } from "./effects/frostBallCast";
import { BarrierCastEffect } from "./effects/barrierCast";
import { GraspProjectileEffect } from "./effects/graspProjectile";
import { ChainJumpProjectileEffect } from "./effects/chainJumpProjectile";
import { SpikesPopEffect } from "./effects/spikesPop";
import { FrostMistConeEffect } from "./effects/frostMistCone";
import { HealSwooshEffect } from "./effects/healSwoosh";
import { HealBeamEffect } from "./effects/healBeam";
import { PoisonDartCastEffect } from "./effects/poisonDartCast";
import { PoisonDartProjectileEffect } from "./effects/poisonDartProjectile";
import { IceLanceCastEffect } from "./effects/iceLanceCast";
import { IceLanceExplodeEffect } from "./effects/iceLanceExplode";
import { FirewallGroundEffect } from "./effects/firewallGround";
import { PortalBlinkEffect } from "./effects/portalBlink";

export type ProjectileVfxId = "bolt" | "grasp" | "chainJump" | "poisonDart";
export type CastVfxId = "bolt" | "crescent" | "frostBall" | "barrier" | "poisonDart" | "iceLance";
export type ImpactVfxId =
  | "bolt"
  | "crescent"
  | "smash"
  | "gust"
  | "spikes"
  | "frostMist"
  | "groove"
  | "healBeam"
  | "poisonDart"
  | "firewall"
  | "portal"
  | "iceLance";

/** Abilities that use the catalog projectile mesh instead of the legacy sphere. */
export const CATALOG_PROJECTILES = new Set<string>(["bolt", "grasp", "chainJump", "poisonDart"]);

/** Abilities with dedicated cast one-shots (muzzle / swoop / hand charge). */
export const CATALOG_CAST_FX = new Set<string>([
  "bolt",
  "crescent",
  "frostBall",
  "barrier",
  "poisonDart",
  "iceLance",
]);

/** Abilities with dedicated hit impact one-shots (not landing AoE cracks). */
export const CATALOG_IMPACT_FX = new Set<string>(["bolt", "crescent", "poisonDart"]);

/**
 * Melee abilities that spawn follow-caster swoops from combat_fx
 * instead of muzzle timing + ground burst rings.
 */
export const CATALOG_MELEE_SWOOP = new Set<string>(["crescent"]);

/** AoE abilities that replace the legacy expanding ground ring. */
export const CATALOG_AOE_CRACK = new Set<string>(["smash"]);

/** AoE that skips legacy ring; VFX is owned by SpellVfxBridge (timed to anim). */
export const CATALOG_AOE_BRIDGED = new Set<string>(["gust"]);

/** Sticky-detonate frost blast (Ice Lance). */
export const CATALOG_ICE_LANCE_EXPLODE = new Set<string>(["iceLance"]);

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

export function usesFirewallFx(abilityId: string | undefined): boolean {
  return abilityEffectKind(abilityId ? ABILITIES[abilityId] : undefined) === "firewall";
}

export function usesIceLanceExplodeFx(abilityId: string | undefined): boolean {
  return !!abilityId && CATALOG_ICE_LANCE_EXPLODE.has(abilityId);
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
    if (shot.abilityId === "iceLance") {
      return <IceLanceCastEffect key={shot.key} shot={shot} follow={ctx} />;
    }
    if (shot.abilityId === "barrier") {
      return <BarrierCastEffect key={shot.key} shot={shot} follow={ctx} />;
    }
    if (shot.abilityId === "poisonDart") {
      return <PoisonDartCastEffect key={shot.key} shot={shot} follow={ctx} />;
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
  if (usesSpikeFx(shot.abilityId)) {
    return <SpikesPopEffect key={shot.key} shot={shot} />;
  }
  if (usesFrostMistFx(shot.abilityId)) {
    return <FrostMistConeEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesHealBeamFx(shot.abilityId)) {
    return <HealBeamEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesFirewallFx(shot.abilityId)) {
    return <FirewallGroundEffect key={shot.key} shot={shot} />;
  }
  if (shot.abilityId === "portal") {
    return <PortalBlinkEffect key={shot.key} shot={shot} />;
  }
  if (usesGrooveFx(shot.abilityId)) {
    return <HealSwooshEffect key={shot.key} shot={shot} follow={ctx} />;
  }
  if (usesIceLanceExplodeFx(shot.abilityId)) {
    return <IceLanceExplodeEffect key={shot.key} shot={shot} />;
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
  PortalBlinkEffect,
};
