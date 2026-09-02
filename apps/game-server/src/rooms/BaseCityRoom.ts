import { Client, matchMaker } from "@colyseus/core";
import {
  ABILITIES,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  DEFAULT_LOADOUT,
  getMapSource,
  ROOM,
  sandboxModeFor,
  HUB_SPAWN,
  HUB_MAP_ID,
  INTERACT,
  mapNpcFor,
  npcElementIdFrom,
  NPC_INTERACT_RADIUS,
  MAX_LOBBY_BEACH_BALLS,
  RESPAWN_LOCK_MS,
  STARTER_COLORS,
  TICK_MS,
  addCoins,
  applyMovement,
  applyYaw,
  HAND_SHIELD_CAST,
  formatWallet,
  getEmote,
  HUB_PORTALS,
  HUB_PRACTICE_DUMMIES,
  HUB_STANDS,
  normalizeLoadout,
  ownsColor,
  ownsEmote,
  ownsPattern,
  ownsPatternColor,
  phaseDurationMs,
  COOP_PVE_MAX_PLAYERS,
  isPvpFfaTriosMode,
  PVP_MODES,
  resolvePveTransfer,
  baseCityStaticColliders,
  mapAttackablePropsFor,
  pointInInteractZone,
  sweepTravel,
  type PlayerInput,
  type PvpModeId,
  type PvpSeat,
  type ShopGrant,
  type StaticCollider,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions, type VerifiedIdentity } from "../auth.js";
import {
  dequeuePvpParty,
  dequeuePvpSession,
  enqueuePvpParty,
  resolvePartyAvgMmr,
  startDirectPvpMatch,
  type PvpPartyMember,
} from "../matchmaking/pvpQueue.js";
import {
  HubPartyRegistry,
  defaultSeatFor,
  filterModesForHubSize,
  isFullPremadeLobby,
  partyFitsMode,
  toPartySnapshot,
  type HubParty,
} from "../matchmaking/hubParty.js";
import { getHubRankedState, getRankedLeaderboard } from "../ranked.js";
import {
  claimPendingRewardGrants,
  insertRewardGrant,
  loadBeachBallCount,
  loadIntroCompleted,
  saveBeachBallCount,
  setIntroCompleted,
  softResetCharacter,
} from "../persistence.js";
import { takePendingLoot } from "../pendingLoot.js";
import { ADMIN_GRANT_MAX_PER_FIELD, isAdminEmail } from "../admin.js";
import { bumpQuest, findReferralForInvitee, insertClosedChest } from "../quests.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import { ServicedRoom, type LobbyGrantCheck } from "./ServicedRoom.js";
import { BaseCityState, HubBallState, PlayerState } from "../schema/BaseCityState.js";

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

export class BaseCityRoom extends ServicedRoom {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private ownerId: string | null = null;
  private dummyAggro = new Map<string, DummyAggro>();
  /** Join / soft spawn pose — respawn returns here. */
  private spawnBySession = new Map<string, { x: number; z: number; yaw: number }>();
  /** Epoch ms when the player hit 0 HP (respawn gate). */
  private diedAtBySession = new Map<string, number>();
  /** Hub-scoped party lobbies (invite/seat/mode selection prior to PvP queueing). */
  private parties = new HubPartyRegistry();
  private lastHubRosterBroadcastAt = 0;
  /** Emote anti-spam / active window (epoch ms). */
  private emoteUntilBySession = new Map<string, number>();
  /** Hub plaza ball vs village walls. */
  private hubBallColliders: StaticCollider[] = [];
  /** Prior feet pose for walk-into-ball impulse. */
  private ballPlayerPrev = new Map<string, { x: number; z: number }>();

