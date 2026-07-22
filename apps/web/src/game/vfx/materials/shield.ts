import * as THREE from "three";
import { createFresnelGlowMaterial } from "./fresnelGlow";
import { createScrollNoiseMaterial } from "./scrollNoise";

/**
 * Dual-layer shield look: fresnel shell + scrolling energy fill.
 * Returns materials; caller owns meshes / disposal.
 */
export function createShieldMaterials(
  color: string,
  opts?: { shellOpacity?: number; fillOpacity?: number },
): { shell: THREE.ShaderMaterial; fill: THREE.ShaderMaterial } {
  return {
    shell: createFresnelGlowMaterial(color, {
      opacity: opts?.shellOpacity ?? 0.7,
      power: 2.8,
      bias: 0.05,
    }),
    fill: createScrollNoiseMaterial(color, {
      opacity: opts?.fillOpacity ?? 0.35,
      scroll: [0.2, 0.45],
      scale: 3.2,
      contrast: 1.4,
    }),
  };
}

export function tickShieldMaterials(
  mats: { shell: THREE.ShaderMaterial; fill: THREE.ShaderMaterial },
  dt: number,
): void {
  mats.fill.uniforms.uTime!.value += dt;
}
