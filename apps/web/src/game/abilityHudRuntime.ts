type Listener = () => void;

/**
 * Ability-bar HUD bus (cooldowns + cast flash + last Flow move).
 * Updates stay off the PlayScreen / Canvas React tree.
 */
class AbilityHudRuntime {
  cooldownUntil: Record<string, number> = {};
  flashId: string | null = null;
  /** Last Flow-movement the local player committed (Double Step / Motion Echo). */
  lastFlowMoveId: string | null = null;
  /** Wall clock when the sim paused; HUD remaining uses this instead of Date.now(). */
  clockPausedAt = 0;
  private listeners = new Set<Listener>();
  private emitRaf = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setCooldownUntil(next: Record<string, number>): void {
    this.cooldownUntil = next;
    this.scheduleEmit();
  }

  setFlashId(id: string | null): void {
    this.flashId = id;
    this.scheduleEmit();
  }

  setLastFlowMoveId(id: string | null): void {
    if (this.lastFlowMoveId === id) return;
    this.lastFlowMoveId = id;
    this.scheduleEmit();
  }

  hudNow(): number {
    return this.clockPausedAt > 0 ? this.clockPausedAt : Date.now();
  }

  pauseClock(): void {
    if (this.clockPausedAt > 0) return;
    this.clockPausedAt = Date.now();
    this.scheduleEmit();
  }

  resumeClock(): void {
    if (this.clockPausedAt <= 0) return;
    const delta = Date.now() - this.clockPausedAt;
    this.clockPausedAt = 0;
    if (delta > 0) {
      const next: Record<string, number> = {};
      for (const [id, until] of Object.entries(this.cooldownUntil)) {
        next[id] = until > 0 ? until + delta : until;
      }
      this.cooldownUntil = next;
    }
    this.scheduleEmit();
  }

  clear(): void {
    this.cooldownUntil = {};
    this.flashId = null;
    this.lastFlowMoveId = null;
    this.clockPausedAt = 0;
    this.scheduleEmit();
  }

  private scheduleEmit(): void {
    if (this.emitRaf) return;
    this.emitRaf = requestAnimationFrame(() => {
      this.emitRaf = 0;
      for (const fn of this.listeners) fn();
    });
  }
}

export const abilityHudRuntime = new AbilityHudRuntime();
