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

/** Whole-body hide tints (Appearance stand). Every hide is a two-tone. */
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

/** Two-tone hides. `a` is the catalog hex unless overridden. */
export type HideGradeKind = "solid" | "vertical" | "belly";

export type HideGradeSpec = {
  a?: string;
  b: string;
  grade: Exclude<HideGradeKind, "solid">;
};

export const COSMETIC_HIDE_GRADES: Record<(typeof COSMETIC_COLORS)[number], HideGradeSpec> = {
  "#f8fafc": { b: "#64748b", grade: "vertical" },
  "#e7e5e4": { b: "#57534e", grade: "vertical" },
  "#fcd34d": { b: "#57534e", grade: "vertical" },
  "#fb923c": { b: "#44403c", grade: "vertical" },
  "#ef4444": { b: "#3f1d1d", grade: "vertical" },
  "#f472b6": { b: "#4a3040", grade: "belly" },
  "#c084fc": { b: "#2e2a44", grade: "vertical" },
  "#60a5fa": { b: "#1e3a5f", grade: "vertical" },
  "#22d3ee": { b: "#164e63", grade: "vertical" },
  "#4ade80": { b: "#1c2e1c", grade: "belly" },
  "#a3e635": { b: "#2a3310", grade: "belly" },
  "#84cc16": { b: "#1a2e05", grade: "belly" },
  "#2dd4bf": { b: "#134e4a", grade: "belly" },
  "#94a3b8": { b: "#334155", grade: "vertical" },
  "#a8a29e": { b: "#44403c", grade: "vertical" },
  "#78716c": { b: "#292524", grade: "vertical" },
  "#171717": { a: "#3f3f46", b: "#0a0a0a", grade: "vertical" },
};

export function cosmeticColorName(hex: string): string {
  return (COSMETIC_COLOR_NAMES as Record<string, string>)[hex] ?? hex;
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s <= 1e-6) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function lerpRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/**
 * Dusty hide pigment for the vessel mesh / swatches.
 * Catalog hexes stay as unlock ids; this is the leather you actually see.
 */
export function softenHideTint(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return hex;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (l < 0.1) return hex;
  const nextS = s < 0.1 ? s * 0.7 : Math.min(0.32, s * 0.48);
  const nextL =
    s < 0.1
      ? Math.min(0.52, Math.max(0.22, l * 0.78))
      : Math.min(0.42, Math.max(0.18, 0.24 + l * 0.22));
  const out = hslToRgb(h, nextS, nextL);
  return rgbToHex(out.r, out.g, out.b);
}

export function isHideGradient(_id: string): boolean {
  return true;
}

export function resolveHideTint(id: string): {
  a: string;
  b: string;
  grade: HideGradeKind;
} {
  const spec = COSMETIC_HIDE_GRADES[id as (typeof COSMETIC_COLORS)[number]];
  const a = softenHideTint(spec?.a ?? id);
  const b = softenHideTint(spec?.b ?? id);
  return { a, b, grade: spec?.grade ?? "vertical" };
}

/** CSS for Appearance / shop swatches (flat or two-tone). */
export function hideTintSwatchStyle(id: string): {
  backgroundColor: string;
  backgroundImage?: string;
} {
  const tint = resolveHideTint(id);
  if (tint.grade === "solid") return { backgroundColor: tint.a };
  const dir = tint.grade === "belly" ? "165deg" : "180deg";
  return {
    backgroundColor: tint.a,
    backgroundImage: `linear-gradient(${dir}, ${tint.a} 12%, ${tint.b} 88%)`,
  };
}

/** Ink owns the hue; aura signature is a small temperature stain so ember ≠ frost. */
export const AURA_INK_WEIGHT = 0.86;

/** Catalog ink hexes stay as unlock ids; this is the saturated color you see. */
export function punchAuraInk(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return hex;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (s < 0.05 && l > 0.72) return hex;
  const nextS = s < 0.08 ? s : Math.min(1, s * 1.95 + 0.14);
  const nextL = Math.min(0.52, Math.max(0.2, l * 0.95 + 0.04));
  const out = hslToRgb(h, nextS, nextL);
  return rgbToHex(out.r, out.g, out.b);
}

