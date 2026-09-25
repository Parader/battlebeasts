/**
 * Live knobs for gallery elements (same idea as lightning filaments).
 * Mutate and the next spawn / frame picks them up where wired.
 */

export type ElementSettings = {
  rate: number;
  size: number;
  sizeEnd: number;
  life: number;
  opacity: number;
  rise: number;
  spread: number;
  noise: number;
  drag: number;
  burst: number;
};

const DEFAULTS: ElementSettings = {
  rate: 40,
  size: 0.55,
  sizeEnd: 0.15,
  life: 1.1,
  opacity: 1,
  rise: 1.2,
  spread: 0.28,
  noise: 0.45,
  drag: 0.15,
  burst: 6,
};

/** Per-element overrides seeded from gallery recipes. */
const SEEDS: Record<string, Partial<ElementSettings>> = {
  fire: { rate: 70, size: 0.75, sizeEnd: 0.2, life: 0.7, rise: 2.0, opacity: 1, noise: 0.5 },
  frost: { rate: 42, size: 0.5, life: 1.2, rise: 1.2, opacity: 1, noise: 0.35 },
  poison: { rate: 55, size: 0.45, life: 0.8, rise: 1.3, opacity: 1, noise: 0.65 },
  lightning: { rate: 18, size: 0.2, life: 0.35, rise: 0.4, opacity: 1, noise: 1.0 },
  void: { rate: 32, size: 0.7, life: 0.9, rise: 0.9, opacity: 1, noise: 0.5 },
  wind: { rate: 50, size: 1.0, sizeEnd: 0.4, life: 0.55, rise: 0.4, opacity: 1, noise: 0.45 },
  heal: { rate: 28, size: 0.4, life: 1.6, rise: 0.55, opacity: 1, noise: 0.35, drag: 0.35 },
  holy: { rate: 36, size: 0.45, life: 1.0, rise: 1.5, opacity: 1, noise: 0.3 },
  blood: { rate: 40, size: 0.5, life: 0.85, rise: 0.7, opacity: 1, noise: 0.55, drag: 0.2 },
};

const byId = new Map<string, ElementSettings>();

function ensure(id: string): ElementSettings {
  let s = byId.get(id);
  if (!s) {
    s = { ...DEFAULTS, ...(SEEDS[id] ?? {}) };
    byId.set(id, s);
  }
  return s;
}

export function getElementSettings(id: string): ElementSettings {
  return ensure(id);
}

export function patchElementSettings(id: string, partial: Partial<ElementSettings>): void {
  Object.assign(ensure(id), partial);
}

export function resetElementSettings(id: string): void {
  byId.set(id, { ...DEFAULTS, ...(SEEDS[id] ?? {}) });
}
