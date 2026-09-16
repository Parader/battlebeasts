import {
  ABILITIES,
  abilityBaseCooldownMs,
  abilityHasTags,
  type AbilityDef,
  type SpellTag,
} from "./abilities";
import { COMBAT } from "./combat";
import { PLAYER_BASE_MAX_HP } from "./combatMagnitude";
import { TALENTS, type TalentDef } from "./stands";
import { getStatus, isElementalSecondaryStatus } from "./statuses";
import {
  empathicSurgePct,
  emergencyResponseMul,
  lingeringGraceMul,
  restorativeTouchMul,
} from "./harmonyTalents";
import {
  BATTLE_INSTINCT_TALENT_ID,
  battleInstinctBonusPercent,
  INTENSIFIED_ELEMENTS_TALENT_ID,
  intensifiedElementsPercent,
  UNSTABLE_MAGIC_TALENT_ID,
  unstableMagicCritDamagePercent,
  RELENTLESS_ASSAULT_TALENT_ID,
  relentlessAssaultCdrPercent,
  IMPACT_CATALYST_TALENT_ID,
  VOLATILE_ELEMENTS_TALENT_ID,
  ELEMENTAL_REACH_TALENT_ID,
  elementalReachPercent,
  LONG_SHOT_TALENT_ID,
  longShotDamagePercent,
  EXECUTIONERS_RHYTHM_TALENT_ID,
  CLOSE_THE_GAP_TALENT_ID,
  ELEMENTAL_WEAKNESS_TALENT_ID,
  DISTILLED_ELEMENTS_TALENT_ID,
  SNIPER_TALENT_ID,
  EXPOSED_ANGLE_TALENT_ID,
  WILD_INFUSION_TALENT_ID,
  ELEMENTAL_CONVERGENCE_TALENT_ID,
  CRITICAL_RECOVERY_TALENT_ID,
  BACKSTAB_TALENT_ID,
  ELEMENTAL_SURGE_TALENT_ID,
  CRITICAL_MASTERY_TALENT_ID,
  CRITICAL_FOCUS_TALENT_ID,
  criticalFocusCritChancePercent,
  ELEMENTAL_QUICKNESS_TALENT_ID,
  elementalQuicknessCdrPercent,
  FIFTH_CADENCE_DAMAGE_PERCENT,
  FIFTH_CADENCE_TALENT_ID,
  isCatalogTalentImplemented,
  OPENING_SALVO_COOLDOWN_MS,
  OPENING_SALVO_TALENT_ID,
  openingSalvoBonusPercent,
  RESTORATIVE_TOUCH_TALENT_ID,
  LINGERING_GRACE_TALENT_ID,
  EMPATHIC_SURGE_TALENT_ID,
  EMERGENCY_RESPONSE_TALENT_ID,
  OVERFLOWING_GRACE_TALENT_ID,
  STEADY_RENEWAL_TALENT_ID,
  UPLIFTING_PRESENCE_TALENT_ID,
  INSPIRING_RECOVERY_TALENT_ID,
  LASTING_RESCUE_TALENT_ID,
  MENDING_ECHO_TALENT_ID,
  PERSISTENT_GRACE_TALENT_ID,
  HARMONIOUS_GROWTH_TALENT_ID,
  EMPOWERED_RECOVERY_TALENT_ID,
  GUARDIAN_ANGEL_TALENT_ID,
  OVERFLOWING_RENEWAL_TALENT_ID,
  RENEWING_HARMONY_TALENT_ID,
  SYMPATHETIC_HEALING_TALENT_ID,
  BATTLE_RHYTHM_TALENT_ID,
  LASTING_GRACE_TALENT_ID,
  EVERLASTING_GRACE_TALENT_ID,
  RESONANCE_TALENT_ID,
  PROTECTIVE_INSTINCT_TALENT_ID,
  protectiveInstinctReducePercent,
  FLEET_FOOTED_TALENT_ID,
  COMBAT_FLOW_TALENT_ID,
  FLUID_MOTION_TALENT_ID,
  QUICK_RECOVERY_TALENT_ID,
  SECOND_WIND_TALENT_ID,
  FOLLOW_THROUGH_TALENT_ID,
  EXTENDED_REACH_TALENT_ID,
  LINGERING_MOTION_TALENT_ID,
  UNTOUCHABLE_TALENT_ID,
  REBOUND_WINDOW_TALENT_ID,
  DOUBLE_STEP_TALENT_ID,
  MOTION_ECHO_TALENT_ID,
  AFTERIMAGE_TALENT_ID,
  PHASE_SHIELD_TALENT_ID,
  FLOW_RENEWAL_TALENT_ID,
  RELENTLESS_PURSUIT_TALENT_ID,
  FALSE_TRAIL_TALENT_ID,
  TRIPLE_BLINK_TALENT_ID,
  ECHO_STEP_TALENT_ID,
  MOMENTUM_ENGINE_TALENT_ID,
  PHANTOM_CHAIN_TALENT_ID,
  fluidMotionMoveSpeedPercent,
  fleetFootedMoveSpeedPercent,
  combatFlowHastePercent,
  quickRecoveryCdrPercent,
  followThroughRangePercent,
  extendedReachPercent,
  lingeringMotionPercent,
  TALENT_CATALOG,
  WIDENED_ELEMENTS_AOE_PERCENT,
  WIDENED_ELEMENTS_TALENT_ID,
  REINFORCED_AID_TALENT_ID,
  BATTLE_HARDENED_TALENT_ID,
  GUARD_DISCIPLINE_TALENT_ID,
  SHARED_PROTECTION_TALENT_ID,
  FRONTLINE_SUPPORT_TALENT_ID,
  UNDER_PRESSURE_TALENT_ID,
  BRACED_ASSAULT_TALENT_ID,
  EFFICIENT_GUARD_TALENT_ID,
  GUARDIANS_PRESENCE_TALENT_ID,
  SHIELDED_POWER_TALENT_ID,
  UNBREAKABLE_TALENT_ID,
  DEFLECT_TALENT_ID,
  GUARDED_RECOVERY_TALENT_ID,
  GUARDIANS_BLESSING_TALENT_ID,
  AEGIS_MOMENTUM_TALENT_ID,
  FORTIFIED_RESOLVE_TALENT_ID,
  STEEL_REFLEXES_TALENT_ID,
  REFLECTIVE_GUARD_TALENT_ID,
  BASTION_TALENT_ID,
  LIVING_FORTRESS_TALENT_ID,
  PERFECT_DEFENSE_TALENT_ID,
  DISRUPTIVE_FORCE_TALENT_ID,
  LINGERING_CONTROL_TALENT_ID,
  FORCEFUL_MANIPULATION_TALENT_ID,
  BROKEN_CADENCE_TALENT_ID,
  FORBIDDEN_GROUND_TALENT_ID,
  CONTROL_MOMENTUM_TALENT_ID,
  ANCHORING_FORCE_TALENT_ID,
  CHAIN_PULL_TALENT_ID,
  SILENCING_PRESSURE_TALENT_ID,
  SUPPRESSIVE_CONTROL_TALENT_ID,
  EXPANDED_CONTROL_TALENT_ID,
  DISTORTED_WAKE_TALENT_ID,
  REPOSITIONING_MASTERY_TALENT_ID,
  ARCANE_LOCK_TALENT_ID,
  PUNISHING_SILENCE_TALENT_ID,
  BINDING_SIGIL_TALENT_ID,
  CONTAINMENT_TALENT_ID,
  SPATIAL_INSTABILITY_TALENT_ID,
  MASS_SILENCE_TALENT_ID,
  ABSOLUTE_CONTROL_TALENT_ID,
  DISORIENTATION_TALENT_ID,
  controlFoundationPercent,
  brokenCadenceCdrPercent,
  controlMomentumPercent,
} from "./talentCatalog";
import { isControlAbility, isControlAoeAbility } from "./controlTalents";
import type { TalentBuild } from "./talentTrees";
import { talentMaxRank, talentRank } from "./talentTrees";

