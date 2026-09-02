import { Room, Client } from "@colyseus/core";
import {
  ABILITIES,
  COSMETIC_COLORS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  DEFAULT_LOADOUT,
  EMPTY_FLEX_LOADOUT,
  ESSENCE_PER_TALENT_POINT,
  ESSENCE_PER_TALENT_REFUND,
  HEALTH_TONIC_HEAL,
  LOADOUT_SIZE,
  MAX_COIN_LOADOUT_SLOTS,
  MAX_FLEX_SLOTS,
  MAX_TALENTS,
  PLAYER_BASE_MAX_HP,
  QUEST_CATALOG,
  SHOP_ITEMS,
  SPELL_SLOTS,
  STARTER_COLORS,
  STARTER_TALENT_POINTS,
  STARTER_WALLET,
  TALENTS,
  TALENT_POINT_BUDGET,
  TALENT_TREE_IDS,
  abilityUnlockCostEssence,
  addCoins,
  applyCosmeticEquip,
  canAffordShopCost,
  canEquipInSlot,
  clampBuildToOwned,
  clearTree,
  cosmeticsEquippedFromFields,
  cosmeticsEquippedToFields,
  emptyPlayerUnlocks,
  formatCoins,
  formatShopCost,
  getCosmeticItem,
  isCosmeticSlot,
  isTalentBuildValid,
  normalizeCoins,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeCosmeticsEquipped,
  normalizeEmoteSlots,
  normalizeFlexLoadout,
  normalizeLoadout,
  normalizeTalentBuild,
  ownsAbility,
  ownsColor,
  ownsCosmetic,
  ownsEmote,
  ownsPattern,
  ownsPatternColor,
  questPeriodKey,
  sanitizeTalentBuild,
  spendCoins,
  talentPointsRemoved,
  talentRefundEssenceCost,
  totalPointsSpent,
  treePointsSpent,
  type FlexLoadout,
  type PlayerUnlocks,
  type ShopCost,
  type ShopGrant,
  type TalentBuild,
  type TalentTreeId,
  type Wallet,
} from "@battlebeasts/shared";
import type { VerifiedIdentity } from "../auth.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import {
  clampFlexToUnlocked,
  loadEconomy,
  saveActiveLoadoutSlot,
  saveInventory,
  saveLoadout,
  saveLoadoutPreset,
  savePlayerUnlocks,
  saveProfileAppearance,
  saveProfileColor,
  saveProfileCosmeticsEquipped,
  saveProfilePatternColor,
  saveTalentBuild,
  saveTalents,
  type LoadoutPresetRow,
} from "../persistence.js";
import { bumpQuest, listClosedChests, listQuestProgress, openChest } from "../quests.js";
import { getActiveSeason } from "../ranked.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

/**
 * Everything a player can do to their own character, in any room.
 *
 * Shopping, unlocking spells, arranging a loadout, spending talent points,
 * changing colour and opening chests all used to live on the hub, because the
 * hub was the only place with a shop stand to walk up to. NPCs broke that
 * assumption: a merchant standing in an authored village is the same
 * transaction, and duplicating nine hundred lines to reach it would have meant
 * two shops to keep honest.
 *
 * So the rooms share a base rather than a copy. Nothing here knows about hubs,
 * parties, matchmaking or matches -- it reads and writes one player's economy
 * and replies to that one client. The single exception is the lobby beach
 * ball, which is genuinely a property of a hub, and which subclasses opt into
 * through `grantLobbyItem`.
 */

/** Why a lobby-scoped purchase was refused, or null when it may proceed. */
export type LobbyGrantCheck = string | null;

export abstract class ServicedRoom extends Room<BaseCityState> {
  protected identities = new Map<string, VerifiedIdentity>();
  protected combat!: CombatSystem;

  /**
   * Progression that is not in the schema.
   *
   * None of this is replicated: talent points, the chosen build, owned
   * unlocks and saved presets are private to one player, so they travel on the
   * `inventory` message instead of costing every client bandwidth for
   * everyone else's wardrobe.
   */
  protected talentPointsBySession = new Map<string, number>();
  protected talentBuildBySession = new Map<string, TalentBuild>();
  protected unlocksBySession = new Map<string, PlayerUnlocks>();
  protected loadoutPresetsBySession = new Map<string, LoadoutPresetRow[]>();
  protected activeLoadoutSlotBySession = new Map<string, number>();

  // ---------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------

  /** Attach every player-service message. Call once from `onCreate`. */
  protected registerPlayerServices() {
    this.onMessage("set_color", (client, message: { color: string }) => {
      void this.handleSetColor(client, message.color);
    });

    this.onMessage("set_pattern", (client, message: { pattern: string; patternColor?: string }) => {
      void this.handleSetPattern(client, message?.pattern ?? "", message?.patternColor);
    });

    this.onMessage("set_pattern_color", (client, message: { patternColor: string }) => {
      void this.handleSetPatternColor(client, message?.patternColor ?? "");
    });

    this.onMessage("set_cosmetic", (client, message: { slot?: string; itemId?: string | null }) => {
      void this.handleSetCosmetic(client, message?.slot, message?.itemId ?? null);
    });

    this.onMessage("shop_buy", (client, message: { itemId: string }) => {
      void this.handleShopBuy(client, message.itemId);
    });

    this.onMessage("unlock_ability", (client, message: { abilityId?: string }) => {
      void this.handleUnlockAbility(client, message?.abilityId ?? "");
    });

    this.onMessage("set_loadout", (client, message: { abilityIds: string[] }) => {
      void this.handleSetLoadout(client, message.abilityIds ?? []);
    });

    this.onMessage("set_flex_loadout", (client, message: { abilityIds?: (string | null)[] }) => {
      void this.handleSetFlexLoadout(client, message?.abilityIds ?? []);
    });

    this.onMessage(
      "save_loadout_preset",
      (client, message: { slotIndex?: number; abilityIds?: string[]; name?: string }) => {
        void this.handleSaveLoadoutPreset(
          client,
          message?.slotIndex ?? 0,
          message?.abilityIds ?? [],
          message?.name,
        );
      },
    );

    this.onMessage("select_loadout_preset", (client, message: { slotIndex?: number }) => {
      void this.handleSelectLoadoutPreset(client, message?.slotIndex ?? 0);
    });

    this.onMessage("set_emote_loadout", (client, message: { emoteSlots?: (string | null)[] }) => {
      void this.handleSetEmoteLoadout(client, message?.emoteSlots ?? []);
    });

    this.onMessage("set_talents", (client, message: { talentIds: string[] }) => {
      void this.handleSetTalents(client, message.talentIds ?? []);
    });

    this.onMessage("buy_talent_points", (client, message: { count?: number }) => {
      void this.handleBuyTalentPoints(client, message?.count ?? 1);
    });

    this.onMessage("set_talent_build", (client, message: { build?: TalentBuild }) => {
      void this.handleSetTalentBuild(client, message?.build ?? {});
    });

    this.onMessage("reset_talent_tree", (client, message: { tree?: TalentTreeId }) => {
      void this.handleResetTalentTree(client, message?.tree);
    });

    this.onMessage("hub_quests", (client) => {
      void this.handleHubQuests(client);
    });

    this.onMessage("hub_open_chest", (client, message: { chestId?: string }) => {
      void this.handleHubOpenChest(client, message?.chestId);
    });
  }

