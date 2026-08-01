/**
 * V Rising–style ChestProxy snap.
 *
 * After the mixer writes the layered pose, blend the real chest bone's world
 * rotation toward a root-level ChestProxy that was baked from the full cast.
 */

import * as THREE from "three";
import { normalizeBoneName } from "./clipUtils";

export type ChestProxyBones = {
  proxy: THREE.Object3D;
  chest: THREE.Object3D;
};

const _proxyWorldQ = new THREE.Quaternion();
const _parentWorldQ = new THREE.Quaternion();
const _desiredLocalQ = new THREE.Quaternion();
const _blended = new THREE.Quaternion();

function collectBoneLike(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  const add = (obj: THREE.Object3D | null | undefined) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    out.push(obj);
  };
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) add(obj);
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton?.bones) {
      for (const b of mesh.skeleton.bones) add(b);
    }
  });
  return out;
}

function isProxyName(normalized: string, raw: string): boolean {
  if (normalized === "chestproxy") return true;
  const lower = raw.toLowerCase();
  return lower.endsWith("chestproxy") || lower.includes("chest_proxy");
}

function isSpine1Name(normalized: string, raw: string): boolean {
  if (normalized === "spine1") return true;
  const lower = raw.toLowerCase();
  return (
    lower.endsWith("spine1") ||
    lower.includes(":spine1") ||
    lower.includes("_spine1")
  );
}

function isSpine2Name(normalized: string, raw: string): boolean {
  if (normalized === "spine2") return true;
  const lower = raw.toLowerCase();
  return (
    lower.endsWith("spine2") ||
    lower.includes(":spine2") ||
    lower.includes("_spine2")
  );
}

/** Find root-level ChestProxy + Spine1 (fallback Spine2). */
export function findChestProxyBones(root: THREE.Object3D): ChestProxyBones | null {
  const bones = collectBoneLike(root);
  let proxy: THREE.Object3D | null = null;
  let spine1: THREE.Object3D | null = null;
  let spine2: THREE.Object3D | null = null;

  for (const b of bones) {
    const n = normalizeBoneName(b.name);
    if (!proxy && isProxyName(n, b.name)) proxy = b;
    if (!spine1 && isSpine1Name(n, b.name)) spine1 = b;
    if (!spine2 && isSpine2Name(n, b.name)) spine2 = b;
  }

  const chest = spine1 ?? spine2;
  if (!proxy || !chest) return null;
  return { proxy, chest };
}

/**
 * Blend chest local rotation so its world rotation matches the proxy.
 * `weight` 0 = leave mixer pose; 1 = full snap.
 */
export function applyChestProxySnap(bones: ChestProxyBones, weight: number): void {
  const w = Math.max(0, Math.min(1, weight));
  if (w < 1e-4) return;

  const { proxy, chest } = bones;
  proxy.updateWorldMatrix(true, false);
  chest.updateWorldMatrix(true, false);

  proxy.getWorldQuaternion(_proxyWorldQ);

  const parent = chest.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(_parentWorldQ);
    _desiredLocalQ.copy(_parentWorldQ).invert().multiply(_proxyWorldQ);
  } else {
    _desiredLocalQ.copy(_proxyWorldQ);
  }

  if (w >= 1 - 1e-4) {
    chest.quaternion.copy(_desiredLocalQ);
  } else {
    _blended.copy(chest.quaternion).slerp(_desiredLocalQ, w);
    chest.quaternion.copy(_blended);
  }
  chest.updateMatrix();
}
