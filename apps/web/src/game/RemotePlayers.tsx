import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { useRemotePlayerIds } from "./useColyseusMapKeys";
import { MOVE_SPEED, STARTER_COLORS, type CosmeticsEquipped } from "@battlebeasts/shared";
import {
  CharacterAnimationController,
  heroAnimationConfig,
  playRandomDeath,
  playEmoteAnimation,
} from "./animation";
import { getActiveEmote } from "./emoteRuntime";
import {
  CHARACTER_URL,
  prepareCharacterScene,
  setCharacterOpacity,
  tintCharacterSurface,
  scheduleWarmCharacterOpacityVariants,
  disposeCharacterMaterials,
} from "./characterVisual";
import { cosmeticsKey, equippedFromPlayer } from "./cosmeticAttach";
import { EquippedCosmetics } from "./EquippedCosmetics";
import { usePlayerVessel } from "./usePlayerVessel";
import { syncPlayerCast } from "./syncPlayerCast";
import { smashHopOffsetY } from "./smashHop";
import { deathSinkOffsetY, startDeathSink, type DeathSinkState } from "./deathSink";
import { StatusOrnaments } from "./StatusOrnaments";
import { SpiritVesselFx } from "./SpiritVesselFx";
import { VesselBody } from "./VesselBody";
import { collectStatusRows, hasStatusId, isStealthedStatus } from "./statusBadgeUtils";
import { AimIndicator, AIM_RELATION_COLORS, resolveAimRelation, type AimRelation } from "./AimIndicator";
import { PlayerHpBillboard } from "./PlayerHpBillboard";
import { PlayerCastChannelBar } from "./PlayerCastChannelBar";
import { PlayerNameBillboard } from "./PlayerNameBillboard";
import { PortalChannelAura } from "./vfx/effects/portalChannel";
import { BloodRushChargeAura } from "./vfx/effects/bloodRushCharge";
import { RiftArmRing } from "./vfx/effects/riftArmRing";
import { registerCharacterRoot } from "./characterRoots";
import { isRevengeVanished } from "./revengeVanishRuntime";
import { getTeleportSlamOpacity } from "./teleportSlamFadeRuntime";
import { sampleRemoteDashTravel } from "./dashTravelRuntime";

useGLTF.preload(CHARACTER_URL);

type RemotePlayerState = {
  x: number;
  z: number;
  yaw: number;
  hp?: number;
  color: string;
  pattern?: string;
  patternColor?: string;
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
  vessel?: string;
  disconnected?: boolean;
  castPhase?: string;
  castAbilityId?: string;
  castPhaseEndsAt?: number;
  statuses?: Parameters<typeof hasStatusId>[0];
};

