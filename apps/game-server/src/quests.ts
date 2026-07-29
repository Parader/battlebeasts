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

async function bumpOne(
  userId: string,
  questId: string,
  delta: number,
  absolute?: boolean,
): Promise<void> {
  if (!supabase || userId.startsWith("guest_")) return;
  const def = getQuestDef(questId);
  if (!def) return;
  const period = questPeriodKey(def);
  const { data: row } = await supabase
    .from("quest_progress")
    .select("progress, completed_at")
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
        await bumpOne(userId, "daily_modes_3", 1);
        break;
      case "pvp_match_completed":
        await bumpOne(userId, "once_first_pvp", 1);
        break;
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
  const periods = new Set(QUEST_CATALOG.map((q) => questPeriodKey(q)));
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
