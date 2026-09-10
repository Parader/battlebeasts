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
  if (
    kit.controlAoeRadiusMul > 1.001 &&
    ability.tags?.some((t) => t === "Control" || t === "CrowdControl") &&
    ability.tags?.some((t) => t === "Area" || t === "Nova" || t === "Cone" || t === "Explosion")
  ) {
    lines.push(`Control AoE ×${kit.controlAoeRadiusMul.toFixed(2)}`);
  }
  if (
    kit.controlRangeMul > 1.001 &&
    ability.tags?.some((t) => t === "Control" || t === "CrowdControl") &&
    ability.range > 0
  ) {
    lines.push(`Control range ×${kit.controlRangeMul.toFixed(2)}`);
  }
  if (kit.displacementMul > 1.001 && ability.tags?.some((t) => t === "Knockback" || t === "Pull")) {
    lines.push(`Displace ×${kit.displacementMul.toFixed(2)}`);
  }
  if (kit.extendedReachMul > 1.001 && ability.tags?.includes("Movement")) {
    lines.push(`Travel ×${kit.extendedReachMul.toFixed(2)}`);
  }
  if ((ability.heal ?? 0) > 0 && (kit.restorativeTouchMul ?? 1) > 1.001) {
    lines.push(`Direct heals ×${kit.restorativeTouchMul.toFixed(2)}`);
  }
  if ((ability.heal ?? 0) > 0 && kit.hasOverflowingGrace) {
    lines.push("Overheal → HoT");
  }
  return lines;
}
