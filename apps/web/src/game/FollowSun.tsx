import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";

/** Fixed sun direction (normalized), world-space. */
const SUN_DIR = new THREE.Vector3(0.45, 0.85, 0.28).normalize();
/** How far the light sits from the follow point along SUN_DIR. */
const SUN_DISTANCE = 45;

type Props = {
  /** Player / focus point the shadow volume should track. */
  follow: MutableRefObject<THREE.Vector3>;
  intensity?: number;
  color?: string;
};

/**
 * Directional sun that follows the player so the shadow camera never
 * leaves them behind (fixes the hard shadow cutoff line).
 */
/** Snap the shadow volume on a grid so walking does not rebake every frame. */
const SHADOW_SNAP_M = 4;

export function FollowSun({ follow, intensity = 1.2, color = "#fff2d8" }: Props) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const tmp = useRef(new THREE.Vector3());
  const snapped = useRef({ x: Number.NaN, z: Number.NaN });

  useFrame(() => {
    const light = lightRef.current;
    const t = follow.current;
    if (!light || !t) return;

    const sx = Math.round(t.x / SHADOW_SNAP_M) * SHADOW_SNAP_M;
    const sz = Math.round(t.z / SHADOW_SNAP_M) * SHADOW_SNAP_M;
    if (snapped.current.x === sx && snapped.current.z === sz) return;
    snapped.current.x = sx;
    snapped.current.z = sz;

    tmp.current.copy(SUN_DIR).multiplyScalar(SUN_DISTANCE);
    light.position.set(sx + tmp.current.x, tmp.current.y, sz + tmp.current.z);
    light.target.position.set(sx, 0, sz);
    light.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow
      intensity={intensity}
      color={color}
      position={[12, 18, 8]}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.00015}
      shadow-normalBias={0.035}
      shadow-camera-near={1}
      shadow-camera-far={160}
      shadow-camera-left={-45}
      shadow-camera-right={45}
      shadow-camera-top={45}
      shadow-camera-bottom={-45}
    >
      <object3D attach="target" position={[0, 0, 0]} />
    </directionalLight>
  );
}
