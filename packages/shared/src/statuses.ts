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
  | "shield" // absorb (stub for later)
  | "resist" // damageTakenMul < 1 while active
  | "empower"; // damageDealtMul > 1 while active

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
  /**
   * Incoming damage multiplier while active (multiplicative across statuses).
   * 0.6 = 40% resistance.
   */
  damageTakenMul?: number;
  /**
   * Outgoing damage multiplier while active (multiplicative across statuses).
   * 1.2 = +20% damage dealt.
   */
  damageDealtMul?: number;
  /** While active, player.invulnerable syncs true (full block + debuff immunity). */
  grantsInvulnerable?: boolean;
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
    color: "#7dd3fc",
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
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fb923c",
    tag: "BRN",
  },
  /**
   * Shared poison DoT — every poison spell applies this (like burning / bleeding).
   * 2 dmg × 7 ticks over 5s per stack; stacks up to 3×.
   */
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 5000,
    tickMs: 700,
    damagePerTick: 2,
    maxStacks: 3,
    stackRule: "stack",
    color: "#3f6212",
    tag: "PSN",
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
  /**
   * Frost Mist chill — each stack = +10% slow (additive with other slows).
   * Mist ticks set stacks so total slow grows by 10% (20% if not already slowed).
   * At 100% total slow the ability also applies `rooted`.
   */
  frostChill: {
    id: "frostChill",
    name: "Chilled",
    polarity: "debuff",
    mechanic: "slow",
    durationMs: 2200,
    /** Placeholder; real mul comes from stack via frostChillMoveMul. */
    moveMul: 0.9,
    maxStacks: 10,
    stackRule: "stack",
    color: "#bae6fd",
    tag: "CHL",
  },
  /** Groove channel — 40% damage resistance while dancing. */
  grooveGuard: {
    id: "grooveGuard",
    name: "Groove",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 7000,
    damageTakenMul: 0.6,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#6ee7b7",
    tag: "GRV",
  },
  /**
   * Groove solo pulse — absorb shield. `stacks` = remaining shield HP.
   * Lonely heal ticks grant +4 stacks and refresh duration to 8s.
   */
  grooveShield: {
    id: "grooveShield",
    name: "Groove Shield",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 8000,
    maxStacks: 48,
    stackRule: "stack",
    color: "#a7f3d0",
    tag: "SHD",
  },
  /**
   * Barrier — self absorb bubble. `stacks` = remaining shield HP.
   */
  barrier: {
    id: "barrier",
    name: "Barrier",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 3000,
    maxStacks: 40,
    stackRule: "refresh",
    color: "#60a5fa",
    tag: "BAR",
  },
  /**
   * Counter — rooted stance window. Next counterable hit is denied and converts into riposte buffs.
   * Cleared on successful counter or player cancel.
   */
  counterArmed: {
    id: "counterArmed",
    name: "Counter",
    polarity: "buff",
    mechanic: "root",
    durationMs: 1200,
    blocksMove: true,
    moveMul: 0,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f5c542",
    tag: "CTR",
  },
  /** After a successful Counter — move speed burst (matches empower duration). */
  counterHaste: {
    id: "counterHaste",
    name: "Counter Rush",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.2,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fbbf24",
    tag: "SPD",
  },
  /** After a successful Counter — +20% damage dealt and 40% damage resistance for 3s. */
  counterEmpowered: {
    id: "counterEmpowered",
    name: "Empowered",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 3000,
    damageDealtMul: 1.2,
    damageTakenMul: 0.6,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f59e0b",
    tag: "DMG",
  },
};

/** Max frost chill stacks (10% each → 100%). */
export const FROST_CHILL_MAX_STACKS = 10;

/** Slow percent from frostChill alone (stack 1 = 10%, … 10 = 100%). */
export function frostChillSlowPercent(stacks: number): number {
  const s = Math.max(0, Math.min(FROST_CHILL_MAX_STACKS, Math.floor(stacks)));
  return s * 10;
}

