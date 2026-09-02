/**
 * Flex slots — what an extra spell costs in Energy.
 *
 * See `docs/energy-and-flex-slots.md`. A flex slot holds any spell from any
 * family, including a second spell from a family the main bar already fills.
 * Firing one spends Energy *and* starts the spell's normal cooldown; the two
 * gates answer different questions, so both are needed.
 */

import { ABILITIES, SPELL_SLOTS, type SpellSlotId, type SpellTag } from "./abilities";
import { ENERGY_MAX_PIPS } from "./energy";

/** How many spells a player may keep in flex slots, bound to `1`/`2`/`3`. */
export const FLEX_SLOT_COUNT = 3;

/**
 * A player's flex picks, positional and fixed-length. `null` is an empty slot,
 * which is a legitimate state -- an unspent slot costs nothing and a player may
 * prefer to keep the bar simple.
 */
export type FlexLoadout = (string | null)[];

export const EMPTY_FLEX_LOADOUT: FlexLoadout = Array.from(
  { length: FLEX_SLOT_COUNT },
  () => null,
);

/**
 * Cost in pips, by slot family.
 *
 * Priced as a fraction of the bar rather than per spell. This is only sound
 * because every ability has exactly one entry in `allowedSlots` (verified: 35
 * abilities, 5 per family, none listing two), so a spell's family is intrinsic
 * to it and "cost by family" and "cost by spell" say the same thing. There is
 * no rebinding exploit because there is no rebinding -- a `q` spell cannot be
 * moved into the `f` family to dodge its price.
 *
 * The fractions are the design: an `f` costs the whole bar, so it is a
 * once-per-fill decision, while an `m1` at a quarter is the closest thing to a
 * filler. `space` is priced with `q`/`e`/`r` rather than below them, because
 * what it buys is a second mobility option, which is the strongest thing a
 * flex slot can offer.
 *
 * Deliberately steep. At the original eighth-to-half rates a flex spell was
 * cheap enough to fold into a normal rotation, which made it a permanent
 * extra button rather than the occasional burst it is meant to be.
 */
export const FLEX_COST_BY_FAMILY: Record<SpellSlotId, number> = {
  m1: 2,
  m2: 4,
  space: 6,
  q: 6,
  e: 6,
  r: 6,
  f: ENERGY_MAX_PIPS,
};

/**
 * Per-spell corrections for outliers.
 *
 * The family rate is the default, not a law. Rift Fissure is a `space` spell
 * on a 26s cooldown -- far longer than its family, because its power does not
 * belong to the mobility budget the family rate assumes. At the family rate it
 * would be a discount on the strongest single effect in the game, so it pays a
 * full bar.
 */
export const FLEX_COST_OVERRIDES: Record<string, number> = {
  riftFissure: ENERGY_MAX_PIPS,
};

/** Energy cost, in pips, of firing `abilityId` from a flex slot. */
export function flexCost(abilityId: string): number {
  const override = FLEX_COST_OVERRIDES[abilityId];
  if (override !== undefined) return override;

  const family = ABILITIES[abilityId]?.allowedSlots[0];
  if (!family) return ENERGY_MAX_PIPS; // Unknown spell: charge the most, never the least.
  return FLEX_COST_BY_FAMILY[family];
}

/** Whether `energy` pips can pay for `abilityId`. Spending is whole-pip. */
export function canAffordFlex(energy: number, abilityId: string): boolean {
  return Math.floor(energy) >= flexCost(abilityId);
}

/** Slot family label for UI grouping, e.g. `m1` -> "LMB". */
export function familyLabel(family: SpellSlotId): string {
  return SPELL_SLOTS.find((s) => s.id === family)?.label ?? family;
}

/**
 * Coarse role buckets for filtering the flex pool.
 *
 * Folded down from the 44 mechanical tags in use, which exist for talent
 * matching and are far too fine to hand a player as filter chips. These six
 * answer the only question being asked while browsing -- "what kind of thing
 * am I adding to my kit" -- and a spell may sit in several, because a spell
 * that roots and damages genuinely is both.
 */
export const FLEX_ROLES = [
  { id: "damage", label: "Damage", tags: ["Damage", "DamageOverTime", "Explosion"] },
  { id: "healing", label: "Healing", tags: ["Healing", "HealOverTime", "Ally"] },
  {
    id: "control",
    label: "Control",
    tags: [
      "Control", "CrowdControl", "Stun", "Root", "Silence", "Fear",
      "Slow", "Knockback", "Pull", "Knockup", "Interrupt",
    ],
  },
  { id: "mobility", label: "Mobility", tags: ["Movement", "Dash", "Blink", "Haste"] },
  {
    id: "defense",
    label: "Defense",
    tags: ["Defense", "Defensive", "Shield", "Barrier", "Counter", "Reflect", "Stealth"],
  },
  {
    id: "utility",
    label: "Utility",
    tags: ["Utility", "Summon", "Trap", "Obstacle", "Wall", "GroundEffect", "Reveal", "Cleanse", "Purge"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  tags: readonly SpellTag[];
}>;

export type FlexRoleId = (typeof FLEX_ROLES)[number]["id"];

/** Roles an ability belongs to. May be empty for a spell with no matching tag. */
export function rolesForAbility(abilityId: string): FlexRoleId[] {
  const tags = ABILITIES[abilityId]?.tags ?? [];
  if (tags.length === 0) return [];
  return FLEX_ROLES.filter((r) => r.tags.some((t) => tags.includes(t))).map((r) => r.id);
}

/**
 * Coerce stored flex picks into a valid fixed-length loadout.
 *
 * Unlike `normalizeLoadout` for the main bar, an unknown or duplicate entry
 * becomes `null` rather than a default spell. A flex slot is opt-in, so
 * silently substituting a spell the player did not choose would put something
 * on their bar -- and charge them Energy for it -- without being asked.
 */
export function normalizeFlexLoadout(raw: readonly (string | null | undefined)[] | null | undefined): FlexLoadout {
  const out: FlexLoadout = [];
  const seen = new Set<string>();
  for (let i = 0; i < FLEX_SLOT_COUNT; i++) {
    const id = raw?.[i];
    // Duplicates are dropped: two slots holding one spell share its cooldown,
    // so the second is dead weight the player would only discover mid-fight.
    if (!id || !ABILITIES[id] || seen.has(id)) {
      out.push(null);
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
