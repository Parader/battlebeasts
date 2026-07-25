import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { MOVE_SPEED } from "@battlebeasts/shared";
import {
  CharacterAnimationController,
  heroAnimationConfig,
  debugPrintAnimationAssets,
} from "./animation";
import { CHARACTER_URL, prepareCharacterScene, setCharacterOpacity, tintCharacterSurface } from "./characterVisual";
import { syncPlayerCast } from "./syncPlayerCast";
import { dampYawClamped, VISUAL_YAW_RESPONSIVENESS, shortestAngleDelta } from "./visualYaw";
import { AimIndicator } from "./AimIndicator";
import { smashHopOffsetY } from "./smashHop";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import { findBone } from "./vfx/attach";
import type { PredictedPose } from "./useBaseCityRoom";

useGLTF.preload(CHARACTER_URL);

/** Max head yaw toward cursor while crouch-walking (rad). */
const CLOAK_HEAD_LOOK_MAX = 0.9;
const CLOAK_MOVE_SPEED_EPS = 0.35;

type Props = {
  predictedRef: MutableRefObject<PredictedPose>;
  room: Room | null;
  localSessionId: string | null;
  /** Tint surface material when present. */
  color?: string;
  debug?: boolean;
};

/**
 * Local player avatar + layered animation controller (hero.glb).
 * Gameplay owns root transform; animations never apply horizontal root motion.
 * Visual yaw is smoothed (and locked during full-body overrides like dash).
 * Aim ring follows instant gameplay yaw.
 * While cloaked: crouch-walk aligned to move; head only looks at cursor.
 */
