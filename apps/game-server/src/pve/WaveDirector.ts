import {
  CEMETERY_ENEMY_SPAWN_RING,
  COLLISION,
  PVE_WAVE_CLEAR_MS,
  PVE_WAVE_ENEMY_HARD_CAP,
  PVE_WAVE_SPAWN_STAGGER_MS,
  PVE_ZOMBIE_KIND,
  PVE_ZOMBIE_MELEE_COOLDOWN_MS,
  PVE_ZOMBIE_MELEE_RANGE,
  PVE_ZOMBIE_RETARGET_MS,
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
};

/**
 * Cemetery Wave Assault — spawn seeking zombies, scale by wave, clear → next.
 */
export class WaveDirector {
  waveIndex = 0;
  phase: WavePhase = "intro";
  private clearAt = 0;
  private nextId = 1;
  private meleeCd = new Map<string, number>();
  private retargetAt = new Map<string, number>();
  private targetSession = new Map<string, string>();
  private speedById = new Map<string, number>();
  private damageById = new Map<string, number>();
  private pendingSpawns: PendingSpawn[] = [];
  private nextSpawnAt = 0;
  private waveGoal = 0;
  private started = false;

  constructor(
    private readonly state: BaseCityState,
    private readonly combat: CombatSystem,
    private readonly broadcastHud: (hud: WaveHud) => void,
  ) {}

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
    this.pendingSpawns = [];
    this.nextSpawnAt = 0;
    this.waveGoal = 0;
    this.meleeCd.clear();
    this.retargetAt.clear();
    this.targetSession.clear();
    this.speedById.clear();
    this.damageById.clear();
    this.started = true;
    this.pushHud();
  }

  getWaveIndex() {
    return this.waveIndex;
  }

  tick(dt: number, now: number) {
    if (!this.started) return;

    if (this.phase === "intro" || this.phase === "clear") {
      if (now >= this.clearAt) this.beginWave(now);
      return;
    }

    if (this.phase !== "fighting") return;

    this.drainSpawns(now);
    this.tickZombies(dt, now);

    const alive = this.countAlive();
    // Don't clear while more of this wave are still queued.
    if (alive === 0 && this.pendingSpawns.length === 0) {
      this.phase = "clear";
      this.clearAt = now + PVE_WAVE_CLEAR_MS;
      this.pushHud();
    } else {
      // Cheap periodic hud sync
      if (now % 500 < 40) this.pushHud();
    }
  }

  onTargetKilled(targetId: string) {
    this.meleeCd.delete(targetId);
    this.retargetAt.delete(targetId);
    this.targetSession.delete(targetId);
    this.speedById.delete(targetId);
    this.damageById.delete(targetId);
  }

  private beginWave(now: number) {
    this.waveIndex += 1;
    this.phase = "fighting";
    const count = pveWaveEnemyCount(this.waveIndex);
    this.waveGoal = count;
    const hp = pveWaveHp(this.waveIndex);
    const dmg = pveWaveDamage(this.waveIndex);
    const speed = pveWaveSpeed(this.waveIndex);
    const spots = this.pickSpawns(count);
    this.pendingSpawns = spots.map((spot, i) => ({
      x: spot.x,
      z: spot.z,
      hp,
      dmg,
      speed: speed * pveZombieSpeedMul(i),
    }));
    this.nextSpawnAt = now;
    // First zombie immediately so the wave doesn't feel empty.
    this.drainSpawns(now);
    this.pushHud();
  }

  private drainSpawns(now: number) {
    while (this.pendingSpawns.length > 0 && now >= this.nextSpawnAt) {
      if (this.countAlive() >= PVE_WAVE_ENEMY_HARD_CAP) {
        this.pendingSpawns.length = 0;
        break;
      }
      const spot = this.pendingSpawns.shift()!;
      const id = `zombie_${this.nextId++}`;
      this.combat.spawnWaveMob(id, spot.x, spot.z, {
        kind: PVE_ZOMBIE_KIND,
        hp: spot.hp,
        yaw: Math.atan2(-spot.x, -spot.z),
      });
      this.speedById.set(id, spot.speed);
      this.damageById.set(id, spot.dmg);
      this.meleeCd.set(id, 0);
      this.nextSpawnAt = now + PVE_WAVE_SPAWN_STAGGER_MS;
    }
  }

  private pickSpawns(count: number): Array<{ x: number; z: number }> {
    const players: Array<{ x: number; z: number }> = [];
    this.state.players.forEach((p) => {
      if (p.hp > 0 && !p.disconnected) players.push({ x: p.x, z: p.z });
    });
    const scored = CEMETERY_ENEMY_SPAWN_RING.map((s) => {
      let minD = Infinity;
      for (const p of players) {
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < minD) minD = d;
      }
      if (!players.length) minD = Math.hypot(s.x, s.z);
      return { ...s, minD };
    });
    scored.sort((a, b) => b.minD - a.minD);
    const picks: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < count; i++) {
      const s = scored[i % scored.length]!;
      // Slight jitter so they don't stack
      const j = (i * 0.37) % 1;
      picks.push({
        x: s.x + Math.sin(j * 6.28) * 0.6,
        z: s.z + Math.cos(j * 6.28) * 0.6,
      });
    }
    return picks;
  }

  private countAlive(): number {
    let n = 0;
    this.state.targets.forEach((t) => {
      if (t.kind === PVE_ZOMBIE_KIND && t.hp > 0) n += 1;
    });
    return n;
  }

  private tickZombies(dt: number, now: number) {
    const living: Array<{ id: string; x: number; z: number }> = [];
    this.state.players.forEach((p, id) => {
      if (p.hp > 0 && !p.disconnected && p.role !== "spectator") {
        living.push({ id, x: p.x, z: p.z });
      }
    });
    if (!living.length) return;

    this.state.targets.forEach((t, id) => {
      if (t.kind !== PVE_ZOMBIE_KIND || t.hp <= 0) return;

      let focusId = this.targetSession.get(id);
      const due = (this.retargetAt.get(id) ?? 0) <= now;
      if (!focusId || due || !living.some((p) => p.id === focusId)) {
        let best = living[0]!;
        let bestD = Infinity;
        for (const p of living) {
          const d = Math.hypot(p.x - t.x, p.z - t.z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        focusId = best.id;
        this.targetSession.set(id, focusId);
        this.retargetAt.set(id, now + PVE_ZOMBIE_RETARGET_MS);
      }

      const focus = living.find((p) => p.id === focusId) ?? living[0]!;
      const dx = focus.x - t.x;
      const dz = focus.z - t.z;
      const dist = Math.hypot(dx, dz) || 1;
      t.yaw = Math.atan2(dx, dz);

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

      if (t.castLockUntil && now >= t.castLockUntil) {
        t.castAbilityId = "";
        t.castPhase = "";
        t.castLockUntil = 0;
      }
    });

    this.separateZombies();
  }

  /** Cheap mob-vs-mob push so packs don't stack (avoids full O(n²) moveAndCollide). */
  private separateZombies() {
    const list: Array<{ id: string; x: number; z: number }> = [];
    this.state.targets.forEach((t, id) => {
      if (t.kind === PVE_ZOMBIE_KIND && t.hp > 0) {
        list.push({ id, x: t.x, z: t.z });
      }
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
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }

    for (const row of list) {
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
      alive: this.countAlive() + this.pendingSpawns.length,
      goal: this.waveGoal,
    });
  }
}
