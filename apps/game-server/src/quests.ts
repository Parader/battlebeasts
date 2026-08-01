import {
  QUEST_CATALOG,
  getQuestDef,
  questIdsWithPrefix,
  questPeriodKey,
  rollChestLoot,
  rollQuestChestQuality,
  rewardRollSalt,
  type ChestLootLine,
  type ChestLootResult,
  type ChestOwnedSnapshot,
  type ChestQuality,
  type ChestUnlockGrant,
} from "@battlebeasts/shared";
import { createClient } from "@supabase/supabase-js";
import { getActiveSeason } from "./ranked.js";

const url = process.env.SUPABASE_URL;
const serverKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = url && serverKey ? createClient(url, serverKey) : null;

export type QuestEvent =
  | { type: "pvp_win" }
  | { type: "pvp_mode"; mode: string }
  | { type: "pvp_match_completed" }
  | { type: "ranked_match_completed" }
  | { type: "ranked_win" }
  | { type: "ranked_tier_reached"; tier: string }
  | { type: "ranked_placement_done" }
  | { type: "essence_earned"; amount: number }
  | { type: "copper_earned"; amount: number }
  | { type: "spell_unlocked"; totalOwned: number }
  | { type: "talent_points_spent"; totalSpent: number }
  | { type: "friend_code_redeemed" }
  | { type: "friend_referral_credited" };

async function grantChest(userId: string, quality: ChestQuality, source: string) {
  if (!supabase) return;
  await supabase.from("chests").insert({
    user_id: userId,
    quality,
    source,
    status: "closed",
  });
}

