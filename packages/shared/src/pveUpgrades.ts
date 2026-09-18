/** Roguelike Wave Assault upgrades — overlay on CombatSessionKit, not talents. */

import type { CombatSessionKit } from "./talentKit";

/** Draft every N mobs slain. Waves still roll on their own clock. */
export const PVE_UPGRADE_EVERY_KILLS = 10;
export const PVE_UPGRADE_OFFER_COUNT = 3;
export const PVE_MOVE_SPEED_CAP = 1.45;
export const PVE_COOLDOWN_FLOOR = 0.65;

export const PVE_UPGRADE_RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;
export type PveUpgradeRarity = (typeof PVE_UPGRADE_RARITIES)[number];

export const PVE_UPGRADE_STATS = [
  "move",
  "hp",
  "dmg",
  "critChance",
  "critDmg",
  "cooldown",
  "range",
  "aoe",
  "regen",
  "lifesteal",
] as const;
export type PveUpgradeStat = (typeof PVE_UPGRADE_STATS)[number];

export type PveUpgradeDef = {
  id: string;
  stat: PveUpgradeStat;
  rarity: PveUpgradeRarity;
  /** Meaning depends on stat — see applyPveUpgradeOverlay. */
  magnitude: number;
  label: string;
  hint: string;
};

export type PveUpgradeOffer = PveUpgradeDef & {
  offerId: string;
};

const RARITY_WEIGHT: Record<PveUpgradeRarity, number> = {
  common: 50,
  uncommon: 28,
  rare: 14,
  epic: 6,
  legendary: 2,
};

/** Magnitudes by rarity index (common → legendary). */
const STAT_MAG: Record<PveUpgradeStat, readonly number[]> = {
  move: [0.04, 0.06, 0.09, 0.12, 0.16],
  hp: [40, 70, 110, 160, 240],
  dmg: [0.06, 0.09, 0.13, 0.18, 0.25],
  critChance: [0.03, 0.05, 0.07, 0.1, 0.14],
  critDmg: [0.08, 0.12, 0.18, 0.25, 0.35],
  cooldown: [0.06, 0.09, 0.12, 0.16, 0.22],
  range: [0.06, 0.09, 0.13, 0.18, 0.25],
  aoe: [0.08, 0.12, 0.16, 0.22, 0.3],
  regen: [0.004, 0.006, 0.009, 0.013, 0.02],
  lifesteal: [0.03, 0.05, 0.07, 0.1, 0.14],
};

const STAT_LABEL: Record<PveUpgradeStat, string> = {
  move: "Swift Feet",
  hp: "Iron Hide",
  dmg: "Sharpened Edge",
  critChance: "Keen Eye",
  critDmg: "Brutal Crits",
  cooldown: "Quick Hands",
  range: "Long Arm",
  aoe: "Widened Force",
  regen: "Second Wind",
  lifesteal: "Blood Drink",
};