/**
 * Leave-combat linger — same duration as Opening Salvo CD so the next
 * initiate is available as soon as the HP bar drops out of combat.
 */
export const COMBAT_ENGAGE_LINGER_MS = OPENING_SALVO_COOLDOWN_MS;

/** Baked once on loadout/talent change — never scanned in the tick loop. */
export type CombatSessionKit = {
  loadoutIds: Set<string>;
  talentIds: readonly string[];
  moveSpeedMul: number;
  maxHpBonus: number;
  /** Outgoing crit chance (0–1). Defaults to COMBAT.critChance. */
  critChance: number;
  /**
   * Extra crit damage fraction on top of COMBAT.critMultiplier (0.03 / 0.06 / 0.09).
   * Final crit mult = critMultiplier * (1 + critDamageBonus).
   */
  critDamageBonus: number;
  /**
   * Intensified Elements — secondary effect strength mul (1.05 / 1.10 / 1.15).
   * 1 = talent not invested.
   */
  secondaryEffectMul: number;
  /** Per-ability cooldown multiplier (1 = unchanged). */
  cooldownMulByAbility: Map<string, number>;
  /**
   * Opening Salvo — flat outgoing damage bonus (0.027 / 0.053 / 0.08) when initiating combat.
   * 0 = talent not invested / not implemented.
   */
  openingSalvoDmgBonus: number;
  /**
   * Protective Instinct — damage reduction percent granted to nearest ally (2 / 4 / 6).
   * 0 = talent not invested / not implemented.
   */
  protectiveInstinctReducePct: number;
  // Control Tree Passives & Modifiers
  disruptiveForceBonus: number;
  lingeringControlBonus: number;
  displacementMul: number;
  brokenCadenceCdr: number;
  hasForbiddenGround: boolean;
  controlMomentumBonus: number;
  hasAnchoringForce: boolean;
  hasChainPull: boolean;
  hasSilencingPressure: boolean;
  hasSuppressiveControl: boolean;
  controlRangeMul: number;
  controlAoeRadiusMul: number;
  hasDistortedWake: boolean;
  hasRepositioningMastery: boolean;
  hasArcaneLock: boolean;
  hasPunishingSilence: boolean;
  hasBindingSigil: boolean;
  hasContainment: boolean;
  hasSpatialInstability: boolean;
  hasMassSilence: boolean;
  absoluteControlBonus: number;
  hasDisorientation: boolean;
  // Flow Tree Passives & Modifiers
  fleetFootedMovePct: number;
  combatFlowHastePct: number;
  quickRecoveryCdr: number;
  hasSecondWind: boolean;
  followThroughRangePct: number;
  extendedReachMul: number;
  lingeringMotionMul: number;
  hasUntouchable: boolean;
  hasReboundWindow: boolean;
  hasDoubleStep: boolean;
  hasMotionEcho: boolean;
  hasAfterimage: boolean;
  hasPhaseShield: boolean;
  hasFlowRenewal: boolean;
  hasRelentlessPursuit: boolean;
  hasFalseTrail: boolean;
  hasTripleBlink: boolean;
  hasEchoStep: boolean;
  hasMomentumEngine: boolean;
  hasPhantomChain: boolean;
  movementRepeatTravelMul: number;
  movementRepeatWindowMs: number;
  restorativeTouchMul: number;
  lingeringGraceMul: number;
  empathicSurgePct: number;
  emergencyResponseMul: number;
  hasOverflowingGrace: boolean;
  steadyRenewalRank: number;
  hasUpliftingPresence: boolean;
  hasInspiringRecovery: boolean;
  hasLastingRescue: boolean;
  hasMendingEcho: boolean;
  hasPersistentGrace: boolean;
  hasHarmoniousGrowth: boolean;
  hasEmpoweredRecovery: boolean;
  hasGuardianAngel: boolean;
  hasOverflowingRenewal: boolean;
  hasRenewingHarmony: boolean;
  hasSympatheticHealing: boolean;
  hasBattleRhythm: boolean;
  hasLastingGrace: boolean;
  hasEverlastingGrace: boolean;
  hasResonance: boolean;
  /**
   * Fifth Cadence — flat outgoing damage bonus on every 5th damaging spell (0.15).
   * 0 = talent not invested.
   */
  fifthSpellDmgBonus: number;
  /**
   * Widened Elements — radius multiplier for elemental AoE spells (1.1 when owned).
   * 1 = talent not invested.
   */
  elementalAoeRadiusMul: number;

  // Destruction Tree Passives & Modifiers
  battleInstinctDmgBonus: number;
  relentlessAssaultCdr: number;
  hasImpactCatalyst: boolean;
  hasVolatileElements: boolean;
  elementalReachMul: number;
  longShotDmgBonus: number;
  hasExecutionersRhythm: boolean;
  hasCloseTheGap: boolean;
  hasElementalWeakness: boolean;
  hasDistilledElements: boolean;
  hasSniper: boolean;
  hasExposedAngle: boolean;
  hasWildInfusion: boolean;
  hasElementalConvergence: boolean;
  hasCriticalRecovery: boolean;
  hasBackstab: boolean;
  hasElementalSurge: boolean;
  hasCriticalMastery: boolean;

  // Guardian Tree Passives & Modifiers
  reinforcedAidBonus: number;
  battleHardenedDrPerStack: number;
  guardDisciplineShieldPct: number;
  hasSharedProtection: boolean;
  hasFrontlineSupport: boolean;
  underPressureDr: number;
  hasBracedAssault: boolean;
  efficientGuardCdr: number;
  hasGuardiansPresence: boolean;
  hasShieldedPower: boolean;
  hasUnbreakable: boolean;
  passiveBlockChance: number;
  hasGuardedRecovery: boolean;
  hasGuardiansBlessing: boolean;
  hasAegisMomentum: boolean;
  hasFortifiedResolve: boolean;
  hasReflectiveGuard: boolean;
  hasBastion: boolean;
  hasLivingFortress: boolean;
  hasPerfectDefense: boolean;
};

