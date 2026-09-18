/**
 * Merchant catalog — cosmetics, emotes, loadout slots, consumables.
 * `"parchments"` reserved for future PvE run modifiers (no items in v1).
 */

import { COPPER_PER_GOLD, COPPER_PER_SILVER, type ShopCost } from "./resources";
import { HEALTH_TONIC_HEAL } from "./combatMagnitude";
import {
  COSMETIC_CATALOG,
  COSMETIC_SLOT_LABELS,
  type CosmeticItemDef,
  type CosmeticSlot,
} from "./cosmetics";
import { EMOTES } from "./emotes";
import {
  COSMETIC_AURAS,
  COSMETIC_COLORS,
  COSMETIC_PATTERN_COLORS,
  cosmeticAuraColorName,
  cosmeticColorName,
} from "./stands";
import { STARTER_COLORS, STARTER_PATTERN_COLORS, STARTER_PATTERNS } from "./playerUnlocks";

/** Max beach balls a lobby owner can place in their hub. */
export const MAX_LOBBY_BEACH_BALLS = 2;

export type ShopCategory =
  | "cosmetics"
  | "emotes"
  | "loadouts"
  | "lobby"
  | "consumables"
  | "parchments";

export type ShopGrant =
  | { kind: "cosmetic"; itemId: string }
  | { kind: "color"; hex: string }
  | { kind: "pattern"; patternId: string }
  | { kind: "pattern_color"; hex: string }
  | { kind: "emote"; emoteId: string }
  | { kind: "loadout_slot"; toCount: number }
  | { kind: "flex_slot"; toCount: number }
  | { kind: "lobby_beach_ball"; toCount: number }
  | { kind: "consumable"; effect: "health_tonic" | "copper_pouch" }
  | { kind: "item_stack"; itemId: string; qty: number };

export interface ShopItemDef {
  id: string;
  name: string;
  category: ShopCategory;
  cost: ShopCost;
  grant: ShopGrant;
  description?: string;
  /** Future ruby / RMT rows — omit from live Merchant until monetization. */
  premium?: boolean;
}

function coins(copper: number): ShopCost {
  return { kind: "coins", copper };
}

/** Live Merchant offerings (v1 — coin priced, no premium rows). */
export const SHOP_ITEMS: Record<string, ShopItemDef> = {
  health_tonic: {
    id: "health_tonic",
    name: "Health Tonic",
    category: "consumables",
    cost: coins(35),
    grant: { kind: "consumable", effect: "health_tonic" },
    description: `+${HEALTH_TONIC_HEAL} HP`,
  },
  copper_pouch: {
    id: "copper_pouch",
    name: "Copper Pouch",
    category: "consumables",
    cost: { kind: "essence", amount: 1 },
    grant: { kind: "consumable", effect: "copper_pouch" },
    description: "+80 copper",
  },
  loadout_slot_2: {
    id: "loadout_slot_2",
    name: "Loadout Preset Slot",
    category: "loadouts",
    cost: coins(80 * COPPER_PER_SILVER),
    grant: { kind: "loadout_slot", toCount: 2 },
    description: "Unlock a second saved spell loadout",
  },
  flex_slot_1: {
    id: "flex_slot_1",
    name: "Flex Slot",
    category: "loadouts",
    cost: { kind: "essence", amount: 80 },
    grant: { kind: "flex_slot", toCount: 1 },
    description: "Unlock flex slot 1 (key 1)",
  },
  flex_slot_2: {
    id: "flex_slot_2",
    name: "Second Flex Slot",
    category: "loadouts",
    cost: { kind: "essence", amount: 150 },
    grant: { kind: "flex_slot", toCount: 2 },
    description: "Unlock flex slot 2 (key 2)",
  },
  flex_slot_3: {
    id: "flex_slot_3",
    name: "Third Flex Slot",
    category: "loadouts",
    cost: { kind: "essence", amount: 300 },
    grant: { kind: "flex_slot", toCount: 3 },
    description: "Unlock flex slot 3 (key 3)",
  },

  /** First beach ball for your own lobby plaza. */
  beach_ball: {
    id: "beach_ball",
    name: "Beach Ball",
    category: "lobby",
    cost: coins(50 * COPPER_PER_SILVER),
    grant: { kind: "lobby_beach_ball", toCount: 1 },
    description: "Place a beach ball in your lobby. Own lobby only.",
  },
  /** Second beach ball — gold tier. */
  beach_ball_2: {
    id: "beach_ball_2",
    name: "Second Beach Ball",
    category: "lobby",
    cost: coins(COPPER_PER_GOLD),
    grant: { kind: "lobby_beach_ball", toCount: 2 },
    description: "Add a second beach ball to your lobby. Requires the first ball. Own lobby only.",
  },
};

// Body colors (skip starters)
for (const hex of COSMETIC_COLORS) {
  if ((STARTER_COLORS as readonly string[]).includes(hex)) continue;
  const id = `color_${hex.slice(1)}`;
  SHOP_ITEMS[id] = {
    id,
    name: cosmeticColorName(hex),
    category: "cosmetics",
    cost: coins(90),
    grant: { kind: "color", hex },
    description: "Two-tone hide pigment.",
  };
}

