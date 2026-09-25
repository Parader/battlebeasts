import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope, smoothstep } from "../easing";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import {
  createLabGroundMarkMaterial,
  tickLabGroundMark,
} from "../engine/labShapeMaterials";
import { createIceShardGeometry } from "../engine/iceCrystalGeometry";
import { GEO_OCTA, GEO_PLANE_1 } from "../sharedGeo";
import { useSpellLight } from "../spellLights";

const ICE_HOT = "#f0f9ff";
const ICE_MID = "#e0f2fe";
const ICE_EDGE = "#79b6dd";
const ICE_CRYSTAL = "#8adaff";
const ICE_DEEP = "#075985";

const FLY_COUNT = 6;
const DEFAULT_LANCE_Y = 0.85;

/** Lab frost sheet colors (spell-lab GroundFoot frost). */
const FROST_COLORS = { hot: ICE_HOT, mid: ICE_MID, edge: ICE_EDGE };

/** Ankle rubble layout — same language as LabShapePreview GroundDebris frost. */
const GROUND_SHARDS = [
  { seed: 3, p: [0.42, 0.22] as const, s: [0.22, 0.14, 0.22] as const, yaw: 0.4 },
  { seed: 7, p: [-0.48, -0.12] as const, s: [0.18, 0.11, 0.18] as const, yaw: -0.8 },
  { seed: 11, p: [0.12, -0.52] as const, s: [0.2, 0.13, 0.2] as const, yaw: 1.1 },
  { seed: 15, p: [-0.22, 0.48] as const, s: [0.16, 0.1, 0.16] as const, yaw: 0.2 },
  { seed: 19, p: [0.55, -0.28] as const, s: [0.14, 0.09, 0.14] as const, yaw: -1.4 },
  { seed: 23, p: [-0.55, 0.3] as const, s: [0.15, 0.1, 0.15] as const, yaw: 0.9 },
] as const;

/** Shared shard geos — upload once, reuse across every explode. */
const SHARED_GROUND_SHARD_GEOS = GROUND_SHARDS.map((sp) => createIceShardGeometry(sp.seed, 5));

type FlyFrag = {
  dir: THREE.Vector3;
  spin: THREE.Vector3;
  speed: number;
  size: number;
  tilt: number;
};

/**
 * Ice Lance detonation — spell-lab frost impact:
 * powder frost mark + planted ice shards + crystal burst (no circular ground ring).
 */
