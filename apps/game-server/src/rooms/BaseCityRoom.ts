import { Room, Client } from "@colyseus/core";
import {
  ABILITIES,
  COSMETIC_COLORS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  DEFAULT_LOADOUT,
  ESSENCE_PER_TALENT_POINT,
  ESSENCE_RESET_ALL,
  ESSENCE_RESET_TREE,
  HUB_SPAWN,
  INTERACT,
  LOADOUT_SIZE,
  MAX_COIN_LOADOUT_SLOTS,
  MAX_TALENTS,
  RESPAWN_LOCK_MS,
  SHOP_ITEMS,
  SPELL_SLOTS,
  STARTER_COLORS,
  STARTER_TALENT_POINTS,
  TALENTS,
  TALENT_POINT_BUDGET,
  TALENT_TREE_IDS,
  TICK_MS,
  abilityUnlockCostEssence,
  addCoins,
  applyMovement,
  applyYaw,
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
  resolvePveTransfer,
  spendCoins,
  baseCityStaticColliders,
  pointInInteractZone,
  totalPointsSpent,
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
import { dequeuePvpParty, dequeuePvpSession, enqueuePvpParty, type PvpPartyMember } from "../matchmaking/pvpQueue.js";
import {
  HubPartyRegistry,
  defaultSeatFor,
  filterModesForHubSize,
  partyFitsMode,
  toPartySnapshot,
  type HubParty,
} from "../matchmaking/hubParty.js";
import {
  loadEconomy,
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
  type LoadoutPresetRow,
} from "../persistence.js";
import { takePendingLoot } from "../pendingLoot.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

const DUMMY_COOLDOWN_MS = 1500;
const DUMMY_COPPER_REWARD = 3;
const DUMMY_HIT_COPPER = 1;
/** How often an aggro'd dummy fires bolt at its attacker. */
/** Gap after recovery before the dummy starts another cast. */
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
  private dummyCooldownUntil = new Map<string, number>();
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
        const player = this.state.players.get(attackerSessionId);
        const client = this.clients.find((c) => c.sessionId === attackerSessionId);
        if (!player || !client) return;
        this.applyWallet(player, {
          ...addCoins(this.walletOf(player), { copper: DUMMY_HIT_COPPER }),
          essence: player.essence,
          rubies: player.rubies,
        });
        void this.persistInventory(attackerSessionId, player);
        this.sendInventory(client, player);
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

    this.onMessage("reset_talent_build", (client) => {
      void this.handleResetTalentBuild(client);
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

    this.onMessage("party_invite", (client, message: { sessionId?: string }) => {
      this.handlePartyInvite(client, message?.sessionId);
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

    this.onMessage("party_lock", (client) => {
      this.handlePartyLock(client);
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
    const verified =
      identity ??
      ({
        userId: client.sessionId,
        displayName: "Hunter",
        isGuest: true,
      } satisfies VerifiedIdentity);

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
        { slotIndex: 0, name: "Loadout 1", abilityIds: [...DEFAULT_LOADOUT] },
      ]);
      this.activeLoadoutSlotBySession.set(client.sessionId, 0);
      const starter = normalizeCoins({ copper: 75, silver: 2, gold: 0 });
      player.copper = starter.copper;
      player.silver = starter.silver;
      player.gold = starter.gold;
      player.essence = 12;
      player.rubies = 0;
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
      if (player.copper === 0 && player.silver === 0 && player.gold === 0 && player.essence === 0) {
        const soft = normalizeCoins({ copper: 50, silver: 1, gold: 0 });
        player.copper = soft.copper;
        player.silver = soft.silver;
        player.gold = soft.gold;
        player.essence = 2;
        void saveInventory(verified.userId, this.walletOf(player));
      }
    }

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);
    this.spawnBySession.set(client.sessionId, {
      x: player.x,
      z: player.z,
      yaw: player.yaw,
    });

    const loot = takePendingLoot(verified.userId);
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
      message: verified.isGuest
        ? "Welcome (guest) — blast the dummy with abilities for copper"
        : visiting
          ? `Visiting hub`
          : `Welcome home, ${verified.displayName}`,
    });
    this.sendInventory(client, player);
    this.broadcastHubRoster();
    // Catch soft-leave ghosts that survived eviction (collision without a model).
    this.purgeDuplicateUserSeats(client.sessionId);
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
    this.dummyCooldownUntil.delete(sessionId);
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
    this.combat.syncSessionKit(sessionId, player.loadout, player.talents);
    const bonus = this.combat.getSessionKit(sessionId)?.maxHpBonus ?? 0;
    player.maxHp = 100 + bonus;
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
        client.send("toast", { message: `Ability not unlocked: ${id}` });
        return null;
      }
      const slotId = SPELL_SLOTS[i]!.id;
      if (!canEquipInSlot(id, slotId)) {
        client.send("toast", { message: `${id} cannot go in slot ${slotId}` });
        return null;
      }
    }
    return normalizeLoadout(cleaned);
  }

  private upsertPresetInSession(
    sessionId: string,
    slotIndex: number,
    abilityIds: string[],
    name?: string,
  ) {
    const presets = [...(this.loadoutPresetsBySession.get(sessionId) ?? [])];
    const idx = presets.findIndex((p) => p.slotIndex === slotIndex);
    const row: LoadoutPresetRow = {
      slotIndex,
      name: name || presets[idx]?.name || `Loadout ${slotIndex + 1}`,
      abilityIds,
    };
    if (idx >= 0) presets[idx] = row;
    else presets.push(row);
    presets.sort((a, b) => a.slotIndex - b.slotIndex);
    this.loadoutPresetsBySession.set(sessionId, presets);
    return row;
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
    this.talentPointsBySession.set(client.sessionId, owned + buy);
    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Bought ${buy} talent point${buy === 1 ? "" : "s"} (−${cost} essence)`,
    });
  }

  private async handleSetTalentBuild(client: Client, raw: TalentBuild) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const owned = this.talentPointsBySession.get(client.sessionId) ?? 0;
    let build = normalizeTalentBuild(raw);
    build = clampBuildToOwned(build, owned);
    if (totalPointsSpent(build) > Math.min(owned, TALENT_POINT_BUDGET)) {
      client.send("toast", { message: "Build exceeds owned talent points" });
      return;
    }
    this.talentBuildBySession.set(client.sessionId, build);
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) await saveTalentBuild(identity.userId, build);
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Talent build saved (${totalPointsSpent(build)}/${owned} pts)`,
    });
  }

  private async handleResetTalentTree(client: Client, tree: TalentTreeId | undefined) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !tree || !(TALENT_TREE_IDS as readonly string[]).includes(tree)) return;
    const current = this.talentBuildBySession.get(client.sessionId) ?? {};
    const next = clearTree(current, tree);
    if (totalPointsSpent(next) === totalPointsSpent(current)) {
      client.send("toast", { message: `No points invested in ${tree}` });
      return;
    }
    if (player.essence < ESSENCE_RESET_TREE) {
      client.send("toast", { message: `Need ${ESSENCE_RESET_TREE} essence to reset ${tree}` });
      return;
    }
    player.essence -= ESSENCE_RESET_TREE;
    this.talentBuildBySession.set(client.sessionId, next);
    await this.persistInventory(client.sessionId, player);
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) await saveTalentBuild(identity.userId, next);
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Reset ${tree} (−${ESSENCE_RESET_TREE} essence)`,
    });
  }

  private async handleResetTalentBuild(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const current = this.talentBuildBySession.get(client.sessionId) ?? {};
    if (totalPointsSpent(current) <= 0) {
      client.send("toast", { message: "No talent points invested" });
      return;
    }
    if (player.essence < ESSENCE_RESET_ALL) {
      client.send("toast", { message: `Need ${ESSENCE_RESET_ALL} essence to reset all talents` });
      return;
    }
    player.essence -= ESSENCE_RESET_ALL;
    this.talentBuildBySession.set(client.sessionId, {});
    await this.persistInventory(client.sessionId, player);
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) await saveTalentBuild(identity.userId, {});
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Talent build cleared (−${ESSENCE_RESET_ALL} essence)`,
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
          player.hp = Math.min(player.maxHp, player.hp + 25);
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
        this.upsertPresetInSession(
          client.sessionId,
          slotIndex,
          abilityIds,
          `Loadout ${grant.toCount}`,
        );
        const identity = this.identities.get(client.sessionId);
        if (identity && !identity.isGuest) {
          await saveLoadoutPreset(
            identity.userId,
            slotIndex,
            abilityIds,
            `Loadout ${grant.toCount}`,
          );
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
  }

  private async handleSetLoadout(client: Client, abilityIds: string[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const cleaned = this.validateLoadoutAbilityIds(client, abilityIds);
    if (!cleaned) return;

    player.loadout = cleaned.join(",");
    this.applyCombatKit(client.sessionId, player);

    const activeSlot = this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0;
    this.upsertPresetInSession(client.sessionId, activeSlot, cleaned);
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveLoadoutPreset(identity.userId, activeSlot, cleaned);
    }
    this.sendInventory(client, player);
    client.send("toast", { message: "Loadout saved" });
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

    const row = this.upsertPresetInSession(client.sessionId, slotIndex, cleaned, name);
    const activeSlot = this.activeLoadoutSlotBySession.get(client.sessionId) ?? 0;
    if (slotIndex === activeSlot) {
      player.loadout = cleaned.join(",");
      this.applyCombatKit(client.sessionId, player);
    }

    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveLoadoutPreset(identity.userId, slotIndex, cleaned, row.name);
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

    this.activeLoadoutSlotBySession.set(client.sessionId, slotIndex);
    player.loadout = abilityIds.join(",");
    this.applyCombatKit(client.sessionId, player);

    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveActiveLoadoutSlot(identity.userId, slotIndex);
      await saveLoadout(identity.userId, abilityIds);
    }
    this.sendInventory(client, player);
    client.send("toast", {
      message: `Loadout ${slotIndex + 1} selected`,
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

  private broadcastHubRoster() {
    const players = [...this.state.players.entries()]
      .filter(([, p]) => !p.disconnected)
      .map(([sessionId, p]) => ({
        sessionId,
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
    this.broadcastPartyUpdate(party);
    const suffix = rejectedModes.length > 0 ? ` (${rejectedModes.join(", ")} dropped — hub too small)` : "";
    client.send("toast", {
      message: `Party lobby — ${validModes.join(", ")}${suffix}. Invite hunters, set seats, then lock.`,
    });
    client.send("ui", { ui: "party_lobby" });
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

  private handlePartyLock(client: Client) {
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
    for (const member of party.members.values()) {
      const memberClient = this.clients.find((c) => c.sessionId === member.sessionId);
      if (!memberClient) continue;
      members.push({
        key: this.queueKey(memberClient),
        client: memberClient,
        userId: member.userId,
        seat: member.seat,
        hubOwnerId: this.ownerId,
      });
    }
    if (members.length === 0) return;

    party.modes = feasibleModes;
    party.queued = true;
    enqueuePvpParty({ partyId: party.partyId, modes: feasibleModes, members });
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
        player.yaw = applyYaw(player.yaw, input.yaw);

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

      const until = this.dummyCooldownUntil.get(sessionId) ?? 0;
      if (now < until) {
        client.send("toast", { message: "Dummy recovering…" });
        return;
      }
      this.dummyCooldownUntil.set(sessionId, now + DUMMY_COOLDOWN_MS);
      this.applyWallet(player, {
        ...addCoins(this.walletOf(player), { copper: DUMMY_COPPER_REWARD }),
        essence: player.essence,
        rubies: player.rubies,
      });
      void this.persistInventory(sessionId, player);
      this.sendInventory(client, player);
      client.send("toast", { message: `+${DUMMY_COPPER_REWARD}c` });
    }
  }
}
