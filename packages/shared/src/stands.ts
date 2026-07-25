import type { SpellTag } from "./abilities";

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

/** Oriented ground pad from a Blender Empty cube (hub world units). */
export type InteractZone = {
  x: number;
  z: number;
  /** Half-extent along local +X after yaw. */
  halfX: number;
  /** Half-extent along local +Z after yaw. */
  halfZ: number;
  rotationY: number;
};

export interface StandDef extends InteractZone {
  id: string;
  kind: StandKind;
  label: string;
}

/** Hub join / respawn point fallback (overridden by map Interact=spawn). */
export const HUB_SPAWN_FALLBACK = { x: -1.529, z: -6.084 } as const;

/**
 * Interact pads — world positions from in-game placement helper (F4).
 * shop → left stand, spells → barracks, customization → house, talents → temple side.
 */
export const BASE_CITY_STANDS: StandDef[] = [
  {
    id: "stand_shop",
    kind: "shop",
    label: "Shop",
    x: -17.089,
    z: -4.503,
    halfX: 2.15,
    halfZ: 2.15,
    rotationY: 0,
  },
  {
    id: "stand_build",
    kind: "build",
    label: "Spells",
    x: -7.967,
    z: -11.48,
    halfX: 2.15,
    halfZ: 2.15,
    rotationY: 0,
  },
  {
    id: "stand_customization",
    kind: "customization",
    label: "Customization",
    x: 4.236,
    z: -12.581,
    halfX: 2.15,
    halfZ: 2.15,
    rotationY: 0,
  },
  {
    id: "stand_talent",
    kind: "talent",
    label: "Talents",
    x: 11.454,
    z: -5.249,
    halfX: 2.15,
    halfZ: 2.15,
    rotationY: 0,
  },
];

export interface PortalPadDef extends InteractZone {
  id: "portal_pvp" | "portal_pve";
  kind: "pvp" | "pve";
  label: string;
}

export const BASE_CITY_PORTALS: PortalPadDef[] = [
  {
    id: "portal_pvp",
    kind: "pvp",
    label: "PvP Portal",
    x: -3.908,
    z: -18.56,
    halfX: PORTAL_TORUS_MAJOR * 1.15,
    halfZ: PORTAL_TORUS_MAJOR * 1.15,
    rotationY: 0,
  },
  {
    id: "portal_pve",
    kind: "pve",
    label: "PvE Portal",
    x: 2.097,
    z: -18.404,
    halfX: PORTAL_TORUS_MAJOR * 1.15,
    halfZ: PORTAL_TORUS_MAJOR * 1.15,
    rotationY: 0,
  },
];

export const PRACTICE_DUMMY = { x: 0.14, z: -0.844 } as const;

/** True if (px,pz) lies inside an oriented ground pad. */
export function pointInInteractZone(px: number, pz: number, zone: InteractZone): boolean {
  const dx = px - zone.x;
  const dz = pz - zone.z;
  const c = Math.cos(-zone.rotationY);
  const s = Math.sin(-zone.rotationY);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= zone.halfX && Math.abs(lz) <= zone.halfZ;
}

/** Distance from point to zone center (for picking nearest when overlapping). */
export function interactZoneDist(px: number, pz: number, zone: InteractZone): number {
  return Math.hypot(px - zone.x, pz - zone.z);
}

/** Live talent modifiers — baked by resolveKit, never scanned per tick. */
export type TalentMod =
  | { kind: "maxHp"; amount: number }
  | { kind: "moveSpeedMul"; mul: number }
  | { kind: "cooldownMul"; mul: number; tags?: readonly SpellTag[] };

export interface TalentDef {
  id: string;
  name: string;
  description: string;
  /** Live talent mods baked by resolveKit. Catalog entries omit this. */
  mods?: readonly TalentMod[];
  status?: "live" | "catalog";
}

export const TALENTS: Record<string, TalentDef> = {
  tough: {
    id: "tough",
    name: "Tough",
    description: "+10 max HP",
    status: "live",
    mods: [{ kind: "maxHp", amount: 10 }],
  },
  swift: {
    id: "swift",
    name: "Swift",
    description: "+8% move speed",
    status: "live",
    mods: [{ kind: "moveSpeedMul", mul: 1.08 }],
  },
  focused: {
    id: "focused",
    name: "Focused",
    description: "-10% ability cooldowns",
    status: "live",
    mods: [{ kind: "cooldownMul", mul: 0.9 }],
  },
};

/** Whole-body hide tints (Appearance stand). */
export const COSMETIC_COLORS = [
  "#f8fafc", // frost
  "#e7e5e4", // bone
  "#fcd34d", // sand
  "#fb923c", // amber
  "#ef4444", // crimson
  "#f472b6", // blossom
  "#c084fc", // violet
  "#60a5fa", // sky
  "#22d3ee", // aqua
  "#4ade80", // moss
  "#a3e635", // lime
  "#84cc16", // leaf
  "#2dd4bf", // teal
  "#94a3b8", // slate
  "#a8a29e", // stone
  "#78716c", // clay
] as const;

/** Ink / marking colors for creature patterns (independent of hide tint). */
export const COSMETIC_PATTERN_COLORS = [
  "#1f2937",
  "#7f1d1d",
  "#1e3a8a",
  "#14532d",
  "#78350f",
  "#4c1d95",
  "#0f766e",
  "#a16207",
] as const;

export const DEFAULT_COSMETIC_PATTERN_COLOR = COSMETIC_PATTERN_COLORS[0];

/** Full-body creature hide patterns (applied as UV albedo on Beta_Surface). */
export type CosmeticPatternId =
  | "plain"
  | "scales"
  | "stripes"
  | "spots"
  | "plates"
  | "mottle"
  | "serpent";

export interface CosmeticPatternDef {
  id: CosmeticPatternId;
  name: string;
  description: string;
}

export const COSMETIC_PATTERNS: readonly CosmeticPatternDef[] = [
  { id: "plain", name: "Plain", description: "Solid hide — tint only." },
  { id: "scales", name: "Scales", description: "Overlapping reptile scales." },
  { id: "stripes", name: "Stripes", description: "Bold tiger-like bands." },
  { id: "spots", name: "Spots", description: "Leopard-style rosettes." },
  { id: "plates", name: "Plates", description: "Hex armored chitin." },
  { id: "mottle", name: "Mottle", description: "Speckled beast hide." },
  { id: "serpent", name: "Serpent", description: "Coiling diamond bands." },
] as const;

export const DEFAULT_COSMETIC_PATTERN: CosmeticPatternId = "plain";

export function isCosmeticPatternId(value: unknown): value is CosmeticPatternId {
  return (
    typeof value === "string" &&
    COSMETIC_PATTERNS.some((p) => p.id === value)
  );
}

export function normalizeCosmeticPattern(value: unknown): CosmeticPatternId {
  return isCosmeticPatternId(value) ? value : DEFAULT_COSMETIC_PATTERN;
}

export function isCosmeticPatternColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (COSMETIC_PATTERN_COLORS as readonly string[]).includes(value)
  );
}

export function normalizeCosmeticPatternColor(value: unknown): string {
  return isCosmeticPatternColor(value) ? value : DEFAULT_COSMETIC_PATTERN_COLOR;
}

export const MAX_TALENTS = 2;
