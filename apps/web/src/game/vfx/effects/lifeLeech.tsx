import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { coneRayMaxLength } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { smooth01 } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { getWorldProjectileCircles, getWorldProjectileWalls, getWorldProjectileBoxes } from "../../worldCollidersRuntime";

const DAMAGE_HOT = "#f87171";
const HEAL_HOT = "#4ade80";
const HAND_Y = 1.15;
const SPAWN = 0.45;

const OUT_MOTES = 72;
const IN_MOTES = 72;

type OccludeBody = {
  id: string;
  x: number;
  z: number;
  hp?: number;
};

type Mote = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
};

function collectOccludeBodies(
  follow: VfxFollowContext | undefined,
  ownerId: string | undefined,
): OccludeBody[] {
  const room = follow?.room;
  if (!room?.state) return [];
  const out: OccludeBody[] = [];
  const players = room.state.players as
    | Map<string, { x?: number; z?: number; hp?: number; team?: string }>
    | undefined;
  const ownerTeam =
    ownerId && players
      ? (players.get(ownerId) as { team?: string } | undefined)?.team
      : undefined;
  players?.forEach((p, id) => {
    if (ownerId && id === ownerId) return;
    // Allies soft-stop the ray for length, but must not trigger green "leeching" return.
    // Keep them out of the hit list used for green motes.
    if (ownerTeam && p.team && p.team === ownerTeam) return;
    out.push({ id, x: p.x ?? 0, z: p.z ?? 0, hp: p.hp });
  });
  const targets = room.state.targets as
    | Map<string, { x?: number; z?: number; hp?: number }>
    | undefined;
  targets?.forEach((t, id) => {
    out.push({ id, x: t.x ?? 0, z: t.z ?? 0, hp: t.hp });
  });
  return out;
}

function createMotePool(n: number): Mote[] {
  return Array.from({ length: n }, () => ({
    alive: false,
    age: 0,
    life: 1,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0.08,
  }));
}

/** Red damage fluid — emit along the channel volume, streaming outward. */
function spawnOutMote(p: Mote, beamLen: number) {
  p.alive = true;
  p.age = 0;
  p.life = 0.28 + Math.random() * 0.38;
  const along = SPAWN + Math.random() * Math.max(0.2, beamLen - SPAWN) * 0.55;
  const radial = (Math.random() - 0.5) * 0.22;
  p.x = radial;
  p.y = HAND_Y + (Math.random() - 0.5) * 0.28;
  p.z = along;
  p.vx = (Math.random() - 0.5) * 0.45;
  p.vy = (Math.random() - 0.5) * 0.55;
  p.vz = 2.4 + Math.random() * 3.2;
  p.size = 0.05 + Math.random() * 0.07;
}

/** Green heal fluid — spawn near the tip, stream back toward the caster. */
function spawnInMote(p: Mote, beamLen: number) {
  p.alive = true;
  p.age = 0;
  p.life = 0.28 + Math.random() * 0.38;
  const tip = Math.max(SPAWN + 0.5, beamLen);
  const along = tip - Math.random() * Math.max(0.3, (tip - SPAWN) * 0.55);
  const radial = (Math.random() - 0.5) * 0.22;
  p.x = radial;
  p.y = HAND_Y + (Math.random() - 0.5) * 0.28;
  p.z = along;
  p.vx = (Math.random() - 0.5) * 0.45;
  p.vy = (Math.random() - 0.5) * 0.55;
  p.vz = -(2.2 + Math.random() * 3.0);
  p.size = 0.05 + Math.random() * 0.07;
}

function makeParticleBuffers(count: number) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
  return { positions, sizes, alphas, geo };
}

/**
 * Life Leech — particle-only two-way fluid stream (no solid laser core).
 * Red flows out along the aim line; green returns only while a target is hit.
 */
