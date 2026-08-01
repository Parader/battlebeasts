import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { assetUrl } from "../assetUrl";

/** Ally / enemy shrooms — separate exports so colors can't share atlas UVs. */
export const SHROOM_GREEN_GLB_URL = assetUrl("assets/vfx/shroom_green.glb");
export const SHROOM_RED_GLB_URL = assetUrl("assets/vfx/shroom_red.glb");

/** @deprecated Prefer SHROOM_GREEN_GLB_URL / SHROOM_RED_GLB_URL. */
export const SHROOMS_GLB_URL = SHROOM_GREEN_GLB_URL;

/** World height of a fully grown shroom. */
export const SHROOM_TARGET_SIZE = 0.95;

useGLTF.preload(SHROOM_GREEN_GLB_URL);
useGLTF.preload(SHROOM_RED_GLB_URL);

export type ShroomColor = "green" | "red";

type ShroomTemplateCache = {
  green: THREE.Object3D[];
  red: THREE.Object3D[];
};

/** Mesh roots from a single-color GLB (may contain multiple shape variants). */
function collectMeshRoots(root: THREE.Object3D): THREE.Object3D[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const seen = new Set<THREE.Object3D>();
  const out: THREE.Object3D[] = [];
  for (const mesh of meshes) {
    let node: THREE.Object3D = mesh;
    if (mesh.parent && /agaric|fly|shroom/i.test(mesh.parent.name)) node = mesh.parent;
    else if (mesh.parent && mesh.parent !== root && mesh.parent.children.length <= 3) {
      node = mesh.parent;
    }
    if (seen.has(node)) continue;
    seen.add(node);
    out.push(node);
  }
  // Single-node files: use the scene children / root mesh itself.
  if (!out.length && (root as THREE.Mesh).isMesh) out.push(root);
  if (!out.length) {
    for (const child of root.children) {
      if (nodeHasMesh(child)) out.push(child);
    }
  }
  return out;
}

function nodeHasMesh(node: THREE.Object3D): boolean {
  let found = false;
  node.traverse((o) => {
    if (found) return;
    if ((o as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

/** Clone authored mats; disable fog so arena fog doesn't turn caps into black slabs. */
function prepareShroomMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    const prep = (mat: THREE.Material) => {
      const next = mat.clone();
      next.fog = false;
      next.toneMapped = true;
      if ("depthWrite" in next) (next as THREE.MeshStandardMaterial).depthWrite = true;
      return next;
    };
    if (Array.isArray(m.material)) {
      m.material = m.material.map(prep);
    } else {
      m.material = prep(m.material);
    }
  });
}

/**
 * Fit a mushroom template into a unit-ish world size, pivot on ground.
 * Mesh nodes already carry +90° X + 0.01 scale from authoring.
 */
export function cloneFittedShroom(
  template: THREE.Object3D,
  targetSize = SHROOM_TARGET_SIZE,
  cloneMats = true,
): THREE.Group {
  const wrapper = new THREE.Group();
  const clone = template.clone(true);

  if (cloneMats) prepareShroomMaterials(clone);

  // Clear placement only — keep authored 0.01 scale + upright quat on the mesh.
  clone.position.set(0, 0, 0);

  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  if (box.isEmpty()) return wrapper;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxAxis = Math.max(size.x, size.y, size.z, 1e-4);
  const s = Math.min(targetSize / maxAxis, 8);

  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= box.min.y;

  wrapper.scale.setScalar(s);
  wrapper.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(wrapper);
  if (!fitted.isEmpty()) {
    wrapper.position.y -= fitted.min.y;
  }

  return wrapper;
}

let cachedTemplates: ShroomTemplateCache | null = null;
let cachedGreenScene: THREE.Object3D | null = null;
let cachedRedScene: THREE.Object3D | null = null;

export function getShroomTemplates(
  greenScene: THREE.Object3D,
  redScene: THREE.Object3D,
): ShroomTemplateCache {
  if (
    cachedTemplates &&
    cachedGreenScene === greenScene &&
    cachedRedScene === redScene
  ) {
    return cachedTemplates;
  }
  cachedGreenScene = greenScene;
  cachedRedScene = redScene;
  const green = collectMeshRoots(greenScene);
  const red = collectMeshRoots(redScene);
  cachedTemplates = {
    green: green.length ? green : red,
    red: red.length ? red : green,
  };
  return cachedTemplates;
}

/** Clear cached roots after a GLB hot-reload. */
export function invalidateShroomTemplates(): void {
  cachedTemplates = null;
  cachedGreenScene = null;
  cachedRedScene = null;
}

/**
 * @param variant — shape index within the color pool (server-assigned).
 * @param color — ally = green GLB, enemy = red GLB.
 */
export function instantiateShroom(
  greenScene: THREE.Object3D,
  redScene: THREE.Object3D,
  variant: number,
  targetSize = SHROOM_TARGET_SIZE,
  color: ShroomColor = "red",
): THREE.Group | null {
  const templates = getShroomTemplates(greenScene, redScene);
  const pool = color === "green" ? templates.green : templates.red;
  if (!pool.length) return null;
  const tmpl = pool[Math.abs(variant) % pool.length]!;
  return cloneFittedShroom(tmpl, targetSize, true);
}

export function warmShroomAssets(
  greenScene: THREE.Object3D,
  redScene: THREE.Object3D,
): void {
  const templates = getShroomTemplates(greenScene, redScene);
  for (const pool of [templates.green, templates.red]) {
    for (let i = 0; i < pool.length; i++) {
      const g = cloneFittedShroom(pool[i]!, SHROOM_TARGET_SIZE, false);
      g.traverse(() => undefined);
    }
  }
}
