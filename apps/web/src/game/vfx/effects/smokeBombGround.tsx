import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES, SMOKE_BOMB_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { groundPresets } from "../presets/ground";
import { getSmokeTexture } from "../smokeTexture";
import { spawnElementRole, type ElementHandle } from "../engine";

const CLOUD_FADE_IN_MS = 180;
const CLOUD_FADE_OUT_MS = 700;

/**
 * Caster/travel: none. Impact: additive pop. Ground: void preset and smoke decals.
 * Particles: ParticleWorld void ground; poisoned/weakened auras stay in StatusAuraFx.
 */
export function SmokeBombGroundEffect({ shot }: { shot: OneShotEffect }) {
  const def = ABILITIES.smokeBomb;
  const radius = Math.max(1.5, shot.radius ?? def?.radius ?? SMOKE_BOMB_CAST.radius);
  const lifeMs = Math.max(1200, shot.life);

  const rimOpacity = useRef(0);
  const cloudOpacity = useRef(0);
  const mistProgress = useRef(0);
  const groundFx = useRef<ElementHandle | null>(null);

  const blotPreset = useMemo(
    () => ({
      ...groundPresets.poisonBlot,
      element: "poison" as const,
      shape: "circle" as const,
      colorCore: "#e2e8f0",
      colorMid: "#94a3b8",
      colorEdge: "#334155",
      opacity: 0.72,
      additive: true,
      radius,
      lifeMs,
      ringWidth: 0.1,
      softness: 0.12,
      innerRatio: 0.4,
      breakup: 0.5,
      spin: 0.14,
      appearEnd: 0.05,
      fadeStart: 0.86,
    }),
    [radius, lifeMs],
  );

  useEffect(() => {
    const handle = spawnElementRole("void", "ground", shot.x, 0.12, shot.z);
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
    rimOpacity.current = fadeIn * 0.55;
    cloudOpacity.current = fadeIn;
    mistProgress.current = Math.min(1, age / 220);
    groundFx.current?.setRateScale(mistProgress.current * cloudOpacity.current);
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        color="#94a3b8"
        hotColor="#e2e8f0"
        fill={0.18}
        noise={0.16}
        glowWidth={0.05}
        opacity={0.55}
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
      <SmokeDisc
        radius={radius}
        born={shot.born}
        life={lifeMs}
        opacityMulRef={cloudOpacity}
        scale={2.85}
        opacityScale={0.7}
        color="#64748b"
      />
      <SmokeDisc
        radius={radius}
        born={shot.born}
        life={lifeMs}
        opacityMulRef={cloudOpacity}
        scale={2.35}
        opacityScale={0.62}
        color="#475569"
        y={0.052}
        spin={-0.12}
      />
      <SmokeDisc
        radius={radius}
        born={shot.born}
        life={lifeMs}
        opacityMulRef={cloudOpacity}
        scale={1.55}
        opacityScale={0.78}
        color="#1e293b"
        y={0.058}
        spin={0.09}
      />
      <AdditiveParticleBurst
        color="#cbd5e1"
        origin={[0, 0.25, 0]}
        count={26}
        life={0.65}
        speed={1.6}
        speedSpread={1.3}
        size={0.28}
        sizeEnd={0.04}
        lift={0.7}
        upBias={0.45}
        fadeIn={0.18}
        stagger={0.35}
        trigger={shot.key}
      />
    </group>
  );
}

function SmokeDisc({
  radius,
  born,
  life,
  opacityMulRef,
  scale = 2.3,
  opacityScale = 0.55,
  color = "#94a3b8",
  y = 0.048,
  spin = 0.16,
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
