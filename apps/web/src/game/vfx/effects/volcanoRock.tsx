import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { VOLCANO_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { GroundDecal } from "../components/GroundDecal";
import { getSharedFireMaterial } from "../components/FireParticleField";
import { groundPresets } from "../presets/ground";
import {
  BOULDER_TARGET_SIZE,
  VOLCANO_GLB_URL,
  instantiateBoulder,
} from "../volcanoAsset";

/** Shared mat — avoid per-rock ShaderMaterial compile. */
const telegraphMat = new THREE.MeshBasicMaterial({
  color: "#ef4444",
  transparent: true,
  opacity: 0.34,
  depthWrite: false,
  depthTest: true,
  toneMapped: false,
});

const telegraphGeo = new THREE.CircleGeometry(1, 28);

const SHARD_COUNT = 9;
const FIRE_COUNT = 22;
const shardGeo = new THREE.DodecahedronGeometry(0.12, 0);
const shardMatA = new THREE.MeshBasicMaterial({ color: "#7c2d12", toneMapped: true });
const shardMatB = new THREE.MeshBasicMaterial({ color: "#ea580c", toneMapped: true });
const shardMatC = new THREE.MeshBasicMaterial({ color: "#1c1917", toneMapped: true });

/** variant 1 = telegraph (circle + arc), 2 = impact shatter. */
export function VolcanoRockEffect({ shot }: { shot: OneShotEffect }) {
  if ((shot.variant ?? 1) === 2) {
    return <VolcanoRockImpact shot={shot} />;
  }
  return <VolcanoRockTelegraph shot={shot} />;
}

function VolcanoRockTelegraph({ shot }: { shot: OneShotEffect }) {
  const gltf = useGLTF(VOLCANO_GLB_URL);
  const group = useRef<THREE.Group>(null);
  const circle = useRef<THREE.Mesh>(null);
  const lifeMs = Math.max(200, shot.life || VOLCANO_CAST.telegraphMs);
  // Match damage radius exactly — no visual overshoot.
  const blastR = Math.max(0.8, shot.radius ?? VOLCANO_CAST.rockBlastRadius);
  const originX = Number.isFinite(shot.originX) ? shot.originX! : shot.x;
  const originZ = Number.isFinite(shot.originZ) ? shot.originZ! : shot.z;

  const boulder = useMemo(() => instantiateBoulder(gltf.scene, shot.key), [gltf.scene, shot.key]);
  const circleMat = useMemo(() => telegraphMat.clone(), []);

  useEffect(() => {
    return () => {
      circleMat.dispose();
    };
  }, [circleMat]);

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    // Soft in, hold, then fade out before the one-shot unmounts.
    const fade = softEnvelope(u, 0.08, 0.62);
    if (circle.current) {
      circleMat.opacity = 0.34 * fade;
      circle.current.visible = fade > 0.02;
    }

    const g = group.current;
    if (!g) return;
    // Linear XZ so the mesh center tracks the aim line (eased Y only).
    const x = originX + (shot.x - originX) * u;
    const z = originZ + (shot.z - originZ) * u;
    const startY = 1.35;
    const peakY = 2.85;
    // Center-pivoted boulder: rest so bottom ≈ ground.
    const endY = BOULDER_TARGET_SIZE * 0.5;
    const y =
      (1 - u) * (1 - u) * startY + 2 * (1 - u) * u * peakY + u * u * endY;
    g.position.set(x, y, z);
    g.rotation.x = u * Math.PI * 1.6;
    g.rotation.y = u * Math.PI * 1.1;
    g.rotation.z = u * Math.PI * 0.7;
    g.visible = u < 0.98;
  });

  return (
    <group>
      <mesh
        ref={circle}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[shot.x, 0.03, shot.z]}
        scale={[blastR, blastR, 1]}
        geometry={telegraphGeo}
        material={circleMat}
        renderOrder={2}
        frustumCulled={false}
      />
      <group ref={group} position={[originX, 1.35, originZ]}>
        {boulder && <primitive object={boulder} />}
      </group>
    </group>
  );
}

type Shard = {
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  size: number;
};

/**
 * Leap Slam crater + rock shatter + fire.png pop.
 * Shared by volcano rock landings and Magma Orbs collide.
 */
