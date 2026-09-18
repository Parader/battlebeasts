/**
 * Status effects — buffs / debuffs foundation.
 * Applied by abilities (on-hit / on-self); ticked server-side; synced for HUD/VFX.
 */

import { combatMag } from "./combatMagnitude";
import { FLOW_TEMP_HASTE_CAP, FLOW_TEMP_HASTE_STATUS_IDS } from "./flowTalents";
import { HARMONY_TEMP_CAST_STATUS_IDS, HARMONY_TEMP_HASTE_STATUS_IDS } from "./harmonyTalents";

/** Temporary talent move haste (Flow + Harmony + short Guardian/Control procs). */
const TALENT_TEMP_HASTE_STATUS_IDS = new Set([
  ...FLOW_TEMP_HASTE_STATUS_IDS,
  ...HARMONY_TEMP_HASTE_STATUS_IDS,
  "aegisMomentum",
  "punishingSilence",
]);

/** Short talent damage procs — share the 30% temp bonus cap. Spell identity stays outside. */
const TALENT_TEMP_DAMAGE_STATUS_IDS = new Set([
  "elementalSurge",
  "empoweredRecovery",
  "harmonyResonance",
  "aegisMomentum",
]);

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
  | "empower" // damageDealtMul > 1 while active
  | "buff" // generic buff / proc state
  | "fear"; // flee away, cannot cast

export type StatusStackRule = "refresh" | "stack" | "ignore";

export type StatusId = string;

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
  /**
   * Cast phase duration multiplier for anticipation + cast + impact
   * (multiplicative across statuses). 1/1.12 ≈ 12% faster casts.
   */
  castDurationMul?: number;
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
  /**
   * Persistent aura / continuous area effect. While actively applying inside the area,
   * its timer displays at max/full capacity.
   */
  isAura?: boolean;
  /**
   * When set, overrides polarity defaults for Purge Pulse cleanse/dispel.
   * Permanent statuses are never dispellable regardless.
   */
  isDispellable?: boolean;
  /**
   * Higher = removed first by Purge Pulse (cleanse/dispel).
   * Defaults are derived from mechanic when omitted.
   */
  dispelPriority?: number;
  /**
   * While active, knockbacks / pulls / forced displacement fail
   * (Iron Guard, Bulwark Charge).
   */
  blocksDisplacement?: boolean;
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

