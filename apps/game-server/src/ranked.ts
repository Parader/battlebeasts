import {
  MMR_MIDPOINT,
  SEASON_TIER_REWARD_KEYS,
  applyRankedMatchResult,
  emptyRankSnapshot,
  formatRankLabel,
  softResetMmr,
  tierAtLeast,
  type MatchKind,
  type RankDelta,
  type RankSnapshot,
  type RankTier,
} from "@battlebeasts/shared";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serverKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = url && serverKey ? createClient(url, serverKey) : null;

export type SeasonRow = {
  id: string;
  slug: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
};

export type RankedPlayerResult = {
  userId: string;
  team: "a" | "b" | "";
  delta: RankDelta;
  label: string;
};

function rowToSnapshot(row: {
  mmr: number;
  lp: number;
  tier: string;
  division: number;
  wins: number;
  losses: number;
  placement_remaining: number;
  peak_tier: string;
}): RankSnapshot {
  return {
    mmr: row.mmr,
    lp: row.lp,
    tier: row.tier as RankSnapshot["tier"],
    division: row.division,
    wins: row.wins,
    losses: row.losses,
    placementRemaining: row.placement_remaining,
    peakTier: row.peak_tier as RankSnapshot["peakTier"],
    gmRank: null,
  };
}

export async function getActiveSeason(): Promise<SeasonRow | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("ranked_seasons")
    .select("id, slug, starts_at, ends_at, status")
    .eq("status", "active")
    .maybeSingle();
  return data ?? null;
}

