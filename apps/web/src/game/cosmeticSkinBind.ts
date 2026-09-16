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

/** Rest-pose verts within 0.1mm share a skinning/inflate cluster (UV islands). */
const SEAM_GRID = 1e4;

function clusterCoincidentVerts(pos: THREE.BufferAttribute): Map<string, number[]> {
  const clusters = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * SEAM_GRID)}:${Math.round(pos.getY(i) * SEAM_GRID)}:${Math.round(pos.getZ(i) * SEAM_GRID)}`;
    let ids = clusters.get(key);
    if (!ids) {
      ids = [];
      clusters.set(key, ids);
    }
    ids.push(i);
  }
  return clusters;
}

/**
 * Gear GLBs are hundreds of UV chips that meet at coincident verts. Copied
 * Mixamo weights (and Laplacian smooth) differ per island, so idle pose tears
 * the garment into plates. Average the top-4 influences onto every vert in a
 * rest-pose cluster so seams stay closed.
 */
export function sealSkinnedSeams(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position");
    const skinIndex = geo.getAttribute("skinIndex");
    const skinWeight = geo.getAttribute("skinWeight");
    if (!pos || !skinIndex || !skinWeight) return;

    for (const ids of clusterCoincidentVerts(pos).values()) {
      if (ids.length < 2) continue;
      const acc = new Map<number, number>();
      for (const i of ids) {
        for (let k = 0; k < 4; k++) {
          const w = skinWeight.getComponent(i, k);
          if (w <= 0) continue;
          const bone = skinIndex.getComponent(i, k);
          acc.set(bone, (acc.get(bone) ?? 0) + w);
        }
      }
      const ranked = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      let sum = 0;
      for (const [, w] of ranked) sum += w;
      if (sum <= 0) continue;
      const bones = [0, 0, 0, 0];
      const weights = [0, 0, 0, 0];
      ranked.forEach(([bone, w], k) => {
        bones[k] = bone;
        weights[k] = w / sum;
      });
      for (const i of ids) {
        skinIndex.setXYZW(i, bones[0], bones[1], bones[2], bones[3]);
        skinWeight.setXYZW(i, weights[0], weights[1], weights[2], weights[3]);
      }
    }
    skinIndex.needsUpdate = true;
    skinWeight.needsUpdate = true;
  });
}

/** Push rest-pose verts along averaged normals. Coincident UV-seam verts share one offset. */
export function inflateSkinnedGeometry(root: THREE.Object3D, meters: number): void {
  if (!(meters > 0)) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    geo.computeVertexNormals();
    const pos = geo.getAttribute("position");
    const nrm = geo.getAttribute("normal");
    if (!pos || !nrm) return;

    const clusters = clusterCoincidentVerts(pos);
    for (const ids of clusters.values()) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const i of ids) {
        nx += nrm.getX(i);
        ny += nrm.getY(i);
        nz += nrm.getZ(i);
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      const dx = (nx / len) * meters;
      const dy = (ny / len) * meters;
      const dz = (nz / len) * meters;
      for (const i of ids) {
        pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });
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

/** Live Mixamo bind inverses (hero.glb rest). Fallback to the clothing GLB. */
function hostBoneInverses(
  hostRoot: THREE.Object3D,
  hostBones: THREE.Bone[],
  fallback: THREE.Matrix4[],
): THREE.Matrix4[] {
  const found: THREE.Skeleton[] = [];
  hostRoot.traverse((obj) => {
    if (found.length > 0) return;
    if (obj.userData.bbBoneSkin || obj.userData.bbVesselBody) return;
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    if (mesh.skeleton.bones.length < hostBones.length) return;
    found.push(mesh.skeleton);
  });
  const skeleton = found[0];
  if (!skeleton) return fallback.map((m) => m.clone());
  const byBone = new Map<THREE.Bone, THREE.Matrix4>();
  skeleton.bones.forEach((bone, i) => {
    const inv = skeleton.boneInverses[i];
    if (inv) byBone.set(bone, inv);
  });
  return hostBones.map((bone, i) => byBone.get(bone)?.clone() ?? fallback[i]!.clone());
}

/**
 * Rebind clothing SkinnedMeshes onto the live Mixamo skeleton and parent them
 * next to Beta_Surface (same Armature, identity local).
 *
 * Clothing verts were exported with the GLB's inverse binds. Stealing
 * Beta_Surface's inverses pulls the mesh toward the bone pivot (Head sits
 * inside the skull, so helms clip at the nape). Y Bot already keeps its own
 * inverses; gear uses the same path.
 *
 * Pass `meshes` when the clone was already traversed — Strict Mode remounts
 * after the first bind, and a second traverse of the emptied clone finds nothing.
 */
export function mountSkinnedCosmetic(
  clothingRoot: THREE.Object3D,
  hostRoot: THREE.Object3D,
  meshes?: THREE.SkinnedMesh[],
  opts?: { hostBindInverses?: boolean },
): THREE.SkinnedMesh[] | null {
  const useHostBind = opts?.hostBindInverses === true;
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
    const clothingInverses = mesh.skeleton.boneInverses.map((m) => m.clone());
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
    const inverses = useHostBind
      ? hostBoneInverses(hostRoot, hostBones, clothingInverses)
      : clothingInverses;

    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    hostArm.add(mesh);
    mesh.updateMatrix();
    // Identity local on the live armature — same as the Mixamo body. Bind
    // after reparent so bindMatrix isn't left over from the GLB scene graph.
    mesh.bind(new THREE.Skeleton(hostBones, inverses), new THREE.Matrix4());
    mesh.normalizeSkinWeights();
    mesh.frustumCulled = false;
    mesh.visible = true;
    mounted.push(mesh);
  }

  pruneImportedArmature(clothingRoot);
  return mounted.length > 0 ? mounted : null;
}
