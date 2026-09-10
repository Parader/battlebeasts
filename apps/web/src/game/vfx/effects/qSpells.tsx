import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  PURGE_PULSE_CAST,
  ROCK_WALL_CAST,
  SPELLBREAKER_CAST,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { AdditiveParticleBurst } from "../components/AdditiveParticleBurst";
import { GroundDecal } from "../components/GroundDecal";
import { createSmokePointMaterial } from "../materials/circlePoint";
import { createRuneMaterial, tickRuneMaterial } from "../materials/rune";
import { groundPresets } from "../presets/ground";

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

const PURGE_CORE = "#A9D978";
const PURGE_HOT = "#fef08a";
const PURGE_EDGE = "#3f6212";

/** Expanding cleanse wash — textured ground blot + rune + spark burst. */
export function PurgePulseEffect({ shot }: { shot: OneShotEffect }) {
  const variant = shot.variant ?? 0;
  const radius = Math.max(1.2, shot.radius ?? PURGE_PULSE_CAST.radius);
  const lifeMs = Math.max(520, shot.life);
  const rimOpacity = useRef(0);
  const fillOpacity = useRef(0);
  const runeMesh = useRef<THREE.Mesh>(null);

  const blotPreset = useMemo(
    () => ({
      ...groundPresets.frostBallAura,
      element: "earth" as const,
      shape: "circle" as const,
      colorCore: variant === 2 ? "#86efac" : PURGE_HOT,
      colorMid: PURGE_CORE,
      colorEdge: PURGE_EDGE,
      opacity: 0.82,
      additive: true,
      radius,
      lifeMs,
      ringWidth: 0.14,
      softness: 0.07,
      innerRatio: 0.1,
      breakup: 0.55,
      spin: 0.55,
      appearEnd: 0.08,
      fadeStart: 0.62,
    }),
    [radius, lifeMs, variant],
  );

  const runeMat = useMemo(
    () => createRuneMaterial(variant === 1 ? PURGE_HOT : PURGE_CORE, { opacity: 0, spokes: 7 }),
    [variant],
  );
  useEffect(
    () => () => {
      runeMat.dispose();
    },
    [runeMat],
  );

  useFrame((_, dt) => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    const env = softEnvelope(u, 0.08, 0.55);
    rimOpacity.current = env * 0.85;
    fillOpacity.current = env;
    tickRuneMaterial(runeMat, dt);
    const pulse = 0.92 + 0.08 * Math.sin(performance.now() * 0.008);
    runeMat.uniforms.uOpacity!.value = env * 0.7 * pulse;
    const rune = runeMesh.current;
    if (rune) {
      rune.visible = env > 0.02;
      rune.rotation.z += dt * 0.9;
      rune.scale.setScalar(radius * 1.7 * (0.55 + u * 0.55) * pulse);
    }
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        radius={radius}
        color={PURGE_CORE}
        hotColor={PURGE_HOT}
        fill={0.14}
        noise={0.22}
        glowWidth={0.06}
        opacity={0.7}
        opacityMulRef={rimOpacity}
      />
      <GroundDecal
        preset={blotPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.03}
        born={shot.born}
        life={lifeMs}
        radius={radius}
        growExpand
        opacityMulRef={fillOpacity}
      />
      <mesh
        ref={runeMesh}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.045, 0]}
        material={runeMat}
        visible={false}
        renderOrder={3}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      {variant === 0 && (
        <AdditiveParticleBurst
          color={PURGE_HOT}
          origin={[0, 0.25, 0]}
          count={28}
          life={0.45}
          speed={2.4}
          speedSpread={1.6}
          size={0.12}
          sizeEnd={0.02}
          lift={1.1}
          upBias={0.35}
          gravity={3.2}
          fadeIn={0.08}
          stagger={0.2}
          trigger={shot.key}
        />
      )}
    </group>
  );
}

/** Dust puff on spawn/break — persistent rocks live in RockWalls. */
export function RockWallEffect({ shot }: { shot: OneShotEffect }) {
  const variant = shot.variant ?? 0;
  if (variant === 1) return <RockWallBreakEffect shot={shot} />;
  return <RockWallSpawnDust shot={shot} />;
}

