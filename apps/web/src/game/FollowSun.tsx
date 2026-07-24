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
};

/**
 * Directional sun that follows the player so the shadow camera never
 * leaves them behind (fixes the hard shadow cutoff line).
 */
export function FollowSun({ follow, intensity = 1.2 }: Props) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const tmp = useRef(new THREE.Vector3());

  useFrame(() => {
    const light = lightRef.current;
    const t = follow.current;
    if (!light || !t) return;

    tmp.current.copy(SUN_DIR).multiplyScalar(SUN_DISTANCE);
    light.position.set(t.x + tmp.current.x, tmp.current.y, t.z + tmp.current.z);
    light.target.position.set(t.x, 0, t.z);
    light.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow
      intensity={intensity}
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