/** Shocked mark — no pulse; attacked targets discharge to a nearby enemy. */
export const SHOCKED_STATUS = {
  durationMs: 4000,
  dischargeRadius: 4.5,
  dischargeDamagePerStack: combatMag(4),
  dischargeIcdMs: 500,
} as const;

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
  /** Binding Sigil — same root mechanic, violet sigil read (not frost ice). */
  bindingRooted: {
    id: "bindingRooted",
    name: "Bound",
    polarity: "debuff",
    mechanic: "root",
    durationMs: 1250,
    blocksMove: true,
    blocksCast: false,
    moveMul: 0,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a78bfa",
    tag: "BND",
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
    durationMs: 2000,
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
  /** Electrical augment — +60% move for 4s (Surge). */
  surged: {
    id: "surged",
    name: "Surged",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 4000,
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
     * not via a flat damageTakenMul. Knockback/pull blocked via blocksDisplacement.
     */
    blocksDisplacement: true,
    isDispellable: false,
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
  /**
   * Shocked — short electrical mark (Chain Lightning, Arc Thread, Surge, Wild Infusion).
   * No pulse damage. When the marked target is hit, a small bolt jumps to a nearby enemy.
   * Consumed by Elemental Overload for burst damage.
   */
  shocked: {
    id: "shocked",
    name: "Shocked",
    polarity: "debuff",
    mechanic: "resist",
    durationMs: SHOCKED_STATUS.durationMs,
    maxStacks: 3,
    stackRule: "stack",
    color: "#38bdf8",
    tag: "SHK",
  },
  /**
   * Electrified — self-buff from casting Surge. Next offensive attack consumes this
   * to shock the hit target.
   */
  electrified: {
    id: "electrified",
    name: "Electrified",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 10000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#38bdf8",
    tag: "ELC",
  },
  /** Battle Instinct — self-buff from landing a close-range hit (DES_01). */
  battleInstinct: {
    id: "battleInstinct",
    name: "Battle Instinct",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f59e0b",
    tag: "BST",
  },
  /** Relentless Assault — next non-M1 offensive spell has reduced cooldown (DES_04). */
  relentlessAssault: {
    id: "relentlessAssault",
    name: "Relentless Assault",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#ec4899",
    tag: "REL",
  },
  /** Impact Catalyst — next elemental spell applies doubled status stacks (DES_05). */
  impactCatalyst: {
    id: "impactCatalyst",
    name: "Impact Catalyst",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 6000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f97316",
    tag: "CAT",
  },
  /** Executioner's Rhythm — consecutive close-range hits ramp damage (DES_09). */
  executionersRhythm: {
    id: "executionersRhythm",
    name: "Executioner's Rhythm",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 3,
    stackRule: "stack",
    color: "#ef4444",
    tag: "RHY",
  },
  /** Sniper Focus — successful long-range hits build toward guaranteed crit (DES_13). */
  sniperFocus: {
    id: "sniperFocus",
    name: "Sniper Focus",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 8000,
    maxStacks: 2,
    stackRule: "stack",
    color: "#38bdf8",
    tag: "SNP",
  },
  /** Exposed Flank — flank is vulnerable to attacks from that bearing (DES_14). */
  exposedAngle: {
    id: "exposedAngle",
    name: "Exposed Flank",
    polarity: "debuff",
    mechanic: "resist",
    durationMs: 3000,
    damageTakenMul: 1.20,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fb923c",
    tag: "EXP",
  },
  /** Elemental Surge — active while 3+ elemental stacks across enemies (DES_20). */
  elementalSurge: {
    id: "elementalSurge",
    name: "Elemental Surge",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 2500,
    damageDealtMul: 1.15,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a855f7",
    tag: "SRG",
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
    durationMs: 5000,
    isAura: true,
    damageTakenMul: 0.4,
    damageDealtMul: 1.3,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fbbf24",
    tag: "HLY",
  },
  /** Iron Guard — stand-your-ground DR + displacement block + heavy slow. */
  ironGuard: {
    id: "ironGuard",
    name: "Iron Guard",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 2600,
    damageTakenMul: 0.35,
    moveMul: 0.4,
    blocksDisplacement: true,
    isDispellable: true,
    dispelPriority: 70,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#64748B",
    tag: "IRN",
  },
  /** Hex Anchor mark — next spell cast roots and damages. */
  hexAnchored: {
    id: "hexAnchored",
    name: "Hex Anchor",
    polarity: "debuff",
    mechanic: "slow",
    durationMs: 3000,
    isDispellable: true,
    dispelPriority: 75,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#8B2DCE",
    tag: "HEX",
  },
  /**
   * Spellbreaker orbs — each stack adds bonus damage to the next damaging hit.
   * Consumed when a damaging ability begins (orb fires with that spell).
   */
  spellbreakerCharge: {
    id: "spellbreakerCharge",
    name: "Spellbreaker",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 8000,
    isDispellable: true,
    dispelPriority: 55,
    maxStacks: 3,
    stackRule: "stack",
    color: "#fbbf24",
    tag: "SBK",
  },
  /** Gravity Field ring — refresh while inside, strip on exit. */
  gravityFieldSlow: {
    id: "gravityFieldSlow",
    name: "Gravity Field",
    polarity: "debuff",
    mechanic: "slow",
    durationMs: 5000,
    isAura: true,
    moveMul: 0.55,
    isDispellable: true,
    dispelPriority: 40,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#A78BFA",
    tag: "GRV",
  },
  /** Blood Pact — +35% damage dealt (follows recipient). */
  bloodPactEmpower: {
    id: "bloodPactEmpower",
    name: "Blood Pact",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 5000,
    damageDealtMul: 1.35,
    isDispellable: true,
    dispelPriority: 60,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#EF4444",
    tag: "BLD",
  },
  /** Chain Lightning ally buff — move + cast speed. */
  conductiveSurge: {
    id: "conductiveSurge",
    name: "Conductive Surge",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 4000,
    moveMul: 1.15,
    castDurationMul: 1 / 1.12,
    isDispellable: true,
    dispelPriority: 50,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#38BDF8",
    tag: "CRG",
  },
  /** Ascendant Form — 22% damage reduction + melee presence buff. */
  ascendantForm: {
    id: "ascendantForm",
    name: "Ascendant Form",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 5500,
    damageTakenMul: 0.78,
    isDispellable: false,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#F59E0B",
    tag: "ASC",
  },
  /** Feared — interrupted, blocked casts, and driven away from the caster. */
  feared: {
    id: "feared",
    name: "Feared",
    polarity: "debuff",
    mechanic: "fear",
    durationMs: 1250,
    blocksCast: true,
    isDispellable: true,
    dispelPriority: 80,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#8B2DCE",
    tag: "FEAR",
  },
  /** Dread Aura — reactive fear aura active on caster for 2.6s. */
  dreadAuraActive: {
    id: "dreadAuraActive",
    name: "Dread Aura",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 2600,
    isAura: true,
    isDispellable: false,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#32134A",
    tag: "DREAD",
  },
  /** Map pickup: move speed surge (+50% speed). */
  speedPickup: {
    id: "speedPickup",
    name: "Speed Surge",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 10000,
    moveMul: 1.5,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#22d3ee",
    tag: "SPD",
  },
  /** Map pickup: damage power surge (+50% damage dealt). */
  powerPickup: {
    id: "powerPickup",
    name: "Power Surge",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 10000,
    damageDealtMul: 1.5,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#ef4444",
    tag: "PWR",
  },
  /** Map pickup: absorb shield. `stacks` = remaining shield HP. */
  absorbPickup: {
    id: "absorbPickup",
    name: "Absorb Shield",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 12000,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#3b82f6",
    tag: "ABS",
  },
  /** Map pickup: cooldown haste (+25% CDR). */
  hastePickup: {
    id: "hastePickup",
    name: "Haste Surge",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 6000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a855f7",
    tag: "HST",
  },
  /** Guardian GUA_02: Hardened — stacking damage reduction on taking damage. */
  hardened: {
    id: "hardened",
    name: "Hardened",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 4000,
    maxStacks: 4,
    stackRule: "stack",
    color: "#64748b",
    tag: "HRD",
  },
  /** Guardian GUA_03 / GUA_13: Guard Discipline & Guarded Recovery — shield from active block. */
  guardDisciplineShield: {
    id: "guardDisciplineShield",
    name: "Guard Discipline",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 3000,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#38bdf8",
    tag: "GRD",
  },
  /** Guardian GUA_04: Shared Protection — shield copied to nearby allies. */
  sharedProtectionShield: {
    id: "sharedProtectionShield",
    name: "Shared Protection",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 3000,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#60a5fa",
    tag: "SHR",
  },
  /** Guardian GUA_05: Frontline Support — shield granted to allies after movement ability. */
  frontlineSupportShield: {
    id: "frontlineSupportShield",
    name: "Frontline Support",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 3000,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#93c5fd",
    tag: "FNT",
  },
  /** Guardian GUA_06: Under Pressure — damage reduction against repeat attacker. */
  underPressure: {
    id: "underPressure",
    name: "Under Pressure",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 3000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fb923c",
    tag: "PRS",
  },
  /** Guardian GUA_07: Braced Assault — empowered next close-range offensive hit (+20%). */
  bracedAssault: {
    id: "bracedAssault",
    name: "Braced Assault",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f59e0b",
    tag: "BRC",
  },
  /** Guardian GUA_09: Guardian's Presence — proximity DR aura with allies (5%). */
  guardiansPresence: {
    id: "guardiansPresence",
    name: "Guardian's Presence",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 1000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#34d399",
    tag: "GPR",
  },
  /** Guardian GUA_14: Guardian's Blessing — active talent spell shield (20% max HP). */
  guardiansBlessing: {
    id: "guardiansBlessing",
    name: "Guardian's Blessing",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 5000,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#a78bfa",
    tag: "BLS",
  },
  /** Guardian GUA_15: Aegis Momentum — speed and damage surge on shield break. */
  aegisMomentum: {
    id: "aegisMomentum",
    name: "Aegis Momentum",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.1,
    damageDealtMul: 1.1,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fbbf24",
    tag: "AGS",
  },
  /** Guardian GUA_16: Fortified Resolve — anti-burst reduction against hit >= 10% max HP. */
  fortifiedResolve: {
    id: "fortifiedResolve",
    name: "Fortified Resolve",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 6000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f43f5e",
    tag: "RES",
  },
  /** Guardian GUA_19: Bastion — team damage reduction after directly shielding an ally (12%). */
  bastion: {
    id: "bastion",
    name: "Bastion",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#6366f1",
    tag: "BST",
  },
  /** Guardian GUA_21: Perfect Defense — +25% block chance window after blocking an attack. */
  perfectDefense: {
    id: "perfectDefense",
    name: "Perfect Defense",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 2000,
    maxStacks: 1,
    stackRule: "ignore",
    color: "#38bdf8",
    tag: "PRF",
  },
  /** Control CON_05: slower casts while under the caster's control. */
  forbiddenGround: {
    id: "forbiddenGround",
    name: "Forbidden Ground",
    polarity: "debuff",
    mechanic: "buff",
    durationMs: 2500,
    castDurationMul: 1 / 0.9,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#7c3aed",
    tag: "FORB",
  },
  /** Control CON_10: reduced damage dealt while controlled. */
  suppressedControl: {
    id: "suppressedControl",
    name: "Suppressed",
    polarity: "debuff",
    mechanic: "buff",
    durationMs: 3000,
    damageDealtMul: 0.88,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#6d28d9",
    tag: "SUPP",
  },
  /** Control CON_04: next control ability cooldown reduced. */
  brokenCadence: {
    id: "brokenCadence",
    name: "Broken Cadence",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#a78bfa",
    tag: "CAD",
  },
  /** Control CON_08: next displacement empowered. */
  chainPullReady: {
    id: "chainPullReady",
    name: "Chain Pull",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#c4b5fd",
    tag: "CHP",
  },
  /** Control CON_12: trail slow (does not stack with other wakes from same caster). */
  distortedWakeSlow: {
    id: "distortedWakeSlow",
    name: "Distorted Wake",
    polarity: "debuff",
    mechanic: "slow",
    durationMs: 800,
    moveMul: 0.8,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#818cf8",
    tag: "WAKE",
  },
  /** Control CON_13: next attacker is rooted. */
  repositioningReady: {
    id: "repositioningReady",
    name: "Repositioning",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#818cf8",
    tag: "RPO",
  },
  /** Control CON_14: subsequent CC from this caster lasts longer. */
  arcaneLocked: {
    id: "arcaneLocked",
    name: "Arcane Lock",
    polarity: "debuff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#8b5cf6",
    tag: "LOCK",
  },
  /** Control CON_15: move speed after a disruption. */
  punishingSilence: {
    id: "punishingSilence",
    name: "Punishing Silence",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.15,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#c084fc",
    tag: "PUN",
  },
  /** Control CON_17: dash length and haste bonuses reduced. */
  contained: {
    id: "contained",
    name: "Contained",
    polarity: "debuff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#6366f1",
    tag: "CTN",
  },
  /** Control CON_18: next movement ability roots after it finishes. */
  spatiallyUnstable: {
    id: "spatiallyUnstable",
    name: "Unstable",
    polarity: "debuff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#4f46e5",
    tag: "UNS",
  },
  /** Control CON_21: movement input reversed. */
  disoriented: {
    id: "disoriented",
    name: "Disoriented",
    polarity: "debuff",
    mechanic: "buff",
    durationMs: 1500,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#e879f9",
    tag: "DIS",
  },
  fleetFooted: {
    id: "fleetFooted",
    name: "Fleet Footed",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 2000,
    maxStacks: 15,
    stackRule: "refresh",
    color: "#a3e635",
    tag: "FLT",
  },
  combatFlow: {
    id: "combatFlow",
    name: "Combat Flow",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 15,
    stackRule: "refresh",
    color: "#84cc16",
    tag: "CFW",
  },
  followThrough: {
    id: "followThrough",
    name: "Follow Through",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 20,
    stackRule: "refresh",
    color: "#65a30d",
    tag: "FTH",
  },
  quickRecovery: {
    id: "quickRecovery",
    name: "Quick Recovery",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#bef264",
    tag: "QR",
  },
  untouchable: {
    id: "untouchable",
    name: "Untouchable",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 1500,
    damageTakenMul: 0.85,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#d9f99d",
    tag: "UNT",
  },
  reboundWindow: {
    id: "reboundWindow",
    name: "Rebound Window",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fde047",
    tag: "RBW",
  },
  movementRepeatReady: {
    id: "movementRepeatReady",
    name: "Double Step",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 2500,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#86efac",
    tag: "DST",
  },
  tripleBlinkReady: {
    id: "tripleBlinkReady",
    name: "Triple Blink",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 1800,
    maxStacks: 2,
    stackRule: "refresh",
    color: "#a3e635",
    tag: "TBK",
  },
  empathicSurge: {
    id: "empathicSurge",
    name: "Empathic Surge",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 2500,
    maxStacks: 9,
    stackRule: "refresh",
    color: "#86efac",
    tag: "EMP",
  },
  inspiringRecovery: {
    id: "inspiringRecovery",
    name: "Inspiring Recovery",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 2000,
    castDurationMul: 1 / 1.08,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fde68a",
    tag: "INS",
  },
  upliftingPresence: {
    id: "upliftingPresence",
    name: "Uplifting Presence",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 2000,
    moveMul: 1.07,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#bbf7d0",
    tag: "UPL",
  },
  lastingRescue: {
    id: "lastingRescue",
    name: "Lasting Rescue",
    polarity: "buff",
    mechanic: "resist",
    durationMs: 2500,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#facc15",
    tag: "LRS",
  },
  overflowingGraceHot: {
    id: "overflowingGraceHot",
    name: "Overflowing Grace",
    polarity: "buff",
    mechanic: "hot",
    durationMs: 4000,
    tickMs: 1000,
    healPerTick: 1,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#86efac",
    tag: "OVG",
  },
  harmoniousGrowth: {
    id: "harmoniousGrowth",
    name: "Harmonious Growth",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.1,
    castDurationMul: 1 / 1.1,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#4ade80",
    tag: "HGR",
  },
  empoweredRecovery: {
    id: "empoweredRecovery",
    name: "Empowered Recovery",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 3000,
    damageDealtMul: 1.1,
    castDurationMul: 1 / 1.08,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fbbf24",
    tag: "EPR",
  },
  battleRhythm: {
    id: "battleRhythm",
    name: "Battle Rhythm",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 4000,
    maxStacks: 3,
    stackRule: "refresh",
    color: "#a3e635",
    tag: "RHY",
  },
  harmonyResonanceStacks: {
    id: "harmonyResonanceStacks",
    name: "Resonance",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 8000,
    maxStacks: 3,
    stackRule: "stack",
    color: "#fde047",
    tag: "RSN",
  },
  harmonyResonance: {
    id: "harmonyResonance",
    name: "Resonance",
    polarity: "buff",
    mechanic: "empower",
    durationMs: 4000,
    damageDealtMul: 1.12,
    maxStacks: 1,
    stackRule: "ignore",
    color: "#facc15",
    tag: "RSO",
  },
  lastingGrace: {
    id: "lastingGrace",
    name: "Lasting Grace",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 1,
    stackRule: "ignore",
    color: "#fef08a",
    tag: "LGR",
  },
  rebirthBlessing: {
    id: "rebirthBlessing",
    name: "Rebirth",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 5000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#fef9c3",
    tag: "REB",
  },
  rebirthPending: {
    id: "rebirthPending",
    name: "Rebirth",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    grantsInvulnerable: true,
    blocksMove: true,
    blocksCast: true,
    maxStacks: 1,
    stackRule: "ignore",
    color: "#fef08a",
    tag: "RPND",
  },
  motionEcho: {
    id: "motionEcho",
    name: "Motion Echo",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 4000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#4ade80",
    tag: "MTE",
  },
  phaseShield: {
    id: "phaseShield",
    name: "Phase Shield",
    polarity: "buff",
    mechanic: "shield",
    durationMs: 3000,
    maxStacks: 9999,
    stackRule: "refresh",
    color: "#a3e635",
    tag: "PHS",
  },
  relentlessPursuit: {
    id: "relentlessPursuit",
    name: "Relentless Pursuit",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 3000,
    moveMul: 1.15,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#facc15",
    tag: "RPU",
  },
  momentumEngine: {
    id: "momentumEngine",
    name: "Momentum Engine",
    polarity: "buff",
    mechanic: "haste",
    durationMs: 4000,
    moveMul: 1.15,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#f59e0b",
    tag: "MEN",
  },
  phantomCharge: {
    id: "phantomCharge",
    name: "Phantom Chain",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 8000,
    maxStacks: 3,
    stackRule: "refresh",
    color: "#bbf7d0",
    tag: "PHC",
  },
  flowEngage: {
    id: "flowEngage",
    name: "In Motion",
    polarity: "buff",
    mechanic: "buff",
    durationMs: 3000,
    maxStacks: 1,
    stackRule: "refresh",
    color: "#d9f99d",
    tag: "FLW",
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

/** DoTs / slows / elemental vulnerabilities amplified by Intensified Elements (and gated as "elemental"). */
export function isElementalSecondaryStatus(def: StatusDef | undefined): boolean {
  if (!def || def.polarity !== "debuff") return false;
  if (def.mechanic === "dot" || def.mechanic === "slow") return true;
  if (typeof def.moveMul === "number" && def.moveMul < 1) return true;
  return (
    def.id === "burning" ||
    def.id === "poisoned" ||
    def.id === "bleeding" ||
    def.id === "frostChill" ||
    def.id === "shocked"
  );
}

/** Core 4 elements recognized by the elemental talent tree: Fire, Frost, Poison, Shock. */
export function isElementalStatusId(statusId: string): boolean {
  return (
    statusId === "burning" ||
    statusId === "poisoned" ||
    statusId === "frostChill" ||
    statusId === "shocked"
  );
}

/** Stun / root / silence / fear — Opportunist hard CC (not slows or soft debuffs). */
export function isHardCrowdControlStatus(def: StatusDef | undefined): boolean {
  if (!def) return false;
  return (
    def.mechanic === "stun" ||
    def.mechanic === "root" ||
    def.mechanic === "silence" ||
    def.mechanic === "fear"
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
  let flowHaste = 1;
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
      else if (def.moveMul > 1) {
        if (TALENT_TEMP_HASTE_STATUS_IDS.has(def.id)) {
          flowHaste *= def.moveMul;
        }
        else haste *= def.moveMul;
      }
    } else if (def.id === "fleetFooted") {
      const pct = Math.max(0, Math.min(15, stacks));
      if (pct > 0) flowHaste *= 1 + pct / 100;
    } else if (def.id === "empathicSurge") {
      const pct = Math.max(0, Math.min(9, stacks));
      if (pct > 0) flowHaste *= 1 + pct / 100;
    } else if (def.id === "battleRhythm") {
      const pct = Math.max(0, Math.min(3, stacks)) * 3;
      if (pct > 0) flowHaste *= 1 + pct / 100;
    }
  }
  const cappedFlow = Math.min(1 + FLOW_TEMP_HASTE_CAP, flowHaste);
  return Math.max(0, (1 - Math.min(100, slowPct) / 100) * haste * cappedFlow);
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
  let talentAmp = 1;
  for (const { def } of entries) {
    if (typeof def.damageDealtMul === "number" && def.damageDealtMul > 0) {
      if (TALENT_TEMP_DAMAGE_STATUS_IDS.has(def.id) && def.damageDealtMul > 1) {
        talentAmp *= def.damageDealtMul;
      } else {
        mul *= def.damageDealtMul;
      }
    }
  }
  const cappedTalent = Math.min(1 + FLOW_TEMP_HASTE_CAP, talentAmp);
  return Math.max(0, mul * cappedTalent);
}

/** Cast anticipation duration factor (multiplicative; 1 = normal windup). */
export function combineStatusAnticipationMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let mul = 1;
  for (const { def, stacks } of entries) {
    if (def.id === "combatFlow") {
      const pct = Math.max(0, Math.min(15, stacks));
      if (pct > 0) mul *= 1 / (1 + pct / 100);
      continue;
    }
    if (typeof def.anticipationMul === "number" && def.anticipationMul > 0) {
      const s = Math.max(1, Math.min(def.maxStacks ?? stacks, Math.floor(stacks)));
      mul *= Math.pow(def.anticipationMul, s);
    }
  }
  return Math.max(0.05, mul);
}

/** Cast phase duration factor (anticipation/cast/impact); 1 = normal. */
export function combineStatusCastDurationMul(
  entries: { def: StatusDef; stacks: number }[],
): number {
  let mul = 1;
  let talentHaste = 1;
  for (const { def, stacks } of entries) {
    if (def.id === "combatFlow") {
      const pct = Math.max(0, Math.min(15, stacks));
      if (pct > 0) talentHaste *= 1 + pct / 100;
      continue;
    }
    if (def.id === "battleRhythm") {
      const pct = Math.max(0, Math.min(3, stacks)) * 3;
      if (pct > 0) talentHaste *= 1 + pct / 100;
      continue;
    }
    if (typeof def.castDurationMul === "number" && def.castDurationMul > 0) {
      const s = Math.max(1, Math.min(def.maxStacks ?? stacks, Math.floor(stacks)));
      const factor = Math.pow(def.castDurationMul, s);
      if (HARMONY_TEMP_CAST_STATUS_IDS.has(def.id)) {
        talentHaste *= 1 / factor;
      } else {
        mul *= factor;
      }
    }
  }
  const cappedTalent = Math.min(1 + FLOW_TEMP_HASTE_CAP, talentHaste);
  return Math.max(0.05, mul / cappedTalent);
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
    (e) =>
      e.def.blocksCast ||
      e.def.mechanic === "stun" ||
      e.def.mechanic === "silence" ||
      e.def.mechanic === "fear",
  );
}