function RockWallSpawnDust({ shot }: { shot: OneShotEffect }) {
  const lifeMs = Math.max(420, shot.life);
  const fillOpacity = useRef(0);
  const w = Math.max(1.2, shot.radius ?? ROCK_WALL_CAST.wallWidth);
  const preset = useMemo(
    () => ({
      ...groundPresets.earthSlam,
      radius: w * 0.55,
      lifeMs,
      opacity: 0.7,
      appearEnd: 0.12,
      fadeStart: 0.45,
    }),
    [w, lifeMs],
  );

  useFrame(() => {
    const u = Math.min(1, (performance.now() - shot.born) / lifeMs);
    fillOpacity.current = softEnvelope(u, 0.1, 0.45);
  });

  return (
    <group position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw ?? 0, 0]}>
      <GroundDecal
        preset={preset}
        shape="circle"
        x={0}
        z={0}
        y={0.028}
        born={shot.born}
        life={lifeMs}
        radius={w * 0.55}
        opacityMulRef={fillOpacity}
      />
      <AdditiveParticleBurst
        color="#a8a29e"
        origin={[0, 0.15, 0]}
        count={18}
        life={0.4}
        speed={1.6}
        speedSpread={1.1}
        size={0.1}
        sizeEnd={0.03}
        lift={1.4}
        upBias={0.55}
        gravity={5}
        fadeIn={0.05}
        stagger={0.15}
        trigger={shot.key}
      />
    </group>
  );
}

function RockWallBreakEffect({ shot }: { shot: OneShotEffect }) {
  const lifeMs = Math.max(380, shot.life);
  const fillOpacity = useRef(0);
  const w = Math.max(1.0, shot.radius ?? ROCK_WALL_CAST.wallWidth);
  const preset = useMemo(
    () => ({
      ...groundPresets.earthSlam,
      radius: w * 0.5,
      lifeMs,
      opacity: 0.55,
      fadeStart: 0.35,
    }),
    [w, lifeMs],
  );

  useFrame(() => {
    const u = Math.min(1, (performance.now() - shot.born) / lifeMs);
    fillOpacity.current = softEnvelope(u, 0.08, 0.4);
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <GroundDecal
        preset={preset}
        shape="circle"
        x={0}
        z={0}
        y={0.028}
        born={shot.born}
        life={lifeMs}
        radius={w * 0.45}
        opacityMulRef={fillOpacity}
      />
      <AdditiveParticleBurst
        color="#d6d3d1"
        origin={[0, 0.35, 0]}
        count={22}
        life={0.38}
        speed={2.2}
        speedSpread={1.4}
        size={0.11}
        sizeEnd={0.02}
        lift={0.8}
        upBias={0.25}
        gravity={6}
        fadeIn={0.04}
        stagger={0.12}
        trigger={shot.key}
      />
    </group>
  );
}

/** Violet rune mark (v0) or root flash (v1). */
export function HexAnchorEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const variant = shot.variant ?? 0;
  const mat = useBasicMat(variant === 1 ? "#c084fc" : "#8B2DCE");
  const glow = useBasicMat("#e9d5ff");

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const life = Math.max(280, shot.life);
    const t = Math.min(1, (performance.now() - shot.born) / life);
    const a = softEnvelope(t, 0.12, 0.4);
    g.visible = a > 0.03;
    g.position.set(shot.x, variant === 1 ? 0.08 : 0.12, shot.z);
    const s = variant === 1 ? 0.55 + t * 1.1 : 0.45 + t * 0.35;
    if (ring.current) ring.current.scale.setScalar(s);
    mat.opacity = (variant === 1 ? 0.7 : 0.5) * a;
    glow.opacity = 0.28 * a;
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={21}>
        <ringGeometry args={[0.55, 0.72, 5]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={0.7} renderOrder={20}>
        <ringGeometry args={[0.2, 0.32, 5]} />
        <primitive object={glow} attach="material" />
      </mesh>
    </group>
  );
}

