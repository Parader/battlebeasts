import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  MAGMA_ORBS_CAST,
  magmaOrbsMaxFlightTs,
  type WallCollider,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { getWorldStaticColliders } from "../../worldCollidersRuntime";
import {
  BOULDER_TARGET_SIZE,
  VOLCANO_GLB_URL,
  instantiateBoulder,
} from "../volcanoAsset";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { VolcanoBoulderImpactFx, OrbAirShatterFx } from "./volcanoRock";

const ORB_SIZE = BOULDER_TARGET_SIZE * 0.85;
const PEAK_Y = 2.35;
const LAUNCH_Y = 2.2;
const COLLIDE_Y = 0.85;
/** Small earth scar under each orb as it erupts. */
const EMERGE_SCAR_R = ORB_SIZE * 1.05;
const EMERGE_SCAR_LIFE_MS = 1100;

const emergeSec =
  MAGMA_ORBS_CAST.emergeFrame / MAGMA_ORBS_CAST.fps / MAGMA_ORBS_CAST.playbackRate;
const launchSec =
  MAGMA_ORBS_CAST.launchFrame / MAGMA_ORBS_CAST.fps / MAGMA_ORBS_CAST.playbackRate;
const explodeSec =
  MAGMA_ORBS_CAST.explodeFrame / MAGMA_ORBS_CAST.fps / MAGMA_ORBS_CAST.playbackRate;

type OrbSide = -1 | 1;
type Vec3 = { x: number; y: number; z: number };

function ownerPose(
  follow: VfxFollowContext,
  ownerId: string | undefined,
  fallback: { x: number; z: number; yaw: number },
): { x: number; z: number; yaw: number } {
  if (!ownerId) return fallback;
  const local =
    follow.localSessionId &&
    ownerId === follow.localSessionId &&
    follow.predictedRef
      ? follow.predictedRef.current
      : null;
  if (local) return { x: local.x, z: local.z, yaw: local.yaw };
  const p = follow.room?.state?.players?.get(ownerId) as
    | { x?: number; z?: number; yaw?: number }
    | undefined;
  if (!p) return fallback;
  return { x: p.x ?? fallback.x, z: p.z ?? fallback.z, yaw: p.yaw ?? fallback.yaw };
}

function basis(yaw: number) {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { fx, fz, rx: fz, rz: -fx };
}

function lateralPoint(
  x: number,
  z: number,
  yaw: number,
  ahead: number,
  side: OrbSide,
  lateral: number,
): { x: number; z: number } {
  const { fx, fz, rx, rz } = basis(yaw);
  return {
    x: x + fx * ahead + rx * lateral * side,
    z: z + fz * ahead + rz * lateral * side,
  };
}

function collidePoint(x: number, z: number, yaw: number, range: number): { x: number; z: number } {
  const { fx, fz } = basis(yaw);
  return { x: x + fx * range, z: z + fz * range };
}

function quadBezier(p0: Vec3, p1: Vec3, p2: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  };
}

function flightControl(from: Vec3, collide: Vec3, yaw: number, side: OrbSide): Vec3 {
  const { fx, fz, rx, rz } = basis(yaw);
  const bow = MAGMA_ORBS_CAST.arcBow;
  const midX = (from.x + collide.x) * 0.5;
  const midZ = (from.z + collide.z) * 0.5;
  return {
    x: midX + rx * side * bow + fx * 0.55,
    y: Math.max(from.y, COLLIDE_Y) + MAGMA_ORBS_CAST.flightArcY,
    z: midZ + rz * side * bow + fz * 0.55,
  };
}

function worldWalls(): WallCollider[] {
  return getWorldStaticColliders().filter((c): c is WallCollider => c.shape === "walls");
}

/**
 * Magma Orbs — twin volcano boulders rise, arc, collide, then volcano-style ground blast.
 * Each orb stops independently on walls; meet explode only if both arrive.
 */
