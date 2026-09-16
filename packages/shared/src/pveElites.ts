import { ABILITIES } from "./abilities";
import { clampPvePartySize } from "./pveWave";

/** Distinctive body tints keyed by signature spell. */
export const PVE_ELITE_TINT: Record<string, string> = {
  bolt: "#e8c547",
  iceLance: "#7dd3fc",
  frostBall: "#38bdf8",
  poisonDart: "#4ade80",
};

export const PVE_ELITE_TINT_DEFAULT = "#f59e0b";

export function pveEliteTint(abilityId: string | undefined | null): string {
  if (!abilityId) return PVE_ELITE_TINT_DEFAULT;
  return PVE_ELITE_TINT[abilityId] ?? PVE_ELITE_TINT_DEFAULT;
}

/**
 * Projectile spells elites may learn. Channels, dashes, and ground plants stay
 * off this list — NPC fire goes through `fireProjectileFrom`.
 */
export const PVE_ELITE_SPELL_UNLOCKS: ReadonlyArray<{ wave: number; id: string }> = [
  { wave: 2, id: "bolt" },
  { wave: 3, id: "iceLance" },
  { wave: 4, id: "poisonDart" },
  { wave: 6, id: "frostBall" },
];

export function pveEliteSpellPool(waveIndex: number): string[] {
  return PVE_ELITE_SPELL_UNLOCKS.filter((s) => waveIndex >= s.wave).map((s) => s.id);
}

/** How many fodder slots become elites this wave. */
export function pveEliteCount(waveIndex: number, partySize = 1): number {
  if (waveIndex < 2) return 0;
  const n = clampPvePartySize(partySize);
  if (waveIndex < 4) return 1;
  if (waveIndex < 7) return n >= 3 ? 2 : 1;
  if (waveIndex < 10) return n >= 3 ? 3 : 2;
  return Math.min(4, 2 + Math.floor((waveIndex - 10) / 3) + (n >= 3 ? 1 : 0));
}

/** Signature first; later waves add Bolt as a close-range filler. */
export function pveEliteKit(waveIndex: number, spawnOrdinal: number): string[] {
  const pool = pveEliteSpellPool(waveIndex);
  if (!pool.length) return ["bolt"];
  const signature = pool[spawnOrdinal % pool.length]!;
  const kit = [signature];
  if (waveIndex >= 8 && signature !== "bolt" && pool.includes("bolt")) {
    kit.push("bolt");
  }
  return kit;
}

/** Faster than players, but Bolt never dumps every 300ms. Tightens slightly each wave. */
export function pveEliteCooldownMs(abilityId: string, waveIndex: number): number {
  const def = ABILITIES[abilityId];
  const raw = def?.cooldownMs ?? 4000;
  const waveMul = Math.max(0.42, 0.62 - Math.max(0, waveIndex - 2) * 0.015);
  return Math.max(1400, Math.round(raw * waveMul));
}

export function pveEliteComfortRange(abilityId: string): {
  min: number;
  max: number;
  maxCast: number;
} {
  const range = ABILITIES[abilityId]?.range ?? 12;
  return {
    min: Math.min(4.2, range * 0.38),
    max: range * 0.78,
    maxCast: range * 0.92,
  };
}

export function pveElitePickAbility(kit: readonly string[], dist: number): string {
  if (kit.length > 1 && dist < 6.2) {
    const bolt = kit.find((id) => id === "bolt");
    if (bolt) return bolt;
  }
  return kit[0] ?? "bolt";
}

/**
 * Direct-hit scaling vs wave melee. `undefined` = keep authored (Frost Ball ticks).
 */
export function pveEliteProjectileDamage(
  abilityId: string,
  waveDamage: number,
): number | undefined {
  if (abilityId === "frostBall") return undefined;
  if (abilityId === "poisonDart") return Math.max(8, Math.round(waveDamage * 0.4));
  if (abilityId === "bolt") return Math.round(waveDamage * 0.72);
  if (abilityId === "iceLance") return Math.round(waveDamage * 0.88);
  return Math.round(waveDamage * 0.75);
}

export const PVE_ELITE_HP_MUL = 1.55;
export const PVE_ELITE_SPEED_MUL = 0.78;
export const PVE_ELITE_SCALE = 1.14;
