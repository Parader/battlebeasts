/**
 * PvP match rewards, activity mul, quest/chest constants.
 * Design source: docs/loot-and-rewards.md
 */

import { ABILITIES } from "./abilities";
import type { PvpModeId } from "./content";
import { COSMETIC_CATALOG } from "./cosmetics";
import { EMOTES } from "./emotes";
import {
  STARTER_COLORS,
  STARTER_PATTERN_COLORS,
  STARTER_PATTERNS,
} from "./playerUnlocks";
import {
  COSMETIC_COLORS,
  COSMETIC_PATTERN_COLORS,
  COSMETIC_PATTERNS,
} from "./stands";
import { STARTER_TALENT_POINTS, TALENT_POINT_BUDGET } from "./talentTrees";

/** Owned ability count when every spell is unlocked (includes starters). */
export const QUEST_MAX_SPELLS = Object.keys(ABILITIES).length;
/** Purchased talent points at budget (owned − starter). */
export const QUEST_MAX_TALENT_SPEND = TALENT_POINT_BUDGET - STARTER_TALENT_POINTS;

export type MatchRewardMode = "arena_1v1" | "arena_2v2" | "arena_3v3" | "battleground" | "pve" | "unknown";

export type MatchOutcome = "win" | "loss" | "draw" | "leave_early" | "pve";

export type MatchActivity = {
  moveTicks: number;
  castCount: number;
};

export type MatchRewardBreakdown = {
  baseEssence: number;
  winBonusEssence: number;
  copperBeforeMul: number;
  activityMul: number;
  activityScore: number;
  activityThreshold: number;
};

export type MatchRewardResult = {
  essence: number;
  copper: number;
  silver: number;
  gold: number;
  activityMul: number;
  breakdown: MatchRewardBreakdown;
};

/** Casts weight more than move ticks for AFK detection. */
export const ACTIVITY_CAST_WEIGHT = 8;

type ModeRewardBand = {
  baseEssence: number;
  winBonusEssence: number;
  lossCopper: [number, number];
  winCopper: [number, number];
  /** Activity score needed for full mul (moveTicks + castCount * K). */
  activityThreshold: number;
  leaveEarlyEssence: number;
};

/** Per-mode payout bands (before activity mul). */
export const MATCH_REWARDS: Record<"arena_1v1" | "arena_2v2" | "arena_3v3", ModeRewardBand> = {
  arena_1v1: {
    baseEssence: 8,
    winBonusEssence: 8,
    lossCopper: [5, 12],
    winCopper: [18, 28],
    activityThreshold: 80,
    leaveEarlyEssence: 2,
  },
  arena_2v2: {
    baseEssence: 10,
    winBonusEssence: 10,
    lossCopper: [8, 16],
    winCopper: [22, 32],
    activityThreshold: 100,
    leaveEarlyEssence: 3,
  },
  arena_3v3: {
    baseEssence: 12,
    winBonusEssence: 12,
    lossCopper: [10, 20],
    winCopper: [28, 40],
    activityThreshold: 120,
    leaveEarlyEssence: 4,
  },
};

const BATTLEGROUND_BAND: ModeRewardBand = {
  baseEssence: 12,
  winBonusEssence: 12,
  lossCopper: [10, 20],
  winCopper: [28, 40],
  activityThreshold: 120,
  leaveEarlyEssence: 4,
};

const PVE_BAND: ModeRewardBand = {
  baseEssence: 5,
  winBonusEssence: 0,
  lossCopper: [8, 12],
  winCopper: [8, 12],
  activityThreshold: 40,
  leaveEarlyEssence: 2,
};

/** @deprecated Prefer MATCH_REWARDS / computeMatchReward. Kept for docs/compat. */
export const MATCH_ESSENCE = {
  pvpWin: 16,
  pvpLoss: 8,
  pvpDraw: 8,
  pvpLeaveEarly: 2,
  pveClear: 5,
} as const;

export type ChestQuality = "green" | "blue" | "purple" | "legendary";

export const CHEST_QUALITIES: readonly ChestQuality[] = [
  "green",
  "blue",
  "purple",
  "legendary",
] as const;

/** Quest reward: fixed rarity, or roll with ANY_CHEST_WEIGHTS. */
export type QuestChestReward = ChestQuality | "any";

/**
 * Base weights for `chest: "any"` (must sum to 100).
 * Tweak here — used by `rollQuestChestQuality`.
 */
export const ANY_CHEST_WEIGHTS: readonly { quality: ChestQuality; weight: number }[] = [
  { quality: "legendary", weight: 5 },
  { quality: "purple", weight: 15 },
  { quality: "blue", weight: 25 },
  { quality: "green", weight: 55 },
] as const;

