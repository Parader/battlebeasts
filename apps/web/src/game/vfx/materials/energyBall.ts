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

/**
 * Prototypes keyed by color — clone so each one-shot can mutate opacity
 * without fighting, while WebGL programs stay warm after the first cast.
 */
const ballProto = new Map<string, THREE.MeshBasicMaterial>();
const ringProto = new Map<string, THREE.MeshBasicMaterial>();

export function acquireEnergyBallMaterial(
  color: string,
  opacity = 1,
): THREE.MeshBasicMaterial {
  let proto = ballProto.get(color);
  if (!proto) {
    proto = createEnergyBallMaterial(color, 1);
    ballProto.set(color, proto);
  }
  const mat = proto.clone();
  mat.opacity = opacity;
  return mat;
}

export function acquireEnergyRingMaterial(
  color: string,
  opacity = 0.9,
): THREE.MeshBasicMaterial {
  let proto = ringProto.get(color);
  if (!proto) {
    proto = createEnergyRingMaterial(color, 1);
    ringProto.set(color, proto);
  }
  const mat = proto.clone();
  mat.opacity = opacity;
  return mat;
}
