import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { assetUrl } from "../assetUrl";

export const SHROOMS_GLB_URL = assetUrl("assets/vfx/shrooms.glb");

/** World height of a fully grown shroom. */
export const SHROOM_TARGET_SIZE = 0.95;

useGLTF.preload(SHROOMS_GLB_URL);

export type ShroomColor = "green" | "red";

type ShroomTemplateCache = {
  green: THREE.Object3D[];
  red: THREE.Object3D[];
};

function colorFromName(name: string): ShroomColor | null {
  if (/\.green\b/i.test(name)) return "green";
  if (/\.red\b/i.test(name)) return "red";
  return null;
}

/** Fallback when the GLB has no .green / .red wrappers. */
function collectMeshRoots(root: THREE.Object3D): THREE.Object3D[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const seen = new Set<THREE.Object3D>();
  const out: THREE.Object3D[] = [];
  for (const mesh of meshes) {
    let node: THREE.Object3D = mesh;
    if (mesh.parent && /agaric|fly/i.test(mesh.parent.name)) node = mesh.parent;
    else if (mesh.parent && mesh.parent !== root && mesh.parent.children.length <= 3) {
      node = mesh.parent;
    }
    if (seen.has(node)) continue;
    seen.add(node);
    out.push(node);
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

function collectColoredTemplates(root: THREE.Object3D): ShroomTemplateCache {
  const green: THREE.Object3D[] = [];
  const red: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();

  root.traverse((o) => {
    const color = colorFromName(o.name);
    if (!color || !nodeHasMesh(o) || seen.has(o)) return;
    // Skip nested color wrappers if a parent already claimed this branch.
    let p: THREE.Object3D | null = o.parent;
    while (p) {
      if (seen.has(p)) return;
      p = p.parent;
    }
    seen.add(o);
    (color === "green" ? green : red).push(o);
  });

  if (!green.length && !red.length) {
    const all = collectMeshRoots(root);
    return { green: all, red: all };
  }
  if (!green.length) green.push(...red);
  if (!red.length) red.push(...green);
  return { green, red };
}

/** Fit a mushroom template into a unit-ish world size, pivot on ground. */
export function cloneFittedShroom(
  template: THREE.Object3D,
  targetSize = SHROOM_TARGET_SIZE,
  cloneMats = true,
): THREE.Group {
  const clone = template.clone(true);
  if (cloneMats) {
    clone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (Array.isArray(m.material)) {
        m.material = m.material.map((mat) => mat.clone());
      } else if (m.material) {
        m.material = m.material.clone();
      }
    });
  }

  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxAxis = Math.max(size.x, size.y, size.z, 1e-4);
  const s = targetSize / maxAxis;
  clone.scale.multiplyScalar(s);

  const fitted = new THREE.Box3().setFromObject(clone);
  const center = new THREE.Vector3();
  fitted.getCenter(center);
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= fitted.min.y;

  const group = new THREE.Group();
  group.add(clone);
  return group;
}

let cachedForScene: THREE.Object3D | null = null;
let cachedTemplates: ShroomTemplateCache | null = null;

export function getShroomTemplates(gltfScene: THREE.Object3D): ShroomTemplateCache {
  if (cachedTemplates && cachedForScene === gltfScene) return cachedTemplates;
  cachedForScene = gltfScene;
  cachedTemplates = collectColoredTemplates(gltfScene);
  return cachedTemplates;
}

/** Clear cached roots after a GLB hot-reload. */
export function invalidateShroomTemplates(): void {
  cachedForScene = null;
  cachedTemplates = null;
}

/**
 * @param variant — shape index within the color pool (server-assigned).
 * @param color — ally = green, enemy = red.
 */
export function instantiateShroom(
  gltfScene: THREE.Object3D,
  variant: number,
  targetSize = SHROOM_TARGET_SIZE,
  color: ShroomColor = "red",
): THREE.Group | null {
  const templates = getShroomTemplates(gltfScene);
  const pool = color === "green" ? templates.green : templates.red;
  if (!pool.length) return null;
  const tmpl = pool[Math.abs(variant) % pool.length]!;
  return cloneFittedShroom(tmpl, targetSize, true);
}

export function warmShroomAssets(gltfScene: THREE.Object3D): void {
  const templates = getShroomTemplates(gltfScene);
  for (const pool of [templates.green, templates.red]) {
    for (let i = 0; i < pool.length; i++) {
      const g = cloneFittedShroom(pool[i]!, SHROOM_TARGET_SIZE, false);
      g.traverse(() => undefined);
    }
  }
}