/** Resolve a quest chest reward to a concrete rarity. */
export function rollQuestChestQuality(
  reward: QuestChestReward,
  salt = Date.now(),
): ChestQuality {
  if (reward !== "any") return reward;
  const total = ANY_CHEST_WEIGHTS.reduce((s, e) => s + e.weight, 0);
  let t = Math.abs(salt) % Math.max(1, total);
  for (const entry of ANY_CHEST_WEIGHTS) {
    t -= entry.weight;
    if (t < 0) return entry.quality;
  }
  return ANY_CHEST_WEIGHTS[ANY_CHEST_WEIGHTS.length - 1]!.quality;
}

/** Duplicate cosmetic/emote/skin → copper compensation by quality. */
export const DUPLICATE_COPPER: Record<ChestQuality, number> = {
  green: 15,
  blue: 35,
  purple: 80,
  legendary: 150,
};

export type QuestType = "daily" | "lifetime";

export type QuestDef = {
  id: string;
  type: QuestType;
  target: number;
  chest: QuestChestReward;
  label: string;
};

export const QUEST_CATALOG: readonly QuestDef[] = [
  {
    id: "daily_win_3",
    type: "daily",
    target: 3,
    chest: "any",
    label: "Win 3 matches today",
  },
  {
    id: "daily_modes_3",
    type: "daily",
    target: 3,
    chest: "any",
    label: "Play 3 distinct PvP modes today",
  },
  {
    id: "once_friend_code",
    type: "lifetime",
    target: 1,
    chest: "blue",
    label: "Redeem a friend code (once) or share yours",
  },
  {
    id: "once_first_pvp",
    type: "lifetime",
    target: 1,
    chest: "blue",
    label: "Complete your first PvP match",
  },
  {
    id: "once_friends_5",
    type: "lifetime",
    target: 5,
    chest: "purple",
    label: "Refer 5 friends",
  },
  {
    id: "life_essence_150",
    type: "lifetime",
    target: 150,
    chest: "green",
    label: "Earn 150 essence",
  },
  {
    id: "life_essence_300",
    type: "lifetime",
    target: 300,
    chest: "blue",
    label: "Earn 300 essence",
  },
  {
    id: "life_essence_500",
    type: "lifetime",
    target: 500,
    chest: "blue",
    label: "Earn 500 essence",
  },
  {
    id: "life_essence_750",
    type: "lifetime",
    target: 750,
    chest: "purple",
    label: "Earn 750 essence",
  },
  {
    id: "life_essence_1000",
    type: "lifetime",
    target: 1000,
    chest: "purple",
    label: "Earn 1,000 essence",
  },
  {
    id: "life_essence_1500",
    type: "lifetime",
    target: 1500,
    chest: "purple",
    label: "Earn 1,500 essence",
  },
  {
    id: "life_essence_2500",
    type: "lifetime",
    target: 2500,
    chest: "legendary",
    label: "Earn 2,500 essence",
  },
  {
    id: "life_essence_5000",
    type: "lifetime",
    target: 5000,
    chest: "legendary",
    label: "Earn 5,000 essence",
  },
  { id: "life_spells_5", type: "lifetime", target: 5, chest: "green", label: "Unlock 5 spells" },
  { id: "life_spells_10", type: "lifetime", target: 10, chest: "blue", label: "Unlock 10 spells" },
  { id: "life_spells_15", type: "lifetime", target: 15, chest: "blue", label: "Unlock 15 spells" },
  { id: "life_spells_20", type: "lifetime", target: 20, chest: "purple", label: "Unlock 20 spells" },
  {
    id: "life_spells_all",
    type: "lifetime",
    target: QUEST_MAX_SPELLS,
    chest: "legendary",
    label: "Unlock every spell",
  },
  {
    id: "life_talents_5",
    type: "lifetime",
    target: 5,
    chest: "green",
    label: "Spend 5 talent points",
  },
  {
    id: "life_talents_10",
    type: "lifetime",
    target: 10,
    chest: "blue",
    label: "Spend 10 talent points",
  },
  {
    id: "life_talents_15",
    type: "lifetime",
    target: 15,
    chest: "blue",
    label: "Spend 15 talent points",
  },
  {
    id: "life_talents_max",
    type: "lifetime",
    target: QUEST_MAX_TALENT_SPEND,
    chest: "legendary",
    label: `Spend ${QUEST_MAX_TALENT_SPEND} talent points (full budget)`,
  },
  {
    id: "life_copper_500",
    type: "lifetime",
    target: 500,
    chest: "green",
    label: "Earn 500 copper",
  },
  {
    id: "life_copper_1000",
    type: "lifetime",
    target: 1000,
    chest: "blue",
    label: "Earn 1,000 copper",
  },
  {
    id: "life_copper_2500",
    type: "lifetime",
    target: 2500,
    chest: "blue",
    label: "Earn 2,500 copper",
  },
  {
    id: "life_copper_5000",
    type: "lifetime",
    target: 5000,
    chest: "purple",
    label: "Earn 5,000 copper",
  },
  {
    id: "life_copper_10000",
    type: "lifetime",
    target: 10000,
    chest: "purple",
    label: "Earn 10,000 copper",
  },
  {
    id: "life_copper_25000",
    type: "lifetime",
    target: 25000,
    chest: "legendary",
    label: "Earn 25,000 copper",
  },
] as const;

