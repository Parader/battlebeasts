import { useGLTF } from "@react-three/drei";
import { propUrlForKey } from "@battlebeasts/shared";
import * as THREE from "three";
import { assetUrl } from "../assetUrl";

/** Village gallery cloth — vertical banner, paired with a pole (KoTH / domination). */
export const BG_FLAG_CLOTH_PROP = "kingdom/PP_Flag_11";
export const BG_FLAG_POLE_PROP = "kingdom/PP_Flag_Pole_01";

export const BG_FLAG_CLOTH_URL = assetUrl(propUrlForKey(BG_FLAG_CLOTH_PROP).replace(/^\//, ""));
export const BG_FLAG_POLE_URL = assetUrl(propUrlForKey(BG_FLAG_POLE_PROP).replace(/^\//, ""));

/** Authored CTF props — flag1 is blue cloth, flag2 is red. */
export const BG_FLAG_BLUE_PROP = "flag1";
export const BG_FLAG_RED_PROP = "flag2";

export const BG_FLAG_BLUE_URL = assetUrl(propUrlForKey(BG_FLAG_BLUE_PROP).replace(/^\//, ""));
export const BG_FLAG_RED_URL = assetUrl(propUrlForKey(BG_FLAG_RED_PROP).replace(/^\//, ""));

export const BG_FLAG_STAND_HEIGHT = 2.45;
export const BG_FLAG_CARRY_HEIGHT = 1.22;

/** Team A carries the red flag; team B the blue one. */
export const FLAG_TEAM_A_HEX = "#e11d48";
export const FLAG_TEAM_A_HOT = "#fb7185";
export const FLAG_TEAM_B_HEX = "#2563eb";
export const FLAG_TEAM_B_HOT = "#93c5fd";

export function flagUrlForTeam(team: string | undefined): string {
  return team === "a" ? BG_FLAG_RED_URL : BG_FLAG_BLUE_URL;
}

export function flagTrailHex(team: string | undefined): { color: string; hot: string } {
  return team === "a"
    ? { color: FLAG_TEAM_A_HEX, hot: FLAG_TEAM_A_HOT }
    : { color: FLAG_TEAM_B_HEX, hot: FLAG_TEAM_B_HOT };
}

useGLTF.preload(BG_FLAG_CLOTH_URL);
useGLTF.preload(BG_FLAG_POLE_URL);

function cloneStdMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const prep = (mat: THREE.Material): THREE.Material => {
      const next = mat.clone();
      next.fog = false;
      next.toneMapped = true;
      const std = next as THREE.MeshStandardMaterial;
      if ("color" in std && std.color) {
        std.userData.baseColor = std.color.clone();
      }
      return next;
    };
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(prep);
    } else {
      mesh.material = prep(mesh.material);
    }
  });
}

/**
 * Clone a Poly Pizza prop, keep authored quat/scale, plant on the ground,
 * and uniform-scale so world height equals `targetHeight`.
 */
export function clonePlantedProp(src: THREE.Object3D, targetHeight: number): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = `${src.name || "prop"}_planted`;
  const clone = src.clone(true);
  cloneStdMaterials(clone);
  clone.position.set(0, 0, 0);
  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  if (box.isEmpty()) return wrapper;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= box.min.y;

  const height = Math.max(size.y, 1e-4);
  wrapper.scale.setScalar(targetHeight / height);
  wrapper.updateMatrixWorld(true);

  const planted = new THREE.Box3().setFromObject(wrapper);
  if (!planted.isEmpty()) wrapper.position.y -= planted.min.y;

  wrapper.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
  return wrapper;
}

function materialsOn(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && "color" in mat) out.push(mat as THREE.MeshStandardMaterial);
    }
  });
  return out;
}

export function applyFlagTint(mats: readonly THREE.MeshStandardMaterial[], tint: THREE.Color, amount = 0.5): void {
  for (const mat of mats) {
    const base = (mat.userData.baseColor as THREE.Color | undefined) ?? mat.color;
    mat.color.copy(base).lerp(tint, amount);
  }
}

export function disposeClonedFlag(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) mat.dispose();
  });
}

export type AssembledFlag = {
  root: THREE.Group;
  clothMats: THREE.MeshStandardMaterial[];
};

/** Pole + village cloth, both planted and height-matched. */
export function assembleBgFlag(
  clothScene: THREE.Object3D,
  poleScene: THREE.Object3D,
  height = BG_FLAG_STAND_HEIGHT,
): AssembledFlag {
  const root = new THREE.Group();
  root.name = "bgFlag";
  const pole = clonePlantedProp(poleScene, height);
  const cloth = clonePlantedProp(clothScene, height);
  root.add(pole);
  root.add(cloth);
  return { root, clothMats: materialsOn(cloth) };
}
