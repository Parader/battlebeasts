import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  DEFAULT_LOADOUT,
  STARTER_COLORS,
  STARTER_TALENT_POINTS,
  STARTER_WALLET,
  cosmeticsEquippedToFields,
  normalizeCoins,
  normalizeCosmeticsEquipped,
  normalizeLoadout,
  normalizePlayerUnlocks,
  normalizeTalentBuild,
  sanitizeTalentBuild,
  sanitizeUnlocksWithEquipped,
  emptyPlayerUnlocks,
  type CosmeticsEquipped,
  type PlayerUnlocks,
  type TalentBuild,
  type Wallet,
} from "@battlebeasts/shared";

const url = process.env.SUPABASE_URL;
const serverKey =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = url && serverKey ? createClient(url, serverKey) : null;

export type LoadoutPresetRow = {
  slotIndex: number;
  name: string;
  abilityIds: string[];
  talentBuild: TalentBuild;
};

export type EconomySnapshot = Wallet & {
  abilityIds: string[];
  talentIds: string[];
  talentPoints: number;
  talentBuild: TalentBuild;
  color?: string;
  pattern?: string;
  patternColor?: string;
  cosmeticsEquipped?: CosmeticsEquipped;
  unlocks: PlayerUnlocks;
  loadoutPresets: LoadoutPresetRow[];
  activeLoadoutSlot: number;
};

export type ProfileAppearance = {
  color?: string;
  pattern?: string;
  patternColor?: string;
  cosmeticsEquipped?: CosmeticsEquipped;
};

const DEFAULT_ECO: EconomySnapshot = {
  copper: 0,
  silver: 0,
  gold: 0,
  essence: 0,
  rubies: 0,
  abilityIds: [...DEFAULT_LOADOUT],
  talentIds: [],
  talentPoints: STARTER_TALENT_POINTS,
  talentBuild: {},
  cosmeticsEquipped: normalizeCosmeticsEquipped({}),
  unlocks: emptyPlayerUnlocks(),
  loadoutPresets: [{ slotIndex: 0, name: "Loadout 1", abilityIds: [...DEFAULT_LOADOUT], talentBuild: {} }],
  activeLoadoutSlot: 0,
};

