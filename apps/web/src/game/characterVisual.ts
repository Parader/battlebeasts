import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  COSMETIC_SLOTS,
  cosmeticMeshNames,
  cosmeticNameKey,
  getCosmeticItem,
  isCosmeticMeshName,
  normalizeCosmeticsEquipped,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";
import { getCreaturePatternTexture } from "./creaturePatterns";
import { assetUrl } from "./assetUrl";

/** Desired standing height in world meters. */
export const CHARACTER_TARGET_HEIGHT = 1.7;

/** Active player / remote avatar GLB (Blender Mixamo export). */
export const CHARACTER_URL = assetUrl("hero.glb");

/**
 * Preferred surface mesh when the GLB ships multiple skinned bodies
 * (e.g. SM_Chr_* outfit packs). Beta Mixamo packs ignore this and keep
 * Beta_Surface visible / Beta_Joints hidden.
 */
export const CHARACTER_DEFAULT_MESH = "Beta_Surface";

export type PrepareCharacterOptions = {
  targetHeight?: number;
  restClip?: THREE.AnimationClip | null;
  upAxis?: "y" | "mixamo-z";
  visibleMeshName?: string;
};

/**
 * Clone a character GLB, fit height, plant on y=0, and shift XZ so idle
 * feet sit on the aim-ring origin. Gameplay owns horizontal root motion.
 */
export function prepareCharacterScene(
  sourceScene: THREE.Object3D,
  options: PrepareCharacterOptions | number = {},
): THREE.Object3D {
  const opts = typeof options === "number" ? { targetHeight: options } : options;
  const targetHeight = opts.targetHeight ?? CHARACTER_TARGET_HEIGHT;
  const restClip = opts.restClip ?? null;
  const upAxis = opts.upAxis ?? "y";
  const visibleMeshName = opts.visibleMeshName ?? CHARACTER_DEFAULT_MESH;

  const root = cloneSkinned(sourceScene) as THREE.Object3D;
  if (upAxis === "mixamo-z") {
    root.rotation.x = -Math.PI / 2;
  }

  selectCharacterMesh(root, visibleMeshName);
  hideAllCosmeticMeshes(root);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (mesh.material) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
    }
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if ("side" in std) std.side = THREE.FrontSide;
      if ("envMapIntensity" in std) std.envMapIntensity = 1;
      if ("opacity" in std) {
        std.transparent = false;
        std.opacity = 1;
        std.depthWrite = true;
      }
    }
  });

  const stance = measureIdleStance(sourceScene, restClip, targetHeight, upAxis, visibleMeshName);
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

/** True if this object (or its mesh name) is catalog / cosmetic gear. */
function isCosmeticObject(obj: THREE.Object3D): boolean {
  if (obj.name && isCosmeticMeshName(obj.name)) return true;
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.name && isCosmeticMeshName(mesh.name)) return true;
  return false;
}

/** Gear mesh or a descendant of a named gear node (e.g. WizardHat → Node-Mesh). */
function isCosmeticMeshOrDescendant(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (isCosmeticObject(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/** Keep one outfit mesh visible; hide the rest (multi-pack SM_Chr_* / Beta). */
export function selectCharacterMesh(root: THREE.Object3D, meshName: string): void {
  const wanted = meshName.toLowerCase();
  let hasOutfitPack = false;
  let matched = false;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (isCosmeticObject(obj) || isCosmeticObject(mesh.parent ?? obj)) return;

    const name = mesh.name;
    const lower = name.toLowerCase();

    if (lower.includes("beta_joints")) {
      mesh.visible = false;
      return;
    }
    if (lower.includes("beta_surface")) {
      mesh.visible = true;
      matched = matched || wanted.includes("beta_surface") || wanted === "beta_surface";
      return;
    }

    const isChr = name.startsWith("SM_Chr_");
    if (!isChr) return;
    hasOutfitPack = true;
    const show = lower === wanted;
    mesh.visible = show;
    if (show) matched = true;
  });

  if (hasOutfitPack && !matched) {
    console.warn(`[characterVisual] mesh "${meshName}" not found — showing first SM_Chr_*`);
    let first = true;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.name.startsWith("SM_Chr_")) return;
      mesh.visible = first;
      first = false;
    });
  }
}

/** Hide every catalog / cosmetic_* gear mesh (default unequipped — players, remotes, dummies). */
export function hideAllCosmeticMeshes(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!isCosmeticObject(obj)) return;
    obj.visible = false;
  });
}

/**
 * Show only equipped catalog gear meshes; keep all other gear hidden.
 */
