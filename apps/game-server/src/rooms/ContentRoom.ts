import { Client } from "@colyseus/core";
import {
  ARENA_ROUND_COUNTDOWN_MS,
  ARENA_ROUND_END_MS,
  ARENA_ROUNDS_TO_WIN,
  ARENA_WIPE_EMOTE_MS,
  clampPvePartySize,
  COOP_PVE_MAX_PLAYERS,
  PVE_RECONNECT_GRACE_MS,
  PVE_ZOMBIE_KIND,
  PVP_RECONNECT_GRACE_MS,
  RECONNECT_RESUME_GRACE_MS,
  RESPAWN_LOCK_MS,
  ROOM,
  TICK_MS,
  applyMovement,
  applyYaw,
  emptyPlayerUnlocks,
  getEmote,
  HAND_SHIELD_CAST,
  arenaSpawnsForTeam,
  mapAttackablePropsFor,
  mapCollidersFor,
  mapNpcFor,
  npcElementIdFrom,
  NPC_INTERACT_RADIUS,
  mapIdForMode,
  mapSpawn,
  type SpawnPose,
  computeMatchReward,
  isPvpFfaTriosMode,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  cosmeticsEquippedFromFields,
  cosmeticsEquippedToFields,
  ownsEmote,
  outcomeFromMatch,
  rewardRollSalt,
  STARTER_COLORS,
  type MatchRecapRow,
  type MatchRewardResult,
  type MatchKind,
  type NpcAction,
  type PlayerInput,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions, type VerifiedIdentity } from "../auth.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import { grantPendingLoot } from "../pendingLoot.js";
import { insertRewardGrant } from "../persistence.js";
import { bumpQuest } from "../quests.js";
import { applyRankedMatchFinish } from "../ranked.js";
import { WaveDirector } from "../pve/WaveDirector.js";
import { ServicedRoom } from "./ServicedRoom.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

export type ContentJoinOptions = AuthJoinOptions & {
  mode?: string;
  modifiers?: string[];
  matchId?: string;
  matchKind?: MatchKind;
  seasonId?: string | null;
  team?: "a" | "b" | "c" | "";
  role?: "fighter" | "spectator";
  spawnSlot?: number;
  /** Locked coop party size (1–4) — scales Wave Assault difficulty for the whole run. */
  partySize?: number;
};

type ContentKind = "pvp" | "pve";

function kindFromRoomName(roomName: string): ContentKind {
  if (roomName === ROOM.ARENA || roomName === ROOM.BATTLEGROUND) return "pvp";
  return "pve";
}

export class ContentRoom extends ServicedRoom {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private mode = "stub";
  private returnHubOwnerId: string | null = null;
  /** Per-player return lobby (stamped at match transfer / join). */
  private returnHubBySession = new Map<string, string>();
  private kind: ContentKind = "pve";
  /** Registry map backing this room; undefined for modes with no map. */
  private mapId: string | undefined;
  private awaitingReconnect = new Set<string>();
  private resumeGraceClear: (() => void) | null = null;
  private spawnBySession = new Map<string, { x: number; z: number; yaw: number }>();
  /** Per-fighter pad index within their team (0..2 → markers 1–3 / 4–6). */
  private spawnSlotBySession = new Map<string, number>();
  private diedAtBySession = new Map<string, number>();
  private nextTeam: "a" | "b" | "c" = "a";
  /** Set when a PvP match reaches a real conclusion (for essence payouts). */
  private lastMatchWinner: "a" | "b" | "c" | "draw" | null = null;
  private matchId = "";
  private rematchIndex = 0;
  /** userIds already granted for the current matchGrantKey. */
  private grantedUserIds = new Set<string>();
  private activityBySession = new Map<string, { moveTicks: number; castCount: number }>();
  /** Rewards computed at finishMatch for recap / leave idempotency. */
  private recapRewardsBySession = new Map<string, MatchRewardResult>();
  private matchKind: MatchKind = "ranked";
  private seasonId: string | null = null;
  private rankedAppliedForGrantKey = new Set<string>();
  private emoteUntilBySession = new Map<string, number>();
  /** Armed when a team first wipes — delay before endRound for emotes. */
  private wipeEndsAt = 0;
  private wipeWinner: "a" | "b" | "c" | null = null;
  private waveDirector: WaveDirector | null = null;
  /** Wave Assault wipe / score screen active. */
  private pveRunEnded = false;
  /** Difficulty scale for this dungeon run (locked at room create). */
  private partySize = 1;
  /** Expected fighters before auto-starting waves (timeout still starts early). */
  private expectedPartySize = 1;
  private waveStartArmed = false;
  private waveStartTimeout: { clear: () => void } | null = null;

  private matchGrantKey(): string {
    return `${this.matchId || this.roomId}:r${this.rematchIndex}`;
  }

  private activityOf(sessionId: string) {
    let a = this.activityBySession.get(sessionId);
    if (!a) {
      a = { moveTicks: 0, castCount: 0 };
      this.activityBySession.set(sessionId, a);
    }
    return a;
  }