export function frostChillMoveMul(stacks: number): number {
  return Math.max(0, 1 - frostChillSlowPercent(stacks) / 100);
}

/**
 * Next frost stacks so mist adds 10% to current total slow (20% if unsowed).
 * `baseSlowPct` is slow from statuses other than frostChill.
 */
export function nextFrostChillStacks(
  baseSlowPct: number,
  currentFrostStacks: number,
): { stacks: number; totalSlowPct: number } {
  const base = Math.max(0, Math.min(100, baseSlowPct));
  const currentTotal = Math.min(100, base + frostChillSlowPercent(currentFrostStacks));
  const nextTotal = currentTotal <= 0 ? 20 : Math.min(100, currentTotal + 10);
  const needFrost = Math.max(0, nextTotal - base);
  const stacks = Math.max(0, Math.min(FROST_CHILL_MAX_STACKS, Math.round(needFrost / 10)));
  return {
    stacks,
    totalSlowPct: Math.min(100, base + frostChillSlowPercent(stacks)),
  };
}

export function getStatus(id: string): StatusDef | undefined {
  return STATUSES[id];
}

/** Remaining absorb HP from shield statuses (`stacks` = absorb points). */
export function totalShieldAbsorb(
  rows: { statusId?: string; stacks?: number }[] | null | undefined,
): number {
  if (!rows?.length) return 0;
  let sum = 0;
  for (const row of rows) {
    const id = row.statusId;
    if (!id) continue;
    const def = STATUSES[id];
    if (def?.mechanic === "shield") sum += Math.max(0, row.stacks ?? 0);
  }
  return sum;
}

/** Additive slow percent from active statuses (roots/stuns → 100). */
export function combineStatusSlowPercent(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let pct = 0;
  for (const { def, stacks } of entries) {
    if (def.blocksMove || def.mechanic === "stun" || def.mechanic === "root") {
      return 100;
    }
    if (def.id === "frostChill") {
      pct += frostChillSlowPercent(stacks);
      continue;
    }
    if (typeof def.moveMul === "number" && def.moveMul < 1) {
      pct += (1 - def.moveMul) * 100;
    }
  }
  return Math.min(100, Math.max(0, pct));
}

/** Move factor from statuses — slows add as percents; hastes multiply. */
export function combineStatusMoveMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let haste = 1;
  let slowPct = 0;
  for (const { def, stacks } of entries) {
    if (def.blocksMove || def.mechanic === "stun" || def.mechanic === "root") {
      return 0;
    }
    if (def.id === "frostChill") {
      slowPct += frostChillSlowPercent(stacks);
      continue;
    }
    if (typeof def.moveMul === "number") {
      if (def.moveMul < 1) slowPct += (1 - def.moveMul) * 100;
      else if (def.moveMul > 1) haste *= def.moveMul;
    }
  }
  return Math.max(0, (1 - Math.min(100, slowPct) / 100) * haste);
}

/** Incoming damage factor from statuses (multiplicative; 1 = full damage). */
export function combineStatusDamageTakenMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let mul = 1;
  for (const { def } of entries) {
    if (typeof def.damageTakenMul === "number" && def.damageTakenMul >= 0) {
      mul *= def.damageTakenMul;
    }
  }
  return Math.max(0, mul);
}

/** Outgoing damage factor from statuses (multiplicative; 1 = full damage). */
export function combineStatusDamageDealtMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let mul = 1;
  for (const { def } of entries) {
    if (typeof def.damageDealtMul === "number" && def.damageDealtMul > 0) {
      mul *= def.damageDealtMul;
    }
  }
  return Math.max(0, mul);
}

/** True when any active status grants full invulnerability. */
export function statusesGrantInvulnerable(entries: { def: StatusDef }[]): boolean {
  return entries.some((e) => e.def.grantsInvulnerable);
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
