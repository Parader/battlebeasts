import * as THREE from "three";

/** Additive emissive core — blooms well with toneMapped: false. */
export function createEnergyBallMaterial(
  color: string,
  opacity = 1,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

export function createEnergyRingMaterial(
  color: string,
  opacity = 0.9,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function tintEnergyMaterial(
  mat: THREE.MeshBasicMaterial,
  color: string,
  opacity?: number,
): void {
  mat.color.set(color);
  if (opacity !== undefined) mat.opacity = opacity;
}
