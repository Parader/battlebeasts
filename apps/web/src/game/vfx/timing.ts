/** Named timing pads for cast / impact VFX — avoid magic +700 sprawl. */

export const CHARGE_PAD_MS = 120;
export const BARRIER_CHARGE_PAD_MS = 80;
export const FLIGHT_COAST_MS = 700;
export const DETONATE_COAST_MS = 800;
export const BARRIER_DISSOLVE_MS = 500;
export const BRIDGED_AOE_LIFE_PAD_MS = 280;
export const MUZZLE_LEAD_MS = 150;
export const BOLT_MUZZLE_FORWARD = 0.95;
export const BOLT_MUZZLE_Y = 1.05;

/** Flight duration from ability range/speed. */
export function getFlightDurationMs(
  range: number | undefined,
  speed: number | undefined,
  fallbackRange: number,
  fallbackSpeed: number,
  fallbackMs: number,
): number {
  const r = range != null && range > 0 ? range : fallbackRange;
  const s = speed != null && speed > 0 ? speed : fallbackSpeed;
  if (!(s > 0)) return fallbackMs;
  return (r / s) * 1000;
}
