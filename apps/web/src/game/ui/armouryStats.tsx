import type { AbilityDef, SpellTag } from "@battlebeasts/shared";
import { GameIcon } from "./GameIcon";
import type { GameIconId } from "./gameIcons";

export type ArmouryStatKind = "cd" | "power" | "range";

export type ArmouryStat = {
  kind: ArmouryStatKind;
  value: string;
  title: string;
};

const STAT_ICON: Record<ArmouryStatKind, GameIconId> = {
  cd: "hourglass",
  power: "star-struck",
  range: "archery-target",
};

function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (Number.isInteger(s)) return `${s}s`;
  return `${parseFloat(s.toFixed(2))}s`;
}

/** Up to three highlight stats for armoury cards (icon + value). */
export function getArmouryHighlightStats(def: AbilityDef): ArmouryStat[] {
  const stats: ArmouryStat[] = [
    { kind: "cd", value: formatSeconds(def.cooldownMs), title: "Cooldown" },
  ];

  let power: string | null = null;
  if (def.aura && def.damage > 0 && def.tickMs) {
    power = `${def.damage}/${formatSeconds(def.tickMs)}`;
  } else if (def.combo?.damageByHit?.length) {
    power = def.combo.damageByHit.join("/");
  } else if (def.combo && def.damage > 0) {
    power = `${def.damage}×${def.combo.hits}`;
  } else if (def.heal != null && def.heal > 0) {
    const ticks = def.healTicks ?? 1;
    power = ticks > 1 ? `${def.heal}×${ticks}` : String(def.heal);
  } else if (def.damage > 0) {
    power = String(def.damage);
  }
  if (power) {
    stats.push({ kind: "power", value: power, title: "Power" });
  }

  let range: string | null = null;
  if (def.radius != null && def.radius > 0 && !def.detonate) {
    range = String(def.radius);
  } else if (def.range > 0) {
    range = String(def.range);
  } else if (def.travel?.distance) {
    range = String(def.travel.distance);
  }
  if (range) {
    stats.push({ kind: "range", value: range, title: "Range" });
  }

  return stats.slice(0, 3);
}

const TAG_LABEL: Partial<Record<SpellTag, string>> = {
  Area: "AOE",
  DamageOverTime: "Over-time",
  SingleTarget: "Single",
  MultiHit: "Multi-hit",
  GroundEffect: "Ground",
  CrowdControl: "CC",
};

export function formatSpellTag(tag: SpellTag | string): string {
  return TAG_LABEL[tag as SpellTag] ?? tag;
}

export function ArmouryStatRow({ stats }: { stats: ArmouryStat[] }) {
  return (
    <div className="bb-armoury-stats" aria-label="Spell stats">
      {stats.map((s) => (
        <span key={s.kind} className="bb-armoury-stat" title={s.title}>
          <GameIcon id={STAT_ICON[s.kind]} size={13} gray={0.85} />
          <span>{s.value}</span>
        </span>
      ))}
    </div>
  );
}
