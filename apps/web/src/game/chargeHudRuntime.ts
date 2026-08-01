type ChargeHudState = {
  active: boolean;
  abilityId: string;
  /** performance.now() when charge channel opened. */
  startedAt: number;
  maxMs: number;
  /** Extra hold at full charge before auto-release (unused for timed fireball). */
  holdMs: number;
};

type Listener = () => void;

const idle: ChargeHudState = {
  active: false,
  abilityId: "",
  startedAt: 0,
  maxMs: 4000,
  holdMs: 0,
};

/**
 * Client-only cast-progress bus for timed casts (Fireball).
 * Written from cast start / cast_phase; read by PlayerCastChannelBar.
 */
class ChargeHudRuntime {
  private state: ChargeHudState = { ...idle };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): ChargeHudState {
    return this.state;
  }

  begin(abilityId: string, maxMs: number, holdMs = 0): void {
    if (
      this.state.active &&
      this.state.abilityId === abilityId &&
      this.state.startedAt > 0
    ) {
      return;
    }
    this.state = {
      active: true,
      abilityId,
      startedAt: performance.now(),
      maxMs,
      holdMs,
    };
    this.emit();
  }

  clear(): void {
    if (!this.state.active) return;
    this.state = { ...idle };
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const chargeHudRuntime = new ChargeHudRuntime();
