import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CONE_OCCLUSION_SECTORS,
  coneRayMaxLength,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { softEnvelope } from "../easing";
import { createTrailMaterial } from "../materials/trailMaterial";
import { getWorldProjectileCircles, getWorldProjectileWalls, getWorldProjectileBoxes } from "../../worldCollidersRuntime";

const BEAM_COUNT = 48;
const HALF_ANGLE_START = 0.28;
const HALF_ANGLE_END = 0.7;
/** Near-hand spawn before beams race down the cone. */
const BEAM_SPAWN = 0.45;
/** Keep mist above uneven GLB ground (cemetery / desert). */
const DECAL_Y = 0.09;
const _down = new THREE.Vector3(0, -1, 0);
const _origin = new THREE.Vector3();

function collectGroundMeshes(scene: THREE.Object3D): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const n = m.name.toLowerCase();
    if (n.includes("beta_") || n.includes("mixamorig") || n.startsWith("sm_chr")) return;
    if (/ground|terrain|floor|meadow|path|tile/.test(n) || meshes.length < 40) {
      meshes.push(m);
    }
  });
  return meshes;
}

function sampleGroundY(
  meshes: THREE.Object3D[],
  x: number,
  z: number,
  raycaster: THREE.Raycaster,
): number {
  if (!meshes.length) return 0;
  _origin.set(x, 80, z);
  raycaster.set(_origin, _down);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return 0;
  const named = hits.find((h) => /ground|terrain|floor|meadow|path/i.test(h.object.name));
  const y = (named ?? hits[0]!).point.y;
  return Number.isFinite(y) ? y : 0;
}

type IceBeam = {
  /** Fixed aim angle within the full cone (−1…1 → ±halfAngle). */
  ang: number;
  y: number;
  /** World units per second along the ray. */
  speed: number;
  len: number;
  width: number;
  phase: number;
  stagger: number;
};

type OccludeBody = {
  id: string;
  x: number;
  z: number;
  hp?: number;
  vulnerable?: boolean;
};

function grow01(t: number): number {
  return THREE.MathUtils.clamp(t, 0, 1);
}

function collectOccludeBodies(
  follow: VfxFollowContext | undefined,
  ownerId: string | undefined,
): OccludeBody[] {
  const room = follow?.room;
  if (!room?.state) return [];
  const out: OccludeBody[] = [];
  const players = room.state.players as Map<string, { x?: number; z?: number; hp?: number }> | undefined;
  players?.forEach((p, id) => {
    if (ownerId && id === ownerId) return;
    out.push({ id, x: p.x ?? 0, z: p.z ?? 0, hp: p.hp });
  });
  const targets = room.state.targets as
    | Map<string, { x?: number; z?: number; hp?: number }>
    | undefined;
  targets?.forEach((t, id) => {
    out.push({ id, x: t.x ?? 0, z: t.z ?? 0, hp: t.hp });
  });
  return out;
}

/**
 * Frost Mist — ground cone + fast tiny ice beams thrown straight along cone rays.
 * Beams clip at walls (hard) and front units (soft).
 */
