import { ABILITIES, abilityHasTags, type AbilityDef, type SpellTag } from "./abilities";
import { COMBAT } from "./combat";
import { TALENTS, type TalentDef } from "./stands";
import { getStatus, isElementalSecondaryStatus } from "./statuses";
import {
  CRITICAL_FOCUS_TALENT_ID,
  criticalFocusCritChancePercent,
  ELEMENTAL_QUICKNESS_TALENT_ID,
  elementalQuicknessCdrPercent,
  FIFTH_CADENCE_DAMAGE_PERCENT,
  FIFTH_CADENCE_TALENT_ID,
  INTENSIFIED_ELEMENTS_TALENT_ID,
  intensifiedElementsPercent,
  isCatalogTalentImplemented,
  OPENING_SALVO_COOLDOWN_MS,
  OPENING_SALVO_TALENT_ID,
  openingSalvoBonusPercent,
  OPPORTUNIST_TALENT_ID,
  opportunistBonusPercent,
  OVERFLOW_TALENT_ID,
  overflowCapPercent,
  overflowConvertPercent,
  PROTECTIVE_INSTINCT_TALENT_ID,
  protectiveInstinctReducePercent,
  SPRINTER_TALENT_ID,
  sprinterMoveSpeedPercent,
  TALENT_CATALOG,
  UNSTABLE_MAGIC_TALENT_ID,
  unstableMagicCritDamagePercent,
  WIDENED_ELEMENTS_AOE_PERCENT,
  WIDENED_ELEMENTS_TALENT_ID,
} from "./talentCatalog";
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
  /**
   * Opportunist — flat outgoing damage bonus vs your hard-CC'd targets (0.02 / 0.04 / 0.06).
   * 0 = talent not invested / not implemented.
   */
  opportunistDmgBonus: number;
  /**
   * Overflow — fraction of overheal converted to shield (0.133 / 0.267 / 0.4).
   * 0 = talent not invested / not implemented.
   */
  overflowConvertFrac: number;
  /**
   * Overflow — shield cap as fraction of target max HP (0.027 / 0.053 / 0.08).
   */
  overflowCapFrac: number;
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
    opportunistDmgBonus: 0,
    overflowConvertFrac: 0,
    overflowCapFrac: 0,
    fifthSpellDmgBonus: 0,
    elementalAoeRadiusMul: 1,
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

function bakeOpportunistBonus(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[OPPORTUNIST_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, OPPORTUNIST_TALENT_ID);
  if (rank <= 0) return 0;
  return opportunistBonusPercent(rank, talentMaxRank(def)) / 100;
}

/** Additive move-speed fraction (0.02 / 0.04 / 0.06) — multiply into kit `moveSpeedMul`. */
function bakeSprinterMoveMul(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[SPRINTER_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 1;
  const rank = talentRank(talentBuild ?? {}, SPRINTER_TALENT_ID);
  if (rank <= 0) return 1;
  return 1 + sprinterMoveSpeedPercent(rank, talentMaxRank(def)) / 100;
}

function bakeOverflowConvertFrac(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[OVERFLOW_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, OVERFLOW_TALENT_ID);
  if (rank <= 0) return 0;
  return overflowConvertPercent(rank, talentMaxRank(def)) / 100;
}

function bakeOverflowCapFrac(talentBuild: TalentBuild | undefined): number {
  const def = TALENT_CATALOG[OVERFLOW_TALENT_ID];
  if (!isCatalogTalentImplemented(def)) return 0;
  const rank = talentRank(talentBuild ?? {}, OVERFLOW_TALENT_ID);
  if (rank <= 0) return 0;
  return overflowCapPercent(rank, talentMaxRank(def)) / 100;
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

  moveSpeedMul *= bakeSprinterMoveMul(talentBuild);
  bakeElementalCooldownMuls(talentBuild, loadoutIds, cooldownMulByAbility);

  return {
    loadoutIds,
    talentIds: cleaned,
    moveSpeedMul,
    maxHpBonus,
    critChance: COMBAT.critChance + bakeCriticalFocusCritChance(talentBuild),
    critDamageBonus: bakeUnstableMagicCritBonus(talentBuild),
    secondaryEffectMul: bakeSecondaryEffectMul(talentBuild),
    cooldownMulByAbility,
    openingSalvoDmgBonus: bakeOpeningSalvoBonus(talentBuild),
    protectiveInstinctReducePct: bakeProtectiveInstinctPct(talentBuild),
    opportunistDmgBonus: bakeOpportunistBonus(talentBuild),
    overflowConvertFrac: bakeOverflowConvertFrac(talentBuild),
    overflowCapFrac: bakeOverflowCapFrac(talentBuild),
    fifthSpellDmgBonus: bakeFifthSpellDmgBonus(talentBuild),
    elementalAoeRadiusMul: bakeElementalAoeRadiusMul(talentBuild),
  };
}

export function kitCooldownMs(
  kit: CombatSessionKit | undefined,
  abilityId: string,
  baseMs: number,
): number {
  const mul = kit?.cooldownMulByAbility.get(abilityId) ?? 1;
  return Math.max(0, Math.round(baseMs * mul));
}

/** Radius multiplier for elemental AoE (1 = unchanged). */
export function kitRadiusMul(kit: CombatSessionKit | undefined, abilityId: string): number {
  const mul = kit?.elementalAoeRadiusMul ?? 1;
  if (mul <= 1.001) return 1;
  if (!isElementalAoeAbility(ABILITIES[abilityId])) return 1;
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

/** Damaging spells that can benefit from Opportunist. */
export function abilityCanProcOpportunist(abilityId: string): boolean {
  return abilityCanProcOpeningSalvo(abilityId);
}

/** Healing spells and HoT ticks that can convert overheal via Overflow (self or ally). */
export function abilityCanProcOverflow(abilityId: string): boolean {
  if (abilityHasTags(ABILITIES[abilityId], "Healing")) return true;
  return getStatus(abilityId)?.mechanic === "hot";
}
