/**
 * Live filament knobs for lab lightning — same shape as elemental sandbox
 * `settings.thunder` (subset). Mutate and the next frame picks them up.
 */

export type LightningSettings = {
  /** Metres the bolt reaches (origin → tip). */
  length: number;
  /** Mid-span bow (positive = away from axis mid). */
  sag: number;
  strands: number;
  spread: number;
  spreadNear: number;
  spreadCurve: number;
  twist: number;
  twistSpeed: number;
  branchDim: number;
  jitter: number;
  jitterScale: number;
  octaves: number;
  jitterFalloff: number;
  crawl: number;
  pinch: number;
  converge: number;
  width: number;
  widthTip: number;
  widthCurve: number;
  coreWidth: number;
  coreSharp: number;
  glowWidth: number;
  glowFalloff: number;
  glowOpacity: number;
  restrike: number;
  flicker: number;
  flickerSpeed: number;
  strandFlash: number;
  tipGlow: number;
  tipLength: number;
  glow: number;
  colorCore: string;
  colorInner: string;
  colorOuter: string;
  colorHalo: string;
};

/** Defaults tuned for an upright gallery cone (not a thrown horizontal bolt). */
export const lightningSettings: LightningSettings = {
  length: 2.6,
  sag: 0.08,
  strands: 9,
  spread: 0.42,
  spreadNear: 0.04,
  spreadCurve: 1.4,
  twist: 0.35,
  twistSpeed: 0.9,
  branchDim: 0.72,
  jitter: 0.28,
  jitterScale: 1.05,
  octaves: 4,
  jitterFalloff: 0.55,
  crawl: 3.4,
  pinch: 0.12,
  converge: 0.55,
  width: 0.026,
  widthTip: 0.5,
  widthCurve: 1.1,
  coreWidth: 1.35,
  coreSharp: 4.8,
  glowWidth: 5.5,
  glowFalloff: 2.4,
  glowOpacity: 0.48,
  restrike: 22,
  flicker: 0.28,
  flickerSpeed: 34,
  strandFlash: 0.45,
  tipGlow: 1.4,
  tipLength: 0.1,
  glow: 2.3,
  colorCore: "#ffffff",
  colorInner: "#c9ecff",
  colorOuter: "#3aa0ff",
  colorHalo: "#0b3fc8",
};

export function patchLightningSettings(partial: Partial<LightningSettings>): void {
  Object.assign(lightningSettings, partial);
}

export function resetLightningSettings(): void {
  Object.assign(lightningSettings, {
    length: 2.6,
    sag: 0.08,
    strands: 9,
    spread: 0.42,
    spreadNear: 0.04,
    spreadCurve: 1.4,
    twist: 0.35,
    twistSpeed: 0.9,
    branchDim: 0.72,
    jitter: 0.28,
    jitterScale: 1.05,
    octaves: 4,
    jitterFalloff: 0.55,
    crawl: 3.4,
    pinch: 0.12,
    converge: 0.55,
    width: 0.026,
    widthTip: 0.5,
    widthCurve: 1.1,
    coreWidth: 1.35,
    coreSharp: 4.8,
    glowWidth: 5.5,
    glowFalloff: 2.4,
    glowOpacity: 0.48,
    restrike: 22,
    flicker: 0.28,
    flickerSpeed: 34,
    strandFlash: 0.45,
    tipGlow: 1.4,
    tipLength: 0.1,
    glow: 2.3,
    colorCore: "#ffffff",
    colorInner: "#c9ecff",
    colorOuter: "#3aa0ff",
    colorHalo: "#0b3fc8",
  } satisfies LightningSettings);
}