export function emptyCombatSessionKit(): CombatSessionKit {
  return {
    loadoutIds: new Set(),
    talentIds: [],
    moveSpeedMul: 1,
    maxHpBonus: 0,
    critChance: COMBAT.critChance,
    critDamageBonus: 0,
    secondaryEffectMul: 1,
    cooldownMulByAbility: new Map(),
    openingSalvoDmgBonus: 0,
    protectiveInstinctReducePct: 0,
    restorativeTouchMul: 1,
    lingeringGraceMul: 1,
    empathicSurgePct: 0,
    emergencyResponseMul: 1,
    hasOverflowingGrace: false,
    steadyRenewalRank: 0,
    hasUpliftingPresence: false,
    hasInspiringRecovery: false,
    hasLastingRescue: false,
    hasMendingEcho: false,
    hasPersistentGrace: false,
    hasHarmoniousGrowth: false,
    hasEmpoweredRecovery: false,
    hasGuardianAngel: false,
    hasOverflowingRenewal: false,
    hasRenewingHarmony: false,
    hasSympatheticHealing: false,
    hasBattleRhythm: false,
    hasLastingGrace: false,
    hasEverlastingGrace: false,
    hasResonance: false,
    fifthSpellDmgBonus: 0,
    elementalAoeRadiusMul: 1,

    battleInstinctDmgBonus: 0,
    relentlessAssaultCdr: 0,
    hasImpactCatalyst: false,
    hasVolatileElements: false,
    elementalReachMul: 1,
    longShotDmgBonus: 0,
    hasExecutionersRhythm: false,
    hasCloseTheGap: false,
    hasElementalWeakness: false,
    hasDistilledElements: false,
    hasSniper: false,
    hasExposedAngle: false,
    hasWildInfusion: false,
    hasElementalConvergence: false,
    hasCriticalRecovery: false,
    hasBackstab: false,
    hasElementalSurge: false,
    hasCriticalMastery: false,

    reinforcedAidBonus: 0,
    battleHardenedDrPerStack: 0,
    guardDisciplineShieldPct: 0,
    hasSharedProtection: false,
    hasFrontlineSupport: false,
    underPressureDr: 0,
    hasBracedAssault: false,
    efficientGuardCdr: 0,
    hasGuardiansPresence: false,
    hasShieldedPower: false,
    hasUnbreakable: false,
    passiveBlockChance: 0,
    hasGuardedRecovery: false,
    hasGuardiansBlessing: false,
    hasAegisMomentum: false,
    hasFortifiedResolve: false,
    hasReflectiveGuard: false,
    hasBastion: false,
    hasLivingFortress: false,
    hasPerfectDefense: false,

    disruptiveForceBonus: 0,
    lingeringControlBonus: 0,
    displacementMul: 1,
    brokenCadenceCdr: 0,
    hasForbiddenGround: false,
    controlMomentumBonus: 0,
    hasAnchoringForce: false,
    hasChainPull: false,
    hasSilencingPressure: false,
    hasSuppressiveControl: false,
    controlRangeMul: 1,
    controlAoeRadiusMul: 1,
    hasDistortedWake: false,
    hasRepositioningMastery: false,
    hasArcaneLock: false,
    hasPunishingSilence: false,
    hasBindingSigil: false,
    hasContainment: false,
    hasSpatialInstability: false,
    hasMassSilence: false,
    absoluteControlBonus: 0,
    hasDisorientation: false,

    fleetFootedMovePct: 0,
    combatFlowHastePct: 0,
    quickRecoveryCdr: 0,
    hasSecondWind: false,
    followThroughRangePct: 0,
    extendedReachMul: 1,
    lingeringMotionMul: 1,
    hasUntouchable: false,
    hasReboundWindow: false,
    hasDoubleStep: false,
    hasMotionEcho: false,
    hasAfterimage: false,
    hasPhaseShield: false,
    hasFlowRenewal: false,
    hasRelentlessPursuit: false,
    hasFalseTrail: false,
    hasTripleBlink: false,
    hasEchoStep: false,
    hasMomentumEngine: false,
    hasPhantomChain: false,
    movementRepeatTravelMul: 1,
    movementRepeatWindowMs: 0,
  };
}