function RemotePlayerAvatar({
  room,
  sessionId,
  localSessionId,
  relation: fallbackRelation,
}: {
  room: Room;
  sessionId: string;
  localSessionId: string | null;
  relation: AimRelation;
}) {
  const group = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const aimRef = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const lastCastId = useRef("");
  const comboAnimHoldUntil = useRef(0);
  const lastEmoteId = useRef<string | null>(null);
  const relationRef = useRef<AimRelation>(fallbackRelation);
  const [relation, setRelation] = useState<AimRelation>(fallbackRelation);
  const aimColor = AIM_RELATION_COLORS[relation];

  const renderPos = useRef(new THREE.Vector3());
  const renderYaw = useRef(0);
  const vel = useRef(new THREE.Vector3());
  const zeroVel = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, t: 0 });
  const colorRef = useRef(STARTER_COLORS[0]!);
  const patternRef = useRef("plain");
  const patternColorRef = useRef("#1f2937");
  const cosmeticsKeyRef = useRef("");
  const [equipped, setEquipped] = useState<CosmeticsEquipped>({});
  const [skinColor, setSkinColor] = useState(() => {
    const p = room.state?.players?.get(sessionId) as { color?: string } | undefined;
    return p?.color || STARTER_COLORS[0]!;
  });
  const vessel = usePlayerVessel(room, sessionId);
  const seeded = useRef(false);
  const yawLocked = useRef(false);
  const wasDeadRef = useRef(false);
  const deathSinkRef = useRef<DeathSinkState | null>(null);
  const ghostOpacityRef = useRef(1);

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
    registerCharacterRoot(sessionId, scene);
    return () => registerCharacterRoot(sessionId, null);
  }, [scene, sessionId]);

  useEffect(() => {
    return () => {
      disposeCharacterMaterials(scene);
    };
  }, [scene]);

  useEffect(() => {
    tintCharacterSurface(scene, skinColor, patternRef.current, patternColorRef.current);
  }, [scene, vessel, skinColor]);

  /*
   * Warm this opponent's ghosted materials on sight rather than the first time
   * they cloak, slam-fade, or drop a decoy. Loadouts already compiled are skipped.
   */
  const gl = useThree((s) => s.gl);
  const rootScene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const equippedKey = JSON.stringify(equipped);
  useEffect(
    () => scheduleWarmCharacterOpacityVariants(gl, rootScene, camera, scene, equippedKey),
    [gl, rootScene, camera, scene, equippedKey],
  );

  useEffect(() => {
    const controller = new CharacterAnimationController(
      scene,
      animations,
      heroAnimationConfig,
    );
    controllerRef.current = controller;
    controller.setCrouchLoco(true, { moving: true, speed01: 0.4 });
    controller.update(1 / 60);
    controller.setCrouchLoco(false);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scene, animations]);

  useFrame((_, dt) => {
    const p = room.state?.players?.get(sessionId) as (RemotePlayerState & { team?: string }) | undefined;
    const local = localSessionId
      ? (room.state?.players?.get(localSessionId) as { team?: string } | undefined)
      : undefined;
    const nextRel = resolveAimRelation(local?.team, p?.team, fallbackRelation);
    if (nextRel !== relationRef.current) {
      relationRef.current = nextRel;
      setRelation(nextRel);
    }
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
      lastEmoteId.current = null;
      return;
    }

    // Cloaked / Revenge phase: fully invisible to others (still hittable only if not invuln).
    // Spirit Form is ghosted but still visible. Keep dead-reckoning either way.
    const cloaked = hasStatusId(p.statuses, "cloaked");
    const revengePhased = hasStatusId(p.statuses, "revengePhased");
    const revengeVanished = revengePhased || isRevengeVanished(sessionId);
    const spiritFormed = hasStatusId(p.statuses, "spiritFormed");
    const slamOpacity = getTeleportSlamOpacity(sessionId);
    if (cloaked || revengeVanished) {
      g.visible = false;
    } else {
      g.visible = slamOpacity > 0.02;
      ghostOpacityRef.current = slamOpacity;
      setCharacterOpacity(scene, slamOpacity);
    }

    const now = performance.now();
    const safeDt = Math.max(1e-4, Math.min(0.05, dt));
    const dashPos = sampleRemoteDashTravel(sessionId, now);

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
        if (p.color !== skinColor) setSkinColor(p.color);
        cosmeticsKeyRef.current = cosmeticsKey(p);
        setEquipped(equippedFromPlayer(p));
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
      if (colorRef.current !== skinColor) setSkinColor(colorRef.current);
    }
    const nextCosmetics = cosmeticsKey(p);
    if (nextCosmetics !== cosmeticsKeyRef.current) {
      cosmeticsKeyRef.current = nextCosmetics;
      setEquipped(equippedFromPlayer(p));
    }

    const serverMoved = p.x !== lastServer.current.x || p.z !== lastServer.current.z;
    if (dashPos) {
      renderPos.current.set(dashPos.x, 0, dashPos.z);
      vel.current.set(
        (dashPos.x - g.position.x) / safeDt,
        0,
        (dashPos.z - g.position.z) / safeDt,
      );
      lastServer.current = { x: dashPos.x, z: dashPos.z, t: now };
    } else if (serverMoved) {
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

    if (!dashPos) {
      // Dead-reckon between patches, then soft-correct to authority
      renderPos.current.x += vel.current.x * safeDt;
      renderPos.current.z += vel.current.z * safeDt;
      const blend = 1 - Math.exp(-18 * safeDt);
      renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend * 0.85);
      renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend * 0.85);

      const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
      const spd = Math.hypot(vel.current.x, vel.current.z);
      // Hard snap only for true teleports — keep fast dashes (Charge) fluid.
      if (err > 2.5 && spd < 7) {
        renderPos.current.set(p.x, 0, p.z);
        vel.current.set(0, 0, 0);
      }
    }

    g.position.set(
      renderPos.current.x,
      smashHopOffsetY(p) + deathSinkOffsetY(deathSinkRef.current),
      renderPos.current.z,
    );
    const aim = aimRef.current;

    // Match / Wave Assault pause: snap to authority and hold pose.
    if ((room.state as { paused?: boolean } | undefined)?.paused) {
      renderPos.current.set(p.x, 0, p.z);
      vel.current.set(0, 0, 0);
      renderYaw.current = p.yaw;
      g.position.set(p.x, smashHopOffsetY(p) + deathSinkOffsetY(deathSinkRef.current), p.z);
      if (bodyRef.current) bodyRef.current.rotation.y = renderYaw.current;
      if (aim) aim.rotation.y = 0;
      return;
    }

    if (cloaked) {
      renderYaw.current = p.yaw;
      if (bodyRef.current) bodyRef.current.rotation.y = renderYaw.current;
      if (aim) aim.rotation.y = 0;
      return;
    }

    const dead = typeof p.hp === "number" && p.hp <= 0;
    if (dead && !wasDeadRef.current) {
      wasDeadRef.current = true;
      lastCastId.current = "";
      comboAnimHoldUntil.current = 0;
      lastEmoteId.current = null;
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
      if (bodyRef.current) bodyRef.current.rotation.y = renderYaw.current;
      if (aim) aim.rotation.y = p.yaw - renderYaw.current;
      // Arena taunts after death / wipe window.
      const activeEmoteId = getActiveEmote(sessionId);
      if (activeEmoteId) {
        if (lastEmoteId.current !== activeEmoteId) {
          lastEmoteId.current = activeEmoteId;
          playEmoteAnimation(controller, activeEmoteId);
        }
      } else if (lastEmoteId.current) {
        lastEmoteId.current = null;
      }
      controller.setMovement({
        worldVelocity: zeroVel.current,
        facingYaw: p.yaw,
        maximumSpeed: MOVE_SPEED,
      });
      controller.update(safeDt);
      return;
    }

    // Sync casts before reading override state so dash locks facing this frame
    syncPlayerCast(controller, room, sessionId, lastCastId, comboAnimHoldUntil);

    // Full-body emote pie wheel — independent of the ability cast schema fields.
    const activeEmoteId = getActiveEmote(sessionId);
    if (activeEmoteId) {
      if (lastEmoteId.current !== activeEmoteId) {
        lastEmoteId.current = activeEmoteId;
        playEmoteAnimation(controller, activeEmoteId);
      }
    } else if (lastEmoteId.current) {
      lastEmoteId.current = null;
      controller.cancelFullBodyAction();
    }

    const fullBodyName = controller.getState().activeFullBodyName;
    const jumpAim =
      fullBodyName === "jumpAttack" ||
      fullBodyName === "Jump Attack" ||
      p.castAbilityId === "smash";
    const portalAim =
      p.castAbilityId === "portal" ||
      fullBodyName === "castPraying" ||
      fullBodyName === "praying";
    const bloodRushAim =
      p.castAbilityId === "bloodRush" &&
      (p.castPhase === "anticipation" || p.castPhase === "cast");
    const handShieldAim = hasStatusId(p.statuses, "handShielding");
    /** Emote wheel dances: full-body plays, but facing still follows the cursor. */
    const emoteAim = Boolean(activeEmoteId);
    const speed = Math.hypot(vel.current.x, vel.current.z);
    yawLocked.current =
      controller.getState().fullBody === "override" &&
      !jumpAim &&
      !portalAim &&
      !bloodRushAim &&
      !handShieldAim &&
      !emoteAim;
    if (jumpAim || portalAim || bloodRushAim || handShieldAim || emoteAim) {
      renderYaw.current = p.yaw;
    } else if (!yawLocked.current) {
      // Mixamo strafe/back require aim-forward root (same as local avatar).
      renderYaw.current = p.yaw;
    }

    g.position.set(renderPos.current.x, smashHopOffsetY(p), renderPos.current.z);
    if (bodyRef.current) {
      bodyRef.current.rotation.y = renderYaw.current;
      const isAscendant = hasStatusId(p.statuses, "ascendantForm");
      const targetScale = isAscendant ? 1.5 : 1.0;
      bodyRef.current.scale.setScalar(
        THREE.MathUtils.damp(bodyRef.current.scale.x, targetScale, 10, safeDt),
      );
    }
    if (aim) aim.rotation.y = p.yaw - renderYaw.current;

    controller.setStunned(hasStatusId(p.statuses, "stunned"));
    const speedMul = hasStatusId(p.statuses, "surged")
      ? 1.6
      : spiritFormed
        ? 1.35
        : 1;
    controller.setMovement({
      worldVelocity: speed > 0.12 ? vel.current : zeroVel.current,
      facingYaw: p.yaw,
      aimYaw: p.yaw,
      bodyYaw: renderYaw.current,
      maximumSpeed: MOVE_SPEED * speedMul,
      baseMoveSpeed: MOVE_SPEED,
    });
    controller.update(safeDt);
  });

  return (
    <group ref={group}>
      <group ref={bodyRef}>
        <primitive object={scene} />
        <VesselBody characterRoot={scene} body={vessel} color={skinColor} />
        <EquippedCosmetics characterRoot={scene} equipped={equipped} body={vessel} />
        <SpiritVesselFx
          characterRoot={scene}
          getColor={() => colorRef.current}
          getOpacity={() => {
            const p = room.state?.players?.get(sessionId) as
              | { statuses?: Parameters<typeof isStealthedStatus>[0] }
              | undefined;
            if (isStealthedStatus(p?.statuses)) return 0;
            return ghostOpacityRef.current;
          }}
          getAura={() => {
            const p = room.state?.players?.get(sessionId) as
              | { pattern?: string }
              | undefined;
            return p?.pattern ?? "plain";
          }}
          getAuraColor={() => {
            const p = room.state?.players?.get(sessionId) as
              | { patternColor?: string }
              | undefined;
            return p?.patternColor ?? "#1f2937";
          }}
          getStatuses={() => {
            const p = room.state?.players?.get(sessionId) as
              | { statuses?: Parameters<typeof collectStatusRows>[0] }
              | undefined;
            if (isStealthedStatus(p?.statuses)) return [];
            return collectStatusRows(p?.statuses);
          }}
        />
        <StatusOrnaments
          characterRoot={scene}
          getStatuses={() => {
            const p = room.state?.players?.get(sessionId) as
              | { statuses?: Parameters<typeof collectStatusRows>[0] }
              | undefined;
            // Html ornaments ignore mesh visibility — hide while stealthed.
            if (isStealthedStatus(p?.statuses)) {
              return [];
            }
            return collectStatusRows(p?.statuses);
          }}
        />
        <PortalChannelAura room={room} sessionId={sessionId} />
        <BloodRushChargeAura room={room} sessionId={sessionId} />
        <group ref={aimRef}>
          <AimIndicator color={aimColor} />
        </group>
      </group>
      {/* HP/name stay on non-rotated root so spin doesn't ghost a second bar. */}
      <PlayerHpBillboard
        room={room}
        sessionId={sessionId}
        alwaysVisible={relation === "enemy"}
        fillColor={relation === "enemy" ? "#f87171" : "#4ade80"}
      />
      <PlayerCastChannelBar room={room} sessionId={sessionId} />
      <RiftArmRing room={room} sessionId={sessionId} />
      <PlayerNameBillboard room={room} sessionId={sessionId} />
    </group>
  );
}

export function RemotePlayers({
  room,
  localSessionId,
  /** Hub = ally (green); content fallback when no team data. */
  relation = "ally",
  /** When set, remotes use team vs localTeam for aim color. */
  localTeam,
}: {
  room: Room | null;
  localSessionId: string | null;
  relation?: AimRelation;
  localTeam?: string;
}) {
  const remoteIds = useRemotePlayerIds(room, localSessionId);

  if (!room) return null;

  return (
    <>
      {remoteIds.map((id) => {
        const p = room.state?.players?.get(id) as { team?: string } | undefined;
        const rel = resolveAimRelation(localTeam, p?.team, relation);
        return (
          <RemotePlayerAvatar
            key={id}
            room={room}
            sessionId={id}
            localSessionId={localSessionId}
            relation={rel}
          />
        );
      })}
    </>
  );
}
