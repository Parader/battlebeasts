import type { FxBurst, DamagePopup } from "./CombatVfx";

type Listener = () => void;

/**
 * Imperative combat overlay bus (ground rings + damage numbers).
 * Keeps cast/hit FX updates out of PlayScreen → GameCanvas React commits.
 */
class CombatOverlayRuntime {
  private bursts: FxBurst[] = [];
  private popups: DamagePopup[] = [];
  private listeners = new Set<Listener>();
  private emitRaf = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getBursts(): readonly FxBurst[] {
    return this.bursts;
  }

  getPopups(): readonly DamagePopup[] {
    return this.popups;
  }

  pushBurst(burst: FxBurst): void {
    const now = performance.now();
    let w = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i]!;
      if (now - b.born < b.life) this.bursts[w++] = b;
    }
    this.bursts.length = w;
    this.bursts.push(burst);
    this.scheduleEmit();
  }

  pushPopup(popup: DamagePopup): void {
    const now = performance.now();
    let w = 0;
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i]!;
      if (now - p.born < p.life) this.popups[w++] = p;
    }
    this.popups.length = w;
    this.popups.push(popup);
    this.scheduleEmit();
  }

  /** Drop expired entries; call from the render loop. */
  prune(now = performance.now()): void {
    let changed = false;
    let w = 0;
    for (let i = 0; i < this.bursts.length; i++) {
      const b = this.bursts[i]!;
      if (now - b.born < b.life) this.bursts[w++] = b;
      else changed = true;
    }
    if (w !== this.bursts.length) {
      this.bursts.length = w;
      changed = true;
    }
    w = 0;
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i]!;
      if (now - p.born < p.life) this.popups[w++] = p;
      else changed = true;
    }
    if (w !== this.popups.length) {
      this.popups.length = w;
      changed = true;
    }
    if (changed) this.scheduleEmit();
  }

  clear(): void {
    if (this.bursts.length === 0 && this.popups.length === 0) return;
    this.bursts.length = 0;
    this.popups.length = 0;
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

export const combatOverlayRuntime = new CombatOverlayRuntime();
