/**
 * Merchant catalog — cosmetics, emotes, loadout slots, consumables.
 * `"parchments"` reserved for future PvE run modifiers (no items in v1).
 */

import { COPPER_PER_SILVER, type ShopCost } from "./resources";
import { HEALTH_TONIC_HEAL } from "./combatMagnitude";
import { COSMETIC_CATALOG } from "./cosmetics";
import { EMOTES } from "./emotes";
import {
  COSMETIC_COLORS,
  COSMETIC_PATTERN_COLORS,
  COSMETIC_PATTERNS,
} from "./stands";
import { STARTER_COLORS, STARTER_PATTERN_COLORS, STARTER_PATTERNS } from "./playerUnlocks";

export type ShopCategory =
  | "cosmetics"
  | "emotes"
  | "loadouts"
  | "consumables"
  | "parchments";

export type ShopGrant =
  | { kind: "cosmetic"; itemId: string }
  | { kind: "color"; hex: string }
  | { kind: "pattern"; patternId: string }
  | { kind: "pattern_color"; hex: string }
  | { kind: "emote"; emoteId: string }
  | { kind: "loadout_slot"; toCount: number }
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
};

// Body colors (skip starters)
for (const hex of COSMETIC_COLORS) {
  if ((STARTER_COLORS as readonly string[]).includes(hex)) continue;
  const id = `color_${hex.slice(1)}`;
  SHOP_ITEMS[id] = {
    id,
    name: `Body Color ${hex}`,
    category: "cosmetics",
    cost: coins(90),
    grant: { kind: "color", hex },
  };
}

for (const hex of COSMETIC_PATTERN_COLORS) {
  if ((STARTER_PATTERN_COLORS as readonly string[]).includes(hex)) continue;
  const id = `ink_${hex.slice(1)}`;
  SHOP_ITEMS[id] = {
    id,
    name: `Pattern Ink ${hex}`,
    category: "cosmetics",
    cost: coins(70),
    grant: { kind: "pattern_color", hex },
  };
}

for (const pattern of COSMETIC_PATTERNS) {
  if ((STARTER_PATTERNS as readonly string[]).includes(pattern.id)) continue;
  const id = `pattern_${pattern.id}`;
  SHOP_ITEMS[id] = {
    id,
    name: `${pattern.name} Pattern`,
    category: "cosmetics",
    cost: coins(160),
    grant: { kind: "pattern", patternId: pattern.id },
    description: pattern.description,
  };
}

for (const item of Object.values(COSMETIC_CATALOG)) {
  const id = `gear_${item.id}`;
  SHOP_ITEMS[id] = {
    id,
    name: item.name,
    category: "cosmetics",
    cost: coins(280),
    grant: { kind: "cosmetic", itemId: item.id },
    description: item.slot,
  };
}

for (const emote of Object.values(EMOTES)) {
  if (emote.starter) continue;
  const id = `emote_${emote.id}`;
  SHOP_ITEMS[id] = {
    id,
    name: emote.name,
    category: "emotes",
    cost: coins(200),
    grant: { kind: "emote", emoteId: emote.id },
  };
}

/** Categories shown in Merchant UI (parchments reserved / hidden). */
export const SHOP_UI_CATEGORIES: readonly ShopCategory[] = [
  "cosmetics",
  "emotes",
  "loadouts",
  "consumables",
] as const;

export const SHOP_CATEGORY_LABELS: Record<ShopCategory, string> = {
  cosmetics: "Cosmetics",
  emotes: "Emotes",
  loadouts: "Loadouts",
  consumables: "Consumables",
  parchments: "Parchments",
};

export function shopItemsForCategory(category: ShopCategory): ShopItemDef[] {
  return Object.values(SHOP_ITEMS).filter(
    (item) => item.category === category && !item.premium,
  );
}

export function getShopItem(id: string): ShopItemDef | undefined {
  return SHOP_ITEMS[id];
}
