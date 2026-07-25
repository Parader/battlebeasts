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
import { CHARACTER_URL, prepareCharacterScene, tintCharacterSurface } from "./characterVisual";
import { syncPlayerCast } from "./syncPlayerCast";
import { dampYawClamped, VISUAL_YAW_RESPONSIVENESS } from "./visualYaw";
import { AimIndicator } from "./AimIndicator";
import { smashHopOffsetY } from "./smashHop";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import type { PredictedPose } from "./useBaseCityRoom";

useGLTF.preload(CHARACTER_URL);

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
  const prevPos = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const lastCastId = useRef("");
  const comboAnimHoldUntil = useRef(0);
  const seededMove = useRef(false);
  const visualYaw = useRef(0);
  const yawLocked = useRef(false);

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

    if (debug) {
      debugPrintAnimationAssets(scene, animations, "[hero.glb]");
      (window as unknown as { __animDebug?: () => void }).__animDebug = () =>
        controller.debugAnimations();
    }

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scene, animations, debug]);

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

    syncPlayerCast(controller, room, localSessionId, lastCastId, comboAnimHoldUntil);

    // Jump Attack keeps mouse aim; dash still locks facing for the dive.
    const fullBodyName = controller.getState().activeFullBodyName;
    const jumpAim =
      fullBodyName === "jumpAttack" ||
      fullBodyName === "Jump Attack" ||
      me?.castAbilityId === "smash";
    yawLocked.current =
      controller.getState().fullBody === "override" && !jumpAim;

    if (jumpAim) {
      // Instant aim — Leap Slam facing is mouse-driven, not damp-smoothed.
      visualYaw.current = p.yaw;
    } else if (!yawLocked.current) {
      visualYaw.current = dampYawClamped(
        visualYaw.current,
        p.yaw,
        VISUAL_YAW_RESPONSIVENESS,
        safeDt,
      );
    }

    body.rotation.y = visualYaw.current;

    velocity.current.set(
      (p.x - prevPos.current.x) / safeDt,
      0,
      (p.z - prevPos.current.z) / safeDt,
    );
    prevPos.current.set(p.x, 0, p.z);

    controller.setStunned(hasStatusId(me?.statuses, "stunned"));
    const speedMul = hasStatusId(me?.statuses, "surged") ? 1.6 : 1;
    controller.setMovement({
      worldVelocity: velocity.current,
      facingYaw: visualYaw.current,
      maximumSpeed: MOVE_SPEED * speedMul,
    });
    controller.update(safeDt);
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
