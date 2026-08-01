import { Room, Client } from "@colyseus/core";
import {
  ABILITIES,
  COSMETIC_COLORS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  DEFAULT_LOADOUT,
  ESSENCE_PER_TALENT_POINT,
  ESSENCE_PER_TALENT_REFUND,
  HEALTH_TONIC_HEAL,
  HUB_SPAWN,
  INTERACT,
  LOADOUT_SIZE,
  MAX_COIN_LOADOUT_SLOTS,
  MAX_TALENTS,
  PLAYER_BASE_MAX_HP,
  RESPAWN_LOCK_MS,
  SHOP_ITEMS,
  SPELL_SLOTS,
  STARTER_COLORS,
  STARTER_TALENT_POINTS,
  STARTER_WALLET,
  TALENTS,
  TALENT_POINT_BUDGET,
  TALENT_TREE_IDS,
  TICK_MS,
  abilityUnlockCostEssence,
  addCoins,
  applyMovement,
  applyYaw,
  HAND_SHIELD_CAST,
  canAffordShopCost,
  canEquipInSlot,
  clampBuildToOwned,
  clearTree,
  emptyPlayerUnlocks,
  formatCoins,
  formatShopCost,
  formatWallet,
  getEmote,
  HUB_PORTALS,
  HUB_PRACTICE_DUMMIES,
  HUB_STANDS,
  normalizeCoins,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeCosmeticsEquipped,
  normalizeEmoteSlots,
  cosmeticsEquippedFromFields,
  cosmeticsEquippedToFields,
  applyCosmeticEquip,
  isCosmeticSlot,
  normalizeLoadout,
  normalizeTalentBuild,
  ownsAbility,
  ownsColor,
  ownsCosmetic,
  ownsEmote,
  ownsPattern,
  ownsPatternColor,
  phaseDurationMs,
  QUEST_CATALOG,
  questPeriodKey,
  resolvePveTransfer,
  spendCoins,
  baseCityStaticColliders,
  pointInInteractZone,
  totalPointsSpent,
  talentPointsRemoved,
  talentRefundEssenceCost,
  treePointsSpent,
  type PlayerInput,
  type PlayerUnlocks,
  type PvpSeat,
  type ShopCost,
  type ShopGrant,
  type TalentBuild,
  type TalentTreeId,
  type Wallet,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions, type VerifiedIdentity } from "../auth.js";
import { dequeuePvpParty, dequeuePvpSession, enqueuePvpParty, resolvePartyAvgMmr, startDirectPvpMatch, type PvpPartyMember } from "../matchmaking/pvpQueue.js";
import {
  HubPartyRegistry,
  defaultSeatFor,
  filterModesForHubSize,
  isFullPremadeLobby,
  partyFitsMode,
  toPartySnapshot,
  type HubParty,
} from "../matchmaking/hubParty.js";
import { getActiveSeason, getHubRankedState, getRankedLeaderboard } from "../ranked.js";
import {
  claimPendingRewardGrants,
  insertRewardGrant,
  loadEconomy,
  loadIntroCompleted,
  saveActiveLoadoutSlot,
  saveInventory,
  saveLoadout,
  saveLoadoutPreset,
  savePlayerUnlocks,
  saveProfileColor,
  saveProfileCosmeticsEquipped,
  saveProfilePatternColor,
  saveProfileAppearance,
  saveTalentBuild,
  saveTalents,
  setIntroCompleted,
  softResetCharacter,
  type LoadoutPresetRow,
} from "../persistence.js";
import { takePendingLoot } from "../pendingLoot.js";
import { ADMIN_GRANT_MAX_PER_FIELD, isAdminEmail } from "../admin.js";
import {
  bumpQuest,
  findReferralForInvitee,
  insertClosedChest,
  listClosedChests,
  listQuestProgress,
  openChest,
} from "../quests.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

const DUMMY_BOLT_GAP_MS = 420;
/** Drop aggro if the dummy hasn't been damaged for this long. */
const DUMMY_DEAGGRO_MS = 5000;
/** How often to re-broadcast the hub roster even without a join/leave event. */
const HUB_ROSTER_BROADCAST_MS = 5000;
/** Close code Colyseus treats as a consented (no-reconnect-window) leave. */
const WS_CLOSE_CONSENTED = 4000;

type DummyAggro = {
  attackerId: string;
  /** When the next cast windup may begin. */
  nextCastAt: number;
  /** Fire bolt at this time (0 = no pending release). */
  pendingReleaseAt: number;
  pendingAimYaw: number;
  /** Last time this dummy took damage from its aggro target. */
  lastHitAt: number;
};

export class BaseCityRoom extends Room<BaseCityState> {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private ownerId: string | null = null;
  private identities = new Map<string, VerifiedIdentity>();
  private dummyAggro = new Map<string, DummyAggro>();
  /** Join / soft spawn pose — respawn returns here. */
  private spawnBySession = new Map<string, { x: number; z: number; yaw: number }>();
  /** Epoch ms when the player hit 0 HP (respawn gate). */
  private diedAtBySession = new Map<string, number>();
  private combat!: CombatSystem;
  /** Hub-scoped party lobbies (invite/seat/mode selection prior to PvP queueing). */
  private parties = new HubPartyRegistry();
  private lastHubRosterBroadcastAt = 0;
  /** Owned talent points + ranked catalog build (not schema-synced). */
  private talentPointsBySession = new Map<string, number>();
  private talentBuildBySession = new Map<string, TalentBuild>();
  private unlocksBySession = new Map<string, PlayerUnlocks>();
  private loadoutPresetsBySession = new Map<string, LoadoutPresetRow[]>();
  private activeLoadoutSlotBySession = new Map<string, number>();
  /** Emote anti-spam / active window (epoch ms). */
  private emoteUntilBySession = new Map<string, number>();

  onCreate(options: AuthJoinOptions) {
    this.setState(new BaseCityState());
    this.ownerId = options.hubOwnerId ?? null;
    this.combat = new CombatSystem(this as never, {
      canHurtPlayers: false,
      onPlayerDamaged: (sessionId) => {
        const player = this.state.players.get(sessionId);
        if (player && player.hp <= 0) {
          this.onPlayerDied(sessionId, player);
        }
      },
      onTargetDamaged: (targetId, _damage, attackerSessionId) => {
        if (!targetId.startsWith("practice_dummy")) return;
        const def = HUB_PRACTICE_DUMMIES.find((d) => d.id === targetId);
        // Left pad is passive practice; right dummy fights back.
        if (def?.retaliates !== false) {
          const now = Date.now();
          const prev = this.dummyAggro.get(targetId);
          this.dummyAggro.set(targetId, {
            attackerId: attackerSessionId,
            nextCastAt: prev?.nextCastAt ?? now + 180,
            pendingReleaseAt: prev?.pendingReleaseAt ?? 0,
            pendingAimYaw: prev?.pendingAimYaw ?? 0,
            lastHitAt: now,
          });
        }
      },
      onTargetKilled: (targetId) => {
        this.clearDummyCast(targetId);
        this.dummyAggro.delete(targetId);
      },
    });
    for (const d of HUB_PRACTICE_DUMMIES) {
      this.combat.ensurePracticeDummy(d.x, d.z, d.id, d.rotationY ?? 0);
    }
    this.combat.setStaticColliders(baseCityStaticColliders());
    this.setPatchRate(1000 / 30);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);

    this.onMessage("input", (client, message: { input: PlayerInput }) => {
      const queue = this.inputs.get(client.sessionId);
      if (!queue || !message?.input) return;
      queue.push(message.input);
      if (queue.length > 64) queue.shift();
    });