/** Abilities treated as elemental even without applyOnHit secondary statuses. */
const ELEMENTAL_ABILITY_IDS = new Set([
  "frostBall",
  "frostMist",
  "iceLance",
  "poisonDart",
  "poisonCloud",
  "spikes",
  "magmaOrbs",
  "firewall",
  "fireball",
  "volcano",
  "shrooms",
  "chainLightning",
  "arcThread",
  "elementalOverload",
]);

/** True when the ability is in the Intensified Elements / elemental talent family. */
export function isElementalAbility(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  if (ELEMENTAL_ABILITY_IDS.has(def.id)) return true;
  for (const app of def.applyOnHit ?? []) {
    if (isElementalSecondaryStatus(getStatus(app.statusId))) return true;
  }
  for (const app of def.applyAuraSlow ?? []) {
    if (isElementalSecondaryStatus(getStatus(app.statusId))) return true;
  }
  return false;
}

const AOE_TAGS: readonly SpellTag[] = ["Area", "Nova", "Cone", "Explosion"];

/** Elemental spells whose authored radius is an AoE footprint. */
export function isElementalAoeAbility(def: AbilityDef | undefined): boolean {
  if (!isElementalAbility(def) || !def?.tags?.length) return false;
  return AOE_TAGS.some((t) => def.tags!.includes(t));
}

function talentMatchesAbility(modTags: readonly SpellTag[] | undefined, abilityId: string): boolean {
  if (!modTags?.length) return true;
  const def = ABILITIES[abilityId];
  if (!def?.tags?.length) return false;
  const set = new Set(def.tags);
  return modTags.every((t) => set.has(t));
}

function bakeBattleInstinctBonus(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[BATTLE_INSTINCT_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, BATTLE_INSTINCT_TALENT_ID);
  if (rank <= 0) return 0;
  return battleInstinctBonusPercent(rank, talentMaxRank(def)) / 100;
}

function bakeRelentlessAssaultCdr(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[RELENTLESS_ASSAULT_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, RELENTLESS_ASSAULT_TALENT_ID);
  if (rank <= 0) return 0;
  return relentlessAssaultCdrPercent(rank, talentMaxRank(def)) / 100;
}

function bakeElementalReachMul(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[ELEMENTAL_REACH_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 1;
  const rank = talentRank(talentBuild ?? {}, ELEMENTAL_REACH_TALENT_ID);
  if (rank <= 0) return 1;
  return 1 + elementalReachPercent(rank, talentMaxRank(def)) / 100;
}

function bakeLongShotBonus(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[LONG_SHOT_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, LONG_SHOT_TALENT_ID);
  if (rank <= 0) return 0;
  return longShotDamagePercent(rank, talentMaxRank(def)) / 100;
}

function hasTalentRank(talentBuild: TalentBuild | undefined, talentId: string): boolean {
  const def = TALENT_CATALOG[talentId];
  if (!isCatalogTalentImplemented(def)) return false;
  return talentRank(talentBuild ?? {}, talentId) >= 1;
}

function implementedRank(talentBuild: TalentBuild | undefined, talentId: string): number {
  const def = TALENT_CATALOG[talentId];
  if (!isCatalogTalentImplemented(def)) return 0;
  return talentRank(talentBuild ?? {}, talentId);
}

function bakeHarmonyRestorativeTouch(talentBuild: TalentBuild | undefined): number {
  return restorativeTouchMul(implementedRank(talentBuild, RESTORATIVE_TOUCH_TALENT_ID));
}

function bakeHarmonyLingeringGrace(talentBuild: TalentBuild | undefined): number {
  return lingeringGraceMul(implementedRank(talentBuild, LINGERING_GRACE_TALENT_ID));
}

function bakeHarmonyEmpathic(talentBuild: TalentBuild | undefined): number {
  return empathicSurgePct(implementedRank(talentBuild, EMPATHIC_SURGE_TALENT_ID));
}

function bakeHarmonyEmergency(talentBuild: TalentBuild | undefined): number {
  return emergencyResponseMul(implementedRank(talentBuild, EMERGENCY_RESPONSE_TALENT_ID));
}

function bakeOpeningSalvoBonus(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[OPENING_SALVO_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, OPENING_SALVO_TALENT_ID);
  if (rank <= 0) return 0;
  const maxRank = talentMaxRank(def);
  return openingSalvoBonusPercent(rank, maxRank) / 100;
}

function bakeUnstableMagicCritBonus(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[UNSTABLE_MAGIC_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, UNSTABLE_MAGIC_TALENT_ID);
  if (rank <= 0) return 0;
  return unstableMagicCritDamagePercent(rank, talentMaxRank(def)) / 100;
}

function bakeCriticalFocusCritChance(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[CRITICAL_FOCUS_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, CRITICAL_FOCUS_TALENT_ID);
  if (rank <= 0) return 0;
  return criticalFocusCritChancePercent(rank, talentMaxRank(def)) / 100;
}

function bakeSecondaryEffectMul(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[INTENSIFIED_ELEMENTS_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 1;
  const rank = talentRank(talentBuild ?? {}, INTENSIFIED_ELEMENTS_TALENT_ID);
  if (rank <= 0) return 1;
  return 1 + intensifiedElementsPercent(rank, talentMaxRank(def)) / 100;
}

function bakeProtectiveInstinctPct(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[PROTECTIVE_INSTINCT_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, PROTECTIVE_INSTINCT_TALENT_ID);
  if (rank <= 0) return 0;
  return protectiveInstinctReducePercent(rank, talentMaxRank(def));
}

function bakeControlFoundationBonus(talentId: string, talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[talentId];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, talentId);
  if (rank <= 0) return 0;
  return controlFoundationPercent(rank, talentMaxRank(def)) / 100;
}

function bakeBrokenCadenceCdr(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, BROKEN_CADENCE_TALENT_ID);
  if (rank <= 0) return 0;
  return brokenCadenceCdrPercent(rank) / 100;
}