export function LifeLeechEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const outPts = useRef<THREE.Points>(null);
  const inPts = useRef<THREE.Points>(null);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
  const liveLen = useRef(shot.radius ?? 7.5);
  const done = useRef(false);
  const lifeMs = useRef(Math.max(200, shot.life));
  const spawnAcc = useRef(0);
  const outPool = useRef(createMotePool(OUT_MOTES));
  const inPool = useRef(createMotePool(IN_MOTES));

  const endLength = shot.radius ?? 7.5;

  const outBuf = useMemo(() => makeParticleBuffers(OUT_MOTES), []);
  const inBuf = useMemo(() => makeParticleBuffers(IN_MOTES), []);

  const outMat = useMemo(() => createCirclePointMaterial(DAMAGE_HOT), []);
  const inMat = useMemo(() => createCirclePointMaterial(HEAL_HOT), []);

  useEffect(() => {
    return () => {
      outBuf.geo.dispose();
      inBuf.geo.dispose();
      outMat.dispose();
      inMat.dispose();
    };
  }, [outBuf, inBuf, outMat, inMat]);

  useFrame((_, dt) => {
    if (done.current) return;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    const ageMs = performance.now() - shot.born;
    const life = lifeMs.current;
    if (ageMs >= life) {
      done.current = true;
      if (root.current) root.current.visible = false;
      shot.life = Math.min(shot.life, ageMs);
      return;
    }

    // Absolute ms envelope — percentage softEnvelope breaks on long hold lifetimes
    // (first frame fade≈0 would kill the shot immediately).
    const fadeIn = smooth01(ageMs / 120);
    const fadeOut = ageMs > life - 280 ? smooth01((life - ageMs) / 280) : 1;
    const fade = fadeIn * fadeOut;
    if (fade <= 0.01 && ageMs > 160) {
      done.current = true;
      if (root.current) root.current.visible = false;
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
    /** Green return only while a living body soft-stops the aim ray (not walls / empty air). */
    const hittingTarget = maxLen < wallLen - 0.08;
    const grow = smooth01(Math.min(1, ageMs / Math.max(80, shot.growMs ?? 140)));
    liveLen.current = THREE.MathUtils.lerp(SPAWN, Math.max(SPAWN, maxLen), grow);

    if (root.current) {
      root.current.visible = true;
      root.current.position.set(pose.current.x, 0, pose.current.z);
      root.current.rotation.y = pose.current.yaw;
    }

    const len = liveLen.current;

    if (fade > 0.12) {
      spawnAcc.current += safeDt;
      const emitEvery = 0.014;
      while (spawnAcc.current >= emitEvery) {
        spawnAcc.current -= emitEvery;
        const out = outPool.current.find((m) => !m.alive);
        if (out) spawnOutMote(out, len);
        if (hittingTarget) {
          const inn = inPool.current.find((m) => !m.alive);
          if (inn) spawnInMote(inn, len);
        }
        if (Math.random() < 0.65) {
          const extraOut = outPool.current.find((m) => !m.alive);
          if (extraOut) spawnOutMote(extraOut, len);
        }
        if (hittingTarget && Math.random() < 0.65) {
          const extraIn = inPool.current.find((m) => !m.alive);
          if (extraIn) spawnInMote(extraIn, len);
        }
      }
    }

    const stepPool = (
      pool: Mote[],
      buf: ReturnType<typeof makeParticleBuffers>,
      pts: RefObject<THREE.Points | null>,
    ) => {
      let living = 0;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]!;
        if (!p.alive) {
          buf.positions[i * 3 + 1] = -999;
          buf.sizes[i] = 0;
          buf.alphas[i] = 0;
          continue;
        }
        p.age += safeDt;
        if (p.age >= p.life) {
          p.alive = false;
          buf.positions[i * 3 + 1] = -999;
          buf.sizes[i] = 0;
          buf.alphas[i] = 0;
          continue;
        }
        const u = p.age / p.life;
        p.x += p.vx * safeDt;
        p.y += p.vy * safeDt;
        p.z += p.vz * safeDt;
        if (p.z > len + 0.2 || p.z < SPAWN - 0.15) {
          p.alive = false;
          buf.positions[i * 3 + 1] = -999;
          buf.sizes[i] = 0;
          buf.alphas[i] = 0;
          continue;
        }
        buf.positions[i * 3] = p.x;
        buf.positions[i * 3 + 1] = p.y;
        buf.positions[i * 3 + 2] = p.z;
        const appear = THREE.MathUtils.smoothstep(u, 0, 0.1);
        const out = (1 - u) * (1 - u);
        buf.sizes[i] = p.size * appear * (30 + 8 * fade);
        buf.alphas[i] = appear * out * fade * 0.98;
        living++;
      }
      buf.geo.attributes.position!.needsUpdate = true;
      buf.geo.attributes.aSize!.needsUpdate = true;
      buf.geo.attributes.aAlpha!.needsUpdate = true;
      if (pts.current) pts.current.visible = living > 0;
    };

    stepPool(outPool.current, outBuf, outPts);
    stepPool(inPool.current, inBuf, inPts);
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
      <points ref={outPts} geometry={outBuf.geo} material={outMat} frustumCulled={false} />
      <points ref={inPts} geometry={inBuf.geo} material={inMat} frustumCulled={false} />
    </group>
  );
}
