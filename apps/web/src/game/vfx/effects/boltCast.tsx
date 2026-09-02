import { BOLT_CAST } from "@battlebeasts/shared";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { GroundMagicCircle } from "../components/GroundMagicCircle";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GEO_SPHERE_HI, GEO_SPHERE_MD } from "../sharedGeo";
import { useSpellLight } from "../spellLights";

/** Short muzzle flash — follows caster, offset toward extended hand. */
export function BoltCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const group = useRef<THREE.Group>(null);
  const coreMat = useMemo(() => acquireEnergyBallMaterial(shot.color, 0), [shot.color]);
  const glowMat = useMemo(() => acquireEnergyBallMaterial(shot.color, 0), [shot.color]);
  const light = useSpellLight();
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });

  useFrame(() => {
    const age = (performance.now() - shot.born) / shot.life;

    if (shot.followOwnerId) {
      const offset = shot.followSpawnOffset ?? BOLT_CAST.spawnOffset;
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

    if (root.current) {
      root.current.position.set(pose.current.x, 0, pose.current.z);
    }

    const g = group.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      light.off();
      return;
    }
    g.visible = true;
    const amp = softEnvelope(age, 0.42, 0.58);
    g.scale.setScalar(0.08 + amp * 0.55);
    coreMat.opacity = amp * 0.9;
    glowMat.opacity = amp * 0.4;
    // Pool lights live at the scene root, so this is world space -- the group
    // it used to hang off sits at (pose, shot.y).
    light.emit(pose.current.x, shot.y, pose.current.z, shot.color, amp * 2.2, 3.5);
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <group ref={group} position={[0, shot.y, 0]} scale={0.08}>
        <mesh scale={0.12} geometry={GEO_SPHERE_HI} material={coreMat} />
        <mesh scale={0.12 * 1.7} geometry={GEO_SPHERE_MD} material={glowMat} />
        <AdditiveParticleBurst
          color={shot.color}
          origin={[0, 0, 0]}
          count={7}
          life={0.32}
          speed={0.9}
          speedSpread={0.5}
          size={0.07}
          sizeEnd={0.015}
          lift={0.35}
          upBias={0.5}
          fadeIn={0.35}
          trigger={shot.key}
        />
      </group>
      <GroundMagicCircle
        color={shot.color}
        radius={0.32}
        born={shot.born}
        life={shot.life}
        showRune
        spin={1.6}
        appearEnd={0.45}
        fadeStart={0.55}
      />
    </group>
  );
}
