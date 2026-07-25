import { Room, Client } from "@colyseus/core";
import {
  PVE_RECONNECT_GRACE_MS,
  PVP_RECONNECT_GRACE_MS,
  RECONNECT_RESUME_GRACE_MS,
  ROOM,
  TICK_MS,
  RESPAWN_LOCK_MS,
  applyMovement,
  applyYaw,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeLoadout,
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
};

type ContentKind = "pvp" | "pve";

function kindFromRoomName(roomName: string): ContentKind {
  if (roomName === ROOM.ARENA || roomName === ROOM.BATTLEGROUND) return "pvp";
  return "pve";
}

/** Thin content stub shared by arena / BG / dungeon / boss. */
export class ContentRoom extends Room<{ state: BaseCityState }> {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private mode = "stub";
  private returnHubOwnerId: string | null = null;
  private kind: ContentKind = "pve";
  private identities = new Map<string, VerifiedIdentity>();
  /** sessionIds currently in allowReconnection wait */
  private awaitingReconnect = new Set<string>();
  /** Clears the post-reconnect 3s countdown if someone drops again. */
  private resumeGraceClear: (() => void) | null = null;
  private combat!: CombatSystem;
  /** Join spawn pose — respawn returns here. */
  private spawnBySession = new Map<string, { x: number; z: number; yaw: number }>();
  private diedAtBySession = new Map<string, number>();

