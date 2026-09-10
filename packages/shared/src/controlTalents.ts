import { abilityHasTags, type AbilityDef } from "./abilities";
import {
  isHardCrowdControlStatus,
  type StatusDef,
} from "./statuses";

/** Maximum talent-based CC duration increase (additive, then clamped). */
export const CONTROL_TALENT_DURATION_CAP = 0.3;

/** Per-type hard-CC diminishing returns — same lock cannot be chained forever. */
export const HARD_CC_DR_WINDOW_MS = 6000;
/** 1st full → 2nd 70% → 3rd 40% → 4th+ 25%, tracked per CC type. */
export const HARD_CC_DR_MULS = [1, 0.7, 0.4, 0.25] as const;

export type CcDrKind = "stun" | "root" | "silence" | "fear";

export const CONTROL_HELPER_STATUS_IDS = new Set([
  "forbiddenGround",
  "suppressedControl",
  "contained",
  "spatiallyUnstable",
  "disoriented",
  "arcaneLocked",
  "brokenCadence",
  "chainPullReady",
  "repositioningReady",
  "punishingSilence",
]);

export function isControlHelperStatus(statusId: string): boolean {
  return CONTROL_HELPER_STATUS_IDS.has(statusId);
}

/** Timed control that talents may lengthen (hard CC + slows). */
export function isTimedControlStatus(def: StatusDef | undefined): boolean {
  if (!def || def.polarity !== "debuff") return false;
  if (isControlHelperStatus(def.id)) return false;
  if (isHardCrowdControlStatus(def)) return true;
  if (def.mechanic === "slow") return true;
  if (typeof def.moveMul === "number" && def.moveMul < 1) return true;
  return false;
}

export function isDisruptionControlStatus(def: StatusDef | undefined): boolean {
  if (!def) return false;
  return def.mechanic === "silence" || def.mechanic === "fear";
}

export function isZoneControlStatus(def: StatusDef | undefined): boolean {
  if (!def || isControlHelperStatus(def.id)) return false;
  if (def.mechanic === "root" || def.mechanic === "slow") return true;
  return typeof def.moveMul === "number" && def.moveMul < 1;
}

export function isControlAbility(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  return abilityHasTags(def, "Control") || abilityHasTags(def, "CrowdControl");
}

export function isControlAoeAbility(def: AbilityDef | undefined): boolean {
  if (!isControlAbility(def) || !def?.tags?.length) return false;
  return def.tags.some(
    (t) => t === "Area" || t === "Nova" || t === "Cone" || t === "Explosion",
  );
}

export function ccDrKind(def: StatusDef | undefined): CcDrKind | null {
  if (!def || def.polarity !== "debuff") return null;
  if (isControlHelperStatus(def.id)) return null;
  if (
    def.mechanic === "stun" ||
    def.mechanic === "root" ||
    def.mechanic === "silence" ||
    def.mechanic === "fear"
  ) {
    return def.mechanic;
  }
  return null;
}

export function hardCcDrMul(priorCountInWindow: number): number {
  const idx = Math.min(Math.max(0, priorCountInWindow), HARD_CC_DR_MULS.length - 1);
  return HARD_CC_DR_MULS[idx] ?? 0;
}

export function clampTalentControlDurationBonus(bonus: number): number {
  if (!(bonus > 0)) return 0;
  return Math.min(CONTROL_TALENT_DURATION_CAP, bonus);
}
