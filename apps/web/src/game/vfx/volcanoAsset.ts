import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { assetUrl } from "../assetUrl";

export const VOLCANO_GLB_URL = assetUrl("assets/vfx/volcano.glb");

/** Max axis length in world units after fit (≈ collide diameter). */
export const VOLCANO_TARGET_SIZE = 3.75;
/** Thrown boulder max axis — readable but not planet-sized. */
export const BOULDER_TARGET_SIZE = 0.7;

const VOLCANO_MESH_NAMES = ["PP_Volcano_Lava_09", "PP_Volcano_Lava_09.001"];
const BOULDER_MESH_NAMES = [
  "PP_Stone_Lava_06",
  "PP_Stone_Lava_08",
  "PP_Stone_Lava_09",
  "PP_Stone_Lava_06.001",
  "PP_Stone_Lava_08.001",
  "PP_Stone_Lava_09.001",
];

useGLTF.preload(VOLCANO_GLB_URL);

function findNamedNodes(root: THREE.Object3D, names: string[]): THREE.Object3D[] {
  const want = new Set(names);
  const found: THREE.Object3D[] = [];
  const seen = new Set<string>();
  root.traverse((o) => {
    if (!want.has(o.name) || seen.has(o.name)) return;
    seen.add(o.name);
    found.push(o);
  });
  return found;
}

/**
 * Prefer the wrapper node (e.g. `.001`) when it parents the mesh —
 * Poly Pizza puts tiny mesh scale under a ~0.25 parent scale.
 */
export function pickVolcanoTemplate(root: THREE.Object3D): THREE.Object3D | null {
  const nodes = findNamedNodes(root, VOLCANO_MESH_NAMES);
  const wrapper = nodes.find((n) => n.name.endsWith(".001") && n.children.length > 0);
  if (wrapper) return wrapper;
  return nodes.find((n) => oIsMesh(n) || n.children.length > 0) ?? nodes[0] ?? null;
}

function oIsMesh(n: THREE.Object3D): boolean {
  return (n as THREE.Mesh).isMesh === true;
}

/** Prefer actual mesh stones (not empty `.001` placeholders). */
export function pickBoulderTemplates(root: THREE.Object3D): THREE.Object3D[] {
  const all = findNamedNodes(root, BOULDER_MESH_NAMES);
  const withGeom = all.filter((n) => {
    let hasMesh = false;
    n.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) hasMesh = true;
    });
    return hasMesh;
  });
  const byBase = new Map<string, THREE.Object3D>();
  for (const m of withGeom) {
    const base = m.name.replace(/\.00\d+$/, "");
    const isWrapper = m.name.includes(".00");
    const prev = byBase.get(base);
    if (!prev) {
      byBase.set(base, m);
      continue;
    }
    if (prev.name.includes(".00") && !isWrapper) byBase.set(base, m);
  }
  return [...byBase.values()].slice(0, 3);
}

type FitOpts = {
  /**
   * Poly Pizza volcano is authored flat in XY (height ≈ Z).
   * Rotate so height stands on +Y before measuring bounds.
   */
  uprightVolcano?: boolean;
  /** Clone materials (volcano once). Rocks share materials from the prototype. */
  cloneMats?: boolean;
  /**
   * Pivot at bbox center (tumbling rocks) instead of bottom-on-ground (volcano).
   * Bottom pivot + spin makes arcs look sideways-offset.
   */
  centerPivot?: boolean;
};

/** Bake PP PBR into MeshBasic — avoids env/IBL hitch flashes and dark unlit frames. */
function toBasicMaterial(src: THREE.Material): THREE.MeshBasicMaterial {
  const any = src as THREE.MeshStandardMaterial & {
    map?: THREE.Texture | null;
    color?: THREE.Color;
    emissiveMap?: THREE.Texture | null;
    emissive?: THREE.Color;
    opacity?: number;
    transparent?: boolean;
    alphaTest?: number;
    side?: THREE.Side;
  };
  const mat = new THREE.MeshBasicMaterial({
    map: any.map ?? any.emissiveMap ?? null,
    color: any.color?.clone?.() ?? new THREE.Color("#ffffff"),
    transparent: Boolean(any.transparent),
    opacity: any.opacity ?? 1,
    alphaTest: any.alphaTest ?? 0,
    side: any.side ?? THREE.FrontSide,
    toneMapped: true,
    depthWrite: true,
  });
  if (any.emissiveMap && !any.map) {
    mat.color.multiply(any.emissive ?? new THREE.Color("#ffffff"));
  }
  return mat;
}

function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((mat) => toBasicMaterial(mat));
    } else if (mesh.material) {
      mesh.material = toBasicMaterial(mesh.material);
    }
  });
}

