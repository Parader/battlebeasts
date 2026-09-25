import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABILITIES, SILENCE_SWEEP_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { getSmokeTexture } from "../smokeTexture";
import { spawnElementRole, type ElementHandle } from "../engine";

const PUFF_COUNT = 7;
const SHADOW = "#2e1065";
const VIOLET = "#7c3aed";
const HOT = "#c4b5fd";

/** Right Hook release wall time — burp starts before this so the wave leads the punch. */
const RELEASE_MS =
  (SILENCE_SWEEP_CAST.releaseFrame /
    SILENCE_SWEEP_CAST.fps /
    SILENCE_SWEEP_CAST.playbackRate) *
  1000;
/** Start spreading ~45% into the windup. */
const BURP_START_MS = RELEASE_MS * 0.45;

type ShadowPuff = {
  /** −1..1 across the cone. */
  lane: number;
  /** 0..1 delay into the burp. */
  delay: number;
  /** Extra radial scale. */
  scaleMul: number;
  y: number;
  spin: number;
};

function makePuffs(): ShadowPuff[] {
  const out: ShadowPuff[] = [];
  for (let i = 0; i < PUFF_COUNT; i++) {
    const t = i / Math.max(1, PUFF_COUNT - 1);
    out.push({
      lane: (t - 0.5) * 2,
      delay: t * 0.12 + (i % 2) * 0.03,
      scaleMul: 0.85 + (i % 3) * 0.18,
      y: 0.35 + (i % 3) * 0.22,
      spin: (i % 2 === 0 ? 1 : -1) * (0.35 + t * 0.4),
    });
  }
  return out;
}

/**
 * Silence Sweep — shaped meshes with a ParticleWorld void sweep.
 */
export function SilenceSweepEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const rimOpacity = useRef(1);
  const waveProgress = useRef(0.02);
  const waveOpacity = useRef(0.9);
  const sweepFx = useRef<ElementHandle | null>(null);
  const puffMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const puffMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const def = ABILITIES.silenceSweep;
  const range = shot.radius ?? def?.range ?? SILENCE_SWEEP_CAST.range;
  const halfAngle = def?.coneHalfAngle ?? SILENCE_SWEEP_CAST.coneHalfAngle;
  const sweepMs = def?.sweepMs ?? SILENCE_SWEEP_CAST.sweepMs;
  const lifeMs = Math.max(BURP_START_MS + sweepMs + 280, shot.life);

  const puffs = useMemo(() => makePuffs(), []);
  const smokeTex = useMemo(() => getSmokeTexture(), []);

  const conePreset = useMemo(
    () => ({
      ...groundPresets.iceFrost,
      element: "poison" as const,
      shape: "cone" as const,
      halfAngle,
      colorCore: HOT,
      colorMid: VIOLET,
      colorEdge: SHADOW,
      opacity: 0.72,
      additive: true,
      radius: range,
      lifeMs,
      ringWidth: 0.1,
      softness: 0.1,
      innerRatio: 0.08,
      breakup: 0.7,
      spin: 0.08,
      appearEnd: 0.02,
      fadeStart: 0.78,
    }),
    [range, halfAngle, lifeMs],
  );

  useEffect(() => {
    const handle = spawnElementRole("void", "ground", shot.x, 0.12, shot.z);
    handle.setRateScale(0);
    sweepFx.current = handle;
    return () => {
      handle.kill();
      if (sweepFx.current === handle) sweepFx.current = null;
    };
  }, [shot.key, shot.x, shot.z]);

  useFrame((_, dt) => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const fade = softEnvelope(u, 0.04, 0.72);
    // Ease-out burp: fast push from the body, then soft settle over the cone.
    const burpAge = age - BURP_START_MS;
    const su = Math.max(0, Math.min(1, burpAge / sweepMs));
    const ease = 1 - (1 - su) * (1 - su);
    // Hitbox rim + shadow fill share the same grow curve.
    waveProgress.current = burpAge < 0 ? 0.04 : Math.max(0.08, ease);
    waveOpacity.current = fade * (burpAge < 0 ? 0.15 : 0.95);
    rimOpacity.current = softEnvelope(u, 0.08, 0.62) * (burpAge < 0 ? 0.2 : 1);

    let x = shot.x;
    let z = shot.z;
    let yaw = shot.yaw ?? 0;
    if (shot.followOwnerId && follow?.room) {
      const local =
        follow.localSessionId === shot.followOwnerId ? follow.predictedRef?.current : null;
      if (local) {
        x = local.x;
        z = local.z;
        yaw = local.yaw;
      } else {
        const p = follow.room.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
          yaw = p.yaw ?? yaw;
        }
      }
    }
    if (root.current) {
      root.current.position.set(x, 0, z);
      root.current.rotation.y = yaw;
    }
    sweepFx.current?.setPoseYaw(x, 0.12, z, yaw);
    sweepFx.current?.setRateScale(fade * (burpAge < 0 ? 0 : 1 - su * 0.55));

    // Soft smoke puffs ride the wave front across the cone.
    for (let i = 0; i < PUFF_COUNT; i++) {
      const puff = puffs[i]!;
      const mesh = puffMeshes.current[i];
      const mat = puffMats.current[i];
      if (!mesh || !mat) continue;
      const local = Math.max(0, Math.min(1, (su - puff.delay) / Math.max(0.001, 1 - puff.delay)));
      if (burpAge < 0 || local <= 0) {
        mesh.visible = false;
        continue;
      }
      const front = ease * range;
      const ang = puff.lane * halfAngle * (0.55 + 0.45 * local);
      const dist = front * (0.35 + 0.55 * local) * (0.75 + Math.abs(puff.lane) * 0.12);
      const sx = Math.sin(ang) * dist;
      const sz = Math.cos(ang) * dist;
      const grow = 0.55 + local * 1.35;
      const s = range * 0.42 * puff.scaleMul * grow;
      const op = fade * (1 - local * local) * (0.55 + (1 - Math.abs(puff.lane)) * 0.25);
      mesh.visible = op > 0.02;
      mesh.position.set(sx, 0.06 + puff.y * 0.08 + local * 0.04, sz);
      mesh.scale.setScalar(s);
      // Flat to ground — spin in yaw so the blot churns as it spreads.
      mesh.rotation.set(-Math.PI / 2, 0, mesh.rotation.z + dt * puff.spin);
      mat.opacity = op;
    }

  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw ?? 0, 0]}>
      <AoeRimMarker
        radius={range}
        shape="cone"
        halfAngle={halfAngle}
        color="#7c3aed"
        hotColor="#ddd6fe"
        fill={0.06}
        noise={0.25}
        glowWidth={0.05}
        opacity={0.55}
        opacityMulRef={rimOpacity}
        progressRef={waveProgress}
      />

      <GroundDecal
        preset={conePreset}
        shape="cone"
        yaw={0}
        radius={range}
        born={shot.born}
        life={lifeMs}
        progressRef={waveProgress}
        opacityMulRef={waveOpacity}
        growExpand
        y={0.032}
      />

      {puffs.map((puff, i) => (
        <mesh
          key={`puff-${i}`}
          ref={(el) => {
            puffMeshes.current[i] = el;
          }}
          position={[0, puff.y, 0]}
          visible={false}
          renderOrder={3}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(el) => {
              puffMats.current[i] = el;
            }}
            map={smokeTex}
            color={i % 2 === 0 ? VIOLET : SHADOW}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

    </group>
  );
}
