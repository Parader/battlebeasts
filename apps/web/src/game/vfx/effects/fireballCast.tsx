import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FIREBALL_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { smoothstep } from "../easing";
import { findHandBone } from "../attach";
import { getCharacterRoot } from "../../characterRoots";
import { VOLCANO_GLB_URL, instantiateBoulder } from "../volcanoAsset";
import { useSpellLight } from "../spellLights";
import { burstElementRole, spawnElementRole, type ElementHandle } from "../engine";

/** Forward / height fallbacks (`FIREBALL_CAST`). */
export const FIREBALL_HAND_FORWARD = FIREBALL_CAST.handPush;
export const FIREBALL_HAND_Y = FIREBALL_CAST.handY;
const HAND_PUSH = FIREBALL_CAST.handPush;
const HAND_SIDE = FIREBALL_CAST.handSide;

/** Boulder grows from small in-hand to flight size (vs full volcano rock). Visual only. */
const BOULDER_SCALE_MIN = 0.42;
const BOULDER_SCALE_MAX = 1.08;
const LIGHT_INTENSITY = 0.35;

const APPEAR_SEC =
  FIREBALL_CAST.appearFrame / FIREBALL_CAST.fps / FIREBALL_CAST.playbackRate;
/** Linear grow from appear → release (matches `fireballChargeWindowWallMs`). */
const CHARGE_SEC =
  (FIREBALL_CAST.releaseFrame - FIREBALL_CAST.appearFrame) /
  FIREBALL_CAST.fps /
  FIREBALL_CAST.playbackRate;

type Phase = "charge" | "flight" | "fade";

type ProjSnap = {
  x: number;
  z: number;
  vx: number;
  vz: number;
};

/**
 * Caster blow: cast burst; travel: fire trail; impact/ground: handled elsewhere.
 * Particles: ParticleWorld; light: spell light; status: StatusAuraFx handles burning.
 */