export async function loadEconomy(userId: string): Promise<EconomySnapshot> {
  if (!supabase) {
    return {
      ...DEFAULT_ECO,
      ...STARTER_WALLET,
      talentPoints: STARTER_TALENT_POINTS,
      unlocks: emptyPlayerUnlocks(),
    };
  }

  const [inv, loadout, talents, profile, unlocksRes, presetsRes] = await Promise.all([
    supabase.from("inventory").select("resource_id, quantity").eq("user_id", userId),
    supabase.from("loadouts").select("ability_ids").eq("user_id", userId).maybeSingle(),
    supabase
      .from("talents")
      .select("talent_ids, talent_build")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("color, pattern, pattern_color, cosmetics_equipped, active_loadout_slot")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("player_unlocks").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("loadout_presets")
      .select("slot_index, name, ability_ids, talent_build")
      .eq("user_id", userId)
      .order("slot_index", { ascending: true }),
  ]);

  if (profile.error) {
    console.warn("[persistence] load profile appearance failed:", profile.error.message);
  }
  if (unlocksRes.error) {
    console.warn(
      "[persistence] player_unlocks missing — run migration 20260727000000_shop_unlocks_rubies.sql:",
      unlocksRes.error.message,
    );
  }

  let profileRow: {
    color?: string;
    pattern?: string;
    pattern_color?: string;
    cosmetics_equipped?: unknown;
    active_loadout_slot?: number;
  } | null = profile.data ?? null;

  if (profile.error && /cosmetics_equipped|active_loadout_slot/i.test(profile.error.message)) {
    const fallback = await supabase
      .from("profiles")
      .select("color, pattern, pattern_color, cosmetics_equipped")
      .eq("id", userId)
      .maybeSingle();
    if (!fallback.error) {
      profileRow = fallback.data;
    } else if (/cosmetics_equipped/i.test(fallback.error.message)) {
      const bare = await supabase
        .from("profiles")
        .select("color, pattern, pattern_color")
        .eq("id", userId)
        .maybeSingle();
      profileRow = bare.data;
    }
  }

  // Retry unlocks once if PostgREST schema cache is still catching up after a migration.
  let unlocksData = unlocksRes.data;
  let unlocksError = unlocksRes.error;
  if (unlocksError && /schema cache|could not find the table/i.test(unlocksError.message)) {
    await new Promise((r) => setTimeout(r, 400));
    const retry = await supabase
      .from("player_unlocks")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    unlocksData = retry.data;
    unlocksError = retry.error;
    if (unlocksError) {
      console.warn("[persistence] player_unlocks retry failed:", unlocksError.message);
    }
  }

  const qty = (id: string) => inv.data?.find((r) => r.resource_id === id)?.quantity ?? 0;
  const hasCurrencyRow = (inv.data ?? []).some((r) =>
    ["copper", "scrap", "silver", "gold", "essence", "rubies"].includes(r.resource_id),
  );
  // Brand-new accounts have an empty inventory — seed the starter wallet once.
  if (!hasCurrencyRow) {
    void saveInventory(userId, STARTER_WALLET, STARTER_TALENT_POINTS);
  }
  const copper = hasCurrencyRow
    ? qty("copper") + qty("scrap")
    : STARTER_WALLET.copper;
  const silver = hasCurrencyRow ? qty("silver") : STARTER_WALLET.silver;
  const gold = hasCurrencyRow ? qty("gold") : STARTER_WALLET.gold;
  const essence = hasCurrencyRow ? qty("essence") : STARTER_WALLET.essence;
  const rubies = hasCurrencyRow ? qty("rubies") : STARTER_WALLET.rubies;
  const talentPointsRow = qty("talent_points");
  const talentPoints = inv.data?.some((r) => r.resource_id === "talent_points")
    ? talentPointsRow
    : STARTER_TALENT_POINTS;

  const cosmeticsEquipped = normalizeCosmeticsEquipped(profileRow?.cosmetics_equipped);
  const fields = cosmeticsEquippedToFields(cosmeticsEquipped);
  const equippedCosmeticIds = [
    fields.cosmeticHat,
    fields.cosmeticShoulders,
    fields.cosmeticChest,
    fields.cosmeticGloves,
    fields.cosmeticBelt,
    fields.cosmeticLegs,
    fields.cosmeticShoes,
  ].filter(Boolean);

  const abilityIds = normalizeLoadout(
    Array.isArray(loadout.data?.ability_ids) ? loadout.data.ability_ids : null,
  );

  let unlocks = normalizePlayerUnlocks(
    unlocksData
      ? {
          cosmetics: unlocksData.cosmetics,
          colors: unlocksData.colors,
          patterns: unlocksData.patterns,
          pattern_colors: unlocksData.pattern_colors,
          emotes: unlocksData.emotes,
          abilities: unlocksData.abilities,
          loadout_slot_count: unlocksData.loadout_slot_count,
          emote_slots: unlocksData.emote_slots,
        }
      : null,
  );

  unlocks = sanitizeUnlocksWithEquipped(
    unlocks,
    equippedCosmeticIds,
    profileRow?.color,
    profileRow?.pattern,
    profileRow?.pattern_color,
    abilityIds,
  );

  const accountTalentBuild = sanitizeTalentBuild(
    talents.data?.talent_build,
    talentPoints,
  );

  const loadoutPresets: LoadoutPresetRow[] = (presetsRes.data ?? []).map((row) => {
    const fromPreset = sanitizeTalentBuild(
      row.talent_build && typeof row.talent_build === "object" ? row.talent_build : {},
      talentPoints,
    );
    return {
      slotIndex: row.slot_index as number,
      name: (row.name as string) || `Loadout ${(row.slot_index as number) + 1}`,
      abilityIds: normalizeLoadout(
        Array.isArray(row.ability_ids) ? (row.ability_ids as string[]) : null,
      ),
      // Empty preset builds inherit the account build so old rows stay playable.
      talentBuild:
        Object.keys(fromPreset).length > 0 ? fromPreset : accountTalentBuild,
    };
  });

  if (loadoutPresets.length === 0) {
    loadoutPresets.push({
      slotIndex: 0,
      name: "Loadout 1",
      abilityIds,
      talentBuild: accountTalentBuild,
    });
  }

  const activeLoadoutSlot = Math.max(
    0,
    Math.min(
      unlocks.loadoutSlotCount - 1,
      Math.floor(profileRow?.active_loadout_slot ?? 0),
    ),
  );

  const activePreset = loadoutPresets.find((p) => p.slotIndex === activeLoadoutSlot);
  const resolvedAbilityIds = activePreset?.abilityIds?.length
    ? normalizeLoadout(activePreset.abilityIds)
    : abilityIds;
  const resolvedTalentBuild = activePreset?.talentBuild ?? accountTalentBuild;

  // Persist sanitized unlocks once if table exists and row was empty-ish
  if (!unlocksError) {
    void savePlayerUnlocks(userId, unlocks);
  }

  return {
    ...normalizeCoins({ copper, silver, gold }),
    essence,
    rubies,
    abilityIds: resolvedAbilityIds,
    talentIds: Array.isArray(talents.data?.talent_ids) ? talents.data.talent_ids : [],
    talentPoints,
    talentBuild: resolvedTalentBuild,
    color: profileRow?.color ?? undefined,
    pattern: profileRow?.pattern ?? undefined,
    patternColor: profileRow?.pattern_color ?? undefined,
    cosmeticsEquipped,
    unlocks,
    loadoutPresets,
    activeLoadoutSlot,
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
    { user_id: userId, resource_id: "rubies", quantity: Math.max(0, wallet.rubies ?? 0) },
  ];
  if (typeof talentPoints === "number") {
    rows.push({ user_id: userId, resource_id: "talent_points", quantity: Math.max(0, talentPoints) });
  }
  await supabase.from("inventory").upsert(rows, { onConflict: "user_id,resource_id" });
}

