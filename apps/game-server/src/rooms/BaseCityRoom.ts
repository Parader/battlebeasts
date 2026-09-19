import { Client, matchMaker } from "@colyseus/core";
import {
  ABILITIES,
  DEFAULT_COSMETIC_BODY,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  EMPTY_LOADOUT,
  isLoadoutReady,
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
  coopPveCapForModes,
  isPveRunMode,
  parsePvpFamilyToken,
  pveContentIdFromModes,
  pvpFamilyFromModes,
  pvpFamilyToken,
  resolvePveTransfer,
  PVP_MODES,
  PVE_CONTENTS,
  type PvpModeId,
  baseCityStaticColliders,
  mapAttackablePropsFor,
  mapPickupsFor,
  pointInInteractZone,
  sweepTravel,
  PLAZA_WALK_IN_CAP,
  PLAZA_HARD_CAP,
  plazaDisplayCode,
  GROUP_OFFLINE_GRACE_MS,
  type PlazaListing,
  type PlayerInput,
  type PvpSeat,
  type ShopGrant,
  type StaticCollider,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions, type VerifiedIdentity } from "../auth.js";
import { getActiveMatch, releaseActiveMatch } from "../matchmaking/activeMatches.js";
import {
  dequeuePvpParty,
  dequeuePvpSession,
  enqueuePvpParty,
  resolvePartyAvgMmr,
  startDirectPvpMatch,
  type PvpPartyMember,
} from "../matchmaking/pvpQueue.js";
import {
  clearHunterSpot,
  dissolveGroup,
  getGroup,
  getHunterSpot,
  groupForUser,
  leaveGroup,
  listHunterSpots,
  markGroupTransferring,
  pruneExpiredOfflineMembers,
  setHunterSpot,
  upsertGroupFromParty,
} from "../matchmaking/plazaGroups.js";
import {
  HubPartyRegistry,
  defaultSeatFor,
  filterModesForHubSize,
  isFullPremadeLobby,
  partyFamily,
  partyFitsFamily,
  resolvePremadeMode,
  retargetParty,
  seatCounts,
  toPartySnapshot,
  type HubParty,
} from "../matchmaking/hubParty.js";
import { getHubRankedState, getRankedLeaderboard } from "../ranked.js";
import { getPveHubState } from "../pveLeaderboard.js";
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
  private plazaId: string | null = null;
  private walkInUserIds = new Set<string>();
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
    this.ownerId = options.plazaId ? null : (options.hubOwnerId ?? null);
    this.plazaId = options.plazaId ?? null;
    this.state.hubOwnerUserId = this.ownerId ?? "";
    if (this.plazaId) {
      this.maxClients = PLAZA_HARD_CAP;
      this.refreshPlazaMetadata();
    }
    void this.reloadOwnerBeachBalls();
    this.combat = new CombatSystem(this as never, {
      canHurtPlayers: false,
      onPlayerDamaged: (sessionId) => {
        const player = this.state.players.get(sessionId);
        if (player && player.hp <= 0) {
          if (this.combat.tryBeginRebirth(sessionId)) return;
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
    this.combat.initPickups(mapPickupsFor(HUB_MAP_ID));
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
        message: {
          portal: "pvp" | "pve";
          params?: { family?: string; modes?: string[]; content?: string; modifiers?: string[] };
        },
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

    this.onMessage("hub_admin_tp_map", (client, message: { mapId?: string }) => {
      void this.handleHubAdminTpMap(client, message?.mapId);
    });

    this.onMessage("hub_admin_enter_mode", (client, message: { modeId?: string }) => {
      void this.handleHubAdminEnterMode(client, message?.modeId);
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

    this.onMessage(
      "party_set_layout",
      (client, message: { splitSides?: boolean; teamCOpen?: boolean }) => {
        this.handlePartySetLayout(client, message);
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

    this.onMessage("hub_pve_leaderboard", (client) => {
      void this.handlePveLeaderboard(client);
    });

    this.onMessage("party_leave", (client) => {
      this.handlePartyLeave(client);
    });

    this.onMessage("party_cancel", (client) => {
      this.handlePartyCancel(client);
    });

    this.onMessage("list_plazas", (client) => {
      void this.handleListPlazas(client);
    });

    this.onMessage("join_plaza", (client, message: { plazaId?: string }) => {
      void this.handleJoinPlaza(client, message?.plazaId ?? "");
    });

    this.onMessage("join_home", (client) => {
      void this.handleJoinHome(client);
    });

    this.onMessage("join_hub", (client, message: { hubOwnerId?: string }) => {
      void this.handleJoinHub(client, message?.hubOwnerId ?? "");
    });

    this.onMessage("join_friend_plaza", (client, message: { userId?: string }) => {
      void this.handleJoinFriendPlaza(client, message?.userId ?? "");
    });

    this.onMessage("list_friend_locations", (client, message: { userIds?: string[] }) => {
      this.handleListFriendLocations(client, Array.isArray(message?.userIds) ? message.userIds : []);
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
    if (!options.plazaId && !options.hubOwnerId) {
      throw new Error("hubOwnerId is required");
    }
    const verified = await verifyJoinOptions(options);
    if (options.plazaId) {
      const group = getGroup(options.groupId) ?? groupForUser(verified.userId);
      const invited = Boolean(options.plazaInvite) || Boolean(group);
      if (
        !invited &&
        this.walkInUserIds.size >= PLAZA_WALK_IN_CAP &&
        this.clients.length >= PLAZA_WALK_IN_CAP
      ) {
        throw new Error("plaza_full");
      }
    }
    return verified;
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
    player.loadout = EMPTY_LOADOUT.join(",");
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

    if (!this.ownerId && !this.plazaId) {
      this.ownerId = options.hubOwnerId ?? verified.userId;
      this.state.hubOwnerUserId = this.ownerId ?? "";
      void this.reloadOwnerBeachBalls();
    }

    this.applyCombatKit(client.sessionId, player);

    setHunterSpot(verified.userId, {
      plazaId: this.plazaId,
      hubOwnerId: this.ownerId,
    });

    const visiting = Boolean(this.ownerId && verified.userId !== this.ownerId);
    if (this.plazaId) {
      const invited = Boolean(options.plazaInvite) || Boolean(getGroup(options.groupId) ?? groupForUser(verified.userId));
      if (!invited) this.walkInUserIds.add(verified.userId);
      this.refreshPlazaMetadata();
      client.send("toast", {
        message: `Plaza ${plazaDisplayCode(this.plazaId)}`,
      });
    } else {
      client.send("toast", {
        message: visiting
          ? `Visiting hub`
          : `Welcome home, ${verified.displayName}`,
      });
    }
    this.sendInventory(client, player);
    this.broadcastHubRoster();
    client.send("hub_you_are_admin", { admin: isAdminEmail(verified.email) });

    // Hub owner intro flag — visitors and plaza shards skip the cinematic.
    if (!visiting && !this.plazaId) {
      const introCompleted = await loadIntroCompleted(verified.userId);
      client.send("hub_intro_status", { completed: introCompleted });
    } else {
      client.send("hub_intro_status", { completed: true });
    }

    // Catch soft-leave ghosts that survived eviction (collision without a model).
    this.purgeDuplicateUserSeats(client.sessionId);
    this.tryJoinPendingParty(client);
    this.tryRestorePersistentGroup(client, options);
    if (this.redirectToGroupDestination(client, verified.userId)) return;
    void this.bounceToActiveMatch(client, verified);
  }

  private async bounceToActiveMatch(client: Client, verified: VerifiedIdentity) {
    const seat = getActiveMatch(verified.userId);
    if (!seat) return;
    try {
      const rooms = await matchMaker.query({ name: seat.roomName });
      if (!rooms.some((r) => r.roomId === seat.roomId)) {
        releaseActiveMatch(verified.userId, seat.roomId);
        return;
      }
    } catch {
      return;
    }
    client.send("toast", { message: "Rejoining your match…" });
    client.send("transfer", {
      room: seat.roomName,
      roomId: seat.roomId,
      options: {
        mode: seat.mode,
        matchId: seat.matchId,
        matchKind: seat.matchKind,
        team: seat.team,
        role: seat.role,
        spawnSlot: seat.spawnSlot,
        hubOwnerId: seat.hubOwnerId,
      },
    });
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.disconnected = true;
    const transferring = Boolean(player.id && groupForUser(player.id)?.transferring);
    if (!transferring) this.syncPartyPresence(client.sessionId, false);

    try {
      if (!consented) {
        // Keep seat + party through reload; only strip after grace expires.
        await this.allowReconnection(client, 60);
        player.disconnected = false;
        this.syncPartyPresence(client.sessionId, true);
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
  private stripPlayerSession(sessionId: string, opts?: { keepParty?: boolean }) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) dequeuePvpSession(this.queueKey(client));
    const userId = this.identities.get(sessionId)?.userId ?? this.state.players.get(sessionId)?.id;
    const transferring = Boolean(userId && groupForUser(userId)?.transferring);
    if (!opts?.keepParty) {
      if (transferring) this.removeFromAnyParty(sessionId);
      // Otherwise keep the hunter parked in the group as logged out.
    }
    if (userId) {
      this.walkInUserIds.delete(userId);
      if (transferring) clearHunterSpot(userId);
    }
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
    if (this.plazaId) this.refreshPlazaMetadata();
  }

  /**
   * Drop every other seat owned by this account (including soft-leave ghosts).
   * Prevents a frozen duplicate host body after returning from a match.
   */
  private evictSessionsForUser(userId: string, exceptSessionId: string) {
    if (!userId) return;
    this.parties.rebindUser(userId, exceptSessionId);
    for (const [sessionId, player] of [...this.state.players.entries()]) {
      if (sessionId === exceptSessionId) continue;
      if (player.id !== userId) continue;
      const stale = this.clients.find((c) => c.sessionId === sessionId);
      // Strip schema first so onLeave is a no-op if the socket close is non-consented.
      this.stripPlayerSession(sessionId, { keepParty: true });
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
      this.parties.rebindUser(player.id, keep);
      const stale = this.clients.find((c) => c.sessionId === sessionId);
      this.stripPlayerSession(sessionId, { keepParty: true });
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
    message: {
      portal: "pvp" | "pve";
      params?: { family?: string; modes?: string[]; content?: string; modifiers?: string[] };
    },
  ) {
    if (!message?.portal) return;

    if (message.portal === "pvp") {
      const family =
        parsePvpFamilyToken(String(message.params?.family ?? "")) ??
        pvpFamilyFromModes((message.params?.modes ?? []).filter(Boolean));
      this.handleOpenPvpParty(client, family);
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

  /**
   * Jump an admin (and their live group, if any) straight into a mode.
   * Skips matchmaking so KoTH / Domination / CTF can be tried with 1–4 local clients.
   */
  private async handleHubAdminEnterMode(client: Client, modeIdRaw: string | undefined) {
    const identity = this.identities.get(client.sessionId);
    if (!identity || identity.isGuest || !isAdminEmail(identity.email)) {
      client.send("toast", { message: "Not authorized" });
      return;
    }
    const modeId = typeof modeIdRaw === "string" ? modeIdRaw.trim() : "";
    if (!modeId) {
      client.send("toast", { message: "Pick a mode" });
      return;
    }

    const pve = PVE_CONTENTS.find((c) => c.id === modeId && c.enabled);
    const pvp = PVP_MODES.find((m) => m.id === modeId && m.enabled);
    if (!pve && !pvp) {
      client.send("toast", { message: `Unknown mode "${modeId}"` });
      return;
    }

    const party = this.parties.getBySession(client.sessionId);
    const members = this.collectLivePartyMembers(client, party);
    if (members.length === 0) {
      client.send("toast", { message: "Could not start — no live hunters" });
      return;
    }

    if (pve) {
      await this.adminStartPve(client, pve.id, party, members);
      return;
    }

    await this.adminStartPvp(client, pvp!.id, party, members);
  }

  private collectLivePartyMembers(
    client: Client,
    party: HubParty | undefined,
  ): PvpPartyMember[] {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return [];
    const partyLobbyHub =
      this.ownerId ??
      (party ? party.members.get(party.leaderSessionId)?.userId : null) ??
      identity.userId;
    const out: PvpPartyMember[] = [];
    const source = party
      ? [...party.members.values()].filter((m) => m.online !== false)
      : [
          {
            sessionId: client.sessionId,
            userId: identity.userId,
            seat: "teamA" as const,
          },
        ];
    for (const member of source) {
      const memberClient = this.clients.find((c) => c.sessionId === member.sessionId);
      if (!memberClient) continue;
      out.push({
        key: this.queueKey(memberClient),
        client: memberClient,
        userId: member.userId,
        seat: member.seat,
        hubOwnerId: source.length > 1 ? partyLobbyHub : member.userId,
        plazaId: this.plazaId,
        groupId: party?.partyId,
      });
    }
    return out;
  }

  private async adminStartPve(
    client: Client,
    contentId: string,
    party: HubParty | undefined,
    members: PvpPartyMember[],
  ) {
    const transfer = resolvePveTransfer(contentId);
    const content = PVE_CONTENTS.find((c) => c.id === transfer.mode);
    if (!content?.enabled || !isPveRunMode(transfer.mode)) {
      client.send("toast", { message: "That content isn't available yet" });
      return;
    }
    const cap = coopPveCapForModes([transfer.mode]);
    const partySize = Math.min(cap, Math.max(1, members.length));
    const matchId = `admin_pve_${transfer.mode}_${Date.now().toString(36)}`;
    if (party) {
      markGroupTransferring(party.partyId, true);
      upsertGroupFromParty(party, { plazaId: this.plazaId, hubOwnerId: this.ownerId });
    }
    try {
      const created = await matchMaker.createRoom(transfer.room, {
        matchId,
        mode: transfer.mode,
        modifiers: [],
        partySize,
        hubOwnerId: this.ownerId ?? members[0]?.userId,
      });
      let spawnSlot = 0;
      for (const member of members) {
        member.client.send("toast", { message: `Admin — ${content.label}` });
        member.client.send("transfer", {
          room: transfer.room,
          roomId: created.roomId,
          options: {
            mode: transfer.mode,
            modifiers: [],
            hubOwnerId: member.hubOwnerId,
            plazaId: this.plazaId ?? undefined,
            groupId: member.groupId,
            matchId,
            partySize,
            spawnSlot: spawnSlot++,
          },
        });
      }
    } catch (err) {
      console.error("[admin] enter pve failed", err);
      client.send("toast", { message: `Could not start ${content.label}` });
    }
  }

  private async adminStartPvp(
    client: Client,
    modeId: PvpModeId,
    party: HubParty | undefined,
    members: PvpPartyMember[],
  ) {
    const def = PVP_MODES.find((m) => m.id === modeId);
    if (!def) return;
    if (party) {
      markGroupTransferring(party.partyId, true);
      upsertGroupFromParty(party, { plazaId: this.plazaId, hubOwnerId: this.ownerId });
    }
    try {
      await startDirectPvpMatch(
        modeId,
        {
          partyId: party?.partyId ?? `admin_${client.sessionId}`,
          modes: [modeId],
          family: def.family,
          members,
        },
        "custom",
      );
    } catch (err) {
      console.error("[admin] enter pvp failed", err);
      client.send("toast", { message: "Could not start that mode" });
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
      eco.talentBuild,
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
    player.vessel = DEFAULT_COSMETIC_BODY;
    this.vesselConfirmedBySession.set(client.sessionId, false);
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
    upsertGroupFromParty(party, { plazaId: this.plazaId, hubOwnerId: this.ownerId });
    this.broadcastToParty(party, "party_update", { party: toPartySnapshot(party) });
  }

  private broadcastToParty(party: HubParty, type: string, payload: unknown) {
    for (const [sessionId, member] of party.members) {
      if (member.online === false) continue;
      this.sendToSession(sessionId, type, payload);
    }
  }

  /** Park or wake a group member; logged-out hunters stay listed until the grace timer. */
  private syncPartyPresence(sessionId: string, online: boolean) {
    const party = online
      ? this.parties.markOnline(sessionId)
      : this.parties.markOffline(sessionId);
    if (!party) return;
    const member = [...party.members.values()].find((m) => m.sessionId === sessionId);
    const name = member?.displayName ?? "A hunter";
    if (!online) {
      this.unqueueParty(party, "A hunter logged out — re-lock when they're back");
    }
    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", {
      message: online ? `${name} is back` : `${name} logged out — group will wait a few minutes`,
    });
  }

  private pruneOfflineGroupMembers() {
    const now = Date.now();
    const dissolved = pruneExpiredOfflineMembers(now, GROUP_OFFLINE_GRACE_MS);
    for (const party of this.parties.all()) {
      if (dissolved.includes(party.partyId)) {
        this.dissolveParty(party, "Group disbanded — hunters were logged out too long");
        continue;
      }
      const group = getGroup(party.partyId);
      // Invite / solo lobby parties are not in a 2-person persistent group yet.
      if (!group) continue;
      let dropped = false;
      for (const [sessionId, member] of [...party.members]) {
        if (group.members.has(member.userId)) continue;
        this.parties.removeMember(party, sessionId);
        dropped = true;
      }
      const leader = [...party.members.values()].find((m) => m.userId === group.leaderUserId);
      if (leader) party.leaderSessionId = leader.sessionId;
      this.maybeDissolveIdleSocialParty(party);
      if (dropped && this.parties.get(party.partyId)) {
        this.broadcastPartyUpdate(party);
        this.broadcastToParty(party, "toast", {
          message: "A hunter was logged out too long and left the group",
        });
      }
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
    const transferring = getGroup(party.partyId)?.transferring;
    this.parties.dissolve(party);
    if (!transferring) dissolveGroup(party.partyId);
    for (const sessionId of sessionIds) {
      this.sendToSession(sessionId, "party_update", { party: null });
      this.sendToSession(sessionId, "queue_status", { queued: false });
      if (reason) this.sendToSession(sessionId, "toast", { message: reason });
    }
  }

  /** Social groups exist for an invite or 2+ hunters — not a leftover solo box. */
  private maybeDissolveIdleSocialParty(party: HubParty) {
    if (party.queued || party.lobbyOpen) return;
    if (party.members.size >= 2) return;
    if (party.pendingInvites.size > 0 || party.pendingFriendInvites.size > 0) return;
    this.dissolveParty(party, "");
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
    const identity = this.identities.get(sessionId);
    const transferring = getGroup(party.partyId)?.transferring;
    if (identity && !transferring) leaveGroup(identity.userId);
    this.maybeDissolveIdleSocialParty(party);
    if (this.parties.get(party.partyId)) {
      this.broadcastPartyUpdate(party);
      this.broadcastToParty(party, "toast", { message: reason });
    }
  }

  private handleOpenPvpParty(client: Client, family: "skirmish" | "battleground") {
    const identity = this.identities.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!identity || !player) return;

    const token = pvpFamilyToken(family);
    const { validModes } = filterModesForHubSize([token], this.state.players.size);
    if (validModes.length === 0) {
      client.send("toast", { message: "This hub is too full for that playlist" });
      return;
    }

    const party = this.ensurePartyForLeader(client, "pvp", validModes);
    if (!party) return;
    party.lobbyOpen = true;

    if (!this.plazaId) this.pullHubIntoParty(party);
    this.broadcastPartyUpdate(party);
    const label = family === "battleground" ? "Battleground" : "Skirmish";
    this.broadcastToParty(party, "toast", {
      message: `${label} lobby — invite friends, then Find Match.`,
    });
    this.broadcastToParty(party, "ui", { ui: "party_lobby" });
  }

  /**
   * Open a coop Wave Assault lobby (max 4). Solo = leader locks with one seat.
   */
  private handleOpenCoopPveParty(client: Client, contentId: string, modifiers: string[]) {
    const transfer = resolvePveTransfer(contentId);
    const content = PVE_CONTENTS.find((c) => c.id === transfer.mode);
    if (!content?.enabled || !isPveRunMode(transfer.mode)) {
      client.send("toast", { message: "That content isn't available yet" });
      return;
    }

    const identity = this.identities.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!identity || !player) return;

    const modes = [transfer.mode, ...modifiers.filter(Boolean)];
    const party = this.ensurePartyForLeader(client, "coop_pve", modes);
    if (!party) return;
    party.lobbyOpen = true;

    const cap = coopPveCapForModes(modes);
    if (!this.plazaId) this.pullHubIntoParty(party, cap);
    if (party.members.size > cap) {
      client.send("toast", { message: `${content.label} is full (${cap} max)` });
      return;
    }

    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", {
      message: `${content.label} lobby — invite friends or start (solo OK).`,
    });
    this.broadcastToParty(party, "ui", { ui: "party_lobby" });
  }

  /** Reuse the leader's live group, or start one. Does not auto-pull strangers. */
  private ensurePartyForLeader(
    client: Client,
    kind: "pvp" | "coop_pve",
    modes: string[],
  ): HubParty | null {
    const existing = this.parties.getBySession(client.sessionId);
    if (existing) {
      if (existing.leaderSessionId !== client.sessionId) {
        client.send("toast", { message: "Leave your current group before opening a new lobby" });
        return null;
      }
      if (existing.queued) {
        client.send("toast", { message: "Group is already queued" });
        return null;
      }
      retargetParty(existing, kind, modes);
      return existing;
    }
    const identity = this.identities.get(client.sessionId);
    if (!identity) return null;
    return this.parties.create(
      { sessionId: client.sessionId, userId: identity.userId, displayName: identity.displayName },
      modes,
      kind,
    );
  }

  private pullHubIntoParty(party: HubParty, maxMembers?: number) {
    for (const [sessionId, hubPlayer] of this.state.players.entries()) {
      if (sessionId === party.leaderSessionId || hubPlayer.disconnected) continue;
      if (maxMembers && party.members.size >= maxMembers) break;
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
      if (party.kind === "coop_pve" && party.members.size >= coopPveCapForModes(party.modes)) {
        client.send("toast", {
          message: `${PVE_CONTENTS.find((c) => c.id === pveContentIdFromModes(party.modes))?.label ?? "PvE"} is full (${coopPveCapForModes(party.modes)} max)`,
        });
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
      this.broadcastToParty(party, "toast", {
        message: `${memberId.displayName} joined the group`,
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
    if (party.kind === "coop_pve" && party.members.size >= coopPveCapForModes(party.modes)) {
      party.pendingFriendInvites.delete(identity.userId);
      client.send("toast", {
        message: `${PVE_CONTENTS.find((c) => c.id === pveContentIdFromModes(party.modes))?.label ?? "PvE"} is full (${coopPveCapForModes(party.modes)} max)`,
      });
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
    this.broadcastToParty(party, "toast", {
      message: `${identity.displayName} joined the group`,
    });
  }

  private tryRestorePersistentGroup(client: Client, options: AuthJoinOptions) {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return;

    const rebound = this.parties.rebindUser(
      identity.userId,
      client.sessionId,
      identity.displayName,
    );
    if (rebound) {
      this.broadcastPartyUpdate(rebound);
      this.broadcastToParty(rebound, "toast", { message: `${identity.displayName} is back` });
      return;
    }

    if (this.parties.hasAnyParty(client.sessionId)) return;
    const group = getGroup(options.groupId) ?? groupForUser(identity.userId);
    if (!group || group.members.size < 2) return;
    if (!group.members.has(identity.userId)) return;
    markGroupTransferring(group.groupId, false);

    const existing = this.parties.get(group.groupId);
    if (existing) {
      this.parties.addMember(
        existing,
        {
          sessionId: client.sessionId,
          userId: identity.userId,
          displayName: identity.displayName,
        },
        group.members.get(identity.userId)?.seat ?? defaultSeatFor(existing),
      );
      if (identity.userId === group.leaderUserId) {
        existing.leaderSessionId = client.sessionId;
      }
      this.broadcastPartyUpdate(existing);
      this.broadcastToParty(existing, "toast", { message: `${identity.displayName} is back` });
      return;
    }

    const party = this.parties.create(
      {
        sessionId: client.sessionId,
        userId: identity.userId,
        displayName: identity.displayName,
      },
      group.modes.length > 0 ? group.modes : group.kind === "coop_pve" ? ["dungeon"] : [],
      group.kind,
      group.groupId,
    );
    const selfSeat = group.members.get(identity.userId)?.seat;
    if (selfSeat) {
      const self = party.members.get(client.sessionId);
      if (self) self.seat = selfSeat;
    }
    for (const member of group.members.values()) {
      if (member.userId === identity.userId) continue;
      this.parties.addOfflineMember(party, member);
    }
    if (identity.userId !== group.leaderUserId) {
      const leader = [...party.members.values()].find((m) => m.userId === group.leaderUserId);
      if (leader) party.leaderSessionId = leader.sessionId;
    }
    this.broadcastPartyUpdate(party);
  }

  /** Keep a live group on one shard / home instead of splitting on auto-fill. */
  private redirectToGroupDestination(client: Client, userId: string): boolean {
    const group = groupForUser(userId);
    if (!group || group.members.size < 2 || group.transferring) return false;
    if (group.plazaId && group.plazaId !== this.plazaId) {
      client.send("transfer", {
        room: ROOM.PLAZA,
        options: { plazaId: group.plazaId, plazaInvite: true, groupId: group.groupId },
      });
      return true;
    }
    if (group.hubOwnerId && !group.plazaId && (this.plazaId || this.ownerId !== group.hubOwnerId)) {
      client.send("transfer", {
        room: ROOM.BASE_CITY,
        options: { hubOwnerId: group.hubOwnerId, groupId: group.groupId },
      });
      return true;
    }
    return false;
  }

  private plazaStatePayload() {
    const plazaId = this.plazaId ?? "";
    return {
      plazaId,
      code: plazaDisplayCode(plazaId),
      clients: this.clients.length,
      walkIns: this.walkInUserIds.size,
      walkInCap: PLAZA_WALK_IN_CAP,
    };
  }

  private refreshPlazaMetadata() {
    if (!this.plazaId) return;
    void this.setMetadata({
      plazaId: this.plazaId,
      walkIns: this.walkInUserIds.size,
      clients: this.clients.length,
      walkInCap: PLAZA_WALK_IN_CAP,
      maxClients: this.maxClients,
    });
    this.broadcast("plaza_state", this.plazaStatePayload());
  }

  private async listLivePlazas(): Promise<PlazaListing[]> {
    const rooms = await matchMaker.query({ name: ROOM.PLAZA });
    const out: PlazaListing[] = [];
    for (const room of rooms) {
      const meta = (room.metadata ?? {}) as {
        plazaId?: string;
        walkIns?: number;
        walkInCap?: number;
        maxClients?: number;
      };
      const plazaId = typeof meta.plazaId === "string" ? meta.plazaId : "";
      if (!plazaId) continue;
      out.push({
        plazaId,
        code: plazaDisplayCode(plazaId),
        clients: room.clients,
        walkIns: meta.walkIns ?? room.clients,
        walkInCap: meta.walkInCap ?? PLAZA_WALK_IN_CAP,
        maxClients: meta.maxClients ?? this.maxClients,
        roomId: room.roomId,
      });
    }
    out.sort((a, b) => a.plazaId.localeCompare(b.plazaId));
    return out;
  }

  private async handleListPlazas(client: Client) {
    const plazas = await this.listLivePlazas();
    client.send("plaza_list", { plazas, currentPlazaId: this.plazaId ?? undefined });
  }

  private async handleJoinPlaza(client: Client, rawId: string) {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return;
    const party = this.parties.getBySession(client.sessionId);
    const isLeader = !party || party.leaderSessionId === client.sessionId;
    if (party && !isLeader) {
      client.send("toast", { message: "Only the group leader can switch plazas" });
      return;
    }
    let plazaId = rawId.trim();
    if (!plazaId) {
      const listed = await this.listLivePlazas();
      const fit = listed.find(
        (p) => p.plazaId !== this.plazaId && p.walkIns + (party?.members.size ?? 1) <= p.walkInCap,
      );
      if (fit) plazaId = fit.plazaId;
      else {
        const nums = listed.map((p) => Number((p.plazaId.match(/(\d+)$/) ?? [])[1] ?? 0));
        plazaId = `plaza-${Math.max(0, ...nums) + 1}`;
      }
    } else {
      const m = plazaId.match(/^(?:p-?|plaza-)?(\d+)$/i);
      if (m) plazaId = `plaza-${m[1]}`;
    }
    if (this.plazaId && plazaId === this.plazaId) {
      client.send("toast", { message: "Already in this plaza" });
      return;
    }
    if (rawId.trim()) {
      const listed = await this.listLivePlazas();
      const target = listed.find((p) => p.plazaId === plazaId);
      if (!target) {
        client.send("toast", { message: "That plaza is gone — finding another" });
        await this.handleJoinPlaza(client, "");
        return;
      }
    }
    if (party) {
      markGroupTransferring(party.partyId, true);
      upsertGroupFromParty(party, { plazaId, hubOwnerId: null });
    }
    const hoppers = party
      ? [...party.members.values()]
      : [{ sessionId: client.sessionId, userId: identity.userId }];
    for (const member of hoppers) {
      const memberClient = this.clients.find((c) => c.sessionId === member.sessionId);
      if (!memberClient) continue;
      memberClient.send("transfer", {
        room: ROOM.PLAZA,
        options: {
          plazaId,
          plazaInvite: true,
          groupId: party?.partyId,
        },
      });
    }
  }

  private assertCanMoveGroup(client: Client): boolean {
    const party = this.parties.getBySession(client.sessionId);
    if (party && party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the group leader can switch destination" });
      return false;
    }
    return true;
  }

  private transferGroupOrSelf(
    client: Client,
    room: string,
    options: Record<string, unknown>,
  ) {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return;
    const party = this.parties.getBySession(client.sessionId);
    if (party) {
      markGroupTransferring(party.partyId, true);
      upsertGroupFromParty(party, {
        plazaId: typeof options.plazaId === "string" ? options.plazaId : null,
        hubOwnerId: typeof options.hubOwnerId === "string" ? options.hubOwnerId : null,
      });
    }
    const hoppers = party
      ? [...party.members.values()]
      : [{ sessionId: client.sessionId, userId: identity.userId }];
    for (const member of hoppers) {
      const memberClient = this.clients.find((c) => c.sessionId === member.sessionId);
      if (!memberClient) continue;
      memberClient.send("transfer", {
        room,
        options: {
          ...options,
          groupId: party?.partyId,
          plazaInvite: room === ROOM.PLAZA ? true : undefined,
        },
      });
    }
  }

  private async handleJoinHome(client: Client) {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return;
    if (!this.assertCanMoveGroup(client)) return;
    if (!this.plazaId && this.ownerId === identity.userId) {
      client.send("toast", { message: "Already in your city" });
      return;
    }
    this.transferGroupOrSelf(client, ROOM.BASE_CITY, { hubOwnerId: identity.userId });
  }

  private async handleJoinHub(client: Client, hubOwnerId: string) {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return;
    const dest = hubOwnerId.trim();
    if (!dest) return;
    if (!this.plazaId && this.ownerId === dest) {
      client.send("toast", { message: "Already visiting that city" });
      return;
    }
    leaveGroup(identity.userId);
    client.send("transfer", {
      room: ROOM.BASE_CITY,
      options: { hubOwnerId: dest },
    });
  }

  private async handleJoinFriendPlaza(client: Client, friendUserId: string) {
    const friendId = friendUserId.trim();
    if (!friendId) return;
    const spot = getHunterSpot(friendId);
    const plazaId = spot?.plazaId ?? groupForUser(friendId)?.plazaId ?? "";
    if (!plazaId) {
      client.send("toast", { message: "That hunter isn't in a plaza" });
      return;
    }
    await this.handleJoinPlaza(client, plazaId);
  }

  private handleListFriendLocations(client: Client, userIds: string[]) {
    const locations = listHunterSpots(userIds.slice(0, 64).filter((id) => typeof id === "string"));
    client.send("friend_locations", { locations });
  }

  private handlePartyInvite(client: Client, targetSessionId: string | undefined) {
    const identity = this.identities.get(client.sessionId);
    if (!identity) return;
    const party =
      this.parties.getBySession(client.sessionId) ??
      this.ensurePartyForLeader(client, "pvp", [pvpFamilyToken("skirmish")]);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the group leader can invite" });
      return;
    }
    if (!targetSessionId || targetSessionId === client.sessionId) return;
    if (!this.state.players.has(targetSessionId)) {
      client.send("toast", { message: "Hunter not found in hub" });
      return;
    }
    if (party.members.has(targetSessionId)) {
      client.send("toast", { message: "Already in your group" });
      return;
    }
    if (party.kind === "coop_pve" && party.members.size >= coopPveCapForModes(party.modes)) {
      client.send("toast", {
        message: `${PVE_CONTENTS.find((c) => c.id === pveContentIdFromModes(party.modes))?.label ?? "PvE"} is full (${coopPveCapForModes(party.modes)} max)`,
      });
      return;
    }
    if (this.parties.hasAnyParty(targetSessionId)) {
      client.send("toast", { message: "That hunter is already in a group" });
      return;
    }

    party.pendingInvites.add(targetSessionId);
    const leaderName = identity.displayName;
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
      this.sendToSession(party.leaderSessionId, "toast", {
        message: `${this.identities.get(client.sessionId)?.displayName ?? "A hunter"} declined the invite`,
      });
      this.maybeDissolveIdleSocialParty(party);
      if (this.parties.get(party.partyId)) this.broadcastPartyUpdate(party);
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
    if (party.kind === "coop_pve" && party.members.size >= coopPveCapForModes(party.modes)) {
      client.send("toast", {
        message: `${PVE_CONTENTS.find((c) => c.id === pveContentIdFromModes(party.modes))?.label ?? "PvE"} is full (${coopPveCapForModes(party.modes)} max)`,
      });
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
    this.broadcastToParty(party, "toast", { message: `${identity.displayName} joined the group` });
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
    this.maybeDissolveIdleSocialParty(party);
    if (this.parties.get(party.partyId)) this.broadcastPartyUpdate(party);
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
      client.send("toast", { message: "Coop PvE has fighter seats only" });
      return;
    }
    if (seat === "teamC" && partyFamily(party) !== "skirmish") {
      client.send("toast", { message: "Battlegrounds are two-team only" });
      return;
    }
    if (party.queued) {
      client.send("toast", { message: "Party is queued — cancel to change seats" });
      return;
    }

    member.seat = seat;
    if (seat === "teamB" || seat === "teamC") party.splitSides = true;
    if (seat === "teamC") party.teamCOpen = true;
    this.broadcastPartyUpdate(party);
  }

  private handlePartySetLayout(
    client: Client,
    message: { splitSides?: boolean; teamCOpen?: boolean; teamSize?: number },
  ) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can change lobby layout" });
      return;
    }
    if (party.kind === "coop_pve") return;
    if (party.queued) {
      client.send("toast", { message: "Party is queued — cancel to change teams" });
      return;
    }

    if (typeof message.splitSides === "boolean") party.splitSides = message.splitSides;
    if (typeof message.teamCOpen === "boolean") party.teamCOpen = message.teamCOpen;
    if (typeof message.teamSize === "number" && Number.isFinite(message.teamSize)) {
      if (partyFamily(party) === "battleground") {
        const { teamA, teamB } = seatCounts(party);
        const occupied = Math.max(teamA, teamB, 2);
        party.teamSize = Math.max(occupied, Math.min(5, Math.floor(message.teamSize)));
      }
    }
    if (party.teamCOpen && partyFamily(party) !== "skirmish") party.teamCOpen = false;

    if (!party.splitSides) {
      party.teamCOpen = false;
      for (const member of party.members.values()) {
        if (member.seat === "teamB" || member.seat === "teamC") member.seat = "teamA";
      }
    } else if (!party.teamCOpen) {
      for (const member of party.members.values()) {
        if (member.seat === "teamC") member.seat = "teamA";
      }
    }

    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "ui", { ui: "party_lobby" });
  }

  private handlePartySetModes(client: Client, modes: string[]) {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can change modes" });
      return;
    }
    if (party.kind === "coop_pve") {
      client.send("toast", { message: "Coop PvE mode is fixed" });
      return;
    }
    if (party.queued) {
      client.send("toast", { message: "Party is queued — cancel to change modes" });
      return;
    }

    const family =
      parsePvpFamilyToken(modes[0] ?? "") ?? pvpFamilyFromModes(modes.filter(Boolean));
    const token = pvpFamilyToken(family);
    const { validModes } = filterModesForHubSize([token], this.state.players.size);
    if (validModes.length === 0) {
      client.send("toast", { message: "This hub is too full for that playlist" });
      return;
    }

    party.modes = validModes;
    party.teamSize = family === "battleground" ? (party.teamSize ?? 5) : undefined;
    if (family !== "skirmish") party.teamCOpen = false;
    this.broadcastPartyUpdate(party);
    this.broadcastToParty(party, "toast", {
      message: family === "battleground" ? "Playlist: Battleground" : "Playlist: Skirmish",
    });
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

  private async handlePveLeaderboard(client: Client) {
    const identity = this.identities.get(client.sessionId);
    const state = await getPveHubState(identity?.userId ?? null);
    client.send("hub_pve_leaderboard", state);
  }

  private async handlePartyLock(client: Client, matchKind: "ranked" | "unranked" | "coop_pve") {
    const party = this.parties.getBySession(client.sessionId);
    if (!party || party.leaderSessionId !== client.sessionId) {
      client.send("toast", { message: "Only the party leader can lock the queue" });
      return;
    }
    if (party.queued) return;

    const loggedOut = [...party.members.values()].filter((m) => m.online === false);
    if (loggedOut.length > 0) {
      const names = loggedOut.map((m) => m.displayName).join(", ");
      client.send("toast", {
        message:
          loggedOut.length === 1
            ? `${names} is logged out — wait or remove them before queueing`
            : `${names} are logged out — wait or remove them before queueing`,
      });
      return;
    }

    const notReady: string[] = [];
    for (const member of party.members.values()) {
      if (member.seat === "spectator") continue;
      const fighter = this.state.players.get(member.sessionId);
      const slotted = fighter
        ? isLoadoutReady(normalizeLoadout(fighter.loadout.split(",")))
        : false;
      if (!slotted) notReady.push(fighter?.displayName || "A hunter");
    }
    if (notReady.length > 0) {
      client.send("toast", {
        message:
          notReady.length === 1
            ? `${notReady[0]} must slot a spell on every key before queueing`
            : `${notReady.join(", ")} must slot a spell on every key before queueing`,
      });
      return;
    }

    if (party.kind === "coop_pve" || matchKind === "coop_pve") {
      await this.startCoopPveAssault(client, party);
      return;
    }

    const family = partyFamily(party);
    if (!partyFitsFamily(party, family)) {
      client.send("toast", { message: "Party is too large for this playlist — move someone to observers" });
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
        plazaId: this.plazaId,
        groupId: party.partyId,
      });
    }
    if (members.length === 0) return;

    const fighters = members.filter((m) => m.seat !== "spectator").length;
    if (fighters < 1) {
      client.send("toast", { message: "Need at least one fighter" });
      return;
    }

    markGroupTransferring(party.partyId, true);
    upsertGroupFromParty(party, { plazaId: this.plazaId, hubOwnerId: this.ownerId });

    const fullPremade = isFullPremadeLobby(party, family);
    const premadeMode = fullPremade ? resolvePremadeMode(party) : null;

    if (!fullPremade && matchKind === "unranked") {
      client.send("toast", {
        message: "Unranked needs both sides filled for a custom match",
      });
      return;
    }

    const fighterIds = members.filter((m) => m.seat !== "spectator").map((m) => m.userId);
    const avgMmr = await resolvePartyAvgMmr(fighterIds);

    if (fullPremade && premadeMode) {
      party.queued = true;
      this.broadcastPartyUpdate(party);
      try {
        await startDirectPvpMatch(
          premadeMode,
          {
            partyId: party.partyId,
            modes: [pvpFamilyToken(family)],
            family,
            members,
            avgMmr,
          },
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

    party.queued = true;
    enqueuePvpParty({
      partyId: party.partyId,
      modes: [pvpFamilyToken(family)],
      family,
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
    const contentId = pveContentIdFromModes(party.modes);
    const modifiers = party.modes.filter((m) => m !== contentId);
    const transfer = resolvePveTransfer(contentId);
    const content = PVE_CONTENTS.find((c) => c.id === transfer.mode);
    if (!content?.enabled || !isPveRunMode(transfer.mode)) {
      client.send("toast", { message: "That content isn't available yet" });
      return;
    }
    const cap = coopPveCapForModes(party.modes);
    if (party.members.size > cap) {
      client.send("toast", { message: `${content.label} is full (${cap} max)` });
      return;
    }

    const partySize = Math.min(cap, party.members.size);
    const matchId = `pve_${transfer.mode}_${party.partyId}`;
    const partyLobbyHub =
      this.ownerId ??
      party.members.get(party.leaderSessionId)?.userId ??
      null;

    markGroupTransferring(party.partyId, true);
    upsertGroupFromParty(party, { plazaId: this.plazaId, hubOwnerId: this.ownerId });
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
              ? `${content.label} — ${partySize} hunters`
              : `${content.label} — solo run`,
        });
        memberClient.send("transfer", {
          room: transfer.room,
          roomId: created.roomId,
          options: {
            mode: transfer.mode,
            modifiers,
            hubOwnerId,
            plazaId: this.plazaId ?? undefined,
            groupId: party.partyId,
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
      client.send("toast", { message: `Could not start ${content.label}` });
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
    this.maybeDissolveIdleSocialParty(party);
    if (this.parties.get(party.partyId)) {
      this.broadcastPartyUpdate(party);
      this.broadcastToParty(party, "toast", { message: `${name} left the party` });
    }
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
    this.pruneOfflineGroupMembers();

    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.disconnected) continue;

      // Recover from corrupt poses (e.g. bad collider shape → NaN) so the client
      // does not stay on a black screen until a full rejoin.
      if (!Number.isFinite(player.x) || !Number.isFinite(player.z) || !Number.isFinite(player.yaw)) {
        player.x = HUB_SPAWN.x;
        player.z = HUB_SPAWN.z;
        player.yaw = 0;
      }

      const queue = this.inputs.get(sessionId) ?? [];
      while (queue.length > 0) {
        const input = queue.shift()!;
        player.lastInputSeq = input.seq;
        if (player.hp <= 0) continue;

        const fearSourceId = this.combat.getFearSource(sessionId);
        let moveX = input.moveX;
        let moveZ = input.moveZ;
        let yawIn = Number.isFinite(input.yaw) ? input.yaw : player.yaw;

        if (this.combat.statuses.has(sessionId, "disoriented") && !fearSourceId) {
          moveX = -moveX;
          moveZ = -moveZ;
        }

        if (fearSourceId) {
          // Feared! Involuntarily run in the opposite direction from fear source
          let fleeDirX = 0;
          let fleeDirZ = 0;
          const fearSource = this.state.players.get(fearSourceId) ?? this.state.targets.get(fearSourceId);
          if (fearSource) {
            const dx = player.x - fearSource.x;
            const dz = player.z - fearSource.z;
            const d = Math.hypot(dx, dz);
            if (d > 1e-4) {
              fleeDirX = dx / d;
              fleeDirZ = dz / d;
            }
          }
          if (fleeDirX === 0 && fleeDirZ === 0) {
            fleeDirX = Math.sin(player.yaw);
            fleeDirZ = Math.cos(player.yaw);
          }
          moveX = fleeDirX;
          moveZ = fleeDirZ;
          yawIn = Math.atan2(fleeDirX, fleeDirZ);
        }

        const speed = this.combat.getEffectiveMoveSpeed(sessionId);
        const from = { x: player.x, z: player.z };
        const desired = applyMovement(
          from,
          { moveX, moveZ, dt: input.dt || dt },
          speed,
        );
        const tethered = this.combat.constrainAstralChainDesired(sessionId, desired);
        const next = this.combat.movePlayer(sessionId, from, tethered);
        if (Number.isFinite(next.x) && Number.isFinite(next.z)) {
          player.x = next.x;
          player.z = next.z;
        }
        const shieldTurning = this.combat.statuses.has(sessionId, "handShielding");
        player.yaw = applyYaw(
          player.yaw,
          yawIn,
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
    this.tickDummyAggro(now, dt);
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

  private tickDummyAggro(now: number, dt = 0.05) {
    const safeDt = Math.max(1e-4, Math.min(0.05, dt));

    // Feared practice dummies: involuntarily run in the opposite direction from fear source!
    this.state.targets.forEach((dummy, dummyId) => {
      if (dummy.kind !== "dummy") return;
      const fearSourceId = this.combat.getFearSource(dummyId);
      if (!fearSourceId) return;

      this.clearDummyCast(dummyId);
      const aggro = this.dummyAggro.get(dummyId);
      if (aggro) {
        aggro.pendingReleaseAt = 0;
        aggro.nextCastAt = now + 1600;
      }

      let fleeDirX = 0;
      let fleeDirZ = 0;
      const fearSource = this.state.players.get(fearSourceId) ?? this.state.targets.get(fearSourceId);
      if (fearSource) {
        const dx = dummy.x - fearSource.x;
        const dz = dummy.z - fearSource.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) {
          fleeDirX = dx / d;
          fleeDirZ = dz / d;
        }
      }
      if (fleeDirX === 0 && fleeDirZ === 0) {
        fleeDirX = Math.sin(dummy.yaw);
        fleeDirZ = Math.cos(dummy.yaw);
      }
      const fleeSpeed = 5.5; // m/s normal run speed
      const step = fleeSpeed * safeDt;
      const from = { x: dummy.x, z: dummy.z };
      const ideal = { x: dummy.x + fleeDirX * step, z: dummy.z + fleeDirZ * step };
      const next = this.combat.sweepPlayerPos(dummyId, from, ideal);
      if (Number.isFinite(next.x) && Number.isFinite(next.z)) {
        dummy.x = next.x;
        dummy.z = next.z;
      }
      dummy.yaw = Math.atan2(fleeDirX, fleeDirZ);
    });

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

      // Dread Aura reactive check: if inside an active enemy Dread Aura, fear the dummy and abort attack
      if (
        (dummy.castAbilityId || aggro.pendingReleaseAt > 0 || now >= aggro.nextCastAt) &&
        this.combat.checkDreadAuraTriggerTarget(dummyId, dummy.x, dummy.z, now)
      ) {
        this.clearDummyCast(dummyId);
        aggro.pendingReleaseAt = 0;
        aggro.nextCastAt = now + 1600;
        continue;
      }

      // Fear / Stun / silence: drop windup and never release the bolt.
      if (this.combat.getFearSource(dummyId) || !this.combat.statuses.canCast(dummyId)) {
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
