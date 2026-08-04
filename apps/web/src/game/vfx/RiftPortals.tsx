import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { GroundDecal } from "./components/GroundDecal";
import { createCirclePointMaterial } from "./materials/circlePoint";
import {
  createGroundDecalMaterial,
  setGroundDecalOpacity,
  setGroundDecalProgress,
  tickGroundDecal,
} from "./materials/groundDecal";
import { groundPresets } from "./presets/ground";

type RiftSchema = {
  x?: number;
  z?: number;
  yaw?: number;
  radius?: number;
  phase?: string;
  armEndsAt?: number;
  expiresAt?: number;
  index?: number;
};

const RIM = "#a78bfa";
const HOT = "#ddd6fe";

/** Visual oval: wide × tall × thin (local X / Y / Z). */
const OVAL_W = 1.15;
const OVAL_H = 1.35;
const OVAL_D = 0.28;

const MOTE_COUNT = 36;
const FILL_PRESET = groundPresets.riftPortal;

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

function spawnMote(m: Mote, radius: number, arming: boolean) {
  const u = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  const side = Math.random() < 0.5 ? -1 : 1;
  m.alive = true;
  m.age = 0;
  m.life = 0.55 + Math.random() * 0.85;
  m.x = Math.cos(u) * r * OVAL_W * 0.85;
  m.y = Math.sin(u) * r * OVAL_H * 0.85;
  m.z = side * radius * OVAL_D * 0.4;
  m.vx = (Math.random() - 0.5) * 0.35;
  m.vy = 0.15 + Math.random() * 0.55;
  m.vz = side * (0.45 + Math.random() * 0.9) * (arming ? 0.65 : 1);
  m.size = 0.05 + Math.random() * 0.1;
}

