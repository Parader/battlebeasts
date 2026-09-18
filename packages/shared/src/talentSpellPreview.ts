/**
 * Named talent lines for a hovered spell — only talents that actually
 * modify, proc from, or consume this ability.
 */
import { ABILITIES, abilityHasTags, type AbilityDef } from "./abilities";
import { isControlAbility, isControlAoeAbility } from "./controlTalents";
import {
  FLOW_LINGERING_STATUS_IDS,
  isFlowMovementAbility,
  isFlowOffensiveConsume,
  isFlowQuickRecoveryConsume,
  isFlowTravelAbility,
  isRepeatableFlowMovement,
} from "./flowTalents";
import { classifyHarmonyHeal } from "./harmonyTalents";
import {
  isElementalAbility,
  isElementalAoeAbility,
  type CombatSessionKit,
} from "./talentKit";
import {
  AFTERIMAGE_TALENT_ID,
  BATTLE_INSTINCT_TALENT_ID,
  BACKSTAB_TALENT_ID,
  BRACED_ASSAULT_TALENT_ID,
  BROKEN_CADENCE_TALENT_ID,
  CHAIN_PULL_TALENT_ID,
  CLOSE_THE_GAP_TALENT_ID,
  COMBAT_FLOW_TALENT_ID,
  CONTAINMENT_TALENT_ID,
  CONTROL_MOMENTUM_TALENT_ID,
  CRITICAL_MASTERY_TALENT_ID,
  CRITICAL_RECOVERY_TALENT_ID,
  DISTILLED_ELEMENTS_TALENT_ID,
  DISTORTED_WAKE_TALENT_ID,
  DISORIENTATION_TALENT_ID,
  DISRUPTIVE_FORCE_TALENT_ID,
  DOUBLE_STEP_TALENT_ID,
  ECHO_STEP_TALENT_ID,
  ELEMENTAL_CONVERGENCE_TALENT_ID,
  ELEMENTAL_REACH_TALENT_ID,
  ELEMENTAL_SURGE_TALENT_ID,
  ELEMENTAL_WEAKNESS_TALENT_ID,
  EMPATHIC_SURGE_TALENT_ID,
  EMPOWERED_RECOVERY_TALENT_ID,
  EMERGENCY_RESPONSE_TALENT_ID,
  EFFICIENT_GUARD_TALENT_ID,
  EVERLASTING_GRACE_TALENT_ID,
  EXECUTIONERS_RHYTHM_TALENT_ID,
  EXPANDED_CONTROL_TALENT_ID,
  EXPOSED_ANGLE_TALENT_ID,
  EXTENDED_REACH_TALENT_ID,
  FALSE_TRAIL_TALENT_ID,
  FLEET_FOOTED_TALENT_ID,
  FLOW_RENEWAL_TALENT_ID,
  FOLLOW_THROUGH_TALENT_ID,
  FORCEFUL_MANIPULATION_TALENT_ID,
  FORBIDDEN_GROUND_TALENT_ID,
  FRONTLINE_SUPPORT_TALENT_ID,
  GUARD_DISCIPLINE_TALENT_ID,
  GUARDED_RECOVERY_TALENT_ID,
  HARMONIOUS_GROWTH_TALENT_ID,
  IMPACT_CATALYST_TALENT_ID,
  INSPIRING_RECOVERY_TALENT_ID,
  INTENSIFIED_ELEMENTS_TALENT_ID,
  LASTING_RESCUE_TALENT_ID,
  LINGERING_CONTROL_TALENT_ID,
  LINGERING_GRACE_TALENT_ID,
  LINGERING_MOTION_TALENT_ID,
  LONG_SHOT_TALENT_ID,
  MENDING_ECHO_TALENT_ID,
  MOMENTUM_ENGINE_TALENT_ID,
  MOTION_ECHO_TALENT_ID,
  OVERFLOWING_GRACE_TALENT_ID,
  OVERFLOWING_RENEWAL_TALENT_ID,
  PERFECT_DEFENSE_TALENT_ID,
  PERSISTENT_GRACE_TALENT_ID,
  PHASE_SHIELD_TALENT_ID,
  PHANTOM_CHAIN_TALENT_ID,
  PUNISHING_SILENCE_TALENT_ID,
  QUICK_RECOVERY_TALENT_ID,
  REBOUND_WINDOW_TALENT_ID,
  REFLECTIVE_GUARD_TALENT_ID,
  RELENTLESS_ASSAULT_TALENT_ID,
  RELENTLESS_PURSUIT_TALENT_ID,
  REINFORCED_AID_TALENT_ID,
  RENEWING_HARMONY_TALENT_ID,
  REPOSITIONING_MASTERY_TALENT_ID,
  RESONANCE_TALENT_ID,
  RESTORATIVE_TOUCH_TALENT_ID,
  SECOND_WIND_TALENT_ID,
  SHARED_PROTECTION_TALENT_ID,
  SHIELDED_POWER_TALENT_ID,
  BASTION_TALENT_ID,
  SILENCING_PRESSURE_TALENT_ID,
  SNIPER_TALENT_ID,
  SPATIAL_INSTABILITY_TALENT_ID,
  STEADY_RENEWAL_TALENT_ID,
  SUPPRESSIVE_CONTROL_TALENT_ID,
  SYMPATHETIC_HEALING_TALENT_ID,
  TALENT_CATALOG,
  UNSTABLE_MAGIC_TALENT_ID,
  UNTOUCHABLE_TALENT_ID,
  UPLIFTING_PRESENCE_TALENT_ID,
  VOLATILE_ELEMENTS_TALENT_ID,
  WILD_INFUSION_TALENT_ID,
  BATTLE_RHYTHM_TALENT_ID,
  ARCANE_LOCK_TALENT_ID,
  ANCHORING_FORCE_TALENT_ID,
  ABSOLUTE_CONTROL_TALENT_ID,
} from "./talentCatalog";

