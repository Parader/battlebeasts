import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES, POISON_CLOUD_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { groundPresets } from "../presets/ground";
import { VFX_SMOKE_URL } from "../vfxUrls";
import { getSmokeTexture } from "../smokeTexture";
import { spawnElementRole, type ElementHandle } from "../engine";

/** Soft smoke disc — tinted green in the plane material. */
export const POISON_CLOUD_SMOKE_URL = VFX_SMOKE_URL;

const VIAL_FLIGHT_MS = 280;
const CLOUD_FADE_IN_MS = 220;
const CLOUD_FADE_OUT_MS = 650;

/**
 * Caster/travel: vial mesh. Impact: additive pop. Ground: poison preset and decals.
 * Particles: ParticleWorld poison ground; poisoned/weakened auras stay in StatusAuraFx.
 */
export function PoisonCloudGroundEffect({ shot }: { shot: OneShotEffect }) {
  const def = ABILITIES.poisonCloud;
  const radius = Math.max(1.2, shot.radius ?? def?.radius ?? POISON_CLOUD_CAST.radius);
  const lifeMs = Math.max(1200, shot.life);
  const fromX = typeof shot.originX === "number" ? shot.originX : shot.x;
  const fromZ = typeof shot.originZ === "number" ? shot.originZ : shot.z;

  const rimOpacity = useRef(0);
  const cloudOpacity = useRef(0);
  const mistProgress = useRef(0);
  const vialRef = useRef<THREE.Mesh>(null);
  const groundFx = useRef<ElementHandle | null>(null);

  const blotPreset = useMemo(
    () => ({
      ...groundPresets.poisonBlot,
      element: "poison" as const,
      shape: "circle" as const,
      colorCore: "#bef264",
      colorMid: "#65a30d",
      colorEdge: "#14532d",
      opacity: 0.82,
      additive: true,
      radius,
      lifeMs,
      ringWidth: 0.1,
      softness: 0.1,
      innerRatio: 0.42,
      breakup: 0.55,
      spin: 0.18,
      appearEnd: 0.05,
      fadeStart: 0.88,
    }),
    [radius, lifeMs],
  );

  useEffect(() => {
    const handle = spawnElementRole("poison", "ground", shot.x, 0.12, shot.z);
    handle.setRateScale(0);
    groundFx.current = handle;
    return () => {
      handle.kill();
      if (groundFx.current === handle) groundFx.current = null;
    };
  }, [shot.key, shot.x, shot.z]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const fadeIn = softEnvelope(
      u,
      CLOUD_FADE_IN_MS / lifeMs,
      1 - CLOUD_FADE_OUT_MS / lifeMs,
    );
    rimOpacity.current = fadeIn * 0.7;
    cloudOpacity.current = fadeIn;
    // Mist builds after the vial lands.
    mistProgress.current =
      age < VIAL_FLIGHT_MS ? 0 : Math.min(1, (age - VIAL_FLIGHT_MS) / 280);
    groundFx.current?.setRateScale(mistProgress.current * cloudOpacity.current);

    const vial = vialRef.current;
    if (!vial) return;
    if (age >= VIAL_FLIGHT_MS) {
      vial.visible = false;
      return;
    }
    const t = Math.min(1, age / VIAL_FLIGHT_MS);
    const ease = t * t * (3 - 2 * t);
    const x = fromX + (shot.x - fromX) * ease;
    const z = fromZ + (shot.z - fromZ) * ease;
    const loft = Math.sin(Math.PI * t) * 1.35;
    vial.visible = true;
    vial.position.set(x, 0.35 + loft, z);
    vial.rotation.x = t * Math.PI * 2.2;
    vial.rotation.z = t * Math.PI * 1.4;
  });

  return (
    <group>
      <mesh ref={vialRef} renderOrder={3}>
        <cylinderGeometry args={[0.07, 0.09, 0.28, 8]} />
        <meshBasicMaterial
          color="#4d7c0f"
          transparent
          opacity={0.92}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group position={[shot.x, 0, shot.z]}>
        <AoeRimMarker
          x={0}
          z={0}
          radius={radius}
          color="#84cc16"
          hotColor="#bef264"
          fill={0.22}
          noise={0.18}
          glowWidth={0.055}
          opacity={0.65}
          opacityMulRef={rimOpacity}
        />
        <GroundDecal
          preset={blotPreset}
          shape="circle"
          x={0}
          z={0}
          y={0.035}
          born={shot.born + VIAL_FLIGHT_MS * 0.6}
          life={lifeMs}
          radius={radius * 1.08}
          opacityMulRef={cloudOpacity}
        />
        <PoisonSmokeDisc
          radius={radius}
          born={shot.born + VIAL_FLIGHT_MS}
          life={lifeMs}
          opacityMulRef={cloudOpacity}
          scale={2.85}
          opacityScale={0.78}
          color="#4d7c0f"
        />
        <PoisonSmokeDisc
          radius={radius}
          born={shot.born + VIAL_FLIGHT_MS}
          life={lifeMs}
          opacityMulRef={cloudOpacity}
          scale={2.35}
          opacityScale={0.7}
          color="#365314"
          y={0.052}
          spin={-0.14}
        />
        <PoisonSmokeDisc
          radius={radius}
          born={shot.born + VIAL_FLIGHT_MS}
          life={lifeMs}
          opacityMulRef={cloudOpacity}
          scale={1.55}
          opacityScale={0.85}
          color="#1a2e05"
          y={0.058}
          spin={0.1}
        />
        <AdditiveParticleBurst
          color="#a3e635"
          origin={[0, 0.25, 0]}
          count={22}
          life={0.7}
          speed={1.4}
          speedSpread={1.2}
          size={0.26}
          sizeEnd={0.04}
          lift={0.85}
          upBias={0.5}
          fadeIn={0.2}
          stagger={0.4}
          trigger={shot.key}
        />
      </group>
    </group>
  );
}

/** Soft tinted smoke disc on the ground — uses shared smoke.png. */
function PoisonSmokeDisc({
  radius,
  born,
  life,
  opacityMulRef,
  scale = 2.3,
  opacityScale = 0.55,
  color = "#84cc16",
  y = 0.048,
  spin = 0.18,
}: {
  radius: number;
  born: number;
  life: number;
  opacityMulRef: { current: number };
  scale?: number;
  opacityScale?: number;
  color?: string;
  y?: number;
  spin?: number;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => getSmokeTexture(), []);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;
    const age = performance.now() - born;
    if (age < 0) {
      mesh.visible = false;
      return;
    }
    const u = Math.max(0, Math.min(1, age / Math.max(1, life)));
    const env = softEnvelope(
      u,
      CLOUD_FADE_IN_MS / Math.max(1, life),
      1 - CLOUD_FADE_OUT_MS / Math.max(1, life),
    );
    const op = env * opacityMulRef.current * opacityScale;
    mat.opacity = op;
    mesh.visible = op > 0.02;
    mesh.rotation.z += dt * spin;
  });

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      renderOrder={2}
      frustumCulled={false}
    >
      <planeGeometry args={[radius * scale, radius * scale]} />
      <meshBasicMaterial
        ref={matRef}
        map={tex}
        color={color}
        transparent
        depthWrite={false}
        toneMapped={false}
        opacity={0}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
