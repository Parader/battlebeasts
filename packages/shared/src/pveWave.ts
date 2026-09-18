/** Wave Assault (PvE dungeon) constants and soft perf caps. */

export const PVE_WAVE_ENEMY_SOFT_CAP = 14;
export const PVE_WAVE_ENEMY_HARD_CAP = 18;

/** WorldTarget.kind for cemetery rushers. */
export const PVE_ZOMBIE_KIND = "zombie";

/** WorldTarget.kind for spellcasting elites. */
export const PVE_ELITE_KIND = "elite";

export function isPveWaveMobKind(kind: string | undefined | null): boolean {
  return kind === PVE_ZOMBIE_KIND || kind === PVE_ELITE_KIND;
}

export const PVE_ZOMBIE_BASE_HP = 380;
export const PVE_ZOMBIE_BASE_SPEED = 2.55;
export const PVE_ZOMBIE_MELEE_RANGE = 1.35;
export const PVE_ZOMBIE_MELEE_DAMAGE = 32;
export const PVE_ZOMBIE_MELEE_COOLDOWN_MS = 900;
export const PVE_ZOMBIE_RETARGET_MS = 200;

/** Legacy clear-beat; waves now roll on a fixed clock (`PVE_WAVE_INTERVAL_MS`). */
export const PVE_WAVE_CLEAR_MS = 2500;

/** Time from one wave's start until the next wave begins, even if leftovers remain. */
export const PVE_WAVE_INTERVAL_MS = 16000;

/** Delay between individual zombie spawns within a wave. */
export const PVE_WAVE_SPAWN_STAGGER_MS = 650;

/**
 * How far from the party an infinite-wave mob appears.
 *
 * Authored pads give *direction* (come from that side of the map). The actual
 * spawn sits on that ray, close enough that hunters can see and react.
 */
export const PVE_ENEMY_APPROACH_MIN_M = 14;
export const PVE_ENEMY_APPROACH_MAX_M = 22;
/** Pads closer than this are the holdout itself and are not ingress. */
export const PVE_ENEMY_INGRESS_MIN_M = 8;

/** First wave enemy count; scales +1/wave, capped. */
export const PVE_WAVE_BASE_COUNT = 4;

/** Clamp locked coop party size used for difficulty scaling (1–4). */
export function clampPvePartySize(partySize: number): number {
  const n = Math.floor(Number(partySize));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(4, n));
}

/** HP multiplier by party size: 1.0 / 1.3 / 1.6 / 1.9 */
export function pvePartyHpMul(partySize: number): number {
  const n = clampPvePartySize(partySize);
  return 0.7 + 0.3 * n;
}

/** Damage multiplier by party size: 1.0 / 1.25 / 1.5 / 1.75 */
export function pvePartyDamageMul(partySize: number): number {
  const n = clampPvePartySize(partySize);
  return 0.75 + 0.25 * n;
}

export function pveWaveEnemyCount(waveIndex: number, partySize = 1): number {
  const n = clampPvePartySize(partySize);
  const count = PVE_WAVE_BASE_COUNT + Math.max(0, waveIndex - 1) * 1 + (n - 1);
  return Math.min(PVE_WAVE_ENEMY_SOFT_CAP, count);
}

export function pveWaveHp(waveIndex: number, partySize = 1): number {
  return Math.round(
    PVE_ZOMBIE_BASE_HP * (1 + (waveIndex - 1) * 0.16) * pvePartyHpMul(partySize),
  );
}

export function pveWaveDamage(waveIndex: number, partySize = 1): number {
  return Math.round(
    PVE_ZOMBIE_MELEE_DAMAGE * (1 + (waveIndex - 1) * 0.12) * pvePartyDamageMul(partySize),
  );
}

export function pveWaveSpeed(waveIndex: number): number {
  return PVE_ZOMBIE_BASE_SPEED * (1 + Math.min(0.22, (waveIndex - 1) * 0.02));
}

/**
 * Per-zombie speed multiplier so rushers don't pack at one pace.
 * Deterministic from spawn ordinal within the wave.
 */
export function pveZombieSpeedMul(spawnOrdinal: number): number {
  // Spread ~0.78× … 1.14× so packs fan out without outrunning hunters.
  const tiers = [0.78, 0.86, 0.94, 1.02, 1.08, 1.14];
  return tiers[spawnOrdinal % tiers.length]!;
}
