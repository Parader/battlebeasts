import * as THREE from "three";
import {
  GEO_SPHERE_LO,
  GEO_SPHERE_MD,
  GEO_SPHERE_HI,
  GEO_SPHERE_TINY,
  GEO_OCTA,
  GEO_RING_IMPACT,
  GEO_LANCE_TIP,
  GEO_LANCE_SHAFT,
  GEO_SPIKE_STALK,
  GEO_SPIKE_KNOB,
  GEO_SPIKE_THORN,
  GEO_SPIKE_TIP,
  GEO_SPIKE_MIST,
} from "./sharedGeo";
import {
  GEO_SOUL_OUTER_RING,
  GEO_SOUL_INNER_RING,
  GEO_SOUL_SHOCK_RING,
  GEO_SOUL_VERT_RING,
  GEO_SOUL_RUNE_ARM,
  GEO_SOUL_CENTER,
} from "./effects/soulMarkPalette";

const sharedGeometries = new Set<THREE.BufferGeometry>([
  GEO_SPHERE_LO,
  GEO_SPHERE_MD,
  GEO_SPHERE_HI,
  GEO_SPHERE_TINY,
  GEO_OCTA,
  GEO_RING_IMPACT,
  GEO_LANCE_TIP,
  GEO_LANCE_SHAFT,
  GEO_SPIKE_STALK,
  GEO_SPIKE_KNOB,
  GEO_SPIKE_THORN,
  GEO_SPIKE_TIP,
  GEO_SPIKE_MIST,
  GEO_SOUL_OUTER_RING,
  GEO_SOUL_INNER_RING,
  GEO_SOUL_SHOCK_RING,
  GEO_SOUL_VERT_RING,
  GEO_SOUL_RUNE_ARM,
  GEO_SOUL_CENTER,
]);

export function registerSharedGeometry(geo: THREE.BufferGeometry): void {
  sharedGeometries.add(geo);
}

export function isSharedGeometry(geo: THREE.BufferGeometry | undefined | null): boolean {
  if (!geo) return false;
  return sharedGeometries.has(geo) || Boolean(geo.userData?.shared);
}

const sharedMaterials = new Set<THREE.Material>();

export function registerSharedMaterial(mat: THREE.Material): void {
  sharedMaterials.add(mat);
}

export function isSharedMaterial(mat: THREE.Material | undefined | null): boolean {
  if (!mat) return false;
  return sharedMaterials.has(mat) || Boolean(mat.userData?.shared);
}

/**
 * Traverses a Three.js hierarchy and disposes all non-shared geometries and materials.
 * Call on unmount of one-shot effects, persistent summons, and custom spell meshes.
 */
export function disposeVfxHierarchy(root: THREE.Object3D | null | undefined): void {
  if (!root) return;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as unknown as { isPoints?: boolean }).isPoints || (obj as unknown as { isLine?: boolean }).isLine) {
      const geo = mesh.geometry;
      if (geo && !isSharedGeometry(geo)) {
        geo.dispose();
      }
      const mat = mesh.material;
      if (mat) {
        if (Array.isArray(mat)) {
          for (const m of mat) {
            if (!isSharedMaterial(m)) m.dispose();
          }
        } else {
          if (!isSharedMaterial(mat)) mat.dispose();
        }
      }
    }
  });
}
