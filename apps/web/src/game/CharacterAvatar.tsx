import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { ABILITIES, MOVE_SPEED, totalCastDurationMs } from "@battlebeasts/shared";
import {
  CharacterAnimationController,
  abilityAnimationBindings,
  character1AnimationConfig,
  debugPrintAnimationAssets,
} from "./animation";
import type { PredictedPose } from "./useBaseCityRoom";

const CHARACTER_URL = "/character1.glb";
/** Desired standing height in world meters (gameplay capsule was ~1.4). */
const TARGET_HEIGHT = 1.7;

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
 * Local player Mixamo avatar + layered animation controller.
 * Gameplay owns root transform; animations never apply horizontal root motion.
 */
export function CharacterAvatar({
  predictedRef,
  room,
  localSessionId,
  color,
  debug = false,
}: Props) {
  const group = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const prevPos = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const lastCastId = useRef("");
  const seededMove = useRef(false);

  const gltf = useGLTF(CHARACTER_URL);

  const scene = useMemo(() => {
    const root = cloneSkinned(gltf.scene) as THREE.Object3D;
    // Stand Mixamo Z-up body into Y-up — only X, never combine with Y here
    root.rotation.x = -Math.PI / 2;

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if ("side" in std) std.side = THREE.FrontSide;
          if ("envMapIntensity" in std) std.envMapIntensity = 1;
        }
      }
    });

    // Fit to a readable height and plant feet on y=0 under the gameplay root.
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 1e-4) {
      root.scale.setScalar(TARGET_HEIGHT / size.y);
      root.updateMatrixWorld(true);
    }
    const fitted = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    fitted.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= fitted.min.y;
    root.updateMatrixWorld(true);

    return root;
  }, [gltf.scene]);

  const animations = gltf.animations;

  useEffect(() => {
    if (!color) return;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const name = mesh.name.toLowerCase();
      if (!name.includes("surface")) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if ("color" in std && std.color) std.color.set(color);
      }
    });
  }, [color, scene]);

  useEffect(() => {
    const controller = new CharacterAnimationController(
      scene,
      animations,
      character1AnimationConfig,
    );
    controllerRef.current = controller;

    if (debug) {
      debugPrintAnimationAssets(scene, animations, "[character1.glb]");
      // Expose for console: window.__animDebug?.()
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
    const controller = controllerRef.current;
    if (!g || !controller) return;

    const p = predictedRef.current;
    const safeDt = Math.max(1e-4, Math.min(0.05, delta));

    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;

    if (!seededMove.current) {
      prevPos.current.set(p.x, 0, p.z);
      seededMove.current = true;
    }

    velocity.current.set(
      (p.x - prevPos.current.x) / safeDt,
      0,
      (p.z - prevPos.current.z) / safeDt,
    );
    prevPos.current.set(p.x, 0, p.z);

    controller.setMovement({
      worldVelocity: velocity.current,
      facingYaw: p.yaw,
      maximumSpeed: MOVE_SPEED,
    });
    controller.update(safeDt);

    syncCastFromRoom(controller, room, localSessionId, lastCastId);
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

function syncCastFromRoom(
  controller: CharacterAnimationController,
  room: Room | null,
  localSessionId: string | null,
  lastCastId: MutableRefObject<string>,
): void {
  if (!room || !localSessionId) return;
  const me = room.state?.players?.get(localSessionId) as
    | { castPhase?: string; castAbilityId?: string }
    | undefined;

  if (!me?.castAbilityId || !me.castPhase) {
    if (lastCastId.current) {
      controller.cancelAbilityAnimation();
      lastCastId.current = "";
    }
    return;
  }

  if (me.castAbilityId === lastCastId.current) return;
  if (
    me.castPhase !== "anticipation" &&
    me.castPhase !== "cast" &&
    me.castPhase !== "impact"
  ) {
    return;
  }

  lastCastId.current = me.castAbilityId;

  const def = ABILITIES[me.castAbilityId];
  const binding = abilityAnimationBindings[me.castAbilityId];
  if (!binding) return;

  const durationSec = def ? totalCastDurationMs(def) / 1000 : undefined;

  if (binding.fullBody) {
    // Try logical key ("dash") then clip name ("Jump")
    const logical = String(binding.fullBody);
    const clipName = character1AnimationConfig[binding.fullBody] ?? logical;
    const ok =
      controller.playFullBodyAction(logical, {
        desiredDuration: durationSec,
        restoreLayers: true,
      }) ||
      controller.playFullBodyAction(clipName, {
        desiredDuration: durationSec,
        restoreLayers: true,
      });
    if (!ok) lastCastId.current = "";
    return;
  }

  if (binding.upper) {
    // Prefer logical key ("castPrimary") — registered on the controller
    const logical = String(binding.upper);
    const ok = controller.playUpperBodyAction(logical, {
      desiredDuration: durationSec,
    });
    if (!ok) {
      // Fall back to raw clip name once
      const clipName = character1AnimationConfig[binding.upper];
      const ok2 = clipName
        ? controller.playUpperBodyAction(clipName, { desiredDuration: durationSec })
        : false;
      if (!ok2) lastCastId.current = "";
    }
  }
}
