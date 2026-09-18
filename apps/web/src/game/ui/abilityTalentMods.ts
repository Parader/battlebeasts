import { talentModsForAbility, type TalentSpellMod } from "@battlebeasts/shared";
import type { AbilityDef } from "@battlebeasts/shared";
import type { CombatSessionKit } from "@battlebeasts/shared";

export type { TalentSpellMod };

/** Talent-driven lines for spell tooltips (ability bar + armoury). */
export function talentModsForSpell(
  ability: AbilityDef,
  kit: CombatSessionKit,
  statusIds: ReadonlySet<string> = new Set(),
): TalentSpellMod[] {
  return talentModsForAbility(ability, kit, statusIds);
}

/** Flat strings for callers that have not switched to named talent rows. */
export function talentModLines(
  ability: AbilityDef,
  kit: CombatSessionKit,
  statusIds: ReadonlySet<string> = new Set(),
): string[] {
  return talentModsForAbility(ability, kit, statusIds).map((mod) =>
    mod.live ? `${mod.name} (now): ${mod.effect}` : `${mod.name}: ${mod.effect}`,
  );
}
