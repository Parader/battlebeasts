import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

/** Desired standing height in world meters. */
export const CHARACTER_TARGET_HEIGHT = 1.7;
export const CHARACTER_URL = "/character1.glb";

export type PrepareCharacterOptions = {
  targetHeight?: number;
  /**
   * Idle (or rest) clip used to place feet on the gameplay origin.
   * Required for dive-bind Mixamo re-exports — bind-pose centering is wrong.
   */
  restClip?: THREE.AnimationClip | null;
};

/**
 * Clone a Mixamo GLB, stand into Y-up, fit height, plant on y=0, and shift
 * XZ so idle feet sit on the aim-ring origin.
 */
export function prepareCharacterScene(
  sourceScene: THREE.Object3D,
  options: PrepareCharacterOptions | number = {},
): THREE.Object3D {
  const opts = typeof options === "number" ? { targetHeight: options } : options;
  const targetHeight = opts.targetHeight ?? CHARACTER_TARGET_HEIGHT;
  const restClip = opts.restClip ?? null;

  const root = cloneSkinned(sourceScene) as THREE.Object3D;
  // Stand Mixamo Z-up body into Y-up — only X, never combine with Y here
  root.rotation.x = -Math.PI / 2;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
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
  });

  // Scale from idle height, not dive-bind — bind bbox is shorter and overshoots.
  const stance = measureIdleStance(sourceScene, restClip, targetHeight);
  if (stance) {
    root.scale.setScalar(stance.scale);
    root.position.set(-stance.feetX, -stance.minY, -stance.feetZ);
  } else {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 1e-4) root.scale.setScalar(targetHeight / size.y);
    root.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(root);
    root.position.y -= fitted.min.y;
  }
  root.updateMatrixWorld(true);

  return root;
}

type IdleStance = {
  scale: number;
  feetX: number;
  feetZ: number;
  minY: number;
};

/**
 * Disposable probe: evaluate rest clip with hips XZ locked, derive scale so
 * standing height matches `targetHeight`, then feet mid + ground plant.
 * Never touches the live skeleton/mixer.
 */
function measureIdleStance(
  sourceScene: THREE.Object3D,
  restClip: THREE.AnimationClip | null,
  targetHeight: number,
): IdleStance | null {
  if (!restClip) return null;

  const probe = cloneSkinned(sourceScene) as THREE.Object3D;
  probe.rotation.x = -Math.PI / 2;
  probe.updateMatrixWorld(true);

  const clip = lockHipsHorizontal(restClip);
  const mixer = new THREE.AnimationMixer(probe);
  const action = mixer.clipAction(clip);
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  mixer.update(0);
  probe.updateMatrixWorld(true);

  const unscaled = new THREE.Box3().setFromObject(probe);
  const size = new THREE.Vector3();
  unscaled.getSize(size);
  const scale = size.y > 1e-4 ? targetHeight / size.y : 1;
  probe.scale.setScalar(scale);
  probe.updateMatrixWorld(true);

  const feet = footMidpointWorld(probe);
  const bbox = new THREE.Box3().setFromObject(probe);
  mixer.stopAllAction();
  mixer.uncacheRoot(probe);

  return {
    scale,
    feetX: feet?.x ?? 0,
    feetZ: feet?.z ?? 0,
    minY: bbox.min.y,
  };
}

/** Match locomotion: hips.position XZ → 0, keep Y bounce. */
function lockHipsHorizontal(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const bone = track.name.toLowerCase().replace(/[^a-z0-9.]+/g, "");
    if (!bone.includes("hips") || !bone.endsWith(".position")) return track.clone();
    if (track.values.length < 3) return track.clone();
    const next = track.clone();
    for (let i = 0; i < next.values.length; i += 3) {
      next.values[i] = 0;
      next.values[i + 2] = 0;
    }
    return next;
  });
  return new THREE.AnimationClip(`${clip.name}::stanceProbe`, clip.duration, tracks);
}

/**
 * Shift the character root so the live foot midpoint sits on the gameplay
 * origin (aim ring) and the mesh rests on y=0. Prefer baking via `restClip`
 * in `prepareCharacterScene`; this is a safety net after the mixer is idle.
 */
export function recenterStanceOnFeet(root: THREE.Object3D): boolean {
  root.updateMatrixWorld(true);
  const feet = footMidpointWorld(root);
  if (!feet) return false;

  root.position.x -= feet.x;
  root.position.z -= feet.z;
  root.updateMatrixWorld(true);

  const planted = new THREE.Box3().setFromObject(root);
  root.position.y -= planted.min.y;
  root.updateMatrixWorld(true);
  return true;
}

function footMidpointWorld(root: THREE.Object3D): { x: number; z: number } | null {
  const left = findBone(root, "leftfoot");
  const right = findBone(root, "rightfoot");
  if (!left || !right) return null;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  left.getWorldPosition(a);
  right.getWorldPosition(b);
  return { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
}

function findBone(root: THREE.Object3D, key: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key)) {
      found = obj;
    }
  });
  return found;
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
