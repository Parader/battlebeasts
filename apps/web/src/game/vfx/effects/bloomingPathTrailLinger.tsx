import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { BLOOMING_PATH_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { getBloomingVineStreakTexture } from "../bloomingVineTexture";
import { makeBloomingVineRibbonGeo } from "./bloomingPathRibbon";
import {
  BLOOMING_HARMONY,
  BLOOMING_MAIN,
  BLOOMING_WARM,
} from "./bloomingPathPalette";

const RIBBON_WIDTH = BLOOMING_PATH_CAST.radius * 2.6;
const SPARK_COUNT = 5;

/**
 * Full vine corridor that stays after the tip despawns, then soft-fades out.
 * Spawn = originX/Z, tip end = shot.x/z.
 */
export function BloomingPathTrailLingerEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ribbonGroup = useRef<THREE.Group>(null);
  const ribbon = useRef<THREE.Mesh>(null);
  const ribbonGlow = useRef<THREE.Mesh>(null);
  const sparks = useRef<(THREE.Mesh | null)[]>([]);

  const vineTex = getBloomingVineStreakTexture();
  const ribbonGeo = useMemo(() => makeBloomingVineRibbonGeo(), []);
  const ribbonGlowGeo = useMemo(() => makeBloomingVineRibbonGeo(), []);
  const life = Math.max(800, shot.life || BLOOMING_PATH_CAST.trailLingerMs);

  const ox =
    typeof shot.originX === "number" && Number.isFinite(shot.originX)
      ? shot.originX
      : shot.x;
  const oz =
    typeof shot.originZ === "number" && Number.isFinite(shot.originZ)
      ? shot.originZ
      : shot.z;
  const dx = shot.x - ox;
  const dz = shot.z - oz;
  const length = Math.max(0.45, Math.hypot(dx, dz));
  const midX = (ox + shot.x) * 0.5;
  const midZ = (oz + shot.z) * 0.5;
  const yaw = Math.atan2(dx, dz);

  const mats = useMemo(() => {
    const mkMap = (color: THREE.Color, opacity: number) => {
      const tex = vineTex.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.rotation = Math.PI / 2;
      tex.center.set(0.5, 0.5);
      tex.repeat.set(length / 3.2, 1.15);
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
      ribbon: mkMap(BLOOMING_MAIN, 0.72),
      ribbonGlow: mkMap(BLOOMING_HARMONY, 0.4),
      sparks: Array.from({ length: SPARK_COUNT }, () => mk(BLOOMING_WARM, 0.55)),
    };
  }, [vineTex, length]);

  useEffect(() => {
    return () => {
      ribbonGeo.dispose();
      ribbonGlowGeo.dispose();
      mats.ribbon.tex.dispose();
      mats.ribbonGlow.tex.dispose();
      mats.ribbon.mat.dispose();
      mats.ribbonGlow.mat.dispose();
      for (const m of mats.sparks) m.dispose();
    };
  }, [mats, ribbonGeo, ribbonGlowGeo]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    const t = Math.min(1, Math.max(0, age / life));
    // Quick bloom in, hold most of the life, then a long soft fade.
    const a = softEnvelope(t, 0.06, 0.58);

    g.visible = a > 0.03;
    if (ribbonGroup.current) {
      ribbonGroup.current.position.set(midX, 0, midZ);
      ribbonGroup.current.rotation.y = yaw;
    }
    if (ribbon.current) {
      ribbon.current.scale.set(RIBBON_WIDTH, length, 1);
      // Keep scrolling toward tip while lingering.
      mats.ribbon.tex.offset.x = age * 0.00012;
      mats.ribbon.mat.opacity = (0.55 + Math.min(0.2, length / 14)) * a;
    }
    if (ribbonGlow.current) {
      ribbonGlow.current.scale.set(RIBBON_WIDTH * 1.4, length, 1);
      mats.ribbonGlow.tex.offset.x = age * 0.00008;
      mats.ribbonGlow.mat.opacity = 0.32 * a;
    }

    for (let i = 0; i < SPARK_COUNT; i++) {
      const mesh = sparks.current[i];
      if (!mesh) continue;
      const u = (i + 0.5) / SPARK_COUNT;
      const sx = ox + dx * u;
      const sz = oz + dz * u;
      const bob = Math.sin(age * 0.004 + i * 1.7) * 0.04;
      mesh.visible = a > 0.08;
      mesh.position.set(sx, 0.18 + bob + u * 0.08, sz);
      mesh.scale.setScalar(0.07 * a * (0.7 + 0.3 * Math.sin(age * 0.006 + i)));
      mats.sparks[i]!.opacity = 0.5 * a;
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={ribbonGroup}>
        <mesh ref={ribbonGlow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} renderOrder={23}>
          <primitive object={ribbonGlowGeo} attach="geometry" />
          <primitive object={mats.ribbonGlow.mat} attach="material" />
        </mesh>
        <mesh ref={ribbon} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} renderOrder={24}>
          <primitive object={ribbonGeo} attach="geometry" />
          <primitive object={mats.ribbon.mat} attach="material" />
        </mesh>
      </group>
      {mats.sparks.map((mat, i) => (
        <mesh
          key={`linger-spark-${i}`}
          ref={(el) => {
            sparks.current[i] = el;
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