/** True when any active status blocks knockback / pull. */
export function statusesBlockDisplacement(entries: { def: StatusDef }[]): boolean {
  return entries.some((e) => e.def.blocksDisplacement === true);
}

/**
 * Default dispel priority by mechanic (higher removed first).
 * Explicit `dispelPriority` on the def wins.
 */
export function statusDispelPriority(def: StatusDef): number {
  if (typeof def.dispelPriority === "number") return def.dispelPriority;
  switch (def.mechanic) {
    case "stun":
      return 100;
    case "fear":
      return 95;
    case "silence":
      return 90;
    case "root":
      return 85;
    case "dot":
      return 65;
    case "slow":
      return 50;
    case "resist":
      return 70;
    case "shield":
      return 72;
    case "empower":
      return 68;
    case "haste":
      return 60;
    case "stealth":
      return 80;
    default:
      return 40;
  }
}

/** Ally cleanse — removable debuffs (defaults: non-permanent debuffs). */
export function statusIsDebuffDispellable(def: StatusDef): boolean {
  if (def.polarity !== "debuff") return false;
  if (def.permanent) return false;
  if (typeof def.isDispellable === "boolean") return def.isDispellable;
  return true;
}

/** Enemy purge — removable buffs (defaults: haste/shield/resist/empower/stealth). */
export function statusIsBuffDispellable(def: StatusDef): boolean {
  if (def.polarity !== "buff") return false;
  if (def.permanent) return false;
  if (typeof def.isDispellable === "boolean") return def.isDispellable;
  return (
    def.mechanic === "haste" ||
    def.mechanic === "shield" ||
    def.mechanic === "resist" ||
    def.mechanic === "empower" ||
    def.mechanic === "stealth"
  );
}

export function rollStatusChance(chance = 1): boolean {
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  return Math.random() < chance;
}
