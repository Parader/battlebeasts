import type { StatusApplication } from "./statuses";

export type AbilityShape = "projectile" | "aoe" | "dash" | "melee" | "buff";

/**
 * Spell lifecycle — mirrors combat animation beats:
 * Anticipation → Cast → Impact pose → Recovery
 */
export type CastPhaseId = "anticipation" | "cast" | "impact" | "recovery";

/**
 * Per-spell timing + movement modifiers.
 * - anticipation: wind-up (arm back, torso twist); cancelable (default). No effect yet.
 * - cast: committed forward acceleration toward release. No effect yet.
 * - impact: effect resolves at phase start (projectile / hit / travel). Hold silhouette.
 * - recovery: return to combat stance / idle.
 */
export interface AbilityTiming {
  anticipationMs: number;
  castMs: number;
  impactMs: number;
  recoveryMs: number;
  /** Movement speed multiplier during anticipation (1 = normal). */
  anticipationMoveMul?: number;
  /** Movement speed multiplier during cast. */
  castMoveMul?: number;
  /** Movement speed multiplier during impact pose. */
  impactMoveMul?: number;
  /** Movement speed multiplier during recovery. */
  recoveryMoveMul?: number;
  /** Cancel allowed only in anticipation (default true). */
  canCancelAnticipation?: boolean;
  /** Block starting other abilities until recovery ends (default true). */
  blocksOtherCasts?: boolean;
}

/**
 * Displacement applied when the cast effect fires.
 * - none: no forced move
 * - instant: teleport (blink)
 * - translate: lerp over durationMs (default for dash)
 */
export type TravelMode = "none" | "instant" | "translate";

export interface AbilityTravel {
  mode: TravelMode;
  /** World units; defaults to ability.range. */
  distance?: number;
  /**
   * Translate duration in ms (ignored for instant).
   * Defaults to timing.impactMs (travel runs with the impact pose).
   */
  durationMs?: number;
}

/**
 * Invulnerability window relative to cast start (anticipation begin,
 * or first non-zero phase if anticipation is skipped).
 * Example: { startMs: 40, durationMs: 160 } → iframes from t=40ms for 160ms.
 */
export interface AbilityIFrames {
  startMs: number;
  durationMs: number;
}

export interface AbilityDef {
  id: string;
  name: string;
  cooldownMs: number;
  range: number;
  shape: AbilityShape;
  damage: number;
  radius?: number;
  speed?: number;
  timing: AbilityTiming;
  /** Projectile spawn distance in front of caster (world units). */
  spawnOffset?: number;
  /** Forced displacement (dash / charge). */
  travel?: AbilityTravel;
  /** Optional invulnerability frames during the cast. */
  iFrames?: AbilityIFrames;
  /** Statuses applied to hit targets when the effect resolves. */
  applyOnHit?: StatusApplication[];
  /** Statuses applied to caster when the effect resolves. */
  applyOnSelf?: StatusApplication[];
  /**
   * If true, this ability can cut another cast at any phase (e.g. Space/dash).
   * Already-fired projectiles/DoTs keep living; only caster cast phases are cleared.
   */
  interruptsOtherCasts?: boolean;
  /**
   * If false, interruptors cannot cut this cast (default true = interruptible).
   */
  interruptible?: boolean;
  /** Preferred Battlerite-style slot when suggesting a default kit. */
  defaultSlot?: SpellSlotId;
}

/**
 * Battlerite-style hotbar (v0).
 * Shift+cast / EX variants come later — not wired yet.
 */
export const SPELL_SLOTS = [
  { id: "m1", label: "LMB", hint: "Left click", input: "mouse0" },
  { id: "m2", label: "RMB", hint: "Right click", input: "mouse2" },
  { id: "space", label: "Space", hint: "Movement", input: "space" },
  { id: "q", label: "Q", hint: "Q", input: "q" },
  { id: "e", label: "E", hint: "E", input: "e" },
  { id: "r", label: "R", hint: "R", input: "r" },
] as const;

export type SpellSlotId = (typeof SPELL_SLOTS)[number]["id"];
export type SpellSlot = (typeof SPELL_SLOTS)[number];

export const LOADOUT_SIZE = SPELL_SLOTS.length;

const DEFAULT_MOVE = {
  anticipation: 0.75,
  cast: 0.45,
  impact: 0.25,
  recovery: 0.85,
} as const;

