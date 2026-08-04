import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES, HOLY_GROUND_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { createRuneMaterial, tickRuneMaterial } from "../materials/rune";
import { groundPresets } from "../presets/ground";

const GOLD = "#eab308";
const HOT = "#fef08a";

/**
 * Holy Ground — yellow hitbox rim, soft gold wash, central rune + light burst.
 * Kept light (no particle fields) so the long-lived zone does not stall WebGL.
 */
export function HolyGroundEffect({ shot }: { shot: OneShotEffect }) {
  const def = ABILITIES.holyGround;
  const radius = Math.max(
    1.5,
    shot.radius ?? def?.radius ?? HOLY_GROUND_CAST.radius,
  );
  const lifeMs = Math.max(
    1200,
    shot.life || HOLY_GROUND_CAST.zoneDurationMs + 200,
  );

  const rimOpacity = useRef(0);
  const fillOpacity = useRef(0);
  const runeMesh = useRef<THREE.Mesh>(null);
  const outerRuneMesh = useRef<THREE.Mesh>(null);

  const blotPreset = useMemo(
    () => ({
      ...groundPresets.frostBallAura,
      // Ice style is the stable long-zone wash (firewall aura uses the same).
      element: "ice" as const,
      shape: "circle" as const,
      colorCore: HOT,
      colorMid: GOLD,
      colorEdge: "#713f12",
      opacity: 0.78,
      additive: true,
      radius,
      lifeMs,
      ringWidth: 0.12,
      softness: 0.06,
      innerRatio: 0.08,
      breakup: 0.45,
      spin: 0.08,
      appearEnd: 0.05,
      fadeStart: 0.88,
    }),
    [radius, lifeMs],
  );

  const runeMat = useMemo(
    () => createRuneMaterial(HOT, { opacity: 0, spokes: 8 }),
    [],
  );
  const outerRuneMat = useMemo(
    () => createRuneMaterial(GOLD, { opacity: 0, spokes: 6 }),
    [],
  );
  useEffect(
    () => () => {
      runeMat.dispose();
      outerRuneMat.dispose();
    },
    [runeMat, outerRuneMat],
  );

  useFrame((_, dt) => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const env = softEnvelope(u, 0.05, 0.88);
    rimOpacity.current = env * 0.8;
    fillOpacity.current = env;

    tickRuneMaterial(runeMat, dt);
    tickRuneMaterial(outerRuneMat, dt);
    const pulse = 0.9 + 0.1 * Math.sin(performance.now() * 0.0035);
    runeMat.uniforms.uOpacity!.value = env * 0.85 * pulse;
    outerRuneMat.uniforms.uOpacity!.value = env * 0.45 * pulse;

    const rune = runeMesh.current;
    if (rune) {
      rune.visible = env > 0.02;
      rune.rotation.z += dt * 0.4;
      // Nearly fill the hit circle (plane size ≈ diameter).
      rune.scale.setScalar(radius * 1.85 * (0.94 + 0.06 * pulse));
    }
    const outer = outerRuneMesh.current;
    if (outer) {
      outer.visible = env > 0.02;
      outer.rotation.z -= dt * 0.28;
      outer.scale.setScalar(radius * 1.95 * (0.96 + 0.04 * pulse));
    }
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        color={GOLD}
        hotColor={HOT}
        fill={0.16}
        noise={0.2}
        glowWidth={0.055}
        opacity={0.65}
        opacityMulRef={rimOpacity}
      />

      <GroundDecal
        preset={blotPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.032}
        born={shot.born}
        life={lifeMs}
        radius={radius * 1.04}
        opacityMulRef={fillOpacity}
      />

      <mesh
        ref={outerRuneMesh}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.04, 0]}
        scale={radius * 1.95}
        material={outerRuneMat}
        visible={false}
        renderOrder={2}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <mesh
        ref={runeMesh}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.045, 0]}
        scale={radius * 1.85}
        material={runeMat}
        visible={false}
        renderOrder={3}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>

      <AdditiveParticleBurst
        color={HOT}
        origin={[0, 0.22, 0]}
        count={24}
        life={0.75}
        speed={1.6}
        speedSpread={1.2}
        size={0.28}
        sizeEnd={0.04}
        lift={0.6}
        upBias={0.5}
        fadeIn={0.15}
        stagger={0.3}
        trigger={shot.key}
      />
    </group>
  );
}
