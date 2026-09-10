/**
 * Uniform 5-tier talent catalog (21 nodes per tree across 5 trees).
 * Destruction, Guardian, Control, Flow, and Harmony use the same 3-5-5-5-3 grid.
 */
import type { SpellTag } from "./abilities";

export type TalentTreeId =
  | "Destruction"
  | "Guardian"
  | "Flow"
  | "Harmony"
  | "Control";

export type TalentNodeType = "passive" | "spell";

export type CatalogTalentDef = {
  id: string;
  tree: TalentTreeId;
  tier: number;
  requiredPoints: number;
  name: string;
  /** Cost per rank invested (typically 1). */
  pointCost: number;
  /** Max ranks (3 for T1 foundations, 2 for T2 hybrids/bridges, 1 for keystones/capstones/spells). */
  maxRank?: number;
  /** Visual column ordering within the tier grid (0 = leftmost). */
  layoutOrder?: number;
  /** Node type: "passive" (default circular node) or "spell" (active ability unlock, diamond node). */
  type?: TalentNodeType;
  /** Alias for type to support both conventions */
  nodeType?: TalentNodeType;
  /** Linked ability ID when this talent unlocks a spell (e.g. "elementalOverload"). */
  spellId?: string;
  /** Extra parents beyond the standard lattice links if needed. */
  requires?: readonly string[];
  affectedTags: readonly SpellTag[];
  exactEffect: string;
  balanceNote: string;
  status: "catalog";
  /** Combat-ready (live in resolveKit / CombatSystem). */
  implemented?: boolean;
  /** Hidden from the tree UI. */
  hidden?: boolean;
};

/** True only when explicitly marked combat-ready. */
export function isCatalogTalentImplemented(def: CatalogTalentDef | undefined): boolean {
  return def?.implemented === true;
}

/** True when this talent node unlocks an active spell rather than a passive trait. */
export function isSpellTalent(def: CatalogTalentDef | undefined): boolean {
  if (!def) return false;
  return (
    def.type === "spell" ||
    def.nodeType === "spell" ||
    Boolean(def.spellId) ||
    def.id === "DES_16"
  );
}

// ============================================================================
// Destruction Talent IDs & Constants
// ============================================================================
export const BATTLE_INSTINCT_TALENT_ID = "DES_01";
export const INTENSIFIED_ELEMENTS_TALENT_ID = "DES_02";
export const UNSTABLE_MAGIC_TALENT_ID = "DES_03";
export const RELENTLESS_ASSAULT_TALENT_ID = "DES_04";
export const IMPACT_CATALYST_TALENT_ID = "DES_05";
export const VOLATILE_ELEMENTS_TALENT_ID = "DES_06";
export const ELEMENTAL_REACH_TALENT_ID = "DES_07";
export const LONG_SHOT_TALENT_ID = "DES_08";
export const EXECUTIONERS_RHYTHM_TALENT_ID = "DES_09";
export const CLOSE_THE_GAP_TALENT_ID = "DES_10";
export const ELEMENTAL_WEAKNESS_TALENT_ID = "DES_11";
export const DISTILLED_ELEMENTS_TALENT_ID = "DES_12";
export const SNIPER_TALENT_ID = "DES_13";
export const EXPOSED_ANGLE_TALENT_ID = "DES_14";
export const WILD_INFUSION_TALENT_ID = "DES_15";
export const ELEMENTAL_OVERLOAD_TALENT_ID = "DES_16";
export const ELEMENTAL_CONVERGENCE_TALENT_ID = "DES_17";
export const CRITICAL_RECOVERY_TALENT_ID = "DES_18";
export const BACKSTAB_TALENT_ID = "DES_19";
export const ELEMENTAL_SURGE_TALENT_ID = "DES_20";
export const CRITICAL_MASTERY_TALENT_ID = "DES_21";

// Legacy exports for backwards compatibility
export const OPENING_SALVO_TALENT_ID = "DES_08";
export const FIFTH_CADENCE_TALENT_ID = "DES_09";
export const CRITICAL_FOCUS_TALENT_ID = "DES_10";
export const ELEMENTAL_QUICKNESS_TALENT_ID = "DES_11";
export const WIDENED_ELEMENTS_TALENT_ID = "DES_12";
export const OPENING_SALVO_BONUS_PERCENT_AT_MAX = 8;
export const OPENING_SALVO_COOLDOWN_MS = 8_000;
export function openingSalvoBonusPercent(_rank: number, _maxRank = 3): number {
  return 0;
}
export const FIFTH_CADENCE_DAMAGE_PERCENT = 15;
export const FIFTH_CADENCE_SPELL_INTERVAL = 5;
export const CRITICAL_FOCUS_PERCENT_AT_MAX = 6;
export function criticalFocusCritChancePercent(_rank: number, _maxRank = 3): number {
  return 0;
}
export const ELEMENTAL_QUICKNESS_CDR_PERCENT_AT_MAX = 15;
export function elementalQuicknessCdrPercent(_rank: number, _maxRank = 3): number {
  return 0;
}
export const WIDENED_ELEMENTS_AOE_PERCENT = 10;

/** Battle Instinct: +3% / +6% / +9% damage for 3s on close-range hit (< 3.5m). */
export function battleInstinctBonusPercent(rank: number, maxRank = 3): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return (9 * r) / maxRank;
}

/** Intensified Elements: +5% / +10% / +15% elemental effect potency. */
export function intensifiedElementsPercent(rank: number, maxRank = 3): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return (15 * r) / maxRank;
}

/** Unstable Magic: +5% / +10% / +15% critical strike damage bonus. */
export function unstableMagicCritDamagePercent(rank: number, maxRank = 3): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return (15 * r) / maxRank;
}

/** Relentless Assault: 10% / 20% CDR on next non-primary offensive ability. */
export function relentlessAssaultCdrPercent(rank: number, maxRank = 2): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return (20 * r) / maxRank;
}

/** Elemental Reach: +7.5% / +15% range and AoE size for ranged elemental spells. */
export function elementalReachPercent(rank: number, maxRank = 2): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return (15 * r) / maxRank;
}

/** Long Shot: +7.5% / +15% damage for hits from >= 8.5m. */
export function longShotDamagePercent(rank: number, maxRank = 2): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return (15 * r) / maxRank;
}

// ============================================================================
// Other Trees' Key IDs & Scaling Helpers
// ============================================================================
export const REINFORCED_AID_TALENT_ID = "GUA_01";
export const BATTLE_HARDENED_TALENT_ID = "GUA_02";
export const GUARD_DISCIPLINE_TALENT_ID = "GUA_03";
export const SHARED_PROTECTION_TALENT_ID = "GUA_04";
export const FRONTLINE_SUPPORT_TALENT_ID = "GUA_05";
export const UNDER_PRESSURE_TALENT_ID = "GUA_06";
export const BRACED_ASSAULT_TALENT_ID = "GUA_07";
export const EFFICIENT_GUARD_TALENT_ID = "GUA_08";
export const GUARDIANS_PRESENCE_TALENT_ID = "GUA_09";
export const SHIELDED_POWER_TALENT_ID = "GUA_10";
export const UNBREAKABLE_TALENT_ID = "GUA_11";
export const DEFLECT_TALENT_ID = "GUA_12";
export const GUARDED_RECOVERY_TALENT_ID = "GUA_13";
export const GUARDIANS_BLESSING_TALENT_ID = "GUA_14";
export const AEGIS_MOMENTUM_TALENT_ID = "GUA_15";
export const FORTIFIED_RESOLVE_TALENT_ID = "GUA_16";
export const STEEL_REFLEXES_TALENT_ID = "GUA_17";
export const REFLECTIVE_GUARD_TALENT_ID = "GUA_18";
export const BASTION_TALENT_ID = "GUA_19";
export const LIVING_FORTRESS_TALENT_ID = "GUA_20";
export const PERFECT_DEFENSE_TALENT_ID = "GUA_21";

