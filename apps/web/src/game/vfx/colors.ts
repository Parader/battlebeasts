/** Shared ability tint for combat VFX (projectiles, hits, muzzle). */
export const ABILITY_VFX_COLOR: Record<string, string> = {
  bolt: "#38bdf8",
  frostBall: "#7dd3fc",
  crescent: "#f8fafc",
  shock: "#facc15",
  smash: "#a16207",
  surge: "#67e8f9",
  gust: "#e2e8f0",
  dash: "#a3e635",
};

export function abilityVfxColor(abilityId: string, fallback = "#38bdf8"): string {
  return ABILITY_VFX_COLOR[abilityId] ?? fallback;
}
