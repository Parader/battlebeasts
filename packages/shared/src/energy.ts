/**
 * Energy — a burst resource earned by fighting.
 *
 * Fills from damage dealt, damage taken and healing done; resets to zero at
 * the start of every round. Its eventual purpose is to pay for the flex slots
 * (see `docs/energy-and-flex-slots.md`), but nothing spends it yet: the fill
 * rate is the one number that cannot be settled on paper, so generation ships
 * on its own and gets played before anything depends on it.
 *
 * Deliberately NOT a sustain resource. It only ever adds options on top of a
 * normal kit, so a player can never starve themselves out of playing.
 */

/**
 * Bar size in pips. Eight because it makes the intended cost fractions whole
 * numbers -- a quarter of a bar is 2 pips, three quarters is 6 -- and because
 * a segmented bar is readable at a glance, which matters when an opponent's
 * energy is a threat you have to assess mid-fight.
 */
export const ENERGY_MAX_PIPS = 8;

/**
 * Damage (or healing) required per pip, by source.
 *
 * Taken is cheaper than dealt on purpose: it hands the losing player some
 * comeback pressure. Player HP is 2000, so a round where the winner deals
 * 2000 and takes 1200 generates about 16 pips, or two bars.
 */
export const ENERGY_PER_PIP = {
  damageDealt: 220,
  damageTaken: 180,
  healingDone: 220,
} as const;

export type EnergySource = keyof typeof ENERGY_PER_PIP;

/**
 * Ceiling on how fast the bar can fill, in pips per second.
 *
 * This is a hard ceiling, not a queue: energy earned above the rate is thrown
 * away rather than paid out later. That distinction is the whole point. It
 * removes any reason to deliberately eat chip damage, and in 1v1v1 it stops a
 * focused player from farming a full bar off two attackers -- both of which
 * would still pay out, just late, if the excess were banked.
 *
 * At 0.4 the ceiling is one full bar per 20s of uninterrupted output, so it
 * does not bind during normal trading -- the per-pip rates above govern that
 * -- and only bites when someone is standing still hitting one target.
 */
export const ENERGY_MAX_PIPS_PER_SEC = 0.4;

/**
 * How much may be earned in a single instant, in pips.
 *
 * Without this a burst build is taxed far harder than a chip build for the
 * same damage, because one big hit would be shaved to a fraction of a pip
 * while the same total spread over a second passes untouched. One pip of
 * headroom smooths that out without letting a nuke fill the bar.
 */
export const ENERGY_BURST_PIPS = 1;

/** Energy earned by one contribution, before any rate limiting. */
export function energyFor(source: EnergySource, amount: number): number {
  if (!(amount > 0)) return 0;
  return amount / ENERGY_PER_PIP[source];
}

/**
 * Rate limiter for energy gain, as a refilling allowance.
 *
 * Held per player and advanced with the server tick. Kept here rather than in
 * the combat system so the numbers and the rule that enforces them stay in one
 * place, and so it can be unit tested without a room.
 */
export class EnergyLimiter {
  private allowance = ENERGY_BURST_PIPS;

  /** Advance by `dt` seconds. */
  refill(dt: number): void {
    if (!(dt > 0)) return;
    this.allowance = Math.min(
      ENERGY_BURST_PIPS,
      this.allowance + dt * ENERGY_MAX_PIPS_PER_SEC,
    );
  }

  /** Pips actually granted for a `pips` gain. The remainder is discarded. */
  take(pips: number): number {
    if (!(pips > 0)) return 0;
    const granted = Math.min(pips, this.allowance);
    this.allowance -= granted;
    return granted;
  }

  /** Back to a full allowance, for a round reset. */
  reset(): void {
    this.allowance = ENERGY_BURST_PIPS;
  }
}

/** Clamp to the bar. */
export function clampEnergy(pips: number): number {
  return Math.max(0, Math.min(ENERGY_MAX_PIPS, pips));
}

/**
 * Whole pips currently lit, for rendering.
 *
 * Floors, so a bar shows a pip only once it is genuinely paid for -- a spend
 * gated on 4 pips must never be denied while the UI shows four.
 */
export function energyPips(energy: number): number {
  return Math.floor(clampEnergy(energy));
}

/** Fill fraction of the pip currently being earned, 0..1, for a partial segment. */
export function energyPipFraction(energy: number): number {
  const e = clampEnergy(energy);
  return e >= ENERGY_MAX_PIPS ? 0 : e - Math.floor(e);
}
