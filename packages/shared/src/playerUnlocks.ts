/** Account unlock collections — cosmetics, spells, emotes, loadout slots. */

import { starterCosmeticIds } from "./cosmetics";
import { starterEmoteIds, emptyEmoteSlots, normalizeEmoteSlots } from "./emotes";
import {
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
} from "./stands";

/**
 * Free spell ids (mirrors DEFAULT_LOADOUT — keep in sync with abilities.ts defaults).
 * Kept here to avoid a circular import with the abilities module.
 * Order matches SPELL_SLOTS: LMB, RMB, Space, Q, E, R, F — first spell in each slot pool.
 */
export const STARTER_ABILITY_IDS = [
  "bolt",
  "frostBall",
  "surge",
  "gust",
  "spikes",
  "barrier",
  "fireball",
] as const;

/** Free hide tint for new players (matches PlayerState default). Neutral slate gray. */
export const STARTER_COLORS = ["#94a3b8"] as const;

export const STARTER_PATTERNS = [DEFAULT_COSMETIC_PATTERN] as const;

/** Free pattern ink — charcoal markings (white chalk is sold in the shop). */
export const STARTER_PATTERN_COLORS = [DEFAULT_COSMETIC_PATTERN_COLOR] as const;

/** Free loadout preset count. Coin shop sells slot 2; slot 3+ reserved for rubies later. */
export const STARTER_LOADOUT_SLOT_COUNT = 1;
export const MAX_COIN_LOADOUT_SLOTS = 2;
export const MAX_LOADOUT_SLOTS = 5;

/**
 * Free flex slot count. One is free so every player meets the mechanic; the
 * other two are bought with essence, which makes running all three a build
 * decision rather than a default.
 */
export const STARTER_FLEX_SLOT_COUNT = 1;
export const MAX_FLEX_SLOTS = 3;

export type PlayerUnlocks = {
  cosmetics: string[];
  colors: string[];
  patterns: string[];
  patternColors: string[];
  emotes: string[];
  abilities: string[];
  loadoutSlotCount: number;
  flexSlotCount: number;
  emoteSlots: (string | null)[];
};

export function starterAbilityIds(): string[] {
  return [...STARTER_ABILITY_IDS];
}

export function emptyPlayerUnlocks(): PlayerUnlocks {
  const emotes = starterEmoteIds();
  return {
    cosmetics: starterCosmeticIds(),
    colors: [...STARTER_COLORS],
    patterns: [...STARTER_PATTERNS],
    patternColors: [...STARTER_PATTERN_COLORS],
    emotes,
    abilities: starterAbilityIds(),
    loadoutSlotCount: STARTER_LOADOUT_SLOT_COUNT,
    flexSlotCount: STARTER_FLEX_SLOT_COUNT,
    emoteSlots: normalizeEmoteSlots(null, emotes),
  };
}

export function normalizeStringIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string" || !v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function normalizePlayerUnlocks(raw: unknown): PlayerUnlocks {
  const base = emptyPlayerUnlocks();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;

  const cosmetics = uniqueMerge(base.cosmetics, normalizeStringIdList(obj.cosmetics));
  const colors = uniqueMerge(base.colors, normalizeStringIdList(obj.colors));
  const patterns = uniqueMerge(base.patterns, normalizeStringIdList(obj.patterns));
  const patternColors = uniqueMerge(
    base.patternColors,
    normalizeStringIdList(obj.patternColors ?? obj.pattern_colors),
  );
  const emotes = uniqueMerge(base.emotes, normalizeStringIdList(obj.emotes));
  const abilities = uniqueMerge(base.abilities, normalizeStringIdList(obj.abilities));

  let loadoutSlotCount = STARTER_LOADOUT_SLOT_COUNT;
  if (typeof obj.loadoutSlotCount === "number") {
    loadoutSlotCount = obj.loadoutSlotCount;
  } else if (typeof obj.loadout_slot_count === "number") {
    loadoutSlotCount = obj.loadout_slot_count;
  }
  loadoutSlotCount = Math.max(
    STARTER_LOADOUT_SLOT_COUNT,
    Math.min(MAX_LOADOUT_SLOTS, Math.floor(loadoutSlotCount)),
  );

  let flexSlotCount = STARTER_FLEX_SLOT_COUNT;
  if (typeof obj.flexSlotCount === "number") {
    flexSlotCount = obj.flexSlotCount;
  } else if (typeof obj.flex_slot_count === "number") {
    flexSlotCount = obj.flex_slot_count;
  }
  flexSlotCount = Math.max(
    STARTER_FLEX_SLOT_COUNT,
    Math.min(MAX_FLEX_SLOTS, Math.floor(flexSlotCount)),
  );

  const emoteSlots = normalizeEmoteSlots(obj.emoteSlots ?? obj.emote_slots, emotes);

  return {
    cosmetics,
    colors,
    patterns,
    patternColors,
    emotes,
    abilities,
    loadoutSlotCount,
    flexSlotCount,
    emoteSlots,
  };
}

function uniqueMerge(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...a, ...b]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function ownsColor(owned: string[] | null | undefined, hex: string): boolean {
  if ((STARTER_COLORS as readonly string[]).includes(hex)) return true;
  return Boolean(owned?.includes(hex));
}

export function ownsPattern(owned: string[] | null | undefined, patternId: string): boolean {
  if ((STARTER_PATTERNS as readonly string[]).includes(patternId)) return true;
  return Boolean(owned?.includes(patternId));
}

export function ownsPatternColor(owned: string[] | null | undefined, hex: string): boolean {
  if ((STARTER_PATTERN_COLORS as readonly string[]).includes(hex)) return true;
  return Boolean(owned?.includes(hex));
}

export function ownsAbility(owned: string[] | null | undefined, abilityId: string): boolean {
  if ((STARTER_ABILITY_IDS as readonly string[]).includes(abilityId)) return true;
  return Boolean(owned?.includes(abilityId));
}

/** Ensure equipped appearance ids are legal; clear illegal gear. */
export function sanitizeUnlocksWithEquipped(
  unlocks: PlayerUnlocks,
  equippedCosmeticIds: string[],
  equippedColor?: string,
  equippedPattern?: string,
  equippedPatternColor?: string,
  equippedAbilityIds?: string[],
): PlayerUnlocks {
  let next = { ...unlocks };
  next.cosmetics = uniqueMerge(next.cosmetics, equippedCosmeticIds.filter(Boolean));
  if (equippedColor) next.colors = uniqueMerge(next.colors, [equippedColor]);
  if (equippedPattern) next.patterns = uniqueMerge(next.patterns, [equippedPattern]);
  if (equippedPatternColor) {
    next.patternColors = uniqueMerge(next.patternColors, [equippedPatternColor]);
  }
  if (equippedAbilityIds?.length) {
    next.abilities = uniqueMerge(next.abilities, equippedAbilityIds.filter(Boolean));
  }
  next.emoteSlots = normalizeEmoteSlots(next.emoteSlots, next.emotes);
  return next;
}

export { emptyEmoteSlots };