  onCreate(options: AuthJoinOptions) {
    this.setState(new BaseCityState());
    this.hubBallColliders = baseCityStaticColliders();
    this.ownerId = options.hubOwnerId ?? null;
    this.state.hubOwnerUserId = this.ownerId ?? "";
    void this.reloadOwnerBeachBalls();
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
    for (const p of mapAttackablePropsFor(HUB_MAP_ID)) {
      this.combat.spawnPropTarget(p);
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

    // Shop, spells, talents, appearance, quests -- shared with ContentRoom so
    // that an NPC merchant in an authored map reaches the same code.
    this.registerPlayerServices();

    this.onMessage("cast_emote", (client, message: { emoteId?: string }) => {
      this.handleCastEmote(client, message?.emoteId ?? "");
    });

    this.onMessage("cancel_emote", (client) => {
      this.handleCancelEmote(client);
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

    this.onMessage("hub_admin_tp_map", (client, message: { mapId?: string }) => {
      void this.handleHubAdminTpMap(client, message?.mapId);
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

    this.onMessage("party_lock", (client, message?: { matchKind?: "ranked" | "unranked" | "coop_pve" }) => {
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
    await this.loadPlayerEconomy(client.sessionId, player, verified);

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

    if (!this.ownerId) {
      this.ownerId = options.hubOwnerId ?? verified.userId;
      this.state.hubOwnerUserId = this.ownerId ?? "";
      void this.reloadOwnerBeachBalls();
    }

    this.applyCombatKit(client.sessionId, player);

    const visiting = this.ownerId && verified.userId !== this.ownerId;
    client.send("toast", {
      message: visiting
        ? `Visiting hub`
        : `Welcome home, ${verified.displayName}`,
    });
    this.sendInventory(client, player);
    this.broadcastHubRoster();
    client.send("hub_you_are_admin", { admin: isAdminEmail(verified.email) });

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

  // ---------------------------------------------------------------------
  // Lobby-scoped purchases — the one part of the shop that is hub-only
  // ---------------------------------------------------------------------

  protected override lobbyGrantCount(grant: ShopGrant): number {
    return grant.kind === "lobby_beach_ball" ? this.state.beachBallCount : 0;
  }

  protected override checkLobbyGrant(client: Client, grant: ShopGrant): LobbyGrantCheck {
    if (grant.kind !== "lobby_beach_ball") return "Not available here";
    const identity = this.identities.get(client.sessionId);
    if (!identity || !this.ownerId || identity.userId !== this.ownerId) {
      return "Beach balls can only be bought in your own lobby";
    }
    if (grant.toCount < 1 || grant.toCount > MAX_LOBBY_BEACH_BALLS) {
      return "Beach ball unavailable";
    }
    if (this.state.beachBallCount >= grant.toCount) return "Already owned";
    if (this.state.beachBallCount !== grant.toCount - 1) {
      return grant.toCount === 2 ? "Buy the first beach ball first" : "Beach ball unavailable";
    }
    return null;
  }

  protected override async grantLobbyItem(client: Client, grant: ShopGrant): Promise<boolean> {
    if (grant.kind !== "lobby_beach_ball") return false;
    // Re-checked rather than trusted from the earlier gate: the debit happened
    // in between, and an owner who left mid-purchase must not be charged.
    if (this.checkLobbyGrant(client, grant) !== null) return false;
    this.ensureHubBalls(grant.toCount);
    try {
      await saveBeachBallCount(this.ownerId!, grant.toCount);
    } catch {
      this.ensureHubBalls(Math.max(0, grant.toCount - 1));
      return false;
    }
    return true;
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
    this.handleOpenCoopPveParty(client, contentId, modifiers);
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
    // Source must be unique per (user_id, source) — stamp each admin grant.
    const source = `admin:spawn:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const result = await insertClosedChest(
      identity.userId,
      quality as "green" | "blue" | "purple" | "legendary",
      source,
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

  /**
   * Drop one admin alone into any registered map, for looking at authored maps
   * without wiring them to a real mode first.
   *
   * Goes to the PvE room so there is no round timer, no win condition and no
   * wave director -- `WaveDirector` only starts for mode "dungeon".
   */
  private async handleHubAdminTpMap(client: Client, mapIdRaw: string | undefined) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest || !isAdminEmail(identity.email)) {
      client.send("toast", { message: "Not authorized" });
      return;
    }
    const mapId = typeof mapIdRaw === "string" ? mapIdRaw.trim() : "";
    if (!mapId || !getMapSource(mapId)) {
      client.send("toast", { message: `Unknown map "${mapId}"` });
      return;
    }

    const mode = sandboxModeFor(mapId);
    try {
      const created = await matchMaker.createRoom(ROOM.DUNGEON, {
        matchId: `sandbox_${mapId}_${Date.now().toString(36)}`,
        mode,
        modifiers: [],
        partySize: 1,
        hubOwnerId: this.ownerId ?? identity.userId,
      });
      client.send("transfer", {
        room: ROOM.DUNGEON,
        roomId: created.roomId,
        options: { mode, modifiers: [], hubOwnerId: identity.userId, spawnSlot: 0 },
      });
    } catch (err) {
      console.error("[admin] map teleport failed", err);
      client.send("toast", { message: "Could not open that map" });
    }
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
    player.flexLoadout = this.resolveFlexForBar(
      eco.flexAbilityIds,
      normalizeLoadout(eco.abilityIds),
      eco.unlocks,
    )
      .map((id) => id ?? "")
      .join(",");
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
      if (reason) this.sendToSession(sessionId, "toast", { message: reason });
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
      "pvp",
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
   * Open a coop Wave Assault lobby (max 4). Solo = leader locks with one seat.
   * Same auto-pull pattern as PvP.
   */
  private handleOpenCoopPveParty(client: Client, contentId: string, modifiers: string[]) {
    const transfer = resolvePveTransfer(contentId);
    if (transfer.mode !== "dungeon") {
      client.send("toast", { message: "That content isn't available yet" });
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

    // modes[0] = content id; modifiers kept for future wiring (v1 unused in WaveDirector).
    const party = this.parties.create(
      { sessionId: client.sessionId, userId: identity.userId, displayName: identity.displayName },
      [transfer.mode, ...modifiers.filter(Boolean)],
      "coop_pve",
    );

    for (const [sessionId, hubPlayer] of this.state.players.entries()) {
      if (sessionId === client.sessionId || hubPlayer.disconnected) continue;
      if (party.members.size >= COOP_PVE_MAX_PLAYERS) break;
      const otherParty = this.parties.getBySession(sessionId);
      if (otherParty && otherParty.partyId !== party.partyId) {
        this.removeFromAnyParty(sessionId, "Pulled into the Wave Assault lobby");
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
    this.broadcastToParty(party, "toast", {
      message: "Wave Assault lobby — invite friends or Start Assault (solo OK).",
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
      if (party.kind === "coop_pve" && party.members.size >= COOP_PVE_MAX_PLAYERS) {
        client.send("toast", { message: `Wave Assault is full (${COOP_PVE_MAX_PLAYERS} max)` });
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
    if (party.kind === "coop_pve" && party.members.size >= COOP_PVE_MAX_PLAYERS) {
      party.pendingFriendInvites.delete(identity.userId);
      client.send("toast", { message: `Wave Assault is full (${COOP_PVE_MAX_PLAYERS} max)` });
      this.broadcastPartyUpdate(party);
      return;
    }

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
    if (party.kind === "coop_pve" && party.members.size >= COOP_PVE_MAX_PLAYERS) {
      client.send("toast", { message: `Wave Assault is full (${COOP_PVE_MAX_PLAYERS} max)` });
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
    if (party.kind === "coop_pve" && party.members.size >= COOP_PVE_MAX_PLAYERS) {
      client.send("toast", { message: `Wave Assault is full (${COOP_PVE_MAX_PLAYERS} max)` });
      this.broadcastPartyUpdate(party);
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
    if (!member || (seat !== "teamA" && seat !== "teamB" && seat !== "teamC" && seat !== "spectator")) return;
    if (party.kind === "coop_pve" && seat !== "teamA") {
      client.send("toast", { message: "Wave Assault has fighter seats only" });
      return;
    }
    if (seat === "teamC" && !party.modes.some((m) => isPvpFfaTriosMode(m))) {
      client.send("toast", { message: "Team 3 is only used in Arena 1v1v1" });
      return;
    }
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
    if (party.kind === "coop_pve") {
      client.send("toast", { message: "Wave Assault mode is fixed" });
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

  private async handlePartyLock(client: Client, matchKind: "ranked" | "unranked" | "coop_pve") {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can lock the queue" });
      return;
    }
    if (party.queued) return;

    if (party.kind === "coop_pve" || matchKind === "coop_pve") {
      await this.startCoopPveAssault(client, party);
      return;
    }

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
    const modeMeta = PVP_MODES.find((m) => m.id === fullMode);
    const noQueue = Boolean(modeMeta?.noQueue);

    if (!fullPremade && matchKind === "unranked") {
      client.send("toast", {
        message: isPvpFfaTriosMode(fullMode)
          ? "Unranked requires all three fighter seats filled"
          : "Unranked requires a full lobby (both teams filled)",
      });
      return;
    }

    if (!fullPremade && noQueue) {
      client.send("toast", { message: "This mode requires a full premade lobby" });
      return;
    }

    const fighterIds = members.filter((m) => m.seat !== "spectator").map((m) => m.userId);
    const avgMmr = await resolvePartyAvgMmr(fighterIds);

    if (fullPremade) {
      party.queued = true;
      this.broadcastPartyUpdate(party);
      try {
        await startDirectPvpMatch(
          fullMode as PvpModeId,
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

    // Partial lobby → ranked queue (FFA included; packs to 3 solos)
    const queueModes = feasibleModes.filter((m) => !PVP_MODES.find((x) => x.id === m)?.noQueue);
    if (queueModes.length === 0) {
      client.send("toast", { message: "No queueable modes selected" });
      return;
    }

    // FFA: refuse parties that already fill the lobby (should have taken direct path)
    // or bring too many fighters for open queue packing.
    if (queueModes.some((m) => isPvpFfaTriosMode(m))) {
      const fighters = members.filter((m) => m.seat !== "spectator").length;
      if (fighters >= 3) {
        client.send("toast", { message: "Fill seats A/B/C then Start Ranked, or leave a seat open to queue" });
        return;
      }
      if (fighters < 1) {
        client.send("toast", { message: "Need at least one fighter to queue" });
        return;
      }
    }

    party.queued = true;
    enqueuePvpParty({
      partyId: party.partyId,
      modes: queueModes,
      members,
      avgMmr,
    });
    this.broadcastPartyUpdate(party);
  }

  /** Create one shared dungeon room and transfer the whole coop party. */
  private async startCoopPveAssault(client: Client, party: HubParty) {
    if (party.members.size < 1) {
      client.send("toast", { message: "Need at least one fighter" });
      return;
    }
    if (party.members.size > COOP_PVE_MAX_PLAYERS) {
      client.send("toast", { message: `Wave Assault is full (${COOP_PVE_MAX_PLAYERS} max)` });
      return;
    }

    const contentId = party.modes.find((m) => m === "dungeon" || m === "boss") ?? "dungeon";
    const modifiers = party.modes.filter((m) => m !== contentId);
    const transfer = resolvePveTransfer(contentId);
    if (transfer.mode !== "dungeon") {
      client.send("toast", { message: "That content isn't available yet" });
      return;
    }

    const partySize = Math.min(COOP_PVE_MAX_PLAYERS, party.members.size);
    const matchId = `pve_dungeon_${party.partyId}`;
    const partyLobbyHub =
      this.ownerId ??
      party.members.get(party.leaderSessionId)?.userId ??
      null;

    party.queued = true;
    this.broadcastPartyUpdate(party);

    try {
      const created = await matchMaker.createRoom(transfer.room, {
        matchId,
        mode: transfer.mode,
        modifiers,
        partySize,
        hubOwnerId: partyLobbyHub,
      });

      let spawnSlot = 0;
      for (const member of party.members.values()) {
        const memberClient = this.clients.find((c) => c.sessionId === member.sessionId);
        if (!memberClient) continue;
        const hubOwnerId =
          party.members.size > 1 ? (partyLobbyHub ?? member.userId) : member.userId;
        memberClient.send("toast", {
          message:
            partySize > 1
              ? `Wave Assault — ${partySize} hunters`
              : "Wave Assault — solo run",
        });
        memberClient.send("transfer", {
          room: transfer.room,
          roomId: created.roomId,
          options: {
            mode: transfer.mode,
            modifiers,
            hubOwnerId,
            matchId,
            partySize,
            spawnSlot: spawnSlot++,
          },
        });
      }

      // Bookkeeping clears as members leave the hub on transfer.
      this.dissolveParty(party, "");
    } catch (err) {
      console.error("[party] coop pve start failed", err);
      party.queued = false;
      this.broadcastPartyUpdate(party);
      client.send("toast", { message: "Could not start Wave Assault" });
    }
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
    this.tickHubPushBall(dt);

    if (now - this.lastHubRosterBroadcastAt >= HUB_ROSTER_BROADCAST_MS) {
      this.broadcastHubRoster();
      this.purgeDuplicateUserSeats();
    }
  }

  /** Soft plaza balls — walk into them to push; damp + village wall sweep. */
  private tickHubPushBall(dt: number) {
    if (this.state.hubBalls.size <= 0) return;
    const BALL_R = 0.48;
    /** Wider than foot radius so the mesh doesn't clip the character torso. */
    const PLAYER_CONTACT = 0.78;
    const DAMP = Math.exp(-1.35 * dt);
    const MAX_SPEED = 11;
    const PUSH_GAIN = 14;
    const SOFT_BOUNDS = 26;
    const cx = HUB_SPAWN.x;
    const cz = HUB_SPAWN.z;
    const safeDt = Math.max(1e-4, Math.min(0.05, dt));

    const balls: Array<{ id: string; ball: HubBallState }> = [];
    this.state.hubBalls.forEach((ball, id) => balls.push({ id, ball }));

    for (const { id, ball } of balls) {
      let vx = ball.vx;
      let vz = ball.vz;
      let x = ball.x;
      let z = ball.z;

      for (let pass = 0; pass < 2; pass++) {
        for (const [sessionId, player] of this.state.players.entries()) {
          if (player.disconnected || player.hp <= 0) continue;
          const prev = this.ballPlayerPrev.get(sessionId) ?? { x: player.x, z: player.z };
          const pvx = (player.x - prev.x) / safeDt;
          const pvz = (player.z - prev.z) / safeDt;

          const dx = x - player.x;
          const dz = z - player.z;
          const dist = Math.hypot(dx, dz);
          const minDist = BALL_R + PLAYER_CONTACT;
          if (dist < 1e-4) {
            const len = Math.hypot(pvx, pvz);
            const nx = len > 0.05 ? pvx / len : 1;
            const nz = len > 0.05 ? pvz / len : 0;
            x += nx * minDist;
            z += nz * minDist;
            vx += nx * PUSH_GAIN * 0.5;
            vz += nz * PUSH_GAIN * 0.5;
            continue;
          }
          if (dist >= minDist) continue;

          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = minDist - dist;
          x += nx * overlap;
          z += nz * overlap;

          const approach = Math.max(0, -(pvx * nx + pvz * nz));
          const push = PUSH_GAIN * (0.25 + overlap) + approach * 1.15;
          vx += nx * push * safeDt * (pass === 0 ? 1 : 0.35);
          vz += nz * push * safeDt * (pass === 0 ? 1 : 0.35);
        }
      }

      // Soft ball–ball separation.
      for (const other of balls) {
        if (other.id === id) continue;
        const dx = x - other.ball.x;
        const dz = z - other.ball.z;
        const dist = Math.hypot(dx, dz);
        const minDist = BALL_R * 2;
        if (dist < 1e-4 || dist >= minDist) continue;
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = (minDist - dist) * 0.5;
        x += nx * overlap;
        z += nz * overlap;
        vx += nx * overlap * 8;
        vz += nz * overlap * 8;
      }

      vx *= DAMP;
      vz *= DAMP;
      const spd = Math.hypot(vx, vz);
      if (spd > MAX_SPEED) {
        const s = MAX_SPEED / spd;
        vx *= s;
        vz *= s;
      }

      const from = { x, z };
      const desired = { x: x + vx * safeDt, z: z + vz * safeDt };
      const next = sweepTravel(from, desired, BALL_R, this.hubBallColliders);
      const steppedX = Math.abs(next.x - from.x) > 1e-5;
      const steppedZ = Math.abs(next.z - from.z) > 1e-5;
      if (!steppedX && Math.abs(vx) > 0.08) vx *= -0.55;
      if (!steppedZ && Math.abs(vz) > 0.08) vz *= -0.55;
      x = next.x;
      z = next.z;

      const maxX = cx + SOFT_BOUNDS;
      const minX = cx - SOFT_BOUNDS;
      const maxZ = cz + SOFT_BOUNDS;
      const minZ = cz - SOFT_BOUNDS;
      if (x > maxX) {
        x = maxX;
        vx = -Math.abs(vx) * 0.4;
      } else if (x < minX) {
        x = minX;
        vx = Math.abs(vx) * 0.4;
      }
      if (z > maxZ) {
        z = maxZ;
        vz = -Math.abs(vz) * 0.4;
      } else if (z < minZ) {
        z = minZ;
        vz = Math.abs(vz) * 0.4;
      }

      ball.x = x;
      ball.z = z;
      ball.vx = Math.abs(vx) < 0.015 ? 0 : vx;
      ball.vz = Math.abs(vz) < 0.015 ? 0 : vz;
    }

    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.disconnected || player.hp <= 0) {
        this.ballPlayerPrev.delete(sessionId);
        continue;
      }
      this.ballPlayerPrev.set(sessionId, { x: player.x, z: player.z });
    }
  }

  private async reloadOwnerBeachBalls() {
    if (!this.ownerId) {
      this.ensureHubBalls(0);
      return;
    }
    try {
      const count = await loadBeachBallCount(this.ownerId);
      this.ensureHubBalls(count);
    } catch {
      this.ensureHubBalls(0);
    }
  }

  private ensureHubBalls(count: number) {
    const target = Math.max(0, Math.min(MAX_LOBBY_BEACH_BALLS, Math.floor(count)));
    this.state.beachBallCount = target;
    const ids = [...this.state.hubBalls.keys()].sort();
    while (ids.length > target) {
      const id = ids.pop()!;
      this.state.hubBalls.delete(id);
    }
    while (this.state.hubBalls.size < target) {
      this.spawnHubBall(this.state.hubBalls.size);
    }
  }

  private spawnHubBall(index: number) {
    const offsets = [
      { x: 2.4, z: 1.6 },
      { x: -2.1, z: 2.3 },
    ] as const;
    const off = offsets[Math.max(0, Math.min(offsets.length - 1, index))]!;
    const id = `beach_${index}`;
    if (this.state.hubBalls.has(id)) return;
    const ball = new HubBallState();
    ball.id = id;
    ball.x = HUB_SPAWN.x + off.x;
    ball.z = HUB_SPAWN.z + off.z;
    ball.vx = 0;
    ball.vz = 0;
    this.state.hubBalls.set(id, ball);
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
      const target = dummy ?? HUB_PRACTICE_DUMMIES[0];
      if (!target) return;
      if (!pointInInteractZone(player.x, player.z, target)) return;
      client.send("toast", { message: "Practice dummy — hit it with abilities to train" });
      return;
    }

    const npcElementId = npcElementIdFrom(interactId);
    if (npcElementId) {
      const npc = mapNpcFor(HUB_MAP_ID, npcElementId);
      if (!npc) return;
      const reach = NPC_INTERACT_RADIUS + 1;
      if (Math.hypot(player.x - npc.x, player.z - npc.z) > reach) return;
      client.send("npc_dialogue", {
        npcId: npc.id,
        name: npc.name,
        line: npc.line,
        action: npc.action,
      });
    }
  }
}
