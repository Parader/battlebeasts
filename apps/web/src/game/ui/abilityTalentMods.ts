import { resolveKit, type AbilityDef } from "@battlebeasts/shared";

type Kit = ReturnType<typeof resolveKit>;

/** Talent-driven lines for spell tooltips (ability bar + armoury). */
export function talentModLines(ability: AbilityDef, kit: Kit): string[] {
  const lines: string[] = [];
  const mul = kit.cooldownMulByAbility.get(ability.id) ?? 1;
  if (mul < 0.999) {
    lines.push(`Talent CD ×${mul.toFixed(2)}`);
  }
  if (ability.damage > 0 && kit.critChance > 0.051) {
    lines.push(`Crit chance ${Math.round(kit.critChance * 100)}%`);
  }
  if (ability.damage > 0 && kit.critDamageBonus > 0) {
    lines.push(`Crit dmg +${Math.round(kit.critDamageBonus * 100)}%`);
  }
  if (
    kit.secondaryEffectMul > 1.001 &&
    (ability.applyOnHit?.length || ability.tags?.includes("DamageOverTime"))
  ) {
    lines.push(`Secondary ×${kit.secondaryEffectMul.toFixed(2)}`);
  }
  if (ability.damage > 0 && kit.openingSalvoDmgBonus > 0) {
    lines.push(`Opening Salvo +${Math.round(kit.openingSalvoDmgBonus * 100)}%`);
  }
  if (ability.damage > 0 && kit.fifthSpellDmgBonus > 0) {
    lines.push(`5th spell +${Math.round(kit.fifthSpellDmgBonus * 100)}%`);
  }
  if (
    kit.elementalAoeRadiusMul > 1.001 &&
    ability.tags?.some((t) => t === "Area" || t === "Nova" || t === "Cone" || t === "Explosion")
  ) {
    lines.push(`AoE ×${kit.elementalAoeRadiusMul.toFixed(2)}`);
  }
  if (ability.damage > 0 && kit.opportunistDmgBonus > 0) {
    lines.push(`Opportunist +${Math.round(kit.opportunistDmgBonus * 100)}%`);
  }
  if ((ability.heal ?? 0) > 0 && kit.overflowConvertFrac > 0) {
    lines.push(`Overflow ${Math.round(kit.overflowConvertFrac * 100)}%`);
  }
  return lines;
}
