import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { POISON_DART_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { findBone } from "../attach";
import { getCharacterRoot } from "../../characterRoots";
import { createEnergyBallMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";

const POISON = "#4d7c0f";
const POISON_DARK = "#1a2e05";
const POISON_HOT = "#84cc16";

/**
 * Dark poison puff at the hook hand when the dart leaves.
 * Prefers RightHand bone; falls back to yaw + spawnOffset.
 */
export function PoisonDartCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const group = useRef<THREE.Group>(null);
  const coreMat = useMemo(() => createEnergyBallMaterial(POISON_HOT, 0), []);
  const glowMat = useMemo(() => createEnergyBallMaterial(POISON_DARK, 0), []);
  const light = useRef<THREE.PointLight>(null);
  const worldPos = useRef(new THREE.Vector3());
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });

  useFrame(() => {
    const age = (performance.now() - shot.born) / shot.life;

    const charRoot = getCharacterRoot(shot.followOwnerId);
    const hand =
      (charRoot &&
        (findBone(charRoot, "RightHand", { partial: true }) ??
          findBone(charRoot, "mixamorig:RightHand", { partial: true }))) ||
      null;

    if (hand) {
      hand.getWorldPosition(worldPos.current);
      pose.current.x = worldPos.current.x;
      pose.current.y = worldPos.current.y;
      pose.current.z = worldPos.current.z;
    } else if (shot.followOwnerId) {
      const offset = shot.followSpawnOffset ?? POISON_DART_CAST.spawnOffset;
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
        pose.current.y = shot.y || POISON_DART_CAST.handY;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          const yaw = p.yaw ?? pose.current.yaw;
          pose.current.yaw = yaw;
          pose.current.x = (p.x ?? pose.current.x) + Math.sin(yaw) * offset;
          pose.current.z = (p.z ?? pose.current.z) + Math.cos(yaw) * offset;
          pose.current.y = shot.y || POISON_DART_CAST.handY;
        }
      }
    }

    if (root.current) {
      root.current.position.set(pose.current.x, pose.current.y, pose.current.z);
    }

    const g = group.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const amp = softEnvelope(age, 0.28, 0.5);
    g.scale.setScalar(0.1 + amp * 0.45);
    coreMat.opacity = amp * 0.75;
    glowMat.opacity = amp * 0.45;
    if (light.current) light.current.intensity = amp * 1.4;
  });

  return (
    <group ref={root} position={[shot.x, shot.y, shot.z]}>
      <group ref={group} scale={0.1}>
        <mesh>
          <sphereGeometry args={[0.1, 10, 10]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh scale={1.8}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
        <pointLight ref={light} color={POISON} intensity={0} distance={2.8} decay={2} />
        <AdditiveParticleBurst
          color={POISON_DARK}
          origin={[0, 0, 0]}
          count={9}
          life={0.45}
          speed={0.7}
          speedSpread={0.7}
          size={0.09}
          sizeEnd={0.02}
          lift={0.55}
          upBias={0.35}
          fadeIn={0.2}
          stagger={0.35}
          trigger={shot.key}
        />
        <AdditiveParticleBurst
          color={POISON_HOT}
          origin={[0, 0, 0]}
          count={6}
          life={0.38}
          speed={1.1}
          speedSpread={0.6}
          size={0.06}
          sizeEnd={0.012}
          lift={0.4}
          upBias={0.25}
          fadeIn={0.25}
          stagger={0.3}
          trigger={shot.key}
        />
      </group>
    </group>
  );
}
