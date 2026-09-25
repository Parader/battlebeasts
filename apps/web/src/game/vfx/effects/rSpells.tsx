import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BLOOD_PACT_CAST,
  GRAVITY_FIELD_CAST,
  TIME_FREEZE_CAST,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { createSmokePointMaterial } from "../materials/circlePoint";
import { burstElementRole } from "../engine";
import {
  killLightningCluster,
  spawnLightningSegment,
  type LightningClusterOpts,
} from "../engine/lightningArcs";

/** Lab lightning palette — cyan core, no white tip / spheres. */
const DISCHARGE_ARC: LightningClusterOpts = {
  tipGlow: 0,
  colorCore: "#67e8f9",
  colorInner: "#38bdf8",
  colorOuter: "#0ea5e9",
  colorHalo: "#0b3fc8",
};

/**
 * Static Discharge hop (chainLightning variant 2) — filament segment + tip forks.
 * No white cores, no endpoint spheres.
 */
function StaticDischargeEffect({ shot }: { shot: OneShotEffect }) {
  const hopId = useRef(-1);
  const tipIds = useRef<number[]>([]);
  const lifeMs = Math.max(180, shot.life);
  const killed = useRef(false);

  const killAll = () => {
    if (hopId.current >= 0) killLightningCluster(hopId.current);
    for (const id of tipIds.current) killLightningCluster(id);
    hopId.current = -1;
    tipIds.current = [];
    killed.current = true;
  };

  useEffect(() => {
    killed.current = false;
    const fromX = shot.originX ?? shot.x;
    const fromZ = shot.originZ ?? shot.z;
    const toX = shot.x;
    const toZ = shot.z;
    const y = shot.y ?? 1.05;
    const dist = Math.hypot(toX - fromX, toZ - fromZ);

    if (dist > 0.2) {
      hopId.current = spawnLightningSegment(fromX, y, fromZ, toX, y, toZ, {
        strands: 2,
        spreadMul: 0.32,
        jitterMul: 0.55,
        sag: 0.08,
        ...DISCHARGE_ARC,
      });
    }

    // Tiny tip sparks only — no radial ground lightning burst.
    const tipN = dist > 0.2 ? 2 : 3;
    for (let i = 0; i < tipN; i++) {
      const a = (i / tipN) * Math.PI * 2 + Math.random() * 0.4;
      const reach = 0.1 + Math.random() * 0.12;
      const endY = y + (Math.random() - 0.35) * 0.28;
      const id = spawnLightningSegment(
        toX,
        y,
        toZ,
        toX + Math.cos(a) * reach,
        endY,
        toZ + Math.sin(a) * reach,
        {
          strands: 1,
          spreadMul: 0.2,
          jitterMul: 0.35,
          sag: 0.04,
          ...DISCHARGE_ARC,
        },
      );
      if (id >= 0) tipIds.current.push(id);
    }

    return () => killAll();
    // Spawn once per shot instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.key]);

  useFrame(() => {
    if (killed.current) return;
    if (performance.now() - shot.born >= lifeMs) killAll();
  });

  return null;
}

function useBasicMat(color: string, additive = true) {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => { mat.dispose(); }, [mat]);
  return mat;
}

/** Gravity Field — dark donut shroud with clear center. */
export function GravityFieldEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const outerR = Math.max(1.5, shot.radius ?? GRAVITY_FIELD_CAST.outerRadius);
  const innerR = GRAVITY_FIELD_CAST.innerRadius;
  const lifeMs = Math.max(900, shot.life);
  const shroud = useBasicMat("#241033", false);
  const rim = useBasicMat("#A78BFA", true);
  const MOTES = 28;
  const motePos = useMemo(() => new Float32Array(MOTES * 3), []);
  const moteSize = useMemo(() => new Float32Array(MOTES), []);
  const moteAlpha = useMemo(() => new Float32Array(MOTES), []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const moteMat = useMemo(() => createSmokePointMaterial("#5B2A86"), []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.05, shot.z);
    const u = age / lifeMs;
    const appear = Math.min(1, age / 280);
    const fade = softEnvelope(u, 0.06, 0.75);
    const op = appear * fade;
    shroud.opacity = 0.42 * op;
    rim.opacity = 0.55 * op;
    if (outer.current) outer.current.scale.setScalar(outerR);
    if (inner.current) inner.current.scale.setScalar(innerR);
    const t = age * 0.001;
    for (let i = 0; i < MOTES; i++) {
      const ang = (i / MOTES) * Math.PI * 2 + t * 0.35;
      const rr = innerR + 0.2 + ((i % 5) / 5) * (outerR - innerR - 0.35);
      const cycle = (t * 0.25 + i * 0.17) % 1;
      motePos[i * 3] = Math.cos(ang) * rr * (1 - cycle * 0.12);
      motePos[i * 3 + 1] = 0.2 + cycle * 1.1;
      motePos[i * 3 + 2] = Math.sin(ang) * rr * (1 - cycle * 0.12);
      moteSize[i] = (0.06 + (i % 3) * 0.02) * 28;
      moteAlpha[i] = op * (1 - cycle) * 0.55;
    }
    moteGeo.attributes.position!.needsUpdate = true;
    moteGeo.attributes.aSize!.needsUpdate = true;
    moteGeo.attributes.aAlpha!.needsUpdate = true;
  });

  const ringInner = Math.max(0.05, innerR / outerR);
  return (
    <group ref={root} visible={false}>
      <mesh ref={outer} rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[ringInner, 1, 64]} />
        <primitive object={shroud} attach="material" />
      </mesh>
      <mesh ref={inner} rotation={[-Math.PI / 2, 0, 0]} renderOrder={19}>
        <ringGeometry args={[0.985, 1.0, 64]} />
        <primitive object={rim} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={outerR} renderOrder={20}>
        <ringGeometry args={[0.985, 1.0, 64]} />
        <primitive object={rim} attach="material" />
      </mesh>
      <points geometry={moteGeo} frustumCulled={false} renderOrder={21}>
        <primitive object={moteMat} attach="material" />
      </points>
    </group>
  );
}

