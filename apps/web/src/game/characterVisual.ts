import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  COSMETIC_SLOTS,
  cosmeticMeshNames,
  cosmeticNameKey,
  getCosmeticItem,
  isBoneSkin,
  isCosmeticMeshName,
  normalizeCosmeticsEquipped,
  resolveHideTint,
  type CosmeticItemDef,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";
import { assetUrl } from "./assetUrl";
import { compileLiveScene } from "./compileLiveScene";

/** Desired standing height in world meters. */
export const CHARACTER_TARGET_HEIGHT = 1.7;

/** Active player / remote avatar GLB (Blender Mixamo export). */
export const CHARACTER_URL = assetUrl("hero.glb");
/** Mixamo Y Bot body — animations stay on hero.glb. */
export const YBOT_URL = assetUrl("ybot.glb");

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
  /**
   * Zero hips/root XZ in the idle clip before measuring height.
   *
   * Hero clips need this when Mixamo root translation is baked in. On some
   * NPC rigs (merchant) it inflates the bbox and shrinks the visible mesh —
   * pass false for villagers.
   */
  lockMeasureRoot?: boolean;
  /**
   * Measure height from the raw rest clip but plant feet using hips-XZ-locked
   * rest. NPC Mixamo exports need raw height (merchant) and locked plant so
   * feet stay on y=0 once runtime idle plays.
   */
  splitScaleAndPlant?: boolean;
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

  const stance = opts.splitScaleAndPlant
    ? measureSplitStance(sourceScene, restClip, targetHeight, upAxis, visibleMeshName)
    : measureIdleStance(sourceScene, restClip, targetHeight, upAxis, visibleMeshName, {
        lockRoot: opts.lockMeasureRoot !== false,
      });
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
  captureCharacterBindPose(root);

  return root;
}

type BindBoneSnap = {
  bone: THREE.Bone;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

function captureCharacterBindPose(root: THREE.Object3D): void {
  const snaps: BindBoneSnap[] = [];
  root.traverse((obj) => {
    const bone = obj as THREE.Bone;
    if (!bone.isBone) return;
    snaps.push({
      bone,
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });
  });
  root.userData.bbBindPose = snaps;
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

function mixamoSurfaceVertCount(mesh: THREE.Mesh): number {
  return mesh.geometry?.getAttribute("position")?.count ?? 0;
}

/**
 * hero.glb shipped a second `Beta_Surface*.001` (jaw-height flesh ring, ~0.57m
 * radius) that is not in hero_bind. Drawing it as hide-tint made Mixamo poke
 * through every helm. Keep the largest surface; hide the rest.
 */
function pickPrimaryMixamoSurface(meshes: THREE.Mesh[]): THREE.Mesh | null {
  if (meshes.length === 0) return null;
  return meshes.reduce((best, mesh) =>
    mixamoSurfaceVertCount(mesh) > mixamoSurfaceVertCount(best) ? mesh : best,
  );
}

/** Keep one outfit mesh visible; hide the rest (multi-pack SM_Chr_* / Beta). */
export function selectCharacterMesh(root: THREE.Object3D, meshName: string): void {
  const wanted = meshName.toLowerCase();
  let hasOutfitPack = false;
  let matched = false;
  const mixamoSurfaces: THREE.Mesh[] = [];

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
      mixamoSurfaces.push(mesh);
      return;
    }

    const isChr = name.startsWith("SM_Chr_");
    if (!isChr) return;
    hasOutfitPack = true;
    const show = lower === wanted;
    mesh.visible = show;
    if (show) matched = true;
  });

  const primary = pickPrimaryMixamoSurface(mixamoSurfaces);
  for (const mesh of mixamoSurfaces) {
    const show = mesh === primary;
    mesh.visible = show;
    mesh.userData.bbHeroSurface = show;
  }
  if (primary) {
    matched = matched || wanted.includes("beta_surface") || wanted === "beta_surface";
  }

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
    if (obj.userData.bbBoneSkin) return;
    if (!isCosmeticObject(obj)) return;
    obj.visible = false;
  });
}

