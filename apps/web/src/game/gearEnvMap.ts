import * as THREE from "three";

const envByRenderer = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** Specular only — a white RoomEnvironment was lighting the albedo like a fill. */
const GEAR_ENV_INTENSITY = 0.32;

/**
 * Dim grey-box probe for equipped metal. Not added to the game scene.
 */
export function getGearEnvMap(gl: THREE.WebGLRenderer): THREE.Texture {
  const hit = envByRenderer.get(gl);
  if (hit) return hit;
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight("#c8b9a4", "#1c1814", 0.28);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#fff1dc", 0.4);
  key.position.set(2.4, 3.6, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight("#6d7c90", 0.12);
  fill.position.set(-1.8, 1.2, -1.4);
  scene.add(fill);
  const boxMat = new THREE.MeshBasicMaterial({ color: "#3c4148", side: THREE.BackSide });
  const box = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 14), boxMat);
  scene.add(box);

  const pmrem = new THREE.PMREMGenerator(gl);
  const tex = pmrem.fromScene(scene, 0.08).texture;
  pmrem.dispose();
  box.geometry.dispose();
  boxMat.dispose();
  envByRenderer.set(gl, tex);
  return tex;
}

function isMetallicGear(std: THREE.MeshStandardMaterial): boolean {
  return Boolean(std.metalnessMap) || (std.metalness ?? 0) > 0.12;
}

/** glTF metal/rough maps multiply the scalar factors — keep those at 1. */
export function prepareGearMaterial(mat: THREE.Material, envMap: THREE.Texture | null): void {
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;
  if (std.metalnessMap) {
    std.metalnessMap.colorSpace = THREE.NoColorSpace;
    std.metalness = 1;
  }
  if (std.roughnessMap) {
    std.roughnessMap.colorSpace = THREE.NoColorSpace;
    std.roughness = 1;
  }
  if (std.normalMap) std.normalMap.colorSpace = THREE.NoColorSpace;
  if (envMap && isMetallicGear(std)) {
    std.envMap = envMap;
    std.envMapIntensity = GEAR_ENV_INTENSITY;
  } else {
    std.envMap = null;
    if ("envMapIntensity" in std) std.envMapIntensity = 0;
  }
  std.needsUpdate = true;
}