export type TalentSpellMod = {
  talentId: string;
  name: string;
  effect: string;
  /** True when a live buff is currently modifying this cast. */
  live?: boolean;
};

const BLOCK_ABILITY_IDS = new Set([
  "handShield",
  "protectionBubble",
  "rockWall",
  "bulwarkCharge",
]);

const LINGERING_MOTION_ABILITY_IDS = new Set([
  "surge",
  "spiritForm",
  "predatorStep",
  ...FLOW_LINGERING_STATUS_IDS,
]);

function signedPct(frac: number): string {
  const pct = Math.round(frac * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function named(id: string, effect: string, live = false): TalentSpellMod {
  const talent = TALENT_CATALOG[id];
  return { talentId: id, name: talent?.name ?? id, effect, live };
}

function isDamageSpell(def: AbilityDef): boolean {
  return abilityHasTags(def, "Damage") || def.damage > 0;
}

function isMeleeSpell(def: AbilityDef): boolean {
  return abilityHasTags(def, "Melee");
}

function isRangedOffensive(def: AbilityDef): boolean {
  if (!isDamageSpell(def) || isMeleeSpell(def)) return false;
  return abilityHasTags(def, "Projectile") || def.range >= 5;
}

function isDisplacementSpell(def: AbilityDef): boolean {
  return abilityHasTags(def, "Knockback") || abilityHasTags(def, "Pull");
}

function isSilenceOrInterrupt(def: AbilityDef): boolean {
  return (
    abilityHasTags(def, "Silence") ||
    abilityHasTags(def, "Interrupt") ||
    abilityHasTags(def, "Fear")
  );
}

function isAllyShieldSpell(def: AbilityDef): boolean {
  return abilityHasTags(def, "Shield") && abilityHasTags(def, "Ally");
}

function hasElementalApply(def: AbilityDef): boolean {
  return isElementalAbility(def);
}

function cdMulLine(ability: AbilityDef, kit: CombatSessionKit): string | null {
  const mul = kit.cooldownMulByAbility.get(ability.id) ?? 1;
  if (mul >= 0.999) return null;
  const pct = Math.round((1 - mul) * 100);
  return `Cooldown ${pct}% shorter`;
}

/**
 * Talents that change this spell — rank-aware where the kit already baked numbers.
 */
export function talentModsForAbility(
  ability: AbilityDef,
  kit: CombatSessionKit,
  statusIds: ReadonlySet<string> = new Set(),
): TalentSpellMod[] {
  const lines: TalentSpellMod[] = [];
  const damage = isDamageSpell(ability);
  const melee = isMeleeSpell(ability);
  const elemental = hasElementalApply(ability);
  const flowMove = isFlowMovementAbility(ability);
  const travel = isFlowTravelAbility(ability);
  const control = isControlAbility(ability);
  const healKind = classifyHarmonyHeal(ability.id);
  const directHeal = healKind === "direct" || (ability.heal ?? 0) > 0;
  const hot = healKind === "hot" || abilityHasTags(ability, "HealOverTime");
  const harmonyHeal = directHeal || hot;
  const blocking = BLOCK_ABILITY_IDS.has(ability.id);
  const displace = isDisplacementSpell(ability);
  const liveCombatFlow = statusIds.has("combatFlow") && isFlowOffensiveConsume(ability);
  const liveFollowThrough = statusIds.has("followThrough") && isFlowOffensiveConsume(ability);
  const liveQuickRecovery =
    statusIds.has("quickRecovery") && isFlowQuickRecoveryConsume(ability);
  const liveMotionEcho =
    statusIds.has("motionEcho") && flowMove && kit.hasMotionEcho;
  const liveRepeat =
    statusIds.has("movementRepeatReady") && isRepeatableFlowMovement(ability);
  const liveImpact = statusIds.has("impactCatalyst") && elemental;
  const liveRelentlessAssault = statusIds.has("relentlessAssault") && damage;
  const liveBrokenCadence = statusIds.has("brokenCadence") && control;
  const liveChainPull = statusIds.has("chainPullReady") && displace;
  const liveBraced = statusIds.has("bracedAssault") && damage && melee;

  const push = (id: string, effect: string, live = false) => {
    lines.push(named(id, effect, live));
  };

  const cdLine = cdMulLine(ability, kit);
  if (cdLine) {
    lines.push({ talentId: "cooldown", name: "Talents", effect: cdLine });
  }

  // --- Destruction ---
  if (damage && kit.battleInstinctDmgBonus > 0) {
    push(
      BATTLE_INSTINCT_TALENT_ID,
      `Close-range hits (<3.5m) grant ${signedPct(kit.battleInstinctDmgBonus)} damage for 3s`,
    );
  }
  if (elemental && kit.secondaryEffectMul > 1.001) {
    push(
      INTENSIFIED_ELEMENTS_TALENT_ID,
      `Elemental burns, slows, and shocks ${signedPct(kit.secondaryEffectMul - 1)} stronger`,
    );
  }
  if (damage && kit.critDamageBonus > 0) {
    push(
      UNSTABLE_MAGIC_TALENT_ID,
      `Critical hits deal ${signedPct(kit.critDamageBonus)} more damage`,
    );
  }
  if (damage && kit.relentlessAssaultCdr > 0) {
    push(
      RELENTLESS_ASSAULT_TALENT_ID,
      liveRelentlessAssault
        ? `This cooldown will be ${Math.round(kit.relentlessAssaultCdr * 100)}% shorter`
        : `Two different offensive hits within 3s shorten your next non-M1 cooldown by ${Math.round(kit.relentlessAssaultCdr * 100)}%`,
      liveRelentlessAssault,
    );
  }
  if (elemental && kit.hasImpactCatalyst) {
    push(
      IMPACT_CATALYST_TALENT_ID,
      liveImpact
        ? `This hit applies 2 elemental stacks`
        : `After a movement, your next elemental hit applies 2 stacks`,
      liveImpact,
    );
  }
  if (elemental && kit.hasVolatileElements) {
    push(
      VOLATILE_ELEMENTS_TALENT_ID,
      `Applying a new element refreshes existing elemental DoTs on that target`,
    );
  }
  if (elemental && kit.elementalReachMul > 1.001 && (ability.range >= 5 || isElementalAoeAbility(ability))) {
    push(
      ELEMENTAL_REACH_TALENT_ID,
      `Range and area ${signedPct(kit.elementalReachMul - 1)}`,
    );
  }
  if (damage && kit.longShotDmgBonus > 0 && (ability.range >= 8 || abilityHasTags(ability, "Projectile"))) {
    push(
      LONG_SHOT_TALENT_ID,
      `Hits from 8.5m+ deal ${signedPct(kit.longShotDmgBonus)} more damage`,
    );
  }
  if (damage && kit.hasExecutionersRhythm) {
    push(
      EXECUTIONERS_RHYTHM_TALENT_ID,
      `Consecutive close hits (<3.5m) stack +8% damage, up to +24%`,
    );
  }
  if (kit.hasCloseTheGap) {
    if (isRangedOffensive(ability)) {
      push(CLOSE_THE_GAP_TALENT_ID, `Hitting with this empowers your next melee vs that target by +20%`);
    } else if (melee && damage) {
      push(CLOSE_THE_GAP_TALENT_ID, `After a ranged hit on the same target, this melee deals +20%`);
    }
  }
  if (damage && kit.hasElementalWeakness) {
    push(
      ELEMENTAL_WEAKNESS_TALENT_ID,
      `+15% damage vs targets with 2+ elemental statuses`,
    );
  }
  if (elemental && kit.hasDistilledElements) {
    push(
      DISTILLED_ELEMENTS_TALENT_ID,
      `Elemental statuses applied from 8.5m+ last 30% longer`,
    );
  }
  if (damage && kit.hasSniper && (ability.range >= 8 || abilityHasTags(ability, "Projectile"))) {
    push(SNIPER_TALENT_ID, `Every 3rd long-range hit is a guaranteed crit`);
  }
  if (melee && damage && kit.hasExposedAngle) {
    push(EXPOSED_ANGLE_TALENT_ID, `Melee hit exposes their flank: +20% from that direction for 3s`);
  }
  if (melee && damage && kit.hasWildInfusion) {
    push(WILD_INFUSION_TALENT_ID, `20% chance to apply a random elemental status`);
  }
  if (elemental && kit.hasElementalConvergence) {
    push(
      ELEMENTAL_CONVERGENCE_TALENT_ID,
      `Long-range hits trigger a bonus elemental burst`,
    );
  }
  if (damage && kit.hasCriticalRecovery) {
    push(
      CRITICAL_RECOVERY_TALENT_ID,
      `Crits cut remaining offensive cooldowns by 20%`,
    );
  }
  if (melee && damage && kit.hasBackstab) {
    push(BACKSTAB_TALENT_ID, `Hits from behind deal +25% damage`);
  }
  if (elemental && kit.hasElementalSurge) {
    push(
      ELEMENTAL_SURGE_TALENT_ID,
      `+15% elemental damage while 3+ elemental stacks are active on enemies`,
    );
  }
  if (damage && kit.hasCriticalMastery) {
    push(CRITICAL_MASTERY_TALENT_ID, `+20% critical strike chance`);
  }
  if (damage && kit.critChance > 0.051 && !kit.hasCriticalMastery) {
    // Unstable Magic already listed crit damage; skip extra crit-chance noise.
  }
  if (damage && kit.openingSalvoDmgBonus > 0) {
    lines.push({
      talentId: "openingSalvo",
      name: "Opening Salvo",
      effect: `First hit out of combat ${signedPct(kit.openingSalvoDmgBonus)} damage`,
    });
  }
  if (damage && kit.fifthSpellDmgBonus > 0) {
    lines.push({
      talentId: "fifthCadence",
      name: "Fifth Cadence",
      effect: `Every 5th damaging spell ${signedPct(kit.fifthSpellDmgBonus)} damage`,
    });
  }

  // --- Guardian ---
  if (isAllyShieldSpell(ability) && kit.reinforcedAidBonus > 0) {
    push(
      REINFORCED_AID_TALENT_ID,
      `Ally shields ${signedPct(kit.reinforcedAidBonus)} stronger and longer`,
    );
  }
  if (isAllyShieldSpell(ability) && kit.hasBastion) {
    push(BASTION_TALENT_ID, `Shielding an ally grants you both 12% damage reduction for 4s`);
  }
  if (
    kit.hasSharedProtection &&
    (abilityHasTags(ability, "Shield") || blocking || (flowMove && kit.hasPhaseShield))
  ) {
    push(SHARED_PROTECTION_TALENT_ID, `When you gain a shield, nearby allies get 50% of it`);
  }
  if (damage && kit.hasShieldedPower) {
    push(SHIELDED_POWER_TALENT_ID, `While you have a shield, this deals up to +12% more damage`);
  }
  if (flowMove && kit.hasFrontlineSupport) {
    push(
      FRONTLINE_SUPPORT_TALENT_ID,
      `Nearby allies gain a 5% max-HP shield for 3s`,
    );
  }
  if (blocking && kit.guardDisciplineShieldPct > 0) {
    push(
      GUARD_DISCIPLINE_TALENT_ID,
      `A successful block grants a ${Math.round(kit.guardDisciplineShieldPct * 100)}% max-HP shield`,
    );
  }
  if (blocking && kit.hasGuardedRecovery) {
    push(GUARDED_RECOVERY_TALENT_ID, `Intercepting a hit grants a 6% max-HP shield`);
  }
  if (blocking && kit.efficientGuardCdr > 0) {
    push(
      EFFICIENT_GUARD_TALENT_ID,
      `A successful block shortens defensive cooldowns by ${Math.round(kit.efficientGuardCdr * 100)}%`,
    );
  }
  if (blocking && kit.hasReflectiveGuard) {
    push(REFLECTIVE_GUARD_TALENT_ID, `Reflect 25% of blocked damage (capped at 8% of your max HP)`);
  }
  if (blocking && kit.hasPerfectDefense) {
    push(PERFECT_DEFENSE_TALENT_ID, `A successful block grants +25% block chance for 4s`);
  }
  if (blocking && kit.hasBracedAssault) {
    push(BRACED_ASSAULT_TALENT_ID, `A successful block empowers your next close hit by +20%`);
  }
  if (damage && melee && kit.hasBracedAssault) {
    push(
      BRACED_ASSAULT_TALENT_ID,
      liveBraced ? `This close hit deals +20% (block empower)` : `After a block, this close hit deals +20%`,
      liveBraced,
    );
  }
  if (abilityHasTags(ability, "Defense") && kit.protectiveInstinctReducePct > 0) {
    lines.push({
      talentId: "protectiveInstinct",
      name: "Protective Instinct",
      effect: `Casting this grants a nearby ally ${Math.round(kit.protectiveInstinctReducePct)}% damage reduction`,
    });
  }

  // --- Control ---
  if (control && kit.disruptiveForceBonus > 0 && isSilenceOrInterrupt(ability)) {
    push(
      DISRUPTIVE_FORCE_TALENT_ID,
      `Silences, fears, and interrupts last ${signedPct(kit.disruptiveForceBonus)} longer`,
    );
  }
  if (
    control &&
    kit.lingeringControlBonus > 0 &&
    (abilityHasTags(ability, "Slow") || abilityHasTags(ability, "Root") || abilityHasTags(ability, "GroundEffect"))
  ) {
    push(
      LINGERING_CONTROL_TALENT_ID,
      `Slows, roots, and traps last ${signedPct(kit.lingeringControlBonus)} longer`,
    );
  }
  if (displace && kit.displacementMul > 1.001) {
    push(
      FORCEFUL_MANIPULATION_TALENT_ID,
      `Push / pull distance ${signedPct(kit.displacementMul - 1)}`,
    );
  }
  if (control && kit.brokenCadenceCdr > 0) {
    push(
      BROKEN_CADENCE_TALENT_ID,
      liveBrokenCadence
        ? `This cooldown will be ${Math.round(kit.brokenCadenceCdr * 100)}% shorter`
        : `Interrupting an enemy shortens your next control cooldown by ${Math.round(kit.brokenCadenceCdr * 100)}%`,
      liveBrokenCadence,
    );
  }
  if (control && kit.hasForbiddenGround) {
    push(FORBIDDEN_GROUND_TALENT_ID, `Controlled enemies cast 10% slower for 2.5s`);
  }
  if (control && kit.controlMomentumBonus > 0) {
    push(
      CONTROL_MOMENTUM_TALENT_ID,
      `New control on an already-controlled target lasts ${signedPct(kit.controlMomentumBonus)} longer`,
    );
  }
  if (displace && kit.hasAnchoringForce) {
    push(ANCHORING_FORCE_TALENT_ID, `A successful displace roots them for 0.6s`);
  }
  if (displace && kit.hasChainPull) {
    push(
      CHAIN_PULL_TALENT_ID,
      liveChainPull ? `This displace is +20% stronger` : `A successful displace empowers your next displace by +20%`,
      liveChainPull,
    );
  }
  if (control && isSilenceOrInterrupt(ability) && kit.hasSilencingPressure) {
    push(SILENCING_PRESSURE_TALENT_ID, `A successful interrupt also silences for 0.6s`);
  }
  if (control && kit.hasSuppressiveControl) {
    push(SUPPRESSIVE_CONTROL_TALENT_ID, `Controlled enemies deal 12% less damage for 3s`);
  }
  if (control && kit.controlRangeMul > 1.001) {
    const bits: string[] = [];
    if (ability.range > 0) bits.push(`range ${signedPct(kit.controlRangeMul - 1)}`);
    if (isControlAoeAbility(ability) && kit.controlAoeRadiusMul > 1.001) {
      bits.push(`area ${signedPct(kit.controlAoeRadiusMul - 1)}`);
    }
    if (bits.length) push(EXPANDED_CONTROL_TALENT_ID, bits.join(" · "));
  }
  if (displace && kit.hasDistortedWake) {
    push(DISTORTED_WAKE_TALENT_ID, `Displaced enemies leave a 2.5s 20% slow trail`);
  }
  if (displace && kit.hasRepositioningMastery) {
    push(
      REPOSITIONING_MASTERY_TALENT_ID,
      `After this displace, the next enemy that hits you is rooted for 0.8s`,
    );
  }
  if (control && kit.hasArcaneLock) {
    push(ARCANE_LOCK_TALENT_ID, `Hard CC Arcane Locks the target: your next CC on them lasts 15% longer`);
  }
  if (isSilenceOrInterrupt(ability) && kit.hasPunishingSilence) {
    push(PUNISHING_SILENCE_TALENT_ID, `Interrupting or silencing grants you +15% move speed for 3s`);
  }
  if (displace && kit.hasContainment) {
    push(CONTAINMENT_TALENT_ID, `Displaced enemies dash 25% shorter and gain less haste for 3s`);
  }
  if (displace && kit.hasSpatialInstability) {
    push(
      SPATIAL_INSTABILITY_TALENT_ID,
      `Displaced enemies root themselves if they finish a movement within 4s`,
    );
  }
  if (control && kit.absoluteControlBonus > 0) {
    push(
      ABSOLUTE_CONTROL_TALENT_ID,
      `Crowd control lasts ${signedPct(kit.absoluteControlBonus)} longer`,
    );
  }
  if (displace && kit.hasDisorientation) {
    push(DISORIENTATION_TALENT_ID, `25% chance to reverse their movement keys for 1.5s`);
  }

  // --- Flow ---
  if (flowMove && kit.fleetFootedMovePct > 0) {
    push(
      FLEET_FOOTED_TALENT_ID,
      `After this move, ${signedPct(kit.fleetFootedMovePct)} move speed for 2s`,
    );
  }
  if (kit.combatFlowHastePct > 0 && (flowMove || isFlowOffensiveConsume(ability))) {
    push(
      COMBAT_FLOW_TALENT_ID,
      liveCombatFlow
        ? `This cast is ${Math.round(kit.combatFlowHastePct * 100)}% faster`
        : flowMove
          ? `Your next damaging spell casts ${Math.round(kit.combatFlowHastePct * 100)}% faster for 3s`
          : `After a movement, this spell casts ${Math.round(kit.combatFlowHastePct * 100)}% faster`,
      liveCombatFlow,
    );
  }
  if (kit.quickRecoveryCdr > 0 && (flowMove || abilityHasTags(ability, "Defense"))) {
    push(
      QUICK_RECOVERY_TALENT_ID,
      liveQuickRecovery
        ? `This cooldown will be ${Math.round(kit.quickRecoveryCdr * 100)}% shorter`
        : flowMove
          ? `Your next defensive or movement cooldown is ${Math.round(kit.quickRecoveryCdr * 100)}% shorter`
          : `After a movement, this cooldown is ${Math.round(kit.quickRecoveryCdr * 100)}% shorter`,
      liveQuickRecovery,
    );
  }
  if (flowMove && (kit.hasSecondWind || kit.hasFlowRenewal)) {
    if (kit.hasFlowRenewal) {
      push(FLOW_RENEWAL_TALENT_ID, `If you are below 60% health, heal 8% max HP`);
    } else {
      push(SECOND_WIND_TALENT_ID, `If you are below 50% health, heal 6% max HP`);
    }
  }
  if (kit.followThroughRangePct > 0 && (flowMove || isFlowOffensiveConsume(ability))) {
    push(
      FOLLOW_THROUGH_TALENT_ID,
      liveFollowThrough
        ? `This spell has ${Math.round(kit.followThroughRangePct * 100)}% more range`
        : flowMove
          ? `Your next damaging spell gains ${Math.round(kit.followThroughRangePct * 100)}% range for 3s`
          : `After a movement, this spell gains ${Math.round(kit.followThroughRangePct * 100)}% range`,
      liveFollowThrough,
    );
  }
  if (travel && kit.extendedReachMul > 1.001) {
    push(EXTENDED_REACH_TALENT_ID, `Travels ${signedPct(kit.extendedReachMul - 1)} farther`);
  }
  if (LINGERING_MOTION_ABILITY_IDS.has(ability.id) && kit.lingeringMotionMul > 1.001) {
    push(LINGERING_MOTION_TALENT_ID, `Timed movement state lasts ${signedPct(kit.lingeringMotionMul - 1)} longer`);
  }
  if (flowMove && kit.hasUntouchable) {
    push(UNTOUCHABLE_TALENT_ID, `1.5s of 15% damage reduction; new roots/slows/stuns/fears 25% shorter`);
  }
  if (flowMove && kit.hasReboundWindow) {
    push(
      REBOUND_WINDOW_TALENT_ID,
      `For 3s, the first direct hit you deal or take refunds 18% of this cooldown`,
    );
  }
  if (isRepeatableFlowMovement(ability) && kit.hasDoubleStep) {
    if (kit.hasEchoStep) {
      push(ECHO_STEP_TALENT_ID, `Recast this Space move once within 3s at full distance`);
    } else {
      push(DOUBLE_STEP_TALENT_ID, `Recast this Space move once within 2.5s at 75% travel`);
    }
  }
  if (liveRepeat) {
    const id = kit.hasEchoStep ? ECHO_STEP_TALENT_ID : DOUBLE_STEP_TALENT_ID;
    const existing = lines.find((l) => l.talentId === id);
    if (existing) existing.live = true;
  }
  if (flowMove && kit.hasMotionEcho) {
    push(
      MOTION_ECHO_TALENT_ID,
      liveMotionEcho
        ? `This different movement travels 15% farther`
        : `Your next different movement travels 15% farther for 4s`,
      liveMotionEcho,
    );
  }
  if (flowMove && kit.hasAfterimage && !kit.hasFalseTrail) {
    push(AFTERIMAGE_TALENT_ID, `Leaves a 1.5s afterimage at your start position`);
  }
  if (flowMove && kit.hasFalseTrail) {
    push(FALSE_TRAIL_TALENT_ID, `Afterimage lasts 2s and slides along your path`);
  }
  if (flowMove && kit.hasPhaseShield) {
    push(PHASE_SHIELD_TALENT_ID, `Gain a 6% max-HP shield for 3s`);
  }
  if (flowMove && kit.hasRelentlessPursuit) {
    push(
      RELENTLESS_PURSUIT_TALENT_ID,
      statusIds.has("flowEngage") || statusIds.has("relentlessPursuit")
        ? statusIds.has("relentlessPursuit")
          ? `+15% move speed (active)`
          : `Deal or take damage now to gain +15% move speed for 3s`
        : `Deal or take damage within 3s to gain +15% move speed for 3s`,
      statusIds.has("relentlessPursuit") || statusIds.has("flowEngage"),
    );
  }
  if (flowMove && kit.hasMomentumEngine) {
    push(
      MOMENTUM_ENGINE_TALENT_ID,
      statusIds.has("momentumEngine")
        ? `+15% move speed and movement cooldowns recover faster (active)`
        : `Deal or take damage within 3s for +15% move speed and faster movement cooldowns`,
      statusIds.has("momentumEngine") || statusIds.has("flowEngage"),
    );
  }
  if (flowMove && kit.hasPhantomChain) {
    push(PHANTOM_CHAIN_TALENT_ID, `Each move banks a charge (3). At 3, the next move spends them on a sliding afterimage`);
  }

  // --- Harmony ---
  if (directHeal && kit.restorativeTouchMul > 1.001) {
    push(RESTORATIVE_TOUCH_TALENT_ID, `Direct heals ${signedPct(kit.restorativeTouchMul - 1)}`);
  }
  if (hot && kit.lingeringGraceMul > 1.001) {
    push(LINGERING_GRACE_TALENT_ID, `HoTs last ${signedPct(kit.lingeringGraceMul - 1)} longer`);
  }
  if (harmonyHeal && kit.empathicSurgePct > 0) {
    push(
      EMPATHIC_SURGE_TALENT_ID,
      `Healing another ally grants them ${signedPct(kit.empathicSurgePct)} move speed for 2.5s`,
    );
  }
  if (directHeal && kit.emergencyResponseMul > 1.001) {
    push(
      EMERGENCY_RESPONSE_TALENT_ID,
      `Direct heals on allies below 40% health are ${signedPct(kit.emergencyResponseMul - 1)} stronger`,
    );
  }
  if (directHeal && kit.hasOverflowingGrace) {
    push(OVERFLOWING_GRACE_TALENT_ID, `40% of overheal becomes a 4s HoT`);
  }
  if (hot && kit.steadyRenewalRank > 0) {
    push(
      STEADY_RENEWAL_TALENT_ID,
      `Each consecutive tick on the same HoT heals ${kit.steadyRenewalRank === 1 ? 2 : 4}% more (max 3)`,
    );
  }
  if (hot && kit.hasUpliftingPresence) {
    push(UPLIFTING_PRESENCE_TALENT_ID, `Allies with this HoT gain +7% move speed`);
  }
  if (harmonyHeal && kit.hasInspiringRecovery) {
    push(INSPIRING_RECOVERY_TALENT_ID, `Healing another ally grants them +8% cast speed for 2s`);
  }
  if (directHeal && kit.hasLastingRescue) {
    push(LASTING_RESCUE_TALENT_ID, `Healing an ally below 35% health grants them 12% damage reduction for 2.5s`);
  }
  if (directHeal && kit.hasMendingEcho) {
    push(MENDING_ECHO_TALENT_ID, `20% of the heal repeats on the same target after 2s`);
  }
  if (hot && kit.hasPersistentGrace) {
    push(PERSISTENT_GRACE_TALENT_ID, `When this HoT expires naturally, the last tick heals for 175%`);
  }
  if (hot && kit.hasHarmoniousGrowth) {
    push(HARMONIOUS_GROWTH_TALENT_ID, `After 3 ticks: +10% move and +10% cast speed for 3s`);
  }
  if (harmonyHeal && kit.hasEmpoweredRecovery) {
    push(
      EMPOWERED_RECOVERY_TALENT_ID,
      `Healing an ally above 80% health grants +10% damage and +8% cast speed for 3s`,
    );
  }
  if (directHeal && kit.hasOverflowingRenewal) {
    push(OVERFLOWING_RENEWAL_TALENT_ID, `If they already have your HoT, extend it 1s and boost the next tick 15%`);
  }
  if (hot && kit.hasRenewingHarmony) {
    push(RENEWING_HARMONY_TALENT_ID, `With 2+ of your HoTs active, applying another refreshes all of them`);
  }
  if (harmonyHeal && kit.hasSympatheticHealing) {
    push(SYMPATHETIC_HEALING_TALENT_ID, `You heal for 25% of effective healing done to other allies`);
  }
  if (harmonyHeal && kit.hasBattleRhythm) {
    push(BATTLE_RHYTHM_TALENT_ID, `Healing pulses damage in 3m and stacks Rhythm (+3% move/cast, max 3)`);
  }
  if (hot && kit.hasEverlastingGrace) {
    push(EVERLASTING_GRACE_TALENT_ID, `While you have 3+ HoTs, they tick 25% faster`);
  }
  if (harmonyHeal && kit.hasResonance) {
    push(RESONANCE_TALENT_ID, `Healing builds Resonance (3): then +12% damage and +10% damage reduction for 4s`);
  }

  // Spell-unlock nodes: only when hovering that spell.
  const unlock = Object.values(TALENT_CATALOG).find((t) => t.spellId === ability.id);
  if (unlock && ABILITIES[ability.id]) {
    const already = lines.some((l) => l.talentId === unlock.id);
    if (!already) {
      lines.push({
        talentId: unlock.id,
        name: unlock.name,
        effect: "Unlocked by this talent",
      });
    }
  }

  return dedupeMods(lines);
}

function dedupeMods(lines: TalentSpellMod[]): TalentSpellMod[] {
  const seen = new Set<string>();
  const out: TalentSpellMod[] = [];
  for (const line of lines) {
    const key = `${line.talentId}:${line.effect}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
