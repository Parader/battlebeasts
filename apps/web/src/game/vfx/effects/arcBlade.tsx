import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ARC_BLADE_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope, smooth01 } from "../easing";

const MAIN = new THREE.Color("#38BDF8");
const BRIGHT = new THREE.Color("#A5F3FC");
const EDGE = new THREE.Color("#F0FDFF");

const SPARK_COUNT = 7;

/**
 * Arc Blade — luminous crescent spins around the caster for three hit pulses.
 * Emphasizes the outer edge (sweet spot) without drawing gameplay rings.
 */
export function ArcBladeEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Mesh>(null);
  const ribbon = useRef<THREE.Mesh>(null);
  const outer = useRef<THREE.Mesh>(null);
  const sparkMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const innerR = ARC_BLADE_CAST.outerEdgeStartRadius * 0.96;
  const outerR = shot.radius ?? ARC_BLADE_CAST.radius;

  const mats = useMemo(() => {
    const mk = (color: THREE.Color, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    return {
      blade: mk(BRIGHT, 0.85),
      ribbon: mk(MAIN, 0.35),
      outer: mk(EDGE, 0.7),
      sparks: Array.from({ length: SPARK_COUNT }, () => mk(EDGE, 0.8)),
    };
  }, []);

  const ribbonGeo = useMemo(() => {
    // Annular sector ribbon — rebuilt each frame via morph of UVs/positions would be heavy;
    // use a full ring mesh and reveal via scale/opacity + rotating blade tip.
    const geo = new THREE.RingGeometry(innerR, outerR, 64, 1, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [innerR, outerR]);

  const edgeGeo = useMemo(() => {
    const geo = new THREE.RingGeometry(outerR - 0.12, outerR, 64, 1, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [outerR]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    const life = shot.life ?? 420;
    if (ms >= life) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Track caster (local predicted pose when available) so the sweep moves with them.
    let ox = shot.x;
    let oz = shot.z;
    let yaw0 = shot.yaw ?? 0;
    if (shot.followOwnerId && follow) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        ox = local.x;
        oz = local.z;
        yaw0 = local.yaw;
      } else {
        const pl = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (pl) {
          ox = pl.x ?? ox;
          oz = pl.z ?? oz;
          yaw0 = pl.yaw ?? yaw0;
        }
      }
    }
    g.position.set(ox, 0, oz);

    // Continuous spin for the whole life — fade opacity, don't freeze the blade.
    const spinStartMs = 40;
    const revMs = 160;
    const spinMs = Math.max(0, ms - spinStartMs);
    const angle = yaw0 + (spinMs / revMs) * Math.PI * 2;
    // Keep full opacity through all three gameplay hits (~145 / 255 / 365ms), then fade.
    const fadeStart = 380;
    const fade = 1 - smooth01(Math.max(0, (ms - fadeStart) / Math.max(1, life - fadeStart)));
    const appear = softEnvelope(Math.min(1, ms / 50), 0.1, 0.35);
    const spinProgress = Math.min(1, spinMs / (revMs * 2.2));

    // Magical blade from hand → tip at outer radius.
    if (blade.current) {
      const len = 1.65;
      const tipR = (innerR + outerR) * 0.5;
      blade.current.position.set(Math.sin(angle) * tipR, 1.05, Math.cos(angle) * tipR);
      blade.current.rotation.set(0, angle, Math.PI / 2);
      blade.current.scale.set(0.04, len, 0.02);
      mats.blade.opacity = (0.55 + appear * 0.35) * fade;
    }

    // Sweep disc fades in briefly so the circular path reads, then dissolves.
    if (ribbon.current) {
      const reveal = softEnvelope(Math.min(1, ms / 70), 0.08, 0.4) * fade;
      mats.ribbon.opacity = 0.12 + reveal * 0.22 * (1 - spinProgress * 0.25);
      ribbon.current.rotation.y = angle * 0.15;
    }
    if (outer.current) {
      mats.outer.opacity =
        (0.25 + softEnvelope(Math.min(1, ms / 60), 0.1, 0.4) * 0.55) * fade;
      outer.current.rotation.y = -angle * 0.08;
    }

    // Peak pulses lined up with the three server snapshots (cast fire ≈ 145ms).
    const hitPeaks = [145, 255, 365];
    let peak = 0;
    for (const t of hitPeaks) {
      peak = Math.max(
        peak,
        softEnvelope(Math.min(1, Math.max(0, (ms - (t - 25)) / 50)), 0.15, 0.4),
      );
    }
    for (let i = 0; i < SPARK_COUNT; i++) {
      const mesh = sparkMeshes.current[i];
      if (!mesh) continue;
      const a = angle + (i / SPARK_COUNT) * Math.PI * 2 * 0.15 - 0.2;
      const r = outerR - 0.05 - (i % 3) * 0.08;
      const show = peak > 0.05;
      mesh.visible = show;
      if (!show) continue;
      mesh.position.set(Math.sin(a) * r, 1.0 + (i % 2) * 0.12, Math.cos(a) * r);
      mesh.scale.setScalar(0.04 * (0.6 + peak));
      mats.sparks[i]!.opacity = peak * 0.85 * fade;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={ribbon} geometry={ribbonGeo} position={[0, 1.0, 0]} renderOrder={28}>
        <primitive object={mats.ribbon} attach="material" />
      </mesh>
      <mesh ref={outer} geometry={edgeGeo} position={[0, 1.02, 0]} renderOrder={29}>
        <primitive object={mats.outer} attach="material" />
      </mesh>
      <mesh ref={blade} renderOrder={31}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={mats.blade} attach="material" />
      </mesh>
      {mats.sparks.map((mat, i) => (
        <mesh
          key={`spark-${i}`}
          ref={(el) => {
            sparkMeshes.current[i] = el;
          }}
          renderOrder={32}
          visible={false}
        >
          <octahedronGeometry args={[1, 0]} />
          <primitive object={mat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

/** Target hit flash — variant 1 = outer-edge slash. */
export function ArcBladeHitEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const slash = useRef<THREE.Mesh>(null);
  const outer = (shot.variant ?? 0) === 1;

  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: (outer ? EDGE : BRIGHT).clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [outer],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= 220) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const pop = softEnvelope(Math.min(1, ms / 45), 0.1, 0.35);
    const fade = 1 - smooth01(Math.max(0, (ms - 70) / 150));
    if (slash.current) {
      const w = outer ? 0.12 : 0.07;
      const h = outer ? 0.75 : 0.45;
      slash.current.scale.set(w * (0.7 + pop), h * (0.6 + pop), 0.02);
      slash.current.rotation.z = -0.6 + pop * 0.2;
      mat.opacity = pop * (outer ? 0.9 : 0.55) * fade;
    }
  });

  return (
    <group ref={root} position={[shot.x, shot.y ?? 1.1, shot.z]} rotation={[0, shot.yaw ?? 0, 0]}>
      <mesh ref={slash} renderOrder={40}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}

/** Tiny caster-hand pulse when an outer-edge hit connected (variant 2). */
export function ArcBladeOuterPulseEffect({ shot }: { shot: OneShotEffect }) {
  const root = useRef<THREE.Group>(null);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: EDGE.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const ms = performance.now() - shot.born;
    if (ms >= 180) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const pop = softEnvelope(Math.min(1, ms / 40), 0.12, 0.4);
    const fade = 1 - smooth01(Math.max(0, (ms - 60) / 120));
    g.scale.setScalar(0.12 * (0.5 + pop));
    mat.opacity = pop * 0.7 * fade;
  });

  return (
    <group ref={root} position={[shot.x, shot.y ?? 1.15, shot.z]} visible={false}>
      <mesh renderOrder={40}>
        <sphereGeometry args={[1, 8, 6]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