function formatPct(n: number): string {
  const pct = n * 100;
  const rounded = Math.abs(pct - Math.round(pct)) < 0.05 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded}%`;
}

function hintFor(stat: PveUpgradeStat, mag: number): string {
  switch (stat) {
    case "move":
      return `+${formatPct(mag)} move speed`;
    case "hp":
      return `+${Math.round(mag)} max HP`;
    case "dmg":
      return `+${formatPct(mag)} damage`;
    case "critChance":
      return `+${formatPct(mag)} crit chance`;
    case "critDmg":
      return `+${formatPct(mag)} crit damage`;
    case "cooldown":
      return `-${formatPct(mag)} cooldowns`;
    case "range":
      return `+${formatPct(mag)} spell range`;
    case "aoe":
      return `+${formatPct(mag)} area`;
    case "regen":
      return `+${formatPct(mag)} max HP / sec`;
    case "lifesteal":
      return `${formatPct(mag)} of damage dealt as heal`;
  }
}

function rarityIndex(rarity: PveUpgradeRarity): number {
  return PVE_UPGRADE_RARITIES.indexOf(rarity);
}

export const PVE_UPGRADE_CATALOG: readonly PveUpgradeDef[] = PVE_UPGRADE_STATS.flatMap((stat) =>
  PVE_UPGRADE_RARITIES.map((rarity) => {
    const mag = STAT_MAG[stat][rarityIndex(rarity)]!;
    return {
      id: `${stat}_${rarity}`,
      stat,
      rarity,
      magnitude: mag,
      label: STAT_LABEL[stat],
      hint: hintFor(stat, mag),
    };
  }),
);

const BY_ID = new Map(PVE_UPGRADE_CATALOG.map((d) => [d.id, d]));

export function pveUpgradeById(id: string): PveUpgradeDef | undefined {
  return BY_ID.get(id);
}

export function pveUpgradeDraftDue(kills: number): boolean {
  return kills > 0 && kills % PVE_UPGRADE_EVERY_KILLS === 0;
}

export function pveUpgradeDraftBeat(kills: number): number {
  return Math.max(1, Math.floor(kills / PVE_UPGRADE_EVERY_KILLS));
}

/** Later drafts slightly luckier — bump rare+ weights. */
export function pveRarityWeights(draftBeat: number): Record<PveUpgradeRarity, number> {
  const luck = 1 + Math.max(0, draftBeat - 1) * 0.08;
  return {
    common: RARITY_WEIGHT.common,
    uncommon: RARITY_WEIGHT.uncommon,
    rare: RARITY_WEIGHT.rare * luck,
    epic: RARITY_WEIGHT.epic * luck,
    legendary: RARITY_WEIGHT.legendary * luck,
  };
}

function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, rng: () => number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  let roll = rng() * Math.max(1e-6, total);
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1]!;
}

/**
 * Roll 3 unique stats (rarities independent). Same stat will not appear twice
 * in one hand; rarities follow the draft-beat weights.
 */
export function rollPveUpgradeOffers(
  draftBeat: number,
  rng: () => number = Math.random,
): PveUpgradeOffer[] {
  const weights = pveRarityWeights(draftBeat);
  const used = new Set<PveUpgradeStat>();
  const offers: PveUpgradeOffer[] = [];
  for (let i = 0; i < PVE_UPGRADE_OFFER_COUNT; i++) {
    const stats = PVE_UPGRADE_STATS.filter((s) => !used.has(s));
    const pool = stats.length > 0 ? stats : [...PVE_UPGRADE_STATS];
    const stat = pool[Math.floor(rng() * pool.length)]!;
    used.add(stat);
    const rarity = pickWeighted(PVE_UPGRADE_RARITIES, (r) => weights[r], rng);
    const def = pveUpgradeById(`${stat}_${rarity}`)!;
    offers.push({ ...def, offerId: `${def.id}_${i}_${Math.floor(rng() * 1e9).toString(36)}` });
  }
  return offers;
}

function cooldownMulFromStacks(mags: readonly number[]): number {
  let reduction = 0;
  for (const mag of mags) {
    reduction += mag * Math.max(0.25, 1 - reduction);
  }
  return Math.max(PVE_COOLDOWN_FLOOR, 1 - reduction);
}

/** Bake run picks onto a freshly resolved talent kit. Mutates `kit`. */
export function applyPveUpgradeOverlay(
  kit: CombatSessionKit,
  picks: readonly PveUpgradeDef[],
): CombatSessionKit {
  const cdMags: number[] = [];
  for (const pick of picks) {
    switch (pick.stat) {
      case "move":
        kit.moveSpeedMul = Math.min(PVE_MOVE_SPEED_CAP, kit.moveSpeedMul * (1 + pick.magnitude));
        break;
      case "hp":
        kit.maxHpBonus += Math.round(pick.magnitude);
        break;
      case "dmg":
        kit.damageDealtMul *= 1 + pick.magnitude;
        break;
      case "critChance":
        kit.critChance = Math.min(1, kit.critChance + pick.magnitude);
        break;
      case "critDmg":
        kit.critDamageBonus += pick.magnitude;
        break;
      case "cooldown":
        cdMags.push(pick.magnitude);
        break;
      case "range":
        kit.rangeMul *= 1 + pick.magnitude;
        break;
      case "aoe":
        kit.aoeMul *= 1 + pick.magnitude;
        break;
      case "regen":
        kit.regenPerSec += pick.magnitude;
        break;
      case "lifesteal":
        kit.lifesteal += pick.magnitude;
        break;
    }
  }
  kit.cooldownMul = cooldownMulFromStacks(cdMags);
  if (kit.cooldownMul < 0.999) {
    for (const [id, mul] of kit.cooldownMulByAbility) {
      kit.cooldownMulByAbility.set(id, mul * kit.cooldownMul);
    }
  }
  return kit;
}

export const PVE_RARITY_COLOR: Record<PveUpgradeRarity, string> = {
  common: "#a8a29e",
  uncommon: "#4ade80",
  rare: "#60a5fa",
  epic: "#c084fc",
  legendary: "#fbbf24",
};

export const PVE_RARITY_LABEL: Record<PveUpgradeRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};
