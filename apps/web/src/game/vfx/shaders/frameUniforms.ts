import * as THREE from "three";

/**
 * Shared `{ value }` uniform boxes — one write per frame updates every material
 * that holds the same object by identity (elemental sandbox pattern).
 *
 * Soft-particle depth (`uSceneDepth`) stays null until a depth prepass is wired.
 */
export const frame = {
  uTime: { value: 0 },
  uDelta: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uSceneDepth: { value: null as THREE.Texture | null },
  uCameraNear: { value: 0.1 },
  uCameraFar: { value: 400 },
  uEnvMap: { value: null as THREE.Texture | null },
  uLightDir: { value: new THREE.Vector3(0.45, 0.78, 0.44).normalize() },
  uShaderIntensity: { value: 1 },
  uGlobalGlow: { value: 1 },
};

export function sharedUniforms(extra: Record<string, { value: unknown }> = {}) {
  return {
    uTime: frame.uTime,
    uResolution: frame.uResolution,
    uSceneDepth: frame.uSceneDepth,
    uCameraNear: frame.uCameraNear,
    uCameraFar: frame.uCameraFar,
    uLightDir: frame.uLightDir,
    uShaderIntensity: frame.uShaderIntensity,
    uGlobalGlow: frame.uGlobalGlow,
    ...extra,
  };
}

/** Call once per frame from the VFX tick / R3F loop. */
export function tickFrameUniforms(timeSec: number, deltaSec: number, width: number, height: number) {
  frame.uTime.value = timeSec;
  frame.uDelta.value = deltaSec;
  frame.uResolution.value.set(width, height);
}