const TIME_FREEZE_LATITUDES = [
  0.0,
  0.18,
  0.38,
  0.58,
  0.78,
  0.98,
  1.18,
  1.36,
] as const;

const MERIDIAN_ANGLES = [0, Math.PI / 3, (2 * Math.PI) / 3] as const;

/** Time Freeze — delicate holographic stasis dome of razor-thin latitude & meridian rings with suspended motes. */
export function TimeFreezeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const floorDisc = useRef<THREE.Mesh>(null);
  const latitudeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const meridianRefs = useRef<(THREE.Mesh | null)[]>([]);
  const radius = Math.max(1.2, shot.radius ?? TIME_FREEZE_CAST.radius);
  const domeH = Math.min(3.4, radius * 0.75);
  const lifeMs = Math.max(900, shot.life);
  const floorFill = useBasicMat("#CFFAFE", true);
  const edgeCyan = useBasicMat("#7DD3FC", true);
  const edgeLavender = useBasicMat("#C4B5FD", true);
  const MOTES = 60;
  const motePos = useMemo(() => new Float32Array(MOTES * 3), []);
  const moteSize = useMemo(() => new Float32Array(MOTES), []);
  const moteAlpha = useMemo(() => new Float32Array(MOTES), []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const moteMat = useMemo(() => createSmokePointMaterial("#E0F2FE"), []);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.03, shot.z);
    const u = age / lifeMs;
    const op = softEnvelope(u, 0.08, 0.7);
    floorFill.opacity = 0.02 * op;
    edgeCyan.opacity = 0.38 * op;
    edgeLavender.opacity = 0.32 * op;

    if (floorDisc.current) floorDisc.current.scale.setScalar(radius);

    // Update latitude rings forming the upper spherical dome contour
    for (let i = 0; i < TIME_FREEZE_LATITUDES.length; i++) {
      const mesh = latitudeRefs.current[i];
      if (!mesh) continue;
      const phi = TIME_FREEZE_LATITUDES[i]!;
      const y = Math.sin(phi) * domeH;
      const r = Math.cos(phi) * radius;
      mesh.position.y = y;
      mesh.scale.setScalar(r);
    }

    // Update vertical meridian arch rings
    for (let i = 0; i < MERIDIAN_ANGLES.length; i++) {
      const mesh = meridianRefs.current[i];
      if (!mesh) continue;
      mesh.scale.set(radius, domeH, radius);
    }

    const t = age * 0.001;
    for (let i = 0; i < MOTES; i++) {
      const frac = i / MOTES;
      const ang = frac * Math.PI * 2 + t * 0.04;
      const y = 0.2 + frac * (domeH - 0.35);
      const yNorm = Math.min(1, y / domeH);
      const rMax = Math.sqrt(Math.max(0.04, 1 - yNorm * yNorm)) * radius * 0.88;
      const rr = (0.15 + ((i % 7) / 7) * 0.8) * rMax;
      const drift = Math.sin(t * 0.25 + i * 0.4) * 0.03;
      motePos[i * 3] = Math.cos(ang) * (rr + drift);
      motePos[i * 3 + 1] = y + Math.sin(t * 0.35 + i) * 0.04;
      motePos[i * 3 + 2] = Math.sin(ang) * (rr + drift);
      moteSize[i] = (0.035 + (i % 3) * 0.015) * 26;
      moteAlpha[i] = op * (0.32 + ((i % 4) === 0 ? 0.25 : 0.12));
    }
    moteGeo.attributes.position!.needsUpdate = true;
    moteGeo.attributes.aSize!.needsUpdate = true;
    moteGeo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={root} visible={false}>
      {/* Very faint, unobtrusive translucent floor indicator */}
      <mesh ref={floorDisc} rotation={[-Math.PI / 2, 0, 0]} renderOrder={16}>
        <circleGeometry args={[1, 48]} />
        <primitive object={floorFill} attach="material" />
      </mesh>

      {/* Multiple razor-thin altitude/latitude rings forming the sphere dome contour */}
      {TIME_FREEZE_LATITUDES.map((_, i) => (
        <mesh
          key={`lat-${i}`}
          ref={(el) => {
            latitudeRefs.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={17 + (i % 2)}
        >
          <ringGeometry args={[0.995, 1.0, 64]} />
          <primitive object={i % 2 === 0 ? edgeCyan : edgeLavender} attach="material" />
        </mesh>
      ))}

      {/* Razor-thin vertical meridian rings arching over the top */}
      {MERIDIAN_ANGLES.map((angle, i) => (
        <mesh
          key={`mer-${i}`}
          ref={(el) => {
            meridianRefs.current[i] = el;
          }}
          rotation={[0, angle, 0]}
          renderOrder={19}
        >
          <ringGeometry args={[0.995, 1.0, 64]} />
          <primitive object={edgeLavender} attach="material" />
        </mesh>
      ))}

      {/* Suspended stasis particles filling the 3D spherical volume */}
      <points geometry={moteGeo} frustumCulled={false} renderOrder={20}>
        <primitive object={moteMat} attach="material" />
      </points>
    </group>
  );
}