export function VolcanoBoulderImpactFx({
  x,
  z,
  born,
  radius,
  seed,
  lifeMs = 1100,
}: {
  x: number;
  z: number;
  born: number;
  radius: number;
  seed: number;
  lifeMs?: number;
}) {
  const p = groundPresets.earthSlam;
  const blastR = Math.max(0.8, radius);
  const life = Math.max(lifeMs, p.lifeMs, 1100);

  return (
    <group>
      <GroundDecal
        preset={p}
        shape="circle"
        x={x}
        z={z}
        y={0.03}
        born={born}
        life={life}
        radius={blastR}
      />
      <RockShatterBurst
        x={x}
        z={z}
        born={born}
        lifeMs={life}
        seed={seed}
        radius={blastR}
      />
      <FirePopBurst x={x} z={z} born={born} lifeMs={life} seed={seed} />
    </group>
  );
}

/**
 * Leap Slam crater + rock shatter + fire.png pop.
 */
function VolcanoRockImpact({ shot }: { shot: OneShotEffect }) {
  return (
    <VolcanoBoulderImpactFx
      x={shot.x}
      z={shot.z}
      born={shot.born}
      radius={shot.radius ?? VOLCANO_CAST.rockBlastRadius}
      seed={shot.key}
      lifeMs={Math.max(shot.life, 1100)}
    />
  );
}

