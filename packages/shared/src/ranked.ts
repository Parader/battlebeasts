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

export function divisionRoman(d: RankDivision): string {
  if (d === 1) return "I";
  if (d === 2) return "II";
  return "III";
}

/** Coerce wire/DB values so `division === 1` checks never fail on string "1". */
export function normalizeRankSnapshot(raw: Partial<RankSnapshot> | null | undefined): RankSnapshot {
  const base = emptyRankSnapshot();
  if (!raw || typeof raw !== "object") return base;
  const tier = (RANKED_TIERS as readonly string[]).includes(String(raw.tier))
    ? (raw.tier as RankTier)
    : base.tier;
  const peakRaw = raw.peakTier ?? (raw as { peak_tier?: string }).peak_tier;
  const peakTier = (RANKED_TIERS as readonly string[]).includes(String(peakRaw))
    ? (peakRaw as RankTier)
    : tier;
  let division = Math.floor(Number(raw.division));
  if (!Number.isFinite(division)) division = hasDivisions(tier) ? 3 : 0;
  if (hasDivisions(tier)) division = Math.max(1, Math.min(3, division || 3));
  else division = 0;
  const lp = Math.max(0, Math.floor(Number(raw.lp) || 0));
  const mmr = Math.max(0, Math.floor(Number(raw.mmr) || MMR_MIDPOINT));
  const wins = Math.max(0, Math.floor(Number(raw.wins) || 0));
  const losses = Math.max(0, Math.floor(Number(raw.losses) || 0));
  const placementRemaining = Math.max(0, Math.floor(Number(raw.placementRemaining) || 0));
  let gmRank: number | null = null;
  if (raw.gmRank != null && Number.isFinite(Number(raw.gmRank))) {
    gmRank = Math.max(1, Math.floor(Number(raw.gmRank)));
  }
  if (tier !== "grandmaster") gmRank = null;
  return {
    mmr,
    lp,
    tier,
    division,
    wins,
    losses,
    placementRemaining,
    peakTier,
    gmRank,
  };
}

export function formatRankLabel(snap: RankSnapshot): string {
  const n = normalizeRankSnapshot(snap);
  if (n.tier === "grandmaster" && n.gmRank != null) {
    return `Grandmaster #${n.gmRank}`;
  }
  if (n.tier === "master" || n.tier === "grandmaster") {
    return `${capitalize(n.tier)} · ${n.lp} LP`;
  }
  const roman = divisionRoman(n.division as RankDivision);
  return `${capitalize(n.tier)} ${roman} · ${n.lp} LP`;
}

/** Compact ladder line for leaderboard rows (tier + division + LP). */
export function formatLeaderboardRank(row: {
  tier: string;
  division: number;
  lp: number;
  rank?: number;
}): string {
  const tier = (RANKED_TIERS as readonly string[]).includes(row.tier)
    ? (row.tier as RankTier)
    : "bronze";
  const lp = Math.max(0, Math.floor(Number(row.lp) || 0));
  if (tier === "grandmaster") {
    return row.rank != null ? `Grandmaster #${row.rank}` : `Grandmaster · ${lp} LP`;
  }
  if (tier === "master") return `Master · ${lp} LP`;
  let division = Math.floor(Number(row.division));
  if (!Number.isFinite(division) || division < 1 || division > 3) division = 3;
  return `${capitalize(tier)} ${divisionRoman(division as RankDivision)} · ${lp} LP`;
}

/** Visible ladder order: higher tier → lower division # → more LP → more MMR. */
export function compareLadderRank(
  a: { tier: string; division: number; lp: number; mmr: number },
  b: { tier: string; division: number; lp: number; mmr: number },
): number {
  const tierA = (RANKED_TIERS as readonly string[]).includes(a.tier) ? (a.tier as RankTier) : "bronze";
  const tierB = (RANKED_TIERS as readonly string[]).includes(b.tier) ? (b.tier as RankTier) : "bronze";
  const ti = tierIndex(tierB) - tierIndex(tierA);
  if (ti !== 0) return ti;
  if (hasDivisions(tierA)) {
    const divA = Math.floor(Number(a.division)) || 3;
    const divB = Math.floor(Number(b.division)) || 3;
    if (divA !== divB) return divA - divB; // 1 (I) before 3 (III)
    const lp = Math.floor(Number(b.lp) || 0) - Math.floor(Number(a.lp) || 0);
    if (lp !== 0) return lp;
  }
  return Math.floor(Number(b.mmr) || 0) - Math.floor(Number(a.mmr) || 0);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Base LP swing scaled by how surprising the result was vs MMR. */
export function lpSwingForResult(
  ownMmr: number,
  opponentMmr: number,
  won: boolean,
  mode?: string,
): number {
  const exp = expectedScore(ownMmr, opponentMmr);
  let raw: number;
  if (won) {
    const base = 18;
    const bonus = Math.round((1 - exp) * 12);
    raw = Math.max(12, Math.min(28, base + bonus));
  } else {
    const base = 16;
    const extra = Math.round(exp * 8);
    raw = -Math.max(10, Math.min(22, base + extra));
  }
  const mul = rankedLpModeMultiplier(mode);
  const scaled = Math.round(raw * mul);
  // Keep a minimum ±LP so tiny modes still move the bar.
  if (won) return Math.max(8, scaled);
  return -Math.max(7, Math.abs(scaled));
}

/**
 * LP reward scale by arena mode — larger lobbies pay more.
 * 1v1 < 2v2 < 3v3 (battleground slightly above 3v3 when enabled).
 */
export const RANKED_LP_MODE_MUL: Readonly<Record<string, number>> = {
  arena_1v1: 0.7,
  arena_1v1v1: 0.85,
  arena_2v2: 0.85,
  arena_3v3: 1,
  battleground: 1.1,
};

export function rankedLpModeMultiplier(mode: string | undefined | null): number {
  if (!mode) return 1;
  return RANKED_LP_MODE_MUL[mode] ?? 1;
}

export type ApplyMatchInput = {
  snapshot: RankSnapshot;
  opponentAvgMmr: number;
  won: boolean;
  draw?: boolean;
  /** PvP mode id (`arena_1v1`, `arena_3v3`, …) — scales LP only. */
  mode?: string;
  /** When true, skip demotion shield (Master → Champion only path uses normal demotion). */
  forceDemote?: boolean;
};

/**
 * Apply one ranked result: Elo MMR + LP / division.
 * Caller persists and handles GM ranking separately.
 */
export function applyRankedMatchResult(input: ApplyMatchInput): RankDelta {
  const before = normalizeRankSnapshot(input.snapshot);
  let snap: RankSnapshot = { ...before, placementRemaining: 0 };

  const score: 0 | 0.5 | 1 = input.draw ? 0.5 : input.won ? 1 : 0;
  const mmrDelta = eloDelta(snap.mmr, input.opponentAvgMmr, score);
  snap.mmr = Math.max(0, snap.mmr + mmrDelta);

  if (input.won) snap.wins += 1;
  else if (!input.draw) snap.losses += 1;

  let lpDelta = 0;
  let promoted = false;
  let demoted = false;

  if (!input.draw) {
    const swing = lpSwingForResult(before.mmr, input.opponentAvgMmr, input.won, input.mode);
    const applied = applyLp(snap, swing, input.forceDemote === true);
    snap = applied.snapshot;
    // Actual LP change (demotion shield at 0 LP → 0, not the raw swing).
    lpDelta = snap.lp - before.lp;
    // Cross-division promotion/demotion: LP alone can understate the swing.
    if (applied.promoted || applied.demoted) {
      lpDelta = applied.lpDelta;
    }
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
