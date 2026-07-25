import type { ComponentType, SVGProps } from "react";
import type { SpellTag } from "@battlebeasts/shared";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowRight,
  Clock,
  Cube01,
  Drop,
  Eye,
  Hand,
  Heart,
  Lightning01,
  MagicWand01,
  RefreshCcw01,
  Shield01,
  SlashCircle01,
  Snowflake01,
  Target04,
  User01,
  Users01,
  Zap,
  ZapFast,
} from "@untitledui/icons";

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

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

const TAG_ICONS: Partial<Record<SpellTag, IconComp>> = {
  Projectile: Target04,
  Explosion: Lightning01,
  Area: SlashCircle01,
  Nova: Lightning01,
  Cone: Drop,
  Line: ArrowRight,
  Melee: SlashCircle01,
  Dash: ZapFast,
  Blink: Zap,
  Channel: RefreshCcw01,
  Instant: Zap,
  Cast: MagicWand01,
  Damage: Lightning01,
  Healing: Heart,
  HealOverTime: Heart,
  Shield: Shield01,
  Self: User01,
  Ally: Users01,
  SingleTarget: Target04,
  MultiHit: RefreshCcw01,
  DamageOverTime: Drop,
  Debuff: Eye,
  Control: Hand,
  CrowdControl: AlertOctagon,
  Stun: AlertOctagon,
  Root: Snowflake01,
  Silence: SlashCircle01,
  Fear: Eye,
  Slow: Clock,
  Knockback: ArrowCircleUp,
  Pull: ArrowCircleDown,
  Knockup: ArrowCircleUp,
  Movement: ZapFast,
  Haste: Zap,
  Defense: Shield01,
  Defensive: Shield01,
  Barrier: Shield01,
  Summon: Cube01,
  Obstacle: Cube01,
  Wall: Cube01,
  GroundEffect: Drop,
  Combo: RefreshCcw01,
  Cooldown: Clock,
  Utility: MagicWand01,
  Stealth: Eye,
  Reveal: Eye,
  Counter: Shield01,
  Reflect: RefreshCcw01,
  Pierce: ArrowRight,
  Homing: Target04,
  Chain: RefreshCcw01,
  Trap: AlertTriangle,
  Persistent: Clock,
  Buff: Zap,
  Cleanse: Drop,
  Purge: Drop,
  Interrupt: SlashCircle01,
  Resource: Drop,
  SpellSlot: MagicWand01,
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

export function TalentNatureIcon({
  tags,
  size = 22,
  className,
  title,
}: {
  tags: readonly SpellTag[] | undefined;
  size?: number;
  className?: string;
  /** Accessible label; defaults to primary tag name. */
  title?: string;
}) {
  const tag = primaryTalentNatureTag(tags);
  const Icon = (tag && TAG_ICONS[tag]) || MagicWand01;
  const label = title ?? tag ?? "Talent";
  return (
    <Icon
      className={className}
      width={size}
      height={size}
      size={size}
      aria-hidden={title ? undefined : true}
      aria-label={title ? label : undefined}
    />
  );
}
