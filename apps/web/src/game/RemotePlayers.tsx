import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { MOVE_SPEED } from "@battlebeasts/shared";
import {
  CharacterAnimationController,
  heroAnimationConfig,
  playRandomDeath,
} from "./animation";
import { CHARACTER_URL, prepareCharacterScene, tintCharacterSurface } from "./characterVisual";
import { syncPlayerCast } from "./syncPlayerCast";
import { dampYawClamped, VISUAL_YAW_RESPONSIVENESS } from "./visualYaw";
import { smashHopOffsetY } from "./smashHop";
import { deathSinkOffsetY, startDeathSink, type DeathSinkState } from "./deathSink";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import { AimIndicator, AIM_RELATION_COLORS, type AimRelation } from "./AimIndicator";

useGLTF.preload(CHARACTER_URL);

type RemotePlayerState = {
  x: number;
  z: number;
  yaw: number;
  hp?: number;
  color: string;
  pattern?: string;
  patternColor?: string;
  disconnected?: boolean;
  castPhase?: string;
  castAbilityId?: string;
  castPhaseEndsAt?: number;
  statuses?: Parameters<typeof hasStatusId>[0];
};

function RemotePlayerAvatar({
  room,
  sessionId,
  relation,
}: {
  room: Room;
  sessionId: string;
  relation: AimRelation;
}) {
  const group = useRef<THREE.Group>(null);
  const aimRef = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const lastCastId = useRef("");
  const comboAnimHoldUntil = useRef(0);
  const aimColor = AIM_RELATION_COLORS[relation];

  const renderPos = useRef(new THREE.Vector3());
  const renderYaw = useRef(0);
  const vel = useRef(new THREE.Vector3());
  const zeroVel = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, t: 0 });
  const colorRef = useRef("#60a5fa");
  const patternRef = useRef("plain");
  const patternColorRef = useRef("#1f2937");
  const seeded = useRef(false);
  const yawLocked = useRef(false);
  const wasDeadRef = useRef(false);
  const deathSinkRef = useRef<DeathSinkState | null>(null);

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
    const controller = new CharacterAnimationController(
      scene,
      animations,
      heroAnimationConfig,
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
        comboAnimHoldUntil.current = 0;
      }
      return;
    }

    // Cloaked players are fully invisible to others (still hittable server-side).
    // Keep dead-reckoning so uncloak doesn't teleport the mesh.
    const cloaked = hasStatusId(p.statuses, "cloaked");
    if (cloaked) {
      g.visible = false;
    } else {
      g.visible = true;
    }

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
        patternRef.current = p.pattern ?? "plain";
        patternColorRef.current = p.patternColor ?? "#1f2937";
        tintCharacterSurface(scene, p.color, patternRef.current, patternColorRef.current);
      }
    }

    if (
      (p.color && p.color !== colorRef.current) ||
      (p.pattern ?? "plain") !== patternRef.current ||
      (p.patternColor ?? "#1f2937") !== patternColorRef.current
    ) {
      colorRef.current = p.color || colorRef.current;
      patternRef.current = p.pattern ?? "plain";
      patternColorRef.current = p.patternColor ?? "#1f2937";
      tintCharacterSurface(
        scene,
        colorRef.current,
        patternRef.current,
        patternColorRef.current,
      );
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

    g.position.set(
      renderPos.current.x,
      smashHopOffsetY(p) + deathSinkOffsetY(deathSinkRef.current),
      renderPos.current.z,
    );
    const aim = aimRef.current;
    if (cloaked) {
      renderYaw.current = p.yaw;
      g.rotation.y = renderYaw.current;
      if (aim) aim.rotation.y = 0;
      return;
    }

    const dead = typeof p.hp === "number" && p.hp <= 0;
    if (dead && !wasDeadRef.current) {
      wasDeadRef.current = true;
      lastCastId.current = "";
      comboAnimHoldUntil.current = 0;
      controller.cancelAbilityAnimation();
      const played = playRandomDeath(controller, animations);
      deathSinkRef.current = startDeathSink(played?.duration ?? 2.6);
    } else if (!dead && wasDeadRef.current) {
      wasDeadRef.current = false;
      deathSinkRef.current = null;
      controller.cancelFullBodyAction();
    }

    if (dead) {
      g.position.set(
        renderPos.current.x,
        smashHopOffsetY(p) + deathSinkOffsetY(deathSinkRef.current),
        renderPos.current.z,
      );
      vel.current.set(0, 0, 0);
      yawLocked.current = true;
      g.rotation.y = renderYaw.current;
      if (aim) aim.rotation.y = p.yaw - renderYaw.current;
      controller.setMovement({
        worldVelocity: zeroVel.current,
        facingYaw: renderYaw.current,
        maximumSpeed: MOVE_SPEED,
      });
      controller.update(safeDt);
      return;
    }

    // Sync casts before reading override state so dash locks facing this frame
    syncPlayerCast(controller, room, sessionId, lastCastId, comboAnimHoldUntil);
    const fullBodyName = controller.getState().activeFullBodyName;
    const jumpAim =
      fullBodyName === "jumpAttack" ||
      fullBodyName === "Jump Attack" ||
      p.castAbilityId === "smash";
    yawLocked.current =
      controller.getState().fullBody === "override" && !jumpAim;
    if (jumpAim) {
      renderYaw.current = p.yaw;
    } else if (!yawLocked.current) {
      renderYaw.current = dampYawClamped(
        renderYaw.current,
        p.yaw,
        VISUAL_YAW_RESPONSIVENESS,
        safeDt,
      );
    }

    g.position.set(renderPos.current.x, smashHopOffsetY(p), renderPos.current.z);
    g.rotation.y = renderYaw.current;
    // Parent uses smoothed body yaw; offset so the tip tracks true look yaw.
    if (aim) aim.rotation.y = p.yaw - renderYaw.current;

    const speed = Math.hypot(vel.current.x, vel.current.z);
    controller.setStunned(hasStatusId(p.statuses, "stunned"));
    const speedMul = hasStatusId(p.statuses, "surged") ? 1.6 : 1;
    controller.setMovement({
      worldVelocity: speed > 0.12 ? vel.current : zeroVel.current,
      facingYaw: renderYaw.current,
      maximumSpeed: MOVE_SPEED * speedMul,
    });
    controller.update(safeDt);
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
      <StatusOrnaments
        getStatuses={() => {
          const p = room.state?.players?.get(sessionId) as
            | { statuses?: Parameters<typeof collectStatusRows>[0] }
            | undefined;
          return collectStatusRows(p?.statuses);
        }}
      />
      <group ref={aimRef}>
        <AimIndicator color={aimColor} />
      </group>
    </group>
  );
}

export function RemotePlayers({
  room,
  localSessionId,
  /** Hub = ally (green); content/PvP = enemy (red) until real teams exist. */
  relation = "ally",
}: {
  room: Room | null;
  localSessionId: string | null;
  relation?: AimRelation;
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
        <RemotePlayerAvatar
          key={id}
          room={room}
          sessionId={id}
          relation={relation}
        />
      ))}
    </>
  );
}
