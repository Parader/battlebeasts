import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { createEnergyBallMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { FROST_BALL_CAST } from "@battlebeasts/shared";

/** Forward offset / height — matches projectile spawn (`FROST_BALL_CAST`). */
export const FROST_HAND_FORWARD = FROST_BALL_CAST.spawnOffset;
export const FROST_HAND_Y = FROST_BALL_CAST.handY;

/**
 * Frost forming in the casting hand from anticipation until release.
 * Ground aura grows from below the hand orb (visual only).
 */
export function FrostBallCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  const coreMat = useMemo(() => createEnergyBallMaterial(shot.color, 0), [shot.color]);
  const glowMat = useMemo(() => createEnergyBallMaterial(shot.color, 0), [shot.color]);
  const light = useRef<THREE.PointLight>(null);
  const frostPreset = groundPresets.frostBallAura;
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });
  const offset = shot.followSpawnOffset ?? FROST_HAND_FORWARD;
  const auraProgress = useRef(0);
  const auraOpacity = useRef(0);

  useFrame((_, dt) => {
    const age = (performance.now() - shot.born) / shot.life;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;

      if (local) {
        pose.current.yaw = local.yaw;
        pose.current.x = local.x + Math.sin(local.yaw) * offset;
        pose.current.z = local.z + Math.cos(local.yaw) * offset;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          const yaw = p.yaw ?? pose.current.yaw;
          pose.current.yaw = yaw;
          pose.current.x = (p.x ?? pose.current.x) + Math.sin(yaw) * offset;
          pose.current.z = (p.z ?? pose.current.z) + Math.cos(yaw) * offset;
        }
      }
    }

    // Center on the prep ball so the circle grows under it.
    if (root.current) {
      root.current.position.set(pose.current.x, 0, pose.current.z);
    }

    const growT = THREE.MathUtils.clamp(age / 0.92, 0, 1);
    const grow = 1 - (1 - growT) * (1 - growT);
    const amp = softEnvelope(age, 0.06, 0.9);

    auraProgress.current = grow;
    auraOpacity.current = amp * 0.85;

    const g = hand.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      auraOpacity.current = 0;
      return;
    }
    g.visible = true;

    const size = 0.12 + grow * 0.63;
    g.scale.setScalar(size);
    g.rotation.y += safeDt * 2.8;
    g.rotation.x += safeDt * 1.4;

    coreMat.opacity = amp * 0.95;
    glowMat.opacity = amp * 0.5;
    if (light.current) light.current.intensity = amp * (1.4 + grow * 1.8);
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <GroundDecal
        preset={frostPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.035}
        radius={frostPreset.radius}
        growExpand
        progressRef={auraProgress}
        opacityMulRef={auraOpacity}
      />
      <group ref={hand} position={[0, shot.y, 0]} scale={0.12}>
        <mesh>
          <icosahedronGeometry args={[0.42, 1]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh scale={1.65}>
          <icosahedronGeometry args={[0.42, 0]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        <pointLight ref={light} color={shot.color} intensity={0} distance={5} decay={2} />
        <AdditiveParticleBurst
          color={shot.color}
          origin={[0, 0, 0]}
          count={12}
          life={0.5}
          speed={0.7}
          speedSpread={0.4}
          size={0.08}
          sizeEnd={0.015}
          lift={0.3}
          upBias={0.35}
          fadeIn={0.4}
          stagger={0.55}
          trigger={shot.key}
        />
      </group>
    </group>
  );
}
