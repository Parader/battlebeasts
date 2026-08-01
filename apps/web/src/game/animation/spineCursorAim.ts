/**
 * Relative aim on Spine1 (Blender Global Z ≡ world +Y after glTF).
 *
 * After the mixer (and ChestProxy snap) writes the cast pose, add
 * (aimYaw − bodyYaw) as a world-up twist for twin-stick cursor aim.
 */

import * as THREE from "three";
import { normalizeBoneName } from "./clipUtils";

const _worldUp = new THREE.Vector3(0, 1, 0);

export type SpineAimBones = {
  spine: THREE.Object3D;
  hips: THREE.Object3D;
};

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
    const n = normalizeBoneName(obj.name);
    if (n === "hips" || n === "spine" || n.startsWith("spine")) add(obj);
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton?.bones) {
      for (const b of mesh.skeleton.bones) add(b);
    }
  });
  return out;
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

export function findSpineAimBones(root: THREE.Object3D): SpineAimBones | null {
  const byName = (name: string) => root.getObjectByName(name) ?? null;
  let hips =
    byName("mixamorig:Hips") ??
    byName("mixamorig_Hips") ??
    byName("Hips") ??
    byName("hips");
  let spine =
    byName("mixamorig:Spine1") ??
    byName("mixamorig_Spine1") ??
    byName("Spine1") ??
    byName("spine1");
  const bones = collectBoneLike(root);
  if (!hips || !spine) {
    for (const b of bones) {
      const n = normalizeBoneName(b.name);
      if (!hips && (n === "hips" || n.endsWith("hips"))) hips = b;
      if (!spine && isSpine1Name(n, b.name)) spine = b;
    }
  }
  if (!spine) {
    spine = bones.find((b) => isSpine1Name(normalizeBoneName(b.name), b.name)) ?? null;
  }
  if (!spine || !hips) {
    if (import.meta.env.DEV) {
      console.warn("[spineCursorAim] missing bones", {
        hips: hips?.name ?? null,
        spine1: spine?.name ?? null,
      });
    }
    return null;
  }
  if (normalizeBoneName(spine.name) === "spine") {
    if (import.meta.env.DEV) {
      console.warn("[spineCursorAim] resolved base Spine instead of Spine1");
    }
    return null;
  }
  return { spine, hips };
}

export function applySpineCursorYaw(
  bones: SpineAimBones,
  aimYaw: number,
  bodyYaw: number,
): void {
  const { spine } = bones;
  if (!spine.parent) return;
  let delta = aimYaw - bodyYaw;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  if (Math.abs(delta) < 1e-4) return;
  spine.updateWorldMatrix(true, false);
  spine.rotateOnWorldAxis(_worldUp, delta);
}

export function findSpineBone(root: THREE.Object3D): THREE.Object3D | null {
  return findSpineAimBones(root)?.spine ?? null;
}