/** Show or hide the hero Mixamo body (not Y Bot overlays or gear). */
export function setHeroSurfaceVisible(root: THREE.Object3D, visible: boolean): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.name.startsWith("bb")) return;
    if (obj.userData.bbVesselBody || obj.userData.bbBoneSkin) return;
    if (isCosmeticObject(obj) || isCosmeticMeshOrDescendant(obj)) return;
    const lower = mesh.name.toLowerCase();
    if (lower.includes("joint")) {
      mesh.visible = false;
      return;
    }
    if (obj.userData.bbHeroSurface === false) {
      mesh.visible = false;
      return;
    }
    if (lower.includes("surface") || mesh.name.startsWith("SM_Chr_")) {
      mesh.visible = visible;
    }
  });
}

/** Mixamo rest / T-pose from the GLB bind locals (not skeleton.pose — hats share bones). */
export function poseCharacterBind(root: THREE.Object3D): void {
  const snaps = root.userData.bbBindPose as BindBoneSnap[] | undefined;
  if (snaps?.length) {
    for (const snap of snaps) {
      snap.bone.position.copy(snap.position);
      snap.bone.quaternion.copy(snap.quaternion);
      snap.bone.scale.copy(snap.scale);
    }
    root.updateMatrixWorld(true);
    return;
  }
  root.traverse((obj) => {
    if (obj.userData.bbBoneSkin || obj.userData.bbVesselBody) return;
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.pose();
  });
  root.updateMatrixWorld(true);
}

/** True when hero.glb already has this item (legacy Boot1/Boot2, Chest Set 1, etc.). */
export function hasEmbeddedSkinnedMeshes(
  root: THREE.Object3D,
  def: CosmeticItemDef,
): boolean {
  const names = new Set(cosmeticMeshNames(def).map(cosmeticNameKey));
  if (names.size === 0) return false;
  const found = new Set<string>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      const key = cosmeticNameKey(cur.name);
      if (names.has(key)) {
        found.add(key);
        break;
      }
      cur = cur.parent;
    }
  });
  return found.size === names.size;
}

/** Unhide leftover hero.glb SkinnedMeshes for a catalog item (GLB bind failed). */
export function revealEmbeddedSkinnedMeshes(
  root: THREE.Object3D,
  def: CosmeticItemDef,
): boolean {
  if (!hasEmbeddedSkinnedMeshes(root, def)) return false;
  const names = new Set(cosmeticMeshNames(def).map(cosmeticNameKey));
  root.traverse((obj) => {
    if (obj.userData.bbBoneSkin) return;
    let cur: THREE.Object3D | null = obj;
    let match = false;
    while (cur) {
      if (names.has(cosmeticNameKey(cur.name))) {
        match = true;
        break;
      }
      cur = cur.parent;
    }
    if (!match) return;
    obj.userData.bbEmbeddedSkin = true;
    obj.visible = true;
  });
  return true;
}

