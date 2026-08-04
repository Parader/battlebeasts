import {
  BARRIER_CAST,
  BOLT_CAST,
  FROST_BALL_CAST,
  FIREBALL_CAST,
  fireballChargeWindowWallMs,
  FROST_MIST_CAST,
  GROOVE_CAST,
  HEAL_BEAM_CAST,
  LIFE_LEECH_CAST,
  ICE_LANCE_CAST,
  POISON_DART_CAST,
} from "@battlebeasts/shared";
import type { AbilityVfxProfile } from "./types";
import {
  BARRIER_CHARGE_PAD_MS,
  BARRIER_DISSOLVE_MS,
  BRIDGED_AOE_LIFE_PAD_MS,
  CHARGE_PAD_MS,
  DETONATE_COAST_MS,
  FLIGHT_COAST_MS,
  MUZZLE_LEAD_MS,
} from "../timing";

const MUZZLE_BOLT: AbilityVfxProfile = {
  castEngine: "muzzleLead",
  muzzleLead: {
    forward: BOLT_CAST.spawnOffset,
    handY: BOLT_CAST.handY,
    leadMs: MUZZLE_LEAD_MS,
  },
  projectile: "catalog",
  combatFx: { onHit: "sfxOnly", skipLegacyBurst: false },
};

const MUZZLE_POISON: AbilityVfxProfile = {
  castEngine: "muzzleLead",
  muzzleLead: {
    forward: POISON_DART_CAST.spawnOffset,
    handY: POISON_DART_CAST.handY,
    leadMs: 0,
  },
  projectile: "catalog",
  combatFx: {
    onHit: "catalogImpact",
    hitY: 0.7,
    skipLegacyBurst: false,
  },
};

const CHARGE_FROST: AbilityVfxProfile = {
  castEngine: "chargeHand",
  chargeHand: {
    forward: FROST_BALL_CAST.spawnOffset,
    handY: FROST_BALL_CAST.handY,
    chargePadMs: CHARGE_PAD_MS,
    fallbackChargeMs: 520,
    fallbackRange: 12.5,
    fallbackSpeed: 3.5,
    fallbackFlightMs: 3600,
    flightCoastMs: FLIGHT_COAST_MS,
  },
  projectile: "ownedByCast",
};

const CHARGE_FIREBALL: AbilityVfxProfile = {
  castEngine: "chargeHand",
  chargeHand: {
    forward: FIREBALL_CAST.spawnOffset,
    handY: FIREBALL_CAST.handY,
    chargePadMs: 80,
    fallbackChargeMs: fireballChargeWindowWallMs(),
    fallbackRange: FIREBALL_CAST.range,
    fallbackSpeed: FIREBALL_CAST.speed,
    fallbackFlightMs: 6500,
    flightCoastMs: FLIGHT_COAST_MS,
    includeDetonateFuse: true,
  },
  projectile: "ownedByCast",
  combatFx: {
    onAoe: "fireballBurn",
    skipLegacyBurst: true,
  },
};

const CHARGE_ICE_LANCE: AbilityVfxProfile = {
  castEngine: "chargeHand",
  chargeHand: {
    forward: ICE_LANCE_CAST.spawnOffset,
    handY: ICE_LANCE_CAST.handY,
    chargePadMs: CHARGE_PAD_MS,
    fallbackChargeMs: 2200,
    fallbackRange: 14,
    fallbackSpeed: 28,
    fallbackFlightMs: 500,
    flightCoastMs: DETONATE_COAST_MS,
    includeDetonateFuse: true,
  },
  projectile: "ownedByCast",
  combatFx: {
    onAoe: "iceLanceExplode",
    skipLegacyBurst: true,
  },
};

const CHARGE_BARRIER: AbilityVfxProfile = {
  castEngine: "chargeHand",
  chargeHand: {
    forward: 0,
    handY: 0,
    chargePadMs: BARRIER_CHARGE_PAD_MS,
    fallbackChargeMs: 800,
    shieldHoldMs: BARRIER_CAST.shieldDurationMs + 200,
    dissolveMs: BARRIER_DISSOLVE_MS,
    cancelFollowOnStart: true,
  },
  projectile: "none",
};