function bakeControlMomentumBonus(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, CONTROL_MOMENTUM_TALENT_ID);
  if (rank <= 0) return 0;
  return controlMomentumPercent(rank) / 100;
}

/** Additive base move-speed (0.03 / 0.06 / 0.09) — Fluid Motion, outside temp haste cap. */
function bakeFluidMotionMoveMul(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[FLUID_MOTION_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 1;
  const rank = talentRank(talentBuild ?? {}, FLUID_MOTION_TALENT_ID);
  if (rank <= 0) return 1;
  return 1 + fluidMotionMoveSpeedPercent(rank, talentMaxRank(def)) / 100;
}

function bakeRankPercent(
  talentId: string,
  talentBuild: TalentBuild | undefined,
  pctFn: (rank: number) => number,
): number {
  const def = TALENT_CATALOG[talentId];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, talentId);
  if (rank <= 0) return 0;
  return pctFn(rank) / 100;
}

function bakeFifthSpellDmgBonus(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[FIFTH_CADENCE_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, FIFTH_CADENCE_TALENT_ID);
  if (rank <= 0) return 0;
  return FIFTH_CADENCE_DAMAGE_PERCENT / 100;
}

function bakeElementalAoeRadiusMul(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[WIDENED_ELEMENTS_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 1;
  const rank = talentRank(talentBuild ?? {}, WIDENED_ELEMENTS_TALENT_ID);
  if (rank <= 0) return 1;
  return 1 + WIDENED_ELEMENTS_AOE_PERCENT / 100;
}

function bakeElementalCooldownMuls(
  talentBuild: TalentBuild | undefined,
  loadoutIds: Set<string>,
  cooldownMulByAbility: Map<string, number>,
) {
  const def = TALENT_CATALOG[ELEMENTAL_QUICKNESS_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return;
  const rank = talentRank(talentBuild ?? {}, ELEMENTAL_QUICKNESS_TALENT_ID);
  if (rank <= 0) return;
  const cdr = elementalQuicknessCdrPercent(rank, talentMaxRank(def)) / 100;
  if (!(cdr > 0)) return;
  const mul = 1 - cdr;
  for (const abilityId of loadoutIds) {
    if (!isElementalAbility(ABILITIES[abilityId])) continue;
    const prev = cooldownMulByAbility.get(abilityId) ?? 1;
    cooldownMulByAbility.set(abilityId, prev * mul);
  }
}

function bakeReinforcedAidBonus(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, REINFORCED_AID_TALENT_ID);
  if (rank <= 0) return 0;
  return rank * 0.05;
}

function bakeBattleHardenedDr(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, BATTLE_HARDENED_TALENT_ID);
  if (rank <= 0) return 0;
  return rank * 0.01;
}

function bakeGuardDisciplineShieldPct(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, GUARD_DISCIPLINE_TALENT_ID);
  if (rank <= 0) return 0;
  return rank * 0.02;
}

function bakeUnderPressureDr(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, UNDER_PRESSURE_TALENT_ID);
  if (rank <= 0) return 0;
  return rank === 1 ? 0.05 : 0.08;
}

function bakeEfficientGuardCdr(build?: TalentBuild): number {
  const rank = talentRank(build ?? {}, EFFICIENT_GUARD_TALENT_ID);
  if (rank <= 0) return 0;
  return rank === 1 ? 0.08 : 0.15;
}

function bakePassiveBlockChance(build?: TalentBuild): number {
  let chance = 0;
  if (hasTalentRank(build, DEFLECT_TALENT_ID)) chance += 0.12;
  if (hasTalentRank(build, STEEL_REFLEXES_TALENT_ID)) chance += 0.08;
  return chance;
}

/**
 * Bake player sheet + per-ability cooldown multipliers from live stub talents
 * plus implemented catalog ranks from `talentBuild`.
 */
