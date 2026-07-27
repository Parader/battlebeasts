import type { SpellTag } from "@battlebeasts/shared";
import { GameIcon } from "./GameIcon";
import type { GameIconId } from "./gameIcons";

/** Preferred tag when a talent lists several — more specific natures first. */
const NATURE_PRIORITY: readonly SpellTag[] = [
  "Projectile",
  "Explosion",
  "Healing",
  "HealOverTime",
  "Shield",
  "DamageOverTime",
  "CrowdControl",
  "Stun",
  "Root",
  "Silence",
  "Fear",
  "Slow",
  "Knockback",
  "Pull",
  "Knockup",
  "Movement",
  "Haste",
  "Cooldown",
  "Cast",
  "Channel",
  "Combo",
  "MultiHit",
  "SingleTarget",
  "Area",
  "GroundEffect",
  "Barrier",
  "Wall",
  "Obstacle",
  "Summon",
  "Buff",
  "Debuff",
  "Defense",
  "Defensive",
  "Cleanse",
  "Purge",
  "Interrupt",
  "Reveal",
  "Stealth",
  "Resource",
  "SpellSlot",
  "Persistent",
  "Damage",
  "Self",
  "Ally",
] as const;

const TAG_ICONS: Partial<Record<SpellTag, GameIconId>> = {
  Projectile: "crosshair",
  Explosion: "explosion-rays",
  Area: "vortex",
  Nova: "explosion-rays",
  Cone: "flame",
  Line: "bolt-spell-cast",
  Melee: "crossed-swords",
  Dash: "sprint",
  Blink: "portal",
  Channel: "magic-swirl",
  Instant: "power-lightning",
  Cast: "spell-book",
  Damage: "sword-brandish",
  Healing: "heart-plus",
  HealOverTime: "healing",
  Shield: "shield",
  Self: "aura",
  Ally: "heart-plus",
  SingleTarget: "archery-target",
  MultiHit: "crossed-swords",
  DamageOverTime: "poison-bottle",
  Debuff: "blood",
  Control: "crossed-chains",
  CrowdControl: "crossed-chains",
  Stun: "knockout",
  Root: "tree-roots",
  Silence: "silence",
  Fear: "hidden",
  Slow: "frozen-orb",
  Knockback: "whirlwind",
  Pull: "vortex",
  Knockup: "wingfoot",
  Movement: "sprint",
  Haste: "wingfoot",
  Defense: "shield",
  Defensive: "shield",
  Barrier: "shield-reflect",
  Summon: "magic-swirl",
  Obstacle: "brick-wall",
  Wall: "stone-wall",
  GroundEffect: "water-drop",
  Combo: "crossed-swords",
  Cooldown: "hourglass",
  Utility: "wizard-staff",
  Stealth: "cloak-dagger",
  Reveal: "radar-sweep",
  Counter: "shield-reflect",
  Reflect: "shield-reflect",
  Pierce: "sword-brandish",
  Homing: "crosshair",
  Chain: "crossed-chains",
  Trap: "cluster-bomb",
  Persistent: "stopwatch",
  Buff: "aura",
  Cleanse: "water-drop",
  Purge: "flame",
  Interrupt: "mute",
  Resource: "drop",
  SpellSlot: "spell-book",
};

export function primaryTalentNatureTag(
  tags: readonly SpellTag[] | undefined,
): SpellTag | undefined {
  if (!tags?.length) return undefined;
  for (const p of NATURE_PRIORITY) {
    if (tags.includes(p)) return p;
  }
  return tags[0];
}

export function talentNatureIconId(tags: readonly SpellTag[] | undefined): GameIconId {
  const tag = primaryTalentNatureTag(tags);
  return (tag && TAG_ICONS[tag]) || "magic-swirl";
}

export function TalentNatureIcon({
  tags,
  size = 22,
  className,
  title,
  gray = 0.88,
}: {
  tags: readonly SpellTag[] | undefined;
  size?: number;
  className?: string;
  /** Accessible label; defaults to primary tag name. */
  title?: string;
  gray?: number;
}) {
  const tag = primaryTalentNatureTag(tags);
  const id = talentNatureIconId(tags);
  return (
    <GameIcon
      id={id}
      size={size}
      gray={gray}
      className={className}
      title={title ?? tag ?? "Talent"}
    />
  );
}
