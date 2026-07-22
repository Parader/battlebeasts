export interface ResourceDef {
  id: string;
  name: string;
}

/** Metal stack (WoW-style) + magical essence. */
export const RESOURCES: Record<string, ResourceDef> = {
  copper: { id: "copper", name: "Copper" },
  silver: { id: "silver", name: "Silver" },
  gold: { id: "gold", name: "Gold" },
  essence: { id: "essence", name: "Essence" },
};

export const COPPER_PER_SILVER = 100;
export const SILVER_PER_GOLD = 100;
export const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD;

export type CoinPurse = {
  copper: number;
  silver: number;
  gold: number;
};

export type Wallet = CoinPurse & {
  essence: number;
};

export function coinsToCopper(purse: CoinPurse): number {
  return (
    Math.max(0, purse.copper) +
    Math.max(0, purse.silver) * COPPER_PER_SILVER +
    Math.max(0, purse.gold) * COPPER_PER_GOLD
  );
}

export function copperToCoins(totalCopper: number): CoinPurse {
  let remaining = Math.max(0, Math.floor(totalCopper));
  const gold = Math.floor(remaining / COPPER_PER_GOLD);
  remaining -= gold * COPPER_PER_GOLD;
  const silver = Math.floor(remaining / COPPER_PER_SILVER);
  remaining -= silver * COPPER_PER_SILVER;
  return { gold, silver, copper: remaining };
}

/** Normalize overflow (e.g. 150 copper → 1s 50c). */
export function normalizeCoins(purse: CoinPurse): CoinPurse {
  return copperToCoins(coinsToCopper(purse));
}

export function formatCoins(purse: CoinPurse): string {
  const n = normalizeCoins(purse);
  const parts: string[] = [];
  if (n.gold > 0) parts.push(`${n.gold}g`);
  if (n.silver > 0) parts.push(`${n.silver}s`);
  if (n.copper > 0 || parts.length === 0) parts.push(`${n.copper}c`);
  return parts.join(" ");
}

export function formatWallet(wallet: Wallet): string {
  return `${formatCoins(wallet)} · ${wallet.essence} essence`;
}

export function canAffordCoins(purse: CoinPurse, costCopper: number): boolean {
  return coinsToCopper(purse) >= costCopper;
}

export function spendCoins(purse: CoinPurse, costCopper: number): CoinPurse | null {
  const total = coinsToCopper(purse);
  if (total < costCopper) return null;
  return copperToCoins(total - costCopper);
}

export function addCoins(purse: CoinPurse, add: Partial<CoinPurse>): CoinPurse {
  return normalizeCoins({
    copper: purse.copper + (add.copper ?? 0),
    silver: purse.silver + (add.silver ?? 0),
    gold: purse.gold + (add.gold ?? 0),
  });
}

export type ShopCost =
  | { kind: "coins"; copper: number }
  | { kind: "essence"; amount: number };

export interface ShopItemDef {
  id: string;
  name: string;
  cost: ShopCost;
}

export const SHOP_ITEMS: Record<string, ShopItemDef> = {
  health_tonic: {
    id: "health_tonic",
    name: "Health Tonic",
    cost: { kind: "coins", copper: 50 }, // 50c
  },
  paint_red: {
    id: "paint_red",
    name: "Crimson Paint",
    cost: { kind: "essence", amount: 3 },
  },
  copper_pouch: {
    id: "copper_pouch",
    name: "Copper Pouch",
    cost: { kind: "essence", amount: 1 },
  },
};

export function formatShopCost(cost: ShopCost): string {
  if (cost.kind === "essence") return `${cost.amount} essence`;
  return formatCoins(copperToCoins(cost.copper));
}
