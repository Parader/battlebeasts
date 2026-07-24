import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope, smooth01 } from "../easing";

const SEGMENTS = 36;
const INDEX_PER_SEG = 6;

/** Per-swing placement — cycles through a 3-hit chain. */
const SWING_POSES = [
  {
    flip: 1 as const,
    y: 0.88,
    forward: 1.05,
    lateral: -0.18,
    yawBias: -0.28,
    pitch0: 0.38,
    pitch1: 0.05,
    roll0: 0.22,
    roll1: -0.04,
    scale: 0.92,
  },
  {
    flip: -1 as const,
    y: 1.28,
    forward: 1.32,
    lateral: 0.22,
    yawBias: 0.32,
    pitch0: -0.12,
    pitch1: 0.18,
    roll0: -0.28,
    roll1: 0.08,
    scale: 1.05,
  },
  {
    flip: 1 as const,
    y: 1.08,
    forward: 0.95,
    lateral: 0.06,
    yawBias: 0.1,
    pitch0: 0.48,
    pitch1: -0.15,
    roll0: 0.08,
    roll1: -0.18,
    scale: 0.98,
  },
] as const;

function buildSwoopRibbon(flip: number): THREE.BufferGeometry {
  const halfWidth = 0.09;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const angle = THREE.MathUtils.lerp(-1.05, 1.05, t);
    const radius = 1.05 + Math.sin(t * Math.PI) * 0.22;
    const x = flip * Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius * 0.72 - 0.05;
    const y = Math.sin(t * Math.PI) * 0.18 - 0.04;

    const widthMul = 0.35 + Math.sin(t * Math.PI) * 0.65;
    const w = halfWidth * widthMul;

    const tx = flip * Math.cos(angle);
    const tz = -Math.sin(angle) * 0.72;
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

function resolvePose(shot: OneShotEffect) {
  const idx =
    typeof shot.variant === "number"
      ? ((shot.variant % SWING_POSES.length) + SWING_POSES.length) % SWING_POSES.length
      : shot.key % SWING_POSES.length;
  return SWING_POSES[idx]!;
}

/**
 * White crescent swoop — draws along its length and follows the caster while moving.
 */
export function CrescentCastEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const blade = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const swing = useMemo(() => resolvePose(shot), [shot.variant, shot.key]);
  const geo = useMemo(() => buildSwoopRibbon(swing.flip), [swing.flip]);
  const glowGeo = useMemo(() => buildSwoopRibbon(swing.flip), [swing.flip]);

  const mat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: shot.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }, [shot.color]);

  const glowMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }, []);

  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });

  useFrame(() => {
    const age = (performance.now() - shot.born) / shot.life;
    const forward = shot.followSpawnOffset ?? swing.forward;

    if (shot.followOwnerId) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;

      if (local) {
        const yaw = local.yaw + swing.yawBias;
        const rightX = Math.cos(local.yaw);
        const rightZ = -Math.sin(local.yaw);
        pose.current.yaw = yaw;
        pose.current.x =
          local.x + Math.sin(local.yaw) * forward + rightX * swing.lateral;
        pose.current.z =
          local.z + Math.cos(local.yaw) * forward + rightZ * swing.lateral;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          const baseYaw = p.yaw ?? pose.current.yaw;
          const yaw = baseYaw + swing.yawBias;
          const rightX = Math.cos(baseYaw);
          const rightZ = -Math.sin(baseYaw);
          pose.current.yaw = yaw;
          pose.current.x =
            (p.x ?? pose.current.x) + Math.sin(baseYaw) * forward + rightX * swing.lateral;
          pose.current.z =
            (p.z ?? pose.current.z) + Math.cos(baseYaw) * forward + rightZ * swing.lateral;
        }
      }
    } else {
      const rightX = Math.cos(shot.yaw);
      const rightZ = -Math.sin(shot.yaw);
      pose.current.yaw = shot.yaw + swing.yawBias;
      pose.current.x =
        shot.x + Math.sin(shot.yaw) * forward + rightX * swing.lateral;
      pose.current.z =
        shot.z + Math.cos(shot.yaw) * forward + rightZ * swing.lateral;
    }

    if (root.current) {
      root.current.position.set(pose.current.x, 0, pose.current.z);
      root.current.rotation.y = pose.current.yaw;
    }

    const g = blade.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const drawT = smooth01(THREE.MathUtils.clamp(age / 0.22, 0, 1));
    const fade = softEnvelope(age, 0.04, 0.55);
    const segsDrawn = Math.max(1, Math.ceil(drawT * SEGMENTS));
    const indexCount = segsDrawn * INDEX_PER_SEG;
    geo.setDrawRange(0, indexCount);
    glowGeo.setDrawRange(0, indexCount);

    const u = smooth01(age);
    g.position.y = swing.y;
    g.rotation.x = THREE.MathUtils.lerp(swing.pitch0, swing.pitch1, u);
    g.rotation.z = THREE.MathUtils.lerp(swing.roll0, swing.roll1, drawT);
    g.scale.setScalar(swing.scale * (0.94 + fade * 0.08));
    mat.opacity = fade * 0.95;
    glowMat.opacity = fade * 0.38;
    if (light.current) light.current.intensity = fade * 2.4 * drawT;
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
      <group ref={blade} position={[0, swing.y, 0.12]}>
        <mesh geometry={geo}>
          <primitive object={mat} attach="material" />
        </mesh>
        <mesh geometry={glowGeo} scale={[1.08, 1.15, 1.08]}>
          <primitive object={glowMat} attach="material" />
        </mesh>
        <pointLight ref={light} color={shot.color} intensity={0} distance={3.5} decay={2} />
      </group>
    </group>
  );
}