/** Hide leftover meshes shown by `revealEmbeddedSkinnedMeshes`. */
export function hideRevealedEmbeddedSkinnedMeshes(
  root: THREE.Object3D,
  def: CosmeticItemDef,
): void {
  const names = new Set(cosmeticMeshNames(def).map(cosmeticNameKey));
  root.traverse((obj) => {
    if (!obj.userData.bbEmbeddedSkin) return;
    let cur: THREE.Object3D | null = obj;
    let match = false;
    while (cur) {
      if (names.has(cosmeticNameKey(cur.name))) {
        match = true;
        break;
      }
      cur = cur.parent;
    }
    if (!match) return;
    obj.userData.bbEmbeddedSkin = false;
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
    if (!def || isBoneSkin(def)) continue;
    for (const n of cosmeticMeshNames(def)) showNames.add(cosmeticNameKey(n));
  }

  root.traverse((obj) => {
    if (obj.userData.bbBoneSkin) return;
    if (obj.userData.bbEmbeddedSkin) return;
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

/** Raw idle height + hips-XZ-locked plant — see `splitScaleAndPlant`. */
function measureSplitStance(
  sourceScene: THREE.Object3D,
  restClip: THREE.AnimationClip | null,
  targetHeight: number,
  upAxis: "y" | "mixamo-z",
  visibleMeshName: string,
): IdleStance | null {
  const scaled = measureIdleStance(sourceScene, restClip, targetHeight, upAxis, visibleMeshName, {
    lockRoot: false,
  });
  if (!scaled) return null;
  const planted = measureIdleStance(sourceScene, restClip, targetHeight, upAxis, visibleMeshName, {
    lockRoot: true,
    fixedScale: scaled.scale,
  });
  if (!planted) return scaled;
  return {
    scale: scaled.scale,
    feetX: planted.feetX,
    feetZ: planted.feetZ,
    minY: planted.minY,
  };
}

/**
 * Disposable probe: evaluate rest clip, derive scale, then feet mid + ground plant.
 * Never touches the live skeleton/mixer.
 */
function measureIdleStance(
  sourceScene: THREE.Object3D,
  restClip: THREE.AnimationClip | null,
  targetHeight: number,
  upAxis: "y" | "mixamo-z",
  visibleMeshName: string,
  opts: { lockRoot?: boolean; fixedScale?: number } = {},
): IdleStance | null {
  if (!restClip) return null;

  const probe = cloneSkinned(sourceScene) as THREE.Object3D;
  if (upAxis === "mixamo-z") probe.rotation.x = -Math.PI / 2;
  selectCharacterMesh(probe, visibleMeshName);
  hideAllCosmeticMeshes(probe);
  probe.updateMatrixWorld(true);

  const clip = opts.lockRoot === false ? restClip : lockRootHorizontal(restClip);
  const mixer = new THREE.AnimationMixer(probe);
  const action = mixer.clipAction(clip);
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.play();
  mixer.update(0);
  probe.updateMatrixWorld(true);

  const scale =
    opts.fixedScale ??
    (() => {
      const unscaled = new THREE.Box3().setFromObject(probe);
      const size = new THREE.Vector3();
      unscaled.getSize(size);
      return size.y > 1e-4 ? targetHeight / size.y : 1;
    })();
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
 * Hide tint only — vessel auras are a runtime overlay (`SpiritVesselFx`),
 * not albedo stamps (those fought Mixamo UVs).
 *
 * Quiet inner emissive in hide color — bound-spirit core. Counter / Revenge
 * overwrite emissive while active and restore this on clear.
 */
export const SPIRIT_VESSEL_EMISSIVE = 0.18;

type HideTintUniforms = {
  a: { value: THREE.Color };
  b: { value: THREE.Color };
  grade: { value: number };
  y0: { value: number };
  y1: { value: number };
};

function hideYRange(mesh: THREE.Mesh): { y0: number; y1: number } {
  const cached = mesh.userData.bbHideY as { y0: number; y1: number } | undefined;
  if (cached) return cached;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const y0 = box?.min.y ?? 0;
  const y1 = box?.max.y ?? 1;
  const range = { y0, y1: Math.abs(y1 - y0) < 1e-4 ? y0 + 1 : y1 };
  mesh.userData.bbHideY = range;
  return range;
}

function isHideTintUniforms(value: unknown): value is HideTintUniforms {
  const hide = value as HideTintUniforms | undefined;
  return Boolean(hide?.a?.value && (hide.a.value as THREE.Color).isColor);
}

function applyHideTintMaterial(std: THREE.MeshStandardMaterial, mesh: THREE.Mesh, colorId: string): void {
  const tint = resolveHideTint(colorId);
  const range = hideYRange(mesh);
  let hide = std.userData.bbHide as HideTintUniforms | undefined;
  if (!isHideTintUniforms(hide)) {
    hide = {
      a: { value: new THREE.Color(tint.a) },
      b: { value: new THREE.Color(tint.b) },
      grade: { value: 0 },
      y0: { value: range.y0 },
      y1: { value: range.y1 },
    };
    std.userData.bbHide = hide;
    std.onBeforeCompile = (shader) => {
      const u = std.userData.bbHide as HideTintUniforms;
      shader.uniforms.uHideA = u.a;
      shader.uniforms.uHideB = u.b;
      shader.uniforms.uHideGrade = u.grade;
      shader.uniforms.uHideY0 = u.y0;
      shader.uniforms.uHideY1 = u.y1;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying float vHideY;
varying vec3 vHideN;`,
        )
        .replace(
          "#include <defaultnormal_vertex>",
          `#include <defaultnormal_vertex>
vHideN = objectNormal;`,
        )
        .replace(
          "#include <project_vertex>",
          `#include <project_vertex>
vHideY = transformed.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec3 uHideA;
uniform vec3 uHideB;
uniform float uHideGrade;
uniform float uHideY0;
uniform float uHideY1;
varying float vHideY;
varying vec3 vHideN;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float hideT = 0.0;
if (uHideGrade > 1.5) {
  hideT = 1.0 - smoothstep(-0.35, 0.42, normalize(vHideN).y);
} else if (uHideGrade > 0.5) {
  hideT = 1.0 - clamp((vHideY - uHideY0) / max(0.001, uHideY1 - uHideY0), 0.0, 1.0);
}
diffuseColor.rgb = mix(uHideA, uHideB, hideT);`,
        );
    };
    // Per-material key: a shared "bbHideTint2" lets onBeforeCompile run once,
    // so later avatars keep the first character's uniforms (or black defaults).
    std.customProgramCacheKey = () => `bbHideTint2:${std.uuid}`;
  }
  hide.a.value.set(tint.a);
  hide.b.value.set(tint.b);
  hide.grade.value = tint.grade === "belly" ? 2 : tint.grade === "vertical" ? 1 : 0;
  hide.y0.value = range.y0;
  hide.y1.value = range.y1;
  if ("color" in std && std.color) std.color.set(tint.a);
  if ("emissive" in std && std.emissive) {
    std.emissive.set(tint.a);
    std.emissiveIntensity = SPIRIT_VESSEL_EMISSIVE;
  }
  std.needsUpdate = true;
}

export function tintCharacterSurface(
  scene: THREE.Object3D,
  color: string,
  _auraId?: string | null,
  _auraColor?: string | null,
): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (mesh.name.startsWith("bb")) return;
    if (obj.userData.bbBoneSkin) return;
    const name = mesh.name.toLowerCase();
    const isHeroOutfit = mesh.name.startsWith("SM_Chr_");
    const isMixamoSurface = name.includes("surface");
    if (!isHeroOutfit && !isMixamoSurface) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      applyHideTintMaterial(std, mesh, color);
      if ("roughness" in std) std.roughness = Math.max(std.roughness ?? 0.5, 0.74);
      if ("metalness" in std) std.metalness = Math.min(std.metalness ?? 0, 0.03);
      if ("envMapIntensity" in std) std.envMapIntensity = 0;
      if ("fog" in std) std.fog = false;
      if ("map" in std && std.map) {
        std.map = null;
        std.needsUpdate = true;
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
    let isGear = isCosmeticMeshOrDescendant(mesh);
    if (!isGear) {
      let cur: THREE.Object3D | null = mesh;
      while (cur) {
        if (cur.userData.bbBoneSkin || cur.userData.bbVesselBody) {
          isGear = true;
          break;
        }
        cur = cur.parent;
      }
    }
    if (!isHeroOutfit && !isMixamoSurface && !isGear) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!("opacity" in std)) continue;
      const transparent = o < 0.999;
      const depthWrite = o >= 0.999;
      if (std.transparent === transparent && std.opacity === o && std.depthWrite === depthWrite) {
        continue;
      }
      std.transparent = transparent;
      std.opacity = o;
      std.depthWrite = depthWrite;
      std.needsUpdate = true;
    }
  });
}

const warmedOpacityLoadouts = new Set<string>();
const OPACITY_WARM_DUMMY = "OpacityWarmDummy";
let opacityWarmQueue: Promise<void> = Promise.resolve();

function cloneOpacityWarmDummy(source: THREE.Object3D): THREE.Object3D {
  const dummy = cloneSkinned(source) as THREE.Object3D;
  dummy.name = OPACITY_WARM_DUMMY;
  dummy.visible = false;
  dummy.position.set(0, -800, 0);
  dummy.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
    mesh.frustumCulled = false;
  });
  return dummy;
}

/**
 * Compile the ghosted variant of the character's materials up front.
 *
 * `setCharacterOpacity` flips `transparent`, which three folds into the
 * program cache key (the `opaque` bit). So the first decoy, cloak, teleport
 * slam fade or spirit husk of a session relinks every hero and gear material
 * on the spot -- a visible spike.
 *
 * Never mutate the live avatar: compileAsync yields, overlapping loadout
 * warms (avatar + bone skins) used to snapshot each other at 0.32 and
 * restore players as permanent ghosts. A hidden clone carries the variants.
 *
 * `gl.compile` only queues programs; the GPU often finishes on first draw.
 * We compileAsync (Bloom linear + canvas) then actually render into a 1x1
 * probe so Teleport Slam's first vanish is a cache hit.
 *
 * Call this whenever a new loadout enters the scene: the local avatar, an
 * equipment change, or a remote player appearing. Repeats for a key already
 * seen are skipped.
 */
export async function warmCharacterOpacityVariants(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  characterRoot: THREE.Object3D,
  loadoutKey = "default",
): Promise<void> {
  if (warmedOpacityLoadouts.has(loadoutKey)) return;
  warmedOpacityLoadouts.add(loadoutKey);

  const dummy = cloneOpacityWarmDummy(characterRoot);
  scene.add(dummy);

  const probe = new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = gl.getRenderTarget();
  try {
    // Cloak 0.32 and slam fade both use transparent + depthWrite off.
    // Draw at 0.01 so the GPU actually links; opacity 0 can skip the mesh.
    setCharacterOpacity(dummy, 0.32);
    await compileLiveScene(gl, scene, camera);
    setCharacterOpacity(dummy, 0.01);
    dummy.visible = true;
    gl.setRenderTarget(probe);
    gl.render(scene, camera);
  } catch {
    warmedOpacityLoadouts.delete(loadoutKey);
    // Best-effort — a missed warm costs a hitch, not correctness.
  } finally {
    gl.setRenderTarget(previousTarget);
    probe.dispose();
    scene.remove(dummy);
    disposeCharacterMaterials(dummy);
  }
}

/**
 * Wait until the avatar is in the graph (and skins have a couple of frames
 * to attach), then compile ghosted programs. Returns a cancel for unmount.
 */
export function scheduleWarmCharacterOpacityVariants(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  characterRoot: THREE.Object3D,
  loadoutKey = "default",
): () => void {
  let cancelled = false;
  let raf = 0;
  let left = 3;
  const tick = () => {
    left -= 1;
    if (cancelled) return;
    if (left > 0) {
      raf = requestAnimationFrame(tick);
      return;
    }
    opacityWarmQueue = opacityWarmQueue.then(async () => {
      if (cancelled) return;
      try {
        await warmCharacterOpacityVariants(gl, scene, camera, characterRoot, loadoutKey);
      } catch {
        // Isolated — a missed warm is a hitch, not a stuck queue.
      }
    });
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/**
 * Dispose cloned materials allocated for a character scene instance.
 * Call on unmount of avatars, previews, decoys, or NPCs so GPU memory is reclaimed.
 */
export function disposeCharacterMaterials(characterRoot: THREE.Object3D | null | undefined): void {
  if (!characterRoot) return;
  characterRoot.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      m.dispose();
    }
  });
}
