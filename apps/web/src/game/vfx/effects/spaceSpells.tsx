/** ParticleWorld-backed movement trails and impact motes. */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  BULWARK_CHARGE_CAST,
  REBOUND_CAST,
  TELEPORT_SLAM_CAST,
  VERDANT_LEAP_CAST,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { createTrailMaterial } from "../materials/trailMaterial";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { getWindStreakTexture } from "../windStreakTexture";
import { burstElementRole, spawnElementRole, type ElementHandle } from "../engine";

function useMats(colors: THREE.Color[]) {
  return useMemo(
    () =>
      colors.map(
        (c) =>
          new THREE.MeshBasicMaterial({
            color: c.clone(),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            side: THREE.DoubleSide,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/** Verdant Leap out-of-range ring (variant 3) — same language as Soul Relay. */
export function VerdantLeapOutOfRangeEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const range = Math.max(2, shot.radius ?? VERDANT_LEAP_CAST.range);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ef4444",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(400, shot.life ?? 700);
    if (ms >= life) {
      g.visible = false;
      mat.opacity = 0;
      return;
    }
    g.visible = true;
    const age = ms / life;
    const flash = softEnvelope(age, 0.18, 0.38);
    mat.opacity = 0.34 * flash;
    const s = range * (0.97 + flash * 0.03);
    g.scale.set(s, s, s);
    g.position.set(shot.x, 0.03, shot.z);
  });

  return (
    <group ref={root} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.92, 1.0, 48]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** Verdant Leap arrival bloom / heal pulse. */
export function VerdantLeapEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const mats = useMats([
    new THREE.Color("#A9D978"),
    new THREE.Color("#6EE7B7"),
  ]);

  useEffect(() => {
    burstElementRole("heal", "impact", shot.x, 0.18, shot.z);
  }, [shot.key, shot.x, shot.z]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const t = Math.min(1, (performance.now() - shot.born) / Math.max(200, shot.life));
    const a = softEnvelope(t, 0.12, 0.45);
    g.visible = a > 0.04;
    g.position.set(shot.x, 0.08, shot.z);
    if (ring.current) {
      ring.current.scale.setScalar(0.4 + t * 1.6);
      mats[0]!.opacity = 0.55 * a;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <ringGeometry args={[0.35, 0.55, 24]} />
        <primitive object={mats[0]!} attach="material" />
      </mesh>
    </group>
  );
}

/** Soft ParticleWorld streak trailing Verdant Leap. */
export function VerdantLeapTrailEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const trail = useRef<ElementHandle | null>(null);

  useEffect(() => {
    const handle = spawnElementRole("heal", "trail", shot.x, 0.65, shot.z);
    handle.setRateScale(0);
    trail.current = handle;
    return () => {
      handle.kill();
      if (trail.current === handle) trail.current = null;
    };
  }, [shot.key, shot.x, shot.z]);

  useFrame(() => {
    const handle = trail.current;
    if (!handle) return;
    const age = performance.now() - shot.born;
    const lifeMs = Math.max(420, shot.life);
    if (age >= lifeMs) {
      handle.kill();
      trail.current = null;
      return;
    }

    const followUntil = VERDANT_LEAP_CAST.travelDurationMs + 80;
    let x = shot.x;
    let z = shot.z;
    if (age <= followUntil && shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        x = local.x;
        z = local.z;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
        }
      }
    }

    const fade = age <= followUntil ? Math.min(1, (lifeMs - age) / 140) : 0;
    handle.setPose(x, 0.65, z);
    handle.setRateScale(fade);
  });

  return null;
}

/**
 * Holy ParticleWorld wake trailing Bulwark Charge.
 */
export function BulwarkChargeEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const trail = useRef<ElementHandle | null>(null);

  useEffect(() => {
    const handle = spawnElementRole("holy", "trail", shot.x, 0.55, shot.z);
    handle.setRateScale(0);
    trail.current = handle;
    return () => {
      handle.kill();
      if (trail.current === handle) trail.current = null;
    };
  }, [shot.key, shot.x, shot.z]);

  useFrame(() => {
    const handle = trail.current;
    if (!handle) return;
    const age = performance.now() - shot.born;
    const lifeMs = Math.max(420, shot.life);
    if (age >= lifeMs) {
      handle.kill();
      trail.current = null;
      return;
    }

    const followUntil = BULWARK_CHARGE_CAST.travelDurationMs + 80;
    let x = shot.x;
    let z = shot.z;
    if (age <= followUntil && shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        x = local.x;
        z = local.z;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
        }
      }

    }

    const fade = age <= followUntil ? Math.min(1, (lifeMs - age) / 140) : 0;
    handle.setPose(x, 0.55, z);
    handle.setRateScale(fade);
  });

  return null;
}

/** Predator Step — no sphere pop; cloak + haste statuses carry the read. */
export function PredatorStepEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const mats = useMats([new THREE.Color("#5C1B28")]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const t = Math.min(1, (performance.now() - shot.born) / Math.max(180, shot.life));
    const a = softEnvelope(t, 0.08, 0.5);
    g.visible = a > 0.03;
    g.position.set(shot.x, 0.05, shot.z);
    mats[0]!.opacity = 0.22 * a;
    g.scale.setScalar(0.4 + t * 0.5);
  });

  return (
    <group ref={root} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.25, 0.42, 20]} />
        <primitive object={mats[0]!} attach="material" />
      </mesh>
    </group>
  );
}

