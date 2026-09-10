import { abilityHasTags, type AbilityDef } from "./abilities";
import type { StatusDef } from "./statuses";

/** Temporary Flow haste (Fleet Footed + Relentless Pursuit + Momentum Engine). */
export const FLOW_TEMP_HASTE_CAP = 0.3;

export const FLOW_TEMP_HASTE_STATUS_IDS = new Set([
  "fleetFooted",
  "relentlessPursuit",
  "momentumEngine",
]);

export const FLOW_HELPER_STATUS_IDS = new Set([
  "fleetFooted",
  "combatFlow",
  "followThrough",
  "quickRecovery",
  "untouchable",
  "reboundWindow",
  "movementRepeatReady",
  "tripleBlinkReady",
  "motionEcho",
  "phaseShield",
  "relentlessPursuit",
  "momentumEngine",
  "phantomCharge",
  "flowEngage",
]);

/** Timed movement states Lingering Motion may lengthen. */
export const FLOW_LINGERING_STATUS_IDS = new Set(["surged", "spiritFormed"]);

/**
 * Narrow Flow-movement list — not the raw Movement tag.
 * Void Disc, Smash, Revenge, Position Swap, Grasp, and F ultimates never qualify.
 */
export const FLOW_MOVEMENT_IDS = new Set([
  "dash",
  "portal",
  "spiritForm",
  "surge",
  "predatorStep",
  "rebound",
  "teleportSlam",
  "verdantLeap",
  "bulwarkCharge",
  "riftFissure",
  "tripleBlink",
]);

/** Dash + Teleport only. Triple Blink is never repeatable. */
export const REPEATABLE_FLOW_MOVEMENT_IDS = new Set(["dash", "portal"]);

/** Travel-distance talents (Extended Reach, Motion Echo, Double Step). */
export const FLOW_TRAVEL_IDS = new Set([
  "dash",
  "portal",
  "spiritForm",
  "rebound",
  "teleportSlam",
  "verdantLeap",
  "bulwarkCharge",
  "tripleBlink",
]);

export const FLOW_AFTERIMAGE = {
  staticMs: 1500,
  trailMs: 2000,
  phantomMs: 1500,
  phantomCharges: 3,
  chargeExpireMs: 8000,
} as const;

export function isFlowHelperStatus(statusId: string): boolean {
  return FLOW_HELPER_STATUS_IDS.has(statusId);
}

export function isFlowMovementAbility(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  return FLOW_MOVEMENT_IDS.has(def.id);
}

export function isRepeatableFlowMovement(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  return REPEATABLE_FLOW_MOVEMENT_IDS.has(def.id);
}

export function isFlowTravelAbility(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  return FLOW_TRAVEL_IDS.has(def.id);
}

/** Next Combat Flow / Follow Through consume target. */
export function isFlowOffensiveConsume(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  if (isFlowMovementAbility(def)) return false;
  return abilityHasTags(def, "Damage");
}

export function isFlowQuickRecoveryConsume(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  if (isFlowMovementAbility(def)) return true;
  return abilityHasTags(def, "Defense");
}

/** Untouchable shortens newly applied root / slow / stun / fear — never silence. */
export function isUntouchableShortenable(def: StatusDef | undefined): boolean {
  if (!def || def.polarity !== "debuff") return false;
  if (def.mechanic === "silence") return false;
  if (
    def.mechanic === "stun" ||
    def.mechanic === "root" ||
    def.mechanic === "fear" ||
    def.mechanic === "slow"
  ) {
    return true;
  }
  return typeof def.moveMul === "number" && def.moveMul < 1;
}
