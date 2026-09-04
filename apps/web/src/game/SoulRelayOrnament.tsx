import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createRuneMaterial, tickRuneMaterial } from "./vfx/materials/rune";

const GREEN = "#58B879";
const GOLD = "#A9D978";

type Props = {
  /** True when soulRelayLinked status is active on this unit. */
  getActive: () => boolean;
  /** Remaining relay duration fraction (0–1) for urgency pulse. */
  getRemainFrac?: () => number;
};

/**
 * Persistent Soul Relay mark — ground sigil under the linked target.
 */
export function SoulRelayOrnament({ getActive, getRemainFrac }: Props) {
  const root = useRef<THREE.Group>(null);
  const rune = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);

  const runeMat = useMemo(
    () => createRuneMaterial(GOLD, { opacity: 0, spokes: 6 }),
    [],
  );
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GREEN,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      runeMat.dispose();
      ringMat.dispose();
    },
    [runeMat, ringMat],
  );

  const fade = useRef(0);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const active = getActive();
    const target = active ? 1 : 0;
    fade.current = THREE.MathUtils.clamp(fade.current + (target - fade.current) * dt * 8, 0, 1);
    g.visible = fade.current > 0.01;
    if (!g.visible) return;

    tickRuneMaterial(runeMat, dt);
    const remain = getRemainFrac?.() ?? 1;
    const urgency = remain < 0.25 ? 1 + (1 - remain / 0.25) * 0.55 : 1;
    const pulse = 0.72 + 0.28 * Math.sin(performance.now() * 0.0032 * urgency);

    runeMat.uniforms.uOpacity!.value = 0.42 * pulse * fade.current;
    ringMat.opacity = 0.22 * pulse * fade.current;
    if (rune.current) {
      rune.current.rotation.z += dt * 0.35 * urgency;
    }
    if (ring.current) {
      const s = 0.95 + 0.08 * Math.sin(performance.now() * 0.004);
      ring.current.scale.set(s, s, 1);
    }
  });

  return (
    <group ref={root} position={[0, 0.03, 0]} visible={false}>
      <mesh ref={rune} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[0.55, 32]} />
        <primitive object={runeMat} attach="material" />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3} material={ringMat}>
        <ringGeometry args={[0.48, 0.62, 28]} />
      </mesh>
    </group>
  );
}