export function FireballCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const gltf = useGLTF(VOLCANO_GLB_URL);
  const root = useRef<THREE.Group>(null);
  const ball = useRef<THREE.Group>(null);
  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: shot.y });

  const phase = useRef<Phase>("charge");
  const projId = useRef<string | null>(null);
  /** Tolerate brief Colyseus map gaps before fading the rock. */
  const missingFrames = useRef(0);
  const renderPos = useRef(new THREE.Vector3(shot.x, shot.y, shot.z));
  const lastServer = useRef<ProjSnap>({ x: shot.x, z: shot.z, vx: 0, vz: 0 });
  const growFull = useRef(0);
  const done = useRef(false);
  const castBurst = useRef(false);
  const trail = useRef<ElementHandle | null>(null);
  const rightTmp = useRef(new THREE.Vector3());
  const handPos = useRef(new THREE.Vector3());

  const boulder = useMemo(
    () => instantiateBoulder(gltf.scene, shot.key),
    [gltf.scene, shot.key],
  );

  useEffect(() => {
    const handle = spawnElementRole("fire", "trail", shot.x, shot.y, shot.z);
    handle.setRateScale(0);
    trail.current = handle;
    return () => {
      handle.kill();
      if (trail.current === handle) trail.current = null;
    };
  }, [shot.x, shot.y, shot.z]);

  useFrame((_, dt) => {
    if (done.current) return;
    const safeDt = Math.min(0.05, Math.max(0, dt));
    const ageSec = (performance.now() - shot.born) / 1000;
    const room = follow.room;

    if (phase.current === "charge" && room?.state?.projectiles && shot.followOwnerId) {
      let found: string | null = null;
      let snap: ProjSnap | null = null;
      room.state.projectiles.forEach(
        (
          p: {
            ownerSessionId?: string;
            abilityId?: string;
            x: number;
            z: number;
            vx?: number;
            vz?: number;
          },
          id: string,
        ) => {
          if (found) return;
          if (p.abilityId !== "fireball") return;
          if (p.ownerSessionId !== shot.followOwnerId) return;
          found = id;
          snap = { x: p.x, z: p.z, vx: p.vx ?? 0, vz: p.vz ?? 0 };
        },
      );
      if (found && snap) {
        projId.current = found;
        lastServer.current = snap;
        renderPos.current.set(snap.x, pose.current.y || FIREBALL_HAND_Y, snap.z);
        pose.current.x = snap.x;
        pose.current.z = snap.z;
        growFull.current = 1;
        missingFrames.current = 0;
        phase.current = "flight";
        shot.life = Math.max(shot.life, performance.now() - shot.born + 4600);
      }
    }

    if (phase.current === "flight" && projId.current && room?.state?.projectiles) {
      const p = room.state.projectiles.get(projId.current) as
        | { x: number; z: number; vx?: number; vz?: number }
        | undefined;
      if (!p) {
        missingFrames.current += 1;
        if (missingFrames.current > 8) {
          phase.current = "fade";
        }
      } else {
        missingFrames.current = 0;
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
        pose.current.y = renderPos.current.y;
      }
    }

    if (phase.current === "fade") {
      done.current = true;
      trail.current?.setRateScale(0);
      if (root.current) root.current.visible = false;
      if (ball.current) ball.current.visible = false;
      light.off();
      return;
    }

    if (phase.current === "charge" && shot.followOwnerId) {
      const charRoot = getCharacterRoot(shot.followOwnerId);
      const right = charRoot ? findHandBone(charRoot, "right") : null;

      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      const pl = follow.room?.state?.players?.get(shot.followOwnerId) as
        | { x?: number; z?: number; yaw?: number }
        | undefined;
      const yaw = local?.yaw ?? pl?.yaw ?? pose.current.yaw;
      pose.current.yaw = yaw;
      // Facing (sin, cos); right-hand side (cos, -sin).
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);

      if (right) {
        // Track the casting hand so the rock moves with the throw windup.
        right.getWorldPosition(rightTmp.current);
        handPos.current.copy(rightTmp.current);
        handPos.current.x += fx * HAND_PUSH + rx * HAND_SIDE;
        handPos.current.z += fz * HAND_PUSH + rz * HAND_SIDE;
        pose.current.x = handPos.current.x;
        pose.current.y = handPos.current.y;
        pose.current.z = handPos.current.z;
      } else if (local) {
        pose.current.x =
          local.x + fx * HAND_PUSH + rx * HAND_SIDE;
        pose.current.z =
          local.z + fz * HAND_PUSH + rz * HAND_SIDE;
        pose.current.y = FIREBALL_HAND_Y;
      } else if (pl) {
        pose.current.x =
          (pl.x ?? pose.current.x) + fx * HAND_PUSH + rx * HAND_SIDE;
        pose.current.z =
          (pl.z ?? pose.current.z) + fz * HAND_PUSH + rz * HAND_SIDE;
        pose.current.y = FIREBALL_HAND_Y;
      }
      renderPos.current.set(pose.current.x, pose.current.y, pose.current.z);
    }

    if (phase.current === "charge" && ageSec > APPEAR_SEC + CHARGE_SEC + 4) {
      done.current = true;
      if (root.current) root.current.visible = false;
      return;
    }

    if (root.current) {
      root.current.visible = true;
      root.current.position.set(
        pose.current.x,
        pose.current.y || FIREBALL_HAND_Y,
        pose.current.z,
      );
    }

    const appeared = ageSec >= APPEAR_SEC;
    const chargeAge = Math.max(0, ageSec - APPEAR_SEC);
    const growT =
      phase.current === "charge"
        ? THREE.MathUtils.clamp(chargeAge / Math.max(0.05, CHARGE_SEC), 0, 1)
        : 1;
    const grow = phase.current === "charge" ? 1 - (1 - growT) * (1 - growT) : 1;
    growFull.current = Math.max(growFull.current, grow);

    let amp = 0;
    if (!appeared && phase.current === "charge") {
      amp = 0;
    } else if (phase.current === "charge") {
      amp = smoothstep(0, 0.08, THREE.MathUtils.clamp(chargeAge / CHARGE_SEC, 0, 1));
    } else {
      amp = 1;
    }

    if (appeared && !castBurst.current) {
      castBurst.current = true;
      burstElementRole(
        "fire",
        "cast",
        pose.current.x,
        pose.current.y || FIREBALL_HAND_Y,
        pose.current.z,
        {
          dirX: Math.sin(pose.current.yaw),
          dirY: 0,
          dirZ: Math.cos(pose.current.yaw),
        },
      );
    }

    const flying = phase.current === "flight";
    const trailHandle = trail.current;
    if (trailHandle) {
      if (flying) {
        const yaw = Math.atan2(lastServer.current.vx, lastServer.current.vz);
        trailHandle.setPoseYaw(
          pose.current.x,
          pose.current.y || FIREBALL_HAND_Y,
          pose.current.z,
          yaw,
        );
        trailHandle.setRateScale(1);
      } else {
        trailHandle.setRateScale(0);
      }
    }

    const g = ball.current;
    if (!g) return;
    g.visible = appeared || phase.current !== "charge";
    g.position.set(0, 0, 0);

    const size =
      BOULDER_SCALE_MIN + growFull.current * (BOULDER_SCALE_MAX - BOULDER_SCALE_MIN);
    g.scale.setScalar(size);
    g.rotation.y += safeDt * (phase.current === "charge" ? 1.6 : 3.2);
    g.rotation.x += safeDt * (phase.current === "charge" ? 0.9 : 2.1);
    if (phase.current !== "charge") g.rotation.z += safeDt * 1.4;

    light.emitAt(
      lightAt.current,
      shot.color,
      amp * LIGHT_INTENSITY * (0.5 + growFull.current * 0.5),
      2.6,
    );
  });

  return (
    <group ref={root} position={[shot.x, shot.y, shot.z]}>
      <group ref={ball} visible={false}>
        {boulder && <primitive object={boulder} />}
        <object3D ref={lightAt} />
      </group>
    </group>
  );
}
