import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ROCK_WALL_CAST } from "@battlebeasts/shared";
import { assetUrl } from "../assetUrl";

/** Poly Pizza forest rock pile — barrier silhouette for Rock Wall. */
export const ROCK_WALL_GLB_URL = assetUrl(
  "assets/props/forest/PP_Rock_Pile_Forest_02.glb",
);

/**
 * Max axis per pile. Wall is ~3m wide × ~2.2m tall — three piles along
 * the length should read as a barrier without becoming planet-sized.
 */
export const ROCK_WALL_PILE_TARGET_SIZE = Math.min(
  ROCK_WALL_CAST.wallHeight * 0.95,
  ROCK_WALL_CAST.wallWidth * 0.55,
);

/** How many piles along the wall length. */
export const ROCK_WALL_PILE_COUNT = 3;

useGLTF.preload(ROCK_WALL_GLB_URL);

function nodeHasMesh(node: THREE.Object3D): boolean {
  let found = false;
  node.traverse((o) => {
    if (found) return;
    if ((o as THREE.Mesh).isMesh) found = true;
  });
  return found;
}

/** Prefer a mesh-bearing child; fall back to the whole scene. */
export function pickRockPileTemplate(root: THREE.Object3D): THREE.Object3D {
  for (const child of root.children) {
    if (nodeHasMesh(child)) return child;
  }
  return root;
}

/**
 * Keep lit PBR (scene sun/fill), not MeshBasic — Basic looked flat.
 * Stone-tune metal/rough; light emissive floor so deep shadow isn't a black slab.
 */
function prepareRockMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const prep = (mat: THREE.Material): THREE.Material => {
      const next = mat.clone();
      next.fog = false;
      next.toneMapped = true;
      if ("depthWrite" in next) (next as THREE.MeshStandardMaterial).depthWrite = true;
      const std = next as THREE.MeshStandardMaterial;
      if ("metalness" in std) {
        std.metalness = Math.min(std.metalness ?? 0, 0.08);
        std.roughness = Math.max(std.roughness ?? 0.85, 0.82);
        // Soft fill so unlit faces still read form without looking emissive.
        const e = std.emissive?.clone?.() ?? new THREE.Color(0, 0, 0);
        e.r = Math.max(e.r, 0.04);
        e.g = Math.max(e.g, 0.038);
        e.b = Math.max(e.b, 0.035);
        std.emissive = e;
        std.emissiveIntensity = Math.max(std.emissiveIntensity ?? 1, 0.35);
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
 * Clone + fit a rock pile: keep authored nested scale, pivot on ground,
 * uniform-scale so max axis equals `targetSize`. Never call setScalar on
 * the result afterward — animate via a parent group instead.
 */
export function cloneFittedRockPile(
  gltfScene: THREE.Object3D,
  targetSize = ROCK_WALL_PILE_TARGET_SIZE,
  yawJitter = 0,
): THREE.Group {
  const wrapper = new THREE.Group();
  const template = pickRockPileTemplate(gltfScene);
  const clone = template.clone(true);
  prepareRockMaterials(clone);

  // Drop placement only — keep PP nested scale / upright quat.
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
  // Cap fit so a tiny authored mesh can't explode into a planet.
  const fit = Math.min(targetSize / maxAxis, 12);

  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= box.min.y;

  wrapper.scale.setScalar(fit);
  wrapper.rotation.y = yawJitter;
  wrapper.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(wrapper);
  if (!fitted.isEmpty()) {
    wrapper.position.y -= fitted.min.y;
  }

  wrapper.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
  });

  return wrapper;
}

/** Build the wall row: fitted piles spaced along local +Z (wall length). */
export function instantiateRockWallPiles(
  gltfScene: THREE.Object3D,
  seed = 0,
): THREE.Group {
  const row = new THREE.Group();
  const halfLen = ROCK_WALL_CAST.wallWidth * 0.5;
  const count = ROCK_WALL_PILE_COUNT;
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0.5 : i / (count - 1);
    const along = (t - 0.5) * halfLen * 1.7;
    const across = ((i % 2) - 0.5) * ROCK_WALL_CAST.wallThickness * 0.35;
    const yaw = ((seed + i) * 1.7 + 0.4) % (Math.PI * 2);
    const sizeJitter = 0.9 + ((seed + i) % 3) * 0.08;
    const pile = cloneFittedRockPile(
      gltfScene,
      ROCK_WALL_PILE_TARGET_SIZE * sizeJitter,
      yaw,
    );
    pile.position.x = across;
    pile.position.z = along;
    // Stagger rise phases via userData for the animator.
    pile.userData.phase = i * 0.12;
    pile.userData.baseY = pile.position.y;
    row.add(pile);
  }
  return row;
}

export function warmRockWallAssets(gltfScene: THREE.Object3D): void {
  const probe = cloneFittedRockPile(gltfScene);
  probe.traverse(() => {});
}