/** Backwards-compatible alias for legacy GUA_01 reference. */
export const PROTECTIVE_INSTINCT_TALENT_ID = "GUA_01";
export const PROTECTIVE_INSTINCT_PERCENT_PER_RANK = 2;
export const PROTECTIVE_INSTINCT_DURATION_MS = 3_000;
export const PROTECTIVE_INSTINCT_COOLDOWN_MS = 6_000;
export function protectiveInstinctReducePercent(rank: number, maxRank = 3): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return PROTECTIVE_INSTINCT_PERCENT_PER_RANK * r;
}

export const DISRUPTIVE_FORCE_TALENT_ID = "CON_01";
export const LINGERING_CONTROL_TALENT_ID = "CON_02";
export const FORCEFUL_MANIPULATION_TALENT_ID = "CON_03";
export const BROKEN_CADENCE_TALENT_ID = "CON_04";
export const FORBIDDEN_GROUND_TALENT_ID = "CON_05";
export const CONTROL_MOMENTUM_TALENT_ID = "CON_06";
export const ANCHORING_FORCE_TALENT_ID = "CON_07";
export const CHAIN_PULL_TALENT_ID = "CON_08";
export const SILENCING_PRESSURE_TALENT_ID = "CON_09";
export const SUPPRESSIVE_CONTROL_TALENT_ID = "CON_10";
export const EXPANDED_CONTROL_TALENT_ID = "CON_11";
export const DISTORTED_WAKE_TALENT_ID = "CON_12";
export const REPOSITIONING_MASTERY_TALENT_ID = "CON_13";
export const ARCANE_LOCK_TALENT_ID = "CON_14";
export const PUNISHING_SILENCE_TALENT_ID = "CON_15";
export const BINDING_SIGIL_TALENT_ID = "CON_16";
export const CONTAINMENT_TALENT_ID = "CON_17";
export const SPATIAL_INSTABILITY_TALENT_ID = "CON_18";
export const MASS_SILENCE_TALENT_ID = "CON_19";
export const ABSOLUTE_CONTROL_TALENT_ID = "CON_20";
export const DISORIENTATION_TALENT_ID = "CON_21";

export const CONTROL_FOUNDATION_PERCENT_PER_RANK = 5;
export function controlFoundationPercent(rank: number, maxRank = 3): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return CONTROL_FOUNDATION_PERCENT_PER_RANK * r;
}

export function brokenCadenceCdrPercent(rank: number): number {
  if (rank <= 0) return 0;
  return rank >= 2 ? 20 : 10;
}

export function controlMomentumPercent(rank: number): number {
  if (rank <= 0) return 0;
  return rank >= 2 ? 10 : 5;
}

export const FLEET_FOOTED_TALENT_ID = "FLO_01";
export const COMBAT_FLOW_TALENT_ID = "FLO_02";
export const FLUID_MOTION_TALENT_ID = "FLO_03";
export const QUICK_RECOVERY_TALENT_ID = "FLO_04";
export const SECOND_WIND_TALENT_ID = "FLO_05";
export const FOLLOW_THROUGH_TALENT_ID = "FLO_06";
export const EXTENDED_REACH_TALENT_ID = "FLO_07";
export const LINGERING_MOTION_TALENT_ID = "FLO_08";
export const UNTOUCHABLE_TALENT_ID = "FLO_09";
export const REBOUND_WINDOW_TALENT_ID = "FLO_10";
export const DOUBLE_STEP_TALENT_ID = "FLO_11";
export const MOTION_ECHO_TALENT_ID = "FLO_12";
export const AFTERIMAGE_TALENT_ID = "FLO_13";
export const PHASE_SHIELD_TALENT_ID = "FLO_14";
export const FLOW_RENEWAL_TALENT_ID = "FLO_15";
export const RELENTLESS_PURSUIT_TALENT_ID = "FLO_16";
export const FALSE_TRAIL_TALENT_ID = "FLO_17";
export const TRIPLE_BLINK_TALENT_ID = "FLO_18";
export const ECHO_STEP_TALENT_ID = "FLO_19";
export const MOMENTUM_ENGINE_TALENT_ID = "FLO_20";
export const PHANTOM_CHAIN_TALENT_ID = "FLO_21";

export const FLUID_MOTION_PERCENT_PER_RANK = 3;
export function fluidMotionMoveSpeedPercent(rank: number, maxRank = 3): number {
  const r = Math.max(0, Math.min(maxRank, Math.floor(rank)));
  if (r <= 0) return 0;
  return FLUID_MOTION_PERCENT_PER_RANK * r;
}

export function fleetFootedMoveSpeedPercent(rank: number): number {
  if (rank <= 0) return 0;
  if (rank >= 3) return 15;
  if (rank === 2) return 10;
  return 5;
}

export function combatFlowHastePercent(rank: number): number {
  if (rank <= 0) return 0;
  if (rank >= 3) return 15;
  if (rank === 2) return 10;
  return 5;
}

export function quickRecoveryCdrPercent(rank: number): number {
  if (rank <= 0) return 0;
  return rank >= 2 ? 14 : 7;
}

export function followThroughRangePercent(rank: number): number {
  if (rank <= 0) return 0;
  return rank >= 2 ? 20 : 10;
}

export function extendedReachPercent(rank: number): number {
  if (rank <= 0) return 0;
  return rank >= 2 ? 15 : 8;
}

export function lingeringMotionPercent(rank: number): number {
  if (rank <= 0) return 0;
  return rank >= 2 ? 20 : 10;
}

export const RESTORATIVE_TOUCH_TALENT_ID = "HAR_01";
export const LINGERING_GRACE_TALENT_ID = "HAR_02";
export const EMPATHIC_SURGE_TALENT_ID = "HAR_03";
export const EMERGENCY_RESPONSE_TALENT_ID = "HAR_04";
export const OVERFLOWING_GRACE_TALENT_ID = "HAR_05";
export const STEADY_RENEWAL_TALENT_ID = "HAR_06";
export const UPLIFTING_PRESENCE_TALENT_ID = "HAR_07";
export const INSPIRING_RECOVERY_TALENT_ID = "HAR_08";
export const LASTING_RESCUE_TALENT_ID = "HAR_09";
export const MENDING_ECHO_TALENT_ID = "HAR_10";
export const PERSISTENT_GRACE_TALENT_ID = "HAR_11";
export const HARMONIOUS_GROWTH_TALENT_ID = "HAR_12";
export const EMPOWERED_RECOVERY_TALENT_ID = "HAR_13";
export const GUARDIAN_ANGEL_TALENT_ID = "HAR_14";
export const OVERFLOWING_RENEWAL_TALENT_ID = "HAR_15";
export const RENEWING_HARMONY_TALENT_ID = "HAR_16";
export const SYMPATHETIC_HEALING_TALENT_ID = "HAR_17";
export const BATTLE_RHYTHM_TALENT_ID = "HAR_18";
export const LASTING_GRACE_TALENT_ID = "HAR_19";
export const EVERLASTING_GRACE_TALENT_ID = "HAR_20";
export const RESONANCE_TALENT_ID = "HAR_21";

/** @deprecated HAR_01 Overflow (overheal→shield) was replaced by Restorative Touch. */
export const OVERFLOW_TALENT_ID = "HAR_01";

