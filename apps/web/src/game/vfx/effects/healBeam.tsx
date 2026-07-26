import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  baseCityStaticColliders,
  coneRayMaxLength,
  type WallCollider,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope, smooth01 } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";

const BEAM_COLOR = "#6ee7b7";
const BEAM_HOT = "#a7f3d0";
const HAND_Y = 1.15;
const SPAWN = 0.55;

/** Fixed pools — no alloc in the tick. */
const HAND_MOTES = 32;
const BEAM_MOTES = 48;
const TOTAL_MOTES = HAND_MOTES + BEAM_MOTES;

type OccludeBody = {
  id: string;
  x: number;
  z: number;
  hp?: number;
  vulnerable?: boolean;
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
  const players = room.state.players as Map<string, { x?: number; z?: number; hp?: number }> | undefined;
  players?.forEach((p, id) => {
    if (ownerId && id === ownerId) return;
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

function spawnHandMote(p: Mote) {
  p.alive = true;
  p.age = 0;
  p.life = 0.35 + Math.random() * 0.35;
  p.x = (Math.random() - 0.5) * 0.18;
  p.y = HAND_Y + (Math.random() - 0.5) * 0.16;
  p.z = SPAWN + (Math.random() - 0.5) * 0.12;
  const a = Math.random() * Math.PI * 2;
  const spd = 0.35 + Math.random() * 0.55;
  p.vx = Math.cos(a) * spd * 0.55;
  p.vy = 0.4 + Math.random() * 0.7;
  p.vz = Math.sin(a) * spd * 0.35 + 0.15;
  p.size = 0.06 + Math.random() * 0.07;
}

function spawnBeamMote(p: Mote, beamLen: number) {
  p.alive = true;
  p.age = 0;
  p.life = 0.4 + Math.random() * 0.45;
  const along = SPAWN + Math.random() * Math.max(0.2, beamLen - SPAWN);
  p.x = (Math.random() - 0.5) * 0.12;
  p.y = HAND_Y + (Math.random() - 0.5) * 0.14;
  p.z = along;
  p.vx = (Math.random() - 0.5) * 0.35;
  p.vy = (Math.random() - 0.5) * 0.4 + 0.15;
  p.vz = 0.8 + Math.random() * 1.4;
  p.size = 0.045 + Math.random() * 0.055;
}

/**
 * Heal Beam — narrow green line from the caster’s hands, follows aim, clips on walls.
 * Soft hand sparkles + motes streaming along the beam while channeling.
 */
export function HealBeamEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const points = useRef<THREE.Points>(null);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
  const liveLen = useRef(shot.radius ?? 14);
  const done = useRef(false);
  const lifeMs = useRef(Math.max(200, shot.life));
  const spawnAcc = useRef(0);
  const handPool = useRef(createMotePool(HAND_MOTES));
  const beamPool = useRef(createMotePool(BEAM_MOTES));

  const endLength = shot.radius ?? 14;

  const walls = useMemo((): WallCollider[] => {
    return baseCityStaticColliders().filter(
      (c): c is WallCollider => c.shape === "walls",
    );
  }, []);

  const positions = useMemo(() => new Float32Array(TOTAL_MOTES * 3), []);
  const sizes = useMemo(() => new Float32Array(TOTAL_MOTES), []);
  const alphas = useMemo(() => new Float32Array(TOTAL_MOTES), []);

  const particleGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geo;
  }, [positions, sizes, alphas]);

  const particleMat = useMemo(() => createCirclePointMaterial(BEAM_HOT), []);

  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BEAM_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BEAM_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => {
    // Opening hand burst.
    for (let i = 0; i < 12; i++) {
      const p = handPool.current[i];
      if (p) spawnHandMote(p);
    }
    return () => {
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, [particleGeo, particleMat]);

  useFrame((_, dt) => {
    if (done.current) return;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    const ageMs = performance.now() - shot.born;
    const life = lifeMs.current;
    const t = ageMs / life;
    const fade = softEnvelope(t, 0.06, 0.88);

    if (fade <= 0.01 || t >= 1) {
      done.current = true;
      coreMat.opacity = 0;
      glowMat.opacity = 0;
      if (root.current) root.current.visible = false;
      if (points.current) points.current.visible = false;
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
    const maxLen = coneRayMaxLength(
      { x: pose.current.x, z: pose.current.z },
      pose.current.yaw,
      endLength,
      walls,
      bodies,
      shot.followOwnerId ?? "",
    );
    const grow = smooth01(Math.min(1, ageMs / Math.max(80, shot.growMs ?? 140)));
    liveLen.current = THREE.MathUtils.lerp(SPAWN, Math.max(SPAWN, maxLen), grow);

    if (root.current) {
      root.current.visible = true;
      root.current.position.set(pose.current.x, 0, pose.current.z);
      root.current.rotation.y = pose.current.yaw;
    }

    const len = liveLen.current;
    const midZ = SPAWN + (len - SPAWN) * 0.5;
    const cylLen = Math.max(0.05, len - SPAWN);
    const pulse = 1 + 0.04 * Math.sin(performance.now() * 0.012);

    if (core.current) {
      core.current.position.set(0, HAND_Y, midZ);
      core.current.scale.set(0.055 * pulse, cylLen, 0.055 * pulse);
    }
    if (glow.current) {
      glow.current.position.set(0, HAND_Y, midZ);
      glow.current.scale.set(0.14 * pulse, cylLen, 0.14 * pulse);
    }
    coreMat.opacity = fade * 0.85;
    glowMat.opacity = fade * 0.28;

    // Continuous emit while the beam is strong.
    if (fade > 0.15) {
      spawnAcc.current += safeDt;
      const emitEvery = 0.026;
      while (spawnAcc.current >= emitEvery) {
        spawnAcc.current -= emitEvery;
        const hand = handPool.current.find((m) => !m.alive);
        if (hand) spawnHandMote(hand);
        const beam = beamPool.current.find((m) => !m.alive);
        if (beam) spawnBeamMote(beam, len);
        if (Math.random() < 0.4) {
          const extra = beamPool.current.find((m) => !m.alive);
          if (extra) spawnBeamMote(extra, len);
        }
      }
    }

    let living = 0;
    const stepPool = (pool: Mote[], offset: number) => {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]!;
        const idx = offset + i;
        if (!p.alive) {
          positions[idx * 3 + 1] = -999;
          sizes[idx] = 0;
          alphas[idx] = 0;
          continue;
        }
        p.age += safeDt;
        if (p.age >= p.life) {
          p.alive = false;
          positions[idx * 3 + 1] = -999;
          sizes[idx] = 0;
          alphas[idx] = 0;
          continue;
        }
        const u = p.age / p.life;
        p.x += p.vx * safeDt;
        p.y += p.vy * safeDt;
        p.z += p.vz * safeDt;
        p.vy += 0.15 * safeDt;
        positions[idx * 3] = p.x;
        positions[idx * 3 + 1] = p.y;
        positions[idx * 3 + 2] = p.z;
        const appear = THREE.MathUtils.smoothstep(u, 0, 0.12);
        const out = (1 - u) * (1 - u);
        sizes[idx] = p.size * appear * (26 + 6 * fade);
        alphas[idx] = appear * out * fade * 0.95;
        living++;
      }
    };
    stepPool(handPool.current, 0);
    stepPool(beamPool.current, HAND_MOTES);

    particleGeo.attributes.position!.needsUpdate = true;
    particleGeo.attributes.aSize!.needsUpdate = true;
    particleGeo.attributes.aAlpha!.needsUpdate = true;
    if (points.current) points.current.visible = living > 0;
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
      <mesh ref={core} material={coreMat} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1, 1, 1, 10, 1, true]} />
      </mesh>
      <mesh ref={glow} material={glowMat} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
      </mesh>
      <points
        ref={points}
        geometry={particleGeo}
        material={particleMat}
        frustumCulled={false}
      />
    </group>
  );
}