export function resolveKit(
  loadoutCsv: string,
  talentIds: readonly string[],
  talentBuild?: TalentBuild,
): CombatSessionKit {
  const loadoutIds = new Set(loadoutCsv.split(",").filter(Boolean));
  const cleaned = talentIds.filter((id) => id in TALENTS);
  let moveSpeedMul = 1;
  let maxHpBonus = 0;
  const cooldownMulByAbility = new Map<string, number>();
  for (const id of loadoutIds) cooldownMulByAbility.set(id, 1);

  for (const tid of cleaned) {
    const talent: TalentDef | undefined = TALENTS[tid];
    if (!talent?.mods?.length) continue;
    for (const mod of talent.mods) {
      if (mod.kind === "maxHp") {
        maxHpBonus += mod.amount;
      } else if (mod.kind === "moveSpeedMul") {
        moveSpeedMul *= mod.mul;
      } else if (mod.kind === "cooldownMul") {
        for (const abilityId of loadoutIds) {
          if (!talentMatchesAbility(mod.tags, abilityId)) continue;
          const prev = cooldownMulByAbility.get(abilityId) ?? 1;
          cooldownMulByAbility.set(abilityId, prev * mod.mul);
        }
      }
    }
  }

  moveSpeedMul *= bakeFluidMotionMoveMul(talentBuild);
  bakeElementalCooldownMuls(talentBuild, loadoutIds, cooldownMulByAbility);

  const hasLivingFortress = hasTalentRank(talentBuild, LIVING_FORTRESS_TALENT_ID);
  if (hasLivingFortress) {
    maxHpBonus += Math.round(PLAYER_BASE_MAX_HP * 0.2);
  }

  const hasCriticalMastery = hasTalentRank(talentBuild, CRITICAL_MASTERY_TALENT_ID);
  const critChance = Math.min(
    1,
    COMBAT.critChance +
      (hasCriticalMastery ? 0.2 : 0) +
      bakeCriticalFocusCritChance(talentBuild),
  );

  return {
    loadoutIds,
    talentIds: cleaned,
    moveSpeedMul,
    maxHpBonus,
    critChance,
    critDamageBonus: bakeUnstableMagicCritBonus(talentBuild),
    secondaryEffectMul: bakeSecondaryEffectMul(talentBuild),
    cooldownMulByAbility,
    openingSalvoDmgBonus: bakeOpeningSalvoBonus(talentBuild),
    protectiveInstinctReducePct: bakeProtectiveInstinctPct(talentBuild),
    restorativeTouchMul: bakeHarmonyRestorativeTouch(talentBuild),
    lingeringGraceMul: bakeHarmonyLingeringGrace(talentBuild),
    empathicSurgePct: bakeHarmonyEmpathic(talentBuild),
    emergencyResponseMul: bakeHarmonyEmergency(talentBuild),
    hasOverflowingGrace: hasTalentRank(talentBuild, OVERFLOWING_GRACE_TALENT_ID),
    steadyRenewalRank: implementedRank(talentBuild, STEADY_RENEWAL_TALENT_ID),
    hasUpliftingPresence: hasTalentRank(talentBuild, UPLIFTING_PRESENCE_TALENT_ID),
    hasInspiringRecovery: hasTalentRank(talentBuild, INSPIRING_RECOVERY_TALENT_ID),
    hasLastingRescue: hasTalentRank(talentBuild, LASTING_RESCUE_TALENT_ID),
    hasMendingEcho: hasTalentRank(talentBuild, MENDING_ECHO_TALENT_ID),
    hasPersistentGrace: hasTalentRank(talentBuild, PERSISTENT_GRACE_TALENT_ID),
    hasHarmoniousGrowth: hasTalentRank(talentBuild, HARMONIOUS_GROWTH_TALENT_ID),
    hasEmpoweredRecovery: hasTalentRank(talentBuild, EMPOWERED_RECOVERY_TALENT_ID),
    hasGuardianAngel: hasTalentRank(talentBuild, GUARDIAN_ANGEL_TALENT_ID),
    hasOverflowingRenewal: hasTalentRank(talentBuild, OVERFLOWING_RENEWAL_TALENT_ID),
    hasRenewingHarmony: hasTalentRank(talentBuild, RENEWING_HARMONY_TALENT_ID),
    hasSympatheticHealing: hasTalentRank(talentBuild, SYMPATHETIC_HEALING_TALENT_ID),
    hasBattleRhythm: hasTalentRank(talentBuild, BATTLE_RHYTHM_TALENT_ID),
    hasLastingGrace: hasTalentRank(talentBuild, LASTING_GRACE_TALENT_ID),
    hasEverlastingGrace: hasTalentRank(talentBuild, EVERLASTING_GRACE_TALENT_ID),
    hasResonance: hasTalentRank(talentBuild, RESONANCE_TALENT_ID),
    fifthSpellDmgBonus: bakeFifthSpellDmgBonus(talentBuild),
    elementalAoeRadiusMul: bakeElementalAoeRadiusMul(talentBuild),

    battleInstinctDmgBonus: bakeBattleInstinctBonus(talentBuild),
    relentlessAssaultCdr: bakeRelentlessAssaultCdr(talentBuild),
    hasImpactCatalyst: hasTalentRank(talentBuild, IMPACT_CATALYST_TALENT_ID),
    hasVolatileElements: hasTalentRank(talentBuild, VOLATILE_ELEMENTS_TALENT_ID),
    elementalReachMul: bakeElementalReachMul(talentBuild),
    longShotDmgBonus: bakeLongShotBonus(talentBuild),
    hasExecutionersRhythm: hasTalentRank(talentBuild, EXECUTIONERS_RHYTHM_TALENT_ID),
    hasCloseTheGap: hasTalentRank(talentBuild, CLOSE_THE_GAP_TALENT_ID),
    hasElementalWeakness: hasTalentRank(talentBuild, ELEMENTAL_WEAKNESS_TALENT_ID),
    hasDistilledElements: hasTalentRank(talentBuild, DISTILLED_ELEMENTS_TALENT_ID),
    hasSniper: hasTalentRank(talentBuild, SNIPER_TALENT_ID),
    hasExposedAngle: hasTalentRank(talentBuild, EXPOSED_ANGLE_TALENT_ID),
    hasWildInfusion: hasTalentRank(talentBuild, WILD_INFUSION_TALENT_ID),
    hasElementalConvergence: hasTalentRank(talentBuild, ELEMENTAL_CONVERGENCE_TALENT_ID),
    hasCriticalRecovery: hasTalentRank(talentBuild, CRITICAL_RECOVERY_TALENT_ID),
    hasBackstab: hasTalentRank(talentBuild, BACKSTAB_TALENT_ID),
    hasElementalSurge: hasTalentRank(talentBuild, ELEMENTAL_SURGE_TALENT_ID),
    hasCriticalMastery,

    reinforcedAidBonus: bakeReinforcedAidBonus(talentBuild),
    battleHardenedDrPerStack: bakeBattleHardenedDr(talentBuild),
    guardDisciplineShieldPct: bakeGuardDisciplineShieldPct(talentBuild),
    hasSharedProtection: hasTalentRank(talentBuild, SHARED_PROTECTION_TALENT_ID),
    hasFrontlineSupport: hasTalentRank(talentBuild, FRONTLINE_SUPPORT_TALENT_ID),
    underPressureDr: bakeUnderPressureDr(talentBuild),
    hasBracedAssault: hasTalentRank(talentBuild, BRACED_ASSAULT_TALENT_ID),
    efficientGuardCdr: bakeEfficientGuardCdr(talentBuild),
    hasGuardiansPresence: hasTalentRank(talentBuild, GUARDIANS_PRESENCE_TALENT_ID),
    hasShieldedPower: hasTalentRank(talentBuild, SHIELDED_POWER_TALENT_ID),
    hasUnbreakable: hasTalentRank(talentBuild, UNBREAKABLE_TALENT_ID),
    passiveBlockChance: bakePassiveBlockChance(talentBuild),
    hasGuardedRecovery: hasTalentRank(talentBuild, GUARDED_RECOVERY_TALENT_ID),
    hasGuardiansBlessing: hasTalentRank(talentBuild, GUARDIANS_BLESSING_TALENT_ID),
    hasAegisMomentum: hasTalentRank(talentBuild, AEGIS_MOMENTUM_TALENT_ID),
    hasFortifiedResolve: hasTalentRank(talentBuild, FORTIFIED_RESOLVE_TALENT_ID),
    hasReflectiveGuard: hasTalentRank(talentBuild, REFLECTIVE_GUARD_TALENT_ID),
    hasBastion: hasTalentRank(talentBuild, BASTION_TALENT_ID),
    hasLivingFortress,
    hasPerfectDefense: hasTalentRank(talentBuild, PERFECT_DEFENSE_TALENT_ID),

    disruptiveForceBonus: bakeControlFoundationBonus(DISRUPTIVE_FORCE_TALENT_ID, talentBuild),
    lingeringControlBonus: bakeControlFoundationBonus(LINGERING_CONTROL_TALENT_ID, talentBuild),
    displacementMul: 1 + bakeControlFoundationBonus(FORCEFUL_MANIPULATION_TALENT_ID, talentBuild),
    brokenCadenceCdr: bakeBrokenCadenceCdr(talentBuild),
    hasForbiddenGround: hasTalentRank(talentBuild, FORBIDDEN_GROUND_TALENT_ID),
    controlMomentumBonus: bakeControlMomentumBonus(talentBuild),
    hasAnchoringForce: hasTalentRank(talentBuild, ANCHORING_FORCE_TALENT_ID),
    hasChainPull: hasTalentRank(talentBuild, CHAIN_PULL_TALENT_ID),
    hasSilencingPressure: hasTalentRank(talentBuild, SILENCING_PRESSURE_TALENT_ID),
    hasSuppressiveControl: hasTalentRank(talentBuild, SUPPRESSIVE_CONTROL_TALENT_ID),
    controlRangeMul: hasTalentRank(talentBuild, EXPANDED_CONTROL_TALENT_ID) ? 1.15 : 1,
    controlAoeRadiusMul: hasTalentRank(talentBuild, EXPANDED_CONTROL_TALENT_ID) ? 1.15 : 1,
    hasDistortedWake: hasTalentRank(talentBuild, DISTORTED_WAKE_TALENT_ID),
    hasRepositioningMastery: hasTalentRank(talentBuild, REPOSITIONING_MASTERY_TALENT_ID),
    hasArcaneLock: hasTalentRank(talentBuild, ARCANE_LOCK_TALENT_ID),
    hasPunishingSilence: hasTalentRank(talentBuild, PUNISHING_SILENCE_TALENT_ID),
    hasBindingSigil: hasTalentRank(talentBuild, BINDING_SIGIL_TALENT_ID),
    hasContainment: hasTalentRank(talentBuild, CONTAINMENT_TALENT_ID),
    hasSpatialInstability: hasTalentRank(talentBuild, SPATIAL_INSTABILITY_TALENT_ID),
    hasMassSilence: hasTalentRank(talentBuild, MASS_SILENCE_TALENT_ID),
    absoluteControlBonus: hasTalentRank(talentBuild, ABSOLUTE_CONTROL_TALENT_ID) ? 0.2 : 0,
    hasDisorientation: hasTalentRank(talentBuild, DISORIENTATION_TALENT_ID),

    fleetFootedMovePct: bakeRankPercent(
      FLEET_FOOTED_TALENT_ID,
      talentBuild,
      fleetFootedMoveSpeedPercent,
    ),
    combatFlowHastePct: bakeRankPercent(
      COMBAT_FLOW_TALENT_ID,
      talentBuild,
      combatFlowHastePercent,
    ),
    quickRecoveryCdr: bakeRankPercent(
      QUICK_RECOVERY_TALENT_ID,
      talentBuild,
      quickRecoveryCdrPercent,
    ),
    hasSecondWind: hasTalentRank(talentBuild, SECOND_WIND_TALENT_ID),
    followThroughRangePct: bakeRankPercent(
      FOLLOW_THROUGH_TALENT_ID,
      talentBuild,
      followThroughRangePercent,
    ),
    extendedReachMul:
      1 + bakeRankPercent(EXTENDED_REACH_TALENT_ID, talentBuild, extendedReachPercent),
    lingeringMotionMul:
      1 + bakeRankPercent(LINGERING_MOTION_TALENT_ID, talentBuild, lingeringMotionPercent),
    hasUntouchable: hasTalentRank(talentBuild, UNTOUCHABLE_TALENT_ID),
    hasReboundWindow: hasTalentRank(talentBuild, REBOUND_WINDOW_TALENT_ID),
    hasDoubleStep: hasTalentRank(talentBuild, DOUBLE_STEP_TALENT_ID),
    hasMotionEcho: hasTalentRank(talentBuild, MOTION_ECHO_TALENT_ID),
    hasAfterimage: hasTalentRank(talentBuild, AFTERIMAGE_TALENT_ID),
    hasPhaseShield: hasTalentRank(talentBuild, PHASE_SHIELD_TALENT_ID),
    hasFlowRenewal: hasTalentRank(talentBuild, FLOW_RENEWAL_TALENT_ID),
    hasRelentlessPursuit: hasTalentRank(talentBuild, RELENTLESS_PURSUIT_TALENT_ID),
    hasFalseTrail: hasTalentRank(talentBuild, FALSE_TRAIL_TALENT_ID),
    hasTripleBlink: hasTalentRank(talentBuild, TRIPLE_BLINK_TALENT_ID),
    hasEchoStep: hasTalentRank(talentBuild, ECHO_STEP_TALENT_ID),
    hasMomentumEngine: hasTalentRank(talentBuild, MOMENTUM_ENGINE_TALENT_ID),
    hasPhantomChain: hasTalentRank(talentBuild, PHANTOM_CHAIN_TALENT_ID),
    movementRepeatTravelMul: hasTalentRank(talentBuild, ECHO_STEP_TALENT_ID)
      ? 1
      : hasTalentRank(talentBuild, DOUBLE_STEP_TALENT_ID)
        ? 0.75
        : 1,
    movementRepeatWindowMs: hasTalentRank(talentBuild, ECHO_STEP_TALENT_ID)
      ? 3000
      : hasTalentRank(talentBuild, DOUBLE_STEP_TALENT_ID)
        ? 2500
        : 0,
  };
}

