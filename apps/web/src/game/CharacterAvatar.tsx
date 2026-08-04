import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { MOVE_SPEED, STARTER_COLORS, type CosmeticsEquipped } from "@battlebeasts/shared";
import {
  CharacterAnimationController,
  heroAnimationConfig,
  debugPrintAnimationAssets,
  playRandomDeath,
  playEmoteAnimation,
} from "./animation";
import { getActiveEmote } from "./emoteRuntime";
import { CHARACTER_URL, prepareCharacterScene, setCharacterOpacity, tintCharacterSurface } from "./characterVisual";
import { cosmeticsKey, equippedFromPlayer } from "./cosmeticAttach";
import { EquippedCosmetics } from "./EquippedCosmetics";
import { syncPlayerCast } from "./syncPlayerCast";
import { dampYawClamped, VISUAL_YAW_RESPONSIVENESS, shortestAngleDelta } from "./visualYaw";
import { AimIndicator, AIM_RELATION_COLORS } from "./AimIndicator";
import { smashHopOffsetY } from "./smashHop";
import { deathSinkOffsetY, startDeathSink, type DeathSinkState } from "./deathSink";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import { findBone } from "./vfx/attach";
import { registerCharacterRoot } from "./characterRoots";
import type { PredictedPose } from "./useBaseCityRoom";
import { PlayerHpBillboard } from "./PlayerHpBillboard";
import { PlayerCastChannelBar } from "./PlayerCastChannelBar";
import { InteractPromptBillboard } from "./InteractPromptBillboard";
import { resetFootsteps, tickFootsteps } from "./gameSfx";
import { PortalChannelAura } from "./vfx/effects/portalChannel";
import { RiftArmRing } from "./vfx/effects/riftArmRing";
import { BloodRushChargeAura } from "./vfx/effects/bloodRushCharge";
import { AbilityHoverTelegraph } from "./vfx/AbilityHoverTelegraph";
import { isRevengeVanished } from "./revengeVanishRuntime";

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
 * Visual yaw follows aim (Mixamo 5-way needs aim-forward root).
 * Aim ring / Spine1 follow gameplay cursor yaw.
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
  const lastEmoteId = useRef<string | null>(null);
  const seededMove = useRef(false);
  const visualYaw = useRef(0);
  const yawLocked = useRef(false);
  const ghostOpacityRef = useRef(1);
  const [cloakOpacity, setCloakOpacity] = useState(1);
  const appearanceKey = useRef("");
  const cosmeticsKeyRef = useRef("");
  const [equipped, setEquipped] = useState<CosmeticsEquipped>({});
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
    if (!color) return;
    const me = localSessionId
      ? (room?.state?.players?.get(localSessionId) as
          | {
              pattern?: string;
              patternColor?: string;
              cosmeticHat?: string;
              cosmeticShoulders?: string;
              cosmeticChest?: string;
              cosmeticGloves?: string;
              cosmeticBelt?: string;
              cosmeticLegs?: string;
              cosmeticShoes?: string;
            }
          | undefined)
      : undefined;
    const pattern = me?.pattern || "plain";
    const patternColor = me?.patternColor || "#1f2937";
    tintCharacterSurface(scene, color, pattern, patternColor);
    appearanceKey.current = `${color}|${pattern}|${patternColor}`;
    const nextKey = cosmeticsKey(me);
    if (nextKey !== cosmeticsKeyRef.current) {
      cosmeticsKeyRef.current = nextKey;
      setEquipped(equippedFromPlayer(me));
    }
  }, [color, scene, room, localSessionId]);

  useEffect(() => {
    if (!localSessionId) return;
    registerCharacterRoot(localSessionId, scene);
    return () => registerCharacterRoot(localSessionId, null);
  }, [scene, localSessionId]);

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
              hp?: number;
              castAbilityId?: string;
              castPhase?: string;
              castPhaseEndsAt?: number;
              color?: string;
              pattern?: string;
              patternColor?: string;
              cosmeticHat?: string;
              cosmeticShoulders?: string;
              cosmeticChest?: string;
              cosmeticGloves?: string;
              cosmeticBelt?: string;
              cosmeticLegs?: string;
              cosmeticShoes?: string;
              statuses?: Parameters<typeof hasStatusId>[0];
            }
          | undefined)
      : undefined;
    const liveColor = me?.color ?? color ?? STARTER_COLORS[0]!;
    const livePattern = me?.pattern ?? "plain";
    const livePatternColor = me?.patternColor ?? "#1f2937";
    const key = `${liveColor}|${livePattern}|${livePatternColor}`;
    if (key !== appearanceKey.current) {
      appearanceKey.current = key;
      tintCharacterSurface(scene, liveColor, livePattern, livePatternColor);
    }
    const nextCosmetics = cosmeticsKey(me);
    if (nextCosmetics !== cosmeticsKeyRef.current) {
      cosmeticsKeyRef.current = nextCosmetics;
      setEquipped(equippedFromPlayer(me));
    }
    g.position.set(p.x, smashHopOffsetY(me) + deathSinkOffsetY(deathSinkRef.current), p.z);

    const revengeVanishedEarly =
      hasStatusId(me?.statuses, "revengePhased") || isRevengeVanished(localSessionId);
    // Hide before any further work this frame so a late latch still covers this paint.
    if (bodyRef.current) bodyRef.current.visible = !revengeVanishedEarly;
    if (aim) aim.visible = !revengeVanishedEarly;

    // Match / Wave Assault pause: hold pose (don't advance the mixer).
    if ((room?.state as { paused?: boolean } | undefined)?.paused) {
      if (!seededMove.current) {
        prevPos.current.set(p.x, 0, p.z);
        visualYaw.current = p.yaw;
        seededMove.current = true;
      }
      body.rotation.y = visualYaw.current;
      if (aim) aim.rotation.y = p.yaw - visualYaw.current;
      return;
    }

    if (!seededMove.current) {
      prevPos.current.set(p.x, 0, p.z);
      visualYaw.current = p.yaw;
      seededMove.current = true;
    }

    const dead = typeof me?.hp === "number" && me.hp <= 0;
    if (dead && !wasDeadRef.current) {
      wasDeadRef.current = true;
      lastCastId.current = "";
      comboAnimHoldUntil.current = 0;
      lastEmoteId.current = null;
      controller.cancelAbilityAnimation();
      const played = playRandomDeath(controller, animations);
      deathSinkRef.current = startDeathSink(played?.duration ?? 2.6);
      window.dispatchEvent(
        new CustomEvent("bb-death-anim", {
          detail: { durationSec: played?.duration ?? 2.6 },
        }),
      );
    } else if (!dead && wasDeadRef.current) {
      wasDeadRef.current = false;
      deathSinkRef.current = null;
      controller.cancelFullBodyAction();
    }

    // Keep sink applied every frame while dead (position set above uses current sink).
    // Still allow emotes (arena taunts after wipe).
    if (dead) {
      g.position.set(p.x, smashHopOffsetY(me) + deathSinkOffsetY(deathSinkRef.current), p.z);
      velocity.current.set(0, 0, 0);
      prevPos.current.set(p.x, 0, p.z);
      yawLocked.current = true;
      resetFootsteps();
      const activeEmoteId = localSessionId ? getActiveEmote(localSessionId) : null;
      if (activeEmoteId) {
        if (lastEmoteId.current !== activeEmoteId) {
          lastEmoteId.current = activeEmoteId;
          playEmoteAnimation(controller, activeEmoteId);
        }
      } else if (lastEmoteId.current) {
        lastEmoteId.current = null;
      }
      controller.setMovement({
        worldVelocity: velocity.current,
        facingYaw: visualYaw.current,
        maximumSpeed: MOVE_SPEED,
      });
      controller.update(safeDt);
      body.rotation.y = visualYaw.current;
      return;
    }

    velocity.current.set(
      (p.x - prevPos.current.x) / safeDt,
      0,
      (p.z - prevPos.current.z) / safeDt,
    );
    prevPos.current.set(p.x, 0, p.z);

    const cloaked = hasStatusId(me?.statuses, "cloaked");
    const revengePhased = hasStatusId(me?.statuses, "revengePhased");
    const revengeVanished =
      revengePhased || isRevengeVanished(localSessionId);
    const spiritFormed = hasStatusId(me?.statuses, "spiritFormed");
    const ghosted = cloaked || revengeVanished;
    const castingDecoy = me?.castAbilityId === "decoy";
    const speed = Math.hypot(velocity.current.x, velocity.current.z);
    const hopY = smashHopOffsetY(me);
    tickFootsteps(speed, safeDt, { muted: ghosted || spiritFormed || hopY > 0.08 });
    const movingCloak = cloaked && !castingDecoy && speed > CLOAK_MOVE_SPEED_EPS;

    syncPlayerCast(controller, room, localSessionId, lastCastId, comboAnimHoldUntil);

    // Full-body emote pie wheel — independent of the ability cast schema fields.
    const activeEmoteId = localSessionId ? getActiveEmote(localSessionId) : null;
    if (activeEmoteId) {
      if (lastEmoteId.current !== activeEmoteId) {
        lastEmoteId.current = activeEmoteId;
        playEmoteAnimation(controller, activeEmoteId);
      }
    } else if (lastEmoteId.current) {
      lastEmoteId.current = null;
      controller.cancelFullBodyAction();
    }

    // Jump Attack / Portal / Blood Rush charge keep mouse aim; dash still locks for the dive.
    const fullBodyName = controller.getState().activeFullBodyName;
    const jumpAim =
      fullBodyName === "jumpAttack" ||
      fullBodyName === "Jump Attack" ||
      me?.castAbilityId === "smash";
    const portalAim =
      me?.castAbilityId === "portal" ||
      fullBodyName === "castPraying" ||
      fullBodyName === "praying";
    /** Crouch charge tracks cursor; sprint impact locks facing to the dash. */
    const bloodRushAim =
      me?.castAbilityId === "bloodRush" &&
      (me?.castPhase === "anticipation" || me?.castPhase === "cast");
    /** Slow-turn while Hand Shield is armed (body + disc follow capped yaw). */
    const handShieldAim = hasStatusId(me?.statuses, "handShielding");
    const crouchWalkActive = cloaked && !castingDecoy;
    const grooveActive =
      me?.castAbilityId === "groove" ||
      fullBodyName === "jazzDance" ||
      fullBodyName === "Jazz Dancing";
    /** Emote wheel dances: full-body plays, but facing still follows the cursor. */
    const emoteAim = Boolean(activeEmoteId);
    /** Body faces travel; head tracks cursor (cloak + Groove channel). */
    const moveBodyAim = crouchWalkActive || grooveActive;
    const movingForBody = moveBodyAim && speed > CLOAK_MOVE_SPEED_EPS;

    yawLocked.current =
      (controller.getState().fullBody === "override" &&
        !jumpAim &&
        !portalAim &&
        !bloodRushAim &&
        !handShieldAim &&
        !crouchWalkActive &&
        !grooveActive &&
        !emoteAim) ||
      false;

    if (jumpAim || portalAim || bloodRushAim || handShieldAim || emoteAim) {
      visualYaw.current = p.yaw;
    } else if (moveBodyAim) {
      // Cloak / Groove: body faces travel; head tracks cursor separately.
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
      // Mixamo 5-way loco is authored for aim-forward. Root must face aim or
      // strafe/back clips read as "run toward WASD" when the mesh faces move.
      visualYaw.current = p.yaw;
    }

    body.rotation.y = visualYaw.current;
    // Aim ring is a sibling of body under an unrotated root — use world aim yaw.
    if (aim) aim.rotation.y = p.yaw;

    // Fully hide mesh, ornaments, and aim during Revenge blink — no pre-appear flash.
    if (bodyRef.current) bodyRef.current.visible = !revengeVanished;
    if (aimRef.current) aimRef.current.visible = !revengeVanished;

    const ghostOpacity = revengeVanished ? 0 : cloaked ? 0.32 : 1;
    if (ghostOpacity !== ghostOpacityRef.current) {
      ghostOpacityRef.current = ghostOpacity;
      setCharacterOpacity(scene, ghostOpacity);
      setCloakOpacity(ghostOpacity);
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
    const speedMul = hasStatusId(me?.statuses, "surged")
      ? 1.6
      : spiritFormed
        ? 1.35
        : 1;
    controller.setMovement({
      worldVelocity: velocity.current,
      facingYaw: p.yaw,
      aimYaw: p.yaw,
      bodyYaw: visualYaw.current,
      maximumSpeed: MOVE_SPEED * speedMul,
      baseMoveSpeed: MOVE_SPEED,
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
        <EquippedCosmetics characterRoot={scene} equipped={equipped} opacity={cloakOpacity} />
        <StatusOrnaments
          characterRoot={scene}
          getStatuses={() => {
            if (!room || !localSessionId) return [];
            const me = room.state?.players?.get(localSessionId) as
              | { statuses?: Parameters<typeof collectStatusRows>[0] }
              | undefined;
            if (
              hasStatusId(me?.statuses, "cloaked") ||
              hasStatusId(me?.statuses, "revengePhased")
            ) {
              return [];
            }
            return collectStatusRows(me?.statuses);
          }}
        />
        {room && localSessionId ? (
          <>
            <PortalChannelAura room={room} sessionId={localSessionId} />
            <BloodRushChargeAura room={room} sessionId={localSessionId} />
          </>
        ) : null}
      </group>
      <group ref={aimRef}>
        <AimIndicator color={AIM_RELATION_COLORS.self} />
        <AbilityHoverTelegraph />
      </group>
      <PlayerHpBillboard room={room} sessionId={localSessionId} />
      <PlayerCastChannelBar room={room} sessionId={localSessionId} />
      {room && localSessionId ? (
        <RiftArmRing room={room} sessionId={localSessionId} />
      ) : null}
      <InteractPromptBillboard />
    </group>
  );
}