export function syncEmbeddedCosmetics(
  root: THREE.Object3D,
  equipped: CosmeticsEquipped | null | undefined,
): void {
  const eq = normalizeCosmeticsEquipped(equipped);
  const showNames = new Set<string>();
  for (const slot of COSMETIC_SLOTS) {
    const id = eq[slot];
    if (!id) continue;
    const def = getCosmeticItem(id);
    if (!def) continue;
    for (const n of cosmeticMeshNames(def)) showNames.add(cosmeticNameKey(n));
  }

  root.traverse((obj) => {
    if (!isCosmeticObject(obj)) return;
    const key = cosmeticNameKey(obj.name || (obj as THREE.Mesh).name || "");
    obj.visible = showNames.has(key);
  });
}

type IdleStance = {
  scale: number;
  feetX: number;
  feetZ: number;
  minY: number;
};

/**
 * Disposable probe: evaluate rest clip with hips/root XZ locked, derive scale so
 * standing height matches `targetHeight`, then feet mid + ground plant.
 * Never touches the live skeleton/mixer.
 */
function measureIdleStance(
  sourceScene: THREE.Object3D,
  restClip: THREE.AnimationClip | null,
  targetHeight: number,
  upAxis: "y" | "mixamo-z",
  visibleMeshName: string,
): IdleStance | null {
  if (!restClip) return null;

  const probe = cloneSkinned(sourceScene) as THREE.Object3D;
  if (upAxis === "mixamo-z") probe.rotation.x = -Math.PI / 2;
  selectCharacterMesh(probe, visibleMeshName);
  hideAllCosmeticMeshes(probe);
  probe.updateMatrixWorld(true);

  const clip = lockRootHorizontal(restClip);
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

/** Match locomotion: Root/Hips.position XZ → 0, keep Y bounce. */
function lockRootHorizontal(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const bone = track.name.toLowerCase().replace(/[^a-z0-9.]+/g, "");
    const isMover =
      (bone.includes("hips") || bone.startsWith("root.")) && bone.endsWith(".position");
    if (!isMover) return track.clone();
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
  // Prefer ankles (Blender hero), then Mixamo feet, then balls
  const left =
    findBone(root, "ankle_l") ??
    findBone(root, "leftfoot") ??
    findBone(root, "ball_l") ??
    findBone(root, "leftankle");
  const right =
    findBone(root, "ankle_r") ??
    findBone(root, "rightfoot") ??
    findBone(root, "ball_r") ??
    findBone(root, "rightankle");
  if (!left || !right) return null;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  left.getWorldPosition(a);
  right.getWorldPosition(b);
  return { x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 };
}

function findBone(root: THREE.Object3D, key: string): THREE.Object3D | null {
  const needle = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  let found: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (found) return;
    const name = obj.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (name === needle || name.includes(needle)) {
      found = obj;
    }
  });
  return found;
}

/**
 * Tint the visible character surface. Supports Mixamo Beta_Surface meshes
 * and hero.glb materials (lambert1 / any colored material on visible SM_Chr_*).
 *
 * With a pattern: albedo map bakes hide tint + pattern ink; material.color is white
 * so markings keep their true color. Plain: no map, material.color = hide tint.
 */
export function tintCharacterSurface(
  scene: THREE.Object3D,
  color: string,
  patternId?: string | null,
  patternColor?: string | null,
): void {
  const patternMap = getCreaturePatternTexture(patternId, patternColor, color);
  const useMap = Boolean(patternMap);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.visible) return;
    const name = mesh.name.toLowerCase();
    const isHeroOutfit = mesh.name.startsWith("SM_Chr_");
    const isMixamoSurface = name.includes("surface");
    if (!isHeroOutfit && !isMixamoSurface) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if ("color" in std && std.color) {
        // White when mapped so baked hide/ink colors display correctly.
        std.color.set(useMap ? "#ffffff" : color);
      }
      if ("map" in std) {
        if (std.map !== patternMap) {
          std.map = patternMap;
          std.needsUpdate = true;
        }
        if (patternMap) patternMap.needsUpdate = true;
      }
    }
  });
}

/** Ghost opacity for self-cloaked; 1 = solid. Body surface + equipped gear. */
export function setCharacterOpacity(scene: THREE.Object3D, opacity: number): void {
  const o = Math.max(0, Math.min(1, opacity));
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    // Include hidden gear so equipping mid-cloak still ghosts correctly when shown.
    const name = mesh.name.toLowerCase();
    const isHeroOutfit = mesh.name.startsWith("SM_Chr_");
    const isMixamoSurface = name.includes("surface");
    const isGear = isCosmeticMeshOrDescendant(mesh);
    if (!isHeroOutfit && !isMixamoSurface && !isGear) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!("opacity" in std)) continue;
      std.transparent = o < 0.999;
      std.opacity = o;
      std.depthWrite = o >= 0.999;
      std.needsUpdate = true;
    }
  });
}
