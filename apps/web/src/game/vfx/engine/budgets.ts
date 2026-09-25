/** Hard caps — enforced in the updater, not by callers being polite. */

export const MAX_PARTICLES = 4096;
export const MAX_EMITTERS = 96;
export const BATCH_COUNT = 4;
/** Soft LOD: stop trail emitters before cores when the pool is this full. */
export const LOD_TRAIL_RATIO = 0.7;
export const SIM_BUDGET_MS = 1.5;
export const MAX_PARTICLE_DRAWS = BATCH_COUNT;
export const MAX_DT = 0.033;
