import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { smooth01 } from "../easing";

const BARRIER_BLUE = "#60a5fa";
const BARRIER_BLUE_HOT = "#93c5fd";
/** Soft shell / rim peak opacity (kept light). */
const SHELL_PEAK = 0.1;
const RIM_PEAK = 0.16;

/**
 * Barrier cast + shield shell:
 * - Blue motes rise from the ground as casting begins
 * - Bubble fades/scales in while absorb stacks > 0
 * - Shell dissolves as soon as shield HP hits 0 (broken or expired)
 */
export function BarrierCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const bubble = useRef<THREE.Group>(null);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
  const appear = useRef(0);
  const fadingOut = useRef(false);
  const done = useRef(false);
  const sawStatus = useRef(false);

  const chargeSec = Math.max(0.25, (shot.chargeMs ?? 700) / 1000);
  /** Soft fade-in once the absorb buff is applied. */
  const bubbleInSec = 0.45;

  const shellMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BARRIER_BLUE,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const rimMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BARRIER_BLUE_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useFrame((_, dt) => {
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const ageSec = (performance.now() - shot.born) / 1000;

    if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        pose.current.x = local.x;
        pose.current.z = local.z;
        pose.current.yaw = local.yaw;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          pose.current.x = p.x ?? pose.current.x;
          pose.current.z = p.z ?? pose.current.z;
          pose.current.yaw = p.yaw ?? pose.current.yaw;
        }
      }
    }

    // Active absorb only — 0 stacks means the bubble must go (broken or spent).
    let shieldHp = 0;
    if (shot.followOwnerId && follow.room?.state?.players) {
      const pl = follow.room.state.players.get(shot.followOwnerId) as
        | {
            statuses?: {
              forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void;
            };
          }
        | undefined;
      pl?.statuses?.forEach((row) => {
        if (row.statusId === "barrier") {
          shieldHp = Math.max(shieldHp, Math.max(0, row.stacks ?? 0));
        }
      });
    }
    const hasShield = shieldHp > 0;
    if (hasShield) {
      sawStatus.current = true;
      fadingOut.current = false;
      done.current = false;
    }

    if (done.current) return;

    if (root.current) {
      root.current.visible = true;
      root.current.position.set(pose.current.x, 0, pose.current.z);
    }

    // Bubble only while absorb HP remains; particles cover the windup.
    if (hasShield) {
      appear.current = Math.min(1, appear.current + safeDt / bubbleInSec);
      shot.life = Math.max(shot.life, performance.now() - shot.born + 500);
    } else if (appear.current > 0.01 || sawStatus.current) {
      // Shield spent / expired / broken mid-cast.
      fadingOut.current = true;
      appear.current = Math.max(0, appear.current - safeDt / 0.28);
      if (appear.current <= 0.01 && sawStatus.current) {
        // Keep following until life ends in case more absorb is granted mid-cast.
        appear.current = 0;
        if (ageSec > chargeSec + 3.2) {
          done.current = true;
          if (root.current) root.current.visible = false;
          return;
        }
      }
    } else if (ageSec > chargeSec + 0.6) {
      // Impact never granted absorb (shouldn't happen on a locked cast).
      fadingOut.current = true;
      appear.current = 0;
      done.current = true;
      if (root.current) root.current.visible = false;
      return;
    }

    const a = smooth01(appear.current);
    const pulse = 0.96 + 0.04 * Math.sin(performance.now() * 0.0026);
    const scale = (0.48 + 0.38 * a) * pulse;

    if (bubble.current) {
      bubble.current.visible = a > 0.02;
      bubble.current.scale.setScalar(scale);
      bubble.current.rotation.y += safeDt * 0.35;
    }
    shellMat.opacity = a * (SHELL_PEAK + 0.03 * Math.sin(performance.now() * 0.003));
    rimMat.opacity = a * (RIM_PEAK + 0.04 * Math.sin(performance.now() * 0.0024));
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <AdditiveParticleBurst
        color={BARRIER_BLUE}
        origin={[0, 0.04, 0]}
        count={24}
        life={0.9}
        speed={0.5}
        speedSpread={0.4}
        size={0.1}
        sizeEnd={0.018}
        lift={1.7}
        upBias={0.94}
        fadeIn={0.18}
        stagger={0.6}
        trigger={shot.key}
      />
      <AdditiveParticleBurst
        color={BARRIER_BLUE_HOT}
        origin={[0, 0.02, 0]}
        count={16}
        life={0.75}
        speed={0.3}
        speedSpread={0.5}
        size={0.07}
        sizeEnd={0.012}
        lift={1.4}
        upBias={0.9}
        fadeIn={0.22}
        stagger={0.7}
        trigger={shot.key}
      />
      <group ref={bubble} position={[0, 0.9, 0]} visible={false} scale={0.48}>
        <mesh material={shellMat}>
          <sphereGeometry args={[0.95, 28, 20]} />
        </mesh>
        <mesh material={rimMat} scale={1.04}>
          <sphereGeometry args={[0.95, 28, 20]} />
        </mesh>
      </group>
    </group>
  );
}
