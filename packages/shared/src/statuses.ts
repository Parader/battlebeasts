/**
 * Status effects — buffs / debuffs foundation.
 * Applied by abilities (on-hit / on-self); ticked server-side; synced for HUD/VFX.
 */

import { combatMag } from "./combatMagnitude";

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
  | "hot" // periodic heal (rejuvenation…)
  | "shield" // absorb (stub for later)
  | "resist" // damageTakenMul while active (<1 resist, >1 vulnerability)
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
  /** Healing restored each tick (HoT). */
  healPerTick?: number;
  /**
   * Movement multiplier while active (multiplicative across statuses).
   * Stun/root force 0 regardless.
   * Ignored when `slowPercentPerStack` is set (stack-scaled slow instead).
   */
  moveMul?: number;
  /**
   * When set, slow = `stacks * slowPercentPerStack` (capped by maxStacks).
   * Used by frostChill instead of a flat `moveMul`.
   */
  slowPercentPerStack?: number;
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
  /**
   * Cast anticipation duration multiplier (multiplicative across statuses).
   * 0.75 = 25% shorter windup (Tailwind).
   */
  anticipationMul?: number;
  /** While active, player.invulnerable syncs true (full block + debuff immunity). */
  grantsInvulnerable?: boolean;
  blocksMove?: boolean;
  blocksCast?: boolean;
  maxStacks?: number;
  stackRule?: StatusStackRule;
  /**
   * When true, each caster keeps an independent row (`statusId@sourceId` map key).
   * Used so two Soul Mark users cannot share or consume each other's stacks.
   */
  stackPerSource?: boolean;
  /** HUD / VFX tint. */
  color: string;
  /** Short label for icon placeholder. */
  tag: string;
  /**
   * Never expires from the status tick; cleared only by explicit remove.
   * Used for talent trackers (e.g. Fifth Cadence stacks above the spellbar).
   */
  permanent?: boolean;
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
  /** Chain Jump hook — same root mechanic, distinct ground chain VFX. */
  chained: {
    id: "chained",
    name: "Chained",
    polarity: "debuff",
    mechanic: "root",
    durationMs: 500,
    blocksMove: true,
    blocksCast: false,
    moveMul: 0,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a1a1aa",
    tag: "CHN",
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
    color: "#a78bfa",
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
  /**
   * Poison Cloud aura — 20% slow while standing in the cloud (refreshed each tick).
   * Separate from generic `slowed` (45%) so the cloud stays readable/light.
   */
  poisonMiasma: {
    id: "poisonMiasma",
    name: "Miasma",
    polarity: "debuff",
    mechanic: "slow",
    /** Slightly longer than cloud tick so slow doesn't flicker between pulses. */
    durationMs: 1800,
    moveMul: 0.8,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#84cc16",
    tag: "MIA",
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
  /**
   * Slipstream lane — +30% move while physically inside the wind corridor.
   * Refreshed every tick; stripped immediately on exit.
   */
  slipstreamHaste: {
    id: "slipstreamHaste",
    name: "Slipstream",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.5,
    anticipationMul: 0.75,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#e8eef5",
    tag: "SPD",
  },
  /**
   * Soul Relay — linked target indicator. Duration/VFX only; relay logic is server-side.
   */
  soulRelayLinked: {
    id: "soulRelayLinked",
    name: "Soul Relay",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3500,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#86efac",
    tag: "+",
  },
  /**
   * Astral Chain burden — caster slow while maintaining the tether.
   * Duration is driven by CombatSystem (refreshed / cleared with tether state).
   */
  astralChainBurden: {
    id: "astralChainBurden",
    name: "Astral Burden",
    polarity: "debuff",
    mechanic: "slow",
    durationMs: 3000,
    moveMul: 0.75,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#6954D8",
    tag: "ACB",
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
  /** Spirit Form — +35% move while unbound from husk. */
  spiritFormed: {
    id: "spiritFormed",
    name: "Spirit Form",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3500,
    moveMul: 1.35,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a5b4fc",
    tag: "SPF",
  },
  /** Verdant Leap arrival haste — +20% move. */
  verdantHaste: {
    id: "verdantHaste",
    name: "Verdant Rush",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 1800,
    moveMul: 1.2,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#A9D978",
    tag: "VRD",
  },
  /** Predator Step haste — short +60% move burst. */
  predatorHaste: {
    id: "predatorHaste",
    name: "Predator Rush",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 700,
    moveMul: 1.6,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#EF4444",
    tag: "PRD",
  },
  /**
   * Bulwark Charge — active while charging. Blocks displacement; hard CC durations cut;
   * blocks incoming damage from the forward 180°.
   */
  bulwarkCharging: {
    id: "bulwarkCharging",
    name: "Bulwark Charge",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 400,
    /**
     * Frontal damage block is applied in CombatSystem (forward 180° only) —
     * not via a flat damageTakenMul.
     */
    maxStacks: 1,
    stackRule: "refresh",
    color: "#94a3b8",
    tag: "BWC",
  },
  /** Bulwark Charge completion absorb. `stacks` = remaining shield HP. */
  bulwarkShield: {
    id: "bulwarkShield",
    name: "Bulwark",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 2200,
    maxStacks: combatMag(12),
    stackRule: "refresh",
    color: "#60a5fa",
    tag: "BWS",
  },
  /** Decoy / Predator cloak — invisible to enemies, ghost to self; still takes hits. */
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
  /**
   * Smoke Bomb weaken — take 20% more damage. Refreshed while standing in the cloud.
   */
  weakened: {
    id: "weakened",
    name: "Weakened",
    polarity: "debuff",
    mechanic: "resist",
    durationMs: 3500,
    maxStacks: 1,
    stackRule: "refresh",
    /** +20% incoming damage. */
    damageTakenMul: 1.2,
    color: "#94a3b8",
    tag: "WKN",
  },
  burning: {
    id: "burning",
    name: "Burning",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 3000,
    tickMs: 500,
    damagePerTick: combatMag(4),
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fb923c",
    tag: "BRN",
  },
  /**
   * Shared poison DoT — every poison spell applies this (like burning / bleeding).
   * combatMag(2) dmg × 7 ticks over 5s per stack; stacks up to 3×.
   */
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 5000,
    tickMs: 700,
    damagePerTick: combatMag(2),
    maxStacks: 3,
    stackRule: "stack",
    color: "#3f6212",
    tag: "PSN",
  },
  /**
   * Soul Mark stacks — visual / rupture tracker only (no tick damage).
   * Per-caster rows (`stackPerSource`); at max stacks the next Soul Mark hit ruptures.
   */
  soulMarked: {
    id: "soulMarked",
    name: "Soul Mark",
    polarity: "debuff",
    mechanic: "resist",
    durationMs: 4000,
    maxStacks: 3,
    stackRule: "stack",
    stackPerSource: true,
    color: "#a78bfa",
    tag: "SMK",
  },
  /**
   * Soul Sever — positional debt indicator. Snap damage is resolved by CombatSystem.
   * Per-caster rows so independent severs can coexist on one target.
   */
  soulSevered: {
    id: "soulSevered",
    name: "Soul Severed",
    polarity: "debuff",
    mechanic: "resist",
    durationMs: 2200,
    maxStacks: 1,
    stackRule: "refresh",
    stackPerSource: true,
    color: "#EF4444",
    tag: "SVR",
  },
  /**
   * Ally shroom burst — HoT. combatMag(2) heal/tick × stacks (max 3); longer, slower ticks.
   */
  rejuvenated: {
    id: "rejuvenated",
    name: "Rejuvenation",
    polarity: "buff",
    mechanic: "hot",
    durationMs: 8000,
    tickMs: 1000,
    healPerTick: combatMag(2),
    maxStacks: 3,
    stackRule: "stack",
    color: "#86efac",
    tag: "REJ",
  },
  bleeding: {
    id: "bleeding",
    name: "Bleeding",
    polarity: "debuff",
    mechanic: "dot",
    durationMs: 3500,
    tickMs: 600,
    damagePerTick: combatMag(5),
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
    slowPercentPerStack: 10,
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
   * Lonely heal ticks grant combatMag(4) stacks and refresh duration to 8s.
   */
  grooveShield: {
    id: "grooveShield",
    name: "Groove Shield",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 8000,
    maxStacks: combatMag(24),
    stackRule: "stack",
    color: "#a7f3d0",
    tag: "SHD",
  },
  /**
   * Hand Shield — frontal projectile block channel. VFX + collider sync flag.
   * Cleared on cancel / cast end (not an absorb shield).
   * Default duration matches channel+recovery; server always passes HAND_SHIELD_ARMED_MS.
   */
  handShielding: {
    id: "handShielding",
    name: "Hand Shield",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 3950,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#60a5fa",
    tag: "HSH",
  },
  /**
   * Protective Instinct — talent ally DR. `stacks` = reduction percent (2 / 4 / 6).
   * Applied via combineStatusDamageTakenMul (not a fixed damageTakenMul).
   */
  protectiveInstinct: {
    id: "protectiveInstinct",
    name: "Protective Instinct",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 3000,
    maxStacks: 6,
    stackRule: "refresh",
    color: "#a8a29e",
    tag: "PI",
  },
  /**
   * Overflow — overheal → absorb. `stacks` = remaining shield HP.
   * Server clamps total to talent cap % of target max HP; duration refreshed on grant.
   */
  overflowShield: {
    id: "overflowShield",
    name: "Overflow",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 5000,
    maxStacks: combatMag(120),
    stackRule: "refresh",
    color: "#fde68a",
    tag: "OVF",
  },
  /**
   * Fifth Cadence — permanent while the talent is owned.
   * `stacks` = damaging spells cast toward the next +15% (0–4); the 5th arms the bonus.
   */
  fifthSpellCadence: {
    id: "fifthSpellCadence",
    name: "Fifth Cadence",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 0,
    permanent: true,
    maxStacks: 5,
    stackRule: "refresh",
    color: "#f97316",
    tag: "5th",
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
    maxStacks: combatMag(30),
    stackRule: "refresh",
    color: "#60a5fa",
    tag: "BAR",
  },
  /**
   * Protection Bubble absorb ticks. `stacks` = remaining shield HP.
   * Cap is enforced per-bubble on the server (shieldCap).
   */
  bubbleShield: {
    id: "bubbleShield",
    name: "Bubble Shield",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 8000,
    maxStacks: combatMag(30),
    stackRule: "refresh",
    color: "#93c5fd",
    tag: "BSH",
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
  /**
   * Revenge — rooted stance window (red). Next counterable hit is denied → blink behind attacker.
   * Cleared on successful revenge or player cancel. No riposte buffs yet.
   */
  revengeArmed: {
    id: "revengeArmed",
    name: "Revenge",
    polarity: "buff",
    mechanic: "root",
    durationMs: 1200,
    blocksMove: true,
    moveMul: 0,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#ef4444",
    tag: "REV",
  },
  /**
   * Revenge blink — fully invisible + invulnerable until reappear.
   * Position already snapped; this is only the vanish window.
   */
  revengePhased: {
    id: "revengePhased",
    name: "Revenge",
    polarity: "buff",
    mechanic: "stealth",
    /** Overridden by REVENGE_CAST.vanishMs on apply. */
    durationMs: 500,
    grantsInvulnerable: true,
    /** No casts / melee while invisible after Revenge blink. */
    blocksCast: true,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#ef4444",
    tag: "PHS",
  },
  /** After a successful Counter — move speed burst (longer than empower). */
  counterHaste: {
    id: "counterHaste",
    name: "Counter Rush",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 4500,
    moveMul: 1.45,
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
  /**
   * Holy Ground — +60% resistance and +30% damage while standing in the circle.
   * Duration is refreshed by the live zone each combat tick.
   */
  holyBlessed: {
    id: "holyBlessed",
    name: "Holy Blessing",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 500,
    damageTakenMul: 0.4,
    damageDealtMul: 1.3,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fbbf24",
    tag: "HLY",
  },
};

/** Max frost chill stacks (10% each → 100%). */
export const FROST_CHILL_MAX_STACKS = 10;

/** Slow percent from a stack-scaled slow status (`slowPercentPerStack`). */
export function statusStackSlowPercent(def: StatusDef, stacks: number): number {
  const per = def.slowPercentPerStack;
  if (per == null || per <= 0) return 0;
  const max = def.maxStacks ?? 1;
  const s = Math.max(0, Math.min(max, Math.floor(stacks)));
  return s * per;
}

/** Slow percent from frostChill alone (stack 1 = 10%, … 10 = 100%). */
export function frostChillSlowPercent(stacks: number): number {
  return statusStackSlowPercent(STATUSES.frostChill!, stacks);
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

/** Map key for a status row — per-source statuses use `id@sourceId`. */
export function statusMapKey(statusId: string, sourceId?: string | null): string {
  const def = STATUSES[statusId];
  if (def?.stackPerSource && sourceId) return `${statusId}@${sourceId}`;
  return statusId;
}

/** DoTs / slows amplified by Intensified Elements (and gated as "elemental"). */
export function isElementalSecondaryStatus(def: StatusDef | undefined): boolean {
  if (!def || def.polarity !== "debuff") return false;
  if (def.mechanic === "dot" || def.mechanic === "slow") return true;
  if (typeof def.moveMul === "number" && def.moveMul < 1) return true;
  return (
    def.id === "burning" ||
    def.id === "poisoned" ||
    def.id === "bleeding" ||
    def.id === "frostChill"
  );
}

/** Stun / root / silence — Opportunist hard CC (not slows or soft debuffs). */
export function isHardCrowdControlStatus(def: StatusDef | undefined): boolean {
  if (!def) return false;
  return (
    def.mechanic === "stun" || def.mechanic === "root" || def.mechanic === "silence"
  );
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
    if (def.slowPercentPerStack != null) {
      pct += statusStackSlowPercent(def, stacks);
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
    if (def.slowPercentPerStack != null) {
      slowPct += statusStackSlowPercent(def, stacks);
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
  for (const { def, stacks } of entries) {
    if (def.id === "protectiveInstinct") {
      const pct = Math.max(0, Math.min(100, stacks));
      mul *= Math.max(0, 1 - pct / 100);
      continue;
    }
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

/** Cast anticipation duration factor (multiplicative; 1 = normal windup). */
export function combineStatusAnticipationMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let mul = 1;
  for (const { def } of entries) {
    if (typeof def.anticipationMul === "number" && def.anticipationMul > 0) {
      mul *= def.anticipationMul;
    }
  }
  return Math.max(0.05, mul);
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