/** Minimal v0 kit — one ability per Battlerite slot. */
export const ABILITIES: Record<string, AbilityDef> = {
  bolt: {
    id: "bolt",
    name: "Bolt",
    cooldownMs: 900,
    range: 12,
    shape: "projectile",
    damage: 18,
    speed: 22,
    spawnOffset: 0.32,
    defaultSlot: "m1",
    // ~1.0s window → clip 2.3s plays ~2.3× (snappy, not 8×)
    timing: {
      anticipationMs: 280,
      castMs: 220,
      impactMs: 200,
      recoveryMs: 300,
      anticipationMoveMul: 0.9,
      castMoveMul: 0.65,
      impactMoveMul: 0.55,
      recoveryMoveMul: 1,
      canCancelAnticipation: true,
    },
  },
  smash: {
    id: "smash",
    name: "Smash",
    cooldownMs: 2400,
    range: 2.5,
    shape: "melee",
    damage: 32,
    radius: 2.2,
    defaultSlot: "m2",
    // ~1.0s → melee clip ~2.3×
    timing: {
      anticipationMs: 280,
      castMs: 200,
      impactMs: 200,
      recoveryMs: 320,
      anticipationMoveMul: 0.45,
      castMoveMul: 0.2,
      impactMoveMul: 0.1,
      recoveryMoveMul: 0.7,
      canCancelAnticipation: true,
    },
    applyOnHit: [{ statusId: "stunned", durationMs: 600, chance: 0.85 }],
  },
  dash: {
    id: "dash",
    name: "Dash",
    cooldownMs: 4000,
    range: 5,
    shape: "dash",
    damage: 0,
    speed: 18,
    defaultSlot: "space",
    // ~0.55s → Jump ~1.8×; travel spans impact
    timing: {
      anticipationMs: 60,
      castMs: 60,
      impactMs: 280,
      recoveryMs: 150,
      anticipationMoveMul: 0.5,
      castMoveMul: 0.15,
      impactMoveMul: 0,
      recoveryMoveMul: 0.75,
      canCancelAnticipation: true,
    },
    travel: {
      mode: "translate",
      durationMs: 280,
    },
    iFrames: {
      startMs: 80,
      durationMs: 320,
    },
    applyOnSelf: [{ statusId: "hasted", durationMs: 900 }],
    interruptsOtherCasts: true,
  },
  nova: {
    id: "nova",
    name: "Nova",
    cooldownMs: 6000,
    range: 0,
    shape: "aoe",
    damage: 24,
    radius: 3.5,
    defaultSlot: "q",
    // ~1.4s → AoE clip ~2.3×
    timing: {
      anticipationMs: 400,
      castMs: 300,
      impactMs: 300,
      recoveryMs: 400,
      anticipationMoveMul: 0.25,
      castMoveMul: 0.1,
      impactMoveMul: 0,
      recoveryMoveMul: 0.55,
      canCancelAnticipation: true,
    },
    applyOnHit: [{ statusId: "burning", stacks: 1 }],
  },
  shock: {
    id: "shock",
    name: "Shock",
    cooldownMs: 5000,
    range: 8,
    shape: "projectile",
    damage: 22,
    speed: 28,
    radius: 1.6,
    spawnOffset: 0.34,
    defaultSlot: "e",
    // ~1.05s → 1H clip ~2.2×
    timing: {
      anticipationMs: 300,
      castMs: 220,
      impactMs: 220,
      recoveryMs: 310,
      anticipationMoveMul: 0.7,
      castMoveMul: 0.45,
      impactMoveMul: 0.35,
      recoveryMoveMul: 0.9,
      canCancelAnticipation: true,
    },
    applyOnHit: [{ statusId: "slowed", durationMs: 1800 }],
  },
  rupture: {
    id: "rupture",
    name: "Rupture",
    cooldownMs: 10000,
    range: 10,
    shape: "aoe",
    damage: 40,
    radius: 2.8,
    defaultSlot: "r",
    // ~1.5s → AoE clip ~2.2×
    timing: {
      anticipationMs: 450,
      castMs: 300,
      impactMs: 350,
      recoveryMs: 400,
      anticipationMoveMul: 0.2,
      castMoveMul: 0.05,
      impactMoveMul: 0,
      recoveryMoveMul: 0.5,
      canCancelAnticipation: true,
    },
    applyOnHit: [
      { statusId: "bleeding", stacks: 1 },
      { statusId: "poisoned", stacks: 1, chance: 0.5 },
    ],
  },
};