/** Stepped lifetime chains — UI shows only the next incomplete step. */
export const QUEST_CHAINS: readonly (readonly string[])[] = [
  [
    "life_essence_150",
    "life_essence_300",
    "life_essence_500",
    "life_essence_750",
    "life_essence_1000",
    "life_essence_1500",
    "life_essence_2500",
    "life_essence_5000",
  ],
  ["life_spells_5", "life_spells_10", "life_spells_15", "life_spells_20", "life_spells_all"],
  ["life_talents_5", "life_talents_10", "life_talents_15", "life_talents_max"],
  [
    "life_copper_500",
    "life_copper_1000",
    "life_copper_2500",
    "life_copper_5000",
    "life_copper_10000",
    "life_copper_25000",
  ],
] as const;

/** Quest ids whose id starts with `prefix` (e.g. `life_essence_`). */
export function questIdsWithPrefix(prefix: string): string[] {
  return QUEST_CATALOG.filter((q) => q.id.startsWith(prefix)).map((q) => q.id);
}

/** Hide later chain steps until the current one is complete; hide finished chains. */
export function filterQuestRowsForDisplay<T extends { id: string; completed: boolean }>(
  rows: readonly T[],
): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hidden = new Set<string>();

  for (const chain of QUEST_CHAINS) {
    let showId: string | null = null;
    for (const id of chain) {
      const row = byId.get(id);
      if (!row?.completed) {
        showId = id;
        break;
      }
    }
    for (const id of chain) {
      if (id !== showId) hidden.add(id);
    }
  }

  return rows.filter((r) => !hidden.has(r.id));
}

export function resolveRewardMode(mode: string | undefined | null): MatchRewardMode {
  if (!mode) return "unknown";
  if (mode === "arena_1v1" || mode === "arena_2v2" || mode === "arena_3v3") return mode;
  if (mode === "battleground") return "battleground";
  if (mode.startsWith("pve") || mode === "stub") return "pve";
  return "unknown";
}

function bandForMode(mode: MatchRewardMode): ModeRewardBand {
  if (mode === "arena_1v1" || mode === "arena_2v2" || mode === "arena_3v3") {
    return MATCH_REWARDS[mode];
  }
  if (mode === "battleground") return BATTLEGROUND_BAND;
  return PVE_BAND;
}

function midBand([lo, hi]: [number, number]): number {
  return Math.round((lo + hi) / 2);
}

function rollBand([lo, hi]: [number, number], salt: number): number {
  const span = Math.max(0, hi - lo);
  if (span === 0) return lo;
  // Deterministic-ish from salt so remounts don't re-roll wildly; callers can pass match hash.
  const t = Math.abs(salt) % (span + 1);
  return lo + t;
}

export function activityScore(activity: MatchActivity): number {
  return Math.max(0, activity.moveTicks) + Math.max(0, activity.castCount) * ACTIVITY_CAST_WEIGHT;
}

export function activityMultiplier(score: number, threshold: number): number {
  if (threshold <= 0) return 1;
  if (score >= threshold) return 1;
  if (score >= threshold * 0.4) return 0.5;
  return 0.15;
}

