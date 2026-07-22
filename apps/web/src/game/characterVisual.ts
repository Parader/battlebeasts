import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

/** Desired standing height in world meters. */
export const CHARACTER_TARGET_HEIGHT = 1.7;
export const CHARACTER_URL = "/character1.glb";

/**
 * Clone a Mixamo GLB scene, stand it into Y-up, fit height, plant feet on y=0.
 * One clone per player instance (local or remote).
 */
export function prepareCharacterScene(
  sourceScene: THREE.Object3D,
  targetHeight = CHARACTER_TARGET_HEIGHT,
): THREE.Object3D {
  const root = cloneSkinned(sourceScene) as THREE.Object3D;
  // Stand Mixamo Z-up body into Y-up — only X, never combine with Y here
  root.rotation.x = -Math.PI / 2;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if ("side" in std) std.side = THREE.FrontSide;
        if ("envMapIntensity" in std) std.envMapIntensity = 1;
      }
    }
  });

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 1e-4) {
    root.scale.setScalar(targetHeight / size.y);
    root.updateMatrixWorld(true);
  }
  const fitted = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  fitted.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= fitted.min.y;
  root.updateMatrixWorld(true);

  return root;
}

/** Tint Beta_Surface materials when present. */
export function tintCharacterSurface(scene: THREE.Object3D, color: string): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const name = mesh.name.toLowerCase();
    if (!name.includes("surface")) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if ("color" in std && std.color) std.color.set(color);
    }
  });
}
