import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FIREBALL_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { FireParticleField } from "../components/FireParticleField";
import { groundPresets } from "../presets/ground";
import { VFX_FIRE_URL } from "../vfxUrls";
import { getSmokeTexture } from "../smokeTexture";

const FADE_IN_MS = 220;
const FADE_OUT_MS = 650;

/**
 * Fireball burn zone — poison-cloud layout, fire-tinted.
 * Normal-blend blot (not additive fire core) so bloom doesn't crush the frame.
 */
export function FireballBurnGroundEffect({ shot }: { shot: OneShotEffect }) {
  const radius = Math.max(1.1, shot.radius ?? FIREBALL_CAST.burnRadiusMax);
  const lifeMs = Math.max(1200, shot.life);
  const rimOpacity = useRef(0);
  const cloudOpacity = useRef(0);
  const fireProgress = useRef(0);

  const blotPreset = useMemo(
    () => ({
      // Poison blot shading (softer than fire-style heat core) + fire colors.
      ...groundPresets.poisonBlot,
      element: "poison" as const,
      shape: "circle" as const,
      colorCore: "#fb923c",
      colorMid: "#ea580c",
      colorEdge: "#7f1d1d",
      opacity: 0.72,
      /** Critical: additive + bright fire was black-screening bloom. */
      additive: false,
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

  const fireEmitters = useMemo(() => {
    const ring = radius * 0.62;
    return [
      { x: 0, y: 0.14, z: 0, reveal: 0 },
      { x: ring * 0.45, y: 0.12, z: 0, reveal: 0.1 },
      { x: -ring * 0.45, y: 0.12, z: 0, reveal: 0.1 },
      { x: 0, y: 0.12, z: ring * 0.45, reveal: 0.1 },
      { x: 0, y: 0.12, z: -ring * 0.45, reveal: 0.1 },
      { x: ring * 0.72, y: 0.1, z: ring * 0.35, reveal: 0.2 },
      { x: -ring * 0.7, y: 0.1, z: -ring * 0.32, reveal: 0.2 },
      { x: ring * 0.85, y: 0.1, z: 0, reveal: 0.3 },
      { x: -ring * 0.85, y: 0.1, z: 0, reveal: 0.3 },
    ];
  }, [radius]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const fadeIn = softEnvelope(
      u,
      FADE_IN_MS / lifeMs,
      1 - FADE_OUT_MS / lifeMs,
    );
    rimOpacity.current = fadeIn * 0.55;
    cloudOpacity.current = fadeIn;
    fireProgress.current = Math.min(1, age / 280);
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        shape="circle"
        color="#ef4444"
        hotColor="#fdba74"
        fill={0.06}
        noise={0.18}
        glowWidth={0.05}
        opacity={0.5}
        opacityMulRef={rimOpacity}
      />
      <GroundDecal
        preset={blotPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.035}
        born={shot.born}
        life={lifeMs}
        radius={radius * 1.08}
        opacityMulRef={cloudOpacity}
      />
      <FireSmokeDisc
        radius={radius}
        born={shot.born}
        life={lifeMs}
        opacityMulRef={cloudOpacity}
        scale={2.6}
        opacityScale={0.42}
        color="#9a3412"
      />
      <FireSmokeDisc
        radius={radius}
        born={shot.born}
        life={lifeMs}
        opacityMulRef={cloudOpacity}
        scale={1.7}
        opacityScale={0.5}
        color="#7f1d1d"
        y={0.052}
        spin={-0.12}
      />
      <FireParticleField
        emitters={fireEmitters}
        rate={70}
        maxParticles={140}
        textureUrl={VFX_FIRE_URL}
        maxLife={1.2}
        maxSize={0.4}
        rise={1.5}
        spread={radius * 0.35}
        progressRef={fireProgress}
        opacityMulRef={cloudOpacity}
      />
    </group>
  );
}

function FireSmokeDisc({
  radius,
  born,
  life,
  opacityMulRef,
  scale = 2.3,
  opacityScale = 0.55,
  color = "#9a3412",
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
      FADE_IN_MS / Math.max(1, life),
      1 - FADE_OUT_MS / Math.max(1, life),
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
        /** Normal blend — additive smoke discs stacked with fire particles crushed bloom. */
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
}
