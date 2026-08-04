type Listener = () => void;

/**
 * Spellbar hover bus — AbilityBar sets hovered ability id;
 * world telegraph (CharacterAvatar) reads it.
 */
class AbilityHoverRuntime {
  hoveredAbilityId: string | null = null;
  private listeners = new Set<Listener>();
  private emitRaf = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setHoveredAbilityId(id: string | null): void {
    if (this.hoveredAbilityId === id) return;
    this.hoveredAbilityId = id;
    this.scheduleEmit();
  }

  clear(): void {
    this.setHoveredAbilityId(null);
  }

  private scheduleEmit(): void {
    if (this.emitRaf) return;
    this.emitRaf = requestAnimationFrame(() => {
      this.emitRaf = 0;
      for (const fn of this.listeners) fn();
    });
  }
}

export const abilityHoverRuntime = new AbilityHoverRuntime();
