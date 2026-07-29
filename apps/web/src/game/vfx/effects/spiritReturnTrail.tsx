import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SPIRIT_FORM_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { abilityVfxColor } from "../colors";

const COUNT = 48;
const EMIT_EVERY = 0.018;
const PARTICLE_LIFE = 0.38;

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

/**
 * Soft spirit motes trailing the caster during Spirit Form return — no bubble/ring mesh.
 */
export function SpiritReturnTrailEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const motes = useRef<Mote[]>(
    Array.from({ length: COUNT }, () => ({
      alive: false,
      age: 0,
      life: PARTICLE_LIFE,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.12,
    })),
  );
  const emitAcc = useRef(0);
  const lastPos = useRef<{ x: number; z: number } | null>(null);
  const color = abilityVfxColor("spiritForm", "#a5b4fc");

  const positions = useMemo(() => new Float32Array(COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(COUNT), []);
  const alphas = useMemo(() => new Float32Array(COUNT), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);
  const mat = useMemo(() => createCirclePointMaterial(color), [color]);

  useEffect(() => {
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat]);

  const spawn = (x: number, z: number, dx: number, dz: number) => {
    const mote = motes.current.find((m) => !m.alive);
    if (!mote) return;
    const spd = Math.hypot(dx, dz);
    const bx = spd > 1e-4 ? -dx / spd : 0;
    const bz = spd > 1e-4 ? -dz / spd : 0;
    const px = -bz;
    const pz = bx;
    const lateral = (Math.random() - 0.5) * 0.35;
    mote.alive = true;
    mote.age = 0;
    mote.life = PARTICLE_LIFE * (0.75 + Math.random() * 0.45);
    mote.x = x + px * lateral + (Math.random() - 0.5) * 0.08;
    mote.y = 0.35 + Math.random() * 1.15;
    mote.z = z + pz * lateral + (Math.random() - 0.5) * 0.08;
    mote.vx = bx * (0.4 + Math.random() * 0.9) + px * (Math.random() - 0.5) * 0.6;
    mote.vy = 0.35 + Math.random() * 1.1;
    mote.vz = bz * (0.4 + Math.random() * 0.9) + pz * (Math.random() - 0.5) * 0.6;
    mote.size = 0.1 + Math.random() * 0.16;
  };

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    const lifeMs = Math.max(320, shot.life);
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const followUntil = SPIRIT_FORM_CAST.snapReturnMaxMs + 60;
    let x = shot.x;
    let z = shot.z;
    if (age <= followUntil && shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        x = local.x;
        z = local.z;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
        }
      }
    }

    const safeDt = Math.min(0.05, Math.max(0, dt));
    const prev = lastPos.current;
    let dx = 0;
    let dz = 0;
    if (!prev) {
      lastPos.current = { x, z };
      // Opening burst so the return reads immediately.
      for (let i = 0; i < 10; i++) spawn(x, z, 0, 1);
    } else {
      dx = x - prev.x;
      dz = z - prev.z;
      lastPos.current = { x, z };
    }

    const stillFollowing = age <= followUntil;
    if (stillFollowing) {
      emitAcc.current += safeDt;
      const traveled = Math.hypot(dx, dz);
      while (emitAcc.current >= EMIT_EVERY) {
        emitAcc.current -= EMIT_EVERY;
        spawn(x, z, dx, dz);
        if (traveled > 0.08) spawn(x, z, dx, dz);
      }
    }

    let living = 0;
    for (let i = 0; i < COUNT; i++) {
      const m = motes.current[i]!;
      if (!m.alive) {
        positions[i * 3 + 1] = -999;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      m.age += safeDt;
      if (m.age >= m.life) {
        m.alive = false;
        positions[i * 3 + 1] = -999;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const u = m.age / m.life;
      m.x += m.vx * safeDt;
      m.y += m.vy * safeDt;
      m.z += m.vz * safeDt;
      m.vy += 0.6 * safeDt;
      m.vx *= 0.97;
      m.vz *= 0.97;
      positions[i * 3] = m.x;
      positions[i * 3 + 1] = m.y;
      positions[i * 3 + 2] = m.z;
      const appear = Math.min(1, u / 0.12);
      const fade = (1 - u) * (1 - u);
      sizes[i] = m.size * appear * fade * 48;
      alphas[i] = appear * fade * 0.9;
      living++;
    }

    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
    if (points.current) points.current.visible = living > 0;
  });

  return (
    <group ref={root} visible={false}>
      <points ref={points} geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />
    </group>
  );
}
