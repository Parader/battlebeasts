/** Soft character fade for Teleport Slam blink (no white sphere). */

type FadeMode = "out" | "in";

type FadeState = {
  mode: FadeMode;
  startedAt: number;
  durationMs: number;
  /** Stay fully invisible this long before rematerialize ramp (fade-in only). */
  holdMs: number;
};

const bySession = new Map<string, FadeState>();
/** After blink: suppress cast anim until cast schema clears. */
const animSuppressed = new Set<string>();

/** Vanish into the slam — finishes before the blink when delay is aligned. */
const FADE_OUT_MS = 100;
/**
 * Rematerialize at the landing point — long enough to read as a transition,
 * not a pop.
 */
const FADE_IN_MS = 520;
/** Beat of full invis at the new spot before opacity climbs. */
const FADE_IN_HOLD_MS = 50;

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Begin vanishing as the slam impact lands (before the blink). */
export function beginTeleportSlamFadeOut(sessionId: string): void {
  if (!sessionId) return;
  bySession.set(sessionId, {
    mode: "out",
    startedAt: performance.now(),
    durationMs: FADE_OUT_MS,
    holdMs: 0,
  });
}

/** Rematerialize after the blink snap — also kill cast anim restart. */
export function beginTeleportSlamFadeIn(sessionId: string): void {
  if (!sessionId) return;
  animSuppressed.add(sessionId);
  bySession.set(sessionId, {
    mode: "in",
    startedAt: performance.now(),
    durationMs: FADE_IN_MS,
    holdMs: FADE_IN_HOLD_MS,
  });
}

/** True after blink until cast fields clear — no upper/full-body cast clip. */
export function isTeleportSlamAnimSuppressed(
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  return animSuppressed.has(sessionId);
}

export function clearTeleportSlamAnimSuppress(
  sessionId: string | null | undefined,
): void {
  if (!sessionId) return;
  animSuppressed.delete(sessionId);
}

/** True while a slam fade is driving opacity (apply every frame). */
export function hasTeleportSlamFade(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  return bySession.has(sessionId);
}

/** 0 = invisible, 1 = fully opaque. */
export function getTeleportSlamOpacity(
  sessionId: string | null | undefined,
  now = performance.now(),
): number {
  if (!sessionId) return 1;
  const state = bySession.get(sessionId);
  if (!state) return 1;
  const elapsed = now - state.startedAt;

  if (state.mode === "out") {
    const t = Math.max(0, Math.min(1, elapsed / Math.max(16, state.durationMs)));
    // Ease out — linger near solid briefly, then drop away.
    const opacity = 1 - smoothstep(t);
    if (t >= 1) {
      // Stay invisible until fade-in starts.
      return 0;
    }
    return opacity;
  }

  // Fade-in: hold invisible at the landing point, then soft rematerialize.
  if (elapsed < state.holdMs) return 0;
  const t = Math.max(
    0,
    Math.min(1, (elapsed - state.holdMs) / Math.max(16, state.durationMs)),
  );
  // Ease-in — starts soft so the pop never reads as a hard cut.
  const opacity = smoothstep(t);
  if (t >= 1) {
    bySession.delete(sessionId);
    return 1;
  }
  return opacity;
}
