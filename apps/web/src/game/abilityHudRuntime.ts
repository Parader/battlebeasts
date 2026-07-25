type Listener = () => void;

/**
 * Ability-bar HUD bus (cooldowns + cast flash).
 * Updates stay off the PlayScreen / Canvas React tree.
 */
class AbilityHudRuntime {
  cooldownUntil: Record<string, number> = {};
  flashId: string | null = null;
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

  clear(): void {
    this.cooldownUntil = {};
    this.flashId = null;
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
