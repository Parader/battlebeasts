import type {
  OneShotEffect,
  OneShotKind,
  SpellEffectId,
  VfxHandle,
  VfxPose,
  VfxSpawnOpts,
} from "./types";
import { abilityVfxColor } from "./colors";

type Listener = () => void;

const CAST_LIFE_MS: Record<string, number> = {
  bolt: 320,
  crescent: 260,
  poisonDart: 380,
};

const IMPACT_LIFE_MS: Record<string, number> = {
  bolt: 380,
  crescent: 320,
  smash: 900,
  gust: 1200,
  spikes: 560,
  frostMist: 3800,
  silenceSweep: 700,
  handShield: 700,
  groove: 4200,
  healBeam: 2200,
  lifeLeech: 2000,
  poisonDart: 420,
  firewall: 7600,
  poisonCloud: 5800,
  smokeBomb: 5400,
  holyGround: 6800,
  fireball: 5200,
  iceLance: 900,
  portal: 320,
  volcano: 900,
  bloodRush: 700,
  spiritForm: 650,
};

/**
 * Imperative VFX bus for one-shot cast/impact bursts.
 * R3F `VfxWorld` subscribes and mounts visuals; combat bridges call spawn*.
 */
class VfxRuntime {
  private shots: OneShotEffect[] = [];
  private listeners = new Set<Listener>();
  private nextKey = 1;
  private emitRaf = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getShots(): readonly OneShotEffect[] {
    return this.shots;
  }

  spawnCastEffect(
    abilityId: SpellEffectId | string,
    pose: VfxPose,
    opts?: VfxSpawnOpts,
  ): VfxHandle {
    return this.push(
      "cast",
      abilityId,
      pose,
      opts?.lifeMs ?? CAST_LIFE_MS[abilityId] ?? 150,
      opts,
    );
  }

  spawnImpactEffect(
    abilityId: SpellEffectId | string,
    pose: VfxPose,
    opts?: VfxSpawnOpts,
  ): VfxHandle {
    return this.push(
      "impact",
      abilityId,
      pose,
      opts?.lifeMs ?? IMPACT_LIFE_MS[abilityId] ?? 280,
      opts,
    );
  }

  /** End a follow-owner one-shot early (e.g. cancel Frost Mist channel). */
  cancelFollowOwner(abilityId: string, ownerId: string): void {
    let w = 0;
    let removed = false;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i]!;
      if (s.abilityId === abilityId && s.followOwnerId === ownerId) {
        removed = true;
        continue;
      }
      this.shots[w++] = s;
    }
    if (removed) {
      this.shots.length = w;
      this.scheduleEmit();
    }
  }

  /** Drop expired shots; call from the render loop. */
  prune(now = performance.now()): void {
    if (this.shots.length === 0) return;
    let w = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i]!;
      if (now - s.born < s.life) this.shots[w++] = s;
    }
    if (w !== this.shots.length) {
      this.shots.length = w;
      this.scheduleEmit();
    }
  }

  clear(): void {
    if (this.shots.length === 0) return;
    this.shots.length = 0;
    this.scheduleEmit();
  }

  private push(
    kind: OneShotKind,
    abilityId: string,
    pose: VfxPose,
    life: number,
    opts?: VfxSpawnOpts,
  ): VfxHandle {
    const key = this.nextKey++;
    const shot: OneShotEffect = {
      key,
      kind,
      abilityId,
      color: abilityVfxColor(abilityId),
      x: pose.x,
      y: pose.y ?? 0.65,
      z: pose.z,
      yaw: pose.yaw ?? 0,
      born: performance.now(),
      life,
      followOwnerId: opts?.followOwnerId,
      followSpawnOffset: opts?.followSpawnOffset,
      followTargetId: opts?.followTargetId,
      chargeMs: opts?.chargeMs,
      variant: opts?.variant,
      radius: opts?.radius,
      startRadius: opts?.startRadius,
      growMs: opts?.growMs,
      originX: opts?.originX,
      originZ: opts?.originZ,
    };
    this.shots.push(shot);
    this.scheduleEmit();
    return {
      cancel: () => {
        let w = 0;
        let removed = false;
        for (let i = 0; i < this.shots.length; i++) {
          const s = this.shots[i]!;
          if (s.key === key) {
            removed = true;
            continue;
          }
          this.shots[w++] = s;
        }
        if (removed) {
          this.shots.length = w;
          this.scheduleEmit();
        }
      },
    };
  }

  /** Coalesce bursts of spawn/prune into one React commit per frame. */
  private scheduleEmit(): void {
    if (this.emitRaf) return;
    this.emitRaf = requestAnimationFrame(() => {
      this.emitRaf = 0;
      for (const fn of this.listeners) fn();
    });
  }
}

export const vfxRuntime = new VfxRuntime();

export function spawnCastEffect(
  abilityId: SpellEffectId | string,
  pose: VfxPose,
  opts?: VfxSpawnOpts,
): VfxHandle {
  return vfxRuntime.spawnCastEffect(abilityId, pose, opts);
}

export function spawnImpactEffect(
  abilityId: SpellEffectId | string,
  pose: VfxPose,
  opts?: VfxSpawnOpts,
): VfxHandle {
  return vfxRuntime.spawnImpactEffect(abilityId, pose, opts);
}

export function cancelFollowOwnerVfx(abilityId: string, ownerId: string): void {
  vfxRuntime.cancelFollowOwner(abilityId, ownerId);
}
