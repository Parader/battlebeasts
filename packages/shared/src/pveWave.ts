/** Wave Assault (PvE dungeon) constants and soft perf caps. */

export const PVE_WAVE_ENEMY_SOFT_CAP = 16;
export const PVE_WAVE_ENEMY_HARD_CAP = 20;

/** WorldTarget.kind for cemetery rushers. */
export const PVE_ZOMBIE_KIND = "zombie";

export const PVE_ZOMBIE_BASE_HP = 200;
export const PVE_ZOMBIE_BASE_SPEED = 3.2;
export const PVE_ZOMBIE_MELEE_RANGE = 1.35;
export const PVE_ZOMBIE_MELEE_DAMAGE = 18;
export const PVE_ZOMBIE_MELEE_COOLDOWN_MS = 900;
export const PVE_ZOMBIE_RETARGET_MS = 200;

/** Between-wave beat before next spawn. */
export const PVE_WAVE_CLEAR_MS = 2500;

/** Delay between individual zombie spawns within a wave. */
export const PVE_WAVE_SPAWN_STAGGER_MS = 650;

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
  const count = PVE_WAVE_BASE_COUNT + Math.max(0, waveIndex - 1) + (n - 1);
  return Math.min(PVE_WAVE_ENEMY_SOFT_CAP, count);
}

export function pveWaveHp(waveIndex: number, partySize = 1): number {
  return Math.round(
    PVE_ZOMBIE_BASE_HP * (1 + (waveIndex - 1) * 0.12) * pvePartyHpMul(partySize),
  );
}

export function pveWaveDamage(waveIndex: number, partySize = 1): number {
  return Math.round(
    PVE_ZOMBIE_MELEE_DAMAGE * (1 + (waveIndex - 1) * 0.08) * pvePartyDamageMul(partySize),
  );
}

export function pveWaveSpeed(waveIndex: number): number {
  return PVE_ZOMBIE_BASE_SPEED * (1 + Math.min(0.35, (waveIndex - 1) * 0.03));
}

/**
 * Per-zombie speed multiplier so rushers don't pack at one pace.
 * Deterministic from spawn ordinal within the wave.
 */
export function pveZombieSpeedMul(spawnOrdinal: number): number {
  // Spread ~0.72× … 1.28× across the wave so packs fan out.
  const tiers = [0.72, 0.84, 0.95, 1.05, 1.16, 1.28];
  return tiers[spawnOrdinal % tiers.length]!;
}
