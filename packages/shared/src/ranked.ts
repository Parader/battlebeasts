/** Ranked seasons — hidden MMR + visible ladder (LP / tiers). */

export type MatchKind = "ranked" | "custom";

export type RankTier =
  | "bronze"
  | "silver"
  | "gold"
  | "diamond"
  | "champion"
  | "master"
  | "grandmaster";

export type RankDivision = 1 | 2 | 3;

export const RANKED_TIERS: readonly RankTier[] = [
  "bronze",
  "silver",
  "gold",
  "diamond",
  "champion",
  "master",
  "grandmaster",
] as const;

/** Divisions III → I (3 = III, 1 = I). Master/GM have no divisions. */
export const RANKED_DIVISION_COUNT = 3;
export const LP_PER_DIVISION = 100;
/** Placement matches removed — LP applies from the first ranked game. Kept at 0 for schema/UI compat. */
export const PLACEMENT_MATCHES = 0;

export const MMR_MIDPOINT = 1000;
export const MMR_SOFT_RESET_FACTOR = 0.5;
export const MMR_K_FACTOR = 32;
export const MASTER_MMR_FLOOR = 1800;
export const GRANDMASTER_SLOTS = 100;

/** Progressive matchmaking band by wait time (ms). */
export const MMR_BAND_SCHEDULE: readonly { maxWaitMs: number; band: number }[] = [
  { maxWaitMs: 15_000, band: 75 },
  { maxWaitMs: 45_000, band: 150 },
  { maxWaitMs: 90_000, band: 300 },
  { maxWaitMs: 180_000, band: 500 },
  { maxWaitMs: Number.POSITIVE_INFINITY, band: Number.POSITIVE_INFINITY },
] as const;

export type RankSnapshot = {
  mmr: number;
  lp: number;
  tier: RankTier;
  /** 1–3 for divisioned tiers; 0 for Master/GM. */
  division: number;
  wins: number;
  losses: number;
  placementRemaining: number;
  peakTier: RankTier;
  /** GM ladder position when tier is grandmaster; otherwise null. */
  gmRank: number | null;
};

export type RankDelta = {
  before: RankSnapshot;
  after: RankSnapshot;
  mmrDelta: number;
  lpDelta: number;
  promoted: boolean;
  demoted: boolean;
};

export function emptyRankSnapshot(mmr = MMR_MIDPOINT): RankSnapshot {
  return {
    mmr,
    lp: 0,
    tier: "bronze",
    division: 3,
    wins: 0,
    losses: 0,
    placementRemaining: PLACEMENT_MATCHES,
    peakTier: "bronze",
    gmRank: null,
  };
}

export function mmrBandForWaitMs(waitMs: number): number {
  for (const row of MMR_BAND_SCHEDULE) {
    if (waitMs <= row.maxWaitMs) return row.band;
  }
  return Number.POSITIVE_INFINITY;
}

export function expectedScore(ownMmr: number, opponentMmr: number): number {
  return 1 / (1 + 10 ** ((opponentMmr - ownMmr) / 400));
}

export function eloDelta(ownMmr: number, opponentMmr: number, score: 0 | 0.5 | 1, k = MMR_K_FACTOR): number {
  const exp = expectedScore(ownMmr, opponentMmr);
  return Math.round(k * (score - exp));
}

export function softResetMmr(oldMmr: number): number {
  return Math.round(MMR_MIDPOINT + (oldMmr - MMR_MIDPOINT) * MMR_SOFT_RESET_FACTOR);
}

export function tierIndex(tier: RankTier): number {
  return RANKED_TIERS.indexOf(tier);
}

export function tierAtLeast(a: RankTier, b: RankTier): boolean {
  return tierIndex(a) >= tierIndex(b);
}

export function maxPeakTier(a: RankTier, b: RankTier): RankTier {
  return tierAtLeast(a, b) ? a : b;
}

export function hasDivisions(tier: RankTier): boolean {
  return tier !== "master" && tier !== "grandmaster";
}

