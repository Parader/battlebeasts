export interface ResourceDef {
  id: string;
  name: string;
}

export const RESOURCES: Record<string, ResourceDef> = {
  scrap: { id: "scrap", name: "Scrap" },
  essence: { id: "essence", name: "Essence" },
};

export interface ShopItemDef {
  id: string;
  name: string;
  cost: { resourceId: string; amount: number };
}

export const SHOP_ITEMS: Record<string, ShopItemDef> = {
  health_tonic: {
    id: "health_tonic",
    name: "Health Tonic",
    cost: { resourceId: "scrap", amount: 5 },
  },
  paint_red: {
    id: "paint_red",
    name: "Crimson Paint",
    cost: { resourceId: "essence", amount: 3 },
  },
};