  onCreate(options: ContentJoinOptions) {
    this.setState(new BaseCityState());
    this.mode = options.mode ?? "stub";
    this.returnHubOwnerId = options.hubOwnerId ?? options.userId ?? null;
    this.kind = kindFromRoomName(this.roomName);
    this.matchId = options.matchId ?? `m_${Date.now().toString(36)}`;
    this.matchKind = options.matchKind === "custom" ? "custom" : "ranked";
    this.seasonId = options.seasonId ?? null;
    this.partySize = clampPvePartySize(options.partySize ?? 1);
    this.expectedPartySize = this.partySize;
    this.state.matchMode = this.mode;
    this.setMetadata({
      mode: this.mode,
      matchId: this.matchId,
      kind: this.kind,
      matchKind: this.matchKind,
      partySize: this.partySize,
    });
    if (this.kind === "pve" && this.mode === "dungeon") {
      this.maxClients = COOP_PVE_MAX_PLAYERS;
    }
    this.combat = new CombatSystem(this as never, {
      canHurtPlayers: true,
      onPlayerDamaged: (sessionId, damage, attackerId) => {
        const p = this.state.players.get(sessionId);
        if (!p) return;
        if (damage > 0) p.statDamageTaken += damage;
        const atk = this.state.players.get(attackerId);
        if (atk && damage > 0) atk.statDamageDealt += damage;
        if (p.hp <= 0) {
          if (atk && this.kind === "pvp") atk.statKills += 1;
          this.onPlayerDied(sessionId, p);
        }
      },
      onTargetKilled: (targetId, killerSessionId) => {
        this.waveDirector?.onTargetKilled(targetId);
        if (this.kind === "pve" && killerSessionId) {
          const killer = this.state.players.get(killerSessionId);
          if (killer) killer.statKills += 1;
        }
      },
    });
    // Static geometry comes from whichever map the mode names. Modes without a
    // map (hub, stubs) simply get none, which is what the old kind/mode branch
    // worked out to anyway.
    this.mapId = mapIdForMode(this.mode);
    if (this.mapId) {
      this.combat.setStaticColliders(mapCollidersFor(this.mapId));
      // Props the author gave health to become world targets. They keep the
      // collider they already contributed above; this only adds the HP.
      for (const p of mapAttackablePropsFor(this.mapId)) this.combat.spawnPropTarget(p);
    }
    this.setPatchRate(1000 / 30);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);

    if (this.kind === "pve" && this.mode === "dungeon") {
      this.waveDirector = new WaveDirector(this.state, this.combat, (hud) => {
        this.broadcast("wave_hud", hud);
      }, this.partySize);
    }

    this.onMessage("input", (client, message: { input: PlayerInput }) => {
      if (this.state.paused) return;
      const queue = this.inputs.get(client.sessionId);
      if (!queue || !message?.input) return;
      queue.push(message.input);
      if (queue.length > 64) queue.shift();
    });

    this.onMessage("pve_pause", (client, message: { paused?: boolean }) => {
      if (this.kind !== "pve" || !this.waveDirector) return;
      if (this.pveRunEnded) return;
      if (!this.state.players.has(client.sessionId)) return;
      const pause = Boolean(message?.paused);
      this.state.paused = pause;
      this.state.pauseReason = pause ? "pve_manual" : "";
      this.broadcast("pve_pause", { paused: pause });
    });

    this.onMessage("return_hub", (client) => {
      if (this.kind === "pvp") {
        const name = this.state.players.get(client.sessionId)?.displayName ?? "A hunter";
        this.endMatch(`${name} returned to the city — ending match`);
        return;
      }
      this.sendHome(client);
    });

    this.onMessage("respawn", (client) => {
      // Wave Assault: no mid-run respawn (coop revive later).
      if (this.kind === "pvp" || this.mode === "dungeon") return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;
      const diedAt = this.diedAtBySession.get(client.sessionId) ?? 0;
      if (Date.now() < diedAt + RESPAWN_LOCK_MS) return;
      this.softRespawnPlayer(client.sessionId, player);
    });

