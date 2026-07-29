/**
 * Flat HP combat magnitudes (damage, heal, shield absorb, DoT/HoT ticks, base max HP).
 * Does **not** apply to CC, slow/stun/root, move muls, % multipliers, radii, or any time values.
 */
export const COMBAT_MAGNITUDE_SCALE = 10;

/** Scale an authored flat HP magnitude (damage / heal / shield / tick). */
export function combatMag(n: number): number {
  return n * COMBAT_MAGNITUDE_SCALE;
}

/** Default player max HP (pre-talent). */
export const PLAYER_BASE_MAX_HP = combatMag(100);

/** Practice dummy max HP. */
export const PRACTICE_DUMMY_MAX_HP = combatMag(200);

/** Health tonic consumable heal. */
export const HEALTH_TONIC_HEAL = combatMag(25);
