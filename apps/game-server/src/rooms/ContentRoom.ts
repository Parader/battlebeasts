import { Room, Client } from "@colyseus/core";
import {
  ARENA_ROUND_COUNTDOWN_MS,
  ARENA_ROUND_END_MS,
  ARENA_ROUNDS_TO_WIN,
  DEFAULT_LOADOUT,
  MATCH_ESSENCE,
  MAX_TALENTS,
  PVE_RECONNECT_GRACE_MS,
  PVP_RECONNECT_GRACE_MS,
  RECONNECT_RESUME_GRACE_MS,
  RESPAWN_LOCK_MS,
  ROOM,
  TICK_MS,
  applyMovement,
  applyYaw,
  arenaSpawnForSlot,
  arenaSpawnsForTeam,
  arenaStaticColliders,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  cosmeticsEquippedFromFields,
  cosmeticsEquippedToFields,
  normalizeCosmeticsEquipped,
  normalizeLoadout,
  type MatchRecapRow,
  type PlayerInput,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions, type VerifiedIdentity } from "../auth.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import { grantPendingLoot } from "../pendingLoot.js";
import { loadEconomy } from "../persistence.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

export type ContentJoinOptions = AuthJoinOptions & {
  mode?: string;
  modifiers?: string[];
  matchId?: string;
  team?: "a" | "b" | "";
  role?: "fighter" | "spectator";
  spawnSlot?: number;
};

type ContentKind = "pvp" | "pve";

function kindFromRoomName(roomName: string): ContentKind {
  if (roomName === ROOM.ARENA || roomName === ROOM.BATTLEGROUND) return "pvp";
  return "pve";
}

export class ContentRoom extends Room<BaseCityState> {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private mode = "stub";
  private returnHubOwnerId: string | null = null;
  private kind: ContentKind = "pve";
  private identities = new Map<string, VerifiedIdentity>();
  private awaitingReconnect = new Set<string>();
  private resumeGraceClear: (() => void) | null = null;
  private combat!: CombatSystem;
  private spawnBySession = new Map<string, { x: number; z: number; yaw: number }>();
  /** Per-fighter pad index within their team (0..2 → markers 1–3 / 4–6). */
  private spawnSlotBySession = new Map<string, number>();
  private diedAtBySession = new Map<string, number>();
  private nextTeam: "a" | "b" = "a";
  /** Set when a PvP match reaches a real conclusion (for essence payouts). */
  private lastMatchWinner: "a" | "b" | "draw" | null = null;

