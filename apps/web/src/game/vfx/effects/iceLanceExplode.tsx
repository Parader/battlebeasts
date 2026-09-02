import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope, smoothstep } from "../easing";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { GEO_OCTA } from "../sharedGeo";
import { useSpellLight } from "../spellLights";

const ICE = "#7dd3fc";
const ICE_HOT = "#e0f2fe";
const ICE_DEEP = "#075985";

/** Lightweight shards — MeshBasic, shared octa geo. */
const FRAG_COUNT = 6;
/** Fallback when FX omits height (mid body). */
const DEFAULT_LANCE_Y = 0.85;

type Frag = {
  dir: THREE.Vector3;
  spin: THREE.Vector3;
  speed: number;
  size: number;
  tilt: number;
};

/**
 * Frost detonation — frost bloom + a few ice shards.
 * Fragment origin follows `shot.y` (stuck ≈1.05, grounded ≈0.28).
 */
export function IceLanceExplodeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const lightAt = useRef<THREE.Object3D>(null);
  const light = useSpellLight();
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const fragMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: ICE_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: true,
      }),
    [],
  );
  const lanceY =
    typeof shot.y === "number" && shot.y > 0.05 ? shot.y : DEFAULT_LANCE_Y;
  const frags = useMemo<Frag[]>(() => {
    const out: Frag[] = [];
    for (let i = 0; i < FRAG_COUNT; i++) {
      const u = (i + 0.5) / FRAG_COUNT;
      const v = (i * 0.37) % 1;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const upBias = lanceY < 0.5 ? 0.55 : 0.25;
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.abs(Math.cos(phi)) * 0.45 + upBias,
        Math.sin(phi) * Math.sin(theta),
      ).normalize();
      out.push({
        dir,
        spin: new THREE.Vector3(
          (i % 3) * 4 - 4,
          ((i + 1) % 3) * 4 - 4,
          ((i + 2) % 3) * 4 - 4,
        ),
        speed: 1.8 + (i % 3) * 0.5,
        size: 0.05 + (i % 2) * 0.025,
        tilt: i * 0.7,
      });
    }
    return out;
  }, [shot.key, lanceY]);

  const frost = groundPresets.iceFrost;
  const radius = shot.radius ?? frost.radius;
  const life = Math.max(700, shot.life);
  const groundOpacity = useRef(0);

  useFrame((_, dt) => {
    const age = (performance.now() - shot.born) / life;
    const amp = softEnvelope(age, 0.16, 0.48);
    const expand = smoothstep(0, 0.18, age);
    const fragFade = softEnvelope(age, 0.08, 0.5);
    groundOpacity.current = amp;
    const g = root.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    fragMat.opacity = fragFade * 0.9;
    light.emitAt(lightAt.current, ICE, amp * 2.2, 4.5);

    const safeDt = Math.min(0.05, dt);
    const ageSec = age * (life / 1000);
    for (let i = 0; i < FRAG_COUNT; i++) {
      const mesh = meshes.current[i];
      const f = frags[i];
      if (!mesh || !f) continue;
      const launch = Math.min(1, age / 0.2);
      const ease = 1 - (1 - launch) * (1 - launch);
      const coast = Math.max(0, ageSec - 0.16) * f.speed * 0.5;
      const dist = ease * f.speed * 0.32 + coast * (0.4 + radius * 0.1);
      const grav = ageSec * ageSec * 1.2;
      mesh.position.set(
        f.dir.x * dist,
        lanceY + f.dir.y * dist * 0.85 - grav,
        f.dir.z * dist,
      );
      mesh.rotation.x = f.tilt + f.spin.x * ageSec;
      mesh.rotation.y = f.spin.y * ageSec;
      mesh.rotation.z = f.spin.z * ageSec;
      const s = f.size * (0.85 + expand * 0.3) * (0.75 + fragFade * 0.25);
      mesh.scale.set(s, s * 1.35, s * 0.7);
      mesh.rotation.x += f.spin.x * safeDt * 0.15;
    }
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <GroundDecal
        preset={{
          ...frost,
          radius,
          lifeMs: life,
          appearEnd: 0.16,
          fadeStart: 0.48,
          spin: 0.45,
        }}
        x={0}
        y={0.02}
        z={0}
        born={shot.born}
        life={life}
        opacityMulRef={groundOpacity}
      />
      <group>
        {frags.map((f, i) => (
          <mesh
            key={i}
            ref={(el) => {
              meshes.current[i] = el;
            }}
            material={fragMat}
            geometry={GEO_OCTA}
            position={[0, lanceY, 0]}
            scale={f.size}
          />
        ))}
      </group>
      <object3D ref={lightAt} position={[0, lanceY, 0]} />
      <AdditiveParticleBurst
        color={ICE_HOT}
        origin={[0, lanceY, 0]}
        count={12}
        life={0.45}
        speed={2.4}
        speedSpread={1.0}
        size={0.07}
        sizeEnd={0.012}
        lift={0.65}
        upBias={lanceY < 0.5 ? 0.45 : 0.25}
        fadeIn={0.12}
        stagger={0.16}
        trigger={shot.key}
      />
      <AdditiveParticleBurst
        color={ICE_DEEP}
        origin={[0, lanceY, 0]}
        count={8}
        life={0.5}
        speed={1.6}
        speedSpread={0.8}
        size={0.055}
        sizeEnd={0.01}
        lift={0.4}
        upBias={lanceY < 0.5 ? 0.35 : 0.15}
        fadeIn={0.16}
        stagger={0.2}
        trigger={`${shot.key}-b`}
      />
    </group>
  );
}
