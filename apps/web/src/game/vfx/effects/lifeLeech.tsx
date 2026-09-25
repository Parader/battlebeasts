import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { coneRayMaxLength } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { resolveHandPose, type HandPose } from "../handPose";
import {
  collectOccludeBodies,
  findConeHitBody,
  resolveImpactPoint,
  type BodyPoint,
} from "../spellTargeting";
import { smooth01 } from "../easing";
import { ATLAS_UV } from "../engine/atlas";
import {
  BatchId,
  Collide,
  LodRank,
  killEmitter,
  setEmitterHoming,
  setEmitterPose,
  setEmitterRate,
  spawnEmitter,
} from "../engine";
import { useSpellLight } from "../spellLights";
import { getWorldProjectileBoxes, getWorldProjectileCircles, getWorldProjectileWalls } from "../../worldCollidersRuntime";
import { playDrainLifeLoopSfx, stopDrainLifeLoopSfx } from "../../gameSfx";

const HAND_Y = 1.15;
const SPAWN = 0.45;
const TARGET_Y = 1.15;

const BLOOD_HOT = "#fecaca";
const BLOOD_MID = "#ef4444";
const BLOOD_DEEP = "#7f1d1d";

const HAND_LIGHT_INTENSITY = 1.35;
const HAND_LIGHT_DIST = 3.2;

const CASTER_SHELL_RATE = 36;
const CASTER_RIM_RATE = 18;
const BLOOD_HAND_RATE = 44;
const BLOOD_MID_RATE = 34;
const BLOOD_FAR_RATE = 28;
const SPILL_SHEET_RATE = 34;
const SPILL_RUN_RATE = 22;
const HEAL_STREAM_RATE = 24;

const BLOOD_SPEED = 4.6;
const HEAL_SPEED = 4.2;
/** Steer living leaves at the moving hand (units/sec²-ish pull). */
const HEAL_HOME_STRENGTH = 16;
/** Absorb on the hand. Misses fade out past the caster instead of looping back. */
const HEAL_HOME_KILL = 0.42;

function bloodSpark(extra: Parameters<typeof spawnEmitter>[0]) {
  return spawnEmitter({
    groundY: 0,
    collide: Collide.None,
    batch: BatchId.AdditiveSpark,
    atlasUv: ATLAS_UV.spark,
    color0: BLOOD_HOT,
    color1: BLOOD_MID,
    color2: BLOOD_DEEP,
    rotRate: 0.35,
    rotJitter: 0.4,
    ...extra,
  });
}

function healLeaf(extra: Parameters<typeof spawnEmitter>[0]) {
  return spawnEmitter({
    groundY: 0,
    collide: Collide.None,
    batch: BatchId.AdditiveSpark,
    atlasUv: ATLAS_UV.leaf,
    color0: "#ecfccb",
    color1: "#86efac",
    color2: "#16a34a",
    size: 0.3,
    sizeEnd: 0.08,
    opacity: 0.9,
    rotRate: 1.8,
    rotJitter: 1,
    ...extra,
  });
}

/**
 * Life Leech — red hand light, blood stream + spill, leaves home to the casting hand.
 */
