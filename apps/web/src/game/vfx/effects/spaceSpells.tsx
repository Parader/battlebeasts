import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BULWARK_CHARGE_CAST,
  REBOUND_CAST,
  TELEPORT_SLAM_CAST,
  VERDANT_LEAP_CAST,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { createCirclePointMaterial } from "../materials/circlePoint";
import { createTrailMaterial } from "../materials/trailMaterial";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { getWindStreakTexture } from "../windStreakTexture";

function useMats(colors: THREE.Color[]) {
  return useMemo(
    () =>
      colors.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/** Verdant Leap out-of-range ring (variant 3) — same language as Soul Relay. */
export function VerdantLeapOutOfRangeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const range = Math.max(2, shot.radius ?? VERDANT_LEAP_CAST.range);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ef4444",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(400, shot.life ?? 700);
    if (ms >= life) {
      g.visible = false;
      mat.opacity = 0;
      return;
    }
    g.visible = true;
    const age = ms / life;
    const flash = softEnvelope(age, 0.18, 0.38);
    mat.opacity = 0.34 * flash;
    const s = range * (0.97 + flash * 0.03);
    g.scale.set(s, s, s);
    g.position.set(shot.x, 0.03, shot.z);
  });

  return (
    <group ref={root} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.92, 1.0, 48]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** Verdant Leap arrival bloom / heal pulse. */
export function VerdantLeapEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const mats = useMats([
    new THREE.Color("#A9D978"),
    new THREE.Color("#6EE7B7"),
  ]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const t = Math.min(1, (performance.now() - shot.born) / Math.max(200, shot.life));
    const a = softEnvelope(t, 0.12, 0.45);
    g.visible = a > 0.04;
    g.position.set(shot.x, 0.08, shot.z);
    if (ring.current) {
      ring.current.scale.setScalar(0.4 + t * 1.6);
      mats[0]!.opacity = 0.55 * a;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.35, 0.55, 24]} />
        <primitive object={mats[0]!} attach="material" />
      </mesh>
    </group>
  );
}

const VERDANT_TRAIL = "#A9D978";
const VERDANT_COUNT = 40;
const VERDANT_EMIT = 0.02;

type TrailMote = {
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

/** Soft green motes trailing Verdant Leap. */
export function VerdantLeapTrailEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const motes = useRef<TrailMote[]>(
    Array.from({ length: VERDANT_COUNT }, () => ({
      alive: false,
      age: 0,
      life: 0.4,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.1,
    })),
  );
  const emitAcc = useRef(0);
  const lastPos = useRef<{ x: number; z: number } | null>(null);
  const positions = useMemo(() => new Float32Array(VERDANT_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(VERDANT_COUNT), []);
  const alphas = useMemo(() => new Float32Array(VERDANT_COUNT), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);
  const mat = useMemo(() => createCirclePointMaterial(VERDANT_TRAIL), []);

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
    const lateral = (Math.random() - 0.5) * 0.32;
    mote.alive = true;
    mote.age = 0;
    mote.life = 0.35 + Math.random() * 0.25;
    mote.x = x + px * lateral;
    mote.y = 0.2 + Math.random() * 0.9;
    mote.z = z + pz * lateral;
    mote.vx = bx * (0.2 + Math.random() * 0.5) + px * (Math.random() - 0.5) * 0.4;
    mote.vy = 0.15 + Math.random() * 0.45;
    mote.vz = bz * (0.2 + Math.random() * 0.5) + pz * (Math.random() - 0.5) * 0.4;
    mote.size = 0.09 + Math.random() * 0.14;
  };

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    const lifeMs = Math.max(420, shot.life);
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const followUntil = VERDANT_LEAP_CAST.travelDurationMs + 80;
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
      const prev = lastPos.current;
      emitAcc.current += dt;
      if (!prev) lastPos.current = { x, z };
      else {
        const dx = x - prev.x;
        const dz = z - prev.z;
        while (emitAcc.current >= VERDANT_EMIT) {
          emitAcc.current -= VERDANT_EMIT;
          spawn(x, z, dx, dz);
          if (Math.random() < 0.5) spawn(x, z, dx, dz);
        }
        lastPos.current = { x, z };
      }
    }

    for (let i = 0; i < VERDANT_COUNT; i++) {
      const m = motes.current[i]!;
      if (!m.alive) {
        sizes[i] = 0;
        alphas[i] = 0;
        positions[i * 3 + 1] = -99;
        continue;
      }
      m.age += dt;
      if (m.age >= m.life) {
        m.alive = false;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const u = m.age / m.life;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      m.vx *= 0.94;
      m.vy *= 0.96;
      m.vz *= 0.94;
      positions[i * 3] = m.x;
      positions[i * 3 + 1] = m.y;
      positions[i * 3 + 2] = m.z;
      sizes[i] = m.size * (1.05 - u * 0.5) * 48;
      alphas[i] = softEnvelope(u, 0.08, 0.4) * 0.65;
    }
    const geom = points.current?.geometry;
    if (geom) {
      geom.attributes.position!.needsUpdate = true;
      geom.attributes.aSize!.needsUpdate = true;
      geom.attributes.aAlpha!.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <points ref={points} geometry={geo} frustumCulled={false} renderOrder={3}>
        <primitive object={mat} attach="material" />
      </points>
    </group>
  );
}

