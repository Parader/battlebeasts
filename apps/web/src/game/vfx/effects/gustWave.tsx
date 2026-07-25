import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GUST_AOE_CAST } from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import type { VfxFollowContext } from "../catalog";
import { GroundDecal } from "../components/GroundDecal";
import { groundPresets } from "../presets/ground";
import { softEnvelope } from "../easing";
import { createTrailMaterial } from "../materials/trailMaterial";

function gustFrameWallMs(frame: number): number {
  return (
    (frame / GUST_AOE_CAST.fps / Math.max(0.01, GUST_AOE_CAST.playbackRate)) * 1000
  );
}

const AIR_SHEET_COUNT = 10;
const AIR_BOLT_COLOR = "#e8eef5";
const AIR_START_DIST = 0.35;

type AirSheet = {
  angle: number;
  y: number;
  speed: number;
  len: number;
  width: number;
  height: number;
  delay: number;
  curl: number;
};

function makeAirSheets(): AirSheet[] {
  const sheets: AirSheet[] = [];
  for (let i = 0; i < AIR_SHEET_COUNT; i++) {
    const base = (i / AIR_SHEET_COUNT) * Math.PI * 2;
    sheets.push({
      angle: base + (Math.random() - 0.5) * 0.12,
      y: 0.65 + Math.random() * 0.45,
      speed: 9 + Math.random() * 3.5,
      len: 0.32 + Math.random() * 0.14,
      width: 0.7 + Math.random() * 0.3,
      height: 0.2 + Math.random() * 0.1,
      delay: Math.random() * 0.03,
      curl: (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.1),
    });
  }
  return sheets;
}

/**
 * Gust Q — suck gathers, then a simple expanding smoke disc (frost-aura style).
 * Mid-air sheets still fire outward on the blow.
 */
export function GustWaveEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow?: VfxFollowContext;
}) {
  const smoke = groundPresets.windSmoke;
  const root = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const opacity = useRef(0);
  const pose = useRef({ x: shot.x, z: shot.z });
  const airSheets = useMemo(() => makeAirSheets(), []);
  const sheetMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const trailMats = useMemo(
    () =>
      airSheets.map(() =>
        createTrailMaterial(AIR_BOLT_COLOR, { opacity: 0.32, head: 0.35 }),
      ),
    [airSheets],
  );

  useEffect(() => {
    return () => {
      for (const m of trailMats) m.dispose();
    };
  }, [trailMats]);

  const suckStart = gustFrameWallMs(GUST_AOE_CAST.suckStartFrame);
  const suckEnd = gustFrameWallMs(GUST_AOE_CAST.suckEndFrame);
  const blowAt = gustFrameWallMs(GUST_AOE_CAST.blowFrame);
  const outwardMs = 240;
  const fadeMs = 55;
  const sheetLifeMs = 280;

  useFrame(() => {
    if (shot.followOwnerId && follow) {
      const local =
        follow.localSessionId &&
        shot.followOwnerId === follow.localSessionId &&
        follow.predictedRef
          ? follow.predictedRef.current
          : null;
      if (local) {
        pose.current.x = local.x;
        pose.current.z = local.z;
      } else {
        const pl = follow.room?.state?.players?.get(shot.followOwnerId) as
          | { x?: number; z?: number }
          | undefined;
        if (pl) {
          pose.current.x = pl.x ?? pose.current.x;
          pose.current.z = pl.z ?? pose.current.z;
        }
      }
    }

    if (root.current) {
      root.current.position.set(pose.current.x, 0, pose.current.z);
    }

    const ageMs = performance.now() - shot.born;
    if (ageMs >= shot.life) {
      opacity.current = 0;
      for (let i = 0; i < AIR_SHEET_COUNT; i++) {
        const m = sheetMeshes.current[i];
        if (m) m.visible = false;
      }
      return;
    }

    if (ageMs < suckStart) {
      progress.current = 0;
      opacity.current = 0;
      return;
    }

    // Soft gather — faint smoke shrinks in
    if (ageMs < suckEnd) {
      const u = (ageMs - suckStart) / Math.max(1, suckEnd - suckStart);
      progress.current = 1 - u * u * 0.75;
      opacity.current = softEnvelope(u, 0.08, 0.9) * 0.45;
      return;
    }

    if (ageMs < blowAt) {
      progress.current = 0.25;
      opacity.current = 0.45;
      return;
    }

    // Circular push — expand smoke disc, then fade
    const sinceBlow = ageMs - blowAt;
    const u = Math.min(1, sinceBlow / outwardMs);
    const e = 1 - (1 - u) * (1 - u);
    progress.current = 0.2 + e * 0.8;

    if (sinceBlow < outwardMs) {
      opacity.current = softEnvelope(u, 0.04, 0.55);
    } else {
      const fadeU = Math.min(1, (sinceBlow - outwardMs) / fadeMs);
      opacity.current = Math.max(0, 1 - fadeU);
    }

    const sinceBlowSec = sinceBlow / 1000;
    for (let i = 0; i < AIR_SHEET_COUNT; i++) {
      const b = airSheets[i]!;
      const mesh = sheetMeshes.current[i];
      const trail = trailMats[i];
      if (!mesh || !trail) continue;

      const t = sinceBlowSec - b.delay;
      if (t < 0 || t * 1000 > sheetLifeMs) {
        mesh.visible = false;
        continue;
      }

      const life = Math.min(1, (t * 1000) / sheetLifeMs);
      const dist = AIR_START_DIST + t * b.speed;
      const yaw = b.angle + b.curl * life;
      const sx = Math.sin(yaw);
      const sz = Math.cos(yaw);

      mesh.visible = true;
      mesh.position.set(sx * dist, b.y + t * 0.15, sz * dist);
      mesh.rotation.set(0, yaw, 0);
      const flare = 1 + life * 0.35;
      mesh.scale.set(b.width * flare, b.height, b.len * (0.85 + life * 0.25));

      const fade =
        life < 0.12
          ? life / 0.12
          : Math.max(0, 1 - (life - 0.12) / 0.88);
      trail.uniforms.uOpacity!.value = 0.3 * fade * fade;
    }
  });

  return (
    <group ref={root} position={[shot.x, 0, shot.z]}>
      <GroundDecal
        preset={smoke}
        shape="circle"
        x={0}
        z={0}
        y={0.04}
        radius={smoke.radius}
        growExpand
        progressRef={progress}
        opacityMulRef={opacity}
      />
      {airSheets.map((b, i) => (
        <mesh
          key={i}
          ref={(el) => {
            sheetMeshes.current[i] = el;
          }}
          visible={false}
          rotation={[0, b.angle, 0]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={trailMats[i]!} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
