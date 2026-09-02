export type CastEngine =
  | "none"
  | "muzzleLead"
  | "chargeHand"
  | "bridgedAoe"
  | "combatFxOnly";

export type ProjectileVfxMode = "catalog" | "ownedByCast" | "none";

export type CombatFxHitMode = "catalogImpact" | "sfxOnly" | "none";
export type CombatFxAoeMode =
  | "catalogImpact"
  | "channelOnce"
  | "silenceSweep"
  | "groundCrack"
  | "spikes"
  | "firewall"
  | "poisonCloud"
  | "smokeBomb"
  | "holyGround"
  | "fireballBurn"
  | "iceLanceExplode"
  | "groove"
  | "healBeam"
  | "lifeLeech"
  | "volcano"
  | "arcThread"
  | "none";

export type CombatFxDashMode = "bloodRushTrail" | "spiritForm" | "none";

/** Extra GPU assets for this ability — merged into hub/arena preload. */
export type AbilityVfxAssets = {
  textures?: readonly string[];
  glbs?: readonly string[];
};

export type ChargeHandOpts = {
  forward: number;
  handY: number;
  /** Extra ms after anticipation+cast for grow curve. */
  chargePadMs: number;
  /** Default chargeMs when AbilityDef timing missing. */
  fallbackChargeMs: number;
  /** Fallback range/speed when AbilityDef lacks them (projectile charges). */
  fallbackRange?: number;
  fallbackSpeed?: number;
  fallbackFlightMs?: number;
  /** Pad after flight (or flight+fuse). */
  flightCoastMs?: number;
  /** When true, add AbilityDef.detonate.delayMs into life. */
  includeDetonateFuse?: boolean;
  /** Barrier-style: hold after charge (no projectile flight). */
  shieldHoldMs?: number;
  dissolveMs?: number;
  /** Cancel existing follow-owner shots of this ability on start (barrier). */
  cancelFollowOnStart?: boolean;
};

export type MuzzleLeadOpts = {
  forward: number;
  handY: number;
  /** Ms before impact to fire muzzle; 0 = fire at impact. */
  leadMs: number;
};

export type BridgedAoeOpts = {
  lifePadMs: number;
  y?: number;
};

export type AbilityVfxProfile = {
  castEngine: CastEngine;
  chargeHand?: ChargeHandOpts;
  muzzleLead?: MuzzleLeadOpts;
  bridgedAoe?: BridgedAoeOpts;
  projectile?: ProjectileVfxMode;
  /** Declare new textures/GLBs here so loading gate preloads them. */
  assets?: AbilityVfxAssets;
  combatFx?: {
    onHit?: CombatFxHitMode;
    onAoe?: CombatFxAoeMode;
    onDash?: CombatFxDashMode;
    skipLegacyBurst?: boolean;
    /** Hit impact world Y. */
    hitY?: number;
  };
};
