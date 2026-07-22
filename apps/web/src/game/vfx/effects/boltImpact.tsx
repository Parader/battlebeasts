import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { createEnergyBallMaterial, createEnergyRingMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { RuneDecal } from "../components/RuneDecal";

/** Radial flash + particles + rune decal on bolt hit — soft appear. */
export function BoltImpactEffect({ shot }: { shot: OneShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const flashMat = useMemo(() => createEnergyBallMaterial(shot.color, 0), [shot.color]);
  const glowMat = useMemo(() => createEnergyBallMaterial(shot.color, 0), [shot.color]);
  const ringMat = useMemo(() => createEnergyRingMaterial(shot.color, 0), [shot.color]);
  const ring = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / shot.life;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const amp = softEnvelope(age, 0.28, 0.45);
    const flashScale = 0.25 + amp * 1.35;
    flashMat.opacity = amp;
    glowMat.opacity = amp * 0.45;

    if (ring.current) {
      const r = 0.35 + softstepRing(age) * 1.8;
      ring.current.scale.set(r, r, 1);
      ringMat.opacity = amp * 0.85;
    }
    if (light.current) light.current.intensity = amp * 5;

    const core = g.children[0] as THREE.Mesh | undefined;
    const glow = g.children[1] as THREE.Mesh | undefined;
    if (core) core.scale.setScalar(flashScale);
    if (glow) glow.scale.setScalar(flashScale * 1.55);
  });

  return (
    <group ref={group} position={[shot.x, shot.y, shot.z]}>
      <mesh scale={0.25}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <primitive object={flashMat} attach="material" />
      </mesh>
      <mesh scale={0.25}>
        <sphereGeometry args={[0.22, 10, 10]} />
        <primitive object={glowMat} attach="material" />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -shot.y + 0.06, 0]} scale={0.35}>
        <ringGeometry args={[0.25, 0.55, 32]} />
        <primitive object={ringMat} attach="material" />
      </mesh>
      <pointLight ref={light} color={shot.color} intensity={0} distance={7} decay={2} />
      <AdditiveParticleBurst
        color={shot.color}
        origin={[0, 0, 0]}
        count={16}
        life={0.45}
        speed={2.8}
        speedSpread={1.2}
        size={0.14}
        sizeEnd={0.025}
        lift={1.2}
        upBias={0.3}
        fadeIn={0.28}
        stagger={0.25}
        trigger={shot.key}
      />
      <group position={[0, -shot.y, 0]}>
        <RuneDecal color={shot.color} size={1.1} born={shot.born} life={shot.life} spin={1.1} />
      </group>
    </group>
  );
}

function softstepRing(t: number): number {
  return THREE.MathUtils.smoothstep(t, 0, 0.55);
}
