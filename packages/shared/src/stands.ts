export type StandKind = "customization" | "build" | "talent" | "shop";

/**
 * Blender map is authored at native RTS scale. Multiply so it reads
 * next to the ~1.7m Mixamo avatar. Single knob for the whole hub.
 */
export const HUB_WORLD_SCALE = 5;

/** Portal torus size in the hub (visual + ring collision). */
export const PORTAL_VISUAL_SCALE = 2.75;
export const PORTAL_TORUS_MAJOR = 0.55 * PORTAL_VISUAL_SCALE;
export const PORTAL_TORUS_TUBE = 0.07 * PORTAL_VISUAL_SCALE;
/** Solid tube radius for the vertical portal legs (XZ bumpers). */
export const PORTAL_RING_COLLIDE_RADIUS = 0.35;

export interface StandDef {
  id: string;
  kind: StandKind;
  label: string;
  /** World position of the interact marker (XZ). */
  x: number;
  z: number;
}

/** Hub join / respawn point (world coords from placement helper). */
export const HUB_SPAWN = { x: -1.529, z: -6.084 } as const;

/**
 * Interact pads — world positions from in-game placement helper (F4).
 * shop → left stand, spells → barracks, customization → house, talents → temple side.
 */
export const BASE_CITY_STANDS: StandDef[] = [
  { id: "stand_shop", kind: "shop", label: "Shop", x: -17.089, z: -4.503 },
  { id: "stand_build", kind: "build", label: "Spells", x: -7.967, z: -11.48 },
  { id: "stand_customization", kind: "customization", label: "Customization", x: 4.236, z: -12.581 },
  { id: "stand_talent", kind: "talent", label: "Talents", x: 11.454, z: -5.249 },
];

export interface PortalPadDef {
  id: "portal_pvp" | "portal_pve";
  kind: "pvp" | "pve";
  label: string;
  x: number;
  z: number;
}

export const BASE_CITY_PORTALS: PortalPadDef[] = [
  { id: "portal_pvp", kind: "pvp", label: "PvP Portal", x: -3.908, z: -18.56 },
  { id: "portal_pve", kind: "pve", label: "PvE Portal", x: 2.097, z: -18.404 },
];

export const PRACTICE_DUMMY = { x: 0.14, z: -0.844 } as const;

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

export const MAX_TALENTS = 2;