export function formatRankLabel(snap: RankSnapshot): string {
  if (snap.tier === "grandmaster" && snap.gmRank != null) {
    return `Grandmaster #${snap.gmRank}`;
  }
  if (snap.tier === "master" || snap.tier === "grandmaster") {
    return `${capitalize(snap.tier)} · ${snap.lp} LP`;
  }
  const roman = divisionRoman(snap.division as RankDivision);
  return `${capitalize(snap.tier)} ${roman} · ${snap.lp} LP`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function divisionRoman(d: RankDivision): string {
  if (d === 1) return "I";
  if (d === 2) return "II";
  return "III";
}

/** Base LP swing scaled by how surprising the result was vs MMR. */
export function lpSwingForResult(ownMmr: number, opponentMmr: number, won: boolean): number {
  const exp = expectedScore(ownMmr, opponentMmr);
  if (won) {
    const base = 18;
    const bonus = Math.round((1 - exp) * 12);
    return Math.max(12, Math.min(28, base + bonus));
  }
  const base = 16;
  const extra = Math.round(exp * 8);
  return -Math.max(10, Math.min(22, base + extra));
}

export type ApplyMatchInput = {
  snapshot: RankSnapshot;
  opponentAvgMmr: number;
  won: boolean;
  draw?: boolean;
  /** When true, skip demotion shield (Master → Champion only path uses normal demotion). */
  forceDemote?: boolean;
};

/**
 * Apply one ranked result: Elo MMR + LP / division.
 * Caller persists and handles GM ranking separately.
 */
export function applyRankedMatchResult(input: ApplyMatchInput): RankDelta {
  const before = { ...input.snapshot };
  let snap: RankSnapshot = { ...input.snapshot, placementRemaining: 0 };

  const score: 0 | 0.5 | 1 = input.draw ? 0.5 : input.won ? 1 : 0;
  const mmrDelta = eloDelta(snap.mmr, input.opponentAvgMmr, score);
  snap.mmr = Math.max(0, snap.mmr + mmrDelta);

  if (input.won) snap.wins += 1;
  else if (!input.draw) snap.losses += 1;

  let lpDelta = 0;
  let promoted = false;
  let demoted = false;

  if (!input.draw) {
    const swing = lpSwingForResult(before.mmr, input.opponentAvgMmr, input.won);
    const applied = applyLp(snap, swing, input.forceDemote === true);
    snap = applied.snapshot;
    lpDelta = applied.lpDelta;
    promoted = applied.promoted;
    demoted = applied.demoted;
  }

  if (
    snap.mmr >= MASTER_MMR_FLOOR &&
    snap.tier !== "grandmaster" &&
    tierIndex(snap.tier) >= tierIndex("champion") &&
    tierIndex(snap.tier) < tierIndex("master")
  ) {
    snap.tier = "master";
    snap.division = 0;
    promoted = true;
  }

  snap.placementRemaining = 0;
  snap.peakTier = maxPeakTier(snap.peakTier, snap.tier);
  snap.gmRank = snap.tier === "grandmaster" ? snap.gmRank : null;

  return { before, after: snap, mmrDelta, lpDelta, promoted, demoted };
}

function applyLp(
  snap: RankSnapshot,
  swing: number,
  forceDemote: boolean,
): { snapshot: RankSnapshot; lpDelta: number; promoted: boolean; demoted: boolean } {
  let tier = snap.tier;
  let division = snap.division;
  let lp = snap.lp + swing;
  let promoted = false;
  let demoted = false;
  const lpDelta = swing;

  if (!hasDivisions(tier)) {
    // Master / GM: open LP (can go negative toward demotion).
    if (lp < 0) {
      if (tier === "master" || forceDemote) {
        tier = "champion";
        division = 1;
        lp = LP_PER_DIVISION + lp; // e.g. -10 → 90 in Champ I
        demoted = true;
      } else {
        lp = 0;
      }
    }
    return {
      snapshot: { ...snap, tier, division, lp: Math.max(0, lp) },
      lpDelta,
      promoted,
      demoted,
    };
  }

  while (lp >= LP_PER_DIVISION) {
    lp -= LP_PER_DIVISION;
    if (division > 1) {
      division -= 1;
      promoted = true;
    } else {
      const next = nextTierUp(tier);
      if (next) {
        tier = next;
        division = hasDivisions(next) ? RANKED_DIVISION_COUNT : 0;
        promoted = true;
      } else {
        lp = LP_PER_DIVISION;
        break;
      }
    }
  }

  while (lp < 0) {
    if (division < RANKED_DIVISION_COUNT) {
      // Demotion shield: first loss at 0 LP stays in division.
      if (snap.lp === 0 && swing < 0 && !forceDemote) {
        lp = 0;
        break;
      }
      division += 1;
      lp += LP_PER_DIVISION;
      demoted = true;
    } else {
      const prev = nextTierDown(tier);
      if (!prev) {
        lp = 0;
        break;
      }
      if (snap.lp === 0 && swing < 0 && !forceDemote && tier !== "master") {
        lp = 0;
        break;
      }
      tier = prev;
      division = 1;
      lp += LP_PER_DIVISION;
      demoted = true;
    }
  }

  return {
    snapshot: { ...snap, tier, division, lp: Math.max(0, Math.min(lp, hasDivisions(tier) ? LP_PER_DIVISION - 1 : lp)) },
    lpDelta,
    promoted,
    demoted,
  };
}

function nextTierUp(tier: RankTier): RankTier | null {
  const i = tierIndex(tier);
  if (i < 0 || i >= RANKED_TIERS.length - 1) return null;
  const next = RANKED_TIERS[i + 1]!;
  // Skip GM via LP — GM is leaderboard assignment.
  if (next === "grandmaster") return "master";
  return next;
}

function nextTierDown(tier: RankTier): RankTier | null {
  const i = tierIndex(tier);
  if (i <= 0) return null;
  const prev = RANKED_TIERS[i - 1]!;
  if (prev === "grandmaster") return "master";
  return prev;
}

/** First-reach season reward keys (claim idempotency). */
export const SEASON_TIER_REWARD_KEYS: readonly { tier: RankTier; key: string }[] = [
  { tier: "gold", key: "reach_gold" },
  { tier: "diamond", key: "reach_diamond" },
  { tier: "champion", key: "reach_champion" },
  { tier: "master", key: "reach_master" },
] as const;