  onCreate(options: ContentJoinOptions) {
    this.setState(new BaseCityState());
    this.mode = options.mode ?? "stub";
    this.returnHubOwnerId = options.hubOwnerId ?? options.userId ?? null;
    this.kind = kindFromRoomName(this.roomName);
    this.state.matchMode = this.mode;
    this.setMetadata({ mode: this.mode, matchId: options.matchId ?? null, kind: this.kind });
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
    });
    if (this.kind === "pvp") {
      this.combat.setStaticColliders(arenaStaticColliders());
    }
    this.setPatchRate(1000 / 30);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);

    this.onMessage("input", (client, message: { input: PlayerInput }) => {
      if (this.state.paused) return;
      const queue = this.inputs.get(client.sessionId);
      if (!queue || !message?.input) return;
      queue.push(message.input);
      if (queue.length > 64) queue.shift();
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
      if (this.kind === "pvp") return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;
      const diedAt = this.diedAtBySession.get(client.sessionId) ?? 0;
      if (Date.now() < diedAt + RESPAWN_LOCK_MS) return;
      this.softRespawnPlayer(client.sessionId, player);
    });

    this.onMessage("rematch_vote", (client) => {
      if (this.kind !== "pvp") return;
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.matchPhase !== "rematch_wait") return;
      player.rematchReady = true;
      this.tryStartRematch();
    });
  }

  async onAuth(_client: Client, options: ContentJoinOptions) {
    return verifyJoinOptions(options);
  }

  onJoin(client: Client, options: ContentJoinOptions, identity?: VerifiedIdentity) {
    const verified =
      identity ??
      ({
        userId: client.sessionId,
        displayName: "Hunter",
        isGuest: true,
      } satisfies VerifiedIdentity);

    const existing = this.state.players.get(client.sessionId);
    if (existing) {
      existing.disconnected = false;
      this.awaitingReconnect.delete(client.sessionId);
      this.identities.set(client.sessionId, verified);
      if (!this.inputs.has(client.sessionId)) this.inputs.set(client.sessionId, []);
      client.send("toast", { message: "Reconnected" });
      this.scheduleResumeGrace();
      return;
    }

    if (!this.returnHubOwnerId) {
      this.returnHubOwnerId = options.hubOwnerId ?? verified.userId;
    }

    this.identities.set(client.sessionId, verified);

    const player = new PlayerState();
    player.id = verified.userId;
    player.displayName = verified.displayName;
    player.color = options.color ?? "#4ade80";
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
      } else {
        const team = options.team === "a" || options.team === "b" ? options.team : this.nextTeam;
        this.nextTeam = team === "a" ? "b" : "a";
        player.team = team;
        const preferred = Number(options.spawnSlot);
        const slot = this.claimTeamSpawnSlot(
          team,
          Number.isFinite(preferred) ? Math.floor(preferred) : undefined,
        );
        this.spawnSlotBySession.set(client.sessionId, slot);
        const spawn = arenaSpawnForSlot(team, slot) ?? { x: 0, z: 0, yaw: 0 };
        player.x = spawn.x;
        player.z = spawn.z;
        player.yaw = spawn.yaw;
        this.spawnBySession.set(client.sessionId, {
          x: spawn.x,
          z: spawn.z,
          yaw: spawn.yaw,
        });
      }
    } else {
      const spawnIndex = this.state.players.size;
      const angle = (spawnIndex / Math.max(1, this.maxClients)) * Math.PI * 2;
      player.x = Math.cos(angle) * 4;
      player.z = Math.sin(angle) * 4;
      this.spawnBySession.set(client.sessionId, {
        x: player.x,
        z: player.z,
        yaw: player.yaw,
      });
    }

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);
    this.combat.syncSessionKit(client.sessionId, player.loadout, player.talents);

    if (!verified.isGuest) {
      void loadEconomy(verified.userId).then((eco) => {
        const p = this.state.players.get(client.sessionId);
        if (!p) return;
        p.loadout = normalizeLoadout(eco.abilityIds).join(",");
        p.talents = eco.talentIds.slice(0, MAX_TALENTS).join(",");
        if (eco.pattern) p.pattern = normalizeCosmeticPattern(eco.pattern);
        if (eco.patternColor) p.patternColor = normalizeCosmeticPatternColor(eco.patternColor);
        if (eco.color) p.color = eco.color;
        if (eco.cosmeticsEquipped) {
          const fields = cosmeticsEquippedToFields(
            normalizeCosmeticsEquipped(eco.cosmeticsEquipped),
          );
          p.cosmeticHat = fields.cosmeticHat;
          p.cosmeticShoulders = fields.cosmeticShoulders;
          p.cosmeticChest = fields.cosmeticChest;
          p.cosmeticGloves = fields.cosmeticGloves;
          p.cosmeticBelt = fields.cosmeticBelt;
          p.cosmeticLegs = fields.cosmeticLegs;
          p.cosmeticShoes = fields.cosmeticShoes;
        }
        this.combat.syncSessionKit(client.sessionId, p.loadout, p.talents);
        const bonus = this.combat.getSessionKit(client.sessionId)?.maxHpBonus ?? 0;
        p.maxHp = 100 + bonus;
        p.hp = Math.min(p.hp, p.maxHp);
      });
    } else {
      player.loadout = DEFAULT_LOADOUT.join(",");
      this.combat.syncSessionKit(client.sessionId, player.loadout, player.talents);
    }

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
    this.combat.clearSession(sessionId);
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
      if (p.role === "fighter" && (p.team === "a" || p.team === "b") && !p.disconnected) {
        list.push(p);
      }
    });
    return list;
  }

  private maybeBeginMatch() {
    const fighters = this.fighters();
    const hasA = fighters.some((p) => p.team === "a");
    const hasB = fighters.some((p) => p.team === "b");
    if (hasA && hasB) this.startRound(1);
  }

  private startRound(round: number) {
    this.state.matchRound = round;
    if (round === 1) {
      this.state.scoreA = 0;
      this.state.scoreB = 0;
      this.state.players.forEach((p) => {
        p.statKills = 0;
        p.statDamageDealt = 0;
        p.statDamageTaken = 0;
        p.statHealing = 0;
        p.statShield = 0;
        p.rematchReady = false;
      });
    }

    const fallbackSlots = { a: 0, b: 0 };
    this.state.players.forEach((p, sessionId) => {
      if (p.role !== "fighter" || (p.team !== "a" && p.team !== "b")) return;
      const team = p.team as "a" | "b";
      let slot = this.spawnSlotBySession.get(sessionId);
      if (typeof slot !== "number") {
        slot = fallbackSlots[team]++;
        this.spawnSlotBySession.set(sessionId, slot);
      }
      const spawn = arenaSpawnForSlot(team, slot);
      if (spawn) {
        p.x = spawn.x;
        p.z = spawn.z;
        p.yaw = spawn.yaw;
        this.spawnBySession.set(sessionId, { x: spawn.x, z: spawn.z, yaw: spawn.yaw });
      }
      p.hp = p.maxHp;
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

  private endRound(winner: "a" | "b") {
    if (winner === "a") this.state.scoreA += 1;
    else this.state.scoreB += 1;
    this.state.matchPhase = "round_end";
    this.state.phaseEndsAt = Date.now() + ARENA_ROUND_END_MS;
    this.broadcast("toast", {
      message: `Round over — Team ${winner.toUpperCase()} (${this.state.scoreA}–${this.state.scoreB})`,
    });
  }

  private finishMatch(winner: "a" | "b" | "draw") {
    this.state.matchPhase = "match_end";
    this.state.phaseEndsAt = 0;
    this.lastMatchWinner = winner;
    const rows: MatchRecapRow[] = [];
    this.state.players.forEach((p, sessionId) => {
      rows.push({
        sessionId,
        displayName: p.displayName,
        team: p.team,
        kills: p.statKills,
        damageDealt: p.statDamageDealt,
        damageTaken: p.statDamageTaken,
        healing: p.statHealing,
        shield: p.statShield,
      });
    });
    this.broadcast("match_recap", {
      winner,
      scoreA: this.state.scoreA,
      scoreB: this.state.scoreB,
      rows,
    });
    this.state.matchPhase = "rematch_wait";
    this.state.players.forEach((p) => {
      p.rematchReady = false;
    });
  }

  private essenceForPlayer(player: PlayerState, earlyLeave: boolean): number {
    if (this.kind !== "pvp") return MATCH_ESSENCE.pveClear;
    if (earlyLeave && !this.lastMatchWinner) return MATCH_ESSENCE.pvpLeaveEarly;
    const winner = this.lastMatchWinner;
    if (!winner || winner === "draw") return MATCH_ESSENCE.pvpDraw;
    if (player.team === winner) return MATCH_ESSENCE.pvpWin;
    return MATCH_ESSENCE.pvpLoss;
  }

  private grantMatchLoot(player: PlayerState, earlyLeave: boolean) {
    if (!player.id) return;
    const essence = this.essenceForPlayer(player, earlyLeave);
    grantPendingLoot(player.id, { copper: 25, silver: 1, essence });
  }

  private tryStartRematch() {
    let ready = 0;
    let total = 0;
    this.state.players.forEach((p) => {
      if (p.disconnected) return;
      total += 1;
      if (p.rematchReady) ready += 1;
    });
    if (total > 0 && ready >= total) {
      this.startRound(1);
    }
  }

  private checkRoundWipe(now: number) {
    if (this.state.matchPhase !== "fighting") return;
    const livingA = this.fighters().filter((p) => p.team === "a" && !p.roundDead && p.hp > 0);
    const livingB = this.fighters().filter((p) => p.team === "b" && !p.roundDead && p.hp > 0);
    if (livingA.length === 0 && livingB.length === 0) {
      // Simultaneous wipe (e.g. shared AoE) — nobody wins, replay the round.
      this.startRound(this.state.matchRound);
    } else if (livingA.length === 0) {
      this.endRound("b");
    } else if (livingB.length === 0) {
      this.endRound("a");
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
      this.broadcast("toast", { message: "Fight!" });
    } else if (phase === "round_end" && now >= this.state.phaseEndsAt) {
      if (this.state.scoreA >= ARENA_ROUNDS_TO_WIN) this.finishMatch("a");
      else if (this.state.scoreB >= ARENA_ROUNDS_TO_WIN) this.finishMatch("b");
      else this.startRound(this.state.matchRound + 1);
    } else if (phase === "fighting") {
      this.checkRoundWipe(now);
    }
  }

  private afterSeatEmpty(playerName: string, cause: "abandon" | "timeout") {
    const remaining = this.state.players.size;
    if (this.kind === "pvp") {
      this.broadcast("match_forfeit", { playerName });
      const fighters = this.fighters();
      const teamEmpty =
        this.state.matchPhase !== "" &&
        (!fighters.some((p) => p.team === "a") || !fighters.some((p) => p.team === "b"));
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
    this.forceResume();
  }

  private endMatch(message: string) {
    this.broadcast("toast", { message });
    const hubOwnerId = this.returnHubOwnerId;
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (player) this.grantMatchLoot(player, false);
      client.send("transfer", {
        room: ROOM.BASE_CITY,
        options: { hubOwnerId: hubOwnerId ?? client.sessionId },
      });
    }
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, 2000);
  }

  private sendHome(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) this.grantMatchLoot(player, true);
    client.send("transfer", {
      room: ROOM.BASE_CITY,
      options: { hubOwnerId: this.returnHubOwnerId ?? client.sessionId },
    });
  }

  private canAct(player: PlayerState): boolean {
    if (player.hp <= 0 || player.roundDead) return false;
    if (player.role === "spectator") return false;
    if (this.kind === "pvp") {
      const phase = this.state.matchPhase;
      if (phase === "countdown" || phase === "round_end" || phase === "match_end") return false;
    }
    return true;
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
        if (!this.canAct(player)) continue;

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
        if (input.aimX != null && input.aimZ != null) {
          this.combat.refreshCastAim(sessionId, input.aimX, input.aimZ);
        }
        if (input.cancelCast) this.combat.tryCancelCast(sessionId, player, now);
        if (input.confirmCast) this.combat.tryConfirmCast(sessionId, player, now);
        if (input.castId) {
          this.combat.tryBeginCast(sessionId, player, input.castId, now, {
            moveX: input.moveX,
            moveZ: input.moveZ,
            aimX: input.aimX,
            aimZ: input.aimZ,
          });
        }
      }
    }

    this.combat.tick(dt, now);
  }
}
