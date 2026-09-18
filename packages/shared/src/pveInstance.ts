/**
 * Authored dungeon instance (PveContentId `instance`) — party scaling,
 * chest rarity by run depth, and map-element readers.
 */

import { COLLISION } from "./collision";
import {
  COOP_INSTANCE_MAX_PLAYERS,
  COOP_INSTANCE_MIN_PLAYERS,
} from "./content";
import type { MapElement } from "./maps/elements";
import { paramNumber, paramString } from "./maps/elements";
import { isPveWaveMobKind } from "./pveWave";
import {
  ANY_CHEST_WEIGHTS,
  type ChestQuality,
} from "./rewards";

export const PVE_BOSS_KIND = "boss";

export function isPveInstanceMobKind(kind: string | undefined | null): boolean {
  return isPveWaveMobKind(kind) || kind === PVE_BOSS_KIND;
}

export function clampInstancePartySize(n: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return COOP_INSTANCE_MIN_PLAYERS;
  return Math.max(
    COOP_INSTANCE_MIN_PLAYERS,
    Math.min(COOP_INSTANCE_MAX_PLAYERS, v),
  );
}

/** HP multiplier by party size: 1.0 / 1.3 / 1.6 / 1.9 / 2.2 */
export function instancePartyHpMul(partySize: number): number {
  return 0.7 + 0.3 * clampInstancePartySize(partySize);
}

/** Damage multiplier by party size: 1.0 / 1.25 / 1.5 / 1.75 / 2.0 */
export function instancePartyDamageMul(partySize: number): number {
  return 0.75 + 0.25 * clampInstancePartySize(partySize);
}

export function instanceStageHpMul(stage: number): number {
  const s = Math.max(1, Math.min(5, Math.floor(Number(stage) || 1)));
  return 1 + (s - 1) * 0.16;
}

export function instanceStageDamageMul(stage: number): number {
  const s = Math.max(1, Math.min(5, Math.floor(Number(stage) || 1)));
  return 1 + (s - 1) * 0.12;
}

/** Extra fodder bodies on a required pack (elites stay authored). */
export function instanceExtraFodder(partySize: number): number {
  return Math.max(0, clampInstancePartySize(partySize) - 1);
}

export const DUNGEON_POOLS = ["required", "optional"] as const;
export type DungeonPool = (typeof DUNGEON_POOLS)[number];

export const DUNGEON_AURAS = ["infernal", "plague", "frost", "void"] as const;
export type DungeonBossAura = (typeof DUNGEON_AURAS)[number];

export const DUNGEON_SPELL_IDS = [
  "iceLance",
  "poisonDart",
  "frostBall",
  "grasp",
  "prismLance",
] as const;
export type DungeonSpellId = (typeof DUNGEON_SPELL_IDS)[number];

export const DUNGEON_OBJECTIVE_TAGS = ["hold", "survive"] as const;
export type DungeonObjectiveTag = (typeof DUNGEON_OBJECTIVE_TAGS)[number];

export const DUNGEON_BOSS_SCALE_MIN = 1.8;
export const DUNGEON_BOSS_SCALE_MAX = 2.4;
export const DUNGEON_BOSS_SCALE_DEFAULT = 2.0;
export const DUNGEON_BOSS_HP_DEFAULT = 2800;
export const DUNGEON_PACK_COUNT_DEFAULT = 4;
export const DUNGEON_PACK_ELITES_DEFAULT = 0;
export const DUNGEON_AGGRO_DEFAULT = 10;
export const DUNGEON_HOLD_MS_DEFAULT = 8000;
export const DUNGEON_SURVIVE_MS_DEFAULT = 12000;
export const DUNGEON_BOSS_ENRAGE_HP = 0.3;
export const DUNGEON_BOSS_ENRAGE_CD_MUL = 0.55;

export const DUNGEON_AURA_TINT: Record<DungeonBossAura, { body: string; glow: string }> = {
  infernal: { body: "#7f1d1d", glow: "#f97316" },
  plague: { body: "#14532d", glow: "#4ade80" },
  frost: { body: "#0e7490", glow: "#67e8f9" },
  void: { body: "#2e1065", glow: "#c084fc" },
};

export function dungeonAuraTint(aura: string | undefined | null): {
  body: string;
  glow: string;
} {
  if (aura && aura in DUNGEON_AURA_TINT) {
    return DUNGEON_AURA_TINT[aura as DungeonBossAura];
  }
  return DUNGEON_AURA_TINT.infernal;
}

export type DungeonRunChestDepth = "none" | "packs" | "optional" | "boss";

/**
 * Checkpoint-shifted weights (sum 100). Start from ANY_CHEST_WEIGHTS, then
 * move ~20 points toward rarer qualities per checkpoint.
 */
export const DUNGEON_RUN_CHEST_WEIGHTS: Record<
  Exclude<DungeonRunChestDepth, "none">,
  readonly { quality: ChestQuality; weight: number }[]
> = {
  packs: ANY_CHEST_WEIGHTS,
  optional: [
    { quality: "legendary", weight: 5 },
    { quality: "purple", weight: 25 },
    { quality: "blue", weight: 35 },
    { quality: "green", weight: 35 },
  ],
  boss: [
    { quality: "legendary", weight: 20 },
    { quality: "purple", weight: 35 },
    { quality: "blue", weight: 25 },
    { quality: "green", weight: 20 },
  ],
};

