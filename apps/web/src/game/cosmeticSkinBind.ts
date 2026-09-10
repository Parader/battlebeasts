import * as THREE from "three";
import { findMixamoBone } from "./vfx/attach";

function findHostArmature(hostRoot: THREE.Object3D): THREE.Object3D | null {
  const hips = findMixamoBone(hostRoot, "Hips");
  return hips?.parent ?? null;
}

function collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) meshes.push(mesh);
  });
  return meshes;
}

function pruneImportedArmature(root: THREE.Object3D): void {
  const drop: THREE.Object3D[] = [];
  for (const child of [...root.children]) {
    const bone = child as THREE.Bone;
    if (bone.isBone || /armature/i.test(child.name)) drop.push(child);
  }
  for (const obj of drop) {
    obj.removeFromParent();
  }
}

/**
 * Rebind clothing SkinnedMeshes onto the live Mixamo skeleton and parent them
 * next to Beta_Surface (same Armature, identity local) so T-pose matches Blender.
 *
 * Pass `meshes` when the clone was already traversed — Strict Mode remounts
 * after the first bind, and a second traverse of the emptied clone finds nothing.
 */
export function mountSkinnedCosmetic(
  clothingRoot: THREE.Object3D,
  hostRoot: THREE.Object3D,
  meshes?: THREE.SkinnedMesh[],
): THREE.SkinnedMesh[] | null {
  const list = (meshes?.length ? meshes : collectSkinnedMeshes(clothingRoot)).filter(
    (mesh) => mesh.isSkinnedMesh && mesh.skeleton,
  );
  if (list.length === 0) {
    console.warn("[BoneSkins] skinned cosmetic has no SkinnedMesh");
    return null;
  }

  const hostArm = findHostArmature(hostRoot);
  if (!hostArm) {
    console.warn("[BoneSkins] host Armature missing");
    return null;
  }

  const mounted: THREE.SkinnedMesh[] = [];
  for (const mesh of list) {
    const hostBones: THREE.Bone[] = [];
    const fallback =
      (findMixamoBone(hostRoot, "Spine2") as THREE.Bone | null) ??
      (findMixamoBone(hostRoot, "Hips") as THREE.Bone | null);
    for (const src of mesh.skeleton.bones) {
      const host = (findMixamoBone(hostRoot, src.name) as THREE.Bone | null) ?? fallback;
      if (!host || !host.isBone) {
        console.warn(`[BoneSkins] host bone missing for ${src.name}`);
        hostBones.length = 0;
        break;
      }
      hostBones.push(host);
    }
    if (hostBones.length !== mesh.skeleton.bones.length) {
      console.warn("[BoneSkins] skeleton joint count mismatch, skipping mesh", mesh.name);
      continue;
    }
    mesh.bind(
      new THREE.Skeleton(hostBones, mesh.skeleton.boneInverses.slice()),
      mesh.bindMatrix.clone(),
    );
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
    mesh.visible = true;
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    hostArm.add(mesh);
    mounted.push(mesh);
  }

  pruneImportedArmature(clothingRoot);
  return mounted.length > 0 ? mounted : null;
}