export function IceLanceExplodeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Mesh>(null);
  const burst = useRef<THREE.Group>(null);
  const light = useSpellLight();
  const flyMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const radius = shot.radius ?? 2.0;
  const life = Math.max(800, shot.life);
  const lanceY =
    typeof shot.y === "number" && shot.y > 0.05 ? shot.y : DEFAULT_LANCE_Y;

  const frostMat = useMemo(
    () => createLabGroundMarkMaterial("frost", FROST_COLORS, { opacity: 0.95, additive: false }),
    [],
  );
  const iceMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ICE_CRYSTAL,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const flyMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ICE_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const flyFrags = useMemo<FlyFrag[]>(() => {
    const out: FlyFrag[] = [];
    for (let i = 0; i < FLY_COUNT; i++) {
      const a = (i / FLY_COUNT) * Math.PI * 2 + 0.15;
      const upBias = lanceY < 0.5 ? 0.55 : 0.32;
      out.push({
        dir: new THREE.Vector3(
          Math.cos(a) * 0.85,
          upBias + (i % 3) * 0.08,
          Math.sin(a) * 0.85,
        ).normalize(),
        spin: new THREE.Vector3((i % 3) * 4 - 4, ((i + 1) % 3) * 5 - 5, ((i + 2) % 3) * 3 - 3),
        speed: 2.2 + (i % 3) * 0.4,
        size: 0.05 + (i % 2) * 0.02,
        tilt: i * 0.5,
      });
    }
    return out;
  }, [shot.key, lanceY]);

  useEffect(
    () => () => {
      frostMat.dispose();
      iceMat.dispose();
      flyMat.dispose();
    },
    [frostMat, iceMat, flyMat],
  );

  useFrame((_, dt) => {
    const age = (performance.now() - shot.born) / life;
    const amp = softEnvelope(age, 0.12, 0.52);
    const expand = smoothstep(0, 0.16, age);
    const fragFade = softEnvelope(age, 0.06, 0.5);
    const g = root.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      light.off();
      return;
    }
    g.visible = true;

    tickLabGroundMark(frostMat, dt);
    frostMat.uniforms.uOpacity!.value = 0.95 * amp;
    iceMat.opacity = amp * 0.88;
    flyMat.opacity = fragFade * 0.85;
    light.emit(shot.x, Math.max(0.35, lanceY * 0.55), shot.z, ICE_MID, amp * 2.4, 4.8);

    if (mark.current) {
      // Grow the frost powder sheet with the blast (no spin).
      const s = radius * (0.55 + expand * 0.55);
      mark.current.scale.set(s, s, 1);
    }
    if (burst.current) {
      burst.current.scale.setScalar(0.55 + expand * 0.9);
      burst.current.visible = amp > 0.05;
      burst.current.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (mat?.transparent && mat !== flyMat) {
          mat.opacity = 0.65 * amp * (1 - age * 0.5);
        }
      });
    }

    const ageSec = age * (life / 1000);
    const safeDt = Math.min(0.05, dt);
    for (let i = 0; i < FLY_COUNT; i++) {
      const mesh = flyMeshes.current[i];
      const f = flyFrags[i];
      if (!mesh || !f) continue;
      const launch = Math.min(1, age / 0.18);
      const ease = 1 - (1 - launch) * (1 - launch);
      const coast = Math.max(0, ageSec - 0.12) * f.speed * 0.5;
      const dist = ease * f.speed * 0.4 + coast * (0.4 + radius * 0.1);
      const grav = ageSec * ageSec * 1.4;
      mesh.position.set(
        f.dir.x * dist,
        lanceY + f.dir.y * dist * 0.85 - grav,
        f.dir.z * dist,
      );
      mesh.rotation.x = f.tilt + f.spin.x * ageSec;
      mesh.rotation.y = f.spin.y * ageSec;
      mesh.rotation.z = f.spin.z * ageSec;
      const s = f.size * (0.9 + expand * 0.35) * (0.7 + fragFade * 0.3);
      mesh.scale.set(s * 0.7, s * 1.55, s * 0.7);
      mesh.rotation.x += f.spin.x * safeDt * 0.1;
    }
  });

  const markScale = radius;

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      {/* Spell-lab frost powder mark — irregular lobes, not a circle ring. */}
      <mesh
        ref={mark}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.04, 0]}
        scale={[markScale * 0.55, markScale * 0.55, 1]}
        renderOrder={32}
        geometry={GEO_PLANE_1}
      >
        <primitive object={frostMat} attach="material" />
      </mesh>

      {/* Planted ice shard rubble on the frost sheet */}
      {GROUND_SHARDS.map((sh, i) => (
        <mesh
          key={i}
          geometry={SHARED_GROUND_SHARD_GEOS[i]}
          material={iceMat}
          position={[sh.p[0] * radius * 0.45, 0.01, sh.p[1] * radius * 0.45]}
          rotation={[0.05, sh.yaw, 0.08]}
          scale={[
            sh.s[0] * radius * 0.55,
            sh.s[1] * radius * 0.55,
            sh.s[2] * radius * 0.55,
          ]}
          castShadow={false}
          renderOrder={33}
        />
      ))}

      {/* Lab frost burst — upright crystal accents */}
      <group ref={burst} position={[0, 0, 0]}>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          const r = 0.28 * Math.min(1.2, radius * 0.35);
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * r, lanceY * 0.35 + 0.08, Math.sin(a) * r]}
              rotation={[0.3, a, 0.1]}
              scale={[0.055, 0.16, 0.055]}
              renderOrder={34}
            >
              <octahedronGeometry args={[1, 0]} />
              <meshBasicMaterial
                color={ICE_HOT}
                transparent
                opacity={0.7}
                depthWrite={false}
                toneMapped={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          );
        })}
      </group>

      {/* Flying crystal shards */}
      {flyFrags.map((f, i) => (
        <mesh
          key={i}
          ref={(el) => {
            flyMeshes.current[i] = el;
          }}
          material={flyMat}
          geometry={GEO_OCTA}
          position={[0, lanceY, 0]}
          scale={f.size}
        />
      ))}

      {/* Glitter plume + cold mist (lab frost ground accents) */}
      <AdditiveParticleBurst
        color={ICE_HOT}
        origin={[0, 0.35, 0]}
        count={10}
        life={0.5}
        speed={1.8}
        speedSpread={1.2}
        size={0.07}
        sizeEnd={0.012}
        lift={0.9}
        upBias={0.55}
        gravity={0.4}
        fadeIn={0.1}
        stagger={0.2}
        trigger={shot.key}
      />
      <AdditiveParticleBurst
        color={ICE_EDGE}
        origin={[0, 0.12, 0]}
        count={7}
        life={0.6}
        speed={1.1}
        speedSpread={0.7}
        size={0.14}
        sizeEnd={0.04}
        lift={0.35}
        upBias={0.25}
        gravity={-0.15}
        fadeIn={0.2}
        stagger={0.3}
        trigger={`${shot.key}-mist`}
      />
      <AdditiveParticleBurst
        color={ICE_DEEP}
        origin={[0, lanceY, 0]}
        count={8}
        life={0.4}
        speed={2.4}
        speedSpread={1.0}
        size={0.05}
        sizeEnd={0.01}
        lift={0.5}
        upBias={lanceY < 0.5 ? 0.4 : 0.2}
        fadeIn={0.08}
        stagger={0.14}
        trigger={`${shot.key}-core`}
      />
    </group>
  );
}