/**
 * Iron Guard cast one-shot — intentionally empty.
 * Lasting look is steel emissive tint via CounterStatusFx (no shell / no rings).
 */
export function IronGuardEffect(_props: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  return null;
}

/**
 * Spellbreaker zone — ground ring + rising particles that follow the caster (expand → hold → vacuum).
 * Variant 2: yellow orb fires forward with the next damaging spell.
 */
export function SpellbreakerEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const fill = useRef<THREE.Mesh>(null);
  const launchOrb = useRef<THREE.Mesh>(null);
  const maxR = Math.max(1.0, shot.radius ?? SPELLBREAKER_CAST.radius);
  const expandMs = SPELLBREAKER_CAST.expandMs;
  const holdMs = SPELLBREAKER_CAST.holdMs;
  const vacuumMs = SPELLBREAKER_CAST.vacuumMs;
  const totalMs = expandMs + holdMs + vacuumMs;
  const isLaunch = (shot.variant ?? 0) === 2;

  const mat = useBasicMat("#8B5CF6");
  const wash = useBasicMat("#7c3aed");
  const orbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#a16207",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const trailMat = useMemo(() => createSmokePointMaterial("#fde68a"), []);
  const trailPos = useMemo(() => new Float32Array(8 * 3), []);
  const trailSize = useMemo(() => new Float32Array(8), []);
  const trailAlpha = useMemo(() => new Float32Array(8), []);
  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(trailSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(trailAlpha, 1));
    return g;
  }, [trailPos, trailSize, trailAlpha]);

  const ZONE_MOTES = 22;
  const motePos = useMemo(() => new Float32Array(ZONE_MOTES * 3), []);
  const moteSize = useMemo(() => new Float32Array(ZONE_MOTES), []);
  const moteAlpha = useMemo(() => new Float32Array(ZONE_MOTES), []);
  const moteGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(moteSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(moteAlpha, 1));
    return g;
  }, [motePos, moteSize, moteAlpha]);
  const moteMat = useMemo(() => createSmokePointMaterial("#c4b5fd"), []);
  const moteSpecs = useMemo(
    () =>
      Array.from({ length: ZONE_MOTES }, (_, i) => ({
        ang: (i / ZONE_MOTES) * Math.PI * 2 + 0.15,
        radius: 0.35 + (i % 5) * 0.14,
        baseY: 0.15 + (i % 4) * 0.12,
        rise: 0.7 + (i % 3) * 0.25,
        size: 0.05 + (i % 3) * 0.02,
        speed: 0.18 + (i % 4) * 0.05,
        phase: i * 0.47,
        spin: 0.22 + (i % 3) * 0.08,
      })),
    [],
  );

  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw ?? 0 });

  useFrame(() => {
    const ownerId = shot.followOwnerId;
    if (ownerId && follow) {
      const local =
        follow.localSessionId &&
        ownerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        pose.current.x = local.x;
        pose.current.z = local.z;
        pose.current.yaw = local.yaw;
      } else {
        const pl = follow.room?.state?.players?.get(ownerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (pl && Number.isFinite(pl.x) && Number.isFinite(pl.z)) {
          pose.current.x = pl.x!;
          pose.current.z = pl.z!;
          pose.current.yaw = pl.yaw ?? pose.current.yaw;
        }
      }
    }

    const g = root.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    const life = Math.max(isLaunch ? 180 : totalMs, shot.life);
    if (age >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;

    if (isLaunch) {
      // Brief hand flash only — riding orbs on the projectile carry the rest of the way.
      const t = Math.min(1, age / Math.min(life, 180));
      const yaw = pose.current.yaw;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const x = pose.current.x + fx * 0.35;
      const z = pose.current.z + fz * 0.35;
      const y = 1.15;
      g.position.set(x, 0, z);
      const fade = softEnvelope(t, 0.05, 0.55);
      if (launchOrb.current) {
        launchOrb.current.position.set(0, y, 0);
        launchOrb.current.scale.setScalar(0.11 * (1.15 - t * 0.4));
        launchOrb.current.visible = true;
      }
      orbMat.opacity = 0.75 * fade;
      for (let i = 0; i < 8; i++) {
        const u = i / 7;
        trailPos[i * 3] = fx * u * 0.15;
        trailPos[i * 3 + 1] = y + u * 0.05;
        trailPos[i * 3 + 2] = fz * u * 0.15;
        trailSize[i] = (0.08 - u * 0.04) * 28;
        trailAlpha[i] = fade * (1 - u) * 0.45;
      }
      trailGeo.attributes.position!.needsUpdate = true;
      trailGeo.attributes.aSize!.needsUpdate = true;
      trailGeo.attributes.aAlpha!.needsUpdate = true;
      return;
    }

    g.position.set(pose.current.x, 0.06, pose.current.z);

    let radius = 0;
    let opacity = 1;
    if (age < expandMs) {
      const u = age / expandMs;
      const e = 1 - (1 - u) * (1 - u);
      radius = maxR * (0.12 + 0.88 * e);
      opacity = 0.35 + 0.65 * Math.min(1, u / 0.2);
    } else if (age < expandMs + holdMs) {
      radius = maxR;
      opacity = 1;
    } else {
      const u = Math.min(1, (age - expandMs - holdMs) / vacuumMs);
      const e = u * u;
      radius = maxR * Math.max(0.08, 1 - e);
      opacity = softEnvelope(u, 0.04, 0.45);
    }

    if (ring.current) ring.current.scale.setScalar(radius);
    if (fill.current) fill.current.scale.setScalar(radius * 0.92);
    // Subtle — player must stay readable inside the zone.
    mat.opacity = 0.28 * opacity;
    wash.opacity = 0.05 * opacity;

    const tSec = age * 0.001;
    for (let i = 0; i < ZONE_MOTES; i++) {
      const spec = moteSpecs[i]!;
      const cycle = (tSec * spec.speed + spec.phase) % 1;
      const ang = spec.ang + tSec * spec.spin;
      const r = Math.min(radius * 0.92, spec.radius * (0.55 + radius * 0.35));
      const y = spec.baseY + cycle * spec.rise;
      motePos[i * 3] = Math.cos(ang) * r;
      motePos[i * 3 + 1] = y;
      motePos[i * 3 + 2] = Math.sin(ang) * r;
      const fade =
        cycle < 0.15 ? cycle / 0.15 : cycle > 0.65 ? 1 - (cycle - 0.65) / 0.35 : 1;
      moteSize[i] = spec.size * (0.85 + cycle * 0.7) * 30;
      moteAlpha[i] = Math.max(0, fade) * opacity * 0.55;
    }
    moteGeo.attributes.position!.needsUpdate = true;
    moteGeo.attributes.aSize!.needsUpdate = true;
    moteGeo.attributes.aAlpha!.needsUpdate = true;
  });

  if (isLaunch) {
    return (
      <group ref={root} visible={false}>
        <mesh ref={launchOrb} renderOrder={24}>
          <sphereGeometry args={[1, 12, 10]} />
          <primitive object={orbMat} attach="material" />
        </mesh>
        <points geometry={trailGeo} frustumCulled={false} renderOrder={23}>
          <primitive object={trailMat} attach="material" />
        </points>
      </group>
    );
  }

  return (
    <group ref={root} visible={false}>
      <mesh ref={fill} rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <circleGeometry args={[1, 40]} />
        <primitive object={wash} attach="material" />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.88, 1.0, 48]} />
        <primitive object={mat} attach="material" />
      </mesh>
      <points geometry={moteGeo} frustumCulled={false} renderOrder={21}>
        <primitive object={moteMat} attach="material" />
      </points>
      <AdditiveParticleBurst
        color="#ddd6fe"
        origin={[0, 0.35, 0]}
        count={24}
        life={0.55}
        speed={1.6}
        speedSpread={1.2}
        size={0.1}
        sizeEnd={0.02}
        lift={1.4}
        upBias={0.55}
        gravity={2.4}
        fadeIn={0.1}
        stagger={0.35}
        trigger={shot.key}
      />
    </group>
  );
}

