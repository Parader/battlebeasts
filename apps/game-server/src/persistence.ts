import { createClient } from "@supabase/supabase-js";
import { DEFAULT_LOADOUT, normalizeCoins, normalizeLoadout, type Wallet } from "@battlebeasts/shared";

const url = process.env.SUPABASE_URL;
const serverKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = url && serverKey ? createClient(url, serverKey) : null;

export type EconomySnapshot = Wallet & {
  abilityIds: string[];
  talentIds: string[];
  color?: string;
};

const DEFAULT_ECO: EconomySnapshot = {
  copper: 0,
  silver: 0,
  gold: 0,
  essence: 0,
  abilityIds: [...DEFAULT_LOADOUT],
  talentIds: [],
};

export async function loadEconomy(userId: string): Promise<EconomySnapshot> {
  if (!supabase) {
    return { ...DEFAULT_ECO, copper: 75, silver: 2, essence: 3 };
  }

  const [inv, loadout, talents, profile] = await Promise.all([
    supabase.from("inventory").select("resource_id, quantity").eq("user_id", userId),
    supabase.from("loadouts").select("ability_ids").eq("user_id", userId).maybeSingle(),
    supabase.from("talents").select("talent_ids").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("color").eq("id", userId).maybeSingle(),
  ]);

  const qty = (id: string) => inv.data?.find((r) => r.resource_id === id)?.quantity ?? 0;
  // Legacy scrap row → copper if migration not applied yet
  const copper = qty("copper") + qty("scrap");

  return {
    ...normalizeCoins({ copper, silver: qty("silver"), gold: qty("gold") }),
    essence: qty("essence"),
    abilityIds: normalizeLoadout(
      Array.isArray(loadout.data?.ability_ids) ? loadout.data.ability_ids : null,
    ),
    talentIds: Array.isArray(talents.data?.talent_ids) ? talents.data.talent_ids : [],
    color: profile.data?.color ?? undefined,
  };
}

export async function saveInventory(userId: string, wallet: Wallet): Promise<void> {
  if (!supabase) return;
  const coins = normalizeCoins(wallet);
  await supabase.from("inventory").upsert(
    [
      { user_id: userId, resource_id: "copper", quantity: coins.copper },
      { user_id: userId, resource_id: "silver", quantity: coins.silver },
      { user_id: userId, resource_id: "gold", quantity: coins.gold },
      { user_id: userId, resource_id: "essence", quantity: wallet.essence },
    ],
    { onConflict: "user_id,resource_id" },
  );
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

export async function saveProfileColor(userId: string, color: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("profiles").update({ color, updated_at: new Date().toISOString() }).eq("id", userId);
}