export function FrostMistConeEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const root = useRef<THREE.Group>(null);
  const beamsRef = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const opacity = useRef(0.95);
  const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw, y: 0 });
  const liveLength = useRef(shot.startRadius ?? shot.radius ?? 3);
  const liveHalf = useRef(HALF_ANGLE_START);
  const sectorRanges = useRef<Float32Array>(new Float32Array(CONE_OCCLUSION_SECTORS).fill(1));
  const halfAngleLive = useRef(HALF_ANGLE_START);
  const { scene } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const groundMeshes = useMemo(() => collectGroundMeshes(scene), [scene]);

  const endLength = shot.radius ?? 11;
  const startLength = shot.startRadius ?? Math.min(endLength, endLength * 0.28);
  const growMs = Math.max(80, shot.growMs ?? 180);

  const beams = useMemo((): IceBeam[] => {
    const seed = shot.key * 5059;
    return Array.from({ length: BEAM_COUNT }, (_, i) => {
      // Spread across the cone; slight bias toward center.
      const u = ((seed + i * 47) % 1000) / 1000;
      const centered = (u * 2 - 1) * (0.55 + ((seed + i * 13) % 100) / 100 * 0.45);
      return {
        ang: centered,
        y: 0.55 + ((seed + i * 19) % 100) / 100 * 0.85,
        speed: 22 + ((seed + i * 7) % 100) / 100 * 16,
        len: 0.28 + ((seed + i * 11) % 100) / 100 * 0.22,
        width: 0.028 + ((seed + i * 17) % 100) / 100 * 0.022,
        phase: ((seed + i * 43) % 100) / 100,
        stagger: ((seed + i * 29) % 100) / 100 * 0.12,
      };
    });
  }, [shot.key]);

  const beamMats = useMemo(
    () =>
      beams.map((_, i) =>
        createTrailMaterial(i % 2 === 0 ? "#e0f2fe" : "#7dd3fc", {
          opacity: 0.85,
          head: 0.22,
        }),
      ),
    [beams],
  );

  useFrame(() => {
    const now = performance.now();
    const age = (now - shot.born) / shot.life;
    const g = root.current;
    if (!g) return;
    if (age >= 1) {
      g.visible = false;
      return;
    }
    g.visible = true;

    if (follow?.room && shot.followOwnerId) {
      const local = shot.followOwnerId === follow.localSessionId;
      if (local && follow.predictedRef) {
        pose.current.x = follow.predictedRef.current.x;
        pose.current.z = follow.predictedRef.current.z;
        pose.current.yaw = follow.predictedRef.current.yaw;
      } else {
        const p = follow.room.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          pose.current.x = p.x ?? pose.current.x;
          pose.current.z = p.z ?? pose.current.z;
          pose.current.yaw = p.yaw ?? pose.current.yaw;
        }
      }
    }

    g.position.set(
      pose.current.x,
      sampleGroundY(groundMeshes, pose.current.x, pose.current.z, raycaster),
      pose.current.z,
    );
    g.rotation.y = pose.current.yaw;

    const growT = grow01((now - shot.born) / growMs);
    liveLength.current = startLength + (endLength - startLength) * growT;
    liveHalf.current = HALF_ANGLE_START + (HALF_ANGLE_END - HALF_ANGLE_START) * growT;
    progress.current = Math.max(0.02, growT);

    const amp = softEnvelope(age, 0.02, 0.72);
    opacity.current = 0.65 + amp * 0.35;
    const stormAmp = amp * (0.3 + growT * 0.7);

    const length = liveLength.current;
    const half = liveHalf.current;
    halfAngleLive.current = half;
    const elapsed = (now - shot.born) / 1000;
    const origin = { x: pose.current.x, z: pose.current.z };
    const bodies = collectOccludeBodies(follow, shot.followOwnerId);
    const walls = getWorldProjectileWalls();
    const circles = getWorldProjectileCircles();
    const boxes = getWorldProjectileBoxes();

    // Ground cone pie ranges (0..1 of endLength) — same wall soft clip as beams.
    const ranges = sectorRanges.current;
    const invEnd = endLength > 1e-4 ? 1 / endLength : 0;
    const span = Math.max(1e-4, 2 * half);
    for (let s = 0; s < CONE_OCCLUSION_SECTORS; s++) {
      const u = (s + 0.5) / CONE_OCCLUSION_SECTORS;
      const a = -half + u * span;
      const rayYaw = pose.current.yaw + a;
      const maxLen = coneRayMaxLength(
        origin,
        rayYaw,
        length,
        walls,
        bodies,
        shot.followOwnerId ?? null,
        { circles, boxes },
      );
      ranges[s] = Math.max(0, Math.min(1, maxLen * invEnd));
    }

    if (beamsRef.current) {
      for (let i = 0; i < beamsRef.current.children.length; i++) {
        const mesh = beamsRef.current.children[i] as THREE.Mesh;
        const spec = beams[i];
        const mat = beamMats[i];
        if (!spec || !mat) continue;

        const a = spec.ang * HALF_ANGLE_END;
        if (Math.abs(a) > half + 0.04) {
          mesh.visible = false;
          continue;
        }

        const rayYaw = pose.current.yaw + a;
        const maxLen = coneRayMaxLength(
          origin,
          rayYaw,
          length,
          walls,
          bodies,
          shot.followOwnerId ?? null,
          { circles, boxes },
        );
        if (maxLen <= BEAM_SPAWN + 0.05) {
          mesh.visible = false;
          continue;
        }

        const travelSpan = Math.max(0.35, maxLen - BEAM_SPAWN);
        // Fast straight shot along a fixed ray inside the cone.
        const cycle = (elapsed * (spec.speed / travelSpan) + spec.phase + spec.stagger) % 1;
        const dist = BEAM_SPAWN + cycle * travelSpan;
        if (dist > maxLen * 0.99) {
          mesh.visible = false;
          continue;
        }

        const sx = Math.sin(a);
        const sz = Math.cos(a);
        // Center of the short beam segment
        const mid = dist;
        mesh.position.set(sx * mid, spec.y, sz * mid);
        // Align streak (+X of trail plane) with the ray in XZ
        mesh.rotation.set(0, a + Math.PI / 2, 0.02);
        mesh.scale.set(spec.len, spec.width, 1);

        const fade = cycle < 0.08 ? cycle / 0.08 : cycle > 0.75 ? 1 - (cycle - 0.75) / 0.25 : 1;
        mat.uniforms.uOpacity!.value = stormAmp * 0.9 * fade;
        mesh.visible = growT > 0.05 && fade > 0.05;
      }
    }
  });

  const ice = groundPresets.iceFrost;

  return (
    <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
      <GroundDecal
        preset={{
          ...ice,
          shape: "cone",
          halfAngle: HALF_ANGLE_END,
          radius: endLength,
          opacity: 0.88,
          lifeMs: shot.life,
          additive: true,
          appearEnd: 0.02,
          fadeStart: 0.78,
          spin: 0,
        }}
        shape="cone"
        yaw={0}
        radius={endLength}
        born={shot.born}
        life={shot.life}
        progressRef={progress}
        opacityMulRef={opacity}
        sectorRangesRef={sectorRanges}
        halfAngleRef={halfAngleLive}
        growExpand
        y={DECAL_Y}
      />
      <group ref={beamsRef}>
        {beamMats.map((mat, i) => (
          <mesh key={i} material={mat}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
