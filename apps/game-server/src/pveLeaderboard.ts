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
      "RLS blocks writes to pve_wave_team_bests, so the Wave Assault ladder stays empty. " +
      "Set SUPABASE_SECRET_KEY on the game-server.",
  );
}

export type PveLeaderboardRow = {
  partyKey: string;
  memberIds: string[];
  displayName: string;
  wave: number;
  kills: number;
  damageDealt: number;
  partySize: number;
  rank: number;
};

type StoredBest = {
  partyKey: string;
  memberIds: string[];
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

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function pvePartyKey(userIds: readonly string[]): string {
  return [...new Set(userIds.map((id) => id.trim()).filter(Boolean))].sort().join(",");
}

export function formatPveTeamName(names: readonly string[]): string {
  const clean = names.map((n) => n.trim() || "Hunter");
  if (clean.length <= 1) return clean[0] ?? "Hunter";
  if (clean.length === 2) return `${clean[0]} & ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} & ${clean[clean.length - 1]}`;
}

async function loadSortedBests(): Promise<StoredBest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("pve_wave_team_bests")
    .select(
      "party_key, member_ids, display_names, best_wave, best_kills, damage_dealt, party_size, updated_at",
    )
    .gt("best_wave", 0)
    .limit(2000);
  if (error) {
    console.error("[pve] load team leaderboard failed:", error.message);
    return [];
  }
  const rows: StoredBest[] = (data ?? []).map((row) => {
    const memberIds = asStringList(row.member_ids);
    const names = asStringList(row.display_names);
    return {
      partyKey: String(row.party_key ?? pvePartyKey(memberIds)),
      memberIds,
      displayName: formatPveTeamName(names.length > 0 ? names : memberIds.map(() => "Hunter")),
      wave: Math.max(0, Math.floor(Number(row.best_wave) || 0)),
      kills: Math.max(0, Math.floor(Number(row.best_kills) || 0)),
      damageDealt: Math.max(0, Math.floor(Number(row.damage_dealt) || 0)),
      partySize: Math.max(1, Math.min(4, Math.floor(Number(row.party_size) || memberIds.length || 1))),
      updatedAt: Date.parse(String(row.updated_at ?? "")) || 0,
    };
  });
  rows.sort(compareBests);
  return rows;
}

function toPublic(row: StoredBest, rank: number): PveLeaderboardRow {
  return {
    partyKey: row.partyKey,
    memberIds: row.memberIds,
    displayName: row.displayName,
    wave: row.wave,
    kills: row.kills,
    damageDealt: row.damageDealt,
    partySize: row.partySize,
    rank,
  };
}

export async function recordPveTeamBest(
  members: readonly { userId: string; displayName: string }[],
  run: { wave: number; kills: number; damageDealt: number; partySize: number },
): Promise<void> {
  if (!supabase) return;
  const wave = Math.max(0, Math.floor(run.wave));
  if (wave <= 0) return;
  const unique = new Map<string, string>();
  for (const member of members) {
    const userId = member.userId.trim();
    if (!userId) continue;
    if (!unique.has(userId)) unique.set(userId, member.displayName.trim() || "Hunter");
  }
  if (unique.size === 0) return;
  const memberIds = [...unique.keys()].sort();
  const partyKey = pvePartyKey(memberIds);
  const displayNames = memberIds.map((id) => unique.get(id) ?? "Hunter");
  const kills = Math.max(0, Math.floor(run.kills));
  const damageDealt = Math.max(0, Math.floor(run.damageDealt));
  const partySize = Math.max(1, Math.min(4, Math.floor(run.partySize) || memberIds.length || 1));

  const { data: existing, error: readErr } = await supabase
    .from("pve_wave_team_bests")
    .select("best_wave, best_kills, damage_dealt")
    .eq("party_key", partyKey)
    .maybeSingle();
  if (readErr) {
    console.error("[pve] read team best failed:", readErr.message, { partyKey });
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
    party_key: partyKey,
    member_ids: memberIds,
    display_names: displayNames,
    best_wave: wave,
    best_kills: kills,
    damage_dealt: damageDealt,
    party_size: partySize,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("pve_wave_team_bests").upsert(payload, { onConflict: "party_key" });
  if (error) {
    console.error("[pve] upsert team best failed:", error.message, { partyKey, wave, kills });
  }
}

export async function getPveHubState(userId: string | null): Promise<{
  rows: PveLeaderboardRow[];
  mine: PveLeaderboardRow | null;
}> {
  const all = await loadSortedBests();
  const rows = all.slice(0, 100).map((row, i) => toPublic(row, i + 1));
  if (!userId) return { rows, mine: null };
  const idx = all.findIndex((row) => row.memberIds.includes(userId));
  return {
    rows,
    mine: idx >= 0 ? toPublic(all[idx]!, idx + 1) : null,
  };
}
