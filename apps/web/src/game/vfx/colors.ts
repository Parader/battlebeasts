/** Shared ability tint for combat VFX (projectiles, hits, muzzle). */
export const ABILITY_VFX_COLOR: Record<string, string> = {
  bolt: "#38bdf8",
  shock: "#facc15",
  smash: "#fb923c",
  surge: "#c084fc",
  dash: "#a3e635",
};

export function abilityVfxColor(abilityId: string, fallback = "#38bdf8"): string {
  return ABILITY_VFX_COLOR[abilityId] ?? fallback;
}