const BEACH_BALL_RESOURCE = "beach_ball";
const MAX_BEACH_BALLS = 2;

/** Lobby beach balls owned by this hunter (persists on their hub). */
export async function loadBeachBallCount(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { data } = await supabase
    .from("inventory")
    .select("quantity")
    .eq("user_id", userId)
    .eq("resource_id", BEACH_BALL_RESOURCE)
    .maybeSingle();
  const n = Math.floor(data?.quantity ?? 0);
  return Math.max(0, Math.min(MAX_BEACH_BALLS, n));
}

export async function saveBeachBallCount(userId: string, count: number): Promise<void> {
  if (!supabase) return;
  const quantity = Math.max(0, Math.min(MAX_BEACH_BALLS, Math.floor(count)));
  await supabase.from("inventory").upsert(
    [{ user_id: userId, resource_id: BEACH_BALL_RESOURCE, quantity }],
    { onConflict: "user_id,resource_id" },
  );
}

export async function savePlayerUnlocks(userId: string, unlocks: PlayerUnlocks): Promise<boolean> {
  if (!supabase) return true;
  const normalized = normalizePlayerUnlocks(unlocks);
  const payload = {
    user_id: userId,
    cosmetics: normalized.cosmetics,
    colors: normalized.colors,
    patterns: normalized.patterns,
    pattern_colors: normalized.patternColors,
    emotes: normalized.emotes,
    abilities: normalized.abilities,
    loadout_slot_count: normalized.loadoutSlotCount,
    emote_slots: normalized.emoteSlots,
    updated_at: new Date().toISOString(),
  };

  const attempt = async () =>
    supabase.from("player_unlocks").upsert(payload, { onConflict: "user_id" });

  let { error } = await attempt();
  // PostgREST can lag after migrations — one retry after a brief wait.
  if (error && /schema cache|could not find the table/i.test(error.message)) {
    await new Promise((r) => setTimeout(r, 400));
    ({ error } = await attempt());
  }
  if (error) {
    console.warn("[persistence] savePlayerUnlocks failed:", error.message);
    return false;
  }
  return true;
}