/** Ordered by SPELL_SLOTS: LMB, RMB, Space, Q, E, R */
export const DEFAULT_LOADOUT: readonly string[] = SPELL_SLOTS.map((slot) => {
  const found = Object.values(ABILITIES).find((a) => a.defaultSlot === slot.id);
  return found?.id ?? "bolt";
});

export function normalizeLoadout(abilityIds: string[] | null | undefined): string[] {
  const cleaned = (abilityIds ?? []).filter((id) => id in ABILITIES);
  const out = [...cleaned];
  for (const id of DEFAULT_LOADOUT) {
    if (out.length >= LOADOUT_SIZE) break;
    if (!out.includes(id)) out.push(id);
  }
  while (out.length < LOADOUT_SIZE) out.push(DEFAULT_LOADOUT[out.length] ?? "bolt");
  return out.slice(0, LOADOUT_SIZE);
}

export function abilityAtSlot(loadout: string[], slotIndex: number): AbilityDef | undefined {
  const id = loadout[slotIndex];
  return id ? ABILITIES[id] : undefined;
}

export function slotIndexForInput(input: SpellSlot["input"]): number {
  return SPELL_SLOTS.findIndex((s) => s.input === input);
}

export function moveMulForPhase(def: AbilityDef, phase: CastPhaseId): number {
  const t = def.timing;
  if (phase === "anticipation") return t.anticipationMoveMul ?? DEFAULT_MOVE.anticipation;
  if (phase === "cast") return t.castMoveMul ?? DEFAULT_MOVE.cast;
  if (phase === "impact") return t.impactMoveMul ?? DEFAULT_MOVE.impact;
  return t.recoveryMoveMul ?? DEFAULT_MOVE.recovery;
}

/** Total lockout from anticipation through end of recovery. */
export function totalCastDurationMs(def: AbilityDef): number {
  const t = def.timing;
  return t.anticipationMs + t.castMs + t.impactMs + t.recoveryMs;
}

/** Phase duration helper (0 means skip). */
export function phaseDurationMs(def: AbilityDef, phase: CastPhaseId): number {
  const t = def.timing;
  if (phase === "anticipation") return Math.max(0, t.anticipationMs);
  if (phase === "cast") return Math.max(0, t.castMs);
  if (phase === "impact") return Math.max(0, t.impactMs);
  return Math.max(0, t.recoveryMs);
}

const PHASE_ORDER: CastPhaseId[] = ["anticipation", "cast", "impact", "recovery"];

/** Next phase with duration > 0, or null if cast should end. */
export function nextCastPhase(def: AbilityDef, current: CastPhaseId | null): CastPhaseId | null {
  const start = current ? PHASE_ORDER.indexOf(current) + 1 : 0;
  for (let i = Math.max(0, start); i < PHASE_ORDER.length; i++) {
    const phase = PHASE_ORDER[i]!;
    if (phaseDurationMs(def, phase) > 0) return phase;
  }
  return null;
}

/** Resolve travel config (dash defaults to translate over impact). */
export function resolveTravel(def: AbilityDef): AbilityTravel {
  if (def.travel) return def.travel;
  if (def.shape === "dash") {
    return { mode: "translate", durationMs: def.timing.impactMs };
  }
  return { mode: "none" };
}

export function travelDistance(def: AbilityDef): number {
  const travel = resolveTravel(def);
  return travel.distance ?? def.range;
}

export function travelDurationMs(def: AbilityDef): number {
  const travel = resolveTravel(def);
  if (travel.mode !== "translate") return 0;
  return Math.max(16, travel.durationMs ?? def.timing.impactMs);
}

/** True if elapsedMs since cast start is inside the i-frame window. */
export function isInIFrameWindow(def: AbilityDef, elapsedSinceCastStartMs: number): boolean {
  const ifr = def.iFrames;
  if (!ifr || ifr.durationMs <= 0) return false;
  const t = elapsedSinceCastStartMs;
  return t >= ifr.startMs && t < ifr.startMs + ifr.durationMs;
}