/** Blood Pact — razor-thin expanding occult rings and concentric sacred geometry. */
export function BloodPactEffect({ shot }: { shot: OneShotEffect }) {
  const variant = shot.variant ?? 0;
  const radius = Math.max(1.5, shot.radius ?? BLOOD_PACT_CAST.allyRadius);
  const lifeMs = Math.max(820, shot.life);
  const fill = useBasicMat("#5B1118", true);
  const rim = useBasicMat("#EF4444", true);
  const rimB = useBasicMat("#F87171", true);
  const rimC = useBasicMat("#FECACA", true);
  const starMat = useBasicMat("#EF4444", true);
  const root = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const ringC = useRef<THREE.Mesh>(null);
  const orbitA = useRef<THREE.Mesh>(null);
  const orbitB = useRef<THREE.Mesh>(null);
  const starA = useRef<THREE.Mesh>(null);
  const starB = useRef<THREE.Mesh>(null);

  /** ParticleWorld owns Blood Pact's cast and impact particles. */
  useEffect(() => {
    if (variant !== 0) return;
    burstElementRole("blood", "cast", shot.x, shot.y + 0.35, shot.z);
    burstElementRole("blood", "impact", shot.x, shot.y + 0.15, shot.z);
  }, [shot.key, shot.x, shot.y, shot.z, variant]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.05, shot.z);
    const u = age / lifeMs;
    const op = softEnvelope(u, 0.06, 0.55);
    fill.opacity = (variant === 1 ? 0.025 : 0.055) * op;

    // Razor-thin primary expanding ring — delicately transparent
    const localA = 1 - Math.pow(1 - u, 3);
    const opA = softEnvelope(u, 0.04, 0.5) * op;
    rim.opacity = 0.5 * opA;
    if (ringA.current) {
      const s = variant === 1 ? 0.45 + localA * 0.4 : radius * (0.2 + localA * 0.85);
      ringA.current.scale.setScalar(s);
    }

    // Secondary delayed echo ring
    const uB = Math.max(0, (u - 0.12) / 0.88);
    const localB = 1 - Math.pow(1 - uB, 2.5);
    const opB = softEnvelope(uB, 0.05, 0.5) * op;
    rimB.opacity = 0.38 * opB;
    if (ringB.current) {
      const s = variant === 1 ? 0.35 + localB * 0.4 : radius * (0.15 + localB * 0.8);
      ringB.current.scale.setScalar(s);
    }

    // Tertiary fine ripple
    const uC = Math.max(0, (u - 0.24) / 0.76);
    const localC = 1 - Math.pow(1 - uC, 2);
    const opC = softEnvelope(uC, 0.06, 0.5) * op;
    rimC.opacity = 0.28 * opC;
    if (ringC.current) {
      const s = variant === 1 ? 0.25 + localC * 0.4 : radius * (0.1 + localC * 0.75);
      ringC.current.scale.setScalar(s);
    }

    // Concentric orbit lines & sacred star — subtle & transparent
    starMat.opacity = 0.24 * op;
    const t = age * 0.001;
    if (orbitA.current) orbitA.current.scale.setScalar(radius * 0.42);
    if (orbitB.current) orbitB.current.scale.setScalar(radius * 0.68);
    if (starA.current) {
      starA.current.rotation.z = t * 0.4;
      starA.current.scale.setScalar(radius * (0.35 + u * 0.15));
    }
    if (starB.current) {
      starB.current.rotation.z = t * 0.4 + Math.PI / 4;
      starB.current.scale.setScalar(radius * (0.35 + u * 0.15));
    }
  });

  return (
    <group ref={root} visible={false}>
      {/* Soft feathered inner core */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18} scale={variant === 1 ? 0.5 : radius * 0.45}>
        <circleGeometry args={[1, 48]} />
        <primitive object={fill} attach="material" />
      </mesh>
      {/* Razor-thin expanding primary shockwave */}
      <mesh ref={ringA} rotation={[-Math.PI / 2, 0, 0]} renderOrder={19}>
        <ringGeometry args={[0.99, 1.0, 64]} />
        <primitive object={rim} attach="material" />
      </mesh>
      {/* Razor-thin secondary echo shockwave */}
      <mesh ref={ringB} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.988, 0.998, 64]} />
        <primitive object={rimB} attach="material" />
      </mesh>
      {/* Razor-thin tertiary ripple */}
      <mesh ref={ringC} rotation={[-Math.PI / 2, 0, 0]} renderOrder={21}>
        <ringGeometry args={[0.985, 0.995, 64]} />
        <primitive object={rimC} attach="material" />
      </mesh>
      {variant === 0 && (
        <>
          {/* Thin inner concentric orbit rings */}
          <mesh ref={orbitA} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} renderOrder={22}>
            <ringGeometry args={[0.988, 1.0, 64]} />
            <primitive object={starMat} attach="material" />
          </mesh>
          <mesh ref={orbitB} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} renderOrder={23}>
            <ringGeometry args={[0.988, 1.0, 64]} />
            <primitive object={starMat} attach="material" />
          </mesh>
          {/* Inscribed 8-pointed occult star geometry */}
          <mesh ref={starA} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]} renderOrder={24}>
            <ringGeometry args={[0.985, 1.0, 4]} />
            <primitive object={starMat} attach="material" />
          </mesh>
          <mesh ref={starB} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} renderOrder={25}>
            <ringGeometry args={[0.985, 1.0, 4]} />
            <primitive object={starMat} attach="material" />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * Chain Lightning hop / Elemental Overload sky strike.
 *
 * Caster blow: none — the previous hop (or the sky) is the tell.
 * Travel: one lab lightning filament between endpoints.
 * Impact: spark burst where the bolt lands.
 * Ground: none on a hop; the sky strike's landing burst sits at the feet.
 * Status: `shocked` is worn by the victim via StatusAuraFx.
 */