export function computeMatchReward(opts: {
  mode: string | MatchRewardMode;
  outcome: MatchOutcome;
  activity?: MatchActivity;
  /** Salt for copper band roll (e.g. hash of matchId+userId). */
  rollSalt?: number;
}): MatchRewardResult {
  const mode = typeof opts.mode === "string" ? resolveRewardMode(opts.mode) : opts.mode;
  const band = bandForMode(mode);
  const activity = opts.activity ?? { moveTicks: 0, castCount: 0 };
  const score = activityScore(activity);
  const mul = activityMultiplier(score, band.activityThreshold);
  const salt = opts.rollSalt ?? score;

  let baseEssence = band.baseEssence;
  let winBonusEssence = 0;
  let copperBefore = midBand(band.lossCopper);

  if (opts.outcome === "leave_early") {
    baseEssence = band.leaveEarlyEssence;
    winBonusEssence = 0;
    copperBefore = 0;
  } else if (opts.outcome === "pve") {
    baseEssence = band.baseEssence;
    winBonusEssence = 0;
    copperBefore = midBand(band.winCopper);
  } else if (opts.outcome === "win") {
    winBonusEssence = band.winBonusEssence;
    copperBefore = rollBand(band.winCopper, salt);
  } else if (opts.outcome === "loss") {
    winBonusEssence = 0;
    copperBefore = rollBand(band.lossCopper, salt);
  } else {
    // draw
    winBonusEssence = 0;
    copperBefore = midBand(band.winCopper);
  }

  const essenceRaw = baseEssence + winBonusEssence;
  const essence = Math.max(0, Math.round(essenceRaw * mul));
  const copper = Math.max(0, Math.round(copperBefore * mul));

  return {
    essence,
    copper,
    silver: 0,
    gold: 0,
    activityMul: mul,
    breakdown: {
      baseEssence,
      winBonusEssence,
      copperBeforeMul: copperBefore,
      activityMul: mul,
      activityScore: score,
      activityThreshold: band.activityThreshold,
    },
  };
}

export function outcomeFromMatch(opts: {
  kind: "pvp" | "pve";
  earlyLeave: boolean;
  winner: "a" | "b" | "draw" | null;
  team: string;
}): MatchOutcome {
  if (opts.kind !== "pvp") return "pve";
  if (opts.earlyLeave && !opts.winner) return "leave_early";
  if (!opts.winner || opts.winner === "draw") return "draw";
  if (opts.team === opts.winner) return "win";
  return "loss";
}