export function dungeonRunChestDepth(opts: {
  packCleared: boolean;
  optionalDone: boolean;
  bossKilled: boolean;
}): DungeonRunChestDepth {
  if (opts.bossKilled) return "boss";
  if (opts.optionalDone) return "optional";
  if (opts.packCleared) return "packs";
  return "none";
}

export function dungeonRunChestSource(matchId: string, rematchIndex = 0): string {
  return `dungeon_run:${matchId}:r${Math.max(0, Math.floor(rematchIndex))}`;
}

export function rollDungeonRunChestQuality(
  depth: DungeonRunChestDepth,
  salt: number,
): ChestQuality | null {
  if (depth === "none") return null;
  const weights = DUNGEON_RUN_CHEST_WEIGHTS[depth];
  const total = weights.reduce((s, e) => s + e.weight, 0);
  let t = Math.abs(salt) % Math.max(1, total);
  for (const entry of weights) {
    t -= entry.weight;
    if (t < 0) return entry.quality;
  }
  return weights[weights.length - 1]!.quality;
}

export function dungeonElementPool(el: MapElement): DungeonPool {
  const v = paramString(el, "pool", "required");
  return v === "optional" ? "optional" : "required";
}

export function dungeonPackCount(el: MapElement): number {
  return Math.max(1, Math.min(12, Math.floor(paramNumber(el, "count", DUNGEON_PACK_COUNT_DEFAULT))));
}

export function dungeonPackElites(el: MapElement): number {
  return Math.max(0, Math.min(4, Math.floor(paramNumber(el, "elites", DUNGEON_PACK_ELITES_DEFAULT))));
}

export function dungeonElementStage(el: MapElement): number {
  return Math.max(1, Math.min(5, Math.floor(paramNumber(el, "stage", 1))));
}

export function dungeonAggroRadius(el: MapElement): number {
  return Math.max(0, paramNumber(el, "aggroRadius", DUNGEON_AGGRO_DEFAULT));
}

export function dungeonRoamRadius(el: MapElement): number {
  return Math.max(0, paramNumber(el, "roamRadius", 0));
}

export function dungeonBossName(el: MapElement): string {
  return paramString(el, "name", "Dungeon Boss") || "Dungeon Boss";
}

export function dungeonBossHp(el: MapElement): number {
  const hp = paramNumber(el, "hp", DUNGEON_BOSS_HP_DEFAULT);
  return Math.max(200, Math.min(20000, Math.floor(hp || DUNGEON_BOSS_HP_DEFAULT)));
}

export function dungeonBossScale(el: MapElement): number {
  const s = paramNumber(el, "scale", DUNGEON_BOSS_SCALE_DEFAULT);
  if (!Number.isFinite(s) || s <= 0) return DUNGEON_BOSS_SCALE_DEFAULT;
  return Math.max(DUNGEON_BOSS_SCALE_MIN, Math.min(DUNGEON_BOSS_SCALE_MAX, s));
}

export function dungeonBossAura(el: MapElement): DungeonBossAura {
  const v = paramString(el, "aura", "infernal");
  return (DUNGEON_AURAS as readonly string[]).includes(v) ? (v as DungeonBossAura) : "infernal";
}

export function dungeonBossKit(el: MapElement): string[] {
  const kit: string[] = [];
  for (const key of ["spell1", "spell2", "spell3", "spell4"] as const) {
    const v = paramString(el, key, "");
    if ((DUNGEON_SPELL_IDS as readonly string[]).includes(v) && !kit.includes(v)) {
      kit.push(v);
    }
  }
  return kit.length > 0 ? kit : ["iceLance", "poisonDart"];
}

export function dungeonObjectiveTag(el: MapElement): DungeonObjectiveTag {
  const v = paramString(el, "tag", "hold");
  return v === "survive" ? "survive" : "hold";
}

export function dungeonObjectiveDurationMs(el: MapElement): number {
  const tag = dungeonObjectiveTag(el);
  const fallback = tag === "survive" ? DUNGEON_SURVIVE_MS_DEFAULT : DUNGEON_HOLD_MS_DEFAULT;
  return Math.max(2000, Math.min(60000, Math.floor(paramNumber(el, "durationMs", fallback) || fallback)));
}

export function dungeonCircleRadius(el: MapElement, fallback = 4): number {
  if (el.shape?.kind === "circle" && el.shape.radius > 0) return el.shape.radius;
  return fallback;
}

export function dungeonBossHitRadius(scale: number): number {
  return COLLISION.dummyRadius * Math.max(1, scale);
}

export function dungeonExitInteractId(elementId: string): string {
  return `dungeon_exit:${elementId}`;
}

export function dungeonExitElementIdFrom(interactId: string): string | null {
  if (interactId === "dungeon_exit") return "";
  if (!interactId.startsWith("dungeon_exit:")) return null;
  return interactId.slice("dungeon_exit:".length) || "";
}

const DUNGEON_STAGGER_M = 1.75;

export function dungeonStartPose(
  pads: ReadonlyArray<{ x: number; z: number; yaw: number }>,
  slot: number,
  startIndex = 0,
): { x: number; z: number; yaw: number } {
  const home = pads.length
    ? pads[((startIndex % pads.length) + pads.length) % pads.length]!
    : { x: 0, z: 0, yaw: 0 };
  const s = Math.max(0, Math.floor(slot));
  if (s === 0) return home;
  const angle = ((s - 1) / Math.max(4, s)) * Math.PI * 2;
  return {
    x: home.x + Math.sin(angle) * DUNGEON_STAGGER_M,
    z: home.z + Math.cos(angle) * DUNGEON_STAGGER_M,
    yaw: home.yaw,
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