function RockShatterBurst({
  x,
  z,
  born,
  lifeMs,
  seed,
  radius,
}: {
  x: number;
  z: number;
  born: number;
  lifeMs: number;
  seed: number;
  radius: number;
}) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  const shards = useMemo<Shard[]>(() => {
    const out: Shard[] = [];
    // Deterministic-ish from seed so remounts don't reshuffle wildly.
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < SHARD_COUNT; i++) {
      const ang = (i / SHARD_COUNT) * Math.PI * 2 + rnd() * 0.4;
      const spd = 1.8 + rnd() * 2.4;
      out.push({
        vx: Math.cos(ang) * spd * (0.7 + rnd() * 0.5),
        vy: 2.2 + rnd() * 2.8,
        vz: Math.sin(ang) * spd * (0.7 + rnd() * 0.5),
        spinX: (rnd() - 0.5) * 18,
        spinY: (rnd() - 0.5) * 18,
        spinZ: (rnd() - 0.5) * 18,
        size: 0.55 + rnd() * 0.85,
      });
    }
    return out;
  }, [seed]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = (performance.now() - born) / lifeMs;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const fade = softEnvelope(age, 0.06, 0.55);
    const t = Math.min(0.55, age * (lifeMs / 1000));
    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = meshes.current[i];
      const sh = shards[i];
      if (!mesh || !sh) continue;
      // Integrate from rest each frame (short life — cheap enough).
      const drag = Math.max(0, 1 - t * 0.35);
      const px = sh.vx * t * drag;
      const py = Math.max(0.04, sh.vy * t - 4.8 * t * t);
      const pz = sh.vz * t * drag;
      mesh.position.set(px, py, pz);
      mesh.rotation.x = sh.spinX * t;
      mesh.rotation.y = sh.spinY * t;
      mesh.rotation.z = sh.spinZ * t;
      const sc = sh.size * (0.85 + 0.2 * Math.min(1, radius / 1.55)) * fade;
      mesh.scale.setScalar(sc);
      mesh.visible = fade > 0.04;
    }
  });

  const mats = [shardMatA, shardMatB, shardMatC];

  return (
    <group ref={group} position={[x, 0.08, z]}>
      {shards.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={shardGeo}
          material={mats[i % mats.length]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

const AIR_SHARD_COUNT = 6;

/**
 * Tiny mid-air rock shatter — Magma Orb wall despawn (no crater, no fire pop).
 */
export function OrbAirShatterFx({
  x,
  y,
  z,
  born,
  seed,
  lifeMs = 480,
  scale = 0.38,
}: {
  x: number;
  y: number;
  z: number;
  born: number;
  seed: number;
  lifeMs?: number;
  scale?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  const shards = useMemo<Shard[]>(() => {
    const out: Shard[] = [];
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < AIR_SHARD_COUNT; i++) {
      const ang = (i / AIR_SHARD_COUNT) * Math.PI * 2 + rnd() * 0.55;
      const spd = 0.85 + rnd() * 1.1;
      out.push({
        vx: Math.cos(ang) * spd * (0.75 + rnd() * 0.4),
        vy: 0.9 + rnd() * 1.4,
        vz: Math.sin(ang) * spd * (0.75 + rnd() * 0.4),
        spinX: (rnd() - 0.5) * 22,
        spinY: (rnd() - 0.5) * 22,
        spinZ: (rnd() - 0.5) * 22,
        size: 0.35 + rnd() * 0.45,
      });
    }
    return out;
  }, [seed]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = (performance.now() - born) / lifeMs;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const fade = softEnvelope(age, 0.04, 0.42);
    const t = Math.min(0.45, age * (lifeMs / 1000));
    for (let i = 0; i < AIR_SHARD_COUNT; i++) {
      const mesh = meshes.current[i];
      const sh = shards[i];
      if (!mesh || !sh) continue;
      const drag = Math.max(0, 1 - t * 0.55);
      mesh.position.set(sh.vx * t * drag, sh.vy * t - 5.5 * t * t, sh.vz * t * drag);
      mesh.rotation.x = sh.spinX * t;
      mesh.rotation.y = sh.spinY * t;
      mesh.rotation.z = sh.spinZ * t;
      mesh.scale.setScalar(sh.size * scale * fade);
      mesh.visible = fade > 0.04;
    }
  });

  const mats = [shardMatA, shardMatB, shardMatC];

  return (
    <group ref={group} position={[x, y, z]}>
      {shards.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={shardGeo}
          material={mats[i % mats.length]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

type FireP = {
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  delay: number;
};

/** One-shot fire.png burst — reuses shared firewall/volcano fire material. */
function FirePopBurst({
  x,
  z,
  born,
  lifeMs,
  seed,
}: {
  x: number;
  z: number;
  born: number;
  lifeMs: number;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);
  const material = useMemo(() => getSharedFireMaterial(), []);

  const particles = useMemo<FireP[]>(() => {
    const out: FireP[] = [];
    let s = (seed * 2246822519) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < FIRE_COUNT; i++) {
      const ang = rnd() * Math.PI * 2;
      const elev = 0.35 + rnd() * 0.9;
      const spd = 1.4 + rnd() * 2.6;
      out.push({
        vx: Math.cos(ang) * Math.sin(elev) * spd,
        vy: Math.cos(elev) * spd * 0.55 + 1.4 + rnd() * 1.6,
        vz: Math.sin(ang) * Math.sin(elev) * spd,
        life: 0.35 + rnd() * 0.35,
        size: 0.14 + rnd() * 0.18,
        delay: rnd() * 0.08,
      });
    }
    return out;
  }, [seed]);

  const positions = useMemo(() => new Float32Array(FIRE_COUNT * 3), []);
  const sizes = useMemo(() => new Float32Array(FIRE_COUNT), []);
  const colors = useMemo(() => new Float32Array(FIRE_COUNT * 4), []);
  const angles = useMemo(() => new Float32Array(FIRE_COUNT), []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 4));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angles, 1));
    return geo;
  }, [positions, sizes, colors, angles]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame(() => {
    const pts = points.current;
    if (!pts) return;
    const ageSec = (performance.now() - born) / 1000;
    if (ageSec > lifeMs / 1000) {
      pts.visible = false;
      return;
    }
    let write = 0;
    for (let i = 0; i < FIRE_COUNT; i++) {
      const p = particles[i]!;
      const lived = ageSec - p.delay;
      if (lived < 0 || lived >= p.life) continue;
      const t = lived / p.life;
      const fade = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const drag = 1 - t * 0.4;
      positions[write * 3] = p.vx * lived * drag;
      positions[write * 3 + 1] = Math.max(0.05, p.vy * lived - 2.8 * lived * lived);
      positions[write * 3 + 2] = p.vz * lived * drag;
      sizes[write] = p.size * (0.55 + (1 - t) * 0.9) * 40;
      // Hot → ember
      const r = 1;
      const g = 0.55 + (1 - t) * 0.35;
      const b = 0.15 + (1 - t) * 0.2;
      colors[write * 4] = r;
      colors[write * 4 + 1] = g;
      colors[write * 4 + 2] = b;
      colors[write * 4 + 3] = Math.max(0, fade) * 0.95;
      angles[write] = lived * 4.5 + i;
      write++;
    }
    geometry.setDrawRange(0, write);
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.aSize!.needsUpdate = true;
    geometry.attributes.aColor!.needsUpdate = true;
    geometry.attributes.aAngle!.needsUpdate = true;
    pts.visible = write > 0;
  });

  return (
    <points
      ref={points}
      position={[x, 0.12, z]}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}