  // ---------------------------------------------------------------------
  // Lobby-scoped purchases (hub only)
  // ---------------------------------------------------------------------

  /**
   * Whether a lobby-scoped item may be bought here.
   *
   * Defaults to refusing, because outside a hub there is no lobby to place the
   * thing in. `BaseCityRoom` overrides both of these.
   */
  protected checkLobbyGrant(_client: Client, _grant: ShopGrant): LobbyGrantCheck {
    return "Not available here";
  }

  /** Apply a lobby-scoped grant. Returns false if it could not be saved. */
  protected async grantLobbyItem(_client: Client, _grant: ShopGrant): Promise<boolean> {
    return false;
  }

  /** Owned count for a lobby-scoped item, for the already-owned check. */
  protected lobbyGrantCount(_grant: ShopGrant): number {
    return 0;
  }

  // ---------------------------------------------------------------------
  // Join-time economy
  // ---------------------------------------------------------------------

  /**
   * Load a player's account into the room, or seat a guest on starter values.
   *
   * Awaited rather than fired off, so that a purchase arriving in the first
   * few frames cannot race an empty wallet -- which would not merely fail, it
   * would debit zero and then write that zero back over the real balance.
   */
  protected async loadPlayerEconomy(
    sessionId: string,
    player: PlayerState,
    identity: VerifiedIdentity,
  ) {
    if (identity.isGuest) {
      const unlocks = emptyPlayerUnlocks();
      this.unlocksBySession.set(sessionId, unlocks);
      this.loadoutPresetsBySession.set(sessionId, [
        {
          slotIndex: 0,
          name: "Loadout 1",
          abilityIds: [...DEFAULT_LOADOUT],
          talentBuild: {},
          flexAbilityIds: [...EMPTY_FLEX_LOADOUT],
        },
      ]);
      this.activeLoadoutSlotBySession.set(sessionId, 0);
      this.talentPointsBySession.set(sessionId, STARTER_TALENT_POINTS);
      this.talentBuildBySession.set(sessionId, {});
      const starter = normalizeCoins(STARTER_WALLET);
      player.copper = starter.copper;
      player.silver = starter.silver;
      player.gold = starter.gold;
      player.essence = STARTER_WALLET.essence;
      player.rubies = STARTER_WALLET.rubies;
      player.color =
        identity.color && ownsColor(unlocks.colors, identity.color)
          ? identity.color
          : STARTER_COLORS[0]!;
      player.pattern = DEFAULT_COSMETIC_PATTERN;
      player.patternColor = DEFAULT_COSMETIC_PATTERN_COLOR;
      return;
    }

    const eco = await loadEconomy(identity.userId);
    player.copper = eco.copper;
    player.silver = eco.silver;
    player.gold = eco.gold;
    player.essence = eco.essence;
    player.rubies = eco.rubies;

    const abilityIds = normalizeLoadout(eco.abilityIds);
    player.loadout = abilityIds.join(",");
    player.flexLoadout = this.resolveFlexForBar(eco.flexAbilityIds, abilityIds, eco.unlocks)
      .map((id) => id ?? "")
      .join(",");
    player.talents = eco.talentIds.slice(0, MAX_TALENTS).join(",");

    this.talentPointsBySession.set(sessionId, eco.talentPoints);
    this.talentBuildBySession.set(sessionId, eco.talentBuild);
    this.unlocksBySession.set(sessionId, eco.unlocks);
    this.loadoutPresetsBySession.set(sessionId, eco.loadoutPresets);
    this.activeLoadoutSlotBySession.set(sessionId, eco.activeLoadoutSlot);

    // Ownership is re-checked on load, not trusted from the row: a cosmetic
    // can be removed from the catalog, and a saved look should degrade to the
    // default rather than render as something that no longer exists.
    const savedColor = eco.color && ownsColor(eco.unlocks.colors, eco.color) ? eco.color : null;
    const idColor =
      identity.color && ownsColor(eco.unlocks.colors, identity.color) ? identity.color : null;
    player.color = savedColor ?? idColor ?? STARTER_COLORS[0]!;
    player.pattern = ownsPattern(eco.unlocks.patterns, eco.pattern ?? "")
      ? normalizeCosmeticPattern(eco.pattern)
      : DEFAULT_COSMETIC_PATTERN;
    player.patternColor = ownsPatternColor(eco.unlocks.patternColors, eco.patternColor ?? "")
      ? normalizeCosmeticPatternColor(eco.patternColor)
      : DEFAULT_COSMETIC_PATTERN_COLOR;
    this.applyCosmeticsEquipped(player, eco.cosmeticsEquipped ?? {});
  }

  /** Drop a leaving player's caches. */
  protected clearPlayerServices(sessionId: string) {
    this.talentPointsBySession.delete(sessionId);
    this.talentBuildBySession.delete(sessionId);
    this.unlocksBySession.delete(sessionId);
    this.loadoutPresetsBySession.delete(sessionId);
    this.activeLoadoutSlotBySession.delete(sessionId);
  }

  // ---------------------------------------------------------------------
  // Wallet / inventory helpers
  // ---------------------------------------------------------------------

  protected walletOf(player: PlayerState): Wallet {
    return {
      copper: player.copper,
      silver: player.silver,
      gold: player.gold,
      essence: player.essence,
      rubies: player.rubies,
    };
  }

  protected applyWallet(player: PlayerState, wallet: Wallet) {
    const coins = normalizeCoins(wallet);
    player.copper = coins.copper;
    player.silver = coins.silver;
    player.gold = coins.gold;
    player.essence = wallet.essence;
    player.rubies = Math.max(0, wallet.rubies ?? 0);
  }

