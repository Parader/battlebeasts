/** Full-body emote animations — pie wheel + Appearance tab. */

export const EMOTE_PIE_SLOT_COUNT = 8;

export interface EmoteDef {
  id: string;
  name: string;
  /** Clip name inside hero.glb / heroAnimationConfig. */
  animClip: string;
  durationMs: number;
  /** Free for every player. */
  starter?: boolean;
}

export const EMOTES: Record<string, EmoteDef> = {
  wave: {
    id: "wave",
    name: "Wave",
    animClip: "Wave Hip Hop Dance",
    durationMs: 3200,
    starter: true,
  },
  chicken: {
    id: "chicken",
    name: "Chicken",
    animClip: "Chicken Dance",
    durationMs: 4000,
    starter: true,
  },
  shuffle: {
    id: "shuffle",
    name: "Shuffle",
    animClip: "Shuffling Dance",
    durationMs: 3600,
    starter: true,
  },
  macarena: {
    id: "macarena",
    name: "Macarena",
    animClip: "Macarena Dance",
    durationMs: 5200,
  },
  ymca: {
    id: "ymca",
    name: "YMCA",
    animClip: "Ymca Dance",
    durationMs: 4800,
  },
  twist: {
    id: "twist",
    name: "Twist",
    animClip: "Twist Dance",
    durationMs: 4000,
  },
  locking: {
    id: "locking",
    name: "Locking",
    animClip: "Locking Hip Hop Dance",
    durationMs: 4200,
  },
  running_man: {
    id: "running_man",
    name: "Running Man",
    animClip: "Dancing Running Man",
    durationMs: 3800,
  },
};

/**
 * Map a screen-space aim angle (atan2(dy, dx), radians) to a pie wedge index.
 * Slot 0 is centered at the top (screen "up") and wedges proceed clockwise —
 * shared by `EmotePieHud` (render highlight) and the input hook (cast decision)
 * so both agree on wedge boundaries.
 */
export function angleToEmoteSlotIndex(
  angleRad: number,
  slotCount: number = EMOTE_PIE_SLOT_COUNT,
): number {
  const twoPi = Math.PI * 2;
  const step = twoPi / slotCount;
  const rotated = angleRad + Math.PI / 2 + step / 2;
  const norm = ((rotated % twoPi) + twoPi) % twoPi;
  return Math.floor(norm / step) % slotCount;
}

export function getEmote(id: string | null | undefined): EmoteDef | undefined {
  if (!id) return undefined;
  return EMOTES[id];
}

export function starterEmoteIds(): string[] {
  return Object.values(EMOTES)
    .filter((e) => e.starter)
    .map((e) => e.id);
}

export function ownsEmote(owned: string[] | null | undefined, emoteId: string): boolean {
  if (!EMOTES[emoteId]) return false;
  if (EMOTES[emoteId]!.starter) return true;
  return Boolean(owned?.includes(emoteId));
}

export function emptyEmoteSlots(): (string | null)[] {
  return Array.from({ length: EMOTE_PIE_SLOT_COUNT }, () => null);
}

/** Normalize pie slots; drop unknown / unowned ids. */
export function normalizeEmoteSlots(
  raw: unknown,
  owned: string[] | null | undefined,
): (string | null)[] {
  const out = emptyEmoteSlots();
  if (!Array.isArray(raw)) {
    // Default: put starters in first wedges
    const starters = starterEmoteIds();
    for (let i = 0; i < Math.min(starters.length, EMOTE_PIE_SLOT_COUNT); i++) {
      out[i] = starters[i]!;
    }
    return out;
  }
  for (let i = 0; i < EMOTE_PIE_SLOT_COUNT; i++) {
    const id = raw[i];
    if (typeof id === "string" && ownsEmote(owned, id)) out[i] = id;
    else out[i] = null;
  }
  return out;
}