/**
 * Clone a GLB subtree, optionally upright, center on XZ with bottom at y=0,
 * and uniform-scale so the largest axis equals `targetSize`.
 */
export function cloneFittedTemplate(
  src: THREE.Object3D,
  targetSize: number,
  opts: FitOpts = {},
): THREE.Object3D {
  const wrapper = new THREE.Group();
  wrapper.name = `${src.name}_fitted`;

  const clone = src.clone(true);
  if (opts.cloneMats !== false) cloneMaterials(clone);

  // Drop authoring placement offsets — we re-center from bounds.
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.quaternion.identity();
  // Keep clone.scale (PP nested scales).

  if (opts.uprightVolcano) {
    // Mesh extents are large in X/Y and shorter in Z — tip points along Z.
    // +90° X: previous -90° left it upside-down.
    clone.rotation.x = Math.PI / 2;
  }

  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  if (box.isEmpty()) return wrapper;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
  const fit = targetSize / maxDim;

  if (opts.centerPivot) {
    clone.position.x -= center.x;
    clone.position.y -= center.y;
    clone.position.z -= center.z;
  } else {
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box.min.y;
  }

  wrapper.scale.setScalar(fit);
  wrapper.updateMatrixWorld(true);

  if (!opts.centerPivot) {
    const box2 = new THREE.Box3().setFromObject(wrapper);
    if (!box2.isEmpty()) {
      wrapper.position.y -= box2.min.y;
    }
  }

  return wrapper;
}

/** Cached fitted boulder protos — avoid Box3 on huge PP meshes every rock. */
let boulderProtos: THREE.Object3D[] | null = null;
let boulderProtoSource: THREE.Object3D | null = null;
/** Bump when fit opts change so HMR doesn't keep bottom-pivoted protos. */
const BOULDER_PROTO_REV = 3;
let boulderProtoRev = -1;

/** Pre-cloned instances for first fireball / magma casts after warm. */
const BOULDER_POOL_TARGET = 2;
const boulderInstancePool: THREE.Object3D[] = [];

function ensureBoulderProtos(gltfScene: THREE.Object3D): THREE.Object3D[] {
  if (
    boulderProtos &&
    boulderProtoSource === gltfScene &&
    boulderProtoRev === BOULDER_PROTO_REV
  ) {
    return boulderProtos;
  }
  boulderInstancePool.length = 0;
  const templates = pickBoulderTemplates(gltfScene);
  boulderProtos = templates.map((t) =>
    cloneFittedTemplate(t, BOULDER_TARGET_SIZE, {
      cloneMats: true,
      uprightVolcano: false,
      centerPivot: true,
    }),
  );
  boulderProtoSource = gltfScene;
  boulderProtoRev = BOULDER_PROTO_REV;
  return boulderProtos;
}

function cloneBoulderFromProto(proto: THREE.Object3D, index: number): THREE.Object3D {
  const inst = proto.clone(true);
  const jitter = 0.92 + (index % 7) * 0.025;
  inst.scale.multiplyScalar(jitter);
  return inst;
}

/**
 * Cheap instance of a pre-fitted boulder (shared materials).
 * Call once per rock — never re-runs bounds fitting.
 * Prefers a warm pool entry when available.
 */
export function instantiateBoulder(
  gltfScene: THREE.Object3D,
  index: number,
): THREE.Object3D | null {
  const pooled = boulderInstancePool.pop();
  if (pooled) return pooled;

  const protos = ensureBoulderProtos(gltfScene);
  if (protos.length === 0) return null;
  const proto = protos[index % protos.length]!;
  return cloneBoulderFromProto(proto, index);
}

/** Warm boulder protos during volcano spawn so first rock doesn't hitch. */
export function warmVolcanoAssets(gltfScene: THREE.Object3D): void {
  const protos = ensureBoulderProtos(gltfScene);
  // Pre-pool a couple clones so first fireball / magma skip clone(true).
  let i = 0;
  while (boulderInstancePool.length < BOULDER_POOL_TARGET && protos.length > 0) {
    const proto = protos[i % protos.length]!;
    boulderInstancePool.push(cloneBoulderFromProto(proto, i));
    i += 1;
  }
  // Also fit volcano once into a discarded group so GPU shaders compile early.
  const v = pickVolcanoTemplate(gltfScene);
  if (v) {
    const fitted = cloneFittedTemplate(v, VOLCANO_TARGET_SIZE, {
      uprightVolcano: true,
      cloneMats: true,
    });
    fitted.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = true;
    });
  }
}

/** @deprecated use cloneFittedTemplate */
export function cloneMeshTemplate(src: THREE.Object3D): THREE.Object3D {
  return cloneFittedTemplate(src, VOLCANO_TARGET_SIZE, { uprightVolcano: true });
}
