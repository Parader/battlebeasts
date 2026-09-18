import { PICKUP_EFFECTS, type PickupSpec } from "./maps/elements";

/** At most this many runtime Wave Assault orbs on the floor at once. */
export const PVE_ORB_COUNT = 2;
export const PVE_ORB_CLEARANCE_M = 4;
export const PVE_ORB_PLAYER_CLEARANCE_M = 8;
export const PVE_ORB_PEER_CLEARANCE_M = 10;
export const PVE_ORB_RADIUS = 1.25;

/** Delay before the first orb of a run, and between later spawns (ms). */
export const PVE_ORB_SPAWN_MS_MIN = 16_000;
export const PVE_ORB_SPAWN_MS_MAX = 34_000;
/** Retry when a spawn sample cannot find a clear pad. */
export const PVE_ORB_RETRY_MS_MIN = 2_500;
export const PVE_ORB_RETRY_MS_MAX = 5_000;

export function nextPveOrbDelay(rng: () => number = Math.random): number {
  return PVE_ORB_SPAWN_MS_MIN + rng() * (PVE_ORB_SPAWN_MS_MAX - PVE_ORB_SPAWN_MS_MIN);
}

export function nextPveOrbRetry(rng: () => number = Math.random): number {
  return PVE_ORB_RETRY_MS_MIN + rng() * (PVE_ORB_RETRY_MS_MAX - PVE_ORB_RETRY_MS_MIN);
}

/** @deprecated Use nextPveOrbDelay — kept for older imports. */
export const PVE_ORB_RESPAWN_MS = PVE_ORB_SPAWN_MS_MIN;

type PveOrbRoll = {
  effect: string;
  weight: number;
  magnitude: number;
  durationMs: number;
};

/**
 * Heal is the common lure; speed / power / shield are the noticeable rares.
 * Weights sum to 100.
 */
const PVE_ORB_TABLE: readonly PveOrbRoll[] = [
  { effect: "heal", weight: 40, magnitude: 500, durationMs: 0 },
  { effect: "speed", weight: 22, magnitude: 1.5, durationMs: 10_000 },
  { effect: "power", weight: 22, magnitude: 1.5, durationMs: 10_000 },
  { effect: "absorb", weight: 16, magnitude: 450, durationMs: 12_000 },
];

/** Runtime Wave Assault orbs — one-shot, director respawns elsewhere. */
export function rollPveOrbSpec(rng: () => number = Math.random): PickupSpec {
  const roll = rng() * 100;
  let acc = 0;
  let picked = PVE_ORB_TABLE[0]!;
  for (const row of PVE_ORB_TABLE) {
    acc += row.weight;
    if (roll < acc) {
      picked = row;
      break;
    }
  }
  const def = PICKUP_EFFECTS[picked.effect] ?? PICKUP_EFFECTS.heal;
  return {
    effect: picked.effect,
    def,
    magnitude: picked.magnitude,
    durationMs: picked.durationMs,
    respawnMs: 0,
    firstSpawnMs: 0,
  };
}
