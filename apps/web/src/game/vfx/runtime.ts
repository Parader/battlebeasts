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
};

const IMPACT_LIFE_MS: Record<string, number> = {
  bolt: 380,
  crescent: 320,
  smash: 1800,
  gust: 1200,
  spikes: 560,
};

/**
 * Imperative VFX bus for one-shot cast/impact bursts.
 * R3F `VfxWorld` subscribes and mounts visuals; combat bridges call spawn*.
 */
class VfxRuntime {
  private shots: OneShotEffect[] = [];
  private listeners = new Set<Listener>();
  private nextKey = 1;

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

  /** Drop expired shots; call from the render loop. */
  prune(now = performance.now()): void {
    const before = this.shots.length;
    this.shots = this.shots.filter((s) => now - s.born < s.life);
    if (this.shots.length !== before) this.emit();
  }

  clear(): void {
    if (this.shots.length === 0) return;
    this.shots = [];
    this.emit();
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
      variant: opts?.variant,
    };
    this.shots = [...this.shots, shot];
    this.emit();
    return {
      cancel: () => {
        const n = this.shots.filter((s) => s.key !== key);
        if (n.length !== this.shots.length) {
          this.shots = n;
          this.emit();
        }
      },
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
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
