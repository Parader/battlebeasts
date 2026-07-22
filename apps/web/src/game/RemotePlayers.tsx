import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { MOVE_SPEED } from "@battlebeasts/shared";
import {
  CharacterAnimationController,
  character1AnimationConfig,
} from "./animation";
import { CHARACTER_URL, prepareCharacterScene, tintCharacterSurface } from "./characterVisual";
import { syncPlayerCast } from "./syncPlayerCast";
import { dampYawClamped, VISUAL_YAW_RESPONSIVENESS } from "./visualYaw";

useGLTF.preload(CHARACTER_URL);

type RemotePlayerState = {
  x: number;
  z: number;
  yaw: number;
  color: string;
  disconnected?: boolean;
  castPhase?: string;
  castAbilityId?: string;
};

function RemotePlayerAvatar({ room, sessionId }: { room: Room; sessionId: string }) {
  const group = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const lastCastId = useRef("");

  const renderPos = useRef(new THREE.Vector3());
  const renderYaw = useRef(0);
  const vel = useRef(new THREE.Vector3());
  const zeroVel = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, t: 0 });
  const colorRef = useRef("#60a5fa");
  const seeded = useRef(false);
  const yawLocked = useRef(false);

  const gltf = useGLTF(CHARACTER_URL);
  const scene = useMemo(() => prepareCharacterScene(gltf.scene), [gltf.scene]);
  const animations = gltf.animations;

  useEffect(() => {
    const controller = new CharacterAnimationController(
      scene,
      animations,
      character1AnimationConfig,
    );
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scene, animations]);

  useFrame((_, dt) => {
    const p = room.state?.players?.get(sessionId) as RemotePlayerState | undefined;
    const g = group.current;
    const controller = controllerRef.current;
    if (!p || !g || !controller || p.disconnected) {
      if (g) g.visible = false;
      seeded.current = false;
      if (controller && lastCastId.current) {
        controller.cancelAbilityAnimation();
        lastCastId.current = "";
      }
      return;
    }
    g.visible = true;

    const now = performance.now();
    const safeDt = Math.max(1e-4, Math.min(0.05, dt));

    if (!seeded.current) {
      renderPos.current.set(p.x, 0, p.z);
      renderYaw.current = p.yaw;
      lastServer.current = { x: p.x, z: p.z, t: now };
      vel.current.set(0, 0, 0);
      seeded.current = true;
      if (p.color) {
        colorRef.current = p.color;
        tintCharacterSurface(scene, p.color);
      }
    }

    if (p.color && p.color !== colorRef.current) {
      colorRef.current = p.color;
      tintCharacterSurface(scene, p.color);
    }

    const serverMoved = p.x !== lastServer.current.x || p.z !== lastServer.current.z;
    if (serverMoved) {
      const elapsed = Math.max(0.016, (now - lastServer.current.t) / 1000);
      vel.current.set(
        (p.x - lastServer.current.x) / elapsed,
        0,
        (p.z - lastServer.current.z) / elapsed,
      );
      lastServer.current = { x: p.x, z: p.z, t: now };
    } else {
      // Decay dead-reckon velocity when authority hasn't moved (standing still)
      const decay = Math.exp(-8 * safeDt);
      vel.current.x *= decay;
      vel.current.z *= decay;
      if (Math.hypot(vel.current.x, vel.current.z) < 0.05) {
        vel.current.set(0, 0, 0);
      }
    }

    // Dead-reckon between patches, then soft-correct to authority
    renderPos.current.x += vel.current.x * safeDt;
    renderPos.current.z += vel.current.z * safeDt;
    const blend = 1 - Math.exp(-18 * safeDt);
    renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend * 0.85);
    renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend * 0.85);

    const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
    if (err > 2.5) {
      renderPos.current.set(p.x, 0, p.z);
      vel.current.set(0, 0, 0);
    }

    // Sync casts before reading override state so dash locks facing this frame
    syncPlayerCast(controller, room, sessionId, lastCastId);
    yawLocked.current = controller.getState().fullBody === "override";
    if (!yawLocked.current) {
      renderYaw.current = dampYawClamped(
        renderYaw.current,
        p.yaw,
        VISUAL_YAW_RESPONSIVENESS,
        safeDt,
      );
    }

    g.position.set(renderPos.current.x, 0, renderPos.current.z);
    g.rotation.y = renderYaw.current;

    const speed = Math.hypot(vel.current.x, vel.current.z);
    controller.setMovement({
      worldVelocity: speed > 0.12 ? vel.current : zeroVel.current,
      facingYaw: renderYaw.current,
      maximumSpeed: MOVE_SPEED,
    });
    controller.update(safeDt);
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

export function RemotePlayers({
  room,
  localSessionId,
}: {
  room: Room | null;
  localSessionId: string | null;
}) {
  const [remoteIds, setRemoteIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.players) return;
    const next: string[] = [];
    room.state.players.forEach((_p: unknown, id: string) => {
      if (id !== localSessionId) next.push(id);
    });
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setRemoteIds(next);
    }
  });

  if (!room) return null;

  return (
    <>
      {remoteIds.map((id) => (
        <RemotePlayerAvatar key={id} room={room} sessionId={id} />
      ))}
    </>
  );
}
