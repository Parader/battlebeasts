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
    "[pve] SUPABASE_SECRET_KEY missing — using anon/publishable key. " +
      "RLS blocks writes to pve_wave_bests, so the Wave Assault ladder stays empty. " +
      "Set SUPABASE_SECRET_KEY on the game-server.",
  );
}

export type PveLeaderboardRow = {
  userId: string;
  displayName: string;
  wave: number;
  kills: number;
  damageDealt: number;
  partySize: number;
  rank: number;
};

type StoredBest = {
  userId: string;
  displayName: string;
  wave: number;
  kills: number;
  damageDealt: number;
  partySize: number;
  updatedAt: number;
};

function isBetter(
  next: { wave: number; kills: number; damageDealt: number },
  prev: { wave: number; kills: number; damageDealt: number },
): boolean {
  if (next.wave !== prev.wave) return next.wave > prev.wave;
  if (next.kills !== prev.kills) return next.kills > prev.kills;
  return next.damageDealt > prev.damageDealt;
}

function compareBests(a: StoredBest, b: StoredBest): number {
  if (b.wave !== a.wave) return b.wave - a.wave;
  if (b.kills !== a.kills) return b.kills - a.kills;
  if (b.damageDealt !== a.damageDealt) return b.damageDealt - a.damageDealt;
  return a.updatedAt - b.updatedAt;
}

function profileName(
  profiles: { display_name?: string } | { display_name?: string }[] | null,
): string {
  const name = Array.isArray(profiles) ? profiles[0]?.display_name : profiles?.display_name;
  return name?.trim() || "Hunter";
}

async function loadSortedBests(): Promise<StoredBest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("pve_wave_bests")
    .select("user_id, best_wave, best_kills, damage_dealt, party_size, updated_at, profiles(display_name)")
    .gt("best_wave", 0)
    .limit(2000);
  if (error) {
    console.error("[pve] load leaderboard failed:", error.message);
    return [];
  }
  const rows: StoredBest[] = (data ?? []).map((row) => ({
    userId: row.user_id as string,
    displayName: profileName(
      row.profiles as { display_name?: string } | { display_name?: string }[] | null,
    ),
    wave: Math.max(0, Math.floor(Number(row.best_wave) || 0)),
    kills: Math.max(0, Math.floor(Number(row.best_kills) || 0)),
    damageDealt: Math.max(0, Math.floor(Number(row.damage_dealt) || 0)),
    partySize: Math.max(1, Math.min(4, Math.floor(Number(row.party_size) || 1))),
    updatedAt: Date.parse(String(row.updated_at ?? "")) || 0,
  }));
  rows.sort(compareBests);
  return rows;
}

function toPublic(row: StoredBest, rank: number): PveLeaderboardRow {
  return {
    userId: row.userId,
    displayName: row.displayName,
    wave: row.wave,
    kills: row.kills,
    damageDealt: row.damageDealt,
    partySize: row.partySize,
    rank,
  };
}

export async function recordPveWaveBest(
  userId: string,
  run: { wave: number; kills: number; damageDealt: number; partySize: number },
): Promise<void> {
  if (!supabase || !userId) return;
  const wave = Math.max(0, Math.floor(run.wave));
  if (wave <= 0) return;
  const kills = Math.max(0, Math.floor(run.kills));
  const damageDealt = Math.max(0, Math.floor(run.damageDealt));
  const partySize = Math.max(1, Math.min(4, Math.floor(run.partySize) || 1));

  const { data: existing, error: readErr } = await supabase
    .from("pve_wave_bests")
    .select("best_wave, best_kills, damage_dealt")
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) {
    console.error("[pve] read best failed:", readErr.message, { userId });
    return;
  }
  if (
    existing &&
    !isBetter(
      { wave, kills, damageDealt },
      {
        wave: Number(existing.best_wave) || 0,
        kills: Number(existing.best_kills) || 0,
        damageDealt: Number(existing.damage_dealt) || 0,
      },
    )
  ) {
    return;
  }

  const payload = {
    user_id: userId,
    best_wave: wave,
    best_kills: kills,
    damage_dealt: damageDealt,
    party_size: partySize,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("pve_wave_bests").upsert(payload, { onConflict: "user_id" });
  if (error) {
    console.error("[pve] upsert best failed:", error.message, { userId, wave, kills });
  }
}

export async function getPveHubState(userId: string | null): Promise<{
  rows: PveLeaderboardRow[];
  mine: PveLeaderboardRow | null;
}> {
  const all = await loadSortedBests();
  const rows = all.slice(0, 100).map((row, i) => toPublic(row, i + 1));
  if (!userId) return { rows, mine: null };
  const idx = all.findIndex((row) => row.userId === userId);
  return {
    rows,
    mine: idx >= 0 ? toPublic(all[idx]!, idx + 1) : null,
  };
}
