import { ABILITIES, type SpellTag } from "./abilities";
import { TALENTS, type TalentDef } from "./stands";

/** Baked once on loadout/talent change — never scanned in the tick loop. */
export type CombatSessionKit = {
  loadoutIds: Set<string>;
  talentIds: readonly string[];
  moveSpeedMul: number;
  maxHpBonus: number;
  /** Per-ability cooldown multiplier (1 = unchanged). */
  cooldownMulByAbility: Map<string, number>;
};

export function emptyCombatSessionKit(): CombatSessionKit {
  return {
    loadoutIds: new Set(),
    talentIds: [],
    moveSpeedMul: 1,
    maxHpBonus: 0,
    cooldownMulByAbility: new Map(),
  };
}

function talentMatchesAbility(modTags: readonly SpellTag[] | undefined, abilityId: string): boolean {
  if (!modTags?.length) return true;
  const def = ABILITIES[abilityId];
  if (!def?.tags?.length) return false;
  const set = new Set(def.tags);
  return modTags.every((t) => set.has(t));
}

/**
 * Bake player sheet + per-ability cooldown multipliers from live talents.
 * Catalog talents are ignored (not in TALENTS).
 */
export function resolveKit(
  loadoutCsv: string,
  talentIds: readonly string[],
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
    cooldownMulByAbility,
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