export function CharacterAvatar({
  predictedRef,
  room,
  localSessionId,
  color,
  debug = false,
}: Props) {
  const group = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const aimRef = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const headBoneRef = useRef<THREE.Object3D | null>(null);
  const prevPos = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const lastCastId = useRef("");
  const comboAnimHoldUntil = useRef(0);
  const seededMove = useRef(false);
  const visualYaw = useRef(0);
  const yawLocked = useRef(false);
  const cloakedRef = useRef(false);

  const gltf = useGLTF(CHARACTER_URL);
  const scene = useMemo(() => {
    const idle =
      gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
      gltf.animations[0] ??
      null;
    return prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
  }, [gltf.scene, gltf.animations]);
  const animations = gltf.animations;

  useEffect(() => {
    if (!color) return;
    tintCharacterSurface(scene, color);
  }, [color, scene]);

  useEffect(() => {
    const controller = new CharacterAnimationController(
      scene,
      animations,
      heroAnimationConfig,
    );
    controllerRef.current = controller;
    headBoneRef.current =
      findBone(scene, "mixamorig:Head", { partial: true }) ??
      findBone(scene, "head", { partial: true });

    if (debug) {
      debugPrintAnimationAssets(scene, animations, "[hero.glb]");
      (window as unknown as { __animDebug?: () => void }).__animDebug = () =>
        controller.debugAnimations();
    }

    return () => {
      controller.dispose();
      controllerRef.current = null;
      headBoneRef.current = null;
    };
  }, [scene, animations, debug]);

  useEffect(() => {
    const onLocalCancel = () => {
      // Fade cast out immediately, but keep lastCastId so schema lag cannot
      // restart the same cast via syncPlayerCast (castKey still matches).
      comboAnimHoldUntil.current = 0;
      controllerRef.current?.cancelAbilityAnimation();
    };
    window.addEventListener("bb-cast-anim-cancel", onLocalCancel);
    return () => window.removeEventListener("bb-cast-anim-cancel", onLocalCancel);
  }, []);

  useFrame((_, delta) => {
    const g = group.current;
    const body = bodyRef.current;
    const aim = aimRef.current;
    const controller = controllerRef.current;
    if (!g || !body || !controller) return;

    const p = predictedRef.current;
    const safeDt = Math.max(1e-4, Math.min(0.05, delta));

    const me = localSessionId
      ? (room?.state?.players?.get(localSessionId) as
          | {
              castAbilityId?: string;
              castPhase?: string;
              castPhaseEndsAt?: number;
              statuses?: Parameters<typeof hasStatusId>[0];
            }
          | undefined)
      : undefined;
    g.position.set(p.x, smashHopOffsetY(me), p.z);
    if (aim) aim.rotation.y = p.yaw;

    if (!seededMove.current) {
      prevPos.current.set(p.x, 0, p.z);
      visualYaw.current = p.yaw;
      seededMove.current = true;
    }

    velocity.current.set(
      (p.x - prevPos.current.x) / safeDt,
      0,
      (p.z - prevPos.current.z) / safeDt,
    );
    prevPos.current.set(p.x, 0, p.z);

    const cloaked = hasStatusId(me?.statuses, "cloaked");
    const castingDecoy = me?.castAbilityId === "decoy";
    const speed = Math.hypot(velocity.current.x, velocity.current.z);
    const movingCloak = cloaked && !castingDecoy && speed > CLOAK_MOVE_SPEED_EPS;

    syncPlayerCast(controller, room, localSessionId, lastCastId, comboAnimHoldUntil);

    // Jump Attack keeps mouse aim; dash still locks facing for the dive.
    const fullBodyName = controller.getState().activeFullBodyName;
    const jumpAim =
      fullBodyName === "jumpAttack" ||
      fullBodyName === "Jump Attack" ||
      me?.castAbilityId === "smash";
    const crouchWalkActive = cloaked && !castingDecoy;
    const grooveActive =
      me?.castAbilityId === "groove" ||
      fullBodyName === "jazzDance" ||
      fullBodyName === "Jazz Dancing";
    /** Body faces travel; head tracks cursor (cloak + Groove channel). */
    const moveBodyAim = crouchWalkActive || grooveActive;
    const movingForBody = moveBodyAim && speed > CLOAK_MOVE_SPEED_EPS;

    yawLocked.current =
      (controller.getState().fullBody === "override" &&
        !jumpAim &&
        !crouchWalkActive &&
        !grooveActive) ||
      false;

    if (jumpAim) {
      visualYaw.current = p.yaw;
    } else if (moveBodyAim) {
      // Body faces travel direction; idle keeps last move facing.
      if (movingForBody) {
        const moveYaw = Math.atan2(velocity.current.x, velocity.current.z);
        visualYaw.current = dampYawClamped(
          visualYaw.current,
          moveYaw,
          VISUAL_YAW_RESPONSIVENESS * 1.15,
          safeDt,
        );
      }
    } else if (!yawLocked.current) {
      visualYaw.current = dampYawClamped(
        visualYaw.current,
        p.yaw,
        VISUAL_YAW_RESPONSIVENESS,
        safeDt,
      );
    }

    body.rotation.y = visualYaw.current;

    if (cloaked !== cloakedRef.current) {
      cloakedRef.current = cloaked;
      setCharacterOpacity(scene, cloaked ? 0.32 : 1);
      if (!cloaked) {
        controller.setCrouchLoco(false);
      }
    }

    if (crouchWalkActive) {
      const speed01 = Math.min(1, speed / (MOVE_SPEED * 1.05));
      controller.setCrouchLoco(true, { moving: movingCloak, speed01 });
    } else if (!castingDecoy) {
      controller.setCrouchLoco(false);
    }

    controller.setStunned(hasStatusId(me?.statuses, "stunned"));
    const speedMul = hasStatusId(me?.statuses, "surged") ? 1.6 : 1;
    controller.setMovement({
      worldVelocity: velocity.current,
      facingYaw: visualYaw.current,
      maximumSpeed: MOVE_SPEED * speedMul,
    });
    controller.update(safeDt);

    // Head toward cursor while cloaked or Grooving (after mixer writes bones).
    const head = headBoneRef.current;
    if (head && moveBodyAim) {
      const deltaYaw = shortestAngleDelta(visualYaw.current, p.yaw);
      const look = Math.max(-CLOAK_HEAD_LOOK_MAX, Math.min(CLOAK_HEAD_LOOK_MAX, deltaYaw));
      head.rotation.y += look;
    }
  });

  return (
    <group ref={group}>
      <group ref={bodyRef}>
        <primitive object={scene} />
        <StatusOrnaments
          getStatuses={() => {
            if (!room || !localSessionId) return [];
            const me = room.state?.players?.get(localSessionId) as
              | { statuses?: Parameters<typeof collectStatusRows>[0] }
              | undefined;
            return collectStatusRows(me?.statuses);
          }}
        />
      </group>
      <group ref={aimRef}>
        <AimIndicator color={color ?? "#7dd3fc"} />
      </group>
    </group>
  );
}