export async function ensurePlayerRating(
  userId: string,
  seasonId: string,
): Promise<RankSnapshot> {
  if (!supabase) return emptyRankSnapshot();
  const { data: existing } = await supabase
    .from("player_ratings")
    .select("*")
    .eq("user_id", userId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (existing) {
    const snap = rowToSnapshot(existing);
    // Placement matches removed — clear leftover DB countdown so LP UI/awards work.
    if (snap.placementRemaining !== 0) {
      snap.placementRemaining = 0;
      await supabase
        .from("player_ratings")
        .update({ placement_remaining: 0, updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("season_id", seasonId);
    }
    return snap;
  }

  const blank = emptyRankSnapshot(MMR_MIDPOINT);
  await supabase.from("player_ratings").insert({
    user_id: userId,
    season_id: seasonId,
    mmr: blank.mmr,
    lp: blank.lp,
    tier: blank.tier,
    division: blank.division,
    wins: blank.wins,
    losses: blank.losses,
    placement_remaining: 0,
    peak_tier: blank.peakTier,
    career_peak_tier: blank.peakTier,
  });
  return blank;
}

export async function getPlayerMmrs(
  userIds: string[],
  seasonId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of userIds) out.set(id, MMR_MIDPOINT);
  if (!supabase || userIds.length === 0) return out;

  const { data } = await supabase
    .from("player_ratings")
    .select("user_id, mmr")
    .eq("season_id", seasonId)
    .in("user_id", userIds);

  for (const row of data ?? []) {
    out.set(row.user_id as string, row.mmr as number);
  }

  // Ensure missing rows exist asynchronously (avg uses midpoint until first load).
  for (const id of userIds) {
    if (!(data ?? []).some((r) => r.user_id === id)) {
      void ensurePlayerRating(id, seasonId);
    }
  }
  return out;
}

export async function getHubRankedState(userId: string): Promise<{
  season: SeasonRow | null;
  rating: RankSnapshot | null;
  label: string | null;
} | null> {
  const season = await getActiveSeason();
  if (!season) return { season: null, rating: null, label: null };
  const rating = await ensurePlayerRating(userId, season.id);
  return { season, rating, label: formatRankLabel(rating) };
}

export async function getRankedLeaderboard(limit = 100): Promise<
  Array<{
    userId: string;
    displayName: string;
    mmr: number;
    lp: number;
    tier: string;
    division: number;
    rank: number;
  }>
> {
  if (!supabase) return [];
  const season = await getActiveSeason();
  if (!season) return [];

  const { data } = await supabase
    .from("player_ratings")
    .select("user_id, mmr, lp, tier, division, profiles(display_name)")
    .eq("season_id", season.id)
    .order("mmr", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row, i) => {
    const profiles = row.profiles as { display_name?: string } | { display_name?: string }[] | null;
    const name = Array.isArray(profiles)
      ? profiles[0]?.display_name
      : profiles?.display_name;
    return {
      userId: row.user_id as string,
      displayName: name ?? "Hunter",
      mmr: row.mmr as number,
      lp: row.lp as number,
      tier: row.tier as string,
      division: row.division as number,
      rank: i + 1,
    };
  });
}

async function persistSnapshot(
  userId: string,
  seasonId: string,
  snap: RankSnapshot,
  careerPeak: RankTier,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("player_ratings").upsert({
    user_id: userId,
    season_id: seasonId,
    mmr: snap.mmr,
    lp: snap.lp,
    tier: snap.tier,
    division: snap.division,
    wins: snap.wins,
    losses: snap.losses,
    placement_remaining: 0,
    peak_tier: snap.peakTier,
    career_peak_tier: careerPeak,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[ranked] persistSnapshot failed:", error.message, { userId, seasonId });
  }
}

async function maybeClaimSeasonTier(
  userId: string,
  seasonId: string,
  before: RankSnapshot,
  after: RankSnapshot,
): Promise<void> {
  if (!supabase) return;
  for (const { tier, key } of SEASON_TIER_REWARD_KEYS) {
    if (!tierAtLeast(after.tier, tier)) continue;
    if (tierAtLeast(before.tier, tier)) continue;
    const { error } = await supabase.from("season_reward_claims").insert({
      user_id: userId,
      season_id: seasonId,
      reward_key: key,
    });
    if (error) continue; // already claimed
    const quality =
      tier === "master" ? "legendary" : tier === "champion" ? "purple" : tier === "diamond" ? "purple" : "blue";
    await supabase.from("chests").insert({
      user_id: userId,
      quality,
      source: `ranked_season:${seasonId}:${key}`,
      status: "closed",
    });
  }
}

export type FinishRankedMatchArgs = {
  matchId: string;
  mode: string;
  kind: MatchKind;
  winner: "a" | "b" | "draw";
  players: Array<{ userId: string; team: "a" | "b" | "" }>;
};

/** Idempotent ranked rating update for a finished match. No-op for custom. */
export async function applyRankedMatchFinish(
  args: FinishRankedMatchArgs,
): Promise<RankedPlayerResult[]> {
  if (args.kind !== "ranked") return [];
  if (!supabase) {
    console.warn("[ranked] skip finish — Supabase not configured");
    return [];
  }

  const season = await getActiveSeason();
  if (!season) {
    console.warn("[ranked] skip finish — no active season");
    return [];
  }

  const { data: existing } = await supabase
    .from("ranked_matches")
    .select("match_id")
    .eq("match_id", args.matchId)
    .maybeSingle();
  if (existing) {
    // Already processed — return empty (client may have cached deltas from first finish).
    return [];
  }

  const fighters = args.players.filter((p) => p.team === "a" || p.team === "b");
  const teamA = fighters.filter((p) => p.team === "a");
  const teamB = fighters.filter((p) => p.team === "b");

  const mmrs = await getPlayerMmrs(
    fighters.map((p) => p.userId),
    season.id,
  );
  const avg = (ids: typeof fighters) => {
    if (ids.length === 0) return MMR_MIDPOINT;
    return ids.reduce((s, p) => s + (mmrs.get(p.userId) ?? MMR_MIDPOINT), 0) / ids.length;
  };
  const avgA = avg(teamA);
  const avgB = avg(teamB);

  const results: RankedPlayerResult[] = [];
  const playerRows: Record<string, unknown>[] = [];

  for (const p of fighters) {
    const before = await ensurePlayerRating(p.userId, season.id);
    const opponentAvg = p.team === "a" ? avgB : avgA;
    const won =
      args.winner === "draw" ? false : (args.winner === "a" && p.team === "a") || (args.winner === "b" && p.team === "b");
    const draw = args.winner === "draw";
    const delta = applyRankedMatchResult({
      snapshot: before,
      opponentAvgMmr: opponentAvg,
      won,
      draw,
    });

    const { data: prior } = await supabase
      .from("player_ratings")
      .select("career_peak_tier")
      .eq("user_id", p.userId)
      .eq("season_id", season.id)
      .maybeSingle();
    const careerPeak = tierAtLeast(
      (prior?.career_peak_tier as RankTier) ?? "bronze",
      delta.after.peakTier,
    );

    await persistSnapshot(p.userId, season.id, delta.after, careerPeak);
    await maybeClaimSeasonTier(p.userId, season.id, delta.before, delta.after);

    results.push({
      userId: p.userId,
      team: p.team,
      delta,
      label: formatRankLabel(delta.after),
    });

    playerRows.push({
      match_id: args.matchId,
      user_id: p.userId,
      team: p.team,
      won: draw ? null : won,
      mmr_before: delta.before.mmr,
      mmr_after: delta.after.mmr,
      mmr_delta: delta.mmrDelta,
      lp_before: delta.before.lp,
      lp_after: delta.after.lp,
      lp_delta: delta.lpDelta,
      tier_before: delta.before.tier,
      tier_after: delta.after.tier,
      division_before: delta.before.division,
      division_after: delta.after.division,
    });
  }

  const { error: matchErr } = await supabase.from("ranked_matches").insert({
    match_id: args.matchId,
    season_id: season.id,
    mode: args.mode,
    kind: args.kind,
    winner: args.winner,
  });
  if (matchErr) {
    // Race: another writer won — treat as already processed.
    console.warn("[ranked] match insert", matchErr.message);
    return [];
  }

  if (playerRows.length) {
    await supabase.from("ranked_match_players").insert(playerRows);
  }

  // Refresh GM top-N assignment by MMR among masters+.
  await refreshGrandmasters(season.id);

  return results;
}

async function refreshGrandmasters(seasonId: string): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase
    .from("player_ratings")
    .select("user_id, mmr, tier")
    .eq("season_id", seasonId)
    .in("tier", ["master", "grandmaster"])
    .order("mmr", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const tier = i < 100 ? "grandmaster" : "master";
    await supabase
      .from("player_ratings")
      .update({ tier, division: 0, updated_at: new Date().toISOString() })
      .eq("user_id", row.user_id)
      .eq("season_id", seasonId);
  }
}

/** Soft-reset tooling: end season + seed next with compressed MMR. */
export async function softResetIntoNewSeason(newSlug: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "No supabase" };
  const current = await getActiveSeason();
  if (!current) return { ok: false, error: "No active season" };

  const { data: ratings } = await supabase
    .from("player_ratings")
    .select("*")
    .eq("season_id", current.id);

  await supabase
    .from("ranked_seasons")
    .update({ status: "ended", ends_at: new Date().toISOString() })
    .eq("id", current.id);

  const { data: next, error } = await supabase
    .from("ranked_seasons")
    .insert({ slug: newSlug, starts_at: new Date().toISOString(), status: "active" })
    .select("id")
    .single();
  if (error || !next) return { ok: false, error: error?.message ?? "insert failed" };

  for (const row of ratings ?? []) {
    const mmr = softResetMmr(row.mmr as number);
    await supabase.from("player_ratings").insert({
      user_id: row.user_id,
      season_id: next.id,
      mmr,
      lp: 0,
      tier: "bronze",
      division: 3,
      wins: 0,
      losses: 0,
      placement_remaining: 0,
      peak_tier: "bronze",
      career_peak_tier: row.career_peak_tier,
    });
  }
  return { ok: true };
}
