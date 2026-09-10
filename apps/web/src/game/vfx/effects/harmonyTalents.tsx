import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { REBIRTH_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { HealSwooshEffect } from "./healSwoosh";

const GOLD = "#fef08a";
const CREAM = "#fff7ed";

function followPose(
  shot: OneShotEffect,
  follow: VfxFollowContext,
): { x: number; z: number } {
  const id = shot.followTargetId ?? shot.targetId ?? shot.followOwnerId;
  if (id && follow.room) {
    const p = follow.room.state?.players?.get(id) as { x?: number; z?: number } | undefined;
    if (p && typeof p.x === "number" && typeof p.z === "number") return { x: p.x, z: p.z };
  }
  return { x: shot.x, z: shot.z };
}

/** Lasting Grace / Guardian Angel — reuse the green heal swoosh. */
export function HarmonyHealBurstEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  return <HealSwooshEffect shot={shot} follow={follow} />;
}

/**
 * Rebirth — blessing mark (variant 0), delayed-rez pillar (1), stand-up burst (2).
 * Pillar is tall and readable so enemies can see the incoming rez.
 */
export function RebirthEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const variant = shot.variant ?? 0;
  if (variant === 0 || variant === 2) {
    return <HealSwooshEffect shot={shot} follow={follow} />;
  }

  const lifeMs = Math.max(REBIRTH_CAST.delayMs, shot.life || REBIRTH_CAST.delayMs);
  const root = useRef<THREE.Group>(null);
  const pillarMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: CREAM,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      pillarMat.dispose();
      coreMat.dispose();
      ringMat.dispose();
    },
    [pillarMat, coreMat, ringMat],
  );

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const env = softEnvelope(u, 0.08, 0.82);
    pillarMat.opacity = env * 0.42;
    coreMat.opacity = env * 0.7;
    ringMat.opacity = env * 0.55;
    if (!root.current) return;
    const pose = followPose(shot, follow);
    root.current.position.set(pose.x, 0.02, pose.z);
    root.current.rotation.y += 0.012;
  });

  return (
    <group ref={root} position={[shot.x, 0.02, shot.z]}>
      <mesh material={pillarMat} position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.22, 0.34, 4.8, 12, 1, true]} />
      </mesh>
      <mesh material={coreMat} position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 4.8, 8]} />
      </mesh>
      <mesh material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.55, 0.82, 24]} />
      </mesh>
    </group>
  );
}