export async function saveLoadout(userId: string, abilityIds: string[]): Promise<void> {
  if (!supabase) return;
  await supabase.from("loadouts").upsert(
    { user_id: userId, ability_ids: abilityIds, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}

export async function saveLoadoutPreset(
  userId: string,
  slotIndex: number,
  abilityIds: string[],
  options?: { name?: string; talentBuild?: TalentBuild },
): Promise<void> {
  if (!supabase) return;
  const payload: Record<string, unknown> = {
    user_id: userId,
    slot_index: slotIndex,
    name: options?.name || `Loadout ${slotIndex + 1}`,
    ability_ids: abilityIds,
    updated_at: new Date().toISOString(),
  };
  if (options?.talentBuild !== undefined) {
    payload.talent_build = normalizeTalentBuild(options.talentBuild);
  }
  await supabase.from("loadout_presets").upsert(payload, {
    onConflict: "user_id,slot_index",
  });
  // Keep legacy single-row loadout in sync when saving active kit
  await saveLoadout(userId, abilityIds);
}

export async function saveActiveLoadoutSlot(userId: string, slotIndex: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("profiles")
    .update({ active_loadout_slot: slotIndex, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    console.warn("[persistence] saveActiveLoadoutSlot failed:", error.message);
  }
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

/** Persist hide tint / pattern / ink / equipped wearables on the account profile. */
export async function saveProfileAppearance(
  userId: string,
  appearance: ProfileAppearance,
): Promise<boolean> {
  if (!supabase) return false;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (appearance.color != null) patch.color = appearance.color;
  if (appearance.pattern != null) patch.pattern = appearance.pattern;
  if (appearance.patternColor != null) patch.pattern_color = appearance.patternColor;
  if (appearance.cosmeticsEquipped != null) {
    patch.cosmetics_equipped = normalizeCosmeticsEquipped(appearance.cosmeticsEquipped);
  }

  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) {
    console.warn("[persistence] saveProfileAppearance failed:", error.message, patch);
    if (appearance.cosmeticsEquipped != null && /cosmetics_equipped/i.test(error.message)) {
      console.warn(
        "[persistence] cosmetics_equipped missing — run migration 20260726000000_profile_cosmetics_equipped.sql",
      );
      const { cosmetics_equipped: _drop, ...rest } = patch;
      if (Object.keys(rest).length > 1) {
        const retry = await supabase.from("profiles").update(rest).eq("id", userId);
        if (!retry.error) return true;
      }
    }
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

export async function saveProfilePatternColor(userId: string, patternColor: string): Promise<boolean> {
  return saveProfileAppearance(userId, { patternColor });
}

export async function saveProfileCosmeticsEquipped(
  userId: string,
  cosmeticsEquipped: CosmeticsEquipped,
): Promise<boolean> {
  return saveProfileAppearance(userId, { cosmeticsEquipped });
}

/** Whether the hub intro cinematic has been completed. */
export async function loadIntroCompleted(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("intro_completed")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    if (/intro_completed/i.test(error.message)) {
      console.warn(
        "[persistence] intro_completed missing — run migration 20260731010000_profile_intro_completed.sql",
      );
    } else {
      console.warn("[persistence] loadIntroCompleted failed:", error.message);
    }
    return false;
  }
  return Boolean(data?.intro_completed);
}

export async function setIntroCompleted(userId: string, completed: boolean): Promise<boolean> {
  if (!supabase) return true;
  const { error } = await supabase
    .from("profiles")
    .update({ intro_completed: completed, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    console.warn("[persistence] setIntroCompleted failed:", error.message);
    return false;
  }
  return true;
}

export type SoftResetResult = {
  ok: boolean;
  error?: string;
  economy?: EconomySnapshot;
};

/**
 * Soft character reset: starter wallet/loadout/talents/quests/chests/appearance.
 * Wipes purchased cosmetics, colors, patterns, emotes back to starters;
 * clears intro so cinematic can replay.
 */
export async function softResetCharacter(userId: string): Promise<SoftResetResult> {
  const starterUnlocks = emptyPlayerUnlocks();
  const starterColor = STARTER_COLORS[0]!;
  if (!supabase) {
    return {
      ok: true,
      economy: {
        ...DEFAULT_ECO,
        ...STARTER_WALLET,
        color: starterColor,
        pattern: DEFAULT_COSMETIC_PATTERN,
        patternColor: DEFAULT_COSMETIC_PATTERN_COLOR,
        cosmeticsEquipped: normalizeCosmeticsEquipped({}),
        unlocks: starterUnlocks,
      },
    };
  }

  const wallet: Wallet = { ...STARTER_WALLET };

  await Promise.all([
    saveInventory(userId, wallet, STARTER_TALENT_POINTS),
    saveBeachBallCount(userId, 0),
    savePlayerUnlocks(userId, starterUnlocks),
    saveLoadout(userId, [...DEFAULT_LOADOUT]),
    saveTalents(userId, []),
    saveTalentBuild(userId, {}),
    setIntroCompleted(userId, false),
    supabase.from("quest_progress").delete().eq("user_id", userId),
    supabase.from("chests").delete().eq("user_id", userId),
    supabase.from("loadout_presets").delete().eq("user_id", userId),
    supabase
      .from("profiles")
      .update({
        active_loadout_slot: 0,
        color: starterColor,
        pattern: DEFAULT_COSMETIC_PATTERN,
        pattern_color: DEFAULT_COSMETIC_PATTERN_COLOR,
        cosmetics_equipped: {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId),
  ]);

  await saveLoadoutPreset(userId, 0, [...DEFAULT_LOADOUT], {
    name: "Loadout 1",
    talentBuild: {},
  });

  const economy = await loadEconomy(userId);
  return { ok: true, economy };
}

export type RewardGrantPayload = {
  copper?: number;
  silver?: number;
  gold?: number;
  essence?: number;
  rubies?: number;
  activityMul?: number;
  base?: number;
  winBonus?: number;
  meta?: Record<string, unknown>;
};

/** Insert grant. Returns false if duplicate (already exists). Guests / no DB → skipped. */
export async function insertRewardGrant(
  userId: string,
  source: string,
  sourceKey: string,
  payload: RewardGrantPayload,
  status: "pending" | "claimed" = "pending",
): Promise<"inserted" | "duplicate" | "skipped"> {
  if (!supabase || userId.startsWith("guest_")) return "skipped";
  const { error } = await supabase.from("reward_grants").insert({
    user_id: userId,
    source,
    source_key: sourceKey,
    payload,
    status,
    claimed_at: status === "claimed" ? new Date().toISOString() : null,
  });
  if (!error) return "inserted";
  if (/duplicate|unique/i.test(error.message)) return "duplicate";
  console.warn("[persistence] insertRewardGrant", error.message);
  return "skipped";
}

/** Claim all pending grants for a user; marks claimed and returns merged wallet delta. */
export async function claimPendingRewardGrants(userId: string): Promise<RewardGrantPayload | null> {
  if (!supabase || userId.startsWith("guest_")) return null;
  const { data, error } = await supabase
    .from("reward_grants")
    .select("id, payload")
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error || !data?.length) {
    if (error) console.warn("[persistence] claimPendingRewardGrants", error.message);
    return null;
  }
  const ids = data.map((r) => r.id as string);
  const { error: updErr } = await supabase
    .from("reward_grants")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending");
  if (updErr) {
    console.warn("[persistence] claimPendingRewardGrants update", updErr.message);
    return null;
  }

  const merged: RewardGrantPayload = {
    copper: 0,
    silver: 0,
    gold: 0,
    essence: 0,
    rubies: 0,
  };
  for (const row of data) {
    const p = (row.payload ?? {}) as RewardGrantPayload;
    merged.copper = (merged.copper ?? 0) + (p.copper ?? 0);
    merged.silver = (merged.silver ?? 0) + (p.silver ?? 0);
    merged.gold = (merged.gold ?? 0) + (p.gold ?? 0);
    merged.essence = (merged.essence ?? 0) + (p.essence ?? 0);
    merged.rubies = (merged.rubies ?? 0) + (p.rubies ?? 0);
  }
  if (
    !(merged.copper || merged.silver || merged.gold || merged.essence || merged.rubies)
  ) {
    return null;
  }
  return merged;
}

