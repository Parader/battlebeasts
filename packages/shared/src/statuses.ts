/**
 * Status effects — buffs / debuffs foundation.
 * Applied by abilities (on-hit / on-self); ticked server-side; synced for HUD/VFX.
 */

export type StatusPolarity = "buff" | "debuff";

/** Mechanical category — drives rules in the status system. */
export type StatusMechanic =
  | "stun" // no move, no cast
  | "root" // no move, can cast
  | "silence" // can move, no cast
  | "slow" // moveMul < 1
  | "haste" // moveMul > 1
  | "stealth" // invisible to enemies; still takes damage
  | "dot" // periodic damage (fire, poison, bleed…)
  | "shield"; // absorb (stub for later)

export type StatusStackRule = "refresh" | "stack" | "ignore";

export interface StatusDef {
  id: string;
  name: string;
  polarity: StatusPolarity;
  mechanic: StatusMechanic;
  /** Base duration when applied (ms). */
  durationMs: number;
  /** DoT interval (ms). */
  tickMs?: number;
  /** Damage dealt each tick (DoT). */
  damagePerTick?: number;
  /**
   * Movement multiplier while active (multiplicative across statuses).
   * Stun/root force 0 regardless.
   */
  moveMul?: number;
  blocksMove?: boolean;
  blocksCast?: boolean;
  maxStacks?: number;
  stackRule?: StatusStackRule;
  /** HUD / VFX tint. */
  color: string;
  /** Short label for icon placeholder. */
  tag: string;
}

/** How an ability applies a status. */
export interface StatusApplication {
  statusId: string;
  /** Override catalog duration. */
  durationMs?: number;
  stacks?: number;
  /** Chance 0–1 (default 1). */
  chance?: number;
}

export const STATUSES: Record<string, StatusDef> = {
  stunned: {
    id: "stunned",
    name: "Stunned",
    polarity: "debuff",
    mechanic: "stun",
    durationMs: 800,
    blocksMove: true,
    blocksCast: true,
    moveMul: 0,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fbbf24",
    tag: "STN",
  },
  rooted: {
    id: "rooted",
    name: "Rooted",
    polarity: "debuff",
    mechanic: "root",
    durationMs: 1200,
    blocksMove: true,
    blocksCast: false,
    moveMul: 0,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a3e635",
    tag: "ROT",
  },
  silenced: {
    id: "silenced",
    name: "Silenced",
    polarity: "debuff",
    mechanic: "silence",
    durationMs: 1500,
    blocksMove: false,
    blocksCast: true,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#67e8f9",
    tag: "SIL",
  },
  slowed: {
    id: "slowed",
    name: "Slowed",
    polarity: "debuff",
    mechanic: "slow",
    durationMs: 2000,
    moveMul: 0.55,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#93c5fd",
    tag: "SLW",
  },
  hasted: {
    id: "hasted",
    name: "Hasted",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.25,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#86efac",
    tag: "HST",
  },
  /** Electrical augment — +60% move for 3s (Surge). */
  surged: {
    id: "surged",
    name: "Surged",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.6,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#67e8f9",
    tag: "SRG",
  },
  /** Decoy cloak — invisible to enemies, ghost to self; still takes hits. */
  cloaked: {
    id: "cloaked",
    name: "Cloaked",
    polarity: "buff",
    mechanic: "stealth",
    durationMs: 2000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#c4b5fd",
    tag: "CLK",
  },
  burning: {
    id: "burning",
    name: "Burning",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 3000,
    tickMs: 500,
    damagePerTick: 4,
    maxStacks: 3,
    stackRule: "stack",
    color: "#fb923c",
    tag: "BRN",
  },
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 4000,
    tickMs: 750,
    damagePerTick: 3,
    maxStacks: 5,
    stackRule: "stack",
    color: "#c084fc",
    tag: "PSN",
  },
  /**
   * Spikes E venom — 5 dmg × 6 ticks over ~3s (500ms cadence).
   * duration slightly past the 6th tick so the last pulse lands.
   */
  spikeVenom: {
    id: "spikeVenom",
    name: "Venom",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 3200,
    tickMs: 500,
    damagePerTick: 5,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#166534",
    tag: "VEN",
  },
  bleeding: {
    id: "bleeding",
    name: "Bleeding",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 3500,
    tickMs: 600,
    damagePerTick: 5,
    maxStacks: 3,
    stackRule: "stack",
    color: "#f87171",
    tag: "BLD",
  },
};

export function getStatus(id: string): StatusDef | undefined {
  return STATUSES[id];
}

/** Multiplicative move factor from a list of active status defs (+ stacks for DoT visuals only). */
export function combineStatusMoveMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let mul = 1;
  for (const { def } of entries) {
    if (def.blocksMove || def.mechanic === "stun" || def.mechanic === "root") {
      return 0;
    }
    if (typeof def.moveMul === "number") {
      mul *= def.moveMul;
    }
  }
  return mul;
}

export function statusesBlockMove(entries: { def: StatusDef }[]): boolean {
  return entries.some(
    (e) => e.def.blocksMove || e.def.mechanic === "stun" || e.def.mechanic === "root",
  );
}

export function statusesBlockCast(entries: { def: StatusDef }[]): boolean {
  return entries.some(
    (e) => e.def.blocksCast || e.def.mechanic === "stun" || e.def.mechanic === "silence",
  );
}

export function rollStatusChance(chance = 1): boolean {
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  return Math.random() < chance;
}
