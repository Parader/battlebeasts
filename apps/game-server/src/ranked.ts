import {
  MMR_MIDPOINT,
  SEASON_TIER_REWARD_KEYS,
  applyRankedMatchResult,
  compareLadderRank,
  emptyRankSnapshot,
  formatRankLabel,
  normalizeRankSnapshot,
  softResetMmr,
  maxPeakTier,
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

const usingPublishableKey =
  Boolean(serverKey) &&
  !process.env.SUPABASE_SECRET_KEY &&
  Boolean(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY);

if (usingPublishableKey) {
  console.warn(
    "[ranked] SUPABASE_SECRET_KEY missing — using anon/publishable key. " +
      "RLS blocks writes to player_ratings, so everyone stays Bronze 0 LP. " +
      "Set SUPABASE_SECRET_KEY on the game-server.",
  );
}

export type SeasonRow = {
  id: string;
  slug: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
};

export type RankedPlayerResult = {
  userId: string;
  team: "a" | "b" | "c" | "";
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
  gmRank?: number | null;
}): RankSnapshot {
  return normalizeRankSnapshot({
    mmr: row.mmr,
    lp: row.lp,
    tier: row.tier as RankSnapshot["tier"],
    division: row.division,
    wins: row.wins,
    losses: row.losses,
    placementRemaining: row.placement_remaining,
    peakTier: row.peak_tier as RankSnapshot["peakTier"],
    gmRank: row.gmRank ?? null,
  });
}