for (const hex of COSMETIC_PATTERN_COLORS) {
  if ((STARTER_PATTERN_COLORS as readonly string[]).includes(hex)) continue;
  const id = `ink_${hex.slice(1)}`;
  SHOP_ITEMS[id] = {
    id,
    name: `${cosmeticAuraColorName(hex)} Ink`,
    category: "cosmetics",
    cost: coins(70),
    grant: { kind: "pattern_color", hex },
    description: "Color of the equipped aura. Bound has nothing to dye.",
  };
}

for (const aura of COSMETIC_AURAS) {
  if ((STARTER_PATTERNS as readonly string[]).includes(aura.id)) continue;
  const id = `aura_${aura.id}`;
  SHOP_ITEMS[id] = {
    id,
    name: `${aura.name} Aura`,
    category: "cosmetics",
    cost: coins(160),
    grant: { kind: "pattern", patternId: aura.id },
    description: aura.description,
  };
}

/** Slot silhouette weight — belts/bracers cheap, chests/shoulders statement pieces. */
const GEAR_SLOT_BASE_COPPER: Record<CosmeticSlot, number> = {
  belt: 6 * COPPER_PER_SILVER,
  gloves: 7 * COPPER_PER_SILVER,
  shoes: 8 * COPPER_PER_SILVER,
  hat: 9 * COPPER_PER_SILVER,
  legs: 10 * COPPER_PER_SILVER,
  shoulders: 12 * COPPER_PER_SILVER,
  chest: 14 * COPPER_PER_SILVER,
};

/** Later sets in the same slot cost more. */
const GEAR_SET_STEP_COPPER = 2 * COPPER_PER_SILVER;

/** Named one-offs sitting above their slot's first set. */
const GEAR_UNIQUE_EXTRA_COPPER: Record<string, number> = {
  hat_wizard: 4 * COPPER_PER_SILVER,
};

function gearSetIndex(itemId: string): number {
  const match = itemId.match(/_(\d+)$/);
  if (!match) return 1;
  return Math.max(1, Number(match[1]) || 1);
}

/** Merchant copper price for a wearable. New catalog rows pick this up automatically. */
export function gearShopCopper(item: CosmeticItemDef): number {
  const base = GEAR_SLOT_BASE_COPPER[item.slot];
  const unique = GEAR_UNIQUE_EXTRA_COPPER[item.id];
  const extra = unique ?? (gearSetIndex(item.id) - 1) * GEAR_SET_STEP_COPPER;
  return base + extra;
}

function syncCosmeticShopItems(): void {
  for (const item of Object.values(COSMETIC_CATALOG)) {
    const id = `gear_${item.id}`;
    SHOP_ITEMS[id] = {
      id,
      name: item.name,
      category: "cosmetics",
      cost: coins(gearShopCopper(item)),
      grant: { kind: "cosmetic", itemId: item.id },
      description: COSMETIC_SLOT_LABELS[item.slot],
    };
  }
}

syncCosmeticShopItems();

/** Non-starter emotes — 20 silver (was 2s before economy scale). */
const EMOTE_SHOP_COPPER = 2000;

for (const emote of Object.values(EMOTES)) {
  if (emote.starter) continue;
  const id = `emote_${emote.id}`;
  SHOP_ITEMS[id] = {
    id,
    name: emote.name,
    category: "emotes",
    cost: coins(EMOTE_SHOP_COPPER),
    grant: { kind: "emote", emoteId: emote.id },
  };
}

/** Categories shown in Merchant UI (parchments reserved / hidden). */
export const SHOP_UI_CATEGORIES: readonly ShopCategory[] = [
  "cosmetics",
  "emotes",
  "loadouts",
  "lobby",
] as const;

export const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  cosmetics: "Cosmetics",
  emotes: "Emotes",
  loadouts: "Loadouts",
  lobby: "Lobby",
  consumables: "Consumables",
  parchments: "Parchments",
};

export function shopItemsForCategory(category: ShopCategory): ShopItemDef[] {
  syncCosmeticShopItems();
  return Object.values(SHOP_ITEMS).filter(
    (item) => item.category === category && !item.premium,
  );
}

export function getShopItem(id: string): ShopItemDef | undefined {
  syncCosmeticShopItems();
  return SHOP_ITEMS[id];
}

/** Shop id that unlocks the flex slot bringing the total to `toCount`. */
export function flexSlotShopItemId(toCount: number): string {
  return `flex_slot_${toCount}`;
}

/** Essence price of the flex slot bringing the total to `toCount`; 0 if free. */
export function flexSlotUnlockCost(toCount: number): number {
  const cost = SHOP_ITEMS[flexSlotShopItemId(toCount)]?.cost;
  return cost?.kind === "essence" ? cost.amount : 0;
}
