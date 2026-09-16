import {
  ABILITIES,
  COLLISION,
  PVE_ELITE_HP_MUL,
  PVE_ELITE_KIND,
  PVE_ELITE_SPEED_MUL,
  PVE_ENEMY_APPROACH_MAX_M,
  PVE_ENEMY_APPROACH_MIN_M,
  PVE_ENEMY_INGRESS_MIN_M,
  PVE_WAVE_ENEMY_HARD_CAP,
  PVE_WAVE_INTERVAL_MS,
  PVE_WAVE_SPAWN_STAGGER_MS,
  PVE_ZOMBIE_KIND,
  PVE_ZOMBIE_MELEE_COOLDOWN_MS,
  PVE_ZOMBIE_MELEE_RANGE,
  PVE_ZOMBIE_RETARGET_MS,
  clampPvePartySize,
  isPveWaveMobKind,
  phaseDurationMs,
  pveEliteComfortRange,
  pveEliteCooldownMs,
  pveEliteCount,
  pveEliteKit,
  pveElitePickAbility,
  pveEliteProjectileDamage,
  pveWaveDamage,
  pveWaveEnemyCount,
  pveWaveHp,
  pveWaveSpeed,
  pveZombieSpeedMul,
} from "@battlebeasts/shared";
import type { CombatSystem } from "../combat/CombatSystem.js";
import type { BaseCityState } from "../schema/BaseCityState.js";

export type WavePhase = "intro" | "fighting" | "clear" | "complete";

type WaveHud = {
  wave: number;
  phase: WavePhase;
  alive: number;
  goal: number;
};

type PendingSpawn = {
  x: number;
  z: number;
  hp: number;
  dmg: number;
  speed: number;
  kind: string;
  kit: string[];
};

type LivingPlayer = { id: string; x: number; z: number };

/**
 * Wave Assault — spawn seeking zombies, scale by wave + party size.
 * Waves roll on a fixed clock; leftovers from earlier waves stay in the fight.
 */
export class WaveDirector {
  waveIndex = 0;
  phase: WavePhase = "intro";
  private clearAt = 0;
  private nextWaveAt = 0;
  private nextId = 1;
  private meleeCd = new Map<string, number>();
  private retargetAt = new Map<string, number>();
  private targetSession = new Map<string, string>();
  private speedById = new Map<string, number>();
  private damageById = new Map<string, number>();
  private eliteKit = new Map<string, string[]>();
  private pendingReleaseAt = new Map<string, number>();
  private pendingAimYaw = new Map<string, number>();
  private pendingAbility = new Map<string, string>();
  private pendingSpawns: PendingSpawn[] = [];
  private nextSpawnAt = 0;
  private waveGoal = 0;
  private started = false;
  private readonly partySize: number;

  constructor(
    private readonly state: BaseCityState,
    private readonly combat: CombatSystem,
    private readonly broadcastHud: (hud: WaveHud) => void,
    partySize = 1,
    private readonly ingress: ReadonlyArray<{ x: number; z: number }> = [],
    private holdout: { x: number; z: number } = { x: 0, z: 0 },
  ) {
    this.partySize = clampPvePartySize(partySize);
  }

  setHoldout(pose: { x: number; z: number }) {
    this.holdout = { x: pose.x, z: pose.z };
  }

  start(now: number) {
    if (this.started) return;
    this.started = true;
    this.resetRun(now);
  }

  /** Stop AI / spawning (wipe or leave). */
  stop() {
    this.phase = "complete";
    this.pendingSpawns = [];
  }

  /** Fresh run from wave 0 intro (retry). */
  resetRun(now: number) {
    this.waveIndex = 0;
    this.phase = "intro";
    this.clearAt = now + 1500;
    this.nextWaveAt = 0;
    this.pendingSpawns = [];
    this.nextSpawnAt = 0;
    this.waveGoal = 0;
    this.meleeCd.clear();
    this.retargetAt.clear();
    this.targetSession.clear();
    this.speedById.clear();
    this.damageById.clear();
    this.eliteKit.clear();
    this.pendingReleaseAt.clear();
    this.pendingAimYaw.clear();
    this.pendingAbility.clear();
    this.started = true;
    this.pushHud();
  }

  getWaveIndex() {
    return this.waveIndex;
  }

