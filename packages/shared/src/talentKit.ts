import { ABILITIES, abilityHasTags, type SpellTag } from "./abilities";
import { COMBAT } from "./combat";
import { TALENTS, type TalentDef } from "./stands";
import {
  isCatalogTalentImplemented,
  OPENING_SALVO_COOLDOWN_MS,
  OPENING_SALVO_TALENT_ID,
  openingSalvoBonusPercent,
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

  return {
    loadoutIds,
    talentIds: cleaned,
    moveSpeedMul,
    maxHpBonus,
    critChance: COMBAT.critChance,
    cooldownMulByAbility,
    openingSalvoDmgBonus: bakeOpeningSalvoBonus(talentBuild),
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
