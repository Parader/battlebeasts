import { useEffect, useRef } from "react";
import { CONE_OCCLUSION_SECTORS, coneRayMaxLength } from "@battlebeasts/shared";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  getWorldProjectileBoxes,
  getWorldProjectileCircles,
  getWorldProjectileWalls,
} from "../../worldCollidersRuntime";
import type { VfxFollowContext } from "../catalog";
import { GroundDecal } from "../components/GroundDecal";
import { softEnvelope } from "../easing";
import { type ElementHandle, spawnElementRole } from "../engine";
import { groundPresets } from "../presets/ground";
import type { OneShotEffect } from "../types";

const HALF_ANGLE_START = 0.28;
const HALF_ANGLE_END = 0.7;
/** Keep mist above painted ground without scene-wide mesh raycasts. */
const DECAL_Y = 0.09;
const OCCLUDE_GROW_MS = 50;
const OCCLUDE_HOLD_MS = 100;

type OccludeBody = {
  id: string;
  x: number;
  z: number;
  hp?: number;
  vulnerable?: boolean;
};

function grow01(t: number): number {
  return THREE.MathUtils.clamp(t, 0, 1);
}

function collectOccludeBodies(
  follow: VfxFollowContext | undefined,
  ownerId: string | undefined,
  into: OccludeBody[],
): void {
  into.length = 0;
  const room = follow?.room;
  if (!room?.state) return;
  const players = room.state.players as
    Map<string, { x?: number; z?: number; hp?: number }> | undefined;
  players?.forEach((p, id) => {
    if (ownerId && id === ownerId) return;
    into.push({ id, x: p.x ?? 0, z: p.z ?? 0, hp: p.hp });
  });
  const targets = room.state.targets as
    Map<string, { x?: number; z?: number; hp?: number }> | undefined;
  targets?.forEach((t, id) => {
    into.push({ id, x: t.x ?? 0, z: t.z ?? 0, hp: t.hp });
  });
}

function updateSectorRanges(
  ranges: Float32Array,
  origin: { x: number; z: number },
  yaw: number,
  length: number,
  half: number,
  endLength: number,
  bodies: OccludeBody[],
  ownerId: string | undefined,
): void {
  const walls = getWorldProjectileWalls();
  const circles = getWorldProjectileCircles();
  const boxes = getWorldProjectileBoxes();
  const invEnd = endLength > 1e-4 ? 1 / endLength : 0;
  const span = Math.max(1e-4, 2 * half);
  for (let s = 0; s < CONE_OCCLUSION_SECTORS; s++) {
    const u = (s + 0.5) / CONE_OCCLUSION_SECTORS;
    const a = -half + u * span;
    const maxLen = coneRayMaxLength(origin, yaw + a, length, walls, bodies, ownerId ?? null, {
      circles,
      boxes,
    });
    ranges[s] = Math.max(0, Math.min(1, maxLen * invEnd));
  }
}

/**
 * Caster blow: the frost emitter starts at the cone origin.
 * Travel: persistent authored mist follows the caster-facing cone.
 * Impact: none; this is a sustained area sweep.
 * Ground: the existing clipped cone decal remains.
 * Particles: ParticleWorld frost ground role replaces mesh streaks.
 * Light: none; the decal and mist carry the read.
 */
export function FrostMistConeEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const mist = useRef<ElementHandle | null>(null);
  const progress = useRef(0);
  const opacity = useRef(0.95);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: 0 });
  const occlusionOrigin = useRef({ x: shot.x, z: shot.z });
  const liveLength = useRef(shot.startRadius ?? shot.radius ?? 3);
  const liveHalf = useRef(HALF_ANGLE_START);
  const sectorRanges = useRef<Float32Array>(new Float32Array(CONE_OCCLUSION_SECTORS).fill(1));
  const halfAngleLive = useRef(HALF_ANGLE_START);
  const lastOccludeAt = useRef(0);
  const occludeBodies = useRef<OccludeBody[]>([]);

  const endLength = shot.radius ?? 11;
  const startLength = shot.startRadius ?? Math.min(endLength, endLength * 0.28);
  const growMs = Math.max(80, shot.growMs ?? 180);

  useEffect(
    () => () => {
      mist.current?.kill();
      mist.current = null;
    },
    [],
  );

  useFrame(() => {
    const now = performance.now();
    const age = (now - shot.born) / shot.life;
    const g = root.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      mist.current?.setRateScale(0);
      return;
    }
    g.visible = true;

    if (follow?.room && shot.followOwnerId) {
      const local = shot.followOwnerId === follow.localSessionId;
      if (local && follow.predictedRef) {
        pose.current.x = follow.predictedRef.current.x;
        pose.current.z = follow.predictedRef.current.z;
        pose.current.yaw = follow.predictedRef.current.yaw;
      } else {
        const p = follow.room.state?.players?.get(shot.followOwnerId) as
          { x?: number; z?: number; yaw?: number } | undefined;
        if (p) {
          pose.current.x = p.x ?? pose.current.x;
          pose.current.z = p.z ?? pose.current.z;
          pose.current.yaw = p.yaw ?? pose.current.yaw;
        }
      }
    }

    g.position.set(pose.current.x, 0, pose.current.z);
    g.rotation.y = pose.current.yaw;

    const growT = grow01((now - shot.born) / growMs);
    liveLength.current = startLength + (endLength - startLength) * growT;
    liveHalf.current = HALF_ANGLE_START + (HALF_ANGLE_END - HALF_ANGLE_START) * growT;
    progress.current = Math.max(0.02, growT);

    const amp = softEnvelope(age, 0.02, 0.72);
    opacity.current = 0.65 + amp * 0.35;
    const stormAmp = amp * (0.3 + growT * 0.7);
    if (!mist.current) {
      mist.current = spawnElementRole("frost", "ground", pose.current.x, DECAL_Y, pose.current.z);
    }
    mist.current.setPoseYaw(pose.current.x, DECAL_Y, pose.current.z, pose.current.yaw);
    mist.current.setRateScale(stormAmp);

    const length = liveLength.current;
    const half = liveHalf.current;
    halfAngleLive.current = half;
    const origin = occlusionOrigin.current;
    origin.x = pose.current.x;
    origin.z = pose.current.z;
    const ranges = sectorRanges.current;

    const occludeEvery = growT < 1 ? OCCLUDE_GROW_MS : OCCLUDE_HOLD_MS;
    if (now - lastOccludeAt.current >= occludeEvery) {
      lastOccludeAt.current = now;
      collectOccludeBodies(follow, shot.followOwnerId, occludeBodies.current);
      updateSectorRanges(
        ranges,
        origin,
        pose.current.yaw,
        length,
        half,
        endLength,
        occludeBodies.current,
        shot.followOwnerId,
      );
    }
  });

  const ice = groundPresets.iceFrost;

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
      <GroundDecal
        preset={{
          ...ice,
          shape: "cone",
          halfAngle: HALF_ANGLE_END,
          radius: endLength,
          opacity: 0.88,
          lifeMs: shot.life,
          additive: true,
          appearEnd: 0.02,
          fadeStart: 0.78,
          spin: 0,
        }}
        shape="cone"
        yaw={0}
        radius={endLength}
        born={shot.born}
        life={shot.life}
        progressRef={progress}
        opacityMulRef={opacity}
        sectorRangesRef={sectorRanges}
        halfAngleRef={halfAngleLive}
        growExpand
        y={DECAL_Y}
      />
    </group>
  );
}