const STEEL = "#94a3b8";
const COUNT = 36;
const EMIT_EVERY = 0.022;
const PARTICLE_LIFE = 0.42;

type Mote = TrailMote;

/**
 * Soft steel motes trailing Bulwark Charge — organic dust, not hard rectangles.
 */
export function BulwarkChargeEffect({
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
      size: 0.1,
    })),
  );
  const emitAcc = useRef(0);
  const lastPos = useRef<{ x: number; z: number } | null>(null);

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
  const mat = useMemo(() => createCirclePointMaterial(STEEL), []);

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
    const lateral = (Math.random() - 0.5) * 0.28;
    mote.alive = true;
    mote.age = 0;
    mote.life = PARTICLE_LIFE * (0.7 + Math.random() * 0.5);
    mote.x = x + px * lateral + (Math.random() - 0.5) * 0.06;
    mote.y = 0.15 + Math.random() * 0.85;
    mote.z = z + pz * lateral + (Math.random() - 0.5) * 0.06;
    mote.vx = bx * (0.15 + Math.random() * 0.45) + px * (Math.random() - 0.5) * 0.35;
    mote.vy = 0.08 + Math.random() * 0.35;
    mote.vz = bz * (0.15 + Math.random() * 0.45) + pz * (Math.random() - 0.5) * 0.35;
    mote.size = 0.08 + Math.random() * 0.14;
  };

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    const lifeMs = Math.max(420, shot.life);
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const followUntil = BULWARK_CHARGE_CAST.travelDurationMs + 80;
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

      const prev = lastPos.current;
      emitAcc.current += dt;
      if (!prev) {
        lastPos.current = { x, z };
      } else {
        const dx = x - prev.x;
        const dz = z - prev.z;
        while (emitAcc.current >= EMIT_EVERY) {
          emitAcc.current -= EMIT_EVERY;
          spawn(x, z, dx, dz);
          if (Math.random() < 0.45) spawn(x, z, dx, dz);
        }
        lastPos.current = { x, z };
      }
    }

    for (let i = 0; i < COUNT; i++) {
      const m = motes.current[i]!;
      if (!m.alive) {
        sizes[i] = 0;
        alphas[i] = 0;
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -99;
        positions[i * 3 + 2] = 0;
        continue;
      }
      m.age += dt;
      if (m.age >= m.life) {
        m.alive = false;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const u = m.age / m.life;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      m.vy *= 0.96;
      m.vx *= 0.94;
      m.vz *= 0.94;
      positions[i * 3] = m.x;
      positions[i * 3 + 1] = m.y;
      positions[i * 3 + 2] = m.z;
      sizes[i] = m.size * (1.05 - u * 0.55) * 48;
      alphas[i] = softEnvelope(u, 0.08, 0.45) * 0.55;
    }

    const geom = points.current?.geometry;
    if (geom) {
      geom.attributes.position!.needsUpdate = true;
      geom.attributes.aSize!.needsUpdate = true;
      geom.attributes.aAlpha!.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <points ref={points} geometry={geo} frustumCulled={false} renderOrder={3}>
        <primitive object={mat} attach="material" />
      </points>
    </group>
  );
}