async function gmLadderPosition(
  seasonId: string,
  userId: string,
  tier: string,
): Promise<number | null> {
  if (!supabase || tier !== "grandmaster") return null;
  const { data } = await supabase
    .from("player_ratings")
    .select("user_id")
    .eq("season_id", seasonId)
    .eq("tier", "grandmaster")
    .order("mmr", { ascending: false })
    .limit(200);
  const idx = (data ?? []).findIndex((r) => r.user_id === userId);
  return idx >= 0 ? idx + 1 : null;
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
  const { data: existing, error: selectErr } = await supabase
    .from("player_ratings")
    .select("*")
    .eq("user_id", userId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (selectErr) {
    console.warn("[ranked] ensurePlayerRating select failed:", selectErr.message, {
      userId,
      seasonId,
    });
  }
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
  const { error: insertErr } = await supabase.from("player_ratings").insert({
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
  if (insertErr) {
    // Race: another writer inserted — re-read.
    console.warn("[ranked] ensurePlayerRating insert:", insertErr.message, { userId, seasonId });
    const { data: again } = await supabase
      .from("player_ratings")
      .select("*")
      .eq("user_id", userId)
      .eq("season_id", seasonId)
      .maybeSingle();
    if (again) return rowToSnapshot(again);
    console.error(
      "[ranked] ensurePlayerRating could not create row — ratings will stick at Bronze 0 LP. " +
        "Check SUPABASE_SECRET_KEY (service role) on the game-server.",
    );
  }
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
  let rating = await ensurePlayerRating(userId, season.id);
  if (rating.tier === "grandmaster") {
    const gmRank = await gmLadderPosition(season.id, userId, rating.tier);
    rating = { ...rating, gmRank };
  }
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

  // Pull a season pool, then sort by visible ladder (not hidden MMR).
  const { data } = await supabase
    .from("player_ratings")
    .select("user_id, mmr, lp, tier, division, profiles(display_name)")
    .eq("season_id", season.id)
    .limit(Math.max(limit * 5, 500));

  const rows = (data ?? []).map((row) => {
    const profiles = row.profiles as { display_name?: string } | { display_name?: string }[] | null;
    const name = Array.isArray(profiles)
      ? profiles[0]?.display_name
      : profiles?.display_name;
    return {
      userId: row.user_id as string,
      displayName: name ?? "Hunter",
      mmr: Number(row.mmr) || 0,
      lp: Number(row.lp) || 0,
      tier: String(row.tier ?? "bronze"),
      division: Number(row.division) || 0,
      rank: 0,
    };
  });

  rows.sort(compareLadderRank);
  return rows.slice(0, limit).map((row, i) => ({ ...row, rank: i + 1 }));
}

async function persistSnapshot(
  userId: string,
  seasonId: string,
  snap: RankSnapshot,
  careerPeak: RankTier,
): Promise<boolean> {
  if (!supabase) return false;
  const peak =
    typeof careerPeak === "string" && careerPeak.length > 0 ? careerPeak : snap.peakTier;
  const payload = {
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
    career_peak_tier: peak,
    updated_at: new Date().toISOString(),
  };

  // Prefer explicit update → insert so we never depend on upsert+returning quirks.
  const { data: updated, error: updateErr } = await supabase
    .from("player_ratings")
    .update(payload)
    .eq("user_id", userId)
    .eq("season_id", seasonId)
    .select("lp, tier, division, wins, losses")
    .maybeSingle();

  if (updateErr) {
    console.error("[ranked] persistSnapshot update failed:", updateErr.message, {
      userId,
      seasonId,
    });
  } else if (updated) {
    return true;
  }

  const { error: insertErr } = await supabase.from("player_ratings").insert(payload);
  if (insertErr) {
    // Concurrent insert — try update once more.
    const { data: again, error: againErr } = await supabase
      .from("player_ratings")
      .update(payload)
      .eq("user_id", userId)
      .eq("season_id", seasonId)
      .select("lp")
      .maybeSingle();
    if (againErr || !again) {
      console.error("[ranked] persistSnapshot insert/update failed:", insertErr.message, {
        userId,
        seasonId,
        tier: snap.tier,
        lp: snap.lp,
      });
      return false;
    }
  }

  const { data: verify, error: verifyErr } = await supabase
    .from("player_ratings")
    .select("lp, tier, division")
    .eq("user_id", userId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (verifyErr || !verify) {
    console.error("[ranked] persistSnapshot verify failed:", verifyErr?.message, {
      userId,
      seasonId,
    });
    return false;
  }
  if (
    Number(verify.lp) !== snap.lp ||
    String(verify.tier) !== snap.tier ||
    Number(verify.division) !== snap.division
  ) {
    console.error("[ranked] persistSnapshot verify mismatch", {
      userId,
      seasonId,
      expected: { lp: snap.lp, tier: snap.tier, division: snap.division },
      got: verify,
    });
    return false;
  }
  return true;
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
  winner: "a" | "b" | "c" | "draw";
  players: Array<{ userId: string; team: "a" | "b" | "c" | "" }>;
};

/** Idempotent ranked rating update for a finished match. No-op for custom. */
export async function applyRankedMatchFinish(
  args: FinishRankedMatchArgs,
): Promise<{ results: RankedPlayerResult[]; persisted: boolean }> {
  if (args.kind !== "ranked") return { results: [], persisted: true };
  if (!supabase) {
    console.warn("[ranked] skip finish — Supabase not configured");
    return { results: [], persisted: false };
  }

  const season = await getActiveSeason();
  if (!season) {
    console.warn("[ranked] skip finish — no active season");
    return { results: [], persisted: false };
  }

  const fighters = args.players.filter(
    (p) => p.userId && (p.team === "a" || p.team === "b" || p.team === "c"),
  );
  if (fighters.length === 0) {
    console.warn("[ranked] skip finish — no fighter userIds", { matchId: args.matchId });
    return { results: [], persisted: false };
  }

  const { data: existing } = await supabase
    .from("ranked_matches")
    .select("match_id")
    .eq("match_id", args.matchId)
    .maybeSingle();
  if (existing) {
    const stored = await loadStoredMatchResults(args.matchId, fighters);
    // Repair drift: match was locked but player_ratings never updated (legacy failed persists).
    if (stored.length > 0) {
      for (const r of stored) {
        const live = await ensurePlayerRating(r.userId, season.id);
        const drifted =
          live.lp !== r.delta.after.lp ||
          live.tier !== r.delta.after.tier ||
          live.division !== r.delta.after.division ||
          live.mmr !== r.delta.after.mmr;
        if (drifted) {
          console.warn("[ranked] repairing drifted rating from match history", {
            matchId: args.matchId,
            userId: r.userId,
            live,
            after: r.delta.after,
          });
          // Match history rows don't store career W/L — keep live wins/losses.
          await persistSnapshot(
            r.userId,
            season.id,
            {
              ...live,
              lp: r.delta.after.lp,
              mmr: r.delta.after.mmr,
              tier: r.delta.after.tier,
              division: r.delta.after.division,
              peakTier: maxPeakTier(live.peakTier, r.delta.after.tier),
            },
            maxPeakTier(live.peakTier, r.delta.after.peakTier),
          );
        }
      }
    }
    return { results: stored, persisted: true };
  }

  const teamA = fighters.filter((p) => p.team === "a");
  const teamB = fighters.filter((p) => p.team === "b");
  const teamC = fighters.filter((p) => p.team === "c");
  const ffa = teamC.length > 0;

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
  const avgC = avg(teamC);

  const opponentAvgFor = (team: "a" | "b" | "c"): number => {
    if (ffa) {
      if (team === "a") return (avgB + avgC) / 2;
      if (team === "b") return (avgA + avgC) / 2;
      return (avgA + avgB) / 2;
    }
    return team === "a" ? avgB : avgA;
  };

  const results: RankedPlayerResult[] = [];
  const playerRows: Record<string, unknown>[] = [];
  let persistFailed = false;

  for (const p of fighters) {
    const before = await ensurePlayerRating(p.userId, season.id);
    const team = p.team as "a" | "b" | "c";
    const opponentAvg = opponentAvgFor(team);
    const draw = args.winner === "draw";
    const won = !draw && args.winner === team;
    const delta = applyRankedMatchResult({
      snapshot: before,
      opponentAvgMmr: opponentAvg,
      won,
      draw,
      mode: args.mode,
    });

    const { data: prior } = await supabase
      .from("player_ratings")
      .select("career_peak_tier")
      .eq("user_id", p.userId)
      .eq("season_id", season.id)
      .maybeSingle();
    // maxPeakTier (not tierAtLeast — that returns boolean and breaks the CHECK constraint).
    const careerPeak = maxPeakTier(
      (prior?.career_peak_tier as RankTier) ?? "bronze",
      delta.after.peakTier,
    );

    const saved = await persistSnapshot(p.userId, season.id, delta.after, careerPeak);
    if (!saved) {
      persistFailed = true;
      console.error("[ranked] persist failed for fighter — will still show recap LP", {
        matchId: args.matchId,
        userId: p.userId,
        lpDelta: delta.lpDelta,
      });
    } else {
      await maybeClaimSeasonTier(p.userId, season.id, delta.before, delta.after);
    }

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

  // Always return deltas for match recap UI. Only lock the match when every
  // rating row persisted — otherwise a rematch/retry can repair.
  if (persistFailed) {
    console.error("[ranked] abort match lock — persist failed; match will NOT be locked", {
      matchId: args.matchId,
    });
    return { results, persisted: false };
  }

  const { error: matchErr } = await supabase.from("ranked_matches").insert({
    match_id: args.matchId,
    season_id: season.id,
    mode: args.mode,
    kind: args.kind,
    winner: args.winner,
  });
  if (matchErr) {
    // Race: another writer won — return whatever they stored.
    console.warn("[ranked] match insert", matchErr.message);
    return {
      results: await loadStoredMatchResults(args.matchId, fighters),
      persisted: true,
    };
  }

  if (playerRows.length) {
    const { error: playersErr } = await supabase.from("ranked_match_players").insert(playerRows);
    if (playersErr) {
      console.warn("[ranked] match players insert", playersErr.message);
    }
  }

  // Refresh GM top-N assignment by MMR among masters+.
  await refreshGrandmasters(season.id);

  return { results, persisted: true };
}

async function loadStoredMatchResults(
  matchId: string,
  fighters: Array<{ userId: string; team: "a" | "b" | "c" | "" }>,
): Promise<RankedPlayerResult[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("ranked_match_players")
    .select("*")
    .eq("match_id", matchId);
  if (!data?.length) return [];

  const byUser = new Map(data.map((row) => [row.user_id as string, row]));
  const out: RankedPlayerResult[] = [];
  for (const p of fighters) {
    const row = byUser.get(p.userId);
    if (!row) continue;
    const before = normalizeRankSnapshot({
      mmr: Number(row.mmr_before) || MMR_MIDPOINT,
      lp: Number(row.lp_before) || 0,
      tier: String(row.tier_before || "bronze") as RankTier,
      division: Number(row.division_before) || 3,
      wins: 0,
      losses: 0,
      placementRemaining: 0,
      peakTier: String(row.tier_before || "bronze") as RankTier,
      gmRank: null,
    });
    const after = normalizeRankSnapshot({
      mmr: Number(row.mmr_after) || before.mmr,
      lp: Number(row.lp_after) || 0,
      tier: String(row.tier_after || before.tier) as RankTier,
      division: Number(row.division_after) || before.division,
      wins: before.wins,
      losses: before.losses,
      placementRemaining: 0,
      peakTier: String(row.tier_after || before.tier) as RankTier,
      gmRank: null,
    });
    const lpDelta = Number(row.lp_delta) || after.lp - before.lp;
    const mmrDelta = Number(row.mmr_delta) || after.mmr - before.mmr;
    out.push({
      userId: p.userId,
      team: p.team,
      delta: {
        before,
        after,
        mmrDelta,
        lpDelta,
        promoted:
          before.tier !== after.tier ||
          (before.division !== after.division && after.division < before.division),
        demoted:
          before.tier !== after.tier ||
          (before.division !== after.division && after.division > before.division),
      },
      label: formatRankLabel(after),
    });
  }
  return out;
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
