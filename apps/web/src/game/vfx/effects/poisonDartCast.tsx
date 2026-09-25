import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { POISON_DART_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { findBone } from "../attach";
import { getCharacterRoot, getCombatOwnerPose } from "../../characterRoots";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { GEO_SPHERE_LO, GEO_SPHERE_MD } from "../sharedGeo";
import { useSpellLight } from "../spellLights";
import { burstElementRole } from "../engine";

const POISON = "#4d7c0f";
const POISON_DARK = "#1a2e05";
const POISON_HOT = "#84cc16";

/**
 * Caster: poison preset at the resolved hand. Travel/impact/ground: owned elsewhere.
 * Particles: ParticleWorld poison cast; poisoned/weakened auras stay in StatusAuraFx.
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
  const coreMat = useMemo(() => acquireEnergyBallMaterial(POISON_HOT, 0), []);
  const glowMat = useMemo(() => acquireEnergyBallMaterial(POISON_DARK, 0), []);
  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const worldPos = useRef(new THREE.Vector3());
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });
  const castBurst = useRef(false);

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
        const p = getCombatOwnerPose(follow.room, shot.followOwnerId);
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
    if (!castBurst.current) {
      castBurst.current = true;
      burstElementRole("poison", "cast", pose.current.x, pose.current.y, pose.current.z);
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
    light.emitAt(lightAt.current, POISON, amp * 1.4, 2.8);
  });

  return (
    <group ref={root} position={[shot.x, shot.y, shot.z]}>
      <group ref={group} scale={0.1}>
        <mesh scale={0.1} geometry={GEO_SPHERE_MD} material={coreMat} />
        <mesh scale={0.1 * 1.8} geometry={GEO_SPHERE_LO} material={glowMat} />
        <object3D ref={lightAt} />
      </group>
    </group>
  );
}
