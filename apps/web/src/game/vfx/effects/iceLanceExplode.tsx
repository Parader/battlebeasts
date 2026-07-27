import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import { softEnvelope, smoothstep } from "../easing";
import { createEnergyBallMaterial } from "../materials/energyBall";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";

const ICE = "#7dd3fc";
const ICE_HOT = "#e0f2fe";
const ICE_DEEP = "#075985";

const FRAG_COUNT = 14;
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
 * Frost detonation — lance shatters into small ice fragments + frost bloom.
 * Fragment origin follows `shot.y` (stuck ≈1.05, grounded ≈0.28).
 */
export function IceLanceExplodeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const bloom = useRef<THREE.Group>(null);
  const fragGroup = useRef<THREE.Group>(null);
  const coreMat = useMemo(() => createEnergyBallMaterial(ICE_HOT, 0), []);
  const glowMat = useMemo(() => createEnergyBallMaterial(ICE, 0), []);
  const light = useRef<THREE.PointLight>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const fragMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: ICE_HOT,
        emissive: ICE,
        emissiveIntensity: 0.85,
        transparent: true,
        opacity: 0,
        roughness: 0.25,
        metalness: 0.05,
      }),
    [],
  );
  const lanceY =
    typeof shot.y === "number" && shot.y > 0.05 ? shot.y : DEFAULT_LANCE_Y;
  const frags = useMemo<Frag[]>(() => {
    const out: Frag[] = [];
    for (let i = 0; i < FRAG_COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      // Ground plants: more upward spray; body sticks: fuller sphere.
      const upBias = lanceY < 0.5 ? 0.55 : 0.25;
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.abs(Math.cos(phi)) * 0.45 + upBias,
        Math.sin(phi) * Math.sin(theta),
      ).normalize();
      out.push({
        dir,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
        ),
        speed: 1.6 + Math.random() * 2.4,
        size: 0.045 + Math.random() * 0.055,
        tilt: Math.random() * Math.PI,
      });
    }
    return out;
  }, [shot.key, lanceY]);

  const frost = groundPresets.iceFrost;
  const radius = shot.radius ?? frost.radius;
  const life = Math.max(850, shot.life);
  const groundOpacity = useRef(0);

  useFrame((_, dt) => {
    const age = (performance.now() - shot.born) / life;
    const amp = softEnvelope(age, 0.18, 0.5);
    const expand = smoothstep(0, 0.2, age);
    const fragFade = softEnvelope(age, 0.08, 0.55);
    groundOpacity.current = amp;
    const g = root.current;
    const b = bloom.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const scale = 0.12 + expand * (0.5 + radius * 0.4);
    if (b) b.scale.setScalar(scale);

    coreMat.opacity = amp * 0.8;
    glowMat.opacity = amp * 0.42;
    fragMat.opacity = fragFade * 0.95;
    if (light.current) light.current.intensity = amp * 3.2;

    const safeDt = Math.min(0.05, dt);
    const ageSec = age * (life / 1000);
    for (let i = 0; i < FRAG_COUNT; i++) {
      const mesh = meshes.current[i];
      const f = frags[i];
      if (!mesh || !f) continue;
      const launch = Math.min(1, age / 0.22);
      const ease = 1 - (1 - launch) * (1 - launch);
      const coast = Math.max(0, ageSec - 0.18) * f.speed * 0.55;
      const dist = ease * f.speed * 0.35 + coast * (0.45 + radius * 0.12);
      const grav = ageSec * ageSec * 1.35;
      mesh.position.set(
        f.dir.x * dist,
        lanceY + f.dir.y * dist * 0.85 - grav,
        f.dir.z * dist,
      );
      mesh.rotation.x = f.tilt + f.spin.x * ageSec;
      mesh.rotation.y = f.spin.y * ageSec;
      mesh.rotation.z = f.spin.z * ageSec;
      const s = f.size * (0.85 + expand * 0.35) * (0.75 + fragFade * 0.25);
      mesh.scale.set(s, s * (1.4 + Math.sin(f.tilt) * 0.4), s * 0.7);
      mesh.rotation.x += f.spin.x * safeDt * 0.2;
    }
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <GroundDecal
        preset={{
          ...frost,
          radius,
          lifeMs: life,
          appearEnd: 0.18,
          fadeStart: 0.5,
          spin: 0.55,
        }}
        x={0}
        y={0.02}
        z={0}
        born={shot.born}
        life={life}
        opacityMulRef={groundOpacity}
      />
      <group ref={bloom} position={[0, lanceY, 0]}>
        <mesh>
          <sphereGeometry args={[0.22, 10, 10]} />
          <primitive object={coreMat} attach="material" />
        </mesh>
        <mesh scale={1.7}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <primitive object={glowMat} attach="material" />
        </mesh>
      </group>
      <group ref={fragGroup}>
        {frags.map((f, i) => (
          <mesh
            key={i}
            ref={(el) => {
              meshes.current[i] = el;
            }}
            material={fragMat}
            position={[0, lanceY, 0]}
            scale={f.size}
          >
            <octahedronGeometry args={[1, 0]} />
          </mesh>
        ))}
      </group>
      <pointLight
        ref={light}
        position={[0, lanceY, 0]}
        color={ICE}
        intensity={0}
        distance={5.5}
        decay={2}
      />
      <AdditiveParticleBurst
        color={ICE_HOT}
        origin={[0, lanceY, 0]}
        count={16}
        life={0.5}
        speed={2.6}
        speedSpread={1.2}
        size={0.08}
        sizeEnd={0.012}
        lift={0.7}
        upBias={lanceY < 0.5 ? 0.45 : 0.25}
        fadeIn={0.15}
        stagger={0.18}
        trigger={shot.key}
      />
      <AdditiveParticleBurst
        color={ICE_DEEP}
        origin={[0, lanceY, 0]}
        count={10}
        life={0.55}
        speed={1.8}
        speedSpread={0.9}
        size={0.06}
        sizeEnd={0.01}
        lift={0.45}
        upBias={lanceY < 0.5 ? 0.35 : 0.15}
        fadeIn={0.18}
        stagger={0.22}
        trigger={`${shot.key}-b`}
      />
    </group>
  );
}