const BRIDGED_GUST: AbilityVfxProfile = {
  castEngine: "bridgedAoe",
  bridgedAoe: { lifePadMs: BRIDGED_AOE_LIFE_PAD_MS, y: 0.04 },
  projectile: "none",
  combatFx: { onAoe: "none", skipLegacyBurst: true },
};

const CRESCENT: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: {
    onHit: "catalogImpact",
    hitY: 1.05,
    skipLegacyBurst: true,
  },
};

const SMASH: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "groundCrack", skipLegacyBurst: true },
};

const SPIKES: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "spikes", skipLegacyBurst: true },
};

const FIREWALL: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "firewall", skipLegacyBurst: true },
};

const POISON_CLOUD: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "poisonCloud", skipLegacyBurst: true },
};

const SMOKE_BOMB: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "smokeBomb", skipLegacyBurst: true },
};

const HOLY_GROUND: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "holyGround", skipLegacyBurst: true },
};

const VOLCANO: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "volcano", skipLegacyBurst: true },
};

const PROTECTION_BUBBLE: AbilityVfxProfile = {
  // Schema mesh (ProtectionBubbles) owns the dome; cast fx is optional noop.
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { skipLegacyBurst: true },
};

const SHROOMS: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { skipLegacyBurst: true },
};

const RIFT_FISSURE: AbilityVfxProfile = {
  // Schema mesh (RiftPortals) owns the mouths; travel uses combat_fx portal.
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { skipLegacyBurst: true },
};

const MAGMA_ORBS: AbilityVfxProfile = {
  castEngine: "bridgedAoe",
  bridgedAoe: {
    // Cover rise + flight + shatter past recovery cancel.
    lifePadMs: 700,
    y: 0.04,
  },
  projectile: "none",
  combatFx: { skipLegacyBurst: true },
};

const FROST_MIST: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "channelOnce", skipLegacyBurst: true },
};

const SILENCE_SWEEP: AbilityVfxProfile = {
  /** Start with the punch windup so the swoop leads impact (not waiting on aoe FX). */
  castEngine: "bridgedAoe",
  bridgedAoe: { lifePadMs: 240, y: 0.04 },
  projectile: "none",
  combatFx: { skipLegacyBurst: true },
};

const GROOVE: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "groove", skipLegacyBurst: true },
};

const HEAL_BEAM: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "healBeam", skipLegacyBurst: true },
};

const LIFE_LEECH: AbilityVfxProfile = {
  castEngine: "combatFxOnly",
  projectile: "none",
  combatFx: { onAoe: "lifeLeech", skipLegacyBurst: true },
};

const GRASP: AbilityVfxProfile = {
  castEngine: "none",
  projectile: "catalog",
};

const CHAIN_JUMP: AbilityVfxProfile = {
  castEngine: "none",
  projectile: "catalog",
};

const PORTAL: AbilityVfxProfile = {
  castEngine: "none",
  projectile: "none",
};

/** Explicit profiles — unknown abilities fall back via getAbilityVfxProfile. */
const PROFILES: Record<string, AbilityVfxProfile> = {
  bolt: {
    ...MUZZLE_BOLT,
    combatFx: {
      onHit: "catalogImpact",
      hitY: 0.7,
      skipLegacyBurst: false,
    },
  },
  poisonDart: MUZZLE_POISON,
  frostBall: CHARGE_FROST,
  fireball: CHARGE_FIREBALL,
  iceLance: CHARGE_ICE_LANCE,
  barrier: CHARGE_BARRIER,
  gust: BRIDGED_GUST,
  crescent: CRESCENT,
  smash: SMASH,
  spikes: SPIKES,
  firewall: FIREWALL,
  poisonCloud: POISON_CLOUD,
  smokeBomb: SMOKE_BOMB,
  holyGround: HOLY_GROUND,
  volcano: VOLCANO,
  protectionBubble: PROTECTION_BUBBLE,
  shrooms: SHROOMS,
  riftFissure: RIFT_FISSURE,
  magmaOrbs: MAGMA_ORBS,
  bloodRush: {
    castEngine: "none",
    projectile: "none",
    // Trail spawns from dash combat_fx; pass-through hits use the tiny legacy ring only.
    combatFx: { onHit: "sfxOnly", skipLegacyBurst: true },
  },
  frostMist: FROST_MIST,
  silenceSweep: SILENCE_SWEEP,
  groove: GROOVE,
  healBeam: HEAL_BEAM,
  lifeLeech: LIFE_LEECH,
  grasp: GRASP,
  chainJump: CHAIN_JUMP,
  portal: PORTAL,
  spiritForm: {
    castEngine: "none",
    projectile: "none",
    combatFx: { skipLegacyBurst: true },
  },
};

