/**
 * Placed lights. A lamp post is a prop; the light is a separate point you
 * drop on it and raise to the lantern. The type picks colour, reach and
 * whether it flickers. Height is how far above the ground anchor it sits.
 */

export const LIGHT_KIND_IDS = ["lamp", "torch", "fire", "candle"] as const;
export type LightKindId = (typeof LIGHT_KIND_IDS)[number];

export type LightPreset = {
  id: LightKindId;
  label: string;
  color: string;
  /** Three.js point-light intensity, with decay 2. */
  intensity: number;
  /** Babylon point-light intensity. Different units from Three. */
  babylonIntensity: number;
  /** How far the pool reaches, in metres. */
  distance: number;
  /** 0 holds steady. Otherwise a fraction of intensity. */
  flicker: number;
  flickerSpeed: number;
  /** Suggested metres above the ground anchor. */
  height: number;
};

export const LIGHT_PRESETS: Record<LightKindId, LightPreset> = {
  lamp: {
    id: "lamp",
    label: "Lamp",
    color: "#ffd2a1",
    intensity: 36,
    babylonIntensity: 18,
    distance: 12,
    flicker: 0,
    flickerSpeed: 0,
    height: 3.2,
  },
  torch: {
    id: "torch",
    label: "Torch",
    color: "#ff8a3d",
    intensity: 26,
    babylonIntensity: 12,
    distance: 8,
    flicker: 0.16,
    flickerSpeed: 9,
    height: 1.6,
  },
  fire: {
    id: "fire",
    label: "Fire",
    color: "#ff6a1a",
    intensity: 22,
    babylonIntensity: 10,
    distance: 7,
    flicker: 0.28,
    flickerSpeed: 11,
    height: 0.45,
  },
  candle: {
    id: "candle",
    label: "Candle",
    color: "#ffc98a",
    intensity: 8,
    babylonIntensity: 4,
    distance: 3.5,
    flicker: 0.12,
    flickerSpeed: 7,
    height: 1,
  },
};

export function lightPreset(kind: string): LightPreset {
  if (kind in LIGHT_PRESETS) return LIGHT_PRESETS[kind as LightKindId];
  return LIGHT_PRESETS.lamp;
}
