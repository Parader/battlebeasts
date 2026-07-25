import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_LOADOUT,
  STARTER_TALENT_POINTS,
  normalizeCoins,
  normalizeLoadout,
  normalizeTalentBuild,
  type TalentBuild,
  type Wallet,
} from "@battlebeasts/shared";

const url = process.env.SUPABASE_URL;
const serverKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = url && serverKey ? createClient(url, serverKey) : null;

export type EconomySnapshot = Wallet & {
  abilityIds: string[];
  talentIds: string[];
  talentPoints: number;
  talentBuild: TalentBuild;
  color?: string;
  pattern?: string;
  patternColor?: string;
};

export type ProfileAppearance = {
  color?: string;
  pattern?: string;
  patternColor?: string;
};

const DEFAULT_ECO: EconomySnapshot = {
  copper: 0,
  silver: 0,
  gold: 0,
  essence: 0,
  abilityIds: [...DEFAULT_LOADOUT],
  talentIds: [],
  talentPoints: STARTER_TALENT_POINTS,
  talentBuild: {},
};

export async function loadEconomy(userId: string): Promise<EconomySnapshot> {
  if (!supabase) {
    return { ...DEFAULT_ECO, copper: 75, silver: 2, essence: 12, talentPoints: STARTER_TALENT_POINTS };
  }

  const [inv, loadout, talents, profile] = await Promise.all([
    supabase.from("inventory").select("resource_id, quantity").eq("user_id", userId),
    supabase.from("loadouts").select("ability_ids").eq("user_id", userId).maybeSingle(),
    supabase
      .from("talents")
      .select("talent_ids, talent_build")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("profiles").select("color, pattern, pattern_color").eq("id", userId).maybeSingle(),
  ]);

  if (profile.error) {
    console.warn("[persistence] load profile appearance failed:", profile.error.message);
  }

  const qty = (id: string) => inv.data?.find((r) => r.resource_id === id)?.quantity ?? 0;
  const copper = qty("copper") + qty("scrap");
  const talentPointsRow = qty("talent_points");
  // Missing row → starter allocation (migration seeds existing users).
  const talentPoints = inv.data?.some((r) => r.resource_id === "talent_points")
    ? talentPointsRow
    : STARTER_TALENT_POINTS;

  return {
    ...normalizeCoins({ copper, silver: qty("silver"), gold: qty("gold") }),
    essence: qty("essence"),
    abilityIds: normalizeLoadout(
      Array.isArray(loadout.data?.ability_ids) ? loadout.data.ability_ids : null,
    ),
    talentIds: Array.isArray(talents.data?.talent_ids) ? talents.data.talent_ids : [],
    talentPoints,
    talentBuild: normalizeTalentBuild(talents.data?.talent_build),
    color: profile.data?.color ?? undefined,
    pattern: profile.data?.pattern ?? undefined,
    patternColor: profile.data?.pattern_color ?? undefined,
  };
}

export async function saveInventory(userId: string, wallet: Wallet, talentPoints?: number): Promise<void> {
  if (!supabase) return;
  const coins = normalizeCoins(wallet);
  const rows: Array<{ user_id: string; resource_id: string; quantity: number }> = [
    { user_id: userId, resource_id: "copper", quantity: coins.copper },
    { user_id: userId, resource_id: "silver", quantity: coins.silver },
    { user_id: userId, resource_id: "gold", quantity: coins.gold },
    { user_id: userId, resource_id: "essence", quantity: wallet.essence },
  ];
  if (typeof talentPoints === "number") {
    rows.push({ user_id: userId, resource_id: "talent_points", quantity: Math.max(0, talentPoints) });
  }
  await supabase.from("inventory").upsert(rows, { onConflict: "user_id,resource_id" });
}

export async function saveLoadout(userId: string, abilityIds: string[]): Promise<void> {
  if (!supabase) return;
  await supabase.from("loadouts").upsert(
    { user_id: userId, ability_ids: abilityIds, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}

export async function saveTalents(userId: string, talentIds: string[]): Promise<void> {
  if (!supabase) return;
  await supabase.from("talents").upsert(
    { user_id: userId, talent_ids: talentIds, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}

export async function saveTalentBuild(userId: string, talentBuild: TalentBuild): Promise<void> {
  if (!supabase) return;
  await supabase.from("talents").upsert(
    {
      user_id: userId,
      talent_build: talentBuild,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

/** Persist hide tint / pattern / ink on the account profile. */
export async function saveProfileAppearance(
  userId: string,
  appearance: ProfileAppearance,
): Promise<boolean> {
  if (!supabase) return false;
  const patch: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (appearance.color != null) patch.color = appearance.color;
  if (appearance.pattern != null) patch.pattern = appearance.pattern;
  if (appearance.patternColor != null) patch.pattern_color = appearance.patternColor;

  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) {
    console.warn("[persistence] saveProfileAppearance failed:", error.message, patch);
    return false;
  }
  return true;
}

export async function saveProfileColor(userId: string, color: string): Promise<boolean> {
  return saveProfileAppearance(userId, { color });
}

export async function saveProfilePattern(userId: string, pattern: string): Promise<boolean> {
  return saveProfileAppearance(userId, { pattern });
}

export async function saveProfilePatternColor(
  userId: string,
  patternColor: string,
): Promise<boolean> {
  return saveProfileAppearance(userId, { patternColor });
}