    this.onMessage("set_color", (client, message: { color: string }) => {
      void this.handleSetColor(client, message.color);
    });
    this.onMessage("set_pattern", (client, message: { pattern: string; patternColor?: string }) => {
      void this.handleSetPattern(client, message.pattern, message.patternColor);
    });
    this.onMessage("set_pattern_color", (client, message: { patternColor: string }) => {
      void this.handleSetPatternColor(client, message.patternColor);
    });
    this.onMessage("set_cosmetic", (client, message: { slot?: string; itemId?: string | null }) => {
      void this.handleSetCosmetic(client, message.slot, message.itemId ?? null);
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

    this.onMessage("cast_emote", (client, message: { emoteId?: string }) => {
      this.handleCastEmote(client, message?.emoteId ?? "");
    });

    this.onMessage("cancel_emote", (client) => {
      this.handleCancelEmote(client);
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

    this.onMessage(
      "portal_confirm",
      (
        client,
        message: { portal: "pvp" | "pve"; params?: { modes?: string[]; content?: string; modifiers?: string[] } },
      ) => {
        this.handlePortalConfirm(client, message);
      },
    );

    this.onMessage("queue_cancel", (client) => {
      const party = this.parties.getBySession(client.sessionId);
      if (party) {
        this.unqueueParty(party, "Left queue");
        return;
      }
      if (dequeuePvpSession(this.queueKey(client))) {
        client.send("queue_status", { queued: false });
        client.send("toast", { message: "Left queue" });
      }
    });

    this.onMessage("hub_kick", (client, message: { sessionId?: string }) => {
      this.handleHubKick(client, message?.sessionId);
    });

    this.onMessage(
      "hub_grant_resources",
      (
        client,
        message: {
          targetSessionId?: string;
          essence?: number;
          copper?: number;
          silver?: number;
          gold?: number;
        },
      ) => {
        void this.handleHubGrantResources(client, message);
      },
    );

    this.onMessage("hub_quests", (client) => {
      void this.handleHubQuests(client);
    });

    this.onMessage("hub_open_chest", (client, message: { chestId?: string }) => {
      void this.handleHubOpenChest(client, message?.chestId);
    });

    this.onMessage("hub_spawn_chest", (client, message: { quality?: string }) => {
      void this.handleHubSpawnChest(client, message?.quality);
    });

    this.onMessage("hub_intro_complete", (client) => {
      void this.handleHubIntroComplete(client);
    });

    this.onMessage("hub_intro_begin", (client) => {
      this.handleHubIntroBegin(client);
    });

    this.onMessage("hub_replay_intro", (client) => {
      void this.handleHubReplayIntro(client);
    });

    this.onMessage("hub_soft_reset_character", (client) => {
      void this.handleHubSoftResetCharacter(client);
    });

    this.onMessage("hub_admin_no_cooldown", (client, message: { enabled?: boolean }) => {
      this.handleHubAdminNoCooldown(client, message?.enabled);
    });

    this.onMessage("hub_friend_code_redeemed", (client) => {
      void this.handleFriendCodeRedeemed(client);
    });

    this.onMessage("party_invite", (client, message: { sessionId?: string }) => {
      this.handlePartyInvite(client, message?.sessionId);
    });

    this.onMessage("party_invite_friend", (client, message: { userId?: string }) => {
      this.handlePartyInviteFriend(client, message?.userId);
    });

    this.onMessage("party_respond", (client, message: { accept?: boolean; partyId?: string }) => {
      this.handlePartyRespond(client, message);
    });

    this.onMessage("party_kick", (client, message: { sessionId?: string }) => {
      this.handlePartyKick(client, message?.sessionId);
    });

    this.onMessage(
      "party_set_seat",
      (client, message: { sessionId?: string; seat?: PvpSeat }) => {
        this.handlePartySetSeat(client, message);
      },
    );

    this.onMessage("party_set_modes", (client, message: { modes?: string[] }) => {
      this.handlePartySetModes(client, message?.modes ?? []);
    });

    this.onMessage("party_lock", (client, message?: { matchKind?: "ranked" | "unranked" }) => {
      void this.handlePartyLock(client, message?.matchKind ?? "ranked");
    });

    this.onMessage("hub_ranked_request", (client) => {
      void this.handleRankedRequest(client);
    });

    this.onMessage("hub_ranked_leaderboard", (client) => {
      void this.handleRankedLeaderboard(client);
    });

    this.onMessage("party_leave", (client) => {
      this.handlePartyLeave(client);
    });

    this.onMessage("party_cancel", (client) => {
      this.handlePartyCancel(client);
    });

    this.onMessage("respawn", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;
      const diedAt = this.diedAtBySession.get(client.sessionId) ?? 0;
      if (Date.now() < diedAt + RESPAWN_LOCK_MS) return;
      this.softRespawnPlayer(client.sessionId, player);
    });
  }

  async onAuth(_client: Client, options: AuthJoinOptions) {
    if (!options.hubOwnerId) {
      throw new Error("hubOwnerId is required");
    }
    return verifyJoinOptions(options);
  }

  async onJoin(client: Client, options: AuthJoinOptions, identity?: VerifiedIdentity) {
    if (!identity || identity.isGuest) {
      throw new Error("Authentication required");
    }
    const verified = identity;

    // Match return / soft-leave races can leave a prior seat for the same hunter.
    this.evictSessionsForUser(verified.userId, client.sessionId);

    this.identities.set(client.sessionId, verified);

    const player = new PlayerState();
    player.id = verified.userId;
    player.displayName = verified.displayName;
    player.x = HUB_SPAWN.x + (Math.random() - 0.5) * 1.2;
    player.z = HUB_SPAWN.z + (Math.random() - 0.5) * 1.2;
    player.loadout = DEFAULT_LOADOUT.join(",");
    player.talents = "";
    this.talentPointsBySession.set(client.sessionId, STARTER_TALENT_POINTS);
    this.talentBuildBySession.set(client.sessionId, {});

    if (verified.isGuest) {
      const unlocks = emptyPlayerUnlocks();
      this.unlocksBySession.set(client.sessionId, unlocks);
      this.loadoutPresetsBySession.set(client.sessionId, [
        {
          slotIndex: 0,
          name: "Loadout 1",
          abilityIds: [...DEFAULT_LOADOUT],
          talentBuild: {},
        },
      ]);
      this.activeLoadoutSlotBySession.set(client.sessionId, 0);
      const starter = normalizeCoins(STARTER_WALLET);
      player.copper = starter.copper;
      player.silver = starter.silver;
      player.gold = starter.gold;
      player.essence = STARTER_WALLET.essence;
      player.rubies = STARTER_WALLET.rubies;
      player.color =
        verified.color && ownsColor(unlocks.colors, verified.color)
          ? verified.color
          : STARTER_COLORS[0]!;
      player.pattern = DEFAULT_COSMETIC_PATTERN;
      player.patternColor = DEFAULT_COSMETIC_PATTERN_COLOR;
    } else {
      const eco = await loadEconomy(verified.userId);
      player.copper = eco.copper;
      player.silver = eco.silver;
      player.gold = eco.gold;
      player.essence = eco.essence;
      player.rubies = eco.rubies;
      player.loadout = normalizeLoadout(eco.abilityIds).join(",");
      player.talents = eco.talentIds.slice(0, MAX_TALENTS).join(",");
      this.talentPointsBySession.set(client.sessionId, eco.talentPoints);
      this.talentBuildBySession.set(client.sessionId, eco.talentBuild);
      this.unlocksBySession.set(client.sessionId, eco.unlocks);
      this.loadoutPresetsBySession.set(client.sessionId, eco.loadoutPresets);
      this.activeLoadoutSlotBySession.set(client.sessionId, eco.activeLoadoutSlot);
      const preferredColor =
        eco.color && ownsColor(eco.unlocks.colors, eco.color)
          ? eco.color
          : verified.color && ownsColor(eco.unlocks.colors, verified.color)
            ? verified.color
            : STARTER_COLORS[0]!;
      player.color = preferredColor;
      player.pattern = ownsPattern(eco.unlocks.patterns, eco.pattern ?? "")
        ? normalizeCosmeticPattern(eco.pattern)
        : DEFAULT_COSMETIC_PATTERN;
      player.patternColor = ownsPatternColor(eco.unlocks.patternColors, eco.patternColor ?? "")
        ? normalizeCosmeticPatternColor(eco.patternColor)
        : DEFAULT_COSMETIC_PATTERN_COLOR;
      this.applyCosmeticsEquipped(player, eco.cosmeticsEquipped ?? {});
    }

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);
    this.spawnBySession.set(client.sessionId, {
      x: player.x,
      z: player.z,
      yaw: player.yaw,
    });

    const dbLoot = await claimPendingRewardGrants(verified.userId);
    const memLoot = takePendingLoot(verified.userId);
    const loot = dbLoot
      ? {
          copper: dbLoot.copper ?? 0,
          silver: dbLoot.silver ?? 0,
          gold: dbLoot.gold ?? 0,
          essence: dbLoot.essence ?? 0,
          rubies: dbLoot.rubies ?? 0,
        }
      : memLoot;
    if (
      loot &&
      (loot.copper > 0 ||
        loot.silver > 0 ||
        loot.gold > 0 ||
        loot.essence > 0 ||
        (loot.rubies ?? 0) > 0)
    ) {
      const coins = addCoins(this.walletOf(player), loot);
      this.applyWallet(player, {
        ...coins,
        essence: player.essence + loot.essence,
        rubies: player.rubies + (loot.rubies ?? 0),
      });
      void this.persistInventory(client.sessionId, player);
      client.send("toast", {
        message: `Loot: ${formatWallet({ ...loot, rubies: loot.rubies ?? 0 })}`,
      });
    }

    if (!this.ownerId) this.ownerId = options.hubOwnerId ?? verified.userId;

    this.applyCombatKit(client.sessionId, player);

    const visiting = this.ownerId && verified.userId !== this.ownerId;
    client.send("toast", {
      message: visiting
        ? `Visiting hub`
        : `Welcome home, ${verified.displayName}`,
    });
    this.sendInventory(client, player);
    this.broadcastHubRoster();
    if (isAdminEmail(verified.email)) {
      client.send("hub_you_are_admin", { admin: true });
    }

    // Hub owner intro flag — visitors never get the cinematic.
    if (!visiting) {
      const introCompleted = await loadIntroCompleted(verified.userId);
      client.send("hub_intro_status", { completed: introCompleted });
    } else {
      client.send("hub_intro_status", { completed: true });
    }

    // Catch soft-leave ghosts that survived eviction (collision without a model).
    this.purgeDuplicateUserSeats(client.sessionId);
    this.tryJoinPendingParty(client);
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.disconnected = true;

    try {
      if (!consented) {
        // Keep seat + party through reload; only strip after grace expires.
        await this.allowReconnection(client, 60);
        player.disconnected = false;
        return;
      }
    } catch {
      // reconnection window expired
    }

    // Flush unlocks before seat teardown (covers failed mid-session saves / late schema).
    const unlocks = this.unlocksBySession.get(client.sessionId);
    if (unlocks) {
      await this.persistUnlocks(client.sessionId, unlocks);
    }
    await this.persistInventory(client.sessionId, player);

    this.stripPlayerSession(client.sessionId);
  }

  /** Remove a hub seat and related combat/party bookkeeping. */
  private stripPlayerSession(sessionId: string) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) dequeuePvpSession(this.queueKey(client));
    this.removeFromAnyParty(sessionId);
    this.state.players.delete(sessionId);
    this.inputs.delete(sessionId);
    this.identities.delete(sessionId);
    this.spawnBySession.delete(sessionId);
    this.diedAtBySession.delete(sessionId);
    this.talentPointsBySession.delete(sessionId);
    this.talentBuildBySession.delete(sessionId);
    this.unlocksBySession.delete(sessionId);
    this.loadoutPresetsBySession.delete(sessionId);
    this.activeLoadoutSlotBySession.delete(sessionId);
    this.emoteUntilBySession.delete(sessionId);
    this.combat.clearSession(sessionId);
    this.broadcastHubRoster();
  }

  /**
   * Drop every other seat owned by this account (including soft-leave ghosts).
   * Prevents a frozen duplicate host body after returning from a match.
   */
  private evictSessionsForUser(userId: string, exceptSessionId: string) {
    if (!userId) return;
    for (const [sessionId, player] of [...this.state.players.entries()]) {
      if (sessionId === exceptSessionId) continue;
      if (player.id !== userId) continue;
      const stale = this.clients.find((c) => c.sessionId === sessionId);
      // Strip schema first so onLeave is a no-op if the socket close is non-consented.
      this.stripPlayerSession(sessionId);
      stale?.leave(WS_CLOSE_CONSENTED, "Replaced by newer hub session");
    }
  }

  /**
   * If a hunter already has a live (connected) seat, strip every other seat for that
   * account — including soft-leave ghosts that still occupy collision space.
   */
  private purgeDuplicateUserSeats(preferSessionId?: string) {
    const liveByUser = new Map<string, string>();
    for (const [sessionId, player] of this.state.players.entries()) {
      if (!player.id || player.disconnected) continue;
      const existing = liveByUser.get(player.id);
      if (!existing || sessionId === preferSessionId) {
        liveByUser.set(player.id, sessionId);
      }
    }
    for (const [sessionId, player] of [...this.state.players.entries()]) {
      if (!player.id) continue;
      const keep = liveByUser.get(player.id);
      if (!keep || keep === sessionId) continue;
      const stale = this.clients.find((c) => c.sessionId === sessionId);
      this.stripPlayerSession(sessionId);
      stale?.leave(WS_CLOSE_CONSENTED, "Duplicate hub seat");
    }
  }

  private queueKey(client: Client) {
    return `${this.roomId}:${client.sessionId}`;
  }

  private walletOf(player: PlayerState): Wallet {
    return {
      copper: player.copper,
      silver: player.silver,
      gold: player.gold,
      essence: player.essence,
      rubies: player.rubies,
    };
  }

  private applyWallet(player: PlayerState, wallet: Wallet) {
    const coins = normalizeCoins(wallet);
    player.copper = coins.copper;
    player.silver = coins.silver;
    player.gold = coins.gold;
    player.essence = wallet.essence;
    player.rubies = Math.max(0, wallet.rubies ?? 0);
  }

  private unlocksOf(sessionId: string): PlayerUnlocks {
    return this.unlocksBySession.get(sessionId) ?? emptyPlayerUnlocks();
  }

  private sendInventory(client: Client, player: PlayerState) {
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
      talents: player.talents.split(",").filter(Boolean),
      talentBuild: this.talentBuildBySession.get(client.sessionId) ?? {},
      unlocks: this.unlocksOf(client.sessionId),
      loadoutPresets: this.loadoutPresetsBySession.get(client.sessionId) ?? [],
      activeLoadoutSlot: this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0,
    });
  }

  /** Bake combat kit + apply max HP from live talents. */
  private applyCombatKit(sessionId: string, player: PlayerState) {
    const talentBuild = this.talentBuildBySession.get(sessionId) ?? {};
    this.combat.syncSessionKit(sessionId, player.loadout, player.talents, talentBuild);
    const bonus = this.combat.getSessionKit(sessionId)?.maxHpBonus ?? 0;
    player.maxHp = PLAYER_BASE_MAX_HP + bonus;
    player.hp = Math.min(player.hp, player.maxHp);
  }

  private async persistInventory(sessionId: string, player: PlayerState) {
    const identity = this.identities.get(sessionId);
    if (!identity || identity.isGuest) return;
    await saveInventory(
      identity.userId,
      this.walletOf(player),
      this.talentPointsBySession.get(sessionId),
    );
  }

  private async persistUnlocks(sessionId: string, unlocks: PlayerUnlocks): Promise<boolean> {
    this.unlocksBySession.set(sessionId, unlocks);
    const identity = this.identities.get(sessionId);
    if (!identity || identity.isGuest) return true;
    return savePlayerUnlocks(identity.userId, unlocks);
  }

  private debitShopCost(player: PlayerState, cost: ShopCost): boolean {
    const wallet = this.walletOf(player);
    if (!canAffordShopCost(wallet, cost)) return false;
    if (cost.kind === "coins") {
      const next = spendCoins(wallet, cost.copper);
      if (!next) return false;
      this.applyWallet(player, { ...next, essence: wallet.essence, rubies: wallet.rubies });
      return true;
    }
    if (cost.kind === "essence") {
      this.applyWallet(player, {
        ...wallet,
        essence: wallet.essence - cost.amount,
      });
      return true;
    }
    this.applyWallet(player, {
      ...wallet,
      rubies: wallet.rubies - cost.amount,
    });
    return true;
  }

  private creditShopCost(player: PlayerState, cost: ShopCost): void {
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
      this.applyWallet(player, {
        ...wallet,
        essence: wallet.essence + cost.amount,
      });
      return;
    }
    this.applyWallet(player, {
      ...wallet,
      rubies: wallet.rubies + cost.amount,
    });
  }

  private alreadyOwnsGrant(unlocks: PlayerUnlocks, grant: ShopGrant): boolean {
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
      case "consumable":
      case "item_stack":
        return false;
      default:
        return false;
    }
  }

  /** Validate owned abilities + slot rules; returns cleaned ids or null. */
  private validateLoadoutAbilityIds(
    client: Client,
    abilityIds: string[],
  ): string[] | null {
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

  private upsertPresetInSession(
    sessionId: string,
    slotIndex: number,
    abilityIds: string[],
    opts?: { name?: string; talentBuild?: TalentBuild },
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
          : existing?.talentBuild ?? {},
    };
    if (idx >= 0) presets[idx] = row;
    else presets.push(row);
    presets.sort((a, b) => a.slotIndex - b.slotIndex);
    this.loadoutPresetsBySession.set(sessionId, presets);
    return row;
  }

  /** Persist spells+talents for the active loadout preset (and optional account talent mirror). */
  private async persistActiveLoadoutPreset(
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
      });
      await saveTalentBuild(identity.userId, talentBuild);
    }
  }

  private async handleBuyTalentPoints(client: Client, count: number) {
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

  private async handleSetTalentBuild(client: Client, raw: TalentBuild) {
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

  private async handleResetTalentTree(client: Client, tree: TalentTreeId | undefined) {
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
    client.send("toast", {
      message: `Reset ${tree} (−${cost} essence, ${removed} pt)`,
    });
  }

  private async handleSetColor(client: Client, color: string) {
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

  private async handleSetPattern(
    client: Client,
    pattern: string,
    patternColor?: string,
  ) {
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

  private async handleSetPatternColor(client: Client, patternColor: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    await this.applyPatternColor(client, player, patternColor);
  }

  private async applyPatternColor(
    client: Client,
    player: PlayerState,
    patternColor: string,
  ) {
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

  private applyCosmeticsEquipped(
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

  private cosmeticsEquippedOf(player: PlayerState) {
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

  private async handleSetCosmetic(
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

  private async handleShopBuy(client: Client, itemId: string) {
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
        unlocks.emoteSlots = normalizeEmoteSlots(unlocks.emoteSlots, unlocks.emotes);
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
        });
        const identity = this.identities.get(client.sessionId);
        if (identity && !identity.isGuest) {
          await saveLoadoutPreset(identity.userId, slotIndex, abilityIds, {
            name: `Loadout ${grant.toCount}`,
            talentBuild,
          });
        }
        toastMessage = `Unlocked loadout preset slot ${grant.toCount}`;
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
    }

    client.send("toast", { message: toastMessage });
    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
  }

  private async handleUnlockAbility(client: Client, abilityId: string) {
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

  private async handleSetLoadout(client: Client, abilityIds: string[]) {
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

  private async handleSaveLoadoutPreset(
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
        : (this.loadoutPresetsBySession.get(client.sessionId)?.find((p) => p.slotIndex === slotIndex)
            ?.talentBuild ?? {});

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
      });
    }
    this.sendInventory(client, player);
    client.send("toast", { message: `Saved ${row.name}` });
  }

  private async handleSelectLoadoutPreset(client: Client, slotIndexRaw: number) {
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
    let talentBuild = normalizeTalentBuild(preset?.talentBuild ?? {});
    talentBuild = clampBuildToOwned(talentBuild, owned);

    this.activeLoadoutSlotBySession.set(client.sessionId, slotIndex);
    player.loadout = abilityIds.join(",");
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

  private async handleSetEmoteLoadout(client: Client, emoteSlots: (string | null)[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const unlocks = { ...this.unlocksOf(client.sessionId) };
    unlocks.emoteSlots = normalizeEmoteSlots(emoteSlots, unlocks.emotes);
    await this.persistUnlocks(client.sessionId, unlocks);
    this.sendInventory(client, player);
    client.send("toast", { message: "Emote wheel saved" });
  }

  private handleCastEmote(client: Client, emoteId: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.hp <= 0 || !emoteId) return;
    const unlocks = this.unlocksOf(client.sessionId);
    if (!ownsEmote(unlocks.emotes, emoteId)) {
      client.send("toast", { message: "Emote not unlocked" });
      return;
    }
    if (!unlocks.emoteSlots.includes(emoteId)) {
      client.send("toast", { message: "Emote not on wheel" });
      return;
    }
    const def = getEmote(emoteId);
    if (!def) return;
    const now = Date.now();
    const until = this.emoteUntilBySession.get(client.sessionId) ?? 0;
    if (now < until - 200) {
      // Allow recast near end; soft anti-spam while active
      return;
    }
    this.emoteUntilBySession.set(client.sessionId, now + def.durationMs);
    this.broadcast("emote_fx", {
      sessionId: client.sessionId,
      emoteId,
      phase: "start",
    });
  }

  private handleCancelEmote(client: Client) {
    if (!this.state.players.get(client.sessionId)) return;
    this.emoteUntilBySession.delete(client.sessionId);
    this.broadcast("emote_fx", {
      sessionId: client.sessionId,
      emoteId: "",
      phase: "cancel",
    });
  }

  private async handleSetTalents(client: Client, talentIds: string[]) {
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

  private handlePortalConfirm(
    client: Client,
    message: { portal: "pvp" | "pve"; params?: { modes?: string[]; content?: string; modifiers?: string[] } },
  ) {
    if (!message?.portal) return;

    if (message.portal === "pvp") {
      this.handleOpenPvpParty(client, (message.params?.modes ?? []).filter(Boolean));
      return;
    }

    const contentId = message.params?.content ?? "dungeon";
    const modifiers = message.params?.modifiers ?? [];
    const transfer = resolvePveTransfer(contentId);
    client.send("transfer", {
      room: transfer.room,
      options: {
        mode: transfer.mode,
        modifiers,
        hubOwnerId: this.ownerId,
        matchId: `pve_${transfer.mode}_${client.sessionId}`,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Hub roster / hub owner kick
  // ---------------------------------------------------------------------

  private handleHubKick(client: Client, targetSessionId: string | undefined) {
    const kicker = this.state.players.get(client.sessionId);
    if (!kicker || !this.ownerId || kicker.id !== this.ownerId) {
      client.send("toast", { message: "Only the hub owner can kick" });
      return;
    }
    if (!targetSessionId || targetSessionId === client.sessionId) return;

    const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
    const targetPlayer = this.state.players.get(targetSessionId);
    if (!targetClient || !targetPlayer) return;
    if (targetPlayer.id === this.ownerId) return; // never kick the owner

    this.removeFromAnyParty(targetSessionId, "Removed from hub — party updated");
    targetClient.send("toast", { message: "You were kicked from this hub" });
    targetClient.leave(WS_CLOSE_CONSENTED, "Kicked by hub owner");
  }

  private async handleHubQuests(client: Client) {
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

  private async handleHubOpenChest(client: Client, chestId: string | undefined) {
    const identity = this.identities.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!identity || identity.isGuest || !player || !chestId) {
      client.send("toast", { message: "Cannot open chest" });
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
      await bumpQuest(identity.userId, {
        type: "essence_earned",
        amount: essenceGain,
      });
    }
    if (copperGain > 0) {
      await bumpQuest(identity.userId, {
        type: "copper_earned",
        amount: copperGain,
      });
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

  private async handleHubSpawnChest(client: Client, qualityRaw: string | undefined) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest || !isAdminEmail(identity.email)) {
      client.send("toast", { message: "Not authorized" });
      return;
    }
    const quality = (qualityRaw ?? "").toLowerCase();
    if (!["green", "blue", "purple", "legendary"].includes(quality)) {
      client.send("toast", { message: "Pick a chest rarity" });
      return;
    }
    const result = await insertClosedChest(
      identity.userId,
      quality as "green" | "blue" | "purple" | "legendary",
      "admin:spawn",
    );
    if (!result.ok) {
      client.send("toast", { message: result.error ?? "Spawn failed" });
      return;
    }
    client.send("toast", { message: `Spawned ${quality} chest` });
    void this.handleHubQuests(client);
  }

  /** Place hub owner at the House stand facing the village for the intro. */
  private handleHubIntroBegin(client: Client) {
    const identity = this.identities.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!identity || !player) return;
    if (this.ownerId && identity.userId !== this.ownerId) return;

    const house = HUB_STANDS.find((s) => s.kind === "customization") ?? HUB_STANDS[0];
    if (!house) return;
    const portal = HUB_PORTALS.find((p) => p.kind === "pvp") ?? HUB_PORTALS[0];
    const lookX = portal?.x ?? HUB_SPAWN.x;
    const lookZ = portal?.z ?? HUB_SPAWN.z;
    player.x = house.x;
    player.z = house.z;
    // Face portal, then ~25° left so the House reads behind the clone.
    player.yaw = Math.atan2(lookX - house.x, lookZ - house.z) + (-25 * Math.PI) / 180;
    this.spawnBySession.set(client.sessionId, {
      x: player.x,
      z: player.z,
      yaw: player.yaw,
    });
    client.send("hub_intro_posed", { x: player.x, z: player.z, yaw: player.yaw });
  }

  private async handleHubIntroComplete(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest) return;
    if (this.ownerId && identity.userId !== this.ownerId) return;
    await setIntroCompleted(identity.userId, true);
    client.send("hub_intro_status", { completed: true });
  }

  private async handleHubReplayIntro(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest || !isAdminEmail(identity.email)) {
      client.send("toast", { message: "Not authorized" });
      return;
    }
    await setIntroCompleted(identity.userId, false);
    client.send("hub_intro_status", { completed: false, replay: true });
    client.send("toast", { message: "Intro ready to replay" });
  }

  private handleHubAdminNoCooldown(client: Client, enabledRaw: boolean | undefined) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest || !isAdminEmail(identity.email)) {
      client.send("toast", { message: "Not authorized" });
      return;
    }
    const enabled = Boolean(enabledRaw);
    const active = this.combat.setNoCooldowns(client.sessionId, enabled);
    client.send("hub_admin_no_cooldown", { enabled: active });
    client.send("toast", {
      message: active ? "Cooldowns disabled" : "Cooldowns restored",
    });
  }

  private async handleHubSoftResetCharacter(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest || !isAdminEmail(identity.email)) {
      client.send("toast", { message: "Not authorized" });
      return;
    }
    const result = await softResetCharacter(identity.userId);
    if (!result.ok || !result.economy) {
      client.send("toast", { message: result.error ?? "Reset failed" });
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const eco = result.economy;
    player.copper = eco.copper;
    player.silver = eco.silver;
    player.gold = eco.gold;
    player.essence = eco.essence;
    player.rubies = eco.rubies;
    player.loadout = normalizeLoadout(eco.abilityIds).join(",");
    player.talents = "";
    this.talentPointsBySession.set(client.sessionId, eco.talentPoints);
    this.talentBuildBySession.set(client.sessionId, eco.talentBuild);
    this.unlocksBySession.set(client.sessionId, eco.unlocks);
    this.loadoutPresetsBySession.set(client.sessionId, eco.loadoutPresets);
    this.activeLoadoutSlotBySession.set(client.sessionId, eco.activeLoadoutSlot);
    this.applyCosmeticsEquipped(player, {});
    player.color =
      eco.color && ownsColor(eco.unlocks.colors, eco.color)
        ? eco.color
        : STARTER_COLORS[0]!;
    player.pattern = ownsPattern(eco.unlocks.patterns, eco.pattern ?? "")
      ? (eco.pattern as string)
      : DEFAULT_COSMETIC_PATTERN;
    player.patternColor = ownsPatternColor(eco.unlocks.patternColors, eco.patternColor ?? "")
      ? (eco.patternColor as string)
      : DEFAULT_COSMETIC_PATTERN_COLOR;
    this.applyCombatKit(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("hub_intro_status", { completed: false, replay: true });
    client.send("toast", { message: "Character soft-reset — intro will replay" });
    void this.handleHubQuests(client);
  }

  private async handleFriendCodeRedeemed(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest) return;
    const inviterId = await findReferralForInvitee(identity.userId);
    if (!inviterId) {
      client.send("toast", { message: "No referral found" });
      return;
    }
    void bumpQuest(identity.userId, { type: "friend_code_redeemed" });
    void bumpQuest(inviterId, { type: "friend_referral_credited" });
    client.send("toast", { message: "Friend code quest progress updated" });
  }

  private async handleHubGrantResources(
    client: Client,
    message: {
      targetSessionId?: string;
      essence?: number;
      copper?: number;
      silver?: number;
      gold?: number;
    },
  ) {
    const identity = this.identities.get(client.sessionId);
    if (!isAdminEmail(identity?.email)) {
      client.send("hub_grant_result", { ok: false, error: "Not authorized" });
      return;
    }
    const targetSessionId = message?.targetSessionId;
    if (!targetSessionId) {
      client.send("hub_grant_result", { ok: false, error: "Missing target" });
      return;
    }
    const targetPlayer = this.state.players.get(targetSessionId);
    const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
    if (!targetPlayer || !targetClient) {
      client.send("hub_grant_result", { ok: false, error: "Player not in hub" });
      return;
    }

    const clamp = (n: unknown) => {
      const v = typeof n === "number" ? n : Number(n);
      if (!Number.isFinite(v) || v < 0) return 0;
      return Math.min(ADMIN_GRANT_MAX_PER_FIELD, Math.floor(v));
    };
    const grant = {
      essence: clamp(message.essence),
      copper: clamp(message.copper),
      silver: clamp(message.silver),
      gold: clamp(message.gold),
    };
    if (!(grant.essence || grant.copper || grant.silver || grant.gold)) {
      client.send("hub_grant_result", { ok: false, error: "Enter at least one amount" });
      return;
    }

    const coins = addCoins(this.walletOf(targetPlayer), grant);
    this.applyWallet(targetPlayer, {
      ...coins,
      essence: targetPlayer.essence + grant.essence,
      rubies: targetPlayer.rubies,
    });
    void this.persistInventory(targetSessionId, targetPlayer);
    this.sendInventory(targetClient, targetPlayer);

    const sourceKey = `admin:${Date.now()}:${client.sessionId}:${targetPlayer.id}`;
    if (targetPlayer.id && !targetPlayer.id.startsWith("guest_")) {
      void insertRewardGrant(
        targetPlayer.id,
        "admin_grant",
        sourceKey,
        {
          ...grant,
          meta: { from: identity?.userId, fromEmail: identity?.email },
        },
        "claimed",
      );
    }

    const label = formatWallet({ ...grant, rubies: 0 });
    client.send("hub_grant_result", {
      ok: true,
      targetSessionId,
      displayName: targetPlayer.displayName,
      grant,
    });
    client.send("toast", { message: `Granted ${label} to ${targetPlayer.displayName}` });
    if (targetClient.sessionId !== client.sessionId) {
      targetClient.send("toast", { message: `Admin granted you ${label}` });
    }
  }

  private broadcastHubRoster() {
    const players = [...this.state.players.entries()]
      .filter(([, p]) => !p.disconnected)
      .map(([sessionId, p]) => ({
        sessionId,
        userId: p.id,
        displayName: p.displayName,
        isOwner: Boolean(this.ownerId && p.id === this.ownerId),
      }));
    this.broadcast("hub_roster", { players });
    this.lastHubRosterBroadcastAt = Date.now();
  }

  // ---------------------------------------------------------------------
  // Hub party lobby (invite / seats / modes) — feeds the PvP queue.
  // ---------------------------------------------------------------------

  private sendToSession(sessionId: string, type: string, payload: unknown) {
    const target = this.clients.find((c) => c.sessionId === sessionId);
    target?.send(type, payload);
  }

  private broadcastPartyUpdate(party: HubParty) {
    const snapshot = toPartySnapshot(party);
    for (const sessionId of party.members.keys()) {
      this.sendToSession(sessionId, "party_update", { party: snapshot });
    }
  }

  private broadcastToParty(party: HubParty, type: string, payload: unknown) {
    for (const sessionId of party.members.keys()) {
      this.sendToSession(sessionId, type, payload);
    }
  }

  /** Removes a queued party from matchmaking without dissolving it (composition changed). */
  private unqueueParty(party: HubParty, reason: string) {
    if (!party.queued) return;
    dequeuePvpParty(party.partyId);
    party.queued = false;
    for (const sessionId of party.members.keys()) {
      this.sendToSession(sessionId, "queue_status", { queued: false });
      this.sendToSession(sessionId, "toast", { message: reason });
    }
  }

  /** Tears the party down for everyone currently in it (leader leave / cancel / last member gone). */
  private dissolveParty(party: HubParty, reason: string) {
    const sessionIds = [...party.members.keys()];
    if (party.queued) dequeuePvpParty(party.partyId);
    this.parties.dissolve(party);
    for (const sessionId of sessionIds) {
      this.sendToSession(sessionId, "party_update", { party: null });
      this.sendToSession(sessionId, "queue_status", { queued: false });
      this.sendToSession(sessionId, "toast", { message: reason });
    }
  }

  /** Disconnect / hub_kick path: leaves any party the session belongs to. */
  private removeFromAnyParty(sessionId: string, reason = "A hunter left the party") {
    const party = this.parties.getBySession(sessionId);
    if (!party) return;

    if (party.leaderSessionId === sessionId || party.members.size <= 1) {
      this.dissolveParty(party, reason);
      return;
    }

    this.unqueueParty(party, "Party changed — re-lock to queue again");
    this.parties.removeMember(party, sessionId);
    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", { message: reason });
  }

  private handleOpenPvpParty(client: Client, requestedModes: string[]) {
    if (requestedModes.length === 0) {
      client.send("toast", { message: "Pick at least one PvP mode" });
      return;
    }

    const existing = this.parties.getBySession(client.sessionId);
    if (existing && existing.leaderSessionId === client.sessionId) {
      this.dissolveParty(existing, "Party replaced by a new portal request");
    } else if (existing) {
      client.send("toast", { message: "Leave your current party before opening a new one" });
      return;
    }

    const identity = this.identities.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!identity || !player) return;

    const { validModes, rejectedModes } = filterModesForHubSize(requestedModes, this.state.players.size);
    if (validModes.length === 0) {
      client.send("toast", { message: "No selected mode fits the current hub size" });
      return;
    }

    const party = this.parties.create(
      { sessionId: client.sessionId, userId: identity.userId, displayName: identity.displayName },
      validModes,
    );

    // Everyone already in this hub is pulled into the party lobby (no per-hunter invites).
    for (const [sessionId, hubPlayer] of this.state.players.entries()) {
      if (sessionId === client.sessionId || hubPlayer.disconnected) continue;
      const otherParty = this.parties.getBySession(sessionId);
      if (otherParty && otherParty.partyId !== party.partyId) {
        this.removeFromAnyParty(sessionId, "Pulled into the hub party lobby");
      }
      if (this.parties.hasAnyParty(sessionId)) continue;
      const memberId = this.identities.get(sessionId);
      if (!memberId) continue;
      this.parties.addMember(
        party,
        {
          sessionId,
          userId: memberId.userId,
          displayName: memberId.displayName,
        },
        defaultSeatFor(party),
      );
    }

    this.broadcastPartyUpdate(party);
    const suffix =
      rejectedModes.length > 0 ? ` (${rejectedModes.join(", ")} dropped — hub too small)` : "";
    this.broadcastToParty(party, "toast", {
      message: `Party lobby — ${validModes.join(", ")}${suffix}. Set seats, invite friends, then lock.`,
    });
    this.broadcastToParty(party, "ui", { ui: "party_lobby" });
  }

  /**
   * Invite a friend by account id. If they are already in this hub, pull them into the party.
   * Otherwise mark them pending — when they accept a hub invite and join, they auto-enter.
   */
  private handlePartyInviteFriend(client: Client, friendUserId: string | undefined) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can invite" });
      return;
    }
    if (!friendUserId || friendUserId === this.identities.get(client.sessionId)?.userId) return;
    if (party.queued) {
      client.send("toast", { message: "Party is already queued" });
      return;
    }

    const alreadyMember = [...party.members.values()].some((m) => m.userId === friendUserId);
    if (alreadyMember) {
      client.send("toast", { message: "Already in your party" });
      return;
    }

    const inHub = [...this.state.players.entries()].find(
      ([, p]) => !p.disconnected && p.id === friendUserId,
    );
    if (inHub) {
      const [sessionId] = inHub;
      if (this.parties.hasAnyParty(sessionId)) {
        client.send("toast", { message: "That hunter is already in a party" });
        return;
      }
      const memberId = this.identities.get(sessionId);
      if (!memberId) return;
      this.parties.addMember(
        party,
        {
          sessionId,
          userId: memberId.userId,
          displayName: memberId.displayName,
        },
        defaultSeatFor(party),
      );
      this.broadcastPartyUpdate(party);
      this.sendToSession(sessionId, "ui", { ui: "party_lobby" });
      this.broadcastToParty(party, "toast", {
        message: `${memberId.displayName} joined the party`,
      });
      return;
    }

    party.pendingFriendInvites.add(friendUserId);
    this.broadcastPartyUpdate(party);
    client.send("toast", {
      message: "Invite sent — they'll join the party lobby when they enter the hub",
    });
  }

  /** After hub join: honor a pending friend invite into an open (non-queued) party. */
  private tryJoinPendingParty(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest) return;
    if (this.parties.hasAnyParty(client.sessionId)) return;

    const party = this.parties.findByPendingFriend(identity.userId);
    if (!party || party.queued) return;

    party.pendingFriendInvites.delete(identity.userId);
    this.parties.addMember(
      party,
      {
        sessionId: client.sessionId,
        userId: identity.userId,
        displayName: identity.displayName,
      },
      defaultSeatFor(party),
    );
    this.broadcastPartyUpdate(party);
    client.send("ui", { ui: "party_lobby" });
    this.broadcastToParty(party, "toast", {
      message: `${identity.displayName} joined the party`,
    });
  }

  private handlePartyInvite(client: Client, targetSessionId: string | undefined) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can invite" });
      return;
    }
    if (!targetSessionId || targetSessionId === client.sessionId) return;
    if (!this.state.players.has(targetSessionId)) {
      client.send("toast", { message: "Hunter not found in hub" });
      return;
    }
    if (party.members.has(targetSessionId)) {
      client.send("toast", { message: "Already in your party" });
      return;
    }
    if (this.parties.hasAnyParty(targetSessionId)) {
      client.send("toast", { message: "That hunter is already in a party" });
      return;
    }

    party.pendingInvites.add(targetSessionId);
    const leaderName = this.identities.get(client.sessionId)?.displayName ?? "A hunter";
    this.sendToSession(targetSessionId, "party_invite", {
      partyId: party.partyId,
      fromName: leaderName,
      modes: [...party.modes],
    });
    this.broadcastPartyUpdate(party);
    client.send("toast", { message: "Invite sent" });
  }

  private handlePartyRespond(client: Client, message: { accept?: boolean; partyId?: string }) {
    const party = message?.partyId ? this.parties.get(message.partyId) : undefined;
    if (!party || !party.pendingInvites.has(client.sessionId)) {
      client.send("toast", { message: "Invite expired" });
      return;
    }
    party.pendingInvites.delete(client.sessionId);

    if (!message.accept) {
      this.broadcastPartyUpdate(party);
      this.sendToSession(party.leaderSessionId, "toast", {
        message: `${this.identities.get(client.sessionId)?.displayName ?? "A hunter"} declined the invite`,
      });
      return;
    }

    if (party.queued) {
      client.send("toast", { message: "That party is already queued" });
      return;
    }
    if (this.parties.hasAnyParty(client.sessionId)) {
      client.send("toast", { message: "Leave your current party first" });
      return;
    }

    const identity = this.identities.get(client.sessionId);
    if (!identity) return;
    const seat = defaultSeatFor(party);
    this.parties.addMember(
      party,
      { sessionId: client.sessionId, userId: identity.userId, displayName: identity.displayName },
      seat,
    );
    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", { message: `${identity.displayName} joined the party` });
  }

  private handlePartyKick(client: Client, targetSessionId: string | undefined) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can kick" });
      return;
    }
    if (!targetSessionId || targetSessionId === client.sessionId) return;
    if (!party.members.has(targetSessionId)) return;

    this.unqueueParty(party, "Party changed — re-lock to queue again");
    this.parties.removeMember(party, targetSessionId);
    this.sendToSession(targetSessionId, "party_update", { party: null });
    this.sendToSession(targetSessionId, "toast", { message: "Removed from party" });
    this.broadcastPartyUpdate(party);
  }

  private handlePartySetSeat(client: Client, message: { sessionId?: string; seat?: PvpSeat }) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party) return;

    const targetSessionId = message?.sessionId ?? client.sessionId;
    const isLeader = party.leaderSessionId === client.sessionId;
    if (!isLeader && targetSessionId !== client.sessionId) {
      client.send("toast", { message: "You can only change your own seat" });
      return;
    }

    const member = party.members.get(targetSessionId);
    const seat = message?.seat;
    if (!member || (seat !== "teamA" && seat !== "teamB" && seat !== "spectator")) return;
    if (party.queued) {
      client.send("toast", { message: "Party is queued — cancel to change seats" });
      return;
    }

    member.seat = seat;
    this.broadcastPartyUpdate(party);
  }

  private handlePartySetModes(client: Client, modes: string[]) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can change modes" });
      return;
    }
    if (party.queued) {
      client.send("toast", { message: "Party is queued — cancel to change modes" });
      return;
    }

    const { validModes } = filterModesForHubSize(modes.filter(Boolean), this.state.players.size);
    if (validModes.length === 0) {
      client.send("toast", { message: "No selected mode fits the current hub size" });
      return;
    }

    party.modes = validModes;
    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", { message: `Modes updated: ${validModes.join(", ")}` });
  }

  private async handleRankedRequest(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest) {
      client.send("hub_ranked_state", { season: null, rating: null, label: null });
      return;
    }
    const state = await getHubRankedState(identity.userId);
    client.send("hub_ranked_state", state ?? { season: null, rating: null, label: null });
  }

  private async handleRankedLeaderboard(client: Client) {
    const rows = await getRankedLeaderboard(100);
    client.send("hub_ranked_leaderboard", { rows });
  }

  private async handlePartyLock(client: Client, matchKind: "ranked" | "unranked") {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can lock the queue" });
      return;
    }
    if (party.queued) return;

    const feasibleModes = party.modes.filter((mode) => partyFitsMode(party, mode));
    if (feasibleModes.length === 0) {
      client.send("toast", { message: "Party composition doesn't fit any selected mode — adjust seats" });
      return;
    }

    const members: PvpPartyMember[] = [];
    const partyLobbyHub =
      this.ownerId ??
      party.members.get(party.leaderSessionId)?.userId ??
      null;
    for (const member of party.members.values()) {
      const memberClient = this.clients.find((c) => c.sessionId === member.sessionId);
      if (!memberClient) continue;
      members.push({
        key: this.queueKey(memberClient),
        client: memberClient,
        userId: member.userId,
        seat: member.seat,
        hubOwnerId:
          party.members.size > 1 ? (partyLobbyHub ?? member.userId) : member.userId,
      });
    }
    if (members.length === 0) return;

    party.modes = feasibleModes;

    const primaryMode = feasibleModes[0]!;
    const fullPremade = feasibleModes.some((m) => isFullPremadeLobby(party, m));
    const fullMode = feasibleModes.find((m) => isFullPremadeLobby(party, m)) ?? primaryMode;

    if (matchKind === "unranked" && !fullPremade) {
      client.send("toast", { message: "Unranked requires a full lobby (both teams filled)" });
      return;
    }

    const fighterIds = members.filter((m) => m.seat !== "spectator").map((m) => m.userId);
    const avgMmr = await resolvePartyAvgMmr(fighterIds);

    if (fullPremade) {
      party.queued = true;
      this.broadcastPartyUpdate(party);
      try {
        await startDirectPvpMatch(
          fullMode as "arena_1v1" | "arena_2v2" | "arena_3v3" | "battleground",
          { partyId: party.partyId, modes: [fullMode], members, avgMmr },
          matchKind === "unranked" ? "custom" : "ranked",
        );
      } catch (err) {
        console.error("[party] direct start failed", err);
        party.queued = false;
        this.broadcastPartyUpdate(party);
        client.send("toast", { message: "Could not start match" });
      }
      return;
    }

    // Partial lobby → ranked queue only
    party.queued = true;
    enqueuePvpParty({ partyId: party.partyId, modes: feasibleModes, members, avgMmr });
    this.broadcastPartyUpdate(party);
  }

  private handlePartyLeave(client: Client) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party) return;

    if (party.leaderSessionId === client.sessionId) {
      this.dissolveParty(party, "Party leader left — party disbanded");
      return;
    }

    const name = this.identities.get(client.sessionId)?.displayName ?? "A hunter";
    this.unqueueParty(party, "Party changed — re-lock to queue again");
    this.parties.removeMember(party, client.sessionId);
    this.sendToSession(client.sessionId, "party_update", { party: null });
    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", { message: `${name} left the party` });
  }

  private handlePartyCancel(client: Client) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can cancel the party" });
      return;
    }
    this.dissolveParty(party, "Party cancelled");
  }

  private tick(dtMs: number) {
    const dt = dtMs / 1000;
    this.state.tick += 1;
    const now = Date.now();

    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.disconnected) continue;

      const queue = this.inputs.get(sessionId) ?? [];
      while (queue.length > 0) {
        const input = queue.shift()!;
        player.lastInputSeq = input.seq;
        if (player.hp <= 0) continue;

        const speed = this.combat.getEffectiveMoveSpeed(sessionId);
        const from = { x: player.x, z: player.z };
        const desired = applyMovement(
          from,
          { moveX: input.moveX, moveZ: input.moveZ, dt: input.dt || dt },
          speed,
        );
        const next = this.combat.movePlayer(sessionId, from, desired);
        player.x = next.x;
        player.z = next.z;
        const shieldTurning = this.combat.statuses.has(sessionId, "handShielding");
        player.yaw = applyYaw(
          player.yaw,
          input.yaw,
          input.dt || dt,
          shieldTurning ? HAND_SHIELD_CAST.yawTurnRate : undefined,
        );

        if (input.aimX != null && input.aimZ != null) {
          this.combat.refreshCastAim(sessionId, input.aimX, input.aimZ);
        }
        if (input.cancelCast) {
          this.combat.tryCancelCast(sessionId, player, now);
        }
        if (input.confirmCast) {
          this.combat.tryConfirmCast(sessionId, player, now);
        }
        if (input.castId) {
          this.combat.tryBeginCast(sessionId, player, input.castId, now, {
            moveX: input.moveX,
            moveZ: input.moveZ,
            aimX: input.aimX,
            aimZ: input.aimZ,
          });
        }

        if (input.interactId) {
          this.handleInteract(sessionId, player, input.interactId, now);
        }
      }
    }

    this.combat.tick(dt, now);
    this.tickDummyAggro(now);

    if (now - this.lastHubRosterBroadcastAt >= HUB_ROSTER_BROADCAST_MS) {
      this.broadcastHubRoster();
      this.purgeDuplicateUserSeats();
    }
  }

  /** Aggro'd practice dummies cast bolt (with anim) at their attacker until death. */
  private clearDummyCast(dummyId: string) {
    const dummy = this.state.targets.get(dummyId);
    if (!dummy) return;
    dummy.castAbilityId = "";
    dummy.castPhase = "";
    dummy.castLockUntil = 0;
  }

  private clearAllDummyAggro() {
    for (const dummyId of this.dummyAggro.keys()) {
      this.clearDummyCast(dummyId);
    }
    this.dummyAggro.clear();
  }

  /** Soft-death: clear combat state; body stays until client requests respawn. */
  private onPlayerDied(sessionId: string, player: PlayerState) {
    if (!this.diedAtBySession.has(sessionId)) {
      this.diedAtBySession.set(sessionId, Date.now());
    }
    player.castAbilityId = "";
    player.castPhase = "";
    player.castLockUntil = 0;
    player.castPhaseEndsAt = 0;
    player.castComboHit = 0;
    player.invulnerable = false;
    player.statuses.clear();
    this.combat.clearSession(sessionId);
    // Drop dummy aggro without auto-respawning.
    for (const [dummyId, aggro] of [...this.dummyAggro.entries()]) {
      if (aggro.attackerId === sessionId) {
        this.clearDummyCast(dummyId);
        this.dummyAggro.delete(dummyId);
      }
    }
  }

  /** Full HP at last spawn; clears combat leftover. */
  private softRespawnPlayer(sessionId: string, player: PlayerState) {
    const spawn = this.spawnBySession.get(sessionId) ?? {
      x: HUB_SPAWN.x,
      z: HUB_SPAWN.z,
      yaw: 0,
    };
    player.hp = player.maxHp;
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.castAbilityId = "";
    player.castPhase = "";
    player.castLockUntil = 0;
    player.castPhaseEndsAt = 0;
    player.castComboHit = 0;
    player.invulnerable = false;
    player.statuses.clear();
    this.diedAtBySession.delete(sessionId);
    this.combat.clearSession(sessionId);
    this.clearAllDummyAggro();
  }

  private tickDummyAggro(now: number) {
    const bolt = ABILITIES.bolt;
    if (!bolt) return;
    const windupMs =
      phaseDurationMs(bolt, "anticipation") + phaseDurationMs(bolt, "cast");
    const impactMs = phaseDurationMs(bolt, "impact");
    const recoveryMs = phaseDurationMs(bolt, "recovery");
    const totalMs = windupMs + impactMs + recoveryMs;
    const maxRange = bolt.range ?? 12;

    for (const [dummyId, aggro] of [...this.dummyAggro.entries()]) {
      const dummy = this.state.targets.get(dummyId);
      const player = this.state.players.get(aggro.attackerId);
      if (
        !dummy ||
        !player ||
        player.disconnected ||
        !dummyId.startsWith("practice_dummy")
      ) {
        this.clearDummyCast(dummyId);
        this.dummyAggro.delete(dummyId);
        continue;
      }
      if (player.hp <= 0) {
        this.clearDummyCast(dummyId);
        this.dummyAggro.delete(dummyId);
        continue;
      }

      if (now - aggro.lastHitAt >= DUMMY_DEAGGRO_MS) {
        this.clearDummyCast(dummyId);
        this.dummyAggro.delete(dummyId);
        continue;
      }

      // Stun / silence: drop windup and never release the bolt.
      if (!this.combat.statuses.canCast(dummyId)) {
        if (dummy.castAbilityId || aggro.pendingReleaseAt > 0) {
          this.clearDummyCast(dummyId);
          aggro.pendingReleaseAt = 0;
        }
        continue;
      }

      // While cloaked, shoot the drifting decoy — never the invisible player.
      const aimAt = this.resolveDummyAimPoint(aggro.attackerId);
      if (!aimAt) {
        // Cloaked with no decoy left: hold fire, stay aggro'd.
        if (aggro.pendingReleaseAt > 0) {
          aggro.pendingReleaseAt = 0;
          this.clearDummyCast(dummyId);
        }
        continue;
      }

      const dx = aimAt.x - dummy.x;
      const dz = aimAt.z - dummy.z;
      const dist = Math.hypot(dx, dz);
      const aimYaw = dist > 1e-4 ? Math.atan2(dx, dz) : dummy.yaw;
      dummy.yaw = aimYaw;
      // Keep mid-cast bolts tracking the decoy as it drifts.
      if (aggro.pendingReleaseAt > 0) {
        aggro.pendingAimYaw = aimYaw;
      }

      // Release: fire projectile at end of cast windup.
      if (aggro.pendingReleaseAt > 0 && now >= aggro.pendingReleaseAt) {
        this.combat.fireProjectileFrom(
          dummyId,
          {
            id: dummyId,
            x: dummy.x,
            z: dummy.z,
            yaw: aggro.pendingAimYaw,
            hp: dummy.hp,
            maxHp: dummy.maxHp,
            vulnerable: true,
          },
          "bolt",
        );
        dummy.castPhase = "impact";
        aggro.pendingReleaseAt = 0;
        aggro.nextCastAt = now + impactMs + recoveryMs + DUMMY_BOLT_GAP_MS;
      }

      // Advance impact → recovery using the stable castLockUntil end stamp.
      if (dummy.castAbilityId === "bolt" && dummy.castLockUntil > 0) {
        const castEnd = dummy.castLockUntil;
        const recoveryStart = castEnd - recoveryMs;
        const impactStart = recoveryStart - impactMs;
        if (now >= castEnd) {
          this.clearDummyCast(dummyId);
        } else if (now >= recoveryStart) {
          dummy.castPhase = "recovery";
        } else if (now >= impactStart) {
          dummy.castPhase = "impact";
        }
      }

      if (dist > maxRange + 0.5 || dist < 1e-4) {
        // Stay aggro'd but don't start casts out of range.
        continue;
      }

      // Begin next cast windup (castLockUntil stays fixed for the whole cast → stable anim key).
      if (
        aggro.pendingReleaseAt <= 0 &&
        now >= aggro.nextCastAt &&
        !dummy.castAbilityId
      ) {
        dummy.castAbilityId = "bolt";
        dummy.castPhase = "cast";
        dummy.castLockUntil = now + totalMs;
        dummy.yaw = aimYaw;
        aggro.pendingAimYaw = aimYaw;
        aggro.pendingReleaseAt = now + windupMs;
      }
    }
  }

  /**
   * Aim point for dummy retaliation.
   * Cloaked → owner's decoy (null if none). Otherwise → player.
   */
  private resolveDummyAimPoint(attackerId: string): { x: number; z: number } | null {
    const player = this.state.players.get(attackerId);
    if (!player) return null;
    if (player.statuses.get("cloaked")) {
      let decoy: { x: number; z: number } | null = null;
      this.state.decoys.forEach((d) => {
        if (!decoy && d.ownerSessionId === attackerId) {
          decoy = { x: d.x, z: d.z };
        }
      });
      return decoy;
    }
    return { x: player.x, z: player.z };
  }

  private handleInteract(sessionId: string, player: PlayerState, interactId: string, now: number) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;

    this.combat.revealCloak(sessionId);

    const stand = HUB_STANDS.find((s) => s.id === interactId);
    if (stand) {
      if (pointInInteractZone(player.x, player.z, stand)) {
        client.send("ui", { ui: stand.kind });
        this.sendInventory(client, player);
      }
      return;
    }

    const portal = HUB_PORTALS.find((p) => p.id === interactId);
    if (portal) {
      if (pointInInteractZone(player.x, player.z, portal)) {
        client.send("ui", { ui: portal.id === "portal_pvp" ? "portal_pvp" : "portal_pve" });
      }
      return;
    }

    const dummy = HUB_PRACTICE_DUMMIES.find((d) => d.id === interactId);
    if (dummy || interactId === INTERACT.PRACTICE_DUMMY) {
      const target = dummy ?? HUB_PRACTICE_DUMMIES[0]!;
      if (!pointInInteractZone(player.x, player.z, target)) return;
      client.send("toast", { message: "Practice dummy — hit it with abilities to train" });
    }
  }
}