/** Predator Step — no sphere pop; cloak + haste statuses carry the read. */
export function PredatorStepEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const mats = useMats([new THREE.Color("#5C1B28")]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const t = Math.min(1, (performance.now() - shot.born) / Math.max(180, shot.life));
    const a = softEnvelope(t, 0.08, 0.5);
    g.visible = a > 0.03;
    g.position.set(shot.x, 0.05, shot.z);
    mats[0]!.opacity = 0.22 * a;
    g.scale.setScalar(0.4 + t * 0.5);
  });

  return (
    <group ref={root} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.25, 0.42, 20]} />
        <primitive object={mats[0]!} attach="material" />
      </mesh>
    </group>
  );
}

/** Rebound frontal peel — Gust-style wind/smoke over a wide frontal cone. */
export function ReboundEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const sheets = useRef<(THREE.Mesh | null)[]>([]);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const points = useRef<THREE.Points>(null);
  const progress = useRef(0);
  const smokeOpacity = useRef(0);
  const range = shot.radius ?? REBOUND_CAST.coneRange;
  const halfAngle = (REBOUND_CAST.coneAngleDeg * Math.PI) / 180 / 2;
  const windTex = getWindStreakTexture();
  const smoke = useMemo(
    () => ({
      ...groundPresets.windSmoke,
      radius: range,
      halfAngle,
      lifeMs: 620,
      opacity: 0.48,
      breakup: 0.5,
      fadeStart: 0.4,
    }),
    [range, halfAngle],
  );

  const sheetMats = useMemo(() => {
    return [0, 1, 2, 3].map((i) => {
      const tex = windTex.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.offset.set(Math.random(), Math.random() * 0.2);
      tex.repeat.set(1.15 + i * 0.1, 0.55);
      tex.needsUpdate = true;
      return new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(i % 2 === 0 ? "#94a3b8" : "#64748b"),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    });
  }, [windTex]);

  const AIR_COUNT = 8;
  const airSheets = useMemo(
    () =>
      Array.from({ length: AIR_COUNT }, (_, i) => {
        const t = (i + 0.5) / AIR_COUNT;
        return {
          angle: (t - 0.5) * 2 * halfAngle,
          y: 0.45 + (i % 3) * 0.18,
          speed: 7.5 + Math.random() * 3,
          len: 0.28 + Math.random() * 0.12,
          width: 0.55 + Math.random() * 0.25,
          height: 0.16 + Math.random() * 0.08,
          delay: Math.random() * 0.04,
          curl: (i % 2 === 0 ? 1 : -1) * (0.05 + Math.random() * 0.08),
        };
      }),
    [halfAngle],
  );
  const trailMats = useMemo(
    () =>
      airSheets.map(() =>
        createTrailMaterial("#e8eef5", { opacity: 0.34, head: 0.35 }),
      ),
    [airSheets],
  );

  const COUNT = 48;
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
  const moteMat = useMemo(() => createCirclePointMaterial("#9aa8b8"), []);
  const motes = useRef(
    Array.from({ length: COUNT }, () => ({
      alive: false,
      age: 0,
      life: 0.35,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.1,
    })),
  );
  const seeded = useRef(false);

  useEffect(() => {
    return () => {
      for (const m of sheetMats) {
        m.map?.dispose();
        m.dispose();
      }
      for (const m of trailMats) m.dispose();
      geo.dispose();
      moteMat.dispose();
    };
  }, [sheetMats, trailMats, geo, moteMat]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(520, shot.life);
    if (ms >= life) {
      g.visible = false;
      smokeOpacity.current = 0;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.04, shot.z);
    g.rotation.y = shot.yaw;

    const t = ms / life;
    const a = softEnvelope(t, 0.06, 0.42);
    const expand = 0.78 + t * 0.32;
    progress.current = expand;
    smokeOpacity.current = a * (1 - t * 0.25);

    for (let i = 0; i < sheetMats.length; i++) {
      const mesh = sheets.current[i];
      const mat = sheetMats[i]!;
      if (!mesh) continue;
      const along = range * (0.28 + i * 0.14 + t * 0.45);
      const width = range * (0.32 + i * 0.07) * Math.tan(halfAngle) * 2.4;
      mesh.position.set(Math.sin((i - 1.5) * 0.12) * 0.2, 0.3 + i * 0.08, along * 0.55);
      mesh.scale.set(Math.max(0.55, width), 1, along * 0.85);
      mesh.rotation.x = -Math.PI / 2.3;
      if (mat.map) mat.map.offset.x = (mat.map.offset.x + dt * (1.8 + i * 0.3)) % 1;
      mat.opacity = a * (0.4 - i * 0.05) * (1 - t * 0.28);
    }

    const sinceSec = ms / 1000;
    for (let i = 0; i < AIR_COUNT; i++) {
      const b = airSheets[i]!;
      const mesh = trailMeshes.current[i];
      const trail = trailMats[i];
      if (!mesh || !trail) continue;
      const age = sinceSec - b.delay;
      if (age < 0 || age > 0.32) {
        mesh.visible = false;
        continue;
      }
      const lifeU = age / 0.32;
      const dist = 0.25 + age * b.speed;
      const yaw = b.angle + b.curl * lifeU;
      mesh.visible = true;
      mesh.position.set(Math.sin(yaw) * dist, b.y + age * 0.2, Math.cos(yaw) * dist);
      mesh.rotation.set(0, yaw, 0);
      const flare = 1 + lifeU * 0.4;
      mesh.scale.set(b.width * flare, b.height, b.len * (0.85 + lifeU * 0.3));
      const fade =
        lifeU < 0.12 ? lifeU / 0.12 : Math.max(0, 1 - (lifeU - 0.12) / 0.88);
      trail.uniforms.uOpacity!.value = 0.36 * fade * fade * a;
    }

    if (!seeded.current) {
      seeded.current = true;
      for (let i = 0; i < COUNT; i++) {
        const m = motes.current[i]!;
        const u = Math.random();
        const ang = (Math.random() * 2 - 1) * halfAngle;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        m.alive = true;
        m.age = 0;
        m.life = 0.32 + Math.random() * 0.35;
        m.x = s * 0.15;
        m.y = 0.12 + Math.random() * 0.9;
        m.z = 0.12 + u * range * 0.22;
        m.vx = s * (1.6 + Math.random() * 2.8);
        m.vy = 0.2 + Math.random() * 0.7;
        m.vz = c * (3.2 + Math.random() * 4.5);
        m.size = 0.1 + Math.random() * 0.18;
      }
    }

    for (let i = 0; i < COUNT; i++) {
      const m = motes.current[i]!;
      if (!m.alive) {
        sizes[i] = 0;
        alphas[i] = 0;
        positions[i * 3 + 1] = -99;
        continue;
      }
      m.age += dt;
      if (m.age >= m.life) {
        m.alive = false;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      const u = m.age / m.life;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      m.vx *= 0.91;
      m.vy *= 0.94;
      m.vz *= 0.92;
      positions[i * 3] = m.x;
      positions[i * 3 + 1] = m.y;
      positions[i * 3 + 2] = m.z;
      sizes[i] = m.size * (1.15 - u * 0.5) * 52;
      alphas[i] = softEnvelope(u, 0.1, 0.45) * 0.55 * a;
    }
    const geom = points.current?.geometry;
    if (geom) {
      geom.attributes.position!.needsUpdate = true;
      geom.attributes.aSize!.needsUpdate = true;
      geom.attributes.aAlpha!.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <GroundDecal
        preset={smoke}
        shape="cone"
        x={0}
        z={0}
        y={0.03}
        radius={range}
        growExpand
        progressRef={progress}
        opacityMulRef={smokeOpacity}
      />
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={`wind-${i}`}
          ref={(m) => {
            sheets.current[i] = m;
          }}
          renderOrder={19}
        >
          <planeGeometry args={[1, 1]} />
          <primitive object={sheetMats[i]!} attach="material" />
        </mesh>
      ))}
      {airSheets.map((_, i) => (
        <mesh
          key={`air-${i}`}
          ref={(el) => {
            trailMeshes.current[i] = el;
          }}
          visible={false}
          renderOrder={20}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={trailMats[i]!} attach="material" />
        </mesh>
      ))}
      <points ref={points} geometry={geo} frustumCulled={false} renderOrder={21}>
        <primitive object={moteMat} attach="material" />
      </points>
    </group>
  );
}