export function kitCooldownMs(
  kit: CombatSessionKit | undefined,
  abilityId: string,
  baseMs: number,
): number {
  const def = ABILITIES[abilityId];
  const authored = def ? abilityBaseCooldownMs(def) : baseMs;
  const mul = kit?.cooldownMulByAbility.get(abilityId) ?? 1;
  return Math.max(0, Math.round(authored * mul));
}

/** Radius multiplier for elemental AoE (1 = unchanged). */
export function kitRadiusMul(kit: CombatSessionKit | undefined, abilityId: string): number {
  const def = ABILITIES[abilityId];
  let mul = 1;
  if (isElementalAoeAbility(def)) {
    mul *= kit?.elementalAoeRadiusMul ?? 1;
    if (kit?.elementalReachMul && kit.elementalReachMul > 1 && isElementalAbility(def)) {
      mul *= kit.elementalReachMul;
    }
  }
  if (isControlAoeAbility(def) && (kit?.controlAoeRadiusMul ?? 1) > 1) {
    mul *= kit!.controlAoeRadiusMul;
  }
  if (mul <= 1.001) return 1;
  return mul;
}

export function kitScaledRadius(
  kit: CombatSessionKit | undefined,
  abilityId: string,
  base: number,
): number {
  if (!(base > 0)) return base;
  return base * kitRadiusMul(kit, abilityId);
}

