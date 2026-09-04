export type CastBarMode = "cast" | "channel" | "charge";

export type CastBarState = {
  active: boolean;
  abilityId: string;
  name: string;
  mode: CastBarMode;
  /** performance.now() when the bar opened. */
  startedAt: number;
  durationMs: number;
  /** Extra hold at full charge (Fireball grace — unused for timed charge). */
  holdMs: number;
  interruptible: boolean;
};

type Listener = () => void;

const idle: CastBarState = {
  active: false,
  abilityId: "",
  name: "",
  mode: "cast",
  startedAt: 0,
  durationMs: 1000,
  holdMs: 0,
  interruptible: true,
};

export type CastBarBeginOpts = {
  abilityId: string;
  name: string;
  mode: CastBarMode;
  durationMs: number;
  holdMs?: number;
  interruptible?: boolean;
};

/**
 * Client-only cast-progress bus for the WoW-style HUD cast bar
 * (and the Fireball feet billboard).
 */
class CastBarRuntime {
  private state: CastBarState = { ...idle };
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): CastBarState {
    return this.state;
  }

  begin(opts: CastBarBeginOpts): void {
    const durationMs = Math.max(1, opts.durationMs);
    // Same ability + mode already running — keep the original start time.
    if (
      this.state.active &&
      this.state.abilityId === opts.abilityId &&
      this.state.mode === opts.mode &&
      this.state.startedAt > 0
    ) {
      return;
    }
    this.state = {
      active: true,
      abilityId: opts.abilityId,
      name: opts.name,
      mode: opts.mode,
      startedAt: performance.now(),
      durationMs,
      holdMs: opts.holdMs ?? 0,
      interruptible: opts.interruptible !== false,
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

export const castBarRuntime = new CastBarRuntime();

/**
 * @deprecated Prefer castBarRuntime — kept for older Fireball call sites.
 * `maxMs` maps to `durationMs`.
 */
export const chargeHudRuntime = {
  subscribe: (fn: Listener) => castBarRuntime.subscribe(fn),
  getState: () => {
    const s = castBarRuntime.getState();
    return {
      active: s.active,
      abilityId: s.abilityId,
      startedAt: s.startedAt,
      maxMs: s.durationMs,
      holdMs: s.holdMs,
    };
  },
  begin: (abilityId: string, maxMs: number, holdMs = 0) => {
    castBarRuntime.begin({
      abilityId,
      name: abilityId,
      mode: abilityId === "fireball" ? "charge" : "cast",
      durationMs: maxMs,
      holdMs,
    });
  },
  clear: () => castBarRuntime.clear(),
};
