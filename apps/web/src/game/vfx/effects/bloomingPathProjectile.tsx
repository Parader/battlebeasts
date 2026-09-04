import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BLOOMING_PATH_CAST } from "@battlebeasts/shared";
import { getBloomingVineStreakTexture } from "../bloomingVineTexture";
import { makeBloomingVineRibbonGeo } from "./bloomingPathRibbon";
import {
  BLOOMING_CORE,
  BLOOMING_HARMONY,
  BLOOMING_MAIN,
  BLOOMING_WARM,
} from "./bloomingPathPalette";

const TIP_Y = 0.14;
const RIBBON_WIDTH = BLOOMING_PATH_CAST.radius * 2.6;
const STREAK_COUNT = 6;
const SAMPLE_DISTANCE = 0.28;
const SPARK_LIFE_MS = 1100;

type StreakPoint = { x: number; z: number; born: number };

/**
 * Blooming Path tip + growing vine ribbon while the projectile lives.
 * Post-despawn linger is a separate one-shot (`BloomingPathTrailLingerEffect`).
 */
export function BloomingPathProjectileEffect({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const ribbonGroup = useRef<THREE.Group>(null);
  const ribbon = useRef<THREE.Mesh>(null);
  const ribbonGlow = useRef<THREE.Mesh>(null);
  const tip = useRef<THREE.Mesh>(null);
  const tipGlow = useRef<THREE.Mesh>(null);
  const streakMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const vineTex = getBloomingVineStreakTexture();
  const ribbonGeo = useMemo(() => makeBloomingVineRibbonGeo(), []);
  const ribbonGlowGeo = useMemo(() => makeBloomingVineRibbonGeo(), []);

  const mats = useMemo(() => {
    const mkMap = (color: THREE.Color, opacity: number) => {
      const tex = vineTex.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.rotation = Math.PI / 2;
      tex.center.set(0.5, 0.5);
      tex.repeat.set(1, 1);
      return {
        tex,
        mat: new THREE.MeshBasicMaterial({
          map: tex,
          color: color.clone(),
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          vertexColors: true,
        }),
      };
    };
    const mk = (color: THREE.Color, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
    return {
      ribbon: mkMap(BLOOMING_MAIN, 0.75),
      ribbonGlow: mkMap(BLOOMING_HARMONY, 0.42),
      tip: mk(BLOOMING_CORE, 0.95),
      tipGlow: mk(BLOOMING_WARM, 0.55),
      streaks: Array.from({ length: STREAK_COUNT }, () => mk(BLOOMING_WARM, 0.7)),
    };
  }, [vineTex]);

  useEffect(() => {
    return () => {
      ribbonGeo.dispose();
      ribbonGlowGeo.dispose();
      mats.ribbon.tex.dispose();
      mats.ribbonGlow.tex.dispose();
      mats.ribbon.mat.dispose();
      mats.ribbonGlow.mat.dispose();
      mats.tip.dispose();
      mats.tipGlow.dispose();
      for (const m of mats.streaks) m.dispose();
    };
  }, [mats, ribbonGeo, ribbonGlowGeo]);

  const renderPos = useRef(new THREE.Vector3());
  const spawn = useRef({ x: 0, z: 0 });
  const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
  const seeded = useRef(false);
  const age = useRef(0);
  const distAcc = useRef(0);
  const streakPts = useRef<StreakPoint[]>([]);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const p = room.state?.projectiles?.get(id) as
      | { x: number; z: number; vx?: number; vz?: number }
      | undefined;
    const g = root.current;
    if (!g) return;

    if (!p) {
      g.visible = false;
      for (const mesh of streakMeshes.current) {
        if (mesh) mesh.visible = false;
      }
      seeded.current = false;
      streakPts.current = [];
      distAcc.current = 0;
      age.current = 0;
      return;
    }

    const now = performance.now();
    const safeDt = Math.min(0.05, Math.max(0, dt));
    g.visible = true;
    age.current += dt;

    const vx = p.vx ?? 0;
    const vz = p.vz ?? 0;
    const prevX = renderPos.current.x;
    const prevZ = renderPos.current.z;

    if (!seeded.current) {
      renderPos.current.set(p.x, TIP_Y, p.z);
      spawn.current = { x: p.x, z: p.z };
      lastServer.current = { x: p.x, z: p.z, vx, vz };
      seeded.current = true;
      streakPts.current = [];
      distAcc.current = 0;
    } else {
      const serverMoved =
        Math.hypot(p.x - lastServer.current.x, p.z - lastServer.current.z) > 0.001;
      if (serverMoved) {
        lastServer.current = { x: p.x, z: p.z, vx, vz };
      }
      renderPos.current.x += lastServer.current.vx * safeDt;
      renderPos.current.z += lastServer.current.vz * safeDt;
      renderPos.current.x += (p.x - renderPos.current.x) * Math.min(1, safeDt * 14);
      renderPos.current.z += (p.z - renderPos.current.z) * Math.min(1, safeDt * 14);
      renderPos.current.y = TIP_Y;
    }

    const step = Math.hypot(renderPos.current.x - prevX, renderPos.current.z - prevZ);
    distAcc.current += step;
    while (distAcc.current >= SAMPLE_DISTANCE) {
      distAcc.current -= SAMPLE_DISTANCE;
      streakPts.current.unshift({
        x: renderPos.current.x,
        z: renderPos.current.z,
        born: now,
      });
      if (streakPts.current.length > STREAK_COUNT) streakPts.current.pop();
    }

    if (tip.current) {
      tip.current.visible = true;
      tip.current.position.copy(renderPos.current);
      tip.current.scale.set(0.18, 0.11, 0.32);
      if (Math.hypot(vx, vz) > 0.05) {
        lookTarget.set(renderPos.current.x + vx, TIP_Y, renderPos.current.z + vz);
        tip.current.lookAt(lookTarget);
      }
      mats.tip.opacity = 0.95;
    }
    if (tipGlow.current) {
      const pulse = 0.85 + Math.sin(age.current * 12) * 0.15;
      tipGlow.current.visible = true;
      tipGlow.current.position.copy(renderPos.current);
      tipGlow.current.scale.setScalar(0.42 * pulse);
      mats.tipGlow.opacity = 0.55 * pulse;
    }

    const dx = renderPos.current.x - spawn.current.x;
    const dz = renderPos.current.z - spawn.current.z;
    const length = Math.max(0.4, Math.hypot(dx, dz));
    const midX = (spawn.current.x + renderPos.current.x) * 0.5;
    const midZ = (spawn.current.z + renderPos.current.z) * 0.5;
    const yaw = Math.atan2(dx, dz);

    if (ribbonGroup.current) {
      ribbonGroup.current.visible = true;
      ribbonGroup.current.position.set(midX, 0, midZ);
      ribbonGroup.current.rotation.y = yaw;
    }
    if (ribbon.current) {
      ribbon.current.scale.set(RIBBON_WIDTH, length, 1);
      mats.ribbon.tex.repeat.set(length / 3.2, 1.15);
      // Scroll toward tip (growth direction).
      mats.ribbon.tex.offset.x = age.current * 0.85;
      mats.ribbon.mat.opacity = 0.58 + Math.min(0.22, length / 14);
    }
    if (ribbonGlow.current) {
      ribbonGlow.current.scale.set(RIBBON_WIDTH * 1.4, length, 1);
      mats.ribbonGlow.tex.repeat.set(length / 3.8, 1.3);
      mats.ribbonGlow.tex.offset.x = age.current * 0.55;
      mats.ribbonGlow.mat.opacity = 0.34;
    }

    for (let i = 0; i < STREAK_COUNT; i++) {
      const mesh = streakMeshes.current[i];
      const pt = streakPts.current[i];
      if (!mesh) continue;
      if (!pt) {
        mesh.visible = false;
        continue;
      }
      const u = Math.min(1, (now - pt.born) / SPARK_LIFE_MS);
      const fade = 1 - u;
      mesh.visible = fade > 0.06;
      mesh.position.set(pt.x, 0.2 + u * 0.35, pt.z);
      mesh.scale.setScalar(0.08 * fade);
      mats.streaks[i]!.opacity = 0.7 * fade;
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={ribbonGroup} visible={false}>
        <mesh ref={ribbonGlow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={23}>
          <primitive object={ribbonGlowGeo} attach="geometry" />
          <primitive object={mats.ribbonGlow.mat} attach="material" />
        </mesh>
        <mesh ref={ribbon} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} renderOrder={24}>
          <primitive object={ribbonGeo} attach="geometry" />
          <primitive object={mats.ribbon.mat} attach="material" />
        </mesh>
      </group>
      <mesh ref={tipGlow} renderOrder={27}>
        <sphereGeometry args={[1, 10, 10]} />
        <primitive object={mats.tipGlow} attach="material" />
      </mesh>
      <mesh ref={tip} renderOrder={28}>
        <sphereGeometry args={[1, 8, 8]} />
        <primitive object={mats.tip} attach="material" />
      </mesh>
      {mats.streaks.map((mat, i) => (
        <mesh
          key={`spark-${i}`}
          ref={(el) => {
            streakMeshes.current[i] = el;
          }}
          renderOrder={26}
          visible={false}
        >
          <octahedronGeometry args={[1, 0]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