const SLAM_EARTH = "#a16207";
const SLAM_HOT = "#d97706";

/**
 * Teleport Slam — earth slam rim like Jump Slam (v0), soft fade rematerialize (v1/v2).
 */
export function TeleportSlamEffect({ shot }: { shot: OneShotEffect }) {
  const variant = shot.variant ?? 0;
  if (variant === 0) return <TeleportSlamImpactEffect shot={shot} />;
  return <TeleportSlamShiftEffect shot={shot} />;
}

function TeleportSlamImpactEffect({ shot }: { shot: OneShotEffect }) {
  const hitRadius = Math.max(1.4, shot.radius ?? TELEPORT_SLAM_CAST.slamRadius);
  const lifeMs = Math.max(TELEPORT_SLAM_CAST.stunMs, shot.life || 900);
  const rimOpacity = useRef(0);
  const crackPreset = useMemo(
    () => ({
      ...groundPresets.earthSlam,
      colorCore: "#c4a35a",
      colorMid: "#5c3d24",
      colorEdge: "#120c08",
      breakup: 0.38,
      opacity: 1.2,
      radius: hitRadius * 1.35,
      lifeMs,
      ringWidth: 0.15,
      softness: 0.04,
      innerRatio: 0.22,
      noiseScale: 5.2,
      appearEnd: 0.05,
      fadeStart: 0.55,
    }),
    [hitRadius, lifeMs],
  );

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    rimOpacity.current = softEnvelope(u, 0.08, 0.55) * 0.9;
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        y={0.026}
        radius={hitRadius}
        color={SLAM_EARTH}
        hotColor={SLAM_HOT}
        fill={0.14}
        noise={0.35}
        rimWidth={0.022}
        glowWidth={0.06}
        opacity={0.72}
        opacityMulRef={rimOpacity}
        pulse={false}
      />
      <GroundDecal
        preset={crackPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.032}
        born={shot.born}
        life={lifeMs}
        radius={hitRadius * 1.35}
      />
    </group>
  );
}