  protected unlocksOf(sessionId: string): PlayerUnlocks {
    return this.unlocksBySession.get(sessionId) ?? emptyPlayerUnlocks();
  }

  protected sendInventory(client: Client, player: PlayerState) {
    const wallet = this.walletOf(player);
    client.send("inventory", {
      resources: {
        copper: wallet.copper,
        silver: wallet.silver,
        gold: wallet.gold,
        essence: wallet.essence,
        rubies: wallet.rubies,
        talent_points: this.talentPointsBySession.get(client.sessionId) ?? 0,
      },
      loadout: player.loadout.split(",").filter(Boolean),
      // Positional, so empties are kept rather than filtered: dropping them
      // would slide slot 3's spell onto key 1.
      flexLoadout: player.flexLoadout.split(",").map((id) => id || null),
      talents: player.talents.split(",").filter(Boolean),
      talentBuild: this.talentBuildBySession.get(client.sessionId) ?? {},
      unlocks: this.unlocksOf(client.sessionId),
      loadoutPresets: this.loadoutPresetsBySession.get(client.sessionId) ?? [],
      activeLoadoutSlot: this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0,
    });
  }

  /** Bake combat kit + apply max HP from live talents. */
  protected applyCombatKit(sessionId: string, player: PlayerState) {
    const talentBuild = this.talentBuildBySession.get(sessionId) ?? {};
    this.combat.syncSessionKit(sessionId, player.loadout, player.talents, talentBuild);
    const bonus = this.combat.getSessionKit(sessionId)?.maxHpBonus ?? 0;
    player.maxHp = PLAYER_BASE_MAX_HP + bonus;
    player.hp = Math.min(player.hp, player.maxHp);
  }

  protected async persistInventory(sessionId: string, player: PlayerState) {
    const identity = this.identities.get(sessionId);
    if (!identity || identity.isGuest) return;
    await saveInventory(
      identity.userId,
      this.walletOf(player),
      this.talentPointsBySession.get(sessionId),
    );
  }

  protected async persistUnlocks(sessionId: string, unlocks: PlayerUnlocks): Promise<boolean> {
    this.unlocksBySession.set(sessionId, unlocks);
    const identity = this.identities.get(sessionId);
    if (!identity || identity.isGuest) return true;
    return savePlayerUnlocks(identity.userId, unlocks);
  }

  protected debitShopCost(player: PlayerState, cost: ShopCost): boolean {
    const wallet = this.walletOf(player);
    if (!canAffordShopCost(wallet, cost)) return false;
    if (cost.kind === "coins") {
      const next = spendCoins(wallet, cost.copper);
      if (!next) return false;
      this.applyWallet(player, { ...next, essence: wallet.essence, rubies: wallet.rubies });
      return true;
    }
    if (cost.kind === "essence") {
      this.applyWallet(player, { ...wallet, essence: wallet.essence - cost.amount });
      return true;
    }
    this.applyWallet(player, { ...wallet, rubies: wallet.rubies - cost.amount });
    return true;
  }

  protected creditShopCost(player: PlayerState, cost: ShopCost): void {
    const wallet = this.walletOf(player);
    if (cost.kind === "coins") {
      this.applyWallet(player, {
        ...addCoins(wallet, { copper: cost.copper }),
        essence: wallet.essence,
        rubies: wallet.rubies,
      });
      return;
    }
    if (cost.kind === "essence") {
      this.applyWallet(player, { ...wallet, essence: wallet.essence + cost.amount });
      return;
    }
    this.applyWallet(player, { ...wallet, rubies: wallet.rubies + cost.amount });
  }

  protected alreadyOwnsGrant(unlocks: PlayerUnlocks, grant: ShopGrant): boolean {
    switch (grant.kind) {
      case "color":
        return ownsColor(unlocks.colors, grant.hex);
      case "pattern":
        return ownsPattern(unlocks.patterns, grant.patternId);
      case "pattern_color":
        return ownsPatternColor(unlocks.patternColors, grant.hex);
      case "cosmetic":
        return ownsCosmetic(unlocks.cosmetics, grant.itemId);
      case "emote":
        return ownsEmote(unlocks.emotes, grant.emoteId);
      case "loadout_slot":
        return unlocks.loadoutSlotCount >= grant.toCount;
      case "flex_slot":
        return unlocks.flexSlotCount >= grant.toCount;
      case "lobby_beach_ball":
        return this.lobbyGrantCount(grant) >= grant.toCount;
      case "consumable":
      case "item_stack":
        return false;
      default:
        return false;
    }
  }

  /** Validate owned abilities + slot rules; returns cleaned ids or null. */
  protected validateLoadoutAbilityIds(client: Client, abilityIds: string[]): string[] | null {
    const unlocks = this.unlocksOf(client.sessionId);
    const unknown = abilityIds.filter((id) => Boolean(id) && !(id in ABILITIES));
    if (unknown.length > 0) {
      client.send("toast", {
        message: `Unknown spell(s): ${unknown.join(", ")} — restart the game server if you just added them`,
      });
      return null;
    }
    const cleaned = abilityIds.filter((id) => id in ABILITIES);
    if (cleaned.length !== LOADOUT_SIZE) {
      client.send("toast", { message: `Assign all ${LOADOUT_SIZE} slots` });
      return null;
    }
    if (new Set(cleaned).size !== cleaned.length) {
      client.send("toast", { message: "Duplicate abilities not allowed" });
      return null;
    }
    for (let i = 0; i < LOADOUT_SIZE; i++) {
      const id = cleaned[i]!;
      if (!ownsAbility(unlocks.abilities, id)) {
        client.send("toast", { message: `Ability not unlocked: ${ABILITIES[id]?.name ?? id}` });
        return null;
      }
      const slotId = SPELL_SLOTS[i]!.id;
      if (!canEquipInSlot(id, slotId)) {
        client.send("toast", {
          message: `${ABILITIES[id]?.name ?? id} cannot go in ${SPELL_SLOTS[i]!.label}`,
        });
        return null;
      }
    }
    return normalizeLoadout(cleaned);
  }