    this.onMessage("rematch_vote", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (this.kind === "pve" && this.mode === "dungeon") {
        if (!this.pveRunEnded) return;
        player.rematchReady = true;
        this.tryRestartPveRun();
        return;
      }
      if (this.kind !== "pvp") return;
      if (this.state.matchPhase !== "rematch_wait") return;
      // Spectators do not vote — they never block rematch.
      if (player.role === "spectator") return;
      player.rematchReady = true;
      this.tryStartRematch();
    });

    this.onMessage("cast_emote", (client, message: { emoteId?: string }) => {
      this.handleCastEmote(client, message?.emoteId ?? "");
    });
    this.onMessage("cancel_emote", (client) => {
      this.handleCancelEmote(client);
    });

    // Shop, spells, talents, appearance and quests, so that an NPC merchant or
    // trainer standing in an authored map reaches the same code as the hub.
    this.registerPlayerServices();
  }

  private handleCastEmote(client: Client, emoteId: string) {
    const player = this.state.players.get(client.sessionId);
    // Arena emotes allowed alive or dead (taunts during wipe / round_end).
    if (!player || !emoteId || player.role === "spectator") return;
    const unlocks = this.unlocksBySession.get(client.sessionId) ?? emptyPlayerUnlocks();
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
    if (now < until - 200) return;
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

  async onAuth(_client: Client, options: ContentJoinOptions) {
    return verifyJoinOptions(options);
  }

  async onJoin(client: Client, options: ContentJoinOptions, identity?: VerifiedIdentity) {
    if (!identity || identity.isGuest) {
      throw new Error("Authentication required");
    }
    const verified = identity;

    const existing = this.state.players.get(client.sessionId);
    if (existing) {
      existing.disconnected = false;
      this.awaitingReconnect.delete(client.sessionId);
      this.identities.set(client.sessionId, verified);
      if (!this.inputs.has(client.sessionId)) this.inputs.set(client.sessionId, []);
      // Keep prior return hub; refresh if join options still carry one.
      this.rememberReturnHub(client.sessionId, verified.userId, options);
      client.send("toast", { message: "Reconnected" });
      this.scheduleResumeGrace();
      return;
    }

    this.rememberReturnHub(client.sessionId, verified.userId, options);
    if (!this.returnHubOwnerId) {
      this.returnHubOwnerId = this.returnHubBySession.get(client.sessionId) ?? verified.userId;
    }

    this.identities.set(client.sessionId, verified);

    const player = new PlayerState();
    player.id = verified.userId;
    player.displayName = verified.displayName;
    player.color = options.color ?? STARTER_COLORS[0]!;
    player.pattern = normalizeCosmeticPattern((options as { pattern?: string }).pattern);
    player.patternColor = normalizeCosmeticPatternColor(
      (options as { patternColor?: string }).patternColor,
    );
    {
      const o = options as {
        cosmeticHat?: string;
        cosmeticShoulders?: string;
        cosmeticChest?: string;
        cosmeticGloves?: string;
        cosmeticBelt?: string;
        cosmeticLegs?: string;
        cosmeticShoes?: string;
      };
      const fields = cosmeticsEquippedToFields(
        cosmeticsEquippedFromFields({
          cosmeticHat: o.cosmeticHat,
          cosmeticShoulders: o.cosmeticShoulders,
          cosmeticChest: o.cosmeticChest,
          cosmeticGloves: o.cosmeticGloves,
          cosmeticBelt: o.cosmeticBelt,
          cosmeticLegs: o.cosmeticLegs,
          cosmeticShoes: o.cosmeticShoes,
        }),
      );
      player.cosmeticHat = fields.cosmeticHat;
      player.cosmeticShoulders = fields.cosmeticShoulders;
      player.cosmeticChest = fields.cosmeticChest;
      player.cosmeticGloves = fields.cosmeticGloves;
      player.cosmeticBelt = fields.cosmeticBelt;
      player.cosmeticLegs = fields.cosmeticLegs;
      player.cosmeticShoes = fields.cosmeticShoes;
    }

    if (this.kind === "pvp") {
      const role = options.role === "spectator" ? "spectator" : "fighter";
      player.role = role;
      if (role === "spectator") {
        player.team = "";
        player.x = 0;
        player.z = 0;
        player.invulnerable = true;
        this.spawnBySession.set(client.sessionId, { x: 0, z: 0, yaw: player.yaw });
      } else {
        const ffa = isPvpFfaTriosMode(this.mode);
        const team =
          options.team === "a" ||
          options.team === "b" ||
          (ffa && options.team === "c")
            ? options.team
            : this.nextTeam;
        if (ffa) {
          this.nextTeam = team === "a" ? "b" : team === "b" ? "c" : "a";
        } else {
          this.nextTeam = team === "a" ? "b" : "a";
        }
        player.team = team;
        if (ffa) {
          this.spawnSlotBySession.set(client.sessionId, 0);
          const spawn = this.spawnPose(team as "a" | "b" | "c", 0, true);
          player.x = spawn.x;
          player.z = spawn.z;
          player.yaw = spawn.yaw;
          this.spawnBySession.set(client.sessionId, {
            x: spawn.x,
            z: spawn.z,
            yaw: spawn.yaw,
          });
        } else {
          const preferred = Number(options.spawnSlot);
          const slot = this.claimTeamSpawnSlot(
            team as "a" | "b",
            Number.isFinite(preferred) ? Math.floor(preferred) : undefined,
          );
          this.spawnSlotBySession.set(client.sessionId, slot);
          const spawn = this.spawnPose(team as "a" | "b", slot, false);
          player.x = spawn.x;
          player.z = spawn.z;
          player.yaw = spawn.yaw;
          this.spawnBySession.set(client.sessionId, {
            x: spawn.x,
            z: spawn.z,
            yaw: spawn.yaw,
          });
        }
      }
    } else {
      // PvE / dungeon: staggered cemetery pads so coop fighters don't stack.
      let spawn: { x: number; z: number; yaw: number };
      if (this.mode === "dungeon") {
        const preferred = Number(options.spawnSlot);
        const slot = this.claimDungeonSpawnSlot(
          Number.isFinite(preferred) ? Math.floor(preferred) : undefined,
        );
        this.spawnSlotBySession.set(client.sessionId, slot);
        spawn = this.spawnPose("a", slot, false);
      } else {
        const spawnIndex = this.state.players.size;
        const angle = (spawnIndex / Math.max(1, this.maxClients)) * Math.PI * 2;
        spawn = {
          x: Math.cos(angle) * 4,
          z: Math.sin(angle) * 4,
          yaw: 0,
        };
      }
      player.x = spawn.x;
      player.z = spawn.z;
      player.yaw = spawn.yaw;
      this.spawnBySession.set(client.sessionId, {
        x: spawn.x,
        z: spawn.z,
        yaw: spawn.yaw,
      });
    }

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);
    this.combat.syncSessionKit(client.sessionId, player.loadout, player.talents, {});

    if (this.kind === "pve" && this.mode === "dungeon" && this.waveDirector) {
      this.armWaveStart();
    }

    // Awaited, not fired off. An NPC merchant means a purchase can arrive in
    // the first frames here, and a half-loaded player has a zeroed wallet --
    // which would not merely fail the sale, it would save that zero over the
    // real balance. Colyseus holds the client until onJoin resolves.
    await this.loadPlayerEconomy(client.sessionId, player, verified);
    this.applyCombatKit(client.sessionId, player);
    this.sendInventory(client, player);

    client.send("toast", {
      message:
        this.kind === "pvp"
          ? `Arena ${this.mode} — first to ${ARENA_ROUNDS_TO_WIN} rounds`
          : `Entered ${this.mode} — Return to city when ready`,
    });

    if (this.kind === "pvp" && !this.state.matchPhase) {
      this.maybeBeginMatch();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (consented) {
      const name = player.displayName;
      this.stripPlayer(sessionId);
      this.afterSeatEmpty(name, "abandon");
      return;
    }

    player.disconnected = true;
    this.awaitingReconnect.add(sessionId);
    const graceMs = this.kind === "pvp" ? PVP_RECONNECT_GRACE_MS : PVE_RECONNECT_GRACE_MS;
    const reason = this.kind === "pvp" ? "pvp_reconnect" : "pve_reconnect";
    const displayName = player.displayName;
    this.beginPause(reason, graceMs, displayName);

    try {
      await this.allowReconnection(client, graceMs / 1000);
      const restored = this.state.players.get(sessionId);
      if (restored) restored.disconnected = false;
      this.awaitingReconnect.delete(sessionId);
      this.broadcast("toast", { message: `${displayName} reconnected` });
      this.scheduleResumeGrace();
    } catch {
      if (!this.state.players.has(sessionId)) return;
      this.stripPlayer(sessionId);
      this.afterSeatEmpty(displayName, "timeout");
    }
  }

  private beginPause(reason: "pvp_reconnect" | "pve_reconnect", graceMs: number, playerName: string) {
    this.clearResumeGrace();
    const until = Date.now() + graceMs;
    this.state.paused = true;
    this.state.pauseReason = reason;
    this.state.reconnectUntil = until;
    this.broadcast("match_pause", { reason, until, playerName });
  }

  private scheduleResumeGrace() {
    if (!this.canResume()) return;
    if (!this.state.paused) return;
    this.clearResumeGrace();
    const until = Date.now() + RECONNECT_RESUME_GRACE_MS;
    this.state.paused = true;
    this.state.pauseReason = "resume_grace";
    this.state.reconnectUntil = until;
    this.broadcast("match_pause", { reason: "resume_grace", until });
    const timeout = this.clock.setTimeout(() => {
      this.resumeGraceClear = null;
      this.forceResume();
    }, RECONNECT_RESUME_GRACE_MS);
    this.resumeGraceClear = () => {
      timeout.clear();
      this.resumeGraceClear = null;
    };
  }

  private clearResumeGrace() {
    this.resumeGraceClear?.();
    this.resumeGraceClear = null;
  }

  private canResume() {
    let anyDisconnected = false;
    this.state.players.forEach((p) => {
      if (p.disconnected) anyDisconnected = true;
    });
    return !anyDisconnected && this.awaitingReconnect.size === 0;
  }

  private forceResume() {
    if (!this.canResume() || !this.state.paused) return;
    this.clearResumeGrace();
    this.state.paused = false;
    this.state.pauseReason = "";
    this.state.reconnectUntil = 0;
    this.broadcast("match_resume", {});
  }

  private stripPlayer(sessionId: string) {
    this.awaitingReconnect.delete(sessionId);
    this.state.players.delete(sessionId);
    this.inputs.delete(sessionId);
    this.identities.delete(sessionId);
    this.spawnBySession.delete(sessionId);
    this.spawnSlotBySession.delete(sessionId);
    this.diedAtBySession.delete(sessionId);
    this.clearPlayerServices(sessionId);
    this.emoteUntilBySession.delete(sessionId);
    this.returnHubBySession.delete(sessionId);
    this.combat.clearSession(sessionId);
  }

  /**
   * Unique cemetery pad (0..COOP_PVE_MAX_PLAYERS-1). Prefers matchmaking spawnSlot when free.
   */
  private claimDungeonSpawnSlot(preferred?: number): number {
    const max = COOP_PVE_MAX_PLAYERS;
    const used = new Set<number>();
    for (const [sessionId] of this.state.players.entries()) {
      const slot = this.spawnSlotBySession.get(sessionId);
      if (typeof slot === "number") used.add(slot);
    }
    if (
      preferred != null &&
      preferred >= 0 &&
      preferred < max &&
      !used.has(preferred)
    ) {
      return preferred;
    }
    for (let i = 0; i < max; i++) {
      if (!used.has(i)) return i;
    }
    return Math.min(max - 1, Math.max(0, preferred ?? 0));
  }

  /**
   * Start waves once expected party size has joined, or after a short timeout
   * so a late / missing transfer doesn't stall forever.
   */
  private armWaveStart() {
    if (!this.waveDirector || this.waveStartArmed) return;
    const present = this.state.players.size;
    if (present >= this.expectedPartySize) {
      this.startWavesNow();
      return;
    }
    if (this.waveStartTimeout) return;
    this.waveStartTimeout = this.clock.setTimeout(() => {
      this.waveStartTimeout = null;
      this.startWavesNow();
    }, 2000);
  }

  private startWavesNow() {
    if (!this.waveDirector || this.waveStartArmed) return;
    this.waveStartArmed = true;
    if (this.waveStartTimeout) {
      this.waveStartTimeout.clear();
      this.waveStartTimeout = null;
    }
    this.waveDirector.start(Date.now());
  }

  /**
   * Unique pad within a team (0-based). Prefers matchmaking's spawnSlot when free;
   * otherwise the next open pad so allies never stack on the same marker.
   */
  private claimTeamSpawnSlot(team: "a" | "b", preferred?: number): number {
    const max = Math.max(1, arenaSpawnsForTeam(team).length);
    const used = new Set<number>();
    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.role !== "fighter" || player.team !== team) continue;
      const slot = this.spawnSlotBySession.get(sessionId);
      if (typeof slot === "number") used.add(slot);
    }
    if (
      preferred != null &&
      preferred >= 0 &&
      preferred < max &&
      !used.has(preferred)
    ) {
      return preferred;
    }
    for (let i = 0; i < max; i++) {
      if (!used.has(i)) return i;
    }
    return Math.min(max - 1, Math.max(0, preferred ?? 0));
  }

  private onPlayerDied(sessionId: string, player: PlayerState) {
    player.castAbilityId = "";
    player.castPhase = "";
    player.castLockUntil = 0;
    player.castPhaseEndsAt = 0;
    player.castComboHit = 0;
    player.invulnerable = false;
    player.statuses.clear();
    this.combat.clearSession(sessionId);
    if (this.kind === "pvp") {
      player.roundDead = true;
      player.hp = 0;
      return;
    }
    if (!this.diedAtBySession.has(sessionId)) {
      this.diedAtBySession.set(sessionId, Date.now());
    }
    if (this.mode === "dungeon") {
      this.checkPveWipe();
    }
  }

  private checkPveWipe() {
    if (this.kind !== "pve" || this.mode !== "dungeon" || this.pveRunEnded) return;
    let living = 0;
    let fighters = 0;
    this.state.players.forEach((p) => {
      if (p.disconnected) return;
      if (p.role === "spectator") return;
      fighters += 1;
      if (p.hp > 0) living += 1;
    });
    // Wipe when every present fighter is dead (no ally revive in v1).
    if (fighters > 0 && living === 0) {
      this.finishPveRun();
    }
  }

  private clearWaveMobs() {
    const ids: string[] = [];
    this.state.targets.forEach((t, id) => {
      if (t.kind === PVE_ZOMBIE_KIND) ids.push(id);
    });
    for (const id of ids) {
      this.waveDirector?.onTargetKilled(id);
      this.state.targets.delete(id);
    }
  }

  private finishPveRun() {
    if (this.pveRunEnded) return;
    this.pveRunEnded = true;
    this.state.paused = true;
    this.state.pauseReason = "pve_run_end";
    this.waveDirector?.stop();
    this.clearWaveMobs();
    this.combat.clearRoundWorldEffects();

    let kills = 0;
    this.state.players.forEach((p) => {
      kills += p.statKills;
      p.rematchReady = false;
    });
    const wave = this.waveDirector?.getWaveIndex() ?? 0;
    this.broadcast("pve_run_end", { kills, wave });
    this.broadcast("pve_pause", { paused: true });
  }

  private tryRestartPveRun() {
    if (!this.pveRunEnded || this.kind !== "pve" || this.mode !== "dungeon") return;
    let ready = 0;
    let total = 0;
    this.state.players.forEach((p) => {
      if (p.disconnected) return;
      total += 1;
      if (p.rematchReady) ready += 1;
    });
    if (total === 0 || ready < total) return;

    this.pveRunEnded = false;
    this.state.paused = false;
    this.state.pauseReason = "";
    this.clearWaveMobs();
    this.combat.clearRoundWorldEffects();
    this.state.players.forEach((p, sessionId) => {
      p.statKills = 0;
      p.statDamageDealt = 0;
      p.statDamageTaken = 0;
      p.statHealing = 0;
      p.statShield = 0;
      p.rematchReady = false;
      this.softRespawnPlayer(sessionId, p);
    });
    this.waveDirector?.resetRun(Date.now());
    this.broadcast("pve_run_restart", {});
    this.broadcast("pve_pause", { paused: false });
  }

  private softRespawnPlayer(sessionId: string, player: PlayerState) {
    const spawn = this.spawnBySession.get(sessionId) ?? { x: 0, z: 0, yaw: 0 };
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
    player.roundDead = false;
    player.statuses.clear();
    this.diedAtBySession.delete(sessionId);
    this.combat.clearSession(sessionId);
  }

  private fighters(): PlayerState[] {
    const list: PlayerState[] = [];
    this.state.players.forEach((p) => {
      if (
        p.role === "fighter" &&
        (p.team === "a" || p.team === "b" || p.team === "c") &&
        !p.disconnected
      ) {
        list.push(p);
      }
    });
    return list;
  }

  /**
   * Spawn pose from this room's map, falling back to the origin.
   *
   * The fallback is deliberately loud-ish: a map with no pad for this team
   * stacks everyone at 0,0, which is obvious in play, rather than throwing
   * mid-join and dropping the client.
   */
  private spawnPose(team: "a" | "b" | "c", slot: number, ffa: boolean): SpawnPose {
    const pose = this.mapId ? mapSpawn(this.mapId, { team, slot, ffa }) : undefined;
    if (pose) return pose;
    console.warn(`[ContentRoom] no spawn for team ${team} slot ${slot} on map "${this.mapId}"`);
    return { x: 0, z: 0, yaw: 0 };
  }

  private maybeBeginMatch() {
    const fighters = this.fighters();
    const hasA = fighters.some((p) => p.team === "a");
    const hasB = fighters.some((p) => p.team === "b");
    if (isPvpFfaTriosMode(this.mode)) {
      const hasC = fighters.some((p) => p.team === "c");
      if (hasA && hasB && hasC) this.startRound(1);
      return;
    }
    if (hasA && hasB) this.startRound(1);
  }

  private startRound(round: number) {
    this.wipeEndsAt = 0;
    this.wipeWinner = null;
    this.state.matchRound = round;
    if (round === 1) {
      this.state.scoreA = 0;
      this.state.scoreB = 0;
      this.state.scoreC = 0;
      this.state.players.forEach((p) => {
        p.statKills = 0;
        p.statDamageDealt = 0;
        p.statDamageTaken = 0;
        p.statHealing = 0;
        p.statShield = 0;
        p.rematchReady = false;
      });
    }

    const ffa = isPvpFfaTriosMode(this.mode);
    const fallbackSlots = { a: 0, b: 0 };
    this.state.players.forEach((p, sessionId) => {
      if (p.role !== "fighter") return;
      if (p.team !== "a" && p.team !== "b" && p.team !== "c") return;
      if (ffa) {
        const team = p.team as "a" | "b" | "c";
        const spawn = mapSpawn(this.mapId ?? "", { team, slot: 0, ffa: true });
        if (spawn) {
          p.x = spawn.x;
          p.z = spawn.z;
          p.yaw = spawn.yaw;
          this.spawnBySession.set(sessionId, { x: spawn.x, z: spawn.z, yaw: spawn.yaw });
        }
      } else {
        if (p.team === "c") return;
        const team = p.team as "a" | "b";
        let slot = this.spawnSlotBySession.get(sessionId);
        if (typeof slot !== "number") {
          slot = fallbackSlots[team]++;
          this.spawnSlotBySession.set(sessionId, slot);
        }
        const spawn = mapSpawn(this.mapId ?? "", { team, slot });
        if (spawn) {
          p.x = spawn.x;
          p.z = spawn.z;
          p.yaw = spawn.yaw;
          this.spawnBySession.set(sessionId, { x: spawn.x, z: spawn.z, yaw: spawn.yaw });
        }
      }
      p.hp = p.maxHp;
      // No carry between rounds. Openings are then always played on the base
      // kit, and the payoff moments land late in a round once someone has
      // earned them.
      p.energy = 0;
      p.roundDead = false;
      p.statuses.clear();
      p.castAbilityId = "";
      p.castPhase = "";
      p.castLockUntil = 0;
      p.castPhaseEndsAt = 0;
      p.castComboHit = 0;
      p.invulnerable = false;
      this.diedAtBySession.delete(sessionId);
      this.combat.clearSession(sessionId);
    });

    this.state.matchPhase = "countdown";
    this.state.phaseEndsAt = Date.now() + ARENA_ROUND_COUNTDOWN_MS;
    this.broadcast("toast", { message: `Round ${round} — get ready` });
  }

  private endRound(winner: "a" | "b" | "c") {
    this.wipeEndsAt = 0;
    this.wipeWinner = null;
    this.combat.clearRoundWorldEffects();
    if (winner === "a") this.state.scoreA += 1;
    else if (winner === "b") this.state.scoreB += 1;
    else this.state.scoreC += 1;
    this.state.matchPhase = "round_end";
    this.state.phaseEndsAt = Date.now() + ARENA_ROUND_END_MS;
    const scoreLine = isPvpFfaTriosMode(this.mode)
      ? `${this.state.scoreA}–${this.state.scoreB}–${this.state.scoreC}`
      : `${this.state.scoreA}–${this.state.scoreB}`;
    this.broadcast("toast", {
      message: `Round over — Team ${winner.toUpperCase()} (${scoreLine})`,
    });
  }

  private finishMatch(winner: "a" | "b" | "c" | "draw") {
    this.state.matchPhase = "match_end";
    this.state.phaseEndsAt = 0;
    this.lastMatchWinner = winner;
    const rows: MatchRecapRow[] = [];
    this.state.players.forEach((p, sessionId) => {
      const reward = this.computeAndGrantLoot(p, sessionId, false);
      rows.push({
        sessionId,
        displayName: p.displayName,
        team: p.team,
        kills: p.statKills,
        damageDealt: p.statDamageDealt,
        damageTaken: p.statDamageTaken,
        healing: p.statHealing,
        shield: p.statShield,
        rewards: reward
          ? {
              essence: reward.essence,
              copper: reward.copper,
              activityMul: reward.activityMul,
              base: reward.breakdown.baseEssence,
              winBonus: reward.breakdown.winBonusEssence,
            }
          : undefined,
      });
    });

    void this.applyRankedAndAugmentRecap(winner, rows).then((augmented) => {
      this.broadcast("match_recap", {
        winner,
        scoreA: this.state.scoreA,
        scoreB: this.state.scoreB,
        scoreC: isPvpFfaTriosMode(this.mode) ? this.state.scoreC : undefined,
        matchKind: this.matchKind,
        rows: augmented,
      });
    });

    this.state.matchPhase = "rematch_wait";
    this.state.players.forEach((p) => {
      // Spectators never block rematch readiness.
      p.rematchReady = p.role === "spectator";
    });
  }

  private async applyRankedAndAugmentRecap(
    winner: "a" | "b" | "c" | "draw",
    rows: MatchRecapRow[],
  ): Promise<MatchRecapRow[]> {
    if (this.kind !== "pvp" || this.matchKind !== "ranked") return rows;
    const grantKey = this.matchGrantKey();
    if (this.rankedAppliedForGrantKey.has(grantKey)) return rows;

    const players: Array<{ userId: string; team: "a" | "b" | "c" | "" }> = [];
    this.state.players.forEach((p, sessionId) => {
      if (p.role === "spectator") return;
      const userId =
        (p.id && p.id.length > 0 ? p.id : null) ??
        this.identities.get(sessionId)?.userId ??
        "";
      if (!userId) return;
      const team =
        p.team === "a" || p.team === "b" || p.team === "c" ? p.team : "";
      players.push({ userId, team });
    });

    if (players.length === 0) {
      console.warn("[ranked] content finish skipped — no fighter user ids", {
        matchId: grantKey,
      });
      return rows;
    }

    const finish = await applyRankedMatchFinish({
      matchId: grantKey,
      mode: this.mode,
      kind: "ranked",
      winner,
      players,
    });
    const results = finish.results;

    // Only lock in-memory after a successful DB persist so a failed write can retry.
    if (finish.persisted && results.length > 0) {
      this.rankedAppliedForGrantKey.add(grantKey);
    } else if (results.length === 0) {
      console.error("[ranked] finish produced no results", {
        matchId: grantKey,
        mode: this.mode,
        winner,
        fighters: players.length,
      });
      this.broadcast("toast", {
        message: "Ranked LP could not be saved — check game-server Supabase service key",
      });
    } else if (!finish.persisted) {
      this.broadcast("toast", {
        message: "Ranked reward shown, but ladder save failed — restart game-server if this persists",
      });
    }

    const byUser = new Map(results.map((r) => [r.userId, r]));
    for (const r of results) {
      if (r.delta.after.tier !== r.delta.before.tier) {
        void bumpQuest(r.userId, { type: "ranked_tier_reached", tier: r.delta.after.tier });
      }
    }
    return rows.map((row) => {
      const player = this.state.players.get(row.sessionId);
      const sessionId = row.sessionId;
      const userId =
        (player?.id && player.id.length > 0 ? player.id : null) ??
        this.identities.get(sessionId)?.userId;
      const ranked = userId ? byUser.get(userId) : undefined;
      if (!ranked) return row;
      return {
        ...row,
        ranked: {
          label: ranked.label,
          mmrDelta: ranked.delta.mmrDelta,
          lpDelta: ranked.delta.lpDelta,
          lpAfter: ranked.delta.after.lp,
          tierBefore: ranked.delta.before.tier,
          tierAfter: ranked.delta.after.tier,
          divisionBefore: ranked.delta.before.division,
          divisionAfter: ranked.delta.after.division,
          promoted: ranked.delta.promoted,
          demoted: ranked.delta.demoted,
          placementRemaining: ranked.delta.after.placementRemaining,
        },
      };
    });
  }

  private computeRewardForPlayer(
    player: PlayerState,
    sessionId: string,
    earlyLeave: boolean,
  ): MatchRewardResult {
    const outcome = outcomeFromMatch({
      kind: this.kind,
      earlyLeave,
      winner: this.lastMatchWinner,
      team: player.team,
    });
    const activity = this.activityOf(sessionId);
    return computeMatchReward({
      mode: this.mode,
      outcome,
      activity,
      rollSalt: rewardRollSalt(this.matchGrantKey(), player.id || sessionId),
    });
  }

  /** Grant once per user per matchGrantKey. Returns reward used (for recap). */
  private computeAndGrantLoot(
    player: PlayerState,
    sessionId: string,
    earlyLeave: boolean,
  ): MatchRewardResult | null {
    if (!player.id) return null;
    if (player.role === "spectator") return null;
    if (this.grantedUserIds.has(player.id)) {
      return this.recapRewardsBySession.get(sessionId) ?? null;
    }
    const reward = this.computeRewardForPlayer(player, sessionId, earlyLeave);
    this.grantedUserIds.add(player.id);
    this.recapRewardsBySession.set(sessionId, reward);

    const outcome = outcomeFromMatch({
      kind: this.kind,
      earlyLeave,
      winner: this.lastMatchWinner,
      team: player.team,
    });
    const source = this.kind === "pvp" ? "pvp_match" : "pve_clear";
    const sourceKey = `${this.matchGrantKey()}:${player.id}`;
    const payload = {
      copper: reward.copper,
      silver: reward.silver,
      gold: reward.gold,
      essence: reward.essence,
      activityMul: reward.activityMul,
      base: reward.breakdown.baseEssence,
      winBonus: reward.breakdown.winBonusEssence,
      meta: {
        mode: this.mode,
        outcome,
      },
    };

    void insertRewardGrant(player.id, source, sourceKey, payload);
    grantPendingLoot(player.id, {
      copper: reward.copper,
      silver: reward.silver,
      gold: reward.gold,
      essence: reward.essence,
    });

    if (this.kind === "pvp") {
      void bumpQuest(player.id, { type: "pvp_mode", mode: this.mode });
      if (outcome !== "leave_early") {
        void bumpQuest(player.id, { type: "pvp_match_completed" });
      }
      if (this.matchKind === "ranked" && outcome !== "leave_early") {
        void bumpQuest(player.id, { type: "ranked_match_completed" });
        if (outcome === "win") void bumpQuest(player.id, { type: "ranked_win" });
      }
    }
    if (reward.essence > 0) {
      void bumpQuest(player.id, { type: "essence_earned", amount: reward.essence });
    }
    if (reward.copper > 0) {
      void bumpQuest(player.id, { type: "copper_earned", amount: reward.copper });
    }

    return reward;
  }

  private grantMatchLoot(player: PlayerState, sessionId: string, earlyLeave: boolean) {
    this.computeAndGrantLoot(player, sessionId, earlyLeave);
  }

  private tryStartRematch() {
    let ready = 0;
    let total = 0;
    this.state.players.forEach((p) => {
      if (p.disconnected) return;
      if (p.role === "spectator") return;
      total += 1;
      if (p.rematchReady) ready += 1;
    });
    if (total > 0 && ready >= total) {
      this.rematchIndex += 1;
      this.grantedUserIds.clear();
      this.recapRewardsBySession.clear();
      this.activityBySession.clear();
      this.lastMatchWinner = null;
      this.startRound(1);
    }
  }

  private checkRoundWipe(now: number) {
    if (this.state.matchPhase !== "fighting") return;

    if (isPvpFfaTriosMode(this.mode)) {
      const living = this.fighters().filter((p) => !p.roundDead && p.hp > 0);
      if (living.length === 0) {
        this.wipeEndsAt = 0;
        this.wipeWinner = null;
        this.combat.clearRoundWorldEffects();
        this.startRound(this.state.matchRound);
        return;
      }
      if (living.length === 1) {
        const winner = living[0]!.team as "a" | "b" | "c";
        if (!this.wipeEndsAt || this.wipeWinner !== winner) {
          this.wipeEndsAt = now + ARENA_WIPE_EMOTE_MS;
          this.wipeWinner = winner;
        }
        return;
      }
      this.wipeEndsAt = 0;
      this.wipeWinner = null;
      return;
    }

    const livingA = this.fighters().filter((p) => p.team === "a" && !p.roundDead && p.hp > 0);
    const livingB = this.fighters().filter((p) => p.team === "b" && !p.roundDead && p.hp > 0);
    if (livingA.length === 0 && livingB.length === 0) {
      // Simultaneous wipe (e.g. shared AoE) — nobody wins, replay the round.
      this.wipeEndsAt = 0;
      this.wipeWinner = null;
      this.combat.clearRoundWorldEffects();
      this.startRound(this.state.matchRound);
      return;
    }
    if (livingA.length === 0) {
      if (!this.wipeEndsAt || this.wipeWinner !== "b") {
        this.wipeEndsAt = now + ARENA_WIPE_EMOTE_MS;
        this.wipeWinner = "b";
      }
    } else if (livingB.length === 0) {
      if (!this.wipeEndsAt || this.wipeWinner !== "a") {
        this.wipeEndsAt = now + ARENA_WIPE_EMOTE_MS;
        this.wipeWinner = "a";
      }
    } else {
      // Someone revived / unexpected — cancel pending wipe.
      this.wipeEndsAt = 0;
      this.wipeWinner = null;
    }
  }

  private advanceMatchPhases(now: number) {
    if (this.kind !== "pvp" || this.state.paused) return;
    const phase = this.state.matchPhase;
    if (phase === "") {
      this.maybeBeginMatch();
    } else if (phase === "countdown" && now >= this.state.phaseEndsAt) {
      this.state.matchPhase = "fighting";
      this.state.phaseEndsAt = 0;
      this.wipeEndsAt = 0;
      this.wipeWinner = null;
      this.broadcast("toast", { message: "Fight!" });
    } else if (phase === "round_end" && now >= this.state.phaseEndsAt) {
      if (this.state.scoreA >= ARENA_ROUNDS_TO_WIN) this.finishMatch("a");
      else if (this.state.scoreB >= ARENA_ROUNDS_TO_WIN) this.finishMatch("b");
      else if (
        isPvpFfaTriosMode(this.mode) &&
        this.state.scoreC >= ARENA_ROUNDS_TO_WIN
      ) {
        this.finishMatch("c");
      } else this.startRound(this.state.matchRound + 1);
    } else if (phase === "fighting") {
      this.checkRoundWipe(now);
      if (
        this.wipeEndsAt > 0 &&
        this.wipeWinner &&
        now >= this.wipeEndsAt &&
        this.state.matchPhase === "fighting"
      ) {
        this.endRound(this.wipeWinner);
      }
    }
  }

  private afterSeatEmpty(playerName: string, cause: "abandon" | "timeout") {
    const remaining = this.state.players.size;
    if (this.kind === "pvp") {
      this.broadcast("match_forfeit", { playerName });
      const fighters = this.fighters();
      const ffa = isPvpFfaTriosMode(this.mode);
      const teamEmpty =
        this.state.matchPhase !== "" &&
        (ffa
          ? !fighters.some((p) => p.team === "a") ||
            !fighters.some((p) => p.team === "b") ||
            !fighters.some((p) => p.team === "c")
          : !fighters.some((p) => p.team === "a") ||
            !fighters.some((p) => p.team === "b"));
      if (remaining < 2 || teamEmpty) {
        this.endMatch("Not enough hunters left — returning to city");
        return;
      }
      this.forceResume();
      return;
    }
    this.broadcast("match_rebalance", { remaining, playerName });
    if (remaining === 0) {
      void this.disconnect();
      return;
    }
    if (this.mode === "dungeon") this.checkPveWipe();
    this.forceResume();
  }

  private rememberReturnHub(sessionId: string, userId: string, options: ContentJoinOptions) {
    const hub = options.hubOwnerId || userId;
    if (hub) this.returnHubBySession.set(sessionId, hub);
  }

  private hubForClient(client: Client): string {
    return (
      this.returnHubBySession.get(client.sessionId) ??
      this.identities.get(client.sessionId)?.userId ??
      this.returnHubOwnerId ??
      client.sessionId
    );
  }

  private endMatch(message: string) {
    this.broadcast("toast", { message });
    const earlyLeave = !this.lastMatchWinner;
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (player) this.grantMatchLoot(player, client.sessionId, earlyLeave);
      client.send("transfer", {
        room: ROOM.BASE_CITY,
        options: { hubOwnerId: this.hubForClient(client) },
      });
    }
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, 2000);
  }

  private sendHome(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) this.grantMatchLoot(player, client.sessionId, true);
    client.send("transfer", {
      room: ROOM.BASE_CITY,
      options: { hubOwnerId: this.hubForClient(client) },
    });
  }

  /** Fighters: casts only when alive and outside countdown / round_end / match_end. */
  private canCombat(player: PlayerState): boolean {
    if (player.role === "spectator") return false;
    if (player.hp <= 0 || player.roundDead) return false;
    if (this.kind === "pvp") {
      const phase = this.state.matchPhase;
      if (phase === "countdown" || phase === "round_end" || phase === "match_end") return false;
    }
    return true;
  }

  /**
   * Spectators always move.
   * Round-end celebrate window: living fighters can walk (and emote); dead stay put.
   */
  private canMove(player: PlayerState): boolean {
    if (player.role === "spectator") return true;
    if (this.kind === "pvp" && this.state.matchPhase === "round_end") {
      return player.hp > 0 && !player.roundDead;
    }
    return this.canCombat(player);
  }

  private tick(dtMs: number) {
    if (this.state.paused) {
      this.state.tick += 1;
      return;
    }

    const dt = dtMs / 1000;
    this.state.tick += 1;
    const now = Date.now();
    this.advanceMatchPhases(now);

    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.disconnected) continue;
      const queue = this.inputs.get(sessionId) ?? [];
      while (queue.length > 0) {
        const input = queue.shift()!;
        player.lastInputSeq = input.seq;

        const spectator = player.role === "spectator";
        if (!this.canMove(player)) continue;

        const speed = this.combat.getEffectiveMoveSpeed(sessionId);
        const from = { x: player.x, z: player.z };
        const desired = applyMovement(
          from,
          { moveX: input.moveX, moveZ: input.moveZ, dt: input.dt || dt },
          speed,
        );
        if (Math.abs(input.moveX) + Math.abs(input.moveZ) > 0.05) {
          this.activityOf(sessionId).moveTicks += 1;
        }
        const next = this.combat.movePlayer(sessionId, from, desired);
        player.x = next.x;
        player.z = next.z;

        // Spectators: move + look only (no casts / aim refresh / shield turn lock).
        if (spectator) {
          player.yaw = applyYaw(player.yaw, input.yaw, input.dt || dt);
          continue;
        }
        if (!this.canCombat(player)) continue;

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
        if (input.cancelCast) this.combat.tryCancelCast(sessionId, player, now);
        if (input.confirmCast) this.combat.tryConfirmCast(sessionId, player, now);
        if (input.castId) {
          const began = this.combat.tryBeginCast(sessionId, player, input.castId, now, {
            moveX: input.moveX,
            moveZ: input.moveZ,
            aimX: input.aimX,
            aimZ: input.aimZ,
          });
          if (began) this.activityOf(sessionId).castCount += 1;
        }
        if (input.interactId) this.handleInteract(sessionId, player, input.interactId);
      }
    }

    this.combat.tick(dt, now);
    this.waveDirector?.tick(dt, now);
    if (this.kind === "pve" && this.mode === "dungeon") {
      this.checkPveWipe();
    }
  }

  /**
   * Talking to an NPC authored into the map.
   *
   * The client already checked the distance before showing the prompt; this
   * checks it again because the client is the one thing that can lie, and
   * shopping from across the map is exactly the kind of thing a modified
   * client would try. Range is generous (`NPC_INTERACT_RADIUS` plus a metre)
   * so a player who took a step while the packet was in flight is not refused
   * a conversation they were standing in range to start.
   */
  private handleInteract(sessionId: string, player: PlayerState, interactId: string) {
    const elementId = npcElementIdFrom(interactId);
    if (!elementId || !this.mapId) return;

    const npc = mapNpcFor(this.mapId, elementId);
    if (!npc) return;

    const reach = NPC_INTERACT_RADIUS + 1;
    if (Math.hypot(player.x - npc.x, player.z - npc.z) > reach) return;

    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send("npc_dialogue", {
      npcId: npc.id,
      name: npc.name,
      line: npc.line,
      action: this.supportedNpcAction(npc.action),
    });
  }

  /**
   * Downgrade an action this room cannot honour to a plain conversation.
   *
   * Portals queue for a match through the hub's party registry, which does not
   * exist here, so a gatekeeper NPC dropped into an arena would otherwise show
   * a button that quietly does nothing. Better to let him just talk.
   */
  private supportedNpcAction(action: NpcAction): NpcAction {
    if (action !== "portal_pvp" && action !== "portal_pve") return action;
    return this.mode === "hub" ? action : "talk";
  }
}
