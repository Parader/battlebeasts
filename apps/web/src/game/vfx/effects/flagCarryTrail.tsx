import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createCirclePointMaterial } from "../materials/circlePoint";

const MOTE_COUNT = 40;
const STREAK_COUNT = 12;
const EMIT_EVERY = 0.016;
const MOTE_LIFE = 0.55;
const STREAK_LIFE = 0.62;
const SAMPLE_DIST = 0.14;

export type FlagTrailPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
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

type Streak = {
  alive: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  len: number;
};

type Props = {
  color: string;
  hot: string;
  getPose: () => FlagTrailPose | null;
};

/**
 * Soft cloth-wake behind a carried CTF flag — motes + additive streaks
 * in the flag's team color.
 */
export function FlagCarryTrail({ color, hot, getPose }: Props) {
  const root = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const streakMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const emitAcc = useRef(0);
  const last = useRef<{ x: number; z: number } | null>(null);
  const motes = useRef<Mote[]>(
    Array.from({ length: MOTE_COUNT }, () => ({
      alive: false,
      age: 0,
      life: MOTE_LIFE,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.14,
    })),
  );
  const streaks = useRef<Streak[]>(
    Array.from({ length: STREAK_COUNT }, () => ({
      alive: false,
      age: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      len: 0.4,
    })),
  );

  const positions = useMemo(() => new Float32Array(MOTE_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(MOTE_COUNT), []);
  const alphas = useMemo(() => new Float32Array(MOTE_COUNT), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);
  const moteMat = useMemo(() => createCirclePointMaterial(hot), [hot]);
  const streakMats = useMemo(() => {
    const mk = (hex: string, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    return Array.from({ length: STREAK_COUNT }, (_, i) =>
      mk(i % 2 === 0 ? color : hot, i % 2 === 0 ? 0.55 : 0.38),
    );
  }, [color, hot]);
  const streakGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useEffect(() => {
    return () => {
      geo.dispose();
      moteMat.dispose();
      for (const mat of streakMats) mat.dispose();
      streakGeo.dispose();
    };
  }, [geo, moteMat, streakMats, streakGeo]);

  const spawnMote = (x: number, y: number, z: number, dx: number, dz: number) => {
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
    mote.life = MOTE_LIFE * (0.7 + Math.random() * 0.5);
    mote.x = x + px * lateral + bx * 0.08;
    mote.y = y + (Math.random() - 0.25) * 0.35;
    mote.z = z + pz * lateral + bz * 0.08;
    mote.vx = bx * (0.55 + Math.random() * 1.1) + px * (Math.random() - 0.5) * 0.45;
    mote.vy = 0.15 + Math.random() * 0.55;
    mote.vz = bz * (0.55 + Math.random() * 1.1) + pz * (Math.random() - 0.5) * 0.45;
    mote.size = 0.12 + Math.random() * 0.2;
  };

  const spawnStreak = (x: number, y: number, z: number, yaw: number, len: number) => {
    const streak = streaks.current.find((s) => !s.alive);
    if (!streak) return;
    streak.alive = true;
    streak.age = 0;
    streak.x = x;
    streak.y = y;
    streak.z = z;
    streak.yaw = yaw;
    streak.len = len;
  };

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const pose = getPose();
    const safeDt = Math.min(0.05, Math.max(0, dt));

    if (!pose) {
      last.current = null;
      emitAcc.current = 0;
    } else {
      const prev = last.current;
      let dx = 0;
      let dz = 0;
      if (!prev) {
        last.current = { x: pose.x, z: pose.z };
      } else {
        dx = pose.x - prev.x;
        dz = pose.z - prev.z;
        last.current = { x: pose.x, z: pose.z };
      }
      const traveled = Math.hypot(dx, dz);
      emitAcc.current += safeDt;
      while (emitAcc.current >= EMIT_EVERY) {
        emitAcc.current -= EMIT_EVERY;
        spawnMote(pose.x, pose.y, pose.z, dx, dz);
        if (traveled > 0.05) spawnMote(pose.x, pose.y, pose.z, dx, dz);
      }
      if (traveled >= SAMPLE_DIST) {
        const face = Math.atan2(dx, dz);
        spawnStreak(
          (pose.x + (prev?.x ?? pose.x)) * 0.5,
          pose.y * 0.55 + 0.2,
          (pose.z + (prev?.z ?? pose.z)) * 0.5,
          face,
          0.34 + traveled * 0.6,
        );
      }
    }

    let living = 0;
    for (let i = 0; i < MOTE_COUNT; i++) {
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
      m.vy += 0.35 * safeDt;
      m.vx *= 0.96;
      m.vz *= 0.96;
      positions[i * 3] = m.x;
      positions[i * 3 + 1] = m.y;
      positions[i * 3 + 2] = m.z;
      const appear = Math.min(1, u / 0.1);
      const fade = (1 - u) * (1 - u);
      sizes[i] = m.size * appear * fade * 52;
      alphas[i] = appear * fade * 0.95;
      living++;
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
    if (points.current) points.current.visible = living > 0;

    for (let i = 0; i < STREAK_COUNT; i++) {
      const mesh = streakMeshes.current[i];
      const s = streaks.current[i]!;
      if (!mesh) continue;
      if (!s.alive) {
        mesh.visible = false;
        continue;
      }
      s.age += safeDt;
      if (s.age >= STREAK_LIFE) {
        s.alive = false;
        mesh.visible = false;
        continue;
      }
      const u = s.age / STREAK_LIFE;
      const fade = (1 - u) * (1 - u);
      mesh.visible = fade > 0.03;
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.set(-Math.PI / 2, 0, s.yaw);
      mesh.scale.set(0.18 + (1 - u) * 0.14, s.len * (0.85 + fade * 0.2), 1);
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.opacity = fade * (i % 2 === 0 ? 0.55 : 0.38);
    }

    g.visible = living > 0 || streaks.current.some((s) => s.alive);
  });

  return (
    <group ref={root} visible={false}>
      <points ref={points} geometry={geo} material={moteMat} frustumCulled={false} renderOrder={4} />
      {Array.from({ length: STREAK_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            streakMeshes.current[i] = el;
          }}
          geometry={streakGeo}
          material={streakMats[i]}
          frustumCulled={false}
          renderOrder={3}
          visible={false}
        />
      ))}
    </group>
  );
}
