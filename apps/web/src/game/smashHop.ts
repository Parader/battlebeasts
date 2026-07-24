import {
  ABILITIES,
  leapHopNormalized,
  phaseDurationMs,
  travelDurationMs,
  travelTakeoffDelayMs,
} from "@battlebeasts/shared";

/** Peak hop height (world units) during Leap Slam airborne window. */
export const SMASH_HOP_HEIGHT = 1.45;

type CastHopFields = {
  castAbilityId?: string;
  castPhase?: string;
  castPhaseEndsAt?: number;
};

/**
 * Leap Slam hop Y — stays planted through anticipation + takeoff delay,
 * then ballistic air time that lands at impact end.
 */
export function smashHopOffsetY(
  player: CastHopFields | null | undefined,
  nowMs = Date.now(),
): number {
  if (!player || player.castAbilityId !== "smash" || player.castPhase !== "impact") {
    return 0;
  }
  const def = ABILITIES.smash;
  if (!def) return 0;
  const impactMs = Math.max(1, phaseDurationMs(def, "impact"));
  const takeoffDelay = Math.min(impactMs - 16, travelTakeoffDelayMs(def));
  // Prefer authored air duration so hop matches travel, not a looser impact remainder.
  const airMs = Math.max(16, Math.min(impactMs - takeoffDelay, travelDurationMs(def) || impactMs - takeoffDelay));
  const endsAt = player.castPhaseEndsAt ?? 0;
  if (endsAt <= 0) return 0;
  const left = Math.max(0, endsAt - nowMs);
  const elapsed = impactMs - Math.min(impactMs, left);
  if (elapsed < takeoffDelay) return 0;
  const airProgress = Math.min(1, (elapsed - takeoffDelay) / airMs);
  return leapHopNormalized(airProgress) * SMASH_HOP_HEIGHT;
}