/** Scaled range for ranged elemental abilities (via Elemental Reach). */
export function kitScaledRange(
  kit: CombatSessionKit | undefined,
  abilityId: string,
  base: number,
): number {
  if (!(base > 0)) return base;
  const def = ABILITIES[abilityId];
  let mul = 1;
  if (def && isElementalAbility(def) && def.range >= 5 && (kit?.elementalReachMul ?? 1) > 1) {
    mul *= kit!.elementalReachMul;
  }
  if (def && isControlAbility(def) && (kit?.controlRangeMul ?? 1) > 1) {
    mul *= kit!.controlRangeMul;
  }
  return mul <= 1.001 ? base : base * mul;
}

/** True when this ability id is a damaging spell (not a status / DoT tick id). */
export function abilityCanProcOpeningSalvo(abilityId: string): boolean {
  const def = ABILITIES[abilityId];
  if (!def || !(def.damage > 0)) return false;
  return abilityHasTags(def, "Damage");
}

/** Damaging spells that advance Fifth Cadence. */
export function abilityCanProcFifthCadence(abilityId: string): boolean {
  return abilityCanProcOpeningSalvo(abilityId);
}

/** True when casting this ability can proc Protective Instinct. */
export function abilityCanProcProtectiveInstinct(abilityId: string): boolean {
  return abilityHasTags(ABILITIES[abilityId], "Defense");
}

