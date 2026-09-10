import { abilityHasTags, type AbilityDef } from "./abilities";

/** Harmony temporary move buffs share Flow's 30% temp haste cap. */
export const HARMONY_TEMP_HASTE_STATUS_IDS = new Set([
  "empathicSurge",
  "upliftingPresence",
  "harmoniousGrowth",
  "battleRhythm",
]);

/** Temporary cast-speed buffs — share one 30% cap with Flow Combat Flow. */
export const HARMONY_TEMP_CAST_STATUS_IDS = new Set([
  "inspiringRecovery",
  "harmoniousGrowth",
  "empoweredRecovery",
  "battleRhythm",
]);

export const HARMONY_HELPER_STATUS_IDS = new Set([
  "empathicSurge",
  "inspiringRecovery",
  "upliftingPresence",
  "lastingRescue",
  "overflowingGraceHot",
  "harmoniousGrowth",
  "empoweredRecovery",
  "battleRhythm",
  "harmonyResonance",
  "harmonyResonanceStacks",
  "lastingGrace",
  "rebirthBlessing",
  "rebirthPending",
]);

export const HARMONY_DIRECT_HEAL_IDS = new Set([
  "soulRelay",
  "verdantLeap",
  "healBeam",
  "groove",
  "worldTree",
  "guardianAngel",
]);

export const HARMONY_HOT_IDS = new Set([
  "rejuvenated",
  "bloomingPath",
  "overflowingGraceHot",
]);

/** Self-only / talent / pickup heals that never run Harmony ally hooks. */
export const HARMONY_EXCLUDED_HEAL_IDS = new Set([
  "lifeLeech",
  "secondWind",
  "pickup_heal",
]);

export const HARMONY_TALENTS = {
  restorativeTouchPct: [0.05, 0.1, 0.15] as const,
  lingeringGracePct: [0.05, 0.1, 0.15] as const,
  empathicSurgePct: [0.03, 0.06, 0.09] as const,
  empathicDurationMs: 2500,
  empathicIcdMs: 2000,
  emergencyResponsePct: [0.08, 0.15] as const,
  emergencyHealthFrac: 0.4,
  overflowingGraceConvert: 0.4,
  overflowingGraceDurationMs: 4000,
  overflowingGraceCapFrac: 0.1,
  overflowingGraceTickMs: 1000,
  steadyRenewalPct: [0.02, 0.04] as const,
  steadyRenewalMaxStacks: 3,
  upliftingPresencePct: 0.07,
  inspiringCastPct: 0.08,
  inspiringDurationMs: 2000,
  inspiringIcdMs: 4000,
  lastingRescueHealthFrac: 0.35,
  lastingRescueDr: 0.12,
  lastingRescueDurationMs: 2500,
  lastingRescueIcdMs: 6000,
  mendingEchoFrac: 0.2,
  mendingEchoDelayMs: 2000,
  persistentGraceMul: 1.75,
  harmoniousTicks: 3,
  harmoniousMovePct: 0.1,
  harmoniousCastPct: 0.1,
  harmoniousDurationMs: 3000,
  harmoniousIcdMs: 6000,
  empoweredHealthFrac: 0.8,
  empoweredDamagePct: 0.1,
  empoweredCastPct: 0.08,
  empoweredDurationMs: 3000,
  empoweredIcdMs: 6000,
  overflowingRenewalExtendMs: 1000,
  overflowingRenewalTickPct: 0.15,
  overflowingRenewalIcdMs: 4000,
  overflowingRenewalMaxExtendFrac: 0.3,
  renewingHarmonyMinHots: 2,
  renewingHarmonyIcdMs: 6000,
  sympatheticFrac: 0.25,
  battleRhythmRadius: 3,
  battleRhythmIcdMs: 1500,
  battleRhythmMovePct: 0.03,
  battleRhythmCastPct: 0.03,
  battleRhythmMaxStacks: 3,
  battleRhythmDurationMs: 4000,
  everlastingMinHots: 3,
  everlastingTickMul: 0.8,
  resonanceMaxStacks: 3,
  resonanceStackIcdMs: 1000,
  resonanceDamagePct: 0.12,
  resonanceDr: 0.1,
  resonanceDurationMs: 4000,
  resonanceIcdMs: 8000,
} as const;

export type HarmonyHealKind = "direct" | "hot" | "echo" | "none";

export function isHarmonyHelperStatus(statusId: string): boolean {
  return HARMONY_HELPER_STATUS_IDS.has(statusId);
}

export function classifyHarmonyHeal(abilityId: string): HarmonyHealKind {
  if (!abilityId || HARMONY_EXCLUDED_HEAL_IDS.has(abilityId)) return "none";
  if (abilityId === "echoHeal") return "echo";
  if (HARMONY_HOT_IDS.has(abilityId)) return "hot";
  if (HARMONY_DIRECT_HEAL_IDS.has(abilityId)) return "direct";
  return "none";
}

export function isHarmonyDirectHeal(abilityId: string): boolean {
  return classifyHarmonyHeal(abilityId) === "direct";
}

export function isHarmonyHot(abilityId: string): boolean {
  return classifyHarmonyHeal(abilityId) === "hot";
}

export function isHarmonyAllyHealAbility(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  return abilityHasTags(def, "Healing") && abilityHasTags(def, "Ally");
}

export function restorativeTouchMul(rank: number): number {
  if (rank <= 0) return 1;
  const i = Math.min(3, rank) - 1;
  return 1 + HARMONY_TALENTS.restorativeTouchPct[i]!;
}

export function lingeringGraceMul(rank: number): number {
  if (rank <= 0) return 1;
  const i = Math.min(3, rank) - 1;
  return 1 + HARMONY_TALENTS.lingeringGracePct[i]!;
}

export function empathicSurgePct(rank: number): number {
  if (rank <= 0) return 0;
  return HARMONY_TALENTS.empathicSurgePct[Math.min(3, rank) - 1]!;
}

export function emergencyResponseMul(rank: number): number {
  if (rank <= 0) return 1;
  return 1 + HARMONY_TALENTS.emergencyResponsePct[Math.min(2, rank) - 1]!;
}

export function steadyRenewalTickMul(rank: number, stacks: number): number {
  if (rank <= 0 || stacks <= 0) return 1;
  const per = HARMONY_TALENTS.steadyRenewalPct[Math.min(2, rank) - 1]!;
  return 1 + per * Math.min(HARMONY_TALENTS.steadyRenewalMaxStacks, stacks);
}
