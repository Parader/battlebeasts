import { ABILITIES } from "./abilities";
import { clampPvePartySize } from "./pveWave";

/** Distinctive body tints keyed by signature spell. */
export const PVE_ELITE_TINT: Record<string, string> = {
  iceLance: "#7dd3fc",
  frostBall: "#38bdf8",
  poisonDart: "#4ade80",
  grasp: "#7c3aed",
  prismLance: "#c4b5fd",
};

export const PVE_ELITE_TINT_DEFAULT = "#f59e0b";

export function pveEliteTint(abilityId: string | undefined | null): string {
  if (!abilityId) return PVE_ELITE_TINT_DEFAULT;
  return PVE_ELITE_TINT[abilityId] ?? PVE_ELITE_TINT_DEFAULT;
}

/**
 * Projectile spells elites may learn. Channels, dashes, and ground plants stay
 * off this list — NPC fire goes through `fireProjectileFrom`.
 * Skip Bolt: it is an M1 poke and the old kit preferred it whenever anyone
 * was close, so elites just spammed LMB.
 */
export const PVE_ELITE_SPELL_UNLOCKS: ReadonlyArray<{ wave: number; id: string }> = [
  { wave: 2, id: "iceLance" },
  { wave: 2, id: "poisonDart" },
  { wave: 3, id: "frostBall" },
  { wave: 4, id: "grasp" },
  { wave: 5, id: "prismLance" },
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

/** Signature plus 1–2 other unlocked spells so each elite rotates a kit. */
export function pveEliteKit(waveIndex: number, spawnOrdinal: number): string[] {
  const pool = pveEliteSpellPool(waveIndex);
  if (!pool.length) return ["iceLance", "poisonDart"];
  const signature = pool[spawnOrdinal % pool.length]!;
  const kit: string[] = [signature];
  const others = pool.filter((id) => id !== signature);
  const extraCount = waveIndex >= 6 ? 2 : 1;
  for (let n = 0; n < extraCount && others.length > 0; n++) {
    kit.push(others[(spawnOrdinal + n) % others.length]!);
  }
  return kit;
}

/** Keep a floor so even short-CD spells cannot dump every GCD. */
export function pveEliteCooldownMs(abilityId: string, waveIndex: number): number {
  const def = ABILITIES[abilityId];
  const raw = def?.cooldownMs ?? 4000;
  const waveMul = Math.max(0.5, 0.7 - Math.max(0, waveIndex - 2) * 0.012);
  const m1Only =
    Boolean(def?.allowedSlots?.includes("m1")) && !def?.allowedSlots?.includes("m2");
  const floor = m1Only ? 2400 : 1800;
  return Math.max(floor, Math.round(raw * waveMul));
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

export function pveElitePickAbility(
  kit: readonly string[],
  dist: number,
  opts?: { readyIds?: ReadonlySet<string>; lastId?: string | null },
): string {
  const ready = opts?.readyIds
    ? kit.filter((id) => opts.readyIds!.has(id))
    : [...kit];
  const candidates = ready.length > 0 ? ready : [...kit];
  let best = candidates[0] ?? "iceLance";
  let bestScore = -Infinity;
  for (const id of candidates) {
    const c = pveEliteComfortRange(id);
    let score = 0;
    if (dist >= c.min && dist <= c.maxCast) score += 4;
    else if (dist <= c.maxCast * 1.2) score += 2;
    else score -= Math.abs(dist - (c.min + c.max) * 0.5) * 0.08;
    if (id === opts?.lastId) score -= 2.4;
    const slots = ABILITIES[id]?.allowedSlots ?? [];
    if (slots.includes("m1") && !slots.includes("m2")) score -= 0.8;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
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
  if (abilityId === "grasp") return Math.max(8, Math.round(waveDamage * 0.45));
  if (abilityId === "iceLance") return Math.round(waveDamage * 0.88);
  if (abilityId === "prismLance") return Math.round(waveDamage * 0.82);
  return Math.round(waveDamage * 0.75);
}

export const PVE_ELITE_HP_MUL = 1.55;
export const PVE_ELITE_SPEED_MUL = 0.78;
export const PVE_ELITE_SCALE = 1.14;