const DEFAULT_PROFILE: AbilityVfxProfile = {
  castEngine: "none",
  projectile: "none",
};

export function getAbilityVfxProfile(abilityId: string | undefined): AbilityVfxProfile {
  if (!abilityId) return DEFAULT_PROFILE;
  return PROFILES[abilityId] ?? DEFAULT_PROFILE;
}

export function hasCastEngine(abilityId: string | undefined): boolean {
  const engine = getAbilityVfxProfile(abilityId).castEngine;
  return engine !== "none" && engine !== "combatFxOnly";
}

/** Abilities with SpellVfxBridge cast one-shots (muzzle / hand charge). */
export function profileCastAbilityIds(): string[] {
  return Object.keys(PROFILES).filter((id) => {
    const e = PROFILES[id]!.castEngine;
    return e === "muzzleLead" || e === "chargeHand";
  });
}

export function profileProjectileCatalogIds(): string[] {
  return Object.keys(PROFILES).filter((id) => PROFILES[id]!.projectile === "catalog");
}

export function profileOwnedByCastProjectileIds(): string[] {
  return Object.keys(PROFILES).filter((id) => PROFILES[id]!.projectile === "ownedByCast");
}

export function profileCatalogImpactIds(): string[] {
  return Object.keys(PROFILES).filter(
    (id) => PROFILES[id]!.combatFx?.onHit === "catalogImpact",
  );
}

export function profileMeleeSwoopIds(): string[] {
  return ["crescent"];
}

export function profileAoeCrackIds(): string[] {
  return Object.keys(PROFILES).filter(
    (id) => PROFILES[id]!.combatFx?.onAoe === "groundCrack",
  );
}

export function profileBridgedAoeIds(): string[] {
  return Object.keys(PROFILES).filter((id) => PROFILES[id]!.castEngine === "bridgedAoe");
}

export function profileIceLanceExplodeIds(): string[] {
  return Object.keys(PROFILES).filter(
    (id) => PROFILES[id]!.combatFx?.onAoe === "iceLanceExplode",
  );
}

/** Channel timing constants used by combat_fx dispatch (kept next to profiles). */
export const CHANNEL_VFX = {
  frostMist: {
    lifePadMs: 350,
    growMs: FROST_MIST_CAST.mistGrowMs,
    ticks: FROST_MIST_CAST.mistTicks,
    tickMs: FROST_MIST_CAST.mistTickMs,
    fallbackRange: 11,
    fallbackStartRange: 3.2,
  },
  groove: {
    lifePadMs: 200,
    channelMs: GROOVE_CAST.channelMs,
    fallbackRadius: 7,
  },
  healBeam: {
    lifePadMs: 280,
    ticks: HEAL_BEAM_CAST.healTicks,
    tickMs: HEAL_BEAM_CAST.healTickMs,
    growMs: 140,
    fallbackRange: HEAL_BEAM_CAST.range,
  },
  lifeLeech: {
    lifePadMs: 280,
    ticks: LIFE_LEECH_CAST.damageTicks,
    tickMs: LIFE_LEECH_CAST.tickMs,
    growMs: 140,
    fallbackRange: LIFE_LEECH_CAST.range,
  },
} as const;