export function MagmaOrbsCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const gltf = useGLTF(VOLCANO_GLB_URL);
  const root = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const launched = useRef(false);
  const finished = useRef(false);
  const launchFromL = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const launchFromR = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const controlL = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const controlR = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const collide = useRef({ x: 0, z: 0 });
  const leftMaxT = useRef(1);
  const rightMaxT = useRef(1);
  const leftDead = useRef(false);
  const rightDead = useRef(false);
  const emerged = useRef(false);
  const [emergeScars, setEmergeScars] = useState<
    { x: number; z: number; born: number }[] | null
  >(null);
  const [impact, setImpact] = useState<{
    x: number;
    z: number;
    born: number;
    radiusMul: number;
  } | null>(null);
  const [wallShatters, setWallShatters] = useState<
    { key: number; x: number; y: number; z: number; born: number; seed: number }[]
  >([]);

  const boulderL = useMemo(() => instantiateBoulder(gltf.scene, shot.key * 2), [gltf.scene, shot.key]);
  const boulderR = useMemo(
    () => instantiateBoulder(gltf.scene, shot.key * 2 + 1),
    [gltf.scene, shot.key],
  );

  useEffect(() => {
    if (boulderL) boulderL.scale.multiplyScalar(0.85);
    if (boulderR) boulderR.scale.multiplyScalar(0.85);
  }, [boulderL, boulderR]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = (performance.now() - shot.born) / 1000;
    const pose = ownerPose(follow, shot.followOwnerId, {
      x: shot.x,
      z: shot.z,
      yaw: shot.yaw,
    });

    if (age < emergeSec) {
      if (left.current) left.current.visible = false;
      if (right.current) right.current.visible = false;
      return;
    }

    // Rise (frame 24 → 60)
    if (age < launchSec) {
      const u = Math.max(0, Math.min(1, (age - emergeSec) / Math.max(1e-3, launchSec - emergeSec)));
      const ease = 1 - (1 - u) * (1 - u);
      const y = ORB_SIZE * 0.35 + ease * (PEAK_Y - ORB_SIZE * 0.35);
      const lat = MAGMA_ORBS_CAST.lateral * (0.85 + ease * 0.35);
      const pl = lateralPoint(
        pose.x,
        pose.z,
        pose.yaw,
        MAGMA_ORBS_CAST.emergeAhead,
        -1,
        lat,
      );
      const pr = lateralPoint(
        pose.x,
        pose.z,
        pose.yaw,
        MAGMA_ORBS_CAST.emergeAhead,
        1,
        lat,
      );
      if (!emerged.current) {
        emerged.current = true;
        // Lock scars at the first erupt pose (start lateral), not mid-rise drift.
        const scarLat = MAGMA_ORBS_CAST.lateral * 0.85;
        const sl = lateralPoint(
          pose.x,
          pose.z,
          pose.yaw,
          MAGMA_ORBS_CAST.emergeAhead,
          -1,
          scarLat,
        );
        const sr = lateralPoint(
          pose.x,
          pose.z,
          pose.yaw,
          MAGMA_ORBS_CAST.emergeAhead,
          1,
          scarLat,
        );
        const born = performance.now();
        setEmergeScars([
          { x: sl.x, z: sl.z, born },
          { x: sr.x, z: sr.z, born },
        ]);
      }
      if (left.current) {
        left.current.visible = true;
        left.current.position.set(pl.x, y, pl.z);
        left.current.rotation.set(u * 1.2, u * 2.1, u * 0.8);
      }
      if (right.current) {
        right.current.visible = true;
        right.current.position.set(pr.x, y, pr.z);
        right.current.rotation.set(u * 1.4, -u * 1.9, -u * 0.7);
      }
      return;
    }

    if (!launched.current) {
      launched.current = true;
      const lat = MAGMA_ORBS_CAST.lateral * 1.2;
      const pl = lateralPoint(
        pose.x,
        pose.z,
        pose.yaw,
        MAGMA_ORBS_CAST.emergeAhead,
        -1,
        lat,
      );
      const pr = lateralPoint(
        pose.x,
        pose.z,
        pose.yaw,
        MAGMA_ORBS_CAST.emergeAhead,
        1,
        lat,
      );
      const hit = collidePoint(pose.x, pose.z, pose.yaw, MAGMA_ORBS_CAST.meetRange);
      collide.current = hit;
      launchFromL.current = { x: pl.x, y: LAUNCH_Y, z: pl.z };
      launchFromR.current = { x: pr.x, y: LAUNCH_Y, z: pr.z };
      const end = { x: hit.x, y: COLLIDE_Y, z: hit.z };
      controlL.current = flightControl(launchFromL.current, end, pose.yaw, -1);
      controlR.current = flightControl(launchFromR.current, end, pose.yaw, 1);
      const maxT = magmaOrbsMaxFlightTs(
        {
          left0: { x: pl.x, z: pl.z },
          right0: { x: pr.x, z: pr.z },
          ctrlL: { x: controlL.current.x, z: controlL.current.z },
          ctrlR: { x: controlR.current.x, z: controlR.current.z },
          collide: hit,
        },
        worldWalls(),
        MAGMA_ORBS_CAST.flightHitRadius,
      );
      leftMaxT.current = maxT.left;
      rightMaxT.current = maxT.right;
    }

    const flightDur = Math.max(1e-3, explodeSec - launchSec);
    const fu = Math.max(0, Math.min(1, (age - launchSec) / flightDur));
    // Ease-in — slow leave loft, accelerate into the crash.
    const t = fu * fu * fu;

    if (!finished.current && fu < 1) {
      const end = { x: collide.current.x, y: COLLIDE_Y, z: collide.current.z };
      const leftAlive = t <= leftMaxT.current + 1e-4;
      const rightAlive = t <= rightMaxT.current + 1e-4;
      if (left.current) {
        if (leftAlive) {
          const lp = quadBezier(launchFromL.current, controlL.current, end, t);
          left.current.visible = true;
          left.current.position.set(lp.x, lp.y, lp.z);
          left.current.rotation.x += dt * 7;
          left.current.rotation.y += dt * 5.5;
        } else if (!leftDead.current) {
          leftDead.current = true;
          left.current.visible = false;
          const dieT = Math.min(t, leftMaxT.current);
          const lp = quadBezier(launchFromL.current, controlL.current, end, dieT);
          const born = performance.now();
          setWallShatters((prev) => [
            ...prev,
            { key: shot.key * 2, x: lp.x, y: lp.y, z: lp.z, born, seed: shot.key * 2 },
          ]);
        } else {
          left.current.visible = false;
        }
      }
      if (right.current) {
        if (rightAlive) {
          const rp = quadBezier(launchFromR.current, controlR.current, end, t);
          right.current.visible = true;
          right.current.position.set(rp.x, rp.y, rp.z);
          right.current.rotation.x += dt * 6.5;
          right.current.rotation.y -= dt * 6;
        } else if (!rightDead.current) {
          rightDead.current = true;
          right.current.visible = false;
          const dieT = Math.min(t, rightMaxT.current);
          const rp = quadBezier(launchFromR.current, controlR.current, end, dieT);
          const born = performance.now();
          setWallShatters((prev) => [
            ...prev,
            {
              key: shot.key * 2 + 1,
              x: rp.x,
              y: rp.y,
              z: rp.z,
              born,
              seed: shot.key * 2 + 1,
            },
          ]);
        } else {
          right.current.visible = false;
        }
      }
      return;
    }

    if (!finished.current) {
      finished.current = true;
      if (left.current) left.current.visible = false;
      if (right.current) right.current.visible = false;
      const leftArrives = leftMaxT.current >= 1 - 1e-4;
      const rightArrives = rightMaxT.current >= 1 - 1e-4;
      const arriveCount = (leftArrives ? 1 : 0) + (rightArrives ? 1 : 0);
      if (arriveCount > 0) {
        setImpact({
          x: collide.current.x,
          z: collide.current.z,
          born: performance.now(),
          radiusMul: arriveCount === 2 ? 1 : 0.5,
        });
      }
    }
  });

  return (
    <group ref={root}>
      {emergeScars?.map((scar, i) => (
        <GroundDecal
          key={`emerge-${i}`}
          preset={groundPresets.earthSlam}
          shape="circle"
          x={scar.x}
          z={scar.z}
          y={0.03}
          born={scar.born}
          life={EMERGE_SCAR_LIFE_MS}
          radius={EMERGE_SCAR_R}
        />
      ))}
      <group ref={left} visible={false}>
        {boulderL && <primitive object={boulderL} />}
      </group>
      <group ref={right} visible={false}>
        {boulderR && <primitive object={boulderR} />}
      </group>
      {wallShatters.map((s) => (
        <OrbAirShatterFx
          key={s.key}
          x={s.x}
          y={s.y}
          z={s.z}
          born={s.born}
          seed={s.seed}
        />
      ))}
      {impact ? (
        <VolcanoBoulderImpactFx
          x={impact.x}
          z={impact.z}
          born={impact.born}
          radius={MAGMA_ORBS_CAST.blastRadius * MAGMA_ORBS_CAST.blastVfxMul * impact.radiusMul}
          seed={shot.key}
          lifeMs={impact.radiusMul < 1 ? 850 : 1100}
        />
      ) : null}
    </group>
  );
}