export function ChainLightningEffect({ shot }: { shot: OneShotEffect }) {
  // Static Discharge / shock proc — shorter lab segments, not the main hop.
  if ((shot.variant ?? 0) === 2) {
    return <StaticDischargeEffect shot={shot} />;
  }
  return <ChainLightningBoltEffect shot={shot} />;
}

function ChainLightningBoltEffect({ shot }: { shot: OneShotEffect }) {
  const hopId = useRef(-1);
  const killed = useRef(false);
  const lifeMs = Math.max(240, shot.life);
  const isAlly = (shot.variant ?? 0) === 1;

  const killAll = () => {
    if (hopId.current >= 0) killLightningCluster(hopId.current);
    hopId.current = -1;
    killed.current = true;
  };

  useEffect(() => {
    killed.current = false;
    const fromX = shot.originX ?? shot.x;
    const fromZ = shot.originZ ?? shot.z;
    const toX = shot.x;
    const toZ = shot.z;
    const skyStrike = shot.abilityId === "elementalOverload";
    const fromY = skyStrike ? 12.5 : 1.15;
    const toY = skyStrike ? 0.12 : 1.15;
    const palette: LightningClusterOpts = isAlly
      ? {
          tipGlow: 0.35,
          colorCore: "#f0f9ff",
          colorInner: "#bae6fd",
          colorOuter: "#7dd3fc",
          colorHalo: "#0ea5e9",
        }
      : {
          tipGlow: 0.5,
          colorCore: "#f8fafc",
          colorInner: "#38bdf8",
          colorOuter: "#0ea5e9",
          colorHalo: "#0b3fc8",
        };

    hopId.current = spawnLightningSegment(fromX, fromY, fromZ, toX, toY, toZ, {
      strands: skyStrike ? 4 : 3,
      spreadMul: skyStrike ? 0.55 : 0.42,
      jitterMul: 0.7,
      sag: skyStrike ? 0.02 : 0.1,
      ...palette,
    });
    burstElementRole("lightning", "impact", toX, toY + 0.15, toZ);

    return () => killAll();
    // Spawn once per shot instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.key]);

  useFrame(() => {
    if (killed.current) return;
    if (performance.now() - shot.born >= lifeMs) killAll();
  });

  return null;
}

/** Position Swap — linked endpoints flash. */
export function PositionSwapEffect({ shot }: { shot: OneShotEffect }) {
  const variant = shot.variant ?? 0;
  const lifeMs = Math.max(420, shot.life);
  const root = useRef<THREE.Group>(null);
  const aMat = useBasicMat("#7C3AED", true);
  const bMat = useBasicMat("#67E8F9", true);
  const linkMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: "#F5F3FF",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const positions = useMemo(() => new Float32Array(6), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const u = age / lifeMs;
    const op = softEnvelope(u, 0.08, 0.5);
    aMat.opacity = 0.7 * op;
    bMat.opacity = 0.7 * op;
    linkMat.opacity = variant === 0 ? 0.8 * op : 0;
    if (variant === 0) {
      const bx = shot.originX ?? shot.x;
      const bz = shot.originZ ?? shot.z;
      positions[0] = shot.x;
      positions[1] = 1.0;
      positions[2] = shot.z;
      positions[3] = bx;
      positions[4] = 1.0;
      positions[5] = bz;
      geo.attributes.position!.needsUpdate = true;
    }
  });

  if (variant === 1) {
    return (
      <group ref={root} position={[shot.x, 0, shot.z]} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} renderOrder={20}>
          <ringGeometry args={[0.35, 0.55, 32]} />
          <primitive object={aMat} attach="material" />
        </mesh>
        <AdditiveParticleBurst
          color="#F5F3FF"
          origin={[0, 0.9, 0]}
          count={16}
          life={0.28}
          speed={1.8}
          speedSpread={1}
          size={0.08}
          sizeEnd={0.02}
          lift={1.2}
          upBias={0.5}
          gravity={2}
          fadeIn={0.05}
          stagger={0.1}
          trigger={shot.key}
        />
      </group>
    );
  }

  return (
    <group ref={root} visible={false}>
      <mesh position={[shot.x, 0.08, shot.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.4, 0.6, 32]} />
        <primitive object={aMat} attach="material" />
      </mesh>
      <mesh
        position={[shot.originX ?? shot.x, 0.08, shot.originZ ?? shot.z]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={20}
      >
        <ringGeometry args={[0.4, 0.6, 32]} />
        <primitive object={bMat} attach="material" />
      </mesh>
      <line geometry={geo} frustumCulled={false} renderOrder={21}>
        <primitive object={linkMat} attach="material" />
      </line>
    </group>
  );
}
