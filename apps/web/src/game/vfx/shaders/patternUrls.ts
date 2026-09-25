import { assetUrl } from "../../assetUrl";

/**
 * Baked procedural patterns from the elemental sandbox recipes.
 * Grayscale + alpha — tint in the material. Useful beyond ice:
 * plates/seams for ground rime & scorched earth, ridged for fissures/fire,
 * fbm for mist breakup, sparkle for glints, dissolve for break FX.
 */
export const PATTERN_IDS = [
  "frost-plates",
  "frost-fingers",
  "ridged-cracks",
  "fbm-soft",
  "sparkle-dots",
  "dissolve-noise",
] as const;

export type PatternId = (typeof PATTERN_IDS)[number];

export const VFX_PATTERN_URLS: Record<PatternId, string> = {
  "frost-plates": assetUrl("assets/vfx/patterns/frost-plates.png"),
  "frost-fingers": assetUrl("assets/vfx/patterns/frost-fingers.png"),
  "ridged-cracks": assetUrl("assets/vfx/patterns/ridged-cracks.png"),
  "fbm-soft": assetUrl("assets/vfx/patterns/fbm-soft.png"),
  "sparkle-dots": assetUrl("assets/vfx/patterns/sparkle-dots.png"),
  "dissolve-noise": assetUrl("assets/vfx/patterns/dissolve-noise.png"),
};
