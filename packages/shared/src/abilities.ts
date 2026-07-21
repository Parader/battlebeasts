export type AbilityShape = "projectile" | "aoe" | "dash" | "melee";

export interface AbilityDef {
  id: string;
  name: string;
  castTimeMs: number;
  cooldownMs: number;
  range: number;
  shape: AbilityShape;
  damage: number;
  radius?: number;
  speed?: number;
}

/** Minimal v0 kit — breadth over depth. */
export const ABILITIES: Record<string, AbilityDef> = {
  bolt: {
    id: "bolt",
    name: "Bolt",
    castTimeMs: 150,
    cooldownMs: 800,
    range: 12,
    shape: "projectile",
    damage: 18,
    speed: 22,
  },
  smash: {
    id: "smash",
    name: "Smash",
    castTimeMs: 250,
    cooldownMs: 2200,
    range: 2.5,
    shape: "melee",
    damage: 32,
    radius: 2.2,
  },
  dash: {
    id: "dash",
    name: "Dash",
    castTimeMs: 0,
    cooldownMs: 4000,
    range: 5,
    shape: "dash",
    damage: 0,
    speed: 18,
  },
  nova: {
    id: "nova",
    name: "Nova",
    castTimeMs: 400,
    cooldownMs: 6000,
    range: 0,
    shape: "aoe",
    damage: 24,
    radius: 3.5,
  },
};

export const DEFAULT_LOADOUT = ["bolt", "smash", "dash"] as const;