/** Rebound frontal peel — Gust-style wind/smoke over a wide frontal cone. */
export function ReboundEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const sheets = useRef<(THREE.Mesh | null)[]>([]);
  const trailMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const progress = useRef(0);
  const smokeOpacity = useRef(0);
  const range = shot.radius ?? REBOUND_CAST.coneRange;
  const halfAngle = (REBOUND_CAST.coneAngleDeg * Math.PI) / 180 / 2;
  const windTex = getWindStreakTexture();
  const smoke = useMemo(
    () => ({
      ...groundPresets.windSmoke,
      radius: range,
      halfAngle,
      lifeMs: 620,
      opacity: 0.48,
      breakup: 0.5,
      fadeStart: 0.4,
    }),
    [range, halfAngle],
  );

  const sheetMats = useMemo(() => {
    return [0, 1, 2, 3].map((i) => {
      const tex = windTex.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.offset.set(Math.random(), Math.random() * 0.2);
      tex.repeat.set(1.15 + i * 0.1, 0.55);
      tex.needsUpdate = true;
      return new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(i % 2 === 0 ? "#94a3b8" : "#64748b"),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    });
  }, [windTex]);

  const AIR_COUNT = 8;
  const airSheets = useMemo(
    () =>
      Array.from({ length: AIR_COUNT }, (_, i) => {
        const t = (i + 0.5) / AIR_COUNT;
        return {
          angle: (t - 0.5) * 2 * halfAngle,
          y: 0.45 + (i % 3) * 0.18,
          speed: 7.5 + Math.random() * 3,
          len: 0.28 + Math.random() * 0.12,
          width: 0.55 + Math.random() * 0.25,
          height: 0.16 + Math.random() * 0.08,
          delay: Math.random() * 0.04,
          curl: (i % 2 === 0 ? 1 : -1) * (0.05 + Math.random() * 0.08),
        };
      }),
    [halfAngle],
  );
  const trailMats = useMemo(
    () =>
      airSheets.map(() =>
        createTrailMaterial("#e8eef5", { opacity: 0.34, head: 0.35 }),
      ),
    [airSheets],
  );

  useEffect(() => {
    burstElementRole("wind", "impact", shot.x, 0.42, shot.z);
    return () => {
      for (const m of sheetMats) {
        m.map?.dispose();
        m.dispose();
      }
      for (const m of trailMats) m.dispose();
    };
  }, [sheetMats, shot.key, shot.x, shot.z, trailMats]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = Math.max(520, shot.life);
    if (ms >= life) {
      g.visible = false;
      smokeOpacity.current = 0;
      return;
    }
    g.visible = true;
    g.position.set(shot.x, 0.04, shot.z);
    g.rotation.y = shot.yaw;

    const t = ms / life;
    const a = softEnvelope(t, 0.06, 0.42);
    const expand = 0.78 + t * 0.32;
    progress.current = expand;
    smokeOpacity.current = a * (1 - t * 0.25);

    for (let i = 0; i < sheetMats.length; i++) {
      const mesh = sheets.current[i];
      const mat = sheetMats[i]!;
      if (!mesh) continue;
      const along = range * (0.28 + i * 0.14 + t * 0.45);
      const width = range * (0.32 + i * 0.07) * Math.tan(halfAngle) * 2.4;
      mesh.position.set(Math.sin((i - 1.5) * 0.12) * 0.2, 0.3 + i * 0.08, along * 0.55);
      mesh.scale.set(Math.max(0.55, width), 1, along * 0.85);
      mesh.rotation.x = -Math.PI / 2.3;
      if (mat.map) mat.map.offset.x = (mat.map.offset.x + dt * (1.8 + i * 0.3)) % 1;
      mat.opacity = a * (0.4 - i * 0.05) * (1 - t * 0.28);
    }

    const sinceSec = ms / 1000;
    for (let i = 0; i < AIR_COUNT; i++) {
      const b = airSheets[i]!;
      const mesh = trailMeshes.current[i];
      const trail = trailMats[i];
      if (!mesh || !trail) continue;
      const age = sinceSec - b.delay;
      if (age < 0 || age > 0.32) {
        mesh.visible = false;
        continue;
      }
      const lifeU = age / 0.32;
      const dist = 0.25 + age * b.speed;
      const yaw = b.angle + b.curl * lifeU;
      mesh.visible = true;
      mesh.position.set(Math.sin(yaw) * dist, b.y + age * 0.2, Math.cos(yaw) * dist);
      mesh.rotation.set(0, yaw, 0);
      const flare = 1 + lifeU * 0.4;
      mesh.scale.set(b.width * flare, b.height, b.len * (0.85 + lifeU * 0.3));
      const fade =
        lifeU < 0.12 ? lifeU / 0.12 : Math.max(0, 1 - (lifeU - 0.12) / 0.88);
      trail.uniforms.uOpacity!.value = 0.36 * fade * fade * a;
    }

  });

  return (
    <group ref={root} visible={false}>
      <GroundDecal
        preset={smoke}
        shape="cone"
        x={0}
        z={0}
        y={0.03}
        radius={range}
        growExpand
        progressRef={progress}
        opacityMulRef={smokeOpacity}
      />
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={`wind-${i}`}
          ref={(m) => {
            sheets.current[i] = m;
          }}
          renderOrder={19}
        >
          <planeGeometry args={[1, 1]} />
          <primitive object={sheetMats[i]!} attach="material" />
        </mesh>
      ))}
      {airSheets.map((_, i) => (
        <mesh
          key={`air-${i}`}
          ref={(el) => {
            trailMeshes.current[i] = el;
          }}
          visible={false}
          renderOrder={20}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={trailMats[i]!} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

const SLAM_EARTH = "#a16207";
const SLAM_HOT = "#d97706";

/**
 * Teleport Slam — earth slam rim like Jump Slam (v0), soft fade rematerialize (v1/v2).
 */
export function TeleportSlamEffect({ shot }: { shot: OneShotEffect }) {
  const variant = shot.variant ?? 0;
  if (variant === 0) return <TeleportSlamImpactEffect shot={shot} />;
  return <TeleportSlamShiftEffect shot={shot} />;
}

function TeleportSlamImpactEffect({ shot }: { shot: OneShotEffect }) {
  const hitRadius = Math.max(1.4, shot.radius ?? TELEPORT_SLAM_CAST.slamRadius);
  const lifeMs = Math.max(TELEPORT_SLAM_CAST.stunMs, shot.life || 900);
  const rimOpacity = useRef(0);
  const crackPreset = useMemo(
    () => ({
      ...groundPresets.earthSlam,
      colorCore: "#c4a35a",
      colorMid: "#5c3d24",
      colorEdge: "#120c08",
      breakup: 0.38,
      opacity: 1.2,
      radius: hitRadius * 1.35,
      lifeMs,
      ringWidth: 0.15,
      softness: 0.04,
      innerRatio: 0.22,
      noiseScale: 5.2,
      appearEnd: 0.05,
      fadeStart: 0.55,
    }),
    [hitRadius, lifeMs],
  );

  useFrame(() => {
    const age = performance.now() - shot.born;
    const u = Math.max(0, Math.min(1, age / lifeMs));
    rimOpacity.current = softEnvelope(u, 0.08, 0.55) * 0.9;
  });

  return (
    <group position={[shot.x, 0, shot.z]}>
      <AoeRimMarker
        x={0}
        z={0}
        y={0.026}
        radius={hitRadius}
        color={SLAM_EARTH}
        hotColor={SLAM_HOT}
        fill={0.14}
        noise={0.35}
        rimWidth={0.022}
        glowWidth={0.06}
        opacity={0.72}
        opacityMulRef={rimOpacity}
        pulse={false}
      />
      <GroundDecal
        preset={crackPreset}
        shape="circle"
        x={0}
        z={0}
        y={0.032}
        born={shot.born}
        life={lifeMs}
        radius={hitRadius * 1.35}
      />
    </group>
  );
}

/** Soft rematerialize dust — stronger on arrive so the fade-in has a visual anchor. */
function TeleportSlamShiftEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const isArrive = (shot.variant ?? 0) === 1;
  const progress = useRef(0);
  const smokeOpacity = useRef(0);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: SLAM_EARTH,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const smoke = useMemo(
    () => ({
      ...groundPresets.windSmoke,
      colorCore: "#c4a35a",
      colorMid: "#78716c",
      colorEdge: "#292524",
      radius: isArrive ? 1.35 : 1.1,
      lifeMs: isArrive ? 580 : 380,
      opacity: isArrive ? 0.42 : 0.28,
      breakup: 0.48,
      fadeStart: 0.35,
    }),
    [isArrive],
  );

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const life = Math.max(isArrive ? 520 : 280, shot.life);
    const t = Math.min(1, (performance.now() - shot.born) / life);
    const a = softEnvelope(t, 0.1, 0.45) * (isArrive ? 0.38 : 0.2) * (1 - t * 0.35);
    g.visible = a > 0.015 || (isArrive && t < 0.95);
    g.position.set(shot.x, 0.04, shot.z);
    const s = (isArrive ? 0.45 : 0.7) + t * (isArrive ? 1.15 : 0.85);
    g.scale.setScalar(s);
    mat.opacity = a;
    progress.current = 0.35 + t * 0.65;
    smokeOpacity.current = softEnvelope(t, 0.08, 0.5) * (isArrive ? 0.9 : 0.55);
  });

  return (
    <group ref={root} visible={false}>
      {isArrive ? (
        <GroundDecal
          preset={smoke}
          shape="circle"
          x={0}
          z={0}
          y={0.03}
          radius={smoke.radius}
          growExpand
          progressRef={progress}
          opacityMulRef={smokeOpacity}
        />
      ) : null}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={18}>
        <ringGeometry args={[0.28, isArrive ? 0.72 : 0.55, 28]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
