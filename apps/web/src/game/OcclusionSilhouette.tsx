import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { listOccluders } from "./occlusionRegistry";

const CHEST_Y = 1.15;
const RAY_EVERY_MS = 50;
const HIDE_HOLD_MS = 90;
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function isSkinned(mesh: THREE.Mesh): mesh is THREE.SkinnedMesh {
  return (mesh as THREE.SkinnedMesh).isSkinnedMesh;
}

function collectSources(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj.userData.bbSilhouette) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.visible) return;
    const skinned = isSkinned(mesh);
    if (!skinned && !mesh.castShadow) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!skinned && mats.some((m) => m && m.transparent && m.opacity < 0.85)) return;
    out.push(mesh);
  });
  return out;
}

function attachGhost(src: THREE.Mesh, mat: THREE.Material): THREE.Mesh {
  const ghost = isSkinned(src)
    ? new THREE.SkinnedMesh(src.geometry, mat)
    : new THREE.Mesh(src.geometry, mat);
  if (isSkinned(src) && isSkinned(ghost)) {
    ghost.bind(src.skeleton, src.bindMatrix);
  }
  ghost.userData.bbSilhouette = true;
  ghost.frustumCulled = false;
  ghost.renderOrder = 48;
  ghost.castShadow = false;
  ghost.receiveShadow = false;
  ghost.raycast = () => {};
  ghost.visible = false;
  src.add(ghost);
  return ghost;
}

function sameSources(a: THREE.Mesh[], b: THREE.Mesh[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Flat-color body copy drawn on top of scenery when a prop sits between the
 * camera and this character. Same meshes / skeleton as the live avatar.
 */
export function OcclusionSilhouette({
  rootRef,
  color,
  enabled = true,
  getEnabled,
  chestHeight = CHEST_Y,
}: {
  rootRef: RefObject<THREE.Object3D | null>;
  color: string;
  enabled?: boolean;
  /** Live check (stealth / dead / vanish) without waiting on a React render. */
  getEnabled?: () => boolean;
  chestHeight?: number;
}) {
  const { camera } = useThree();
  const ghosts = useRef<THREE.Mesh[]>([]);
  const sources = useRef<THREE.Mesh[]>([]);
  const matRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const lastRayAt = useRef(0);
  const lastHitAt = useRef(0);
  const shown = useRef(false);

  useEffect(() => {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.52,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      side: THREE.FrontSide,
    });
    matRef.current = mat;
    return () => {
      for (const g of ghosts.current) {
        g.removeFromParent();
      }
      ghosts.current = [];
      sources.current = [];
      mat.dispose();
      matRef.current = null;
    };
  }, [color]);

  useFrame((state) => {
    const root = rootRef.current;
    const mat = matRef.current;
    if (!root || !mat) return;

    if (!enabled || !root.visible || (getEnabled && !getEnabled())) {
      lastHitAt.current = 0;
      if (shown.current) {
        for (const g of ghosts.current) g.visible = false;
        shown.current = false;
      }
      return;
    }

    const next = collectSources(root);
    if (!sameSources(sources.current, next)) {
      for (const g of ghosts.current) g.removeFromParent();
      ghosts.current = next.map((src) => attachGhost(src, mat));
      sources.current = next;
    }

    // Wall clock — R3F's clock resets when the shop / appearance Canvas
    // suspends the game frameloop, which would pin this overlay on forever.
    const now = performance.now();
    if (lastRayAt.current > 0 && now - lastRayAt.current > 500) {
      lastHitAt.current = 0;
    }
    if (now - lastRayAt.current >= RAY_EVERY_MS) {
      lastRayAt.current = now;
      root.getWorldPosition(_chest);
      root.getWorldScale(_scale);
      _chest.y += chestHeight * Math.max(0.35, _scale.y);
      _origin.copy(camera.position);
      _dir.copy(_chest).sub(_origin);
      const dist = _dir.length();
      if (dist > 0.4) {
        _dir.multiplyScalar(1 / dist);
        _ray.set(_origin, _dir);
        _ray.near = 0.35;
        _ray.far = Math.max(0.4, dist - 0.18);
        const hits = _ray.intersectObjects(listOccluders(), true);
        if (hits.length > 0) lastHitAt.current = now;
      }
    }

    const want = lastHitAt.current > 0 && now - lastHitAt.current < HIDE_HOLD_MS;
    if (want === shown.current) return;
    shown.current = want;
    for (const g of ghosts.current) g.visible = want;
  }, -2);

  return null;
}
