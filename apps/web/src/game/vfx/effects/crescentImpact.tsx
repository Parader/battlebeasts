import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";

const BLOOD = "#9f1239";
const BLOOD_DARK = "#4c0519";

/**
 * Crescent hit — short blood spray at the target (chest height).
 * Directional outward burst + fine droplets; no magic ring/rune.
 */
export function CrescentImpactEffect({ shot }: { shot: OneShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const flashMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const mistMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD_DARK,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / shot.life;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const amp = softEnvelope(age, 0.18, 0.55);
    flashMat.opacity = amp * 0.85;
    mistMat.opacity = amp * 0.4;

    const core = g.children[0] as THREE.Mesh | undefined;
    const mist = g.children[1] as THREE.Mesh | undefined;
    if (core) core.scale.setScalar(0.18 + amp * 0.55);
    if (mist) mist.scale.setScalar(0.35 + amp * 0.9);
  });

  return (
    <group ref={group} position={[shot.x, shot.y, shot.z]} rotation={[0, shot.yaw, 0]}>
      <mesh scale={0.2}>
        <sphereGeometry args={[0.16, 10, 10]} />
        <primitive object={flashMat} attach="material" />
      </mesh>
      <mesh scale={0.35}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <primitive object={mistMat} attach="material" />
      </mesh>
      {/* Main arterial spray */}
      <AdditiveParticleBurst
        color={BLOOD}
        origin={[0, 0, 0]}
        count={22}
        life={0.38}
        speed={3.4}
        speedSpread={2.2}
        size={0.16}
        sizeEnd={0.03}
        lift={0.9}
        upBias={0.22}
        fadeIn={0.12}
        stagger={0.18}
        trigger={shot.key}
      />
      {/* Heavier droplets */}
      <AdditiveParticleBurst
        color={BLOOD_DARK}
        origin={[0, -0.05, 0]}
        count={10}
        life={0.48}
        speed={1.6}
        speedSpread={1.1}
        size={0.11}
        sizeEnd={0.04}
        lift={0.35}
        upBias={0.08}
        fadeIn={0.2}
        stagger={0.3}
        trigger={shot.key}
      />
    </group>
  );
}
