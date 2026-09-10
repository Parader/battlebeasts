import { ABILITIES, LOADOUT_SIZE, SPELL_SLOTS, type SpellSlotId } from "./abilities";

/** Empty hotbar — new and reset characters start with no spells slotted. */
export const EMPTY_LOADOUT: readonly string[] = SPELL_SLOTS.map(() => "");

/** One-time chest granted when the hunter first fills all seven bar slots. */
export const TUTORIAL_CHEST_SOURCE = "tutorial:first_build";
export const TUTORIAL_CHEST_QUALITY = "blue";
/** Enough essence for two talent-point buys (40 each). */
export const TUTORIAL_CHEST_ESSENCE = 80;
export const TUTORIAL_CHEST_COPPER = 25;

/** True when every main-bar slot has a spell. Flex is optional. */
export function isLoadoutReady(abilityIds: readonly string[] | null | undefined): boolean {
  if (!abilityIds || abilityIds.length < LOADOUT_SIZE) return false;
  for (let i = 0; i < LOADOUT_SIZE; i++) {
    if (!abilityIds[i]) return false;
  }
  return true;
}

export function abilityFamily(abilityId: string): SpellSlotId | null {
  return ABILITIES[abilityId]?.allowedSlots[0] ?? null;
}

/**
 * First essence-buy of each family is free so a new hunter can fill the bar
 * without a starting wallet. Talent-tree spells never consume the voucher.
 */
export function hasFirstUnlockVoucher(
  owned: readonly string[] | null | undefined,
  abilityId: string,
): boolean {
  const def = ABILITIES[abilityId];
  if (!def || def.talentTreeUnlock) return false;
  const family = def.allowedSlots[0];
  if (!family) return false;
  return !(owned ?? []).some((id) => {
    const other = ABILITIES[id];
    if (!other || other.talentTreeUnlock) return false;
    return other.allowedSlots[0] === family;
  });
}

export function abilityUnlockCostForPlayer(
  abilityId: string,
  owned: readonly string[] | null | undefined,
): number {
  if (hasFirstUnlockVoucher(owned, abilityId)) return 0;
  const def = ABILITIES[abilityId];
  if (!def || def.talentTreeUnlock) return 0;
  return Math.max(0, def.unlockCostEssence ?? 80);
}
