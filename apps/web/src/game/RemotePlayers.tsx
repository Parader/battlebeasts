import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { MOVE_SPEED, type CosmeticsEquipped } from "@battlebeasts/shared";
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
} from "./characterVisual";
import { cosmeticsKey, equippedFromPlayer } from "./cosmeticAttach";
import { EquippedCosmetics } from "./EquippedCosmetics";
import { syncPlayerCast } from "./syncPlayerCast";
import { smashHopOffsetY } from "./smashHop";
import { deathSinkOffsetY, startDeathSink, type DeathSinkState } from "./deathSink";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import { AimIndicator, AIM_RELATION_COLORS, type AimRelation } from "./AimIndicator";
import { PlayerHpBillboard } from "./PlayerHpBillboard";
import { PlayerCastChannelBar } from "./PlayerCastChannelBar";
import { PlayerNameBillboard } from "./PlayerNameBillboard";
import { PortalChannelAura } from "./vfx/effects/portalChannel";
import { BloodRushChargeAura } from "./vfx/effects/bloodRushCharge";
import { registerCharacterRoot } from "./characterRoots";
import { isRevengeVanished } from "./revengeVanishRuntime";

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
  const bodyRef = useRef<THREE.Group>(null);
  const aimRef = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const lastCastId = useRef("");
  const comboAnimHoldUntil = useRef(0);
  const lastEmoteId = useRef<string | null>(null);
  const aimColor = AIM_RELATION_COLORS[relation];

  const renderPos = useRef(new THREE.Vector3());
  const renderYaw = useRef(0);
  const vel = useRef(new THREE.Vector3());
  const zeroVel = useRef(new THREE.Vector3());
  const lastServer = useRef({ x: 0, z: 0, t: 0 });
  const colorRef = useRef("#60a5fa");
  const patternRef = useRef("plain");
  const patternColorRef = useRef("#1f2937");
  const cosmeticsKeyRef = useRef("");
  const [equipped, setEquipped] = useState<CosmeticsEquipped>({});
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
      lastEmoteId.current = null;
      return;
    }

    // Cloaked / Revenge phase: fully invisible to others (still hittable only if not invuln).
    // Spirit Form is ghosted but still visible. Keep dead-reckoning either way.
    const cloaked = hasStatusId(p.statuses, "cloaked");
    const revengePhased = hasStatusId(p.statuses, "revengePhased");
    const revengeVanished = revengePhased || isRevengeVanished(sessionId);
    const spiritFormed = hasStatusId(p.statuses, "spiritFormed");
    if (cloaked || revengeVanished) {
      g.visible = false;
    } else {
      g.visible = true;
      if (ghostOpacityRef.current !== 1) {
        ghostOpacityRef.current = 1;
        setCharacterOpacity(scene, 1);
      }
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
    }

    const nextCosmetics = cosmeticsKey(p);
    if (nextCosmetics !== cosmeticsKeyRef.current) {
      cosmeticsKeyRef.current = nextCosmetics;
      setEquipped(equippedFromPlayer(p));
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
    if (bodyRef.current) bodyRef.current.rotation.y = renderYaw.current;
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
        <EquippedCosmetics characterRoot={scene} equipped={equipped} />
        <StatusOrnaments
          characterRoot={scene}
          getStatuses={() => {
            const p = room.state?.players?.get(sessionId) as
              | { statuses?: Parameters<typeof collectStatusRows>[0] }
              | undefined;
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
      <PlayerHpBillboard room={room} sessionId={sessionId} />
      <PlayerCastChannelBar room={room} sessionId={sessionId} />
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
  const [remoteIds, setRemoteIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.players) {
      if (prevKey.current !== "") {
        prevKey.current = "";
        setRemoteIds([]);
      }
      return;
    }
    const localUserId =
      (localSessionId &&
        (room.state.players.get(localSessionId) as { id?: string } | undefined)?.id) ||
      "";
    const next: string[] = [];
    room.state.players.forEach((p: { disconnected?: boolean; id?: string }, id: string) => {
      if (id === localSessionId) return;
      if (p?.disconnected) return;
      // Same hunter, older seat (match-return ghost) — never render as a remote.
      if (localUserId && p?.id && p.id === localUserId) return;
      next.push(id);
    });
    next.sort();
    const key = `${room.roomId}:${next.join("|")}`;
    if (key !== prevKey.current) {
      prevKey.current = key;
      setRemoteIds(next);
    }
  });

  // Drop remotes when room instance changes (transfer / reconnect).
  useEffect(() => {
    prevKey.current = "";
    setRemoteIds([]);
  }, [room?.roomId]);

  if (!room) return null;

  return (
    <>
      {remoteIds.map((id) => {
        const p = room.state?.players?.get(id) as { team?: string } | undefined;
        let rel: AimRelation = relation;
        if (localTeam && p?.team) {
          if (p.team === localTeam) rel = "ally";
          else if (p.team === "a" || p.team === "b") rel = "enemy";
          else rel = "neutral";
        }
        return <RemotePlayerAvatar key={id} room={room} sessionId={id} relation={rel} />;
      })}
    </>
  );
}