/** Soft rematerialize dust — stronger on arrive so the fade-in has a visual anchor. */
function TeleportSlamShiftEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const isArrive = (shot.variant ?? 0) === 1;
  const progress = useRef(0);
  const smokeOpacity = useRef(0);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SLAM_EARTH,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const smoke = useMemo(
    () => ({
      ...groundPresets.windSmoke,
      colorCore: "#c4a35a",
      colorMid: "#78716c",
      colorEdge: "#292524",
      radius: isArrive ? 1.35 : 1.1,
      lifeMs: isArrive ? 580 : 380,
      opacity: isArrive ? 0.42 : 0.28,
      breakup: 0.48,
      fadeStart: 0.35,
    }),
    [isArrive],
  );

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const life = Math.max(isArrive ? 520 : 280, shot.life);
    const t = Math.min(1, (performance.now() - shot.born) / life);
    const a = softEnvelope(t, 0.1, 0.45) * (isArrive ? 0.38 : 0.2) * (1 - t * 0.35);
    g.visible = a > 0.015 || (isArrive && t < 0.95);
    g.position.set(shot.x, 0.04, shot.z);
    const s = (isArrive ? 0.45 : 0.7) + t * (isArrive ? 1.15 : 0.85);
    g.scale.setScalar(s);
    mat.opacity = a;
    progress.current = 0.35 + t * 0.65;
    smokeOpacity.current = softEnvelope(t, 0.08, 0.5) * (isArrive ? 0.9 : 0.55);
  });

  return (
    <group ref={root} visible={false}>
      {isArrive ? (
        <GroundDecal
          preset={smoke}
          shape="circle"
          x={0}
          z={0}
          y={0.03}
          radius={smoke.radius}
          growExpand
          progressRef={progress}
          opacityMulRef={smokeOpacity}
        />
      ) : null}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.28, isArrive ? 0.72 : 0.55, 28]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
