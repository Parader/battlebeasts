import { ABILITIES, abilityHasTags, type SpellTag } from "./abilities";
import { COMBAT } from "./combat";
import { TALENTS, type TalentDef } from "./stands";
import { getStatus } from "./statuses";
import {
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
};

export function emptyCombatSessionKit(): CombatSessionKit {
  return {
    loadoutIds: new Set(),
    talentIds: [],
    moveSpeedMul: 1,
    maxHpBonus: 0,
    critChance: COMBAT.critChance,
    cooldownMulByAbility: new Map(),
    openingSalvoDmgBonus: 0,
    protectiveInstinctReducePct: 0,
    opportunistDmgBonus: 0,
    overflowConvertFrac: 0,
    overflowCapFrac: 0,
  };
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

  return {
    loadoutIds,
    talentIds: cleaned,
    moveSpeedMul,
    maxHpBonus,
    critChance: COMBAT.critChance,
    cooldownMulByAbility,
    openingSalvoDmgBonus: bakeOpeningSalvoBonus(talentBuild),
    protectiveInstinctReducePct: bakeProtectiveInstinctPct(talentBuild),
    opportunistDmgBonus: bakeOpportunistBonus(talentBuild),
    overflowConvertFrac: bakeOverflowConvertFrac(talentBuild),
    overflowCapFrac: bakeOverflowCapFrac(talentBuild),
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

/** True when this ability id is a damaging spell (not a status / DoT tick id). */
export function abilityCanProcOpeningSalvo(abilityId: string): boolean {
  const def = ABILITIES[abilityId];
  if (!def || !(def.damage > 0)) return false;
  return abilityHasTags(def, "Damage");
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