  onCreate(options: ContentJoinOptions) {
    this.setState(new BaseCityState());
    this.mode = options.mode ?? "stub";
    this.returnHubOwnerId = options.hubOwnerId ?? options.userId ?? null;
    this.kind = kindFromRoomName(this.roomName);
    this.setMetadata({ mode: this.mode, matchId: options.matchId ?? null, kind: this.kind });
    this.combat = new CombatSystem(this as never, {
      canHurtPlayers: true,
      onPlayerDamaged: (sessionId) => {
        const p = this.state.players.get(sessionId);
        if (p && p.hp <= 0) {
          this.onPlayerDied(sessionId, p);
        }
      },
    });
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
      this.sendHome(client);
    });

    this.onMessage("respawn", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.hp > 0) return;
      const diedAt = this.diedAtBySession.get(client.sessionId) ?? 0;
      if (Date.now() < diedAt + RESPAWN_LOCK_MS) return;
      this.softRespawnPlayer(client.sessionId, player);
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

    // Reconnect path: Colyseus restores the same sessionId; player already in state
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
    player.pattern = normalizeCosmeticPattern(
      (options as { pattern?: string }).pattern,
    );
    player.patternColor = normalizeCosmeticPatternColor(
      (options as { patternColor?: string }).patternColor,
    );
    const spawnIndex = this.state.players.size;
    const angle = (spawnIndex / Math.max(1, this.maxClients)) * Math.PI * 2;
    player.x = Math.cos(angle) * 4;
    player.z = Math.sin(angle) * 4;
    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);
    this.spawnBySession.set(client.sessionId, {
      x: player.x,
      z: player.z,
      yaw: player.yaw,
    });

    if (!verified.isGuest) {
      void loadEconomy(verified.userId).then((eco) => {
        const p = this.state.players.get(client.sessionId);
        if (!p) return;
        p.loadout = normalizeLoadout(eco.abilityIds).join(",");
        if (eco.pattern) p.pattern = normalizeCosmeticPattern(eco.pattern);
        if (eco.patternColor) p.patternColor = normalizeCosmeticPatternColor(eco.patternColor);
        if (eco.color) p.color = eco.color;
      });
    }

    client.send("toast", {
      message: `Entered ${this.mode} (${this.kind}) — Return to city when ready`,
    });
  }

  async onLeave(client: Client, consented: boolean) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    if (!player) return;

    // Intentional leave (return home / abandon): resolve immediately
    if (consented) {
      const name = player.displayName;
      this.stripPlayer(sessionId);
      this.afterSeatEmpty(name, "abandon");
      return;
    }

    // Unexpected drop — pause + grace reconnect
    player.disconnected = true;
    this.awaitingReconnect.add(sessionId);
    const graceMs = this.kind === "pvp" ? PVP_RECONNECT_GRACE_MS : PVE_RECONNECT_GRACE_MS;
    const reason = this.kind === "pvp" ? "pvp_reconnect" : "pve_reconnect";
    const displayName = player.displayName;
    this.beginPause(reason, graceMs, displayName);

    try {
      // Resolves when client.reconnect() succeeds — does NOT re-run onJoin
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
    this.broadcast("toast", {
      message:
        reason === "pvp_reconnect"
          ? `Paused — waiting for ${playerName} (${Math.round(graceMs / 1000)}s or forfeit)`
          : `Paused — waiting for ${playerName} (${Math.round(graceMs / 1000)}s then rebalance)`,
    });
  }

  /** After everyone is back, keep paused briefly so the returning player can settle. */
  private scheduleResumeGrace() {
    if (!this.canResume()) return;
    if (!this.state.paused) return;

    this.clearResumeGrace();
    const until = Date.now() + RECONNECT_RESUME_GRACE_MS;
    this.state.paused = true;
    this.state.pauseReason = "resume_grace";
    this.state.reconnectUntil = until;
    this.broadcast("match_pause", { reason: "resume_grace", until });
    this.broadcast("toast", {
      message: `Resuming in ${Math.round(RECONNECT_RESUME_GRACE_MS / 1000)}s…`,
    });

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
    if (!this.canResume()) return;
    if (!this.state.paused) return;
    this.clearResumeGrace();
    this.state.paused = false;
    this.state.pauseReason = "";
    this.state.reconnectUntil = 0;
    this.broadcast("match_resume", {});
    this.broadcast("toast", { message: "Match resumed" });
  }

  private maybeResume() {
    this.forceResume();
  }

  private stripPlayer(sessionId: string) {
    this.awaitingReconnect.delete(sessionId);
    this.state.players.delete(sessionId);
    this.inputs.delete(sessionId);
    this.identities.delete(sessionId);
    this.spawnBySession.delete(sessionId);
    this.diedAtBySession.delete(sessionId);
    this.combat.clearSession(sessionId);
  }

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
    player.statuses.clear();
    this.diedAtBySession.delete(sessionId);
    this.combat.clearSession(sessionId);
  }

  private afterSeatEmpty(playerName: string, cause: "abandon" | "timeout") {
    const remaining = this.state.players.size;

    if (this.kind === "pvp") {
      this.broadcast("match_forfeit", { playerName });
      this.broadcast("toast", {
        message:
          cause === "timeout"
            ? `${playerName} forfeited (disconnect)`
            : `${playerName} left — forfeit`,
      });

      if (remaining < 2) {
        this.endMatch("Not enough hunters left — returning to city");
        return;
      }
      this.maybeResume();
      return;
    }

    // PvE rebalance
    this.broadcast("match_rebalance", { remaining, playerName });
    this.broadcast("toast", {
      message:
        remaining === 0
          ? "Party empty — closing instance"
          : `Party rebalanced (${remaining} left) after ${playerName} left`,
    });

    if (remaining === 0) {
      void this.disconnect();
      return;
    }
    this.maybeResume();
  }

  private endMatch(message: string) {
    this.broadcast("toast", { message });
    const hubOwnerId = this.returnHubOwnerId;
    for (const client of this.clients) {
      client.send("transfer", {
        room: ROOM.BASE_CITY,
        options: { hubOwnerId: hubOwnerId ?? client.sessionId },
      });
    }
    // Soft dispose shortly after transfers fire
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, 2000);
  }

  private sendHome(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player?.id) {
      grantPendingLoot(player.id, { copper: 25, silver: 1, essence: 1 });
    }
    const hubOwnerId = this.returnHubOwnerId ?? client.sessionId;
    client.send("transfer", {
      room: ROOM.BASE_CITY,
      options: { hubOwnerId },
    });
  }

  private tick(dtMs: number) {
    if (this.state.paused) {
      this.state.tick += 1;
      return;
    }

    const dt = dtMs / 1000;
    this.state.tick += 1;
    const now = Date.now();

    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.disconnected) continue;
      const queue = this.inputs.get(sessionId) ?? [];
      while (queue.length > 0) {
        const input = queue.shift()!;
        player.lastInputSeq = input.seq;
        if (player.hp > 0) {
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
          if (input.castId) {
            this.combat.tryBeginCast(sessionId, player, input.castId, now, {
              moveX: input.moveX,
              moveZ: input.moveZ,
            });
          }
        }
      }
    }

    this.combat.tick(dt, now);
  }
}