  protected upsertPresetInSession(
    sessionId: string,
    slotIndex: number,
    abilityIds: string[],
    opts?: { name?: string; talentBuild?: TalentBuild; flexAbilityIds?: FlexLoadout },
  ) {
    const presets = [...(this.loadoutPresetsBySession.get(sessionId) ?? [])];
    const idx = presets.findIndex((p) => p.slotIndex === slotIndex);
    const existing = idx >= 0 ? presets[idx] : undefined;
    const row: LoadoutPresetRow = {
      slotIndex,
      name: opts?.name || existing?.name || `Loadout ${slotIndex + 1}`,
      abilityIds,
      talentBuild:
        opts?.talentBuild !== undefined
          ? normalizeTalentBuild(opts.talentBuild)
          : (existing?.talentBuild ?? {}),
      flexAbilityIds:
        opts?.flexAbilityIds !== undefined
          ? normalizeFlexLoadout(opts.flexAbilityIds)
          : (existing?.flexAbilityIds ?? [...EMPTY_FLEX_LOADOUT]),
    };
    if (idx >= 0) presets[idx] = row;
    else presets.push(row);
    presets.sort((a, b) => a.slotIndex - b.slotIndex);
    this.loadoutPresetsBySession.set(sessionId, presets);
    return row;
  }

  /**
   * Reduce raw flex picks to the ones that are actually castable: owned, in a
   * slot the player has bought, and not duplicating the main bar (a duplicate
   * shares its cooldown, so the flex copy would be dead weight).
   */
  protected resolveFlexForBar(
    picks: FlexLoadout,
    barAbilityIds: string[],
    unlocks: PlayerUnlocks,
  ): FlexLoadout {
    const onBar = new Set(barAbilityIds.filter(Boolean));
    const legal = normalizeFlexLoadout(picks).map((id) =>
      id && ownsAbility(unlocks.abilities, id) && !onBar.has(id) ? id : null,
    );
    return clampFlexToUnlocked(legal, unlocks.flexSlotCount);
  }

