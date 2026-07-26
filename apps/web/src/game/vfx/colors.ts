/** Shared ability tint for combat VFX (projectiles, hits, muzzle). */
export const ABILITY_VFX_COLOR: Record<string, string> = {
  bolt: "#38bdf8",
  frostBall: "#7dd3fc",
  crescent: "#f8fafc",
  smash: "#a16207",
  barrier: "#60a5fa",
  surge: "#67e8f9",
  gust: "#e2e8f0",
  dash: "#a3e635",
  grasp: "#3b1f54",
  spikes: "#166534",
  frostMist: "#7dd3fc",
  decoy: "#94a3b8",
  groove: "#6ee7b7",
  healBeam: "#6ee7b7",
  poisonDart: "#4d7c0f",
  counter: "#f5c542",
};

export function abilityVfxColor(abilityId: string, fallback = "#38bdf8"): string {
  return ABILITY_VFX_COLOR[abilityId] ?? fallback;
}