export function LifeLeechEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
  const liveLen = useRef(shot.radius ?? 7.5);
  const done = useRef(false);
  const lifeMs = useRef(Math.max(200, shot.life));
  const hand = useRef<HandPose>({ x: shot.x, y: HAND_Y, z: shot.z });
  const impact = useRef<BodyPoint>({ x: shot.x, y: TARGET_Y, z: shot.z });
  const light = useSpellLight();

  const casterShellId = useRef(-1);
  const casterRimId = useRef(-1);
  const bloodHandId = useRef(-1);
  const bloodMidId = useRef(-1);
  const bloodFarId = useRef(-1);
  const spillSheetId = useRef(-1);
  const spillRunId = useRef(-1);
  const healStreamId = useRef(-1);

  const endLength = shot.radius ?? 7.5;

  const silenceAll = () => {
    setEmitterRate(casterShellId.current, 0);
    setEmitterRate(casterRimId.current, 0);
    setEmitterRate(bloodHandId.current, 0);
    setEmitterRate(bloodMidId.current, 0);
    setEmitterRate(bloodFarId.current, 0);
    setEmitterRate(spillSheetId.current, 0);
    setEmitterRate(spillRunId.current, 0);
    setEmitterRate(healStreamId.current, 0);
    light.off();
  };

  useEffect(() => {
    const ownerId = shot.followOwnerId;
    if (ownerId) playDrainLifeLoopSfx(ownerId);

    casterShellId.current = bloodSpark({
      x: shot.x,
      y: HAND_Y,
      z: shot.z,
      dirX: 0,
      dirY: 0.2,
      dirZ: 0,
      rate: CASTER_SHELL_RATE,
      spread: 0.72,
      gravity: 0.55,
      drag: 0.55,
      noise: 0.45,
      size: 0.14,
      sizeEnd: 0.03,
      life: 0.38,
      lifeJitter: 0.2,
      opacity: 0.88,
      lod: LodRank.Core,
      burst: 10,
    });

    casterRimId.current = bloodSpark({
      x: shot.x,
      y: HAND_Y,
      z: shot.z,
      dirX: 0,
      dirY: -0.15,
      dirZ: 0,
      rate: CASTER_RIM_RATE,
      spread: 0.55,
      gravity: 1.4,
      drag: 0.35,
      noise: 0.3,
      size: 0.1,
      sizeEnd: 0.022,
      life: 0.42,
      lifeJitter: 0.22,
      opacity: 0.7,
      color0: "#f87171",
      color1: "#b91c1c",
      color2: "#450a0a",
      lod: LodRank.Trail,
      burst: 4,
    });

    bloodHandId.current = bloodSpark({
      x: shot.x,
      y: HAND_Y,
      z: shot.z,
      dirX: 0,
      dirY: -0.15,
      dirZ: BLOOD_SPEED,
      rate: BLOOD_HAND_RATE,
      spread: 0.09,
      gravity: 0.85,
      drag: 0.08,
      noise: 0.22,
      size: 0.12,
      sizeEnd: 0.028,
      life: 0.42,
      lifeJitter: 0.25,
      opacity: 0.92,
      lod: LodRank.Core,
      burst: 6,
    });

    bloodMidId.current = bloodSpark({
      x: shot.x,
      y: HAND_Y,
      z: shot.z,
      dirX: 0,
      dirY: -0.1,
      dirZ: BLOOD_SPEED,
      rate: BLOOD_MID_RATE,
      spread: 0.11,
      gravity: 1.0,
      drag: 0.1,
      noise: 0.28,
      size: 0.1,
      sizeEnd: 0.022,
      life: 0.4,
      lifeJitter: 0.3,
      opacity: 0.82,
      color0: "#fca5a5",
      color1: "#dc2626",
      color2: "#450a0a",
      lod: LodRank.Trail,
      burst: 4,
    });

    bloodFarId.current = bloodSpark({
      x: shot.x,
      y: HAND_Y,
      z: shot.z,
      dirX: 0,
      dirY: -0.08,
      dirZ: BLOOD_SPEED * 0.85,
      rate: BLOOD_FAR_RATE,
      spread: 0.12,
      gravity: 1.15,
      drag: 0.12,
      noise: 0.3,
      size: 0.09,
      sizeEnd: 0.02,
      life: 0.36,
      lifeJitter: 0.3,
      opacity: 0.75,
      color0: "#f87171",
      color1: "#b91c1c",
      color2: "#1a0505",
      lod: LodRank.Trail,
      burst: 3,
    });

    spillSheetId.current = bloodSpark({
      x: shot.x,
      y: TARGET_Y,
      z: shot.z,
      dirX: 0,
      dirY: -1.8,
      dirZ: 0,
      rate: 0,
      spread: 0.14,
      gravity: 6.2,
      drag: 0.04,
      noise: 0.08,
      size: 0.2,
      sizeEnd: 0.05,
      life: 0.85,
      lifeJitter: 0.2,
      opacity: 0.95,
      rotRate: 0.15,
      lod: LodRank.Core,
      burst: 0,
    });

    spillRunId.current = bloodSpark({
      x: shot.x,
      y: TARGET_Y,
      z: shot.z,
      dirX: 0,
      dirY: -2.8,
      dirZ: 0,
      rate: 0,
      spread: 0.22,
      gravity: 5.4,
      drag: 0.06,
      noise: 0.12,
      size: 0.12,
      sizeEnd: 0.025,
      life: 1.05,
      lifeJitter: 0.25,
      opacity: 0.82,
      color0: "#f87171",
      color1: "#b91c1c",
      color2: "#450a0a",
      rotRate: 0.1,
      lod: LodRank.Trail,
      burst: 0,
    });

    // Homing stream — living leaves steer toward the casting hand each sim tick.
    healStreamId.current = healLeaf({
      x: shot.x,
      y: HAND_Y,
      z: shot.z,
      dirX: 0,
      dirY: 0.15,
      dirZ: -HEAL_SPEED,
      rate: 0,
      spread: 0.12,
      gravity: 0.02,
      drag: 0.4,
      noise: 0.1,
      life: 2.4,
      lifeJitter: 0.12,
      lod: LodRank.Core,
      burst: 0,
      homeStrength: HEAL_HOME_STRENGTH,
      homeKillRadius: HEAL_HOME_KILL,
    });

    return () => {
      if (ownerId) stopDrainLifeLoopSfx(ownerId);
      const ids = [
        casterShellId,
        casterRimId,
        bloodHandId,
        bloodMidId,
        bloodFarId,
        spillSheetId,
        spillRunId,
        healStreamId,
      ];
      for (const ref of ids) {
        if (ref.current >= 0) killEmitter(ref.current);
        ref.current = -1;
      }
      light.off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shot.x/z are spawn seeds only
  }, [shot.followOwnerId, shot.key, light]);

  useFrame(() => {
    if (done.current) return;

    const ageMs = performance.now() - shot.born;
    const life = lifeMs.current;
    if (ageMs >= life) {
      done.current = true;
      silenceAll();
      if (shot.followOwnerId) stopDrainLifeLoopSfx(shot.followOwnerId);
      shot.life = Math.min(shot.life, ageMs);
      return;
    }

    const fadeIn = smooth01(ageMs / 120);
    const fadeOut = ageMs > life - 280 ? smooth01((life - ageMs) / 280) : 1;
    const fade = fadeIn * fadeOut;
    if (fade <= 0.01 && ageMs > 160) {
      done.current = true;
      silenceAll();
      if (shot.followOwnerId) stopDrainLifeLoopSfx(shot.followOwnerId);
      shot.life = Math.min(shot.life, ageMs);
      return;
    }

    if (shot.followOwnerId) {
      const local =
        follow?.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        pose.current.x = local.x;
        pose.current.z = local.z;
        pose.current.yaw = local.yaw;
      } else {
        const p = follow?.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          pose.current.x = p.x ?? pose.current.x;
          pose.current.z = p.z ?? pose.current.z;
          pose.current.yaw = p.yaw ?? pose.current.yaw;
        }
      }
    }

    const bodies = collectOccludeBodies(follow, shot.followOwnerId);
    const walls = getWorldProjectileWalls();
    const circles = getWorldProjectileCircles();
    const boxes = getWorldProjectileBoxes();
    const origin = { x: pose.current.x, z: pose.current.z };
    const wallLen = coneRayMaxLength(
      origin,
      pose.current.yaw,
      endLength,
      walls,
      [],
      shot.followOwnerId ?? "",
      { circles, boxes },
    );
    const maxLen = coneRayMaxLength(
      origin,
      pose.current.yaw,
      endLength,
      walls,
      bodies,
      shot.followOwnerId ?? "",
      { circles, boxes },
    );
    const hittingTarget = maxLen < wallLen - 0.08;
    const hitBody = hittingTarget
      ? findConeHitBody(origin, pose.current.yaw, maxLen, wallLen, bodies)
      : null;
    const grow = smooth01(Math.min(1, ageMs / Math.max(80, shot.growMs ?? 140)));
    liveLen.current = THREE.MathUtils.lerp(SPAWN, Math.max(SPAWN, maxLen), grow);

    const fx = Math.sin(pose.current.yaw);
    const fz = Math.cos(pose.current.yaw);

    const h = resolveHandPose(
      hand.current,
      shot.followOwnerId,
      pose.current.x,
      pose.current.z,
      fx,
      fz,
    );
    const hx = h.x;
    const hy = h.y;
    const hz = h.z;

    const len = liveLen.current;
    const midAlong = SPAWN + Math.max(0.35, (len - SPAWN) * 0.4);
    const farAlong = SPAWN + Math.max(0.55, (len - SPAWN) * 0.72);
    const tipAlong = Math.max(SPAWN + 0.4, len - 0.12);
    const mx = pose.current.x + fx * midAlong;
    const mz = pose.current.z + fz * midAlong;
    const farX = pose.current.x + fx * farAlong;
    const farZ = pose.current.z + fz * farAlong;
    const tipY = TARGET_Y;

    // Spill + leaf origin: inside the hit body (chest), not the ray tip in empty air.
    const body = resolveImpactPoint(
      impact.current,
      hitBody,
      pose.current.x + fx * tipAlong,
      tipY,
      pose.current.z + fz * tipAlong,
      fx,
      fz,
    );
    const bodyX = body.x;
    const bodyY = body.y;
    const bodyZ = body.z;

    const outDx = fx * BLOOD_SPEED;
    const outDz = fz * BLOOD_SPEED;

    const bloodScale = fade > 0.12 ? fade : 0;
    const hitScale = bloodScale > 0 && hittingTarget ? fade : 0;

    if (bloodScale > 0.05) {
      const pulse = 0.85 + Math.sin(ageMs * 0.014) * 0.15;
      light.emit(
        hx,
        hy,
        hz,
        BLOOD_MID,
        HAND_LIGHT_INTENSITY * bloodScale * pulse,
        HAND_LIGHT_DIST,
      );
    } else {
      light.off();
    }

    setEmitterPose(casterShellId.current, hx, hy, hz, 0, 0.2, 0);
    setEmitterPose(casterRimId.current, hx, hy - 0.02, hz, 0, -0.15, 0);

    setEmitterPose(bloodHandId.current, hx, hy, hz, outDx, -0.15, outDz);
    setEmitterPose(bloodMidId.current, mx, hy * 0.55 + tipY * 0.45, mz, outDx, -0.1, outDz);
    setEmitterPose(bloodFarId.current, farX, tipY + 0.02, farZ, outDx * 0.85, -0.08, outDz * 0.85);

    // Blood spill from inside the enemy torso
    setEmitterPose(spillSheetId.current, bodyX, bodyY, bodyZ, fx * 0.1, -1.8, fz * 0.1);
    setEmitterPose(spillRunId.current, bodyX, bodyY - 0.12, bodyZ, fx * 0.08, -2.8, fz * 0.08);

    // Leaves leave the enemy torso and home to the live casting hand.
    const toHandX = hx - bodyX;
    const toHandY = hy - bodyY;
    const toHandZ = hz - bodyZ;
    const toHandDist = Math.hypot(toHandX, toHandY, toHandZ) || 1;
    const spd = HEAL_SPEED;
    setEmitterPose(
      healStreamId.current,
      bodyX,
      bodyY,
      bodyZ,
      (toHandX / toHandDist) * spd,
      (toHandY / toHandDist) * spd,
      (toHandZ / toHandDist) * spd,
    );
    setEmitterHoming(
      healStreamId.current,
      hx,
      hy,
      hz,
      HEAL_HOME_STRENGTH,
      HEAL_HOME_KILL,
    );

    setEmitterRate(casterShellId.current, CASTER_SHELL_RATE * bloodScale);
    setEmitterRate(casterRimId.current, CASTER_RIM_RATE * bloodScale);
    setEmitterRate(bloodHandId.current, BLOOD_HAND_RATE * bloodScale);
    setEmitterRate(bloodMidId.current, BLOOD_MID_RATE * bloodScale);
    setEmitterRate(bloodFarId.current, BLOOD_FAR_RATE * bloodScale);
    setEmitterRate(spillSheetId.current, SPILL_SHEET_RATE * hitScale);
    setEmitterRate(spillRunId.current, SPILL_RUN_RATE * hitScale);
    setEmitterRate(healStreamId.current, HEAL_STREAM_RATE * hitScale);
  });

  return null;
}
