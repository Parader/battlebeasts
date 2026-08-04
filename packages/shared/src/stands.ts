import type { SpellTag } from "./abilities";
import { combatMag } from "./combatMagnitude";

export type StandKind = "customization" | "build" | "talent" | "shop";

/**
 * Blender map is authored at native RTS scale. Multiply so it reads
 * next to the ~1.7m Mixamo avatar. Single knob for the whole hub.
 */
export const HUB_WORLD_SCALE = 5;

/** Portal interact pad size in the hub (ground zone footprint). */
export const PORTAL_VISUAL_SCALE = 2.75;
export const PORTAL_TORUS_MAJOR = 0.55 * PORTAL_VISUAL_SCALE;

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
    description: `+${combatMag(10)} max HP`,
    status: "live",
    mods: [{ kind: "maxHp", amount: combatMag(10) }],
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
  "#171717", // black
] as const;

/** Display names for body hide tints (keyed by hex). */
export const COSMETIC_COLOR_NAMES: Record<(typeof COSMETIC_COLORS)[number], string> = {
  "#f8fafc": "Frost",
  "#e7e5e4": "Bone",
  "#fcd34d": "Sand",
  "#fb923c": "Amber",
  "#ef4444": "Crimson",
  "#f472b6": "Blossom",
  "#c084fc": "Violet",
  "#60a5fa": "Sky",
  "#22d3ee": "Aqua",
  "#4ade80": "Moss",
  "#a3e635": "Lime",
  "#84cc16": "Leaf",
  "#2dd4bf": "Teal",
  "#94a3b8": "Slate",
  "#a8a29e": "Stone",
  "#78716c": "Clay",
  "#171717": "Black",
};

export function cosmeticColorName(hex: string): string {
  return (COSMETIC_COLOR_NAMES as Record<string, string>)[hex] ?? hex;
}

/** Ink / marking colors for creature patterns (independent of hide tint). */
export const COSMETIC_PATTERN_COLORS = [
  "#1f2937", // charcoal (starter)
  "#f8fafc", // chalk / white (shop)
  "#7f1d1d", // maroon
  "#1e3a8a", // navy
  "#14532d", // forest
  "#78350f", // walnut
  "#4c1d95", // indigo
  "#0f766e", // tide
  "#a16207", // ochre
] as const;

/** Display names for pattern ink (keyed by hex). */
export const COSMETIC_PATTERN_COLOR_NAMES: Record<
  (typeof COSMETIC_PATTERN_COLORS)[number],
  string
> = {
  "#1f2937": "Charcoal",
  "#f8fafc": "Chalk",
  "#7f1d1d": "Maroon",
  "#1e3a8a": "Navy",
  "#14532d": "Forest",
  "#78350f": "Walnut",
  "#4c1d95": "Indigo",
  "#0f766e": "Tide",
  "#a16207": "Ochre",
};

export function cosmeticPatternColorName(hex: string): string {
  return (COSMETIC_PATTERN_COLOR_NAMES as Record<string, string>)[hex] ?? hex;
}

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