/** Hash string to small int for copper rolls. */
export function rewardRollSalt(...parts: string[]): number {
  let h = 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function isPvpModeId(id: string): id is PvpModeId {
  return (
    id === "arena_1v1" || id === "arena_2v2" || id === "arena_3v3" || id === "battleground"
  );
}

export function questPeriodKey(quest: QuestDef, now = new Date()): string {
  if (quest.type === "lifetime") return "lifetime";
  return now.toISOString().slice(0, 10);
}

export function getQuestDef(questId: string): QuestDef | undefined {
  return QUEST_CATALOG.find((q) => q.id === questId);
}

export type ChestLootLine =
  | { kind: "essence"; amount: number }
  | { kind: "copper"; amount: number }
  | { kind: "duplicate_copper"; amount: number; for: string; grant: ChestUnlockGrant }
  | { kind: "unlock"; label: string; grant: ChestUnlockGrant }
  | { kind: "note"; text: string };

export type ChestUnlockGrant =
  | { kind: "color"; hex: string }
  | { kind: "pattern"; patternId: string }
  | { kind: "pattern_color"; hex: string }
  | { kind: "cosmetic"; itemId: string }
  | { kind: "emote"; emoteId: string };

export type ChestOwnedSnapshot = {
  cosmetics: readonly string[];
  colors: readonly string[];
  patterns: readonly string[];
  patternColors: readonly string[];
  emotes: readonly string[];
};

export type ChestLootResult = {
  essence: number;
  copper: number;
  lines: ChestLootLine[];
  grants: ChestUnlockGrant[];
};

/** @deprecated Prefer rollChestLoot. */
export function rollChestCurrency(quality: ChestQuality, salt: number): {
  essence: number;
  copper: number;
  lines: ChestLootLine[];
} {
  const rolled = rollChestLoot(quality, salt, {
    cosmetics: [],
    colors: [],
    patterns: [],
    patternColors: [],
    emotes: [],
  });
  return { essence: rolled.essence, copper: rolled.copper, lines: rolled.lines };
}

type LootPoolEntry = { grant: ChestUnlockGrant; label: string; weight: number };

function pickWeighted(entries: LootPoolEntry[], salt: number): LootPoolEntry | null {
  if (entries.length === 0) return null;
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let t = salt % total;
  for (const e of entries) {
    t -= e.weight;
    if (t < 0) return e;
  }
  return entries[entries.length - 1]!;
}

function ownsGrant(owned: ChestOwnedSnapshot, grant: ChestUnlockGrant): boolean {
  switch (grant.kind) {
    case "color":
      return owned.colors.includes(grant.hex);
    case "pattern":
      return owned.patterns.includes(grant.patternId);
    case "pattern_color":
      return owned.patternColors.includes(grant.hex);
    case "cosmetic":
      return owned.cosmetics.includes(grant.itemId);
    case "emote":
      return owned.emotes.includes(grant.emoteId);
  }
}

/** Quality-scaled currency + unlock rolls. Duplicates → copper compensation. */
export function rollChestLoot(
  quality: ChestQuality,
  salt: number,
  owned: ChestOwnedSnapshot,
): ChestLootResult {
  const bands: Record<ChestQuality, { essence: [number, number]; copper: [number, number] }> = {
    green: { essence: [3, 6], copper: [15, 30] },
    blue: { essence: [6, 11], copper: [30, 50] },
    purple: { essence: [10, 16], copper: [50, 85] },
    legendary: { essence: [16, 26], copper: [100, 150] },
  };
  const b = bands[quality];
  let essence = rollBand(b.essence, salt);
  let copper = rollBand(b.copper, salt + 17);
  const lines: ChestLootLine[] = [
    { kind: "essence", amount: essence },
    { kind: "copper", amount: copper },
  ];
  const grants: ChestUnlockGrant[] = [];

  const colorPool: LootPoolEntry[] = COSMETIC_COLORS.filter(
    (hex) => !(STARTER_COLORS as readonly string[]).includes(hex),
  ).map((hex) => ({ grant: { kind: "color", hex }, label: `Tint ${hex}`, weight: 2 }));

  const inkPool: LootPoolEntry[] = COSMETIC_PATTERN_COLORS.filter(
    (hex) => !(STARTER_PATTERN_COLORS as readonly string[]).includes(hex),
  ).map((hex) => ({
    grant: { kind: "pattern_color", hex },
    label: `Ink ${hex}`,
    weight: 2,
  }));

  const patternPool: LootPoolEntry[] = COSMETIC_PATTERNS.filter(
    (p) => !(STARTER_PATTERNS as readonly string[]).includes(p.id),
  ).map((p) => ({
    grant: { kind: "pattern", patternId: p.id },
    label: `${p.name} pattern`,
    weight: 2,
  }));

  const gearPool: LootPoolEntry[] = Object.values(COSMETIC_CATALOG).map((item) => ({
    grant: { kind: "cosmetic", itemId: item.id },
    label: item.name,
    weight: 1,
  }));

  const emotePool: LootPoolEntry[] = Object.values(EMOTES)
    .filter((e) => !e.starter)
    .map((e) => ({
      grant: { kind: "emote", emoteId: e.id },
      label: e.name,
      weight: 2,
    }));

  /** Mixed unlock pool — gear weighted lower so it is uncommon, not dominant. */
  const anyUnlockPool: LootPoolEntry[] = [
    ...colorPool,
    ...inkPool,
    ...patternPool,
    ...emotePool,
    ...gearPool.map((e) => ({ ...e, weight: 1 })),
  ];

  const tryDrop = (pool: LootPoolEntry[], dropSalt: number) => {
    const pick = pickWeighted(pool, dropSalt);
    if (!pick) return;
    if (ownsGrant(owned, pick.grant)) {
      const dup = DUPLICATE_COPPER[quality];
      copper += dup;
      lines.push({
        kind: "duplicate_copper",
        amount: dup,
        for: pick.label,
        grant: pick.grant,
      });
      return;
    }
    grants.push(pick.grant);
    lines.push({ kind: "unlock", label: pick.label, grant: pick.grant });
  };

  // Drop chances by quality (extra rolls stacked) — kept intentionally scarce.
  if (quality === "green") {
    if (salt % 100 < 22) tryDrop([...colorPool, ...inkPool], salt + 3);
  } else if (quality === "blue") {
    if (salt % 100 < 28) tryDrop([...colorPool, ...inkPool, ...patternPool], salt + 5);
    if ((salt >> 3) % 100 < 10) tryDrop(emotePool, salt + 11);
  } else if (quality === "purple") {
    if (salt % 100 < 26) tryDrop([...patternPool, ...emotePool], salt + 7);
    if ((salt >> 2) % 100 < 10) tryDrop(gearPool, salt + 13);
  } else {
    // Legendary: one guaranteed non-currency unlock (gear uncommon in the mix),
    // plus a small chance at a second unlock.
    tryDrop(anyUnlockPool, salt + 19);
    if ((salt >> 1) % 100 < 15) tryDrop([...emotePool, ...patternPool, ...gearPool], salt + 23);
  }

  // Re-sync copper line after duplicate adds.
  const copperLine = lines.find((l) => l.kind === "copper");
  if (copperLine && copperLine.kind === "copper") copperLine.amount = copper;

  return { essence, copper, lines, grants };
}

