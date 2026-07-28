import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BLOOD_RUSH_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";

const BLOOD = "#9f1239";
const BLOOD_DARK = "#450a0a";
const SEGMENTS = 14;
const SAMPLE_DIST = 0.28;

type Seg = {
  x: number;
  z: number;
  yaw: number;
  born: number;
};

/**
 * Thin blood scrape behind Blood Rush — samples the caster path and fades out.
 */
export function BloodRushTrailEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: VfxFollowContext;
}) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const segs = useRef<Seg[]>([]);
  const last = useRef<{ x: number; z: number } | null>(null);
  const lifeMs = Math.max(480, shot.life);

  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const matDark = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BLOOD_DARK,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const age = performance.now() - shot.born;
    if (age >= lifeMs) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Follow caster while the dash is live (~travel window).
    const followUntil = BLOOD_RUSH_CAST.travelMs + 40;
    if (age <= followUntil && shot.followOwnerId) {
      let x = shot.x;
      let z = shot.z;
      let yaw = shot.yaw;
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        x = local.x;
        z = local.z;
        yaw = local.yaw;
      } else {
        const p = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number; yaw?: number }
          | undefined;
        if (p) {
          x = p.x ?? x;
          z = p.z ?? z;
          yaw = p.yaw ?? yaw;
        }
      }

      const prev = last.current;
      if (!prev) {
        last.current = { x, z };
      } else {
        const dx = x - prev.x;
        const dz = z - prev.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= SAMPLE_DIST) {
          const face = Math.atan2(dx, dz);
          segs.current.push({ x: (x + prev.x) * 0.5, z: (z + prev.z) * 0.5, yaw: face, born: performance.now() });
          if (segs.current.length > SEGMENTS) segs.current.shift();
          last.current = { x, z };
        }
      }
    }

    const now = performance.now();
    for (let i = 0; i < SEGMENTS; i++) {
      const mesh = meshes.current[i];
      const seg = segs.current[i];
      if (!mesh) continue;
      if (!seg) {
        mesh.visible = false;
        continue;
      }
      const u = Math.max(0, Math.min(1, (now - seg.born) / 420));
      const fade = softEnvelope(u, 0.08, 0.35);
      mesh.visible = fade > 0.02;
      mesh.position.set(seg.x, 0.035, seg.z);
      mesh.rotation.set(-Math.PI / 2, 0, seg.yaw);
      const w = 0.22 + (1 - u) * 0.18;
      const len = 0.38 + (1 - u) * 0.22;
      mesh.scale.set(w, len, 1);
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.opacity = fade * (i % 2 === 0 ? 0.55 : 0.38);
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geo}
          material={i % 2 === 0 ? mat : matDark}
          renderOrder={2}
          frustumCulled={false}
          visible={false}
        />
      ))}
    </group>
  );
}
