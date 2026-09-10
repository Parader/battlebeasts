import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";

/** Fixed sun direction (normalized), world-space. */
const SUN_DIR = new THREE.Vector3(0.45, 0.85, 0.28).normalize();
/** How far the light sits from the follow point along SUN_DIR. */
const SUN_DISTANCE = 55;

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
  const camera = useThree((s) => s.camera);
  const tmp = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const snapped = useRef({ x: Number.NaN, z: Number.NaN });

  useFrame(() => {
    const light = lightRef.current;
    const t = follow.current;
    if (!light || !t) return;

    // Extreme cursor pull looks tens of metres past the player. Centering
    // the ortho box on their feet left the far side of the screen outside
    // the volume — a hard lit/shadowed seam that crawled with the mouse.
    let fx = t.x;
    let fz = t.z;
    camera.getWorldDirection(look.current);
    if (look.current.y < -0.05) {
      const hit = -camera.position.y / look.current.y;
      if (hit > 0 && hit < 160) {
        fx = camera.position.x + look.current.x * hit;
        fz = camera.position.z + look.current.z * hit;
      }
    }
    const cx = t.x + (fx - t.x) * 0.55;
    const cz = t.z + (fz - t.z) * 0.55;

    const sx = Math.round(cx / SHADOW_SNAP_M) * SHADOW_SNAP_M;
    const sz = Math.round(cz / SHADOW_SNAP_M) * SHADOW_SNAP_M;
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
      shadow-bias={-0.0002}
      shadow-normalBias={0.05}
      shadow-camera-near={1}
      shadow-camera-far={180}
      shadow-camera-left={-70}
      shadow-camera-right={70}
      shadow-camera-top={70}
      shadow-camera-bottom={-70}
    >
      <object3D attach="target" position={[0, 0, 0]} />
    </directionalLight>
  );
}
