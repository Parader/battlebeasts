import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  createCastAimSkillshotMaterial,
  setCastAimSkillshotOpacity,
  tickCastAimSkillshotMaterial,
  tintCastAimSkillshotMaterial,
} from "../materials/castAimSkillshot";

const sharedGeo = new THREE.PlaneGeometry(1, 1);

/**
 * Fixed-length direction skillshot (fireball / bolt) — shaft, chevrons, arrow tip.
 * Parent should sit at corridor midpoint with yaw = facing.
 */
export function CastAimSkillshot({
  length,
  halfWidth,
  color,
  hotColor,
  opacity = 0.85,
  opacityMulRef,
  y = 0.032,
}: {
  length: number;
  halfWidth: number;
  color: string;
  hotColor?: string;
  opacity?: number;
  opacityMulRef?: { current: number };
  y?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => createCastAimSkillshotMaterial({ color, hotColor }), []);

  useEffect(() => {
    tintCastAimSkillshotMaterial(mat, color, hotColor);
  }, [mat, color, hotColor]);

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    tickCastAimSkillshotMaterial(mat, dt);
    const mul = (opacityMulRef?.current ?? 1) * opacity;
    setCastAimSkillshotOpacity(mat, mul);
    m.visible = mul > 0.02;
  });

  const w = Math.max(0.2, halfWidth) * 2;
  const len = Math.max(1, length);

  return (
    <mesh
      ref={mesh}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[w, len, 1]}
      geometry={sharedGeo}
      material={mat}
      renderOrder={2}
      frustumCulled={false}
    />
  );
}
