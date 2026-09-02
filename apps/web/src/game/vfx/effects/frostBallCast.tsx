import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FROST_BALL_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { smoothstep } from "../easing";
import { acquireEnergyBallMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { useSpellLight } from "../spellLights";

/** Forward offset / height — matches projectile spawn (`FROST_BALL_CAST`). */
export const FROST_HAND_FORWARD = FROST_BALL_CAST.spawnOffset;
export const FROST_HAND_Y = FROST_BALL_CAST.handY;

/** After server despawn — keep coasting and dissolve (same ball, no second mesh). */
const FADE_OUT_SEC = 0.42;

type Phase = "charge" | "flight" | "fade";

type ProjSnap = {
  x: number;
  z: number;
  vx: number;
  vz: number;
};

/**
 * One frost orb for the whole cast: grows in the hand (visual only), then the
 * same mesh + ground aura becomes the drifting projectile when the server
 * spawns it. Prep never deals damage — combat starts at projectile spawn.
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
  const coreMat = useMemo(() => acquireEnergyBallMaterial(shot.color, 0), [shot.color]);
  const glowMat = useMemo(() => acquireEnergyBallMaterial(shot.color, 0), [shot.color]);
  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const frostPreset = groundPresets.frostBallAura;
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });
  const offset = shot.followSpawnOffset ?? FROST_HAND_FORWARD;
  const auraProgress = useRef(0);
  const auraOpacity = useRef(0);

  const phase = useRef<Phase>("charge");
  const projId = useRef<string | null>(null);
  const renderPos = useRef(new THREE.Vector3(shot.x, shot.y, shot.z));
  const lastServer = useRef<ProjSnap>({ x: shot.x, z: shot.z, vx: 0, vz: 0 });
  const fadeOut = useRef(1);
  const growFull = useRef(0);
  const done = useRef(false);

  /** Windup duration for the grow curve (not the full shot life). */
  const chargeSec = Math.max(0.2, (shot.chargeMs ?? 480) / 1000);

  useFrame((_, dt) => {
    if (done.current) return;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const ageSec = (performance.now() - shot.born) / 1000;
    const room = follow.room;

    // --- Latch onto the owner's live frost projectile (release) ---
    if (phase.current === "charge" && room?.state?.projectiles && shot.followOwnerId) {
      let found: string | null = null;
      let snap: ProjSnap | null = null;
      room.state.projectiles.forEach(
        (
          p: { ownerSessionId?: string; abilityId?: string; x: number; z: number; vx?: number; vz?: number },
          id: string,
        ) => {
          if (found) return;
          if (p.abilityId !== "frostBall") return;
          if (p.ownerSessionId !== shot.followOwnerId) return;
          found = id;
          snap = { x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 };
        },
      );
      if (found && snap) {
        projId.current = found;
        lastServer.current = snap;
        renderPos.current.set(snap.x, FROST_HAND_Y, snap.z);
        pose.current.x = snap.x;
        pose.current.z = snap.z;
        growFull.current = 1;
        auraProgress.current = 1;
        phase.current = "flight";
        // Keep the one-shot alive for the full drift + fade.
        const remainMs = FADE_OUT_SEC * 1000 + 4200;
        shot.life = Math.max(shot.life, performance.now() - shot.born + remainMs);
      }
    }

    // --- Flight: track server projectile ---
    if (phase.current === "flight" && projId.current && room?.state?.projectiles) {
      const p = room.state.projectiles.get(projId.current) as
        | { x: number; z: number; vx?: number; vz?: number }
        | undefined;
      if (!p) {
        phase.current = "fade";
        fadeOut.current = 1;
      } else {
        const vx = p.vx ?? 0;
        const vz = p.vz ?? 0;
        renderPos.current.x += vx * safeDt;
        renderPos.current.z += vz * safeDt;

        const serverMoved =
          p.x !== lastServer.current.x ||
          p.z !== lastServer.current.z ||
          vx !== lastServer.current.vx ||
          vz !== lastServer.current.vz;

        if (serverMoved) {
          lastServer.current = { x: p.x, z: p.z, vx, vz };
          const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
          if (err > 1.25) {
            renderPos.current.x = p.x;
            renderPos.current.z = p.z;
          } else {
            const blend = 1 - Math.exp(-14 * safeDt);
            renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend);
            renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend);
          }
        }

        pose.current.x = renderPos.current.x;
        pose.current.z = renderPos.current.z;
      }
    }

    // --- Fade: coast on last velocity ---
    if (phase.current === "fade") {
      fadeOut.current = Math.max(0, fadeOut.current - safeDt / FADE_OUT_SEC);
      if (fadeOut.current <= 0.01) {
        done.current = true;
        if (root.current) root.current.visible = false;
        if (hand.current) hand.current.visible = false;
        auraOpacity.current = 0;
        return;
      }
      const { vx, vz } = lastServer.current;
      const coast = 0.45 + 0.55 * fadeOut.current;
      renderPos.current.x += vx * safeDt * coast;
      renderPos.current.z += vz * safeDt * coast;
      pose.current.x = renderPos.current.x;
      pose.current.z = renderPos.current.z;
    }

    // --- Charge: follow casting hand ---
    if (phase.current === "charge" && shot.followOwnerId) {
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
        const pl = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (pl) {
          const yaw = pl.yaw ?? pose.current.yaw;
          pose.current.yaw = yaw;
          pose.current.x = (pl.x ?? pose.current.x) + Math.sin(yaw) * offset;
          pose.current.z = (pl.z ?? pose.current.z) + Math.cos(yaw) * offset;
        }
      }
      renderPos.current.set(pose.current.x, pose.current.y, pose.current.z);
    }

    // Timed out in charge with no projectile (cancel already removed shot normally).
    if (phase.current === "charge" && ageSec > chargeSec + 0.85) {
      done.current = true;
      if (root.current) root.current.visible = false;
      return;
    }

    if (root.current) {
      root.current.visible = true;
      root.current.position.set(pose.current.x, 0, pose.current.z);
    }

    const growT =
      phase.current === "charge"
        ? THREE.MathUtils.clamp(ageSec / (chargeSec * 0.92), 0, 1)
        : 1;
    const grow = phase.current === "charge" ? 1 - (1 - growT) * (1 - growT) : 1;
    growFull.current = Math.max(growFull.current, grow);

    let amp = 1;
    if (phase.current === "charge") {
      // Appear only — stay full until release (no end-of-charge dip).
      amp = smoothstep(0, 0.1, THREE.MathUtils.clamp(ageSec / chargeSec, 0, 1));
    } else if (phase.current === "fade") {
      amp = fadeOut.current * fadeOut.current;
    }

    auraProgress.current = growFull.current;
    auraOpacity.current = amp * (phase.current === "charge" ? 0.85 : 1);

    const g = hand.current;
    if (!g) return;
    g.visible = true;

    const size = 0.12 + growFull.current * 0.63;
    const scaleMul = phase.current === "fade" ? 0.75 + 0.25 * fadeOut.current : 1;
    g.scale.setScalar(size * scaleMul);
    g.position.y = phase.current === "charge" ? pose.current.y : FROST_HAND_Y;
    g.rotation.y += safeDt * (phase.current === "charge" ? 2.8 : 3.6);
    g.rotation.x += safeDt * (phase.current === "charge" ? 1.4 : 2.4);
    if (phase.current !== "charge") g.rotation.z += safeDt * 1.1;

    coreMat.opacity = amp * (phase.current === "charge" ? 0.95 : 1);
    glowMat.opacity = amp * (phase.current === "charge" ? 0.5 : 0.45);
    light.emitAt(
      lightAt.current,
      shot.color,
      amp * (phase.current === "charge" ? 1.4 + growFull.current * 1.8 : 1.8),
      5.5,
    );
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
        <object3D ref={lightAt} />
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