  /** Persist spells+talents for the active loadout preset. */
  protected async persistActiveLoadoutPreset(
    client: Client,
    abilityIds: string[],
    talentBuild: TalentBuild,
  ) {
    const activeSlot = this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0;
    const row = this.upsertPresetInSession(client.sessionId, activeSlot, abilityIds, {
      talentBuild,
    });
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveLoadoutPreset(identity.userId, activeSlot, abilityIds, {
        name: row.name,
        talentBuild,
        flexAbilityIds: row.flexAbilityIds,
      });
      await saveTalentBuild(identity.userId, talentBuild);
    }
  }

  protected applyCosmeticsEquipped(
    player: PlayerState,
    equipped: Parameters<typeof normalizeCosmeticsEquipped>[0],
  ) {
    const fields = cosmeticsEquippedToFields(normalizeCosmeticsEquipped(equipped));
    player.cosmeticHat = fields.cosmeticHat;
    player.cosmeticShoulders = fields.cosmeticShoulders;
    player.cosmeticChest = fields.cosmeticChest;
    player.cosmeticGloves = fields.cosmeticGloves;
    player.cosmeticBelt = fields.cosmeticBelt;
    player.cosmeticLegs = fields.cosmeticLegs;
    player.cosmeticShoes = fields.cosmeticShoes;
  }

  protected cosmeticsEquippedOf(player: PlayerState) {
    return cosmeticsEquippedFromFields({
      cosmeticHat: player.cosmeticHat,
      cosmeticShoulders: player.cosmeticShoulders,
      cosmeticChest: player.cosmeticChest,
      cosmeticGloves: player.cosmeticGloves,
      cosmeticBelt: player.cosmeticBelt,
      cosmeticLegs: player.cosmeticLegs,
      cosmeticShoes: player.cosmeticShoes,
    });
  }

  // ---------------------------------------------------------------------
  // Talents
  // ---------------------------------------------------------------------

  protected async handleBuyTalentPoints(client: Client, count: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const n = Math.max(1, Math.min(20, Math.floor(count)));
    const owned = this.talentPointsBySession.get(client.sessionId) ?? 0;
    const room = Math.max(0, TALENT_POINT_BUDGET - owned);
    if (room <= 0) {
      client.send("toast", { message: `Talent point cap reached (${TALENT_POINT_BUDGET})` });
      return;
    }
    const buy = Math.min(n, room);
    const cost = buy * ESSENCE_PER_TALENT_POINT;
    if (player.essence < cost) {
      client.send("toast", {
        message: `Need ${cost} essence (${ESSENCE_PER_TALENT_POINT} each)`,
      });
      return;
    }
    player.essence -= cost;
    const nextOwned = owned + buy;
    this.talentPointsBySession.set(client.sessionId, nextOwned);
    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Bought ${buy} talent point${buy === 1 ? "" : "s"} (−${cost} essence)`,
    });
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      // Approximate spent as owned − starter (floor 0).
      const spent = Math.max(0, nextOwned - STARTER_TALENT_POINTS);
      void bumpQuest(identity.userId, { type: "talent_points_spent", totalSpent: spent });
    }
  }

  protected async handleSetTalentBuild(client: Client, raw: TalentBuild) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const owned = this.talentPointsBySession.get(client.sessionId) ?? 0;
    const current = this.talentBuildBySession.get(client.sessionId) ?? {};
    let build = normalizeTalentBuild(raw);
    build = clampBuildToOwned(build, owned);
    if (totalPointsSpent(build) > Math.min(owned, TALENT_POINT_BUDGET)) {
      client.send("toast", { message: "Build exceeds owned talent points" });
      return;
    }
    if (!isTalentBuildValid(build, owned)) {
      client.send("toast", {
        message: "Invalid talent path — linked talents need a point in the previous node",
      });
      return;
    }
    const removed = talentPointsRemoved(current, build);
    const cost = talentRefundEssenceCost(removed);
    if (cost > 0 && player.essence < cost) {
      client.send("toast", {
        message: `Need ${cost} essence to respec (${removed} pt × ${ESSENCE_PER_TALENT_REFUND})`,
      });
      return;
    }
    if (cost > 0) player.essence -= cost;
    this.talentBuildBySession.set(client.sessionId, build);
    if (cost > 0) await this.persistInventory(client.sessionId, player);
    const abilityIds = normalizeLoadout(player.loadout.split(","));
    await this.persistActiveLoadoutPreset(client, abilityIds, build);
    this.applyCombatKit(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("toast", {
      message:
        cost > 0
          ? `Talent build saved (${totalPointsSpent(build)}/${owned} pts, −${cost} essence)`
          : `Talent build saved (${totalPointsSpent(build)}/${owned} pts)`,
    });
  }

  protected async handleResetTalentTree(client: Client, tree: TalentTreeId | undefined) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !tree || !(TALENT_TREE_IDS as readonly string[]).includes(tree)) return;
    const current = this.talentBuildBySession.get(client.sessionId) ?? {};
    const removed = treePointsSpent(current, tree);
    if (removed <= 0) {
      client.send("toast", { message: `No points invested in ${tree}` });
      return;
    }
    const next = clearTree(current, tree);
    const cost = talentRefundEssenceCost(removed);
    if (player.essence < cost) {
      client.send("toast", {
        message: `Need ${cost} essence to reset ${tree} (${removed} pt × ${ESSENCE_PER_TALENT_REFUND})`,
      });
      return;
    }
    player.essence -= cost;
    this.talentBuildBySession.set(client.sessionId, next);
    await this.persistInventory(client.sessionId, player);
    const abilityIds = normalizeLoadout(player.loadout.split(","));
    await this.persistActiveLoadoutPreset(client, abilityIds, next);
    this.applyCombatKit(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("toast", { message: `Reset ${tree} (−${cost} essence, ${removed} pt)` });
  }

  protected async handleSetTalents(client: Client, talentIds: string[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const cleaned = talentIds.filter((id) => id in TALENTS).slice(0, MAX_TALENTS);
    if (new Set(cleaned).size !== cleaned.length) {
      client.send("toast", { message: "Duplicate talents not allowed" });
      return;
    }

    player.talents = cleaned.join(",");
    this.applyCombatKit(client.sessionId, player);

    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) await saveTalents(identity.userId, cleaned);
    this.sendInventory(client, player);
    client.send("toast", { message: cleaned.length ? "Talents updated" : "Talents cleared" });
  }

  // ---------------------------------------------------------------------
  // Appearance
  // ---------------------------------------------------------------------

  protected async handleSetColor(client: Client, color: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!(COSMETIC_COLORS as readonly string[]).includes(color)) return;
    const unlocks = this.unlocksOf(client.sessionId);
    if (!ownsColor(unlocks.colors, color)) {
      client.send("toast", { message: "Body color not unlocked" });
      return;
    }
    player.color = color;
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      const ok = await saveProfileColor(identity.userId, color);
      client.send("toast", {
        message: ok ? "Body color saved to your account" : "Color applied (account save failed)",
      });
      return;
    }
    client.send("toast", { message: "Body color updated (sign in to save)" });
  }

  protected async handleSetPattern(client: Client, pattern: string, patternColor?: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const unlocks = this.unlocksOf(client.sessionId);
    const next = normalizeCosmeticPattern(pattern);
    if (!ownsPattern(unlocks.patterns, next)) {
      client.send("toast", { message: "Pattern not unlocked" });
      return;
    }
    if (patternColor != null) {
      const nextColor = normalizeCosmeticPatternColor(patternColor);
      if (!ownsPatternColor(unlocks.patternColors, nextColor)) {
        client.send("toast", { message: "Pattern color not unlocked" });
        return;
      }
      player.patternColor = nextColor;
    }
    player.pattern = next;
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      const ok = await saveProfileAppearance(identity.userId, {
        pattern: next,
        ...(patternColor != null
          ? { patternColor: normalizeCosmeticPatternColor(patternColor) }
          : {}),
      });
      client.send("toast", {
        message: ok ? `Pattern saved to your account` : `Pattern applied (account save failed)`,
      });
      return;
    }
    client.send("toast", { message: `Pattern: ${next} (sign in to save)` });
  }

  protected async handleSetPatternColor(client: Client, patternColor: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    await this.applyPatternColor(client, player, patternColor);
  }

  protected async applyPatternColor(client: Client, player: PlayerState, patternColor: string) {
    const unlocks = this.unlocksOf(client.sessionId);
    const next = normalizeCosmeticPatternColor(patternColor);
    if (!ownsPatternColor(unlocks.patternColors, next)) {
      client.send("toast", { message: "Pattern color not unlocked" });
      return;
    }
    player.patternColor = next;
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      const ok = await saveProfilePatternColor(identity.userId, next);
      client.send("toast", {
        message: ok
          ? "Pattern color saved to your account"
          : "Pattern color applied (account save failed)",
      });
      return;
    }
    client.send("toast", { message: "Pattern color updated (sign in to save)" });
  }

  protected async handleSetCosmetic(
    client: Client,
    slotRaw: string | undefined,
    itemId: string | null,
  ) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !slotRaw || !isCosmeticSlot(slotRaw)) return;
    const unlocks = this.unlocksOf(client.sessionId);
    const next = applyCosmeticEquip(
      this.cosmeticsEquippedOf(player),
      slotRaw,
      itemId,
      unlocks.cosmetics,
    );
    if (!next) {
      client.send("toast", { message: "Cannot equip that item" });
      return;
    }
    this.applyCosmeticsEquipped(player, next);
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      const ok = await saveProfileCosmeticsEquipped(identity.userId, next);
      client.send("toast", {
        message: ok ? "Outfit saved to your account" : "Outfit applied (account save failed)",
      });
      return;
    }
    client.send("toast", { message: "Outfit updated (sign in to save)" });
  }

  // ---------------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------------

  protected async handleShopBuy(client: Client, itemId: string) {
    const player = this.state.players.get(client.sessionId);
    const item = SHOP_ITEMS[itemId];
    if (!player || !item) {
      client.send("toast", { message: "Unknown item" });
      return;
    }

    const priorUnlocks = this.unlocksOf(client.sessionId);
    const unlocks = { ...priorUnlocks };
    unlocks.cosmetics = [...unlocks.cosmetics];
    unlocks.colors = [...unlocks.colors];
    unlocks.patterns = [...unlocks.patterns];
    unlocks.patternColors = [...unlocks.patternColors];
    unlocks.emotes = [...unlocks.emotes];
    unlocks.abilities = [...unlocks.abilities];
    unlocks.emoteSlots = [...unlocks.emoteSlots];

    if (item.grant.kind === "lobby_beach_ball") {
      const refusal = this.checkLobbyGrant(client, item.grant);
      if (refusal) {
        client.send("toast", { message: refusal });
        return;
      }
    }

    if (this.alreadyOwnsGrant(unlocks, item.grant)) {
      client.send("toast", { message: "Already owned" });
      return;
    }

    if (item.grant.kind === "loadout_slot") {
      if (
        unlocks.loadoutSlotCount >= item.grant.toCount ||
        item.grant.toCount > MAX_COIN_LOADOUT_SLOTS
      ) {
        client.send("toast", { message: "Loadout slot unavailable" });
        return;
      }
    }

    if (item.grant.kind === "flex_slot") {
      // Slots must be bought in order, so slot 3 always costs slot 2 first.
      if (
        item.grant.toCount > MAX_FLEX_SLOTS ||
        unlocks.flexSlotCount !== item.grant.toCount - 1
      ) {
        client.send("toast", {
          message:
            unlocks.flexSlotCount >= item.grant.toCount
              ? "Already unlocked"
              : "Unlock the previous flex slot first",
        });
        return;
      }
    }

    if (!this.debitShopCost(player, item.cost)) {
      client.send("toast", { message: `Need ${formatShopCost(item.cost)}` });
      return;
    }

    const grant = item.grant;
    let unlocksChanged = false;
    let toastMessage = `Bought ${item.name}`;

    switch (grant.kind) {
      case "consumable":
        if (grant.effect === "health_tonic") {
          player.hp = Math.min(player.maxHp, player.hp + HEALTH_TONIC_HEAL);
          toastMessage = "Health tonic — +25 HP";
        } else if (grant.effect === "copper_pouch") {
          this.applyWallet(player, {
            ...addCoins(this.walletOf(player), { copper: 80 }),
            essence: player.essence,
            rubies: player.rubies,
          });
          toastMessage = `+${formatCoins({ copper: 80, silver: 0, gold: 0 })}`;
        }
        break;
      case "color":
        if (!unlocks.colors.includes(grant.hex)) unlocks.colors.push(grant.hex);
        unlocksChanged = true;
        toastMessage = `Unlocked tint ${grant.hex}`;
        break;
      case "pattern":
        if (!unlocks.patterns.includes(grant.patternId)) {
          unlocks.patterns.push(grant.patternId);
        }
        unlocksChanged = true;
        toastMessage = `Unlocked pattern ${grant.patternId}`;
        break;
      case "pattern_color":
        if (!unlocks.patternColors.includes(grant.hex)) {
          unlocks.patternColors.push(grant.hex);
        }
        unlocksChanged = true;
        toastMessage = `Unlocked pattern ink ${grant.hex}`;
        break;
      case "cosmetic":
        if (!unlocks.cosmetics.includes(grant.itemId)) {
          unlocks.cosmetics.push(grant.itemId);
        }
        unlocksChanged = true;
        toastMessage = `Unlocked ${item.name}`;
        break;
      case "emote":
        if (!unlocks.emotes.includes(grant.emoteId)) {
          unlocks.emotes.push(grant.emoteId);
        }
        {
          const slots = [...normalizeEmoteSlots(unlocks.emoteSlots, unlocks.emotes)];
          if (!slots.includes(grant.emoteId)) {
            const empty = slots.findIndex((id) => id == null);
            if (empty >= 0) slots[empty] = grant.emoteId;
            else slots[0] = grant.emoteId;
          }
          unlocks.emoteSlots = normalizeEmoteSlots(slots, unlocks.emotes);
        }
        unlocksChanged = true;
        toastMessage = `Unlocked emote ${item.name}`;
        break;
      case "loadout_slot": {
        unlocks.loadoutSlotCount = Math.max(unlocks.loadoutSlotCount, grant.toCount);
        unlocksChanged = true;
        const slotIndex = grant.toCount - 1;
        const abilityIds = normalizeLoadout(player.loadout.split(","));
        const talentBuild = this.talentBuildBySession.get(client.sessionId) ?? {};
        this.upsertPresetInSession(client.sessionId, slotIndex, abilityIds, {
          name: `Loadout ${grant.toCount}`,
          talentBuild,
          flexAbilityIds: normalizeFlexLoadout(player.flexLoadout.split(",")),
        });
        const identity = this.identities.get(client.sessionId);
        if (identity && !identity.isGuest) {
          await saveLoadoutPreset(identity.userId, slotIndex, abilityIds, {
            name: `Loadout ${grant.toCount}`,
            talentBuild,
            flexAbilityIds: normalizeFlexLoadout(player.flexLoadout.split(",")),
          });
        }
        toastMessage = `Unlocked loadout preset slot ${grant.toCount}`;
        break;
      }
      case "flex_slot": {
        unlocks.flexSlotCount = Math.max(unlocks.flexSlotCount, grant.toCount);
        unlocksChanged = true;
        toastMessage = `Unlocked flex slot ${grant.toCount}`;
        break;
      }
      case "lobby_beach_ball": {
        const placed = await this.grantLobbyItem(client, grant);
        if (!placed) {
          this.creditShopCost(player, item.cost);
          client.send("toast", {
            message: "Purchase could not be saved — you were not charged",
          });
          await this.persistInventory(client.sessionId, player);
          this.sendInventory(client, player);
          return;
        }
        toastMessage =
          grant.toCount === 1
            ? "Beach ball placed in your lobby"
            : "Second beach ball placed in your lobby";
        break;
      }
      case "item_stack":
        break;
      default:
        break;
    }

    if (unlocksChanged) {
      const saved = await this.persistUnlocks(client.sessionId, unlocks);
      if (!saved) {
        this.unlocksBySession.set(client.sessionId, {
          ...priorUnlocks,
          cosmetics: [...priorUnlocks.cosmetics],
          colors: [...priorUnlocks.colors],
          patterns: [...priorUnlocks.patterns],
          patternColors: [...priorUnlocks.patternColors],
          emotes: [...priorUnlocks.emotes],
          abilities: [...priorUnlocks.abilities],
          emoteSlots: [...priorUnlocks.emoteSlots],
        });
        this.creditShopCost(player, item.cost);
        client.send("toast", {
          message: "Purchase could not be saved — you were not charged",
        });
        await this.persistInventory(client.sessionId, player);
        this.sendInventory(client, player);
        return;
      }
      await this.autoEquipShopGrant(client, player, grant);
    }

    client.send("toast", { message: toastMessage });
    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
  }

  /** After a look / gear unlock, apply it immediately so shop purchases feel usable. */
  protected async autoEquipShopGrant(client: Client, player: PlayerState, grant: ShopGrant) {
    const identity = this.identities.get(client.sessionId);
    const signedIn = Boolean(identity && !identity.isGuest);

    if (grant.kind === "color") {
      player.color = grant.hex;
      if (signedIn && identity) await saveProfileColor(identity.userId, grant.hex);
      return;
    }

    if (grant.kind === "pattern") {
      const next = normalizeCosmeticPattern(grant.patternId);
      player.pattern = next;
      if (signedIn && identity) {
        await saveProfileAppearance(identity.userId, {
          pattern: next,
          patternColor: player.patternColor,
        });
      }
      return;
    }

    if (grant.kind === "pattern_color") {
      const next = normalizeCosmeticPatternColor(grant.hex);
      if (player.pattern === "plain" || !player.pattern) {
        player.pattern = "scales";
      }
      player.patternColor = next;
      if (signedIn && identity) {
        await saveProfileAppearance(identity.userId, {
          pattern: player.pattern,
          patternColor: next,
        });
      }
      return;
    }

    if (grant.kind === "cosmetic") {
      const def = getCosmeticItem(grant.itemId);
      if (!def) return;
      const unlocks = this.unlocksOf(client.sessionId);
      const next = applyCosmeticEquip(
        this.cosmeticsEquippedOf(player),
        def.slot,
        def.id,
        unlocks.cosmetics,
      );
      if (!next) return;
      this.applyCosmeticsEquipped(player, next);
      if (signedIn && identity) {
        await saveProfileCosmeticsEquipped(identity.userId, next);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Spells and loadouts
  // ---------------------------------------------------------------------

  protected async handleUnlockAbility(client: Client, abilityId: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !abilityId || !(abilityId in ABILITIES)) {
      client.send("toast", { message: "Unknown ability" });
      return;
    }
    const unlocks = { ...this.unlocksOf(client.sessionId) };
    unlocks.abilities = [...unlocks.abilities];
    if (ownsAbility(unlocks.abilities, abilityId)) {
      client.send("toast", { message: "Already unlocked" });
      return;
    }
    const cost = abilityUnlockCostEssence(abilityId);
    if (cost <= 0) {
      client.send("toast", { message: "Ability is free" });
      return;
    }
    if (player.essence < cost) {
      client.send("toast", { message: `Need ${cost} essence` });
      return;
    }
    this.applyWallet(player, {
      ...this.walletOf(player),
      essence: player.essence - cost,
    });
    const priorAbilities = [...unlocks.abilities];
    unlocks.abilities.push(abilityId);
    const saved = await this.persistUnlocks(client.sessionId, unlocks);
    if (!saved) {
      this.unlocksBySession.set(client.sessionId, {
        ...unlocks,
        abilities: priorAbilities,
      });
      this.applyWallet(player, {
        ...this.walletOf(player),
        essence: player.essence + cost,
      });
      client.send("toast", {
        message: "Unlock could not be saved — you were not charged",
      });
      await this.persistInventory(client.sessionId, player);
      this.sendInventory(client, player);
      return;
    }
    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Unlocked ${ABILITIES[abilityId]?.name ?? abilityId} (−${cost} essence)`,
    });
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      void bumpQuest(identity.userId, {
        type: "spell_unlocked",
        totalOwned: unlocks.abilities.length,
      });
    }
  }

  protected async handleSetLoadout(client: Client, abilityIds: string[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const cleaned = this.validateLoadoutAbilityIds(client, abilityIds);
    if (!cleaned) return;

    player.loadout = cleaned.join(",");
    this.applyCombatKit(client.sessionId, player);

    const talentBuild = this.talentBuildBySession.get(client.sessionId) ?? {};
    try {
      await this.persistActiveLoadoutPreset(client, cleaned, talentBuild);
    } catch (err) {
      console.warn("[loadout] persist failed:", err);
    }
    this.sendInventory(client, player);
  }

  /**
   * Flex picks are validated against ownership only -- there is no per-slot
   * legality to check, since any spell may sit in any flex slot. What the
   * client sends is normalised rather than rejected, so a stale tab cannot
   * wedge the panel; the authoritative result comes straight back on the
   * inventory message.
   */
  protected async handleSetFlexLoadout(client: Client, abilityIds: (string | null)[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const unlocks = this.unlocksOf(client.sessionId);
    const barAbilityIds = normalizeLoadout(player.loadout.split(","));
    const cleaned = this.resolveFlexForBar(abilityIds, barAbilityIds, unlocks);

    player.flexLoadout = cleaned.map((id) => id ?? "").join(",");

    // Flex picks belong to the preset, so they follow it the way spells and
    // talents do rather than trailing behind on the account.
    const activeSlot = this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0;
    const row = this.upsertPresetInSession(client.sessionId, activeSlot, barAbilityIds, {
      flexAbilityIds: cleaned,
    });
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      try {
        await saveLoadoutPreset(identity.userId, activeSlot, barAbilityIds, {
          name: row.name,
          talentBuild: row.talentBuild,
          flexAbilityIds: cleaned,
        });
      } catch (err) {
        console.warn("[flex] persist failed:", err);
      }
    }

    this.sendInventory(client, player);
  }

  protected async handleSaveLoadoutPreset(
    client: Client,
    slotIndexRaw: number,
    abilityIds: string[],
    name?: string,
  ) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const unlocks = this.unlocksOf(client.sessionId);
    const slotIndex = Math.floor(slotIndexRaw);
    if (slotIndex < 0 || slotIndex >= unlocks.loadoutSlotCount) {
      client.send("toast", { message: "Loadout slot locked" });
      return;
    }
    const cleaned = this.validateLoadoutAbilityIds(client, abilityIds);
    if (!cleaned) return;

    const talentBuild =
      slotIndex === (this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0)
        ? (this.talentBuildBySession.get(client.sessionId) ?? {})
        : (this.loadoutPresetsBySession
            .get(client.sessionId)
            ?.find((p) => p.slotIndex === slotIndex)?.talentBuild ?? {});

    const row = this.upsertPresetInSession(client.sessionId, slotIndex, cleaned, {
      name,
      talentBuild,
    });
    const activeSlot = this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0;
    if (slotIndex === activeSlot) {
      player.loadout = cleaned.join(",");
      this.applyCombatKit(client.sessionId, player);
    }

    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveLoadoutPreset(identity.userId, slotIndex, cleaned, {
        name: row.name,
        talentBuild,
        // Upsert rewrites the row, so an omitted column would come back as its
        // default and silently clear the preset's flex picks.
        flexAbilityIds: row.flexAbilityIds,
      });
    }
    this.sendInventory(client, player);
    client.send("toast", { message: `Saved ${row.name}` });
  }

  protected async handleSelectLoadoutPreset(client: Client, slotIndexRaw: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const unlocks = this.unlocksOf(client.sessionId);
    const slotIndex = Math.floor(slotIndexRaw);
    if (slotIndex < 0 || slotIndex >= unlocks.loadoutSlotCount) {
      client.send("toast", { message: "Loadout slot locked" });
      return;
    }
    const presets = this.loadoutPresetsBySession.get(client.sessionId) ?? [];
    const preset = presets.find((p) => p.slotIndex === slotIndex);
    const abilityIds = normalizeLoadout(preset?.abilityIds ?? DEFAULT_LOADOUT.slice());
    for (let i = 0; i < LOADOUT_SIZE; i++) {
      const id = abilityIds[i]!;
      if (!ownsAbility(unlocks.abilities, id) || !canEquipInSlot(id, SPELL_SLOTS[i]!.id)) {
        client.send("toast", { message: "Preset has locked abilities" });
        return;
      }
    }

    const owned = this.talentPointsBySession.get(client.sessionId) ?? 0;
    const talentBuild = sanitizeTalentBuild(preset?.talentBuild ?? {}, owned);

    this.activeLoadoutSlotBySession.set(client.sessionId, slotIndex);
    player.loadout = abilityIds.join(",");
    const flex = this.resolveFlexForBar(
      preset?.flexAbilityIds ?? EMPTY_FLEX_LOADOUT,
      abilityIds,
      unlocks,
    );
    player.flexLoadout = flex.map((id) => id ?? "").join(",");
    this.talentBuildBySession.set(client.sessionId, talentBuild);
    this.applyCombatKit(client.sessionId, player);

    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveActiveLoadoutSlot(identity.userId, slotIndex);
      await saveLoadout(identity.userId, abilityIds);
      await saveTalentBuild(identity.userId, talentBuild);
    }
    this.sendInventory(client, player);
    client.send("toast", {
      message: `${preset?.name ?? `Loadout ${slotIndex + 1}`} selected (spells + talents)`,
    });
  }

  protected async handleSetEmoteLoadout(client: Client, emoteSlots: (string | null)[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const unlocks = { ...this.unlocksOf(client.sessionId) };
    unlocks.emoteSlots = normalizeEmoteSlots(emoteSlots, unlocks.emotes);
    await this.persistUnlocks(client.sessionId, unlocks);
    this.sendInventory(client, player);
    client.send("toast", { message: "Emote wheel saved" });
  }

  // ---------------------------------------------------------------------
  // Quests and chests
  // ---------------------------------------------------------------------

  protected async handleHubQuests(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest) {
      client.send("hub_quests_state", { quests: [], chests: [] });
      return;
    }
    const [progress, chests, season] = await Promise.all([
      listQuestProgress(identity.userId),
      listClosedChests(identity.userId),
      getActiveSeason(),
    ]);
    const progressMap = new Map(
      progress.map((p) => [`${p.quest_id}:${p.period_key}`, p] as const),
    );
    const quests = QUEST_CATALOG.map((q) => {
      const period = questPeriodKey(q, new Date(), season?.id ?? null);
      const row = progressMap.get(`${q.id}:${period}`);
      return {
        id: q.id,
        label: q.label,
        type: q.type,
        target: q.target,
        chest: q.chest,
        progress: row?.progress ?? 0,
        completed: Boolean(row?.completed_at),
      };
    });
    client.send("hub_quests_state", { quests, chests });
  }

  protected async handleHubOpenChest(client: Client, chestId: string | undefined) {
    const identity = this.identities.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!identity || identity.isGuest || !player || !chestId) {
      client.send("toast", { message: "Cannot open chest" });
      client.send("hub_chest_opened", { ok: false });
      return;
    }
    const unlocks = this.unlocksOf(client.sessionId);
    const result = await openChest(identity.userId, chestId, {
      cosmetics: unlocks.cosmetics,
      colors: unlocks.colors,
      patterns: unlocks.patterns,
      patternColors: unlocks.patternColors,
      emotes: unlocks.emotes,
    });
    if (!result.ok) {
      client.send("toast", { message: result.error ?? "Open failed" });
      client.send("hub_chest_opened", { ok: false });
      await this.handleHubQuests(client);
      return;
    }

    const coins = addCoins(this.walletOf(player), {
      copper: result.copper ?? 0,
      silver: 0,
      gold: 0,
    });
    this.applyWallet(player, {
      ...coins,
      essence: player.essence + (result.essence ?? 0),
      rubies: player.rubies,
    });

    const essenceGain = result.essence ?? 0;
    const copperGain = result.copper ?? 0;
    if (essenceGain > 0) {
      await bumpQuest(identity.userId, { type: "essence_earned", amount: essenceGain });
    }
    if (copperGain > 0) {
      await bumpQuest(identity.userId, { type: "copper_earned", amount: copperGain });
    }

    if (result.grants?.length) {
      const next = { ...unlocks };
      next.cosmetics = [...unlocks.cosmetics];
      next.colors = [...unlocks.colors];
      next.patterns = [...unlocks.patterns];
      next.patternColors = [...unlocks.patternColors];
      next.emotes = [...unlocks.emotes];
      next.emoteSlots = [...unlocks.emoteSlots];
      for (const grant of result.grants) {
        switch (grant.kind) {
          case "color":
            if (!next.colors.includes(grant.hex)) next.colors.push(grant.hex);
            break;
          case "pattern":
            if (!next.patterns.includes(grant.patternId)) next.patterns.push(grant.patternId);
            break;
          case "pattern_color":
            if (!next.patternColors.includes(grant.hex)) next.patternColors.push(grant.hex);
            break;
          case "cosmetic":
            if (!next.cosmetics.includes(grant.itemId)) next.cosmetics.push(grant.itemId);
            break;
          case "emote":
            if (!next.emotes.includes(grant.emoteId)) next.emotes.push(grant.emoteId);
            next.emoteSlots = normalizeEmoteSlots(next.emoteSlots, next.emotes);
            break;
        }
      }
      await this.persistUnlocks(client.sessionId, next);
    }

    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("hub_chest_opened", {
      ok: true,
      quality: result.quality,
      essence: result.essence ?? 0,
      copper: result.copper ?? 0,
      lines: result.lines ?? [],
      grants: result.grants ?? [],
    });
    await this.handleHubQuests(client);
  }
}
