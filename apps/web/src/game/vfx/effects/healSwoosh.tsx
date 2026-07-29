import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { GROOVE_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { AoeRimMarker } from "../components/AoeRimMarker";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { softEnvelope, smooth01 } from "../easing";

const SEGMENTS = 28;
const SWOOSH_COUNT = 10;
/** Stagger between swoosh starts as a fraction of total life (~4s). */
const SWOOSH_STAGGER = 0.085;
const SWOOSH_SPAN = 0.22;

type ArcPose = {
  /** World angle around the caster (0 = +Z). */
  worldAngle: number;
  flip: 1 | -1;
  y: number;
  /** Distance from caster center. */
  orbit: number;
  scale: number;
  delay: number;
};

function buildArcPoses(): ArcPose[] {
  const poses: ArcPose[] = [];
  for (let i = 0; i < SWOOSH_COUNT; i++) {
    poses.push({
      worldAngle: (i / SWOOSH_COUNT) * Math.PI * 2,
      flip: i % 2 === 0 ? 1 : -1,
      y: 0.85 + (i % 3) * 0.18,
      orbit: 1.15 + (i % 3) * 0.2,
      scale: 0.95 + (i % 3) * 0.12,
      delay: i * SWOOSH_STAGGER,
    });
  }
  return poses;
}

function buildHealRibbon(flip: number): THREE.BufferGeometry {
  const halfWidth = 0.14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const angle = THREE.MathUtils.lerp(-1.05, 1.05, t);
    const radius = 1.35 + Math.sin(t * Math.PI) * 0.42;
    const x = flip * Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius * 0.8 - 0.08;
    const y = Math.sin(t * Math.PI) * 0.26;

    const widthMul = 0.3 + Math.sin(t * Math.PI) * 0.7;
    const w = halfWidth * widthMul;

    const tx = flip * Math.cos(angle);
    const tz = -Math.sin(angle) * 0.8;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;

    positions.push(x - nx * w, y, z - nz * w);
    positions.push(x + nx * w, y, z + nz * w);
    uvs.push(t, 0, t, 1);

    if (i < SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.setDrawRange(0, 0);
  return geo;
}

function HealArc({
  shot,
  follow,
  pose,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
  pose: ArcPose;
}) {
  const root = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const geo = useMemo(() => buildHealRibbon(pose.flip), [pose.flip]);
  const glowGeo = useMemo(() => buildHealRibbon(pose.flip), [pose.flip]);

  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: shot.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [shot.color],
  );

  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ecfdf5",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const world = useRef({ x: shot.x, z: shot.z });

  useFrame(() => {
    const rawAge = (performance.now() - shot.born) / shot.life;
    // Each swoosh occupies a short local window after its delay.
    const local = (rawAge - pose.delay) / SWOOSH_SPAN;

    if (shot.followOwnerId) {
      const localPred =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (localPred) {
        world.current.x = localPred.x;
        world.current.z = localPred.z;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (p) {
          world.current.x = p.x ?? world.current.x;
          world.current.z = p.z ?? world.current.z;
        }
      }
    }

    // Even ring around the caster — not clustered on facing.
    const orbit = pose.orbit + local * 0.55;
    const fx = world.current.x + Math.sin(pose.worldAngle) * orbit;
    const fz = world.current.z + Math.cos(pose.worldAngle) * orbit;

    if (root.current) {
      root.current.position.set(fx, 0, fz);
      root.current.rotation.y = pose.worldAngle;
    }

    const g = blade.current;
    if (!g) return;
    if (local < 0 || local >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const draw = smooth01(Math.min(1, local / 0.28));
    const fade = softEnvelope(local, 0.1, 0.5);
    const grow = 0.8 + smooth01(local) * 0.7;
    g.scale.setScalar(pose.scale * grow);
    g.position.y = pose.y + local * 0.45;
    g.rotation.z = pose.flip * local * 0.4;

    const idxCount = SEGMENTS * 6;
    geo.setDrawRange(0, Math.floor(draw * idxCount));
    glowGeo.setDrawRange(0, Math.floor(draw * idxCount));
    mat.opacity = 0.32 * fade;
    glowMat.opacity = 0.14 * fade;
  });

  return (
    <group ref={root}>
      <group ref={blade}>
        <mesh geometry={geo} material={mat} />
        <mesh geometry={glowGeo} material={glowMat} scale={[1.1, 1.1, 1.1]} />
      </group>
    </group>
  );
}

/** Soft mint fog inside the heal radius — rim carries the hard hit edge. */
const healGroundFog = {
  ...groundPresets.frostBallAura,
  element: "poison" as const,
  shape: "circle" as const,
  colorCore: "#d1fae5",
  colorMid: "#6ee7b7",
  colorEdge: "#065f46",
  opacity: 0.28,
  additive: true,
  radius: 7,
  lifeMs: GROOVE_CAST.channelMs,
  ringWidth: 0.1,
  softness: 0.12,
  innerRatio: 0.08,
  spin: 0.28,
  appearEnd: 0.03,
  fadeStart: 0.82,
};

/** Snap ground fog + rim open in ~125ms (not over the full channel). */
const GROUND_APPEAR_MS = 125;

/**
 * Groove heal aura — soft mint ground fog + green hit-radius rim + swooshes.
 */
export function HealSwooshEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const arcs = useMemo(() => buildArcPoses(), []);
  const root = useRef<THREE.Group>(null);
  const groundPos = useRef({ x: shot.x, z: shot.z });
  const groundOpacity = useRef(1);
  const groundProgress = useRef(0);
  const rimOpacity = useRef(1);

  useFrame(() => {
    const elapsed = performance.now() - shot.born;
    const age = elapsed / shot.life;
    const appear01 = Math.min(1, elapsed / GROUND_APPEAR_MS);
    groundProgress.current = appear01;
    const fade = softEnvelope(
      age,
      GROUND_APPEAR_MS / Math.max(1, shot.life),
      0.82,
    );
    groundOpacity.current = appear01 * fade;
    rimOpacity.current = appear01 * fade;

    if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        groundPos.current.x = local.x;
        groundPos.current.z = local.z;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (p) {
          groundPos.current.x = p.x ?? groundPos.current.x;
          groundPos.current.z = p.z ?? groundPos.current.z;
        }
      }
    }

    if (root.current) {
      root.current.position.set(groundPos.current.x, 0, groundPos.current.z);
    }
  });

  const radius = shot.radius ?? 7;

  return (
    <group>
      <group ref={root}>
        <GroundDecal
          preset={healGroundFog}
          shape="circle"
          x={0}
          y={0.03}
          z={0}
          radius={radius}
          born={shot.born}
          life={shot.life}
          opacityMulRef={groundOpacity}
          progressRef={groundProgress}
          growExpand
        />
        <AoeRimMarker
          radius={radius}
          color="#34d399"
          hotColor="#ecfdf5"
          fill={0.04}
          noise={0.25}
          glowWidth={0.05}
          opacity={0.55}
          opacityMulRef={rimOpacity}
          y={0.038}
        />
      </group>
      {arcs.map((pose, i) => (
        <HealArc key={`${shot.key}-${i}`} shot={shot} follow={follow} pose={pose} />
      ))}
    </group>
  );
}
