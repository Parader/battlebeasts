import { REVENGE_CAST } from "@battlebeasts/shared";

/** Per-session vanish latch — starts on revenge blink FX so we don't flash before status sync. */
const vanishUntilBySession = new Map<string, number>();

export function beginRevengeVanish(
  sessionId: string,
  durationMs: number = REVENGE_CAST.vanishMs,
): void {
  if (!sessionId) return;
  vanishUntilBySession.set(sessionId, performance.now() + Math.max(0, durationMs));
}

export function isRevengeVanished(
  sessionId: string | null | undefined,
  now = performance.now(),
): boolean {
  if (!sessionId) return false;
  const until = vanishUntilBySession.get(sessionId) ?? 0;
  if (now >= until) {
    if (until > 0) vanishUntilBySession.delete(sessionId);
    return false;
  }
  return true;
}