  tick(dt: number, now: number) {
    if (!this.started) return;

    if (this.phase === "intro") {
      if (now >= this.clearAt) this.beginWave(now);
      else return;
    }

    if (this.phase !== "fighting") return;

    if (this.nextWaveAt > 0 && now >= this.nextWaveAt) this.beginWave(now);

    this.drainSpawns(now);
    this.tickMobs(dt, now);

    if (now % 500 < 40) this.pushHud();
  }

  onTargetKilled(targetId: string) {
    this.meleeCd.delete(targetId);
    this.retargetAt.delete(targetId);
    this.targetSession.delete(targetId);
    this.speedById.delete(targetId);
    this.damageById.delete(targetId);
    this.eliteKit.delete(targetId);
    this.pendingReleaseAt.delete(targetId);
    this.pendingAimYaw.delete(targetId);
    this.pendingAbility.delete(targetId);
  }

  private beginWave(now: number) {
    this.waveIndex += 1;
    this.phase = "fighting";
    const count = pveWaveEnemyCount(this.waveIndex, this.partySize);
    this.waveGoal = count;
    const hp = pveWaveHp(this.waveIndex, this.partySize);
    const dmg = pveWaveDamage(this.waveIndex, this.partySize);
    const speed = pveWaveSpeed(this.waveIndex);
    const eliteN = Math.min(pveEliteCount(this.waveIndex, this.partySize), count);
    const spots = this.pickSpawns(count);
    const spawnOffset = this.pendingSpawns.length;
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i]!;
      const isElite = i < eliteN;
      const kit = isElite ? pveEliteKit(this.waveIndex, i) : [];
      this.pendingSpawns.push({
        x: spot.x,
        z: spot.z,
        hp: isElite ? Math.round(hp * PVE_ELITE_HP_MUL) : hp,
        dmg,
        speed: isElite
          ? speed * PVE_ELITE_SPEED_MUL
          : speed * pveZombieSpeedMul(spawnOffset + i),
        kind: isElite ? PVE_ELITE_KIND : PVE_ZOMBIE_KIND,
        kit,
      });
    }
    this.nextWaveAt = now + PVE_WAVE_INTERVAL_MS;
    if (this.nextSpawnAt < now) this.nextSpawnAt = now;
    // First zombie immediately so the wave doesn't feel empty.
    this.drainSpawns(now);
    this.pushHud();
  }

  private drainSpawns(now: number) {
    while (this.pendingSpawns.length > 0 && now >= this.nextSpawnAt) {
      if (this.countAlive() >= PVE_WAVE_ENEMY_HARD_CAP) {
        // Hold the queue — overlapping waves must not skip remaining spawns.
        break;
      }
      const spot = this.pendingSpawns.shift()!;
      const prefix = spot.kind === PVE_ELITE_KIND ? "elite" : "zombie";
      const id = `${prefix}_${this.nextId++}`;
      const origin = this.partyOrigin();
      this.combat.spawnWaveMob(id, spot.x, spot.z, {
        kind: spot.kind,
        hp: spot.hp,
        yaw: Math.atan2(origin.x - spot.x, origin.z - spot.z),
        abilityId: spot.kit[0],
      });
      this.speedById.set(id, spot.speed);
      this.damageById.set(id, spot.dmg);
      this.meleeCd.set(id, 0);
      if (spot.kit.length) this.eliteKit.set(id, spot.kit);
      this.nextSpawnAt = now + PVE_WAVE_SPAWN_STAGGER_MS;
    }
  }

  private partyOrigin(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.hp > 0 && !p.disconnected && p.role !== "spectator") {
        x += p.x;
        z += p.z;
        n += 1;
      }
    });
    if (n === 0) return this.holdout;
    return { x: x / n, z: z / n };
  }

  private pickSpawns(count: number): Array<{ x: number; z: number }> {
    const origin = this.partyOrigin();
    const raw = this.ingress.length > 0 ? this.ingress : [{ x: origin.x, z: origin.z + 20 }];
    const dirs = raw.filter(
      (s) => Math.hypot(s.x - origin.x, s.z - origin.z) >= PVE_ENEMY_INGRESS_MIN_M,
    );
    const pool = dirs.length > 0 ? dirs : raw;
    const picks: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < count; i++) {
      const s = pool[i % pool.length]!;
      const dx = s.x - origin.x;
      const dz = s.z - origin.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist;
      const nz = dz / dist;
      const approach = Math.min(
        PVE_ENEMY_APPROACH_MAX_M,
        Math.max(PVE_ENEMY_APPROACH_MIN_M, dist * 0.22),
      );
      const j = (i * 0.37) % 1;
      const side = ((i % 2 === 0 ? 1 : -1) * (1.1 + j * 2.4));
      picks.push({
        x: origin.x + nx * approach + -nz * side,
        z: origin.z + nz * approach + nx * side,
      });
    }
    return picks;
  }

  private countAlive(): number {
    let n = 0;
    this.state.targets.forEach((t) => {
      if (isPveWaveMobKind(t.kind) && t.hp > 0) n += 1;
    });
    return n;
  }

  private tickMobs(dt: number, now: number) {
    const living: LivingPlayer[] = [];
    this.state.players.forEach((p, id) => {
      if (p.hp > 0 && !p.disconnected && p.role !== "spectator" && !this.combat.isHiddenFromAutoTarget(id)) {
        living.push({ id, x: p.x, z: p.z });
      }
    });
    if (!living.length) {
      this.state.targets.forEach((t, id) => {
        if (!isPveWaveMobKind(t.kind) || t.hp <= 0) return;
        this.targetSession.delete(id);
        if (t.kind === PVE_ELITE_KIND) this.clearEliteCast(id, t);
      });
      return;
    }

    this.state.targets.forEach((t, id) => {
      if (!isPveWaveMobKind(t.kind) || t.hp <= 0) return;

      const focus = this.resolveFocus(id, t.x, t.z, living, now);
      const dx = focus.x - t.x;
      const dz = focus.z - t.z;
      const dist = Math.hypot(dx, dz) || 1;
      t.yaw = Math.atan2(dx, dz);

      if (t.kind === PVE_ELITE_KIND) {
        this.tickElite(id, t, focus, dx, dz, dist, dt, now);
      } else {
        this.tickZombie(id, t, focus, dx, dz, dist, dt, now);
      }

      if (t.castLockUntil && now >= t.castLockUntil) {
        t.castAbilityId = "";
        t.castPhase = "";
        t.castLockUntil = 0;
      }
    });

    this.separateMobs();
  }

  private resolveFocus(
    id: string,
    x: number,
    z: number,
    living: LivingPlayer[],
    now: number,
  ): LivingPlayer {
    let focusId = this.targetSession.get(id);
    const due = (this.retargetAt.get(id) ?? 0) <= now;
    if (!focusId || due || !living.some((p) => p.id === focusId)) {
      let best = living[0]!;
      let bestD = Infinity;
      for (const p of living) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      focusId = best.id;
      this.targetSession.set(id, focusId);
      this.retargetAt.set(id, now + PVE_ZOMBIE_RETARGET_MS);
    }
    return living.find((p) => p.id === focusId) ?? living[0]!;
  }

  private tickZombie(
    id: string,
    t: { x: number; z: number; yaw: number; castAbilityId: string; castPhase: string; castLockUntil: number },
    focus: LivingPlayer,
    dx: number,
    dz: number,
    dist: number,
    dt: number,
    now: number,
  ) {
    const speed = this.speedById.get(id) ?? 3;
    const attacking = Boolean(t.castLockUntil && now < t.castLockUntil);
    if (attacking) {
      // Hold feet during swing so the attack clip reads.
    } else if (dist > PVE_ZOMBIE_MELEE_RANGE * 0.85) {
      const step = Math.min(dist - 0.4, speed * dt);
      const from = { x: t.x, z: t.z };
      const desired = {
        x: t.x + (dx / dist) * step,
        z: t.z + (dz / dist) * step,
      };
      const next = this.combat.moveWaveMob(id, from, desired);
      t.x = next.x;
      t.z = next.z;
    } else {
      const ready = (this.meleeCd.get(id) ?? 0) <= now;
      if (ready) {
        const dmg = this.damageById.get(id) ?? 8;
        this.combat.npcStrikePlayer(id, focus.id, dmg, "zombie_melee");
        this.meleeCd.set(id, now + PVE_ZOMBIE_MELEE_COOLDOWN_MS);
        t.castAbilityId = "zombie_melee";
        t.castPhase = "impact";
        // Long enough for the attack clip to read (~0.7s).
        t.castLockUntil = now + 700;
      }
    }
  }

  private tickElite(
    id: string,
    t: {
      x: number;
      z: number;
      yaw: number;
      hp: number;
      maxHp: number;
      castAbilityId: string;
      castPhase: string;
      castLockUntil: number;
    },
    focus: LivingPlayer,
    dx: number,
    dz: number,
    dist: number,
    dt: number,
    now: number,
  ) {
    const kit = this.eliteKit.get(id) ?? [t.castAbilityId || "bolt"];
    const abilityId = pveElitePickAbility(kit, dist);
    const def = ABILITIES[abilityId];
    const comfort = pveEliteComfortRange(abilityId);
    const from = { x: t.x, z: t.z };
    const to = { x: focus.x, z: focus.z };
    const los = this.combat.hasWorldLos(from, to);
    const speed = this.speedById.get(id) ?? 2.4;
    const casting = Boolean(t.castLockUntil && now < t.castLockUntil);
    const pendingAt = this.pendingReleaseAt.get(id) ?? 0;
    const feared = Boolean(this.combat.getFearSource(id));
    const silenced = !this.combat.statuses.canCast(id);

    if (feared || silenced) {
      if (t.castAbilityId || pendingAt > 0) this.clearEliteCast(id, t);
      if (feared) this.fleeElite(id, t, speed, dt);
      return;
    }

    if (
      (t.castAbilityId || pendingAt > 0) &&
      this.combat.checkDreadAuraTriggerTarget(id, t.x, t.z, now)
    ) {
      this.clearEliteCast(id, t);
      return;
    }

    if (pendingAt > 0) {
      this.pendingAimYaw.set(id, t.yaw);
      if (now >= pendingAt) this.releaseEliteCast(id, t, dist, los, now);
    }

    if (t.castAbilityId && t.castLockUntil > 0) {
      this.advanceElitePhases(id, t, now);
    }

    if (casting) return;

    const nx = dx / dist;
    const nz = dz / dist;
    const inCastRange = dist <= comfort.maxCast;
    const tooClose = dist < comfort.min;
    const tooFar = dist > comfort.max || !los;

    if (tooFar || tooClose) {
      const step = speed * dt;
      let mx = 0;
      let mz = 0;
      if (!los) {
        const side = id.charCodeAt(id.length - 1) % 2 === 0 ? 1 : -1;
        mx = nx * 0.65 + -nz * side * 0.55;
        mz = nz * 0.65 + nx * side * 0.55;
      } else if (tooClose) {
        mx = -nx;
        mz = -nz;
      } else {
        mx = nx;
        mz = nz;
      }
      const len = Math.hypot(mx, mz) || 1;
      const desired = {
        x: t.x + (mx / len) * step,
        z: t.z + (mz / len) * step,
      };
      const next = this.combat.moveWaveMob(id, from, desired);
      t.x = next.x;
      t.z = next.z;
    }

    if (
      los &&
      inCastRange &&
      pendingAt <= 0 &&
      (this.meleeCd.get(id) ?? 0) <= now &&
      !t.castAbilityId &&
      def
    ) {
      if (this.combat.checkDreadAuraTriggerTarget(id, t.x, t.z, now)) {
        this.clearEliteCast(id, t);
        return;
      }
      this.beginEliteCast(id, t, abilityId, now);
    }
  }

  private beginEliteCast(
    id: string,
    t: { yaw: number; castAbilityId: string; castPhase: string; castLockUntil: number },
    abilityId: string,
    now: number,
  ) {
    const def = ABILITIES[abilityId];
    if (!def) return;
    const windupMs =
      phaseDurationMs(def, "anticipation") + phaseDurationMs(def, "cast");
    const impactMs = phaseDurationMs(def, "impact");
    const recoveryMs = phaseDurationMs(def, "recovery");
    const totalMs = Math.max(280, windupMs + impactMs + recoveryMs);
    t.castAbilityId = abilityId;
    t.castPhase = "cast";
    t.castLockUntil = now + totalMs;
    this.pendingAbility.set(id, abilityId);
    this.pendingAimYaw.set(id, t.yaw);
    this.pendingReleaseAt.set(id, now + Math.max(80, windupMs));
  }

  private releaseEliteCast(
    id: string,
    t: { x: number; z: number; yaw: number; hp: number; maxHp: number; castAbilityId: string; castPhase: string },
    dist: number,
    los: boolean,
    now: number,
  ) {
    const abilityId = this.pendingAbility.get(id) ?? t.castAbilityId;
    this.pendingReleaseAt.set(id, 0);
    const def = ABILITIES[abilityId];
    const maxCast = pveEliteComfortRange(abilityId || "bolt").maxCast;
    if (!def || !los || dist > maxCast * 1.18) {
      this.meleeCd.set(id, now + 280);
      return;
    }
    const yaw = this.pendingAimYaw.get(id) ?? t.yaw;
    const waveDmg = this.damageById.get(id) ?? 8;
    const scaled = pveEliteProjectileDamage(abilityId, waveDmg);
    this.combat.fireProjectileFrom(
      id,
      {
        id,
        x: t.x,
        z: t.z,
        yaw,
        hp: t.hp,
        maxHp: t.maxHp,
        vulnerable: true,
      },
      abilityId,
      scaled != null ? { damage: scaled } : undefined,
    );
    t.castPhase = "impact";
    this.meleeCd.set(id, now + pveEliteCooldownMs(abilityId, this.waveIndex));
  }

  private advanceElitePhases(
    id: string,
    t: { castAbilityId: string; castPhase: string; castLockUntil: number },
    now: number,
  ) {
    const def = ABILITIES[t.castAbilityId];
    if (!def || t.castLockUntil <= 0) return;
    const impactMs = phaseDurationMs(def, "impact");
    const recoveryMs = phaseDurationMs(def, "recovery");
    const castEnd = t.castLockUntil;
    const recoveryStart = castEnd - recoveryMs;
    const impactStart = recoveryStart - impactMs;
    if (now >= recoveryStart) t.castPhase = "recovery";
    else if (now >= impactStart) t.castPhase = "impact";
  }

  private clearEliteCast(
    id: string,
    t: { castAbilityId: string; castPhase: string; castLockUntil: number },
  ) {
    t.castAbilityId = "";
    t.castPhase = "";
    t.castLockUntil = 0;
    this.pendingReleaseAt.set(id, 0);
    this.pendingAbility.delete(id);
    this.pendingAimYaw.delete(id);
  }

  private fleeElite(
    id: string,
    t: { x: number; z: number; yaw: number },
    speed: number,
    dt: number,
  ) {
    const fearId = this.combat.getFearSource(id);
    const src = fearId
      ? (this.state.players.get(fearId) ?? this.state.targets.get(fearId))
      : undefined;
    let fx = Math.sin(t.yaw);
    let fz = Math.cos(t.yaw);
    if (src) {
      const dx = t.x - src.x;
      const dz = t.z - src.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        fx = dx / d;
        fz = dz / d;
      }
    }
    const step = speed * dt;
    const next = this.combat.moveWaveMob(
      id,
      { x: t.x, z: t.z },
      { x: t.x + fx * step, z: t.z + fz * step },
    );
    t.x = next.x;
    t.z = next.z;
    t.yaw = Math.atan2(fx, fz);
  }

  /** Cheap mob-vs-mob push so packs don't stack (avoids full O(n²) moveAndCollide). */
  private separateMobs() {
    const list: Array<{ id: string; x: number; z: number; locked: boolean }> = [];
    const now = Date.now();
    this.state.targets.forEach((t, id) => {
      if (!isPveWaveMobKind(t.kind) || t.hp <= 0) return;
      list.push({
        id,
        x: t.x,
        z: t.z,
        locked: Boolean(t.castLockUntil && now < t.castLockUntil),
      });
    });
    if (list.length < 2) return;

    const minDist = COLLISION.dummyRadius * 1.85;
    const minDist2 = minDist * minDist;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d2 = dx * dx + dz * dz;
        if (d2 >= minDist2) continue;
        if (d2 < 1e-8) {
          dx = 0.05;
          dz = 0;
          d2 = dx * dx;
        }
        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        if (!a.locked) {
          a.x -= nx * push;
          a.z -= nz * push;
        }
        if (!b.locked) {
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }

    for (const row of list) {
      if (row.locked) continue;
      const t = this.state.targets.get(row.id);
      if (!t) continue;
      const from = { x: t.x, z: t.z };
      const desired = { x: row.x, z: row.z };
      const next = this.combat.moveWaveMob(row.id, from, desired);
      t.x = next.x;
      t.z = next.z;
    }
  }

  private pushHud() {
    this.broadcastHud({
      wave: this.waveIndex,
      phase: this.phase,
      alive: this.countAlive(),
      goal: this.waveGoal,
    });
  }
}
