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
  | "groundCrack"
  | "spikes"
  | "firewall"
  | "iceLanceExplode"
  | "groove"
  | "healBeam"
  | "volcano"
  | "none";

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
  combatFx?: {
    onHit?: CombatFxHitMode;
    onAoe?: CombatFxAoeMode;
    skipLegacyBurst?: boolean;
    /** Hit impact world Y. */
    hitY?: number;
  };
};
