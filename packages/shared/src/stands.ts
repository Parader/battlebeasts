export type StandKind = "customization" | "build" | "talent" | "shop";

export interface StandDef {
  id: string;
  kind: StandKind;
  label: string;
  /** World position in base city (XZ plane). */
  x: number;
  z: number;
}

export const BASE_CITY_STANDS: StandDef[] = [
  { id: "stand_customization", kind: "customization", label: "Customization", x: -8, z: 4 },
  { id: "stand_build", kind: "build", label: "Build", x: -4, z: 4 },
  { id: "stand_talent", kind: "talent", label: "Talents", x: 4, z: 4 },
  { id: "stand_shop", kind: "shop", label: "Shop", x: 8, z: 4 },
];

export interface PortalPadDef {
  id: "portal_pvp" | "portal_pve";
  kind: "pvp" | "pve";
  label: string;
  x: number;
  z: number;
}

export const BASE_CITY_PORTALS: PortalPadDef[] = [
  { id: "portal_pvp", kind: "pvp", label: "PvP Portal", x: -6, z: -8 },
  { id: "portal_pve", kind: "pve", label: "PvE Portal", x: 6, z: -8 },
];

export const PRACTICE_DUMMY = { x: 0, z: 8 } as const;

export interface TalentDef {
  id: string;
  name: string;
  description: string;
}

export const TALENTS: Record<string, TalentDef> = {
  tough: { id: "tough", name: "Tough", description: "+10 max HP" },
  swift: { id: "swift", name: "Swift", description: "+8% move speed" },
  focused: { id: "focused", name: "Focused", description: "-10% ability cooldowns" },
};

export const COSMETIC_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#ef4444"] as const;

export const LOADOUT_SIZE = 3;
export const MAX_TALENTS = 2;
