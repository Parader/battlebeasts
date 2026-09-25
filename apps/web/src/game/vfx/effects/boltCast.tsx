import { BOLT_CAST } from "@battlebeasts/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { getCombatOwnerPose, getCharacterRoot } from "../../characterRoots";
import { findHandBone } from "../attach";
import {
  killLightningCluster,
  moveLightningCluster,
  spawnLightningCluster,
  type LightningClusterOpts,
} from "../engine/lightningArcs";
import * as THREE from "three";

const CASTER: LightningClusterOpts = {
  length: 0.28,
  strands: 3,
  spreadMul: 0.32,
  jitterMul: 0.4,
  sag: 0.02,
  tipGlow: 0,
  colorCore: "#67e8f9",
  colorInner: "#38bdf8",
  colorOuter: "#0ea5e9",
  colorHalo: "#0b3fc8",
};

/**
 * Bolt cast — short hand crackle at release (no spheres / ground circles).
 */
export function BoltCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const clusterId = useRef(-1);
  const handWorld = useRef(new THREE.Vector3());
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });

  useEffect(() => {
    return () => {
      if (clusterId.current >= 0) killLightningCluster(clusterId.current);
      clusterId.current = -1;
    };
  }, []);

  useFrame(() => {
    const age = (performance.now() - shot.born) / Math.max(16, shot.life);
    if (age >= 1) {
      if (clusterId.current >= 0) {
        killLightningCluster(clusterId.current);
        clusterId.current = -1;
      }
      return;
    }

    const offset = shot.followSpawnOffset ?? BOLT_CAST.spawnOffset;
    let hx = pose.current.x;
    let hy = shot.y;
    let hz = pose.current.z;

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
        hx = pose.current.x;
        hz = pose.current.z;
        hy = BOLT_CAST.handY;
      } else {
        const p = getCombatOwnerPose(follow.room, shot.followOwnerId);
        if (p) {
          const yaw = p.yaw ?? pose.current.yaw;
          pose.current.yaw = yaw;
          pose.current.x = (p.x ?? pose.current.x) + Math.sin(yaw) * offset;
          pose.current.z = (p.z ?? pose.current.z) + Math.cos(yaw) * offset;
          hx = pose.current.x;
          hz = pose.current.z;
          hy = BOLT_CAST.handY;
        }
      }

      const charRoot = getCharacterRoot(shot.followOwnerId);
      const hand = charRoot ? findHandBone(charRoot, "right") : null;
      if (hand) {
        hand.getWorldPosition(handWorld.current);
        hx = handWorld.current.x;
        hy = handWorld.current.y;
        hz = handWorld.current.z;
      }
    }

    const amp = softEnvelope(age, 0.35, 0.55);
    if (amp < 0.04) {
      if (clusterId.current >= 0) {
        killLightningCluster(clusterId.current);
        clusterId.current = -1;
      }
      return;
    }

    const by = hy - 0.04;
    if (clusterId.current < 0 || !moveLightningCluster(clusterId.current, hx, by, hz)) {
      clusterId.current = spawnLightningCluster(hx, by, hz, CASTER);
    }
  });

  return null;
}