/** Insert a closed chest for a user (admin / quest reward). */
export async function insertClosedChest(
  userId: string,
  quality: ChestQuality,
  source: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || userId.startsWith("guest_")) {
    return { ok: false, error: "Unavailable" };
  }
  const { error } = await supabase.from("chests").insert({
    user_id: userId,
    quality,
    source,
    status: "closed",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const DISTINCT_PVP_MODES = new Set(["arena_1v1", "arena_2v2", "arena_3v3"]);

async function bumpOne(
  userId: string,
  questId: string,
  delta: number,
  absolute?: boolean,
): Promise<void> {
  if (!supabase || userId.startsWith("guest_")) return;
  const def = getQuestDef(questId);
  if (!def) return;
  const seasonId = def.type === "season" ? (await getActiveSeason())?.id ?? null : null;
  const period = questPeriodKey(def, new Date(), seasonId);
  const { data: row } = await supabase
    .from("quest_progress")
    .select("progress, completed_at, meta")
    .eq("user_id", userId)
    .eq("quest_id", questId)
    .eq("period_key", period)
    .maybeSingle();

  if (row?.completed_at) return;

  const prev = row?.progress ?? 0;
  const next = absolute ? Math.max(prev, delta) : prev + delta;
  const completed = next >= def.target;
  await supabase.from("quest_progress").upsert(
    {
      user_id: userId,
      quest_id: questId,
      period_key: period,
      progress: Math.min(next, def.target),
      completed_at: completed ? new Date().toISOString() : null,
      meta: row?.meta ?? {},
    },
    { onConflict: "user_id,quest_id,period_key" },
  );

  if (completed && !row?.completed_at) {
    const quality = rollQuestChestQuality(
      def.chest,
      rewardRollSalt(userId, questId, period),
    );
    await grantChest(userId, quality, `quest:${questId}:${period}`);
  }
}

/** Count distinct arena modes once each toward daily_modes_3. */
async function bumpDistinctPvpMode(userId: string, mode: string): Promise<void> {
  if (!supabase || userId.startsWith("guest_")) return;
  if (!DISTINCT_PVP_MODES.has(mode)) return;
  const questId = "daily_modes_3";
  const def = getQuestDef(questId);
  if (!def) return;
  const period = questPeriodKey(def, new Date(), null);
  const { data: row } = await supabase
    .from("quest_progress")
    .select("progress, completed_at, meta")
    .eq("user_id", userId)
    .eq("quest_id", questId)
    .eq("period_key", period)
    .maybeSingle();

  if (row?.completed_at) return;

  const meta =
    row?.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  const prevModes = Array.isArray(meta.modes)
    ? meta.modes.filter((m): m is string => typeof m === "string")
    : [];
  if (prevModes.includes(mode)) return;

  const modes = [...prevModes, mode];
  const next = Math.min(modes.length, def.target);
  const completed = next >= def.target;
  await supabase.from("quest_progress").upsert(
    {
      user_id: userId,
      quest_id: questId,
      period_key: period,
      progress: next,
      completed_at: completed ? new Date().toISOString() : null,
      meta: { ...meta, modes },
    },
    { onConflict: "user_id,quest_id,period_key" },
  );

  if (completed && !row?.completed_at) {
    const quality = rollQuestChestQuality(
      def.chest,
      rewardRollSalt(userId, questId, period),
    );
    await grantChest(userId, quality, `quest:${questId}:${period}`);
  }
}

async function bumpPrefix(
  userId: string,
  prefix: string,
  delta: number,
  absolute?: boolean,
): Promise<void> {
  for (const id of questIdsWithPrefix(prefix)) {
    await bumpOne(userId, id, delta, absolute);
  }
}

/** Apply quest progress for a gameplay event. Fire-and-forget safe. */
export async function bumpQuest(userId: string, event: QuestEvent): Promise<void> {
  if (!supabase || !userId || userId.startsWith("guest_")) return;
  try {
    switch (event.type) {
      case "pvp_win":
        await bumpOne(userId, "daily_win_3", 1);
        break;
      case "pvp_mode":
        await bumpDistinctPvpMode(userId, event.mode);
        break;
      case "pvp_match_completed":
        await bumpOne(userId, "once_first_pvp", 1);
        break;
      case "ranked_match_completed":
        await bumpOne(userId, "daily_ranked_play_2", 1);
        break;
      case "ranked_win":
        await bumpOne(userId, "daily_ranked_win_2", 1);
        await bumpOne(userId, "daily_win_3", 1);
        await bumpPrefix(userId, "season_ranked_wins_", 1);
        await bumpPrefix(userId, "life_ranked_wins_", 1);
        break;
      case "ranked_placement_done":
        await bumpOne(userId, "season_placement_done", 1);
        break;
      case "ranked_tier_reached": {
        const map: Record<string, string> = {
          silver: "season_reach_silver",
          gold: "season_reach_gold",
          diamond: "season_reach_diamond",
          champion: "season_reach_champion",
          master: "season_reach_master",
        };
        const seasonQuest = map[event.tier];
        if (seasonQuest) await bumpOne(userId, seasonQuest, 1);
        const peakMap: Record<string, string> = {
          gold: "life_peak_gold",
          diamond: "life_peak_diamond",
          champion: "life_peak_champion",
          master: "life_peak_master",
          grandmaster: "life_peak_gm",
        };
        const peakQuest = peakMap[event.tier];
        if (peakQuest) await bumpOne(userId, peakQuest, 1);
        break;
      }
      case "essence_earned":
        if (event.amount <= 0) break;
        await bumpPrefix(userId, "life_essence_", event.amount);
        break;
      case "copper_earned":
        if (event.amount <= 0) break;
        await bumpPrefix(userId, "life_copper_", event.amount);
        break;
      case "spell_unlocked":
        await bumpPrefix(userId, "life_spells_", event.totalOwned, true);
        break;
      case "talent_points_spent":
        await bumpPrefix(userId, "life_talents_", event.totalSpent, true);
        break;
      case "friend_code_redeemed":
        await bumpOne(userId, "once_friend_code", 1);
        break;
      case "friend_referral_credited":
        await bumpOne(userId, "once_friend_code", 1);
        await bumpOne(userId, "once_friends_5", 1);
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn("[quests] bumpQuest", err);
  }
}

export async function listQuestProgress(userId: string) {
  if (!supabase || userId.startsWith("guest_")) return [];
  const seasonId = (await getActiveSeason())?.id ?? null;
  const periods = new Set(QUEST_CATALOG.map((q) => questPeriodKey(q, new Date(), seasonId)));
  const { data } = await supabase
    .from("quest_progress")
    .select("quest_id, period_key, progress, completed_at")
    .eq("user_id", userId)
    .in("period_key", [...periods]);
  return data ?? [];
}

export async function listClosedChests(userId: string) {
  if (!supabase || userId.startsWith("guest_")) return [];
  const { data } = await supabase
    .from("chests")
    .select("id, quality, source, created_at")
    .eq("user_id", userId)
    .eq("status", "closed")
    .order("created_at", { ascending: true });
  return data ?? [];
}

export type OpenChestResult = {
  ok: boolean;
  essence?: number;
  copper?: number;
  quality?: ChestQuality;
  lines?: ChestLootLine[];
  grants?: ChestUnlockGrant[];
  error?: string;
};

/** Mark chest opened with a precomputed loot payload (rolled against live unlocks). */
export async function openChest(
  userId: string,
  chestId: string,
  owned: ChestOwnedSnapshot,
): Promise<OpenChestResult> {
  if (!supabase || userId.startsWith("guest_")) {
    return { ok: false, error: "Unavailable" };
  }
  const { data: chest, error } = await supabase
    .from("chests")
    .select("id, quality, status")
    .eq("id", chestId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !chest) return { ok: false, error: "Chest not found" };
  if (chest.status !== "closed") return { ok: false, error: "Already opened" };

  const quality = chest.quality as ChestQuality;
  const rolled: ChestLootResult = rollChestLoot(
    quality,
    rewardRollSalt(chestId, userId),
    owned,
  );
  const result = {
    essence: rolled.essence,
    copper: rolled.copper,
    lines: rolled.lines,
    grants: rolled.grants,
  };

  const { error: updErr } = await supabase
    .from("chests")
    .update({
      status: "opened",
      opened_at: new Date().toISOString(),
      result,
    })
    .eq("id", chestId)
    .eq("status", "closed");
  if (updErr) return { ok: false, error: updErr.message };

  return {
    ok: true,
    essence: rolled.essence,
    copper: rolled.copper,
    quality,
    lines: rolled.lines,
    grants: rolled.grants,
  };
}

export async function findReferralForInvitee(inviteeId: string) {
  if (!supabase) return null;
  const { data } = await supabase
    .from("friend_referrals")
    .select("inviter_id")
    .eq("invitee_id", inviteeId)
    .maybeSingle();
  return data?.inviter_id ?? null;
}
