import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { acquireEnergyBallMaterial, acquireEnergyRingMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { RuneDecal } from "../components/RuneDecal";
import { GEO_RING_IMPACT, GEO_SPHERE_HI, GEO_SPHERE_MD } from "../sharedGeo";
import { useSpellLight } from "../spellLights";

/** Radial flash + particles + rune decal on bolt hit — soft appear. */
export function BoltImpactEffect({ shot }: { shot: OneShotEffect }) {
  const group = useRef<THREE.Group>(null);
  const flashMat = useMemo(() => acquireEnergyBallMaterial(shot.color, 0), [shot.color]);
  const glowMat = useMemo(() => acquireEnergyBallMaterial(shot.color, 0), [shot.color]);
  const ringMat = useMemo(() => acquireEnergyRingMaterial(shot.color, 0), [shot.color]);
  const ring = useRef<THREE.Mesh>(null);
  const light = useSpellLight();

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / shot.life;
    if (age >= 1) {
      g.visible = false;
      light.off();
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
    light.emit(shot.x, shot.y, shot.z, shot.color, amp * 5, 7);

    const core = g.children[0] as THREE.Mesh | undefined;
    const glow = g.children[1] as THREE.Mesh | undefined;
    if (core) core.scale.setScalar(flashScale * 0.22);
    if (glow) glow.scale.setScalar(flashScale * 0.22 * 1.55);
  });

  return (
    <group ref={group} position={[shot.x, shot.y, shot.z]}>
      <mesh scale={0.25 * 0.22} geometry={GEO_SPHERE_HI} material={flashMat} />
      <mesh scale={0.25 * 0.22} geometry={GEO_SPHERE_MD} material={glowMat} />
      <mesh
        ref={ring}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -shot.y + 0.06, 0]}
        scale={0.35}
        geometry={GEO_RING_IMPACT}
        material={ringMat}
      />
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