// ============================================================================
// Full 5-Tree Catalog Definition (21 Nodes Each, 3-5-5-5-3 Grid)
// ============================================================================
export const TALENT_CATALOG: Record<string, CatalogTalentDef> = {
  // --------------------------------------------------------------------------
  // DESTRUCTION TREE (21 Nodes)
  // --------------------------------------------------------------------------
  // Tier 1: Foundations (Cols 0, 2, 4)
  "DES_01": {
    id: "DES_01",
    tree: "Destruction",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 0,
    name: "Battle Instinct",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Damage", "Melee"] as const,
    exactEffect: "Dealing damage to an enemy at close range (< 3.5m) grants +9% damage for 3 seconds.",
    balanceNote: "+3% / +6% / +9% damage across ranks. Refreshed on close-range hit.",
    status: "catalog",
    implemented: true,
  },
  "DES_02": {
    id: "DES_02",
    tree: "Destruction",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 1,
    name: "Intensified Elements",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Damage", "DamageOverTime", "Debuff"] as const,
    exactEffect:
      "Elemental secondary effects are 15% stronger (longer burns, poisons, bleeds; harder slows; stronger shock vulnerability).",
    balanceNote: "+5% / +10% / +15% elemental effect potency across ranks.",
    status: "catalog",
    implemented: true,
  },
  "DES_03": {
    id: "DES_03",
    tree: "Destruction",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 2,
    name: "Unstable Magic",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Damage"] as const,
    exactEffect: "Critical strikes deal +15% more damage.",
    balanceNote: "+5% / +10% / +15% critical strike damage across ranks.",
    status: "catalog",
    implemented: true,
  },

  // Tier 2: Bridges & Expansion (Cols 0, 1, 2, 3, 4)
  "DES_04": {
    id: "DES_04",
    tree: "Destruction",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 0,
    name: "Relentless Assault",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Damage", "Combo", "Cooldown"] as const,
    exactEffect:
      "Hitting an enemy with two different offensive abilities within 3s reduces the cooldown of your next non-primary offensive ability by 20%.",
    balanceNote: "10% / 20% CDR across ranks on next non-M1 offensive ability entering cooldown.",
    status: "catalog",
    implemented: true,
  },
  "DES_05": {
    id: "DES_05",
    tree: "Destruction",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 1,
    name: "Impact Catalyst",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Damage", "Debuff"] as const,
    exactEffect:
      "After using a movement ability, your next elemental ability applies 2 stacks of its elemental status instead of 1.",
    balanceNote: "Movement triggers buff; next elemental hit applies 2 stacks (burn duration +50%).",
    status: "catalog",
    implemented: true,
  },
  "DES_06": {
    id: "DES_06",
    tree: "Destruction",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 2,
    name: "Volatile Elements",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "DamageOverTime", "Debuff"] as const,
    exactEffect:
      "Applying a new elemental type to an enemy refreshes the duration of their existing elemental damage-over-time and debuff effects (6s internal cooldown per target).",
    balanceNote: "Refreshes existing Fire, Poison, Frost, and Shock durations when a new element is applied.",
    status: "catalog",
    implemented: true,
  },
  "DES_07": {
    id: "DES_07",
    tree: "Destruction",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 3,
    name: "Elemental Reach",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Area", "Projectile", "Damage"] as const,
    exactEffect: "Increases the range and area of effect of ranged elemental abilities by 15%.",
    balanceNote: "+7.5% / +15% range and AoE size across ranks.",
    status: "catalog",
    implemented: true,
  },
  "DES_08": {
    id: "DES_08",
    tree: "Destruction",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 4,
    name: "Long Shot",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Damage", "Projectile", "SingleTarget"] as const,
    exactEffect: "Abilities that hit enemies from long range (>= 8.5m) deal +15% increased damage.",
    balanceNote: "+7.5% / +15% damage across ranks.",
    status: "catalog",
    implemented: true,
  },

  // Tier 3: Specialization (Cols 0, 1, 2, 3, 4)
  "DES_09": {
    id: "DES_09",
    tree: "Destruction",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 0,
    name: "Executioner's Rhythm",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Melee", "Combo"] as const,
    exactEffect:
      "Each consecutive close-range hit (< 3.5m) grants +8% damage to your next close-range hit, stacking up to 3 times (+24%). Lost if moving away or after 3s without a hit.",
    balanceNote: "Stacks up to 3 times (+24% max). Reset if out of close range.",
    status: "catalog",
    implemented: true,
  },
  "DES_10": {
    id: "DES_10",
    tree: "Destruction",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 1,
    name: "Close the Gap",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Melee", "Projectile"] as const,
    exactEffect:
      "Hitting an enemy with a ranged offensive ability empowers your next melee ability against that target within 4s to deal +20% damage.",
    balanceNote: "Target-specific melee empowerment.",
    status: "catalog",
    implemented: true,
  },
  "DES_11": {
    id: "DES_11",
    tree: "Destruction",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 2,
    name: "Elemental Weakness",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Debuff"] as const,
    exactEffect: "Enemies affected by 2 or more elemental statuses take +15% increased damage from you.",
    balanceNote: "Counts active Fire, Frost, Poison, or Shock debuffs on the target.",
    status: "catalog",
    implemented: true,
  },
  "DES_12": {
    id: "DES_12",
    tree: "Destruction",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 3,
    name: "Distilled Elements",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["DamageOverTime", "Debuff", "Projectile"] as const,
    exactEffect: "Elemental statuses applied from long range (>= 8.5m) last 30% longer.",
    balanceNote: "+30% duration for elemental statuses applied from range.",
    status: "catalog",
    implemented: true,
  },
  "DES_13": {
    id: "DES_13",
    tree: "Destruction",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 4,
    name: "Sniper",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Projectile"] as const,
    exactEffect:
      "Successful long-range hits (>= 8.5m) build Sniper stacks. Every 3rd long-range hit is guaranteed to critically strike.",
    balanceNote: "Guaranteed critical strike on every 3rd qualifying long-range hit.",
    status: "catalog",
    implemented: true,
  },

  // Tier 4: Keystones & Power (Cols 0, 1, 2, 3, 4)
  "DES_14": {
    id: "DES_14",
    tree: "Destruction",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 0,
    name: "Exposed Angle",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Melee", "Debuff"] as const,
    exactEffect:
      "A melee hit exposes the target's flank for 3 seconds. Attacking from the exposed direction deals +20% damage (5s cooldown per target).",
    balanceNote: "Directional 90-degree vulnerability cone stored on target.",
    status: "catalog",
    implemented: true,
  },
  "DES_15": {
    id: "DES_15",
    tree: "Destruction",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 1,
    name: "Wild Infusion",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Melee", "Debuff"] as const,
    exactEffect:
      "Melee attacks have a 20% chance to apply a random elemental status (Burning, Chilled, Poisoned, or Shocked).",
    balanceNote: "20% proc chance on melee offensive hits.",
    status: "catalog",
    implemented: true,
  },
  "DES_16": {
    id: "DES_16",
    tree: "Destruction",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 2,
    name: "Elemental Overload",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "elementalOverload",
    affectedTags: ["Damage", "Cast", "SingleTarget"] as const,
    exactEffect:
      "Active Talent Spell — Unlocks Elemental Overload in the Spell Armoury. Direct-hit lightning strike that consumes all active elemental statuses from the target for massive burst damage.",
    balanceNote: "Consumes Fire, Frost, Poison, Shock stacks for scaled damage + bonus explosions.",
    status: "catalog",
    implemented: true,
  },
  "DES_17": {
    id: "DES_17",
    tree: "Destruction",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 3,
    name: "Elemental Convergence",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Area", "Projectile"] as const,
    exactEffect:
      "Elemental abilities that hit from long range trigger a bonus secondary effect (Fire = mini explosion, Frost = slowing zone, Poison = spreading spore, Shock = static crackle).",
    balanceNote: "Secondary procs on long-range elemental hits.",
    status: "catalog",
    implemented: true,
  },
  "DES_18": {
    id: "DES_18",
    tree: "Destruction",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 4,
    name: "Critical Recovery",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Cooldown"] as const,
    exactEffect:
      "Critical strikes reduce the remaining cooldown of your offensive abilities by 20% (1.2s internal cooldown).",
    balanceNote: "Reduces active cooldowns by 20% on crit.",
    status: "catalog",
    implemented: true,
  },

  // Tier 5: Capstones (Cols 0, 2, 4)
  "DES_19": {
    id: "DES_19",
    tree: "Destruction",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 0,
    name: "Backstab",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Melee"] as const,
    exactEffect: "Melee attacks hitting enemies from behind (120° rear arc) deal +25% increased damage.",
    balanceNote: "Rear 120-degree cone check.",
    status: "catalog",
    implemented: true,
  },
  "DES_20": {
    id: "DES_20",
    tree: "Destruction",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 1,
    name: "Elemental Surge",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Buff"] as const,
    exactEffect: "While at least 3 total elemental status stacks are active across enemies, you gain +15% elemental damage.",
    balanceNote: "Active when sum of all enemy elemental stacks >= 3.",
    status: "catalog",
    implemented: true,
  },
  "DES_21": {
    id: "DES_21",
    tree: "Destruction",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 2,
    name: "Critical Mastery",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage"] as const,
    exactEffect: "Increases your critical strike chance by +20%.",
    balanceNote: "Flat +20 percentage points to crit chance.",
    status: "catalog",
    implemented: true,
  },

  // --------------------------------------------------------------------------
  // GUARDIAN TREE (21 Nodes)
  // --------------------------------------------------------------------------
  // Tier 1: Foundations (Cols 0, 2, 4)
  "GUA_01": {
    id: "GUA_01",
    tree: "Guardian",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 0,
    name: "Reinforced Aid",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Shield", "Defense", "Ally"] as const,
    exactEffect:
      "Increases the strength and duration of shields and temporary-health effects you grant to allies by 15%.",
    balanceNote: "+5% / +10% / +15% shield amount and duration on allies across ranks.",
    status: "catalog",
    implemented: true,
  },
  "GUA_02": {
    id: "GUA_02",
    tree: "Guardian",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 1,
    name: "Battle Hardened",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Defense", "Buff"] as const,
    exactEffect:
      "Taking enemy damage grants a stack of Hardened, reducing damage taken by 3% per stack. Stacks up to 3 times and lasts 4s. Taking damage refreshes the duration.",
    balanceNote: "1% / 2% / 3% DR per stack across ranks (up to 9% at 3 stacks). Refreshes on damage.",
    status: "catalog",
    implemented: true,
  },
  "GUA_03": {
    id: "GUA_03",
    tree: "Guardian",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 2,
    name: "Guard Discipline",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Defense", "Shield"] as const,
    exactEffect:
      "Successfully blocking an attack with a blocking ability grants you a temporary shield equal to 6% of your max HP for 3s (2.5s internal cooldown).",
    balanceNote:
      "2% / 4% / 6% max HP shield across ranks from ACTIVE_BLOCK (Hand Shield, Wall, Bubble, Bulwark).",
    status: "catalog",
    implemented: true,
  },

  // Tier 2: Bridges & Expansion (Cols 0, 1, 2, 3, 4)
  "GUA_04": {
    id: "GUA_04",
    tree: "Guardian",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 0,
    name: "Shared Protection",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Shield", "Ally", "Area"] as const,
    exactEffect:
      "Whenever you gain a shield, nearby allies within 8m receive a shield equal to 50% of the shield you gained (3s internal cooldown).",
    balanceNote: "Copies 50% of self-shield to allies within 8m. Does not recursively self-trigger.",
    status: "catalog",
    implemented: true,
  },
  "GUA_05": {
    id: "GUA_05",
    tree: "Guardian",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 1,
    name: "Frontline Support",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Shield", "Ally", "Defense"] as const,
    exactEffect:
      "After using a movement ability, nearby allies gain a temporary shield equal to 5% of their max HP for 3s (6s internal cooldown).",
    balanceNote: "Movement ability trigger; 5% max HP shield for 3s to allies within 8m.",
    status: "catalog",
    implemented: true,
  },
  "GUA_06": {
    id: "GUA_06",
    tree: "Guardian",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 2,
    name: "Under Pressure",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Defense", "Buff"] as const,
    exactEffect:
      "Taking 3 hits from the same enemy within 4s grants 8% damage reduction against that enemy for 3s. Hits from that enemy refresh the duration.",
    balanceNote: "5% / 8% DR vs repeat attacker across ranks.",
    status: "catalog",
    implemented: true,
  },
  "GUA_07": {
    id: "GUA_07",
    tree: "Guardian",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 3,
    name: "Braced Assault",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Melee", "Buff"] as const,
    exactEffect:
      "Successfully blocking an attack empowers your next close-range offensive ability within 4s to deal +20% damage.",
    balanceNote:
      "Triggers on ACTIVE_BLOCK or PASSIVE_BLOCK; +20% damage consumed on next close hit (< 3.5m).",
    status: "catalog",
    implemented: true,
  },
  "GUA_08": {
    id: "GUA_08",
    tree: "Guardian",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 4,
    name: "Efficient Guard",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Defense", "Cooldown"] as const,
    exactEffect:
      "Successfully blocking an attack reduces the remaining cooldown of your defensive abilities by 15% (1.5s internal cooldown).",
    balanceNote: "8% / 15% CDR on abilities tagged DEFENSIVE across ranks. 1.5s ICD.",
    status: "catalog",
    implemented: true,
  },

  // Tier 3: Specialization (Cols 0, 1, 2, 3, 4)
  "GUA_09": {
    id: "GUA_09",
    tree: "Guardian",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 0,
    name: "Guardian's Presence",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Area", "Ally"] as const,
    exactEffect:
      "While near an ally (within 8m), both you and that ally take 5% reduced damage.",
    balanceNote: "5% DR aura for you and nearby allies. Non-stacking. 0.5s grace period.",
    status: "catalog",
    implemented: true,
  },
  "GUA_10": {
    id: "GUA_10",
    tree: "Guardian",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 1,
    name: "Shielded Power",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Shield", "Buff"] as const,
    exactEffect:
      "While you have an active shield, gain up to +12% increased damage dealt, scaling linearly with your current shield amount up to 20% max HP.",
    balanceNote:
      "Linear scaling: (currentShield / (0.2 * maxHp)) * 12% damage bonus (max +12%).",
    status: "catalog",
    implemented: true,
  },
  "GUA_11": {
    id: "GUA_11",
    tree: "Guardian",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 2,
    name: "Unbreakable",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Buff"] as const,
    exactEffect:
      "Hardened can build to +1 additional stack (4 max) and lasts 2s longer (6s duration).",
    balanceNote:
      "Increases max Hardened stacks to 4 (+12% DR at 3/3 Battle Hardened) and base duration to 6s.",
    status: "catalog",
    implemented: true,
  },
  "GUA_12": {
    id: "GUA_12",
    tree: "Guardian",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 3,
    name: "Deflect",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense"] as const,
    exactEffect:
      "Gain a 12% passive chance to block incoming attacks, preventing 50% of the damage. (Does not apply to periodic damage or environmental hazards).",
    balanceNote: "12% passive block chance. Prevents 50% damage and emits PASSIVE_BLOCK.",
    status: "catalog",
    implemented: true,
  },
  "GUA_13": {
    id: "GUA_13",
    tree: "Guardian",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 4,
    name: "Guarded Recovery",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Shield"] as const,
    exactEffect:
      "When an attack is intercepted by one of your blocking abilities, gain a temporary shield equal to 6% of your max HP for 3s (3s internal cooldown).",
    balanceNote:
      "ACTIVE_BLOCK trigger only. Combines with Guard Discipline into one refreshed shield.",
    status: "catalog",
    implemented: true,
  },

  // Tier 4: Keystones & Power (Cols 0, 1, 2, 3, 4)
  "GUA_14": {
    id: "GUA_14",
    tree: "Guardian",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 0,
    name: "Guardian's Blessing",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "guardiansBlessing",
    affectedTags: ["Defense", "Shield", "Ally", "SingleTarget"] as const,
    exactEffect:
      "Target an ally to grant them a powerful shield equal to 20% of their max HP for 5s (16s cooldown).",
    balanceNote: "Active Talent Spell. Improved by Reinforced Aid and activates Bastion.",
    status: "catalog",
    implemented: true,
  },
  "GUA_15": {
    id: "GUA_15",
    tree: "Guardian",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 1,
    name: "Aegis Momentum",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Damage", "Buff"] as const,
    exactEffect:
      "When one of your shields is destroyed by enemy damage, gain +10% movement speed and +10% damage dealt for 3s (6s internal cooldown).",
    balanceNote: "Triggered on shield depletion by damage. 6s ICD.",
    status: "catalog",
    implemented: true,
  },
  "GUA_16": {
    id: "GUA_16",
    tree: "Guardian",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 2,
    name: "Fortified Resolve",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Buff"] as const,
    exactEffect:
      "Reaching maximum Hardened stacks grants Fortified Resolve. The next hit dealing at least 10% of your max HP has its damage reduced by 25% (6s internal cooldown).",
    balanceNote: "Anti-burst buff gained at max Hardened stacks. Consumed on large hit.",
    status: "catalog",
    implemented: true,
  },
  "GUA_17": {
    id: "GUA_17",
    tree: "Guardian",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 3,
    name: "Steel Reflexes",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense"] as const,
    exactEffect:
      "Increases your passive block chance by +8 percentage points (+20% total with Deflect).",
    balanceNote: "+8% passive block chance.",
    status: "catalog",
    implemented: true,
  },
  "GUA_18": {
    id: "GUA_18",
    tree: "Guardian",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 4,
    name: "Reflective Guard",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Damage", "Defense"] as const,
    exactEffect:
      "Blocking an attack reflects 25% of the prevented damage back to the attacker (capped at 8% of your max HP).",
    balanceNote:
      "Reflect 25% prevented damage. Cannot crit, cannot re-trigger reflection, capped at 8% max HP.",
    status: "catalog",
    implemented: true,
  },

  // Tier 5: Capstones (Cols 0, 2, 4)
  "GUA_19": {
    id: "GUA_19",
    tree: "Guardian",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 0,
    name: "Bastion",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Buff", "Ally"] as const,
    exactEffect:
      "Directly applying a shield to an ally grants both you and that ally Bastion, reducing incoming damage by 12% for 4s.",
    balanceNote: "Triggered on direct ally shield grant. 12% DR for 4s. Does not stack; refreshes duration.",
    status: "catalog",
    implemented: true,
  },
  "GUA_20": {
    id: "GUA_20",
    tree: "Guardian",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 1,
    name: "Living Fortress",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Buff"] as const,
    exactEffect:
      "Increases your maximum health by +20% and causes Hardened to persist for an additional +2s.",
    balanceNote: "+20% max HP payoff and +2s Hardened duration.",
    status: "catalog",
    implemented: true,
  },
  "GUA_21": {
    id: "GUA_21",
    tree: "Guardian",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 2,
    name: "Perfect Defense",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Defense", "Buff"] as const,
    exactEffect:
      "Successfully blocking an attack temporarily grants +25% passive block chance for 2s (6s internal cooldown, cannot refresh while active).",
    balanceNote:
      "Triggers on ACTIVE_BLOCK or PASSIVE_BLOCK. +25% block chance for 2s. 6s ICD.",
    status: "catalog",
    implemented: true,
  },

  // --------------------------------------------------------------------------
  // CONTROL TREE (21 Nodes)
  // --------------------------------------------------------------------------
  "CON_01": {
    id: "CON_01",
    tree: "Control",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 0,
    name: "Disruptive Force",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Control", "Silence", "Fear", "Interrupt"] as const,
    exactEffect:
      "Increases the duration of your silences, fears, and other disruption effects by 15%.",
    balanceNote: "+5% / +10% / +15% disruption duration. Counts toward the +30% talent CC cap.",
    status: "catalog",
    implemented: true,
  },
  "CON_02": {
    id: "CON_02",
    tree: "Control",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 1,
    name: "Lingering Control",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Control", "Slow", "Root"] as const,
    exactEffect:
      "Increases the duration of your slows, roots, traps, and persistent control effects by 15%.",
    balanceNote: "+5% / +10% / +15% zone-control duration. Counts toward the +30% talent CC cap.",
    status: "catalog",
    implemented: true,
  },
  "CON_03": {
    id: "CON_03",
    tree: "Control",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 2,
    name: "Forceful Manipulation",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Control", "Knockback", "Pull"] as const,
    exactEffect:
      "Increases the strength of your push, pull, and tether displacement by 15%.",
    balanceNote: "+5% / +10% / +15% displacement distance. Does not add CC duration.",
    status: "catalog",
    implemented: true,
  },
  "CON_04": {
    id: "CON_04",
    tree: "Control",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 0,
    name: "Broken Cadence",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Control", "Interrupt", "Cooldown"] as const,
    exactEffect:
      "Successfully interrupting or disrupting an enemy reduces the cooldown of your next control ability by 20% (4s window, does not stack).",
    balanceNote: "10% / 20% CDR on the next Control-tagged ability. Named to avoid the Spellbreaker spell.",
    status: "catalog",
    implemented: true,
  },
  "CON_05": {
    id: "CON_05",
    tree: "Control",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 1,
    name: "Forbidden Ground",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Debuff"] as const,
    exactEffect:
      "Enemies affected by one of your control effects have 10% reduced cast speed for 2.5 seconds.",
    balanceNote: "castDurationMul 1/0.9 for 2.5s. Does not stack; refreshes.",
    status: "catalog",
    implemented: true,
  },
  "CON_06": {
    id: "CON_06",
    tree: "Control",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 2,
    name: "Control Momentum",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Control", "Debuff"] as const,
    exactEffect:
      "Applying a new control effect to a target already under control increases that new effect's duration by 10%.",
    balanceNote: "+5% / +10%. Only the newly applied effect. Respects the +30% talent CC cap.",
    status: "catalog",
    implemented: true,
  },
  "CON_07": {
    id: "CON_07",
    tree: "Control",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 3,
    name: "Anchoring Force",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Root", "Knockback", "Pull"] as const,
    exactEffect:
      "After you successfully displace an enemy, they are rooted for 0.6 seconds (5s internal cooldown per target).",
    balanceNote: "Requires actual movement. Subject to hard-CC diminishing returns.",
    status: "catalog",
    implemented: true,
  },
  "CON_08": {
    id: "CON_08",
    tree: "Control",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 4,
    name: "Chain Pull",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Knockback", "Pull"] as const,
    exactEffect:
      "Successfully displacing an enemy empowers your next displacement within 4 seconds by +20% (does not stack).",
    balanceNote: "Consumed by the next successful displacement.",
    status: "catalog",
    implemented: true,
  },
  "CON_09": {
    id: "CON_09",
    tree: "Control",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 0,
    name: "Silencing Pressure",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Silence", "Interrupt"] as const,
    exactEffect:
      "Successfully interrupting or disrupting an enemy silences them for 0.6 seconds (5s internal cooldown per target).",
    balanceNote: "Subject to hard-CC diminishing returns. Does not retrigger itself.",
    status: "catalog",
    implemented: true,
  },
  "CON_10": {
    id: "CON_10",
    tree: "Control",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 1,
    name: "Suppressive Control",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Debuff"] as const,
    exactEffect:
      "Enemies affected by your control effects deal 12% reduced damage for 3 seconds.",
    balanceNote: "Does not stack; reapplication refreshes duration.",
    status: "catalog",
    implemented: true,
  },
  "CON_11": {
    id: "CON_11",
    tree: "Control",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 2,
    name: "Expanded Control",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Area"] as const,
    exactEffect:
      "Increases the cast range and area of effect of your control abilities by 15%.",
    balanceNote: "Does not increase displacement distance.",
    status: "catalog",
    implemented: true,
  },
  "CON_12": {
    id: "CON_12",
    tree: "Control",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 3,
    name: "Distorted Wake",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Slow", "Knockback", "Pull"] as const,
    exactEffect:
      "Enemies you displace leave a 2.5s trail of spatial distortion that slows enemies crossing it by 20%.",
    balanceNote: "Created only by actual displacement. Trails from the same caster do not stack.",
    status: "catalog",
    implemented: true,
  },
  "CON_13": {
    id: "CON_13",
    tree: "Control",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 4,
    name: "Repositioning Mastery",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Root"] as const,
    exactEffect:
      "After repositioning an enemy, the next enemy that damages you within 4 seconds is rooted for 0.8 seconds (6s internal cooldown).",
    balanceNote: "Buff on self after a successful displace.",
    status: "catalog",
    implemented: true,
  },
  "CON_14": {
    id: "CON_14",
    tree: "Control",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 0,
    name: "Arcane Lock",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "CrowdControl"] as const,
    exactEffect:
      "After you apply hard CC, the target is Arcane Locked for 4 seconds. Subsequent CC you apply lasts 15% longer (6s internal cooldown).",
    balanceNote: "Does not stack. Respects the +30% talent CC cap.",
    status: "catalog",
    implemented: true,
  },
  "CON_15": {
    id: "CON_15",
    tree: "Control",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 1,
    name: "Punishing Silence",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Silence", "Haste"] as const,
    exactEffect:
      "Interrupting or silencing an enemy grants you +15% movement speed for 3 seconds.",
    balanceNote: "Self haste on successful disruption.",
    status: "catalog",
    implemented: true,
  },
  "CON_16": {
    id: "CON_16",
    tree: "Control",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 2,
    name: "Binding Sigil",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "bindingSigil",
    affectedTags: ["Control", "Root", "Area", "GroundEffect"] as const,
    exactEffect:
      "Place a binding rune. After 0.75s it arms and roots enemies who stand in it (1.25s root, 4s rune, 16s cooldown).",
    balanceNote: "Visible arming delay. Not a persistent slow field.",
    status: "catalog",
    implemented: true,
  },
  "CON_17": {
    id: "CON_17",
    tree: "Control",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 3,
    name: "Containment",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Movement", "Haste"] as const,
    exactEffect:
      "Enemies you displace have dash/leap distance and movement-speed bonuses reduced by 25% for 3 seconds (5s internal cooldown).",
    balanceNote: "Does not disable movement abilities.",
    status: "catalog",
    implemented: true,
  },
  "CON_18": {
    id: "CON_18",
    tree: "Control",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 4,
    name: "Spatial Instability",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Root", "Movement"] as const,
    exactEffect:
      "After you displace an enemy they become Unstable for 4 seconds. Completing a movement ability while Unstable roots them for 0.8 seconds (6s internal cooldown).",
    balanceNote: "Root occurs after the movement completes. Complements Hex Anchor (cast-root).",
    status: "catalog",
    implemented: true,
  },
  "CON_19": {
    id: "CON_19",
    tree: "Control",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 0,
    name: "Mass Silence",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "massSilence",
    affectedTags: ["Control", "Silence", "Area", "Nova"] as const,
    exactEffect:
      "Release a wide pulse that silences enemies, allied players, and yourself for 4 seconds (40s cooldown).",
    balanceNote: "Fight-reset pause with a real downside. Skips friendly NPCs. F-slot only.",
    status: "catalog",
    implemented: true,
  },
  "CON_20": {
    id: "CON_20",
    tree: "Control",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 1,
    name: "Absolute Control",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "CrowdControl"] as const,
    exactEffect:
      "Increases the duration of your crowd-control effects by 20%. Does not increase push/pull distance.",
    balanceNote: "Respects the +30% talent CC-duration cap.",
    status: "catalog",
    implemented: true,
  },
  "CON_21": {
    id: "CON_21",
    tree: "Control",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 2,
    name: "Disorientation",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Control", "Knockback", "Pull"] as const,
    exactEffect:
      "Your displacement effects have a 25% chance to reverse the target's movement input for 1.5 seconds (6s internal cooldown).",
    balanceNote: "Camera and aiming unchanged. Only movement input is reversed.",
    status: "catalog",
    implemented: true,
  },

  // --------------------------------------------------------------------------
  // FLOW TREE (21 Nodes) — Escape / Engage / Trick
  // --------------------------------------------------------------------------
  "FLO_01": {
    id: "FLO_01",
    tree: "Flow",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 0,
    name: "Fleet Footed",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Movement", "Haste"] as const,
    exactEffect:
      "After you use a movement ability, gain +15% movement speed for 2 seconds.",
    balanceNote: "5% / 10% / 15%. Caps with other temporary Flow haste at +30%.",
    status: "catalog",
    implemented: true,
  },
  "FLO_02": {
    id: "FLO_02",
    tree: "Flow",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 1,
    name: "Combat Flow",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Movement", "Damage"] as const,
    exactEffect:
      "After you use a movement ability, your next damaging spell is 15% faster to cast (3s, consumed even on a miss).",
    balanceNote: "5% / 10% / 15%. Anticipation + cast duration only. No damage.",
    status: "catalog",
    implemented: true,
  },
  "FLO_03": {
    id: "FLO_03",
    tree: "Flow",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 2,
    name: "Fluid Motion",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Movement"] as const,
    exactEffect: "Increases your base movement speed by 9%.",
    balanceNote: "3% / 6% / 9%. Outside the temporary Flow haste cap.",
    status: "catalog",
    implemented: true,
  },
  "FLO_04": {
    id: "FLO_04",
    tree: "Flow",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 0,
    name: "Quick Recovery",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Movement", "Defense", "Cooldown"] as const,
    exactEffect:
      "After you use a movement ability, your next defensive or movement cooldown is reduced by 14% (4s). Does not affect the movement that opened the window.",
    balanceNote: "7% / 14%. Consumed on the next Defense or Flow-movement cast.",
    status: "catalog",
    implemented: true,
  },
  "FLO_05": {
    id: "FLO_05",
    tree: "Flow",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 1,
    name: "Second Wind",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Healing"] as const,
    exactEffect:
      "Using a movement ability below 50% health heals you for 6% of max health (9s internal cooldown).",
    balanceNote: "Upgraded by Flow Renewal into one shared heal proc.",
    status: "catalog",
    implemented: true,
  },
  "FLO_06": {
    id: "FLO_06",
    tree: "Flow",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 2,
    name: "Follow Through",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Movement", "Damage"] as const,
    exactEffect:
      "After you use a movement ability, your next damaging spell gains +20% range and projectile speed (3s, consumed even on a miss).",
    balanceNote: "10% / 20%. Melee and AoE also gain radius.",
    status: "catalog",
    implemented: true,
  },
  "FLO_07": {
    id: "FLO_07",
    tree: "Flow",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 3,
    name: "Extended Reach",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Movement", "Dash", "Blink"] as const,
    exactEffect: "Your dash, blink, leap, and teleport travel 15% farther.",
    balanceNote: "8% / 15%. Travel distance only — not ability range.",
    status: "catalog",
    implemented: true,
  },
  "FLO_08": {
    id: "FLO_08",
    tree: "Flow",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 4,
    name: "Lingering Motion",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Movement", "Buff"] as const,
    exactEffect:
      "Surge, Spirit Form, and Predator Step cloak last 20% longer.",
    balanceNote: "10% / 20%. Timed movement states only.",
    status: "catalog",
    implemented: true,
  },
  "FLO_09": {
    id: "FLO_09",
    tree: "Flow",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 0,
    name: "Untouchable",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Defense"] as const,
    exactEffect:
      "After you use a movement ability, take 15% less damage for 1.5 seconds. Newly applied roots, slows, stuns, and fears are 25% shorter. Never immunity.",
    balanceNote: "Does not shorten silence. Refresh, no stack.",
    status: "catalog",
    implemented: true,
  },
  "FLO_10": {
    id: "FLO_10",
    tree: "Flow",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 1,
    name: "Rebound Window",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Cooldown"] as const,
    exactEffect:
      "For 3 seconds after moving, the first direct enemy damage you deal or take refunds 18% of that movement's cooldown.",
    balanceNote: "Not DoT, self, or friendly. Repeat recasts do not open a new window.",
    status: "catalog",
    implemented: true,
  },
  "FLO_11": {
    id: "FLO_11",
    tree: "Flow",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 2,
    name: "Double Step",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Dash", "Blink"] as const,
    exactEffect:
      "After Dash or Teleport, you may recast the same spell once within 2.5 seconds at 75% travel. The recast does not restart cooldown.",
    balanceNote: "Full recast (i-frames, haste, Teleport channel). Never a third cast.",
    status: "catalog",
    implemented: true,
  },
  "FLO_12": {
    id: "FLO_12",
    tree: "Flow",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 3,
    name: "Motion Echo",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement"] as const,
    exactEffect:
      "After you use a movement ability, your next different movement travels 15% farther (4s).",
    balanceNote: "Must be a different Flow-movement. Not a Slipstream clone.",
    status: "catalog",
    implemented: true,
  },
  "FLO_13": {
    id: "FLO_13",
    tree: "Flow",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 4,
    name: "Afterimage",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement"] as const,
    exactEffect:
      "Using a movement ability leaves a brief afterimage at your start position for 1.5 seconds. Visual only — cannot be targeted or hit.",
    balanceNote: "Shared decoy ladder with False Trail and Phantom Chain.",
    status: "catalog",
    implemented: true,
  },
  "FLO_14": {
    id: "FLO_14",
    tree: "Flow",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 0,
    name: "Phase Shield",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Shield"] as const,
    exactEffect:
      "After you use a movement ability, gain a shield equal to 6% of max health for 3 seconds (6s internal cooldown).",
    balanceNote: "Absorb only. Does not stack with itself.",
    status: "catalog",
    implemented: true,
  },
  "FLO_15": {
    id: "FLO_15",
    tree: "Flow",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 1,
    name: "Flow Renewal",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Healing"] as const,
    exactEffect:
      "Improves Second Wind: heals below 60% health for 8% of max health, with an 8s internal cooldown.",
    balanceNote: "Same heal proc family — not a second ICD.",
    status: "catalog",
    implemented: true,
  },
  "FLO_16": {
    id: "FLO_16",
    tree: "Flow",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 2,
    name: "Relentless Pursuit",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Haste"] as const,
    exactEffect:
      "Dealing or taking damage within 3 seconds of moving grants +15% movement speed for 3 seconds.",
    balanceNote: "Refresh, no stack. Caps with other temporary Flow haste at +30%.",
    status: "catalog",
    implemented: true,
  },
  "FLO_17": {
    id: "FLO_17",
    tree: "Flow",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 3,
    name: "False Trail",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement"] as const,
    exactEffect:
      "Your Afterimage lasts 2 seconds and slides along your last movement trajectory.",
    balanceNote: "Upgrade of Afterimage — not a second clone type.",
    status: "catalog",
    implemented: true,
  },
  "FLO_18": {
    id: "FLO_18",
    tree: "Flow",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 4,
    name: "Triple Blink",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "tripleBlink",
    affectedTags: ["Movement", "Blink"] as const,
    exactEffect:
      "Blink toward your cursor (3.2m). Recast Space up to 2 more times within 1.8s of the last hop. 16s cooldown starts when the window expires or after the third hop. Space only.",
    balanceNote: "100ms i-frames per hop. Rooted, silenced, or stunned cannot hop. Not repeatable.",
    status: "catalog",
    implemented: true,
  },
  "FLO_19": {
    id: "FLO_19",
    tree: "Flow",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 0,
    name: "Echo Step",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Dash", "Blink"] as const,
    exactEffect:
      "Improves Double Step: recast window 3 seconds at full travel distance. Still only one recast.",
    balanceNote: "Never a third cast. Triple Blink is not repeatable.",
    status: "catalog",
    implemented: true,
  },
  "FLO_20": {
    id: "FLO_20",
    tree: "Flow",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 1,
    name: "Momentum Engine",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement", "Haste", "Cooldown"] as const,
    exactEffect:
      "Dealing or taking damage within 3 seconds of moving grants 4 seconds of +15% movement speed and +15% movement cooldown recovery. Refresh, no stack.",
    balanceNote: "Caps with other temporary Flow haste at +30%.",
    status: "catalog",
    implemented: true,
  },
  "FLO_21": {
    id: "FLO_21",
    tree: "Flow",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 2,
    name: "Phantom Chain",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Movement"] as const,
    exactEffect:
      "Each Flow movement grants a charge (max 3, expire after 8s without another). At 3 charges, your next movement spends them on a moving afterimage for 1.5 seconds.",
    balanceNote: "Visual only. Strongest rung of the Afterimage ladder.",
    status: "catalog",
    implemented: true,
  },

  // --------------------------------------------------------------------------
  // HARMONY TREE (21 Nodes) — Rescue / Sustain / Empower
  // HAR_01 Overflow (overheal→shield) was retired; Restorative Touch took the slot.
  // --------------------------------------------------------------------------
  "HAR_01": {
    id: "HAR_01",
    tree: "Harmony",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 0,
    name: "Restorative Touch",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Healing"] as const,
    exactEffect: "Your direct heals restore 5/10/15% more health.",
    balanceNote: "DIRECT_HEAL only. Replaced Overflow (overheal→shield).",
    status: "catalog",
    implemented: true,
  },
  "HAR_02": {
    id: "HAR_02",
    tree: "Harmony",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 1,
    name: "Lingering Grace",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "Your HoTs last 5/10/15% longer (same tick cadence, more total healing).",
    balanceNote: "Caster-owned HoTs only.",
    status: "catalog",
    implemented: true,
  },
  "HAR_03": {
    id: "HAR_03",
    tree: "Harmony",
    tier: 1,
    requiredPoints: 0,
    layoutOrder: 2,
    name: "Empathic Surge",
    pointCost: 1,
    maxRank: 3,
    affectedTags: ["Healing", "Haste"] as const,
    exactEffect: "Healing another ally grants them +3/6/9% move speed for 2.5s.",
    balanceNote: "2s ICD per target. Refresh, no stack. Shares Flow temp haste cap.",
    status: "catalog",
    implemented: true,
  },
  "HAR_04": {
    id: "HAR_04",
    tree: "Harmony",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 0,
    name: "Emergency Response",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Healing"] as const,
    exactEffect: "Direct heals on allies below 40% health are 8/15% stronger.",
    balanceNote: "DIRECT_HEAL only.",
    status: "catalog",
    implemented: true,
  },
  "HAR_05": {
    id: "HAR_05",
    tree: "Harmony",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 1,
    name: "Overflowing Grace",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "40% of direct overhealing becomes a 4s HoT (cap 10% of target max HP).",
    balanceNote: "Refresh/recalculate. Not a shield.",
    status: "catalog",
    implemented: true,
  },
  "HAR_06": {
    id: "HAR_06",
    tree: "Harmony",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 2,
    name: "Steady Renewal",
    pointCost: 1,
    maxRank: 2,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "Your HoTs heal 2/4% more per consecutive tick on the same instance (max 3).",
    balanceNote: "Resets when that HoT expires. Per-instance.",
    status: "catalog",
    implemented: true,
  },
  "HAR_07": {
    id: "HAR_07",
    tree: "Harmony",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 3,
    name: "Uplifting Presence",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Haste"] as const,
    exactEffect: "Allies with one of your HoTs gain +7% move speed.",
    balanceNote: "While at least one caster-owned HoT is active. Shares Flow temp haste cap.",
    status: "catalog",
    implemented: true,
  },
  "HAR_08": {
    id: "HAR_08",
    tree: "Harmony",
    tier: 2,
    requiredPoints: 2,
    layoutOrder: 4,
    name: "Inspiring Recovery",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Haste"] as const,
    exactEffect: "Healing another ally grants them +8% action/cast speed for 2s.",
    balanceNote: "4s ICD per target. Does not stack.",
    status: "catalog",
    implemented: true,
  },
  "HAR_09": {
    id: "HAR_09",
    tree: "Harmony",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 0,
    name: "Lasting Rescue",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Defense"] as const,
    exactEffect: "Directly healing an ally below 35% health grants 12% DR for 2.5s.",
    balanceNote: "6s ICD per target. Counts toward the 30% talent DR cap.",
    status: "catalog",
    implemented: true,
  },
  "HAR_10": {
    id: "HAR_10",
    tree: "Harmony",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 1,
    name: "Mending Echo",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing"] as const,
    exactEffect: "Repeat 20% of the effective direct heal on the same target after 2s.",
    balanceNote: "Echo cannot echo. Tagged ECHO_HEAL.",
    status: "catalog",
    implemented: true,
  },
  "HAR_11": {
    id: "HAR_11",
    tree: "Harmony",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 2,
    name: "Persistent Grace",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "When your HoT expires naturally, its final tick heals for 175%.",
    balanceNote: "Natural end only — not dispel or consume.",
    status: "catalog",
    implemented: true,
  },
  "HAR_12": {
    id: "HAR_12",
    tree: "Harmony",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 3,
    name: "Harmonious Growth",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Haste"] as const,
    exactEffect: "After 3 of your HoT ticks on a target: +10% move and +10% cast speed for 3s.",
    balanceNote: "6s ICD per target.",
    status: "catalog",
    implemented: true,
  },
  "HAR_13": {
    id: "HAR_13",
    tree: "Harmony",
    tier: 3,
    requiredPoints: 4,
    layoutOrder: 4,
    name: "Empowered Recovery",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Buff"] as const,
    exactEffect: "Healing an ally above 80% health grants them +10% damage and +8% action speed for 3s.",
    balanceNote: "6s ICD per target.",
    status: "catalog",
    implemented: true,
  },
  "HAR_14": {
    id: "HAR_14",
    tree: "Harmony",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 0,
    name: "Guardian Angel",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "guardianAngel",
    affectedTags: ["Healing", "Ally"] as const,
    exactEffect:
      "Spend 40% of your current health to heal an ally for 35% of their max health. 20s cooldown.",
    balanceNote: "Cannot drop the caster below 10% max HP. Cost is not damage. DIRECT_HEAL.",
    status: "catalog",
    implemented: true,
  },
  "HAR_15": {
    id: "HAR_15",
    tree: "Harmony",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 1,
    name: "Overflowing Renewal",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "Direct heals on a target with your HoT extend those HoTs by 1s and boost the next tick 15%.",
    balanceNote: "4s ICD per target. Max extension +30% of base duration. Your HoTs only.",
    status: "catalog",
    implemented: true,
  },
  "HAR_16": {
    id: "HAR_16",
    tree: "Harmony",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 2,
    name: "Renewing Harmony",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "With 2+ of your HoTs active, applying another refreshes all of them to full duration.",
    balanceNote: "6s ICD. Duration only. Works across allies.",
    status: "catalog",
    implemented: true,
  },
  "HAR_17": {
    id: "HAR_17",
    tree: "Harmony",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 3,
    name: "Sympathetic Healing",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Self"] as const,
    exactEffect: "Heal yourself for 25% of effective healing done to other allies.",
    balanceNote: "Effective healing only. No self-trigger. Cannot recurse.",
    status: "catalog",
    implemented: true,
  },
  "HAR_18": {
    id: "HAR_18",
    tree: "Harmony",
    tier: 4,
    requiredPoints: 7,
    layoutOrder: 4,
    name: "Battle Rhythm",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Damage"] as const,
    exactEffect:
      "Healing an ally pulses damage in 3m (1.5s ICD). You gain Rhythm: +3% move and cast speed per stack (max 3, 4s).",
    balanceNote: "HoT ticks can pulse. Pulse cannot crit.",
    status: "catalog",
    implemented: true,
  },
  "HAR_19": {
    id: "HAR_19",
    tree: "Harmony",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 0,
    name: "Lasting Grace",
    pointCost: 1,
    maxRank: 1,
    type: "spell",
    nodeType: "spell",
    spellId: "lastingGrace",
    affectedTags: ["Healing", "Ally", "Defense"] as const,
    exactEffect: "Bless an ally so they cannot fall below 1 health for 3s. 35s cooldown.",
    balanceNote: "Not immunity. Does not prevent CC. Cannot stack or refresh from another Lasting Grace.",
    status: "catalog",
    implemented: true,
  },
  "HAR_20": {
    id: "HAR_20",
    tree: "Harmony",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 1,
    name: "Everlasting Grace",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "HealOverTime"] as const,
    exactEffect: "While you have 3+ HoTs active, they tick 25% faster without losing duration.",
    balanceNote: "Dynamic. Caster-owned HoTs only, any mix of targets.",
    status: "catalog",
    implemented: true,
  },
  "HAR_21": {
    id: "HAR_21",
    tree: "Harmony",
    tier: 5,
    requiredPoints: 10,
    layoutOrder: 2,
    name: "Resonance",
    pointCost: 1,
    maxRank: 1,
    affectedTags: ["Healing", "Buff"] as const,
    exactEffect:
      "Healing an ally builds Resonance (max 3). At 3, consume for +12% damage and +10% DR for 4s.",
    balanceNote: "1s stack ICD / 8s after proc per target. DR joins the 30% talent DR cap.",
    status: "catalog",
    implemented: true,
  },
};

export const TALENT_CATALOG_IDS = Object.keys(TALENT_CATALOG);