export function mixAuraColor(signatureHex: string, inkHex: string): string {
  const sig = parseHexRgb(signatureHex);
  const ink = parseHexRgb(punchAuraInk(inkHex));
  if (!sig || !ink) return punchAuraInk(inkHex || signatureHex);
  const mixed = lerpRgb(sig, ink, AURA_INK_WEIGHT);
  return punchAuraInk(rgbToHex(mixed.r, mixed.g, mixed.b));
}

/** Ink colors for vessel auras (independent of hide tint). */
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

/** Display names for aura ink (keyed by hex). */
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

export const cosmeticAuraColorName = cosmeticPatternColorName;

export const DEFAULT_COSMETIC_PATTERN_COLOR = COSMETIC_PATTERN_COLORS[0];

/**
 * Vessel aura — runtime glow / motes. Persisted in the `pattern` profile
 * column (same slot the old hide patterns used).
 */
export type CosmeticAuraId = "plain" | "ember" | "frost" | "venom" | "void" | "gold";

/** @deprecated Use CosmeticAuraId — kept so persisted `pattern` rows type-check. */
export type CosmeticPatternId = CosmeticAuraId;

export interface CosmeticAuraDef {
  id: CosmeticAuraId;
  name: string;
  description: string;
}

/** Quiet signature stain — motion/shape is the type; ink is the color. */
export const COSMETIC_AURA_TINTS: Record<CosmeticAuraId, string> = {
  plain: "#ffffff",
  ember: "#e07838",
  frost: "#5eb8e0",
  venom: "#8fc43a",
  void: "#a06ae8",
  gold: "#e8b43c",
};

export const COSMETIC_AURAS: readonly CosmeticAuraDef[] = [
  { id: "plain", name: "Bound", description: "Vessel only — joints, no aura." },
  { id: "ember", name: "Ember", description: "Glowing eyes. Sparks rise from the hands and feet. Ink is the color." },
  { id: "frost", name: "Frost", description: "Glowing eyes. Flakes fall and drift. Ink is the color." },
  { id: "venom", name: "Venom", description: "Glowing eyes. A slow helix at the limbs. Ink is the color." },
  { id: "void", name: "Void", description: "Glowing eyes. Motes collapse inward. Ink is the color." },
  { id: "gold", name: "Gold", description: "Glowing eyes. Glints burst and hang. Ink is the color." },
] as const;

/** @deprecated Use COSMETIC_AURAS. */
export const COSMETIC_PATTERNS: readonly CosmeticAuraDef[] = COSMETIC_AURAS;

export const DEFAULT_COSMETIC_AURA: CosmeticAuraId = "plain";
export const DEFAULT_COSMETIC_PATTERN: CosmeticAuraId = DEFAULT_COSMETIC_AURA;

/** Old hide-pattern ids → vessel auras (account unlocks / equipped rows). */
const LEGACY_PATTERN_TO_AURA: Record<string, CosmeticAuraId> = {
  plain: "plain",
  scales: "ember",
  stripes: "frost",
  spots: "gold",
  plates: "void",
  mottle: "venom",
  serpent: "void",
};

export function isCosmeticAuraId(value: unknown): value is CosmeticAuraId {
  return typeof value === "string" && COSMETIC_AURAS.some((a) => a.id === value);
}

export function isCosmeticPatternId(value: unknown): value is CosmeticAuraId {
  return isCosmeticAuraId(value) || (typeof value === "string" && value in LEGACY_PATTERN_TO_AURA);
}

export function normalizeCosmeticAura(value: unknown): CosmeticAuraId {
  if (typeof value !== "string") return DEFAULT_COSMETIC_AURA;
  if (isCosmeticAuraId(value)) return value;
  return LEGACY_PATTERN_TO_AURA[value] ?? DEFAULT_COSMETIC_AURA;
}

export function normalizeCosmeticPattern(value: unknown): CosmeticAuraId {
  return normalizeCosmeticAura(value);
}

export function getCosmeticAura(id: string | null | undefined): CosmeticAuraDef | undefined {
  const aura = normalizeCosmeticAura(id);
  return COSMETIC_AURAS.find((a) => a.id === aura);
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