function RiftMesh({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const rim = useRef<THREE.Mesh>(null);
  const fill = useRef<THREE.Mesh>(null);
  const groundBlot = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const born = useRef(performance.now());
  const motes = useRef(createMotePool(MOTE_COUNT));
  const spawnAcc = useRef(0);
  const fadeRef = useRef(1);

  const rimMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: RIM,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const fillMat = useMemo(
    () => createGroundDecalMaterial(FILL_PRESET, "circle"),
    [],
  );

  const particleGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MOTE_COUNT * 3);
    const size = new Float32Array(MOTE_COUNT);
    const alpha = new Float32Array(MOTE_COUNT);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    return geo;
  }, []);

  const particleMat = useMemo(() => createCirclePointMaterial(HOT), []);

  useEffect(
    () => () => {
      particleGeo.dispose();
      particleMat.dispose();
      rimMat.dispose();
      fillMat.dispose();
    },
    [particleGeo, particleMat, rimMat, fillMat],
  );

  useFrame((_, dt) => {
    const v = room.state?.riftPortals?.get(id) as RiftSchema | undefined;
    const g = root.current;
    if (!v || !g) {
      if (g) g.visible = false;
      return;
    }
    const radius = Math.max(0.3, v.radius ?? 0.45);
    const phase = v.phase ?? "open";
    const arming = phase === "arming";
    const wallNow = Date.now();
    const expiresAt = v.expiresAt ?? 0;
    const lifeLeft =
      phase === "open" && expiresAt > 0 ? expiresAt - wallNow : Number.POSITIVE_INFINITY;
    if (phase === "open" && expiresAt > 0 && lifeLeft <= 0) {
      g.visible = false;
      return;
    }

    g.visible = true;
    g.position.set(v.x ?? 0, 0.78, v.z ?? 0);
    g.rotation.y = v.yaw ?? 0;

    const age = (performance.now() - born.current) / 1000;
    const pulse = 0.94 + 0.06 * Math.sin(age * 3.2 + (v.index ?? 0));
    const fade =
      arming
        ? 0.75 + 0.25 * Math.sin(age * 5)
        : lifeLeft < 1200
          ? Math.max(0.15, lifeLeft / 1200)
          : 1;
    fadeRef.current = fade;

    const s = radius * pulse;
    const safeDt = Math.min(0.05, Math.max(0, dt));

    // Ground-shader fill on the oval face (plane in local XY → oval via nonuniform scale).
    if (fill.current) {
      fill.current.scale.set(s * OVAL_W * 2, s * OVAL_H * 2, 1);
      fill.current.rotation.z += (FILL_PRESET.spin ?? 0.55) * safeDt;
      setGroundDecalProgress(fillMat, 1);
      setGroundDecalOpacity(fillMat, FILL_PRESET.opacity * fade);
      fill.current.visible = fade > 0.02;
      tickGroundDecal(fillMat, safeDt, 0);
    }

    if (rim.current) {
      rim.current.scale.set(s * OVAL_W * 1.08, s * OVAL_H * 1.08, s * OVAL_D * 1.2);
      rimMat.opacity = 0.42 * fade;
    }
    if (groundBlot.current) {
      const gScale = s * OVAL_W * 1.05;
      groundBlot.current.scale.set(gScale, 1, gScale);
      groundBlot.current.visible = fade > 0.02;
    }

    // Soft wisps billowing out both faces of the oval.
    const spawnRate = arming ? 18 : 28;
    spawnAcc.current += spawnRate * safeDt * fade;
    const pool = motes.current;
    while (spawnAcc.current >= 1) {
      spawnAcc.current -= 1;
      const slot = pool.find((m) => !m.alive);
      if (!slot) break;
      spawnMote(slot, radius, arming);
    }

    const posAttr = particleGeo.getAttribute("position") as THREE.BufferAttribute;
    const sizeAttr = particleGeo.getAttribute("aSize") as THREE.BufferAttribute;
    const alphaAttr = particleGeo.getAttribute("aAlpha") as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const sizes = sizeAttr.array as Float32Array;
    const alphas = alphaAttr.array as Float32Array;

    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = pool[i]!;
      if (!m.alive) {
        pos[i * 3] = 0;
        pos[i * 3 + 1] = -99;
        pos[i * 3 + 2] = 0;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      m.age += safeDt;
      if (m.age >= m.life) {
        m.alive = false;
        pos[i * 3 + 1] = -99;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      m.x += m.vx * safeDt;
      m.y += m.vy * safeDt;
      m.z += m.vz * safeDt;
      m.vy += 0.25 * safeDt;
      m.vx *= 1 - 0.8 * safeDt;
      m.vz *= 1 - 0.55 * safeDt;

      const t = m.age / m.life;
      const envelope = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      pos[i * 3] = m.x;
      pos[i * 3 + 1] = m.y;
      pos[i * 3 + 2] = m.z;
      sizes[i] = m.size * (1.15 - t * 0.55);
      alphas[i] = Math.max(0, envelope) * 0.85 * fade;
    }
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    if (points.current) points.current.visible = fade > 0.02;
  });

  return (
    <group ref={root} visible={false}>
      {/* Ground shader filling the oval mouth. */}
      <mesh ref={fill} renderOrder={3} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <primitive object={fillMat} attach="material" />
      </mesh>
      {/* Soft outer rim shell. */}
      <mesh ref={rim} renderOrder={4} frustumCulled={false}>
        <sphereGeometry args={[1, 18, 12]} />
        <primitive object={rimMat} attach="material" />
      </mesh>
      <points
        ref={points}
        geometry={particleGeo}
        material={particleMat}
        renderOrder={5}
        frustumCulled={false}
      />
      {/* Matching ground blot under the mouth (unit radius, scaled in useFrame). */}
      <group ref={groundBlot} position={[0, -0.76, 0]}>
        <GroundDecal
          preset={FILL_PRESET}
          shape="circle"
          x={0}
          z={0}
          y={0.03}
          radius={1}
          opacityMulRef={fadeRef}
          progress={1}
        />
      </group>
    </group>
  );
}

/** Schema-synced Rift Fissure mouths. */
export function RiftPortals({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.riftPortals) return;
    const next: string[] = [];
    room.state.riftPortals.forEach((_d: unknown, id: string) => next.push(id));
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setIds(next);
    }
  });

  if (!room) return null;
  return (
    <>
      {ids.map((id) => (
        <RiftMesh key={id} room={room} id={id} />
      ))}
    </>
  );
}
