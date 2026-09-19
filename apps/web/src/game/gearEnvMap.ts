import * as THREE from "three";

const envByRenderer = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** Specular only — a white RoomEnvironment was lighting the albedo like a fill. */
const GEAR_ENV_INTENSITY = 0.85;

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

/** Real chrome — high factor, no packed MR leftover from cloth exports. */
function isAuthoredMetal(std: THREE.MeshStandardMaterial): boolean {
  return !std.metalnessMap && (std.metalness ?? 0) > 0.35;
}

/**
 * glTF packs roughness in G / metalness in B and defaults metallicFactor to 1.
 * Almost every Blender cloth export therefore looks like dark chrome in-game
 * (albedo is multiplied by 1 − metalness, then lit by a dim grey probe).
 */
export function prepareGearMaterial(mat: THREE.Material, envMap: THREE.Texture | null): void {
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return;

  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
  if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if (std.normalMap) std.normalMap.colorSpace = THREE.NoColorSpace;
  if (std.aoMap) std.aoMap.colorSpace = THREE.NoColorSpace;

  if (std.roughnessMap) {
    std.roughnessMap.colorSpace = THREE.NoColorSpace;
    std.roughness = 1;
  }

  const authoredMetal = isAuthoredMetal(std);
  if (std.metalnessMap) {
    // Same texture still drives roughness via G; drop B so cloth keeps color.
    std.metalnessMap = null;
    std.metalness = 0;
  } else if (!authoredMetal) {
    std.metalness = Math.min(std.metalness ?? 0, 0.05);
  }

  if (envMap && authoredMetal) {
    std.envMap = envMap;
    std.envMapIntensity = GEAR_ENV_INTENSITY;
  } else {
    std.envMap = null;
    std.envMapIntensity = 0;
  }

  // Body hide tint is fog-off; night hub fog was muddying gear albedo next to it.
  std.fog = false;
  // Blender solid shows both sides of a thin hat shell. FrontSide leaves the
  // inner cone / visor lining un-drawn, so Mixamo fills that volume.
  std.side = THREE.DoubleSide;
  std.transparent = true;
  std.opacity = 1;
  std.depthWrite = true;
  // Pull gear in front of Mixamo where the meshes occupy the same pixels.
  // Factor (slope) is 0 so a grazing visor does not gain extra bias when you
  // zoom in; units is a constant window-Z push at every distance.
  std.polygonOffset = true;
  std.polygonOffsetFactor = 0;
  std.polygonOffsetUnits = -4;
  std.needsUpdate = true;
}
