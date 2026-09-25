import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { ORBITING_WISP_CAST, orbitingWispWorldPos } from "@battlebeasts/shared";
import { ATLAS_UV, BatchId, spawnElementRole, type ElementHandle } from "./engine";
import { getVfxCircleTexture } from "./materials/circlePoint";
import type { PredictedPose } from "../useBaseCityRoom";

const ARMING_MS = ORBITING_WISP_CAST.armingMs;
const FADE_MS = 150;

type WispNet = {
  x: number;
  z: number;
  y?: number;
  orbitPhase?: number;
  spawnedAt?: number;
  armedAt?: number;
  expiresAt?: number;
  ownerSessionId?: string;
};

function ownerPose(
  room: Room,
  ownerSessionId: string | undefined,
  localSessionId: string | null,
  predictedRef?: MutableRefObject<PredictedPose>,
): { x: number; z: number } | null {
  if (
    ownerSessionId &&
    localSessionId &&
    ownerSessionId === localSessionId &&
    predictedRef?.current
  ) {
    return { x: predictedRef.current.x, z: predictedRef.current.z };
  }
  if (!ownerSessionId) return null;
  const p = room.state?.players?.get(ownerSessionId) as { x?: number; z?: number } | undefined;
  if (typeof p?.x !== "number" || typeof p?.z !== "number") return null;
  return { x: p.x, z: p.z };
}

function WispMesh({
  room,
  id,
  localSessionId,
  predictedRef,
}: {
  room: Room;
  id: string;
  localSessionId: string | null;
  predictedRef?: MutableRefObject<PredictedPose>;
}) {
  const renderPos = useRef(new THREE.Vector3());
  const seeded = useRef(false);
  const spawnLocal = useRef(performance.now());
  const trail = useRef<ElementHandle | null>(null);
  const group = useRef<THREE.Group>(null);
  const travelYaw = useRef(0);
  const coreMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: getVfxCircleTexture(),
        color: "#7dd3fc",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      trail.current?.kill();
      trail.current = null;
      coreMat.dispose();
    };
  }, [coreMat]);

  useFrame((_, dt) => {
    const w = room.state?.orbitingWisps?.get(id) as WispNet | undefined;
    if (!w) {
      seeded.current = false;
      trail.current?.kill();
      trail.current = null;
      if (group.current) group.current.visible = false;
      return;
    }
    const owner = ownerPose(room, w.ownerSessionId, localSessionId, predictedRef);
    const schemaOk =
      Number.isFinite(w.x) &&
      Number.isFinite(w.z) &&
      (w.x !== 0 || w.z !== 0 || (owner != null && Math.hypot(owner.x, owner.z) < 2));
    if (!owner && !schemaOk) {
      if (group.current) group.current.visible = false;
      return;
    }
    if (group.current) group.current.visible = true;

    const safeDt = Math.min(0.05, Math.max(0, dt));
    const nowMs = performance.now();
    if (!seeded.current) {
      spawnLocal.current = nowMs;
    }
    const armAge = nowMs - spawnLocal.current;
    const spawnIn = Math.min(1, armAge / Math.max(1, ARMING_MS));
    const appear = spawnIn * spawnIn * (3 - 2 * spawnIn);
    // Never use Date.now() vs schema expiresAt — a 0 default or clock skew
    // makes left hugely negative and the caster sees nothing.
    const duration =
      w.expiresAt && w.spawnedAt && w.expiresAt > w.spawnedAt
        ? w.expiresAt - w.spawnedAt
        : ORBITING_WISP_CAST.durationMs;
    const left = duration - armAge;
    const fadeOut = left < FADE_MS ? Math.max(0, left / FADE_MS) : 1;
    const opacity = appear * fadeOut;

    let tx = w.x;
    let tz = w.z;
    let ty = w.y ?? ORBITING_WISP_CAST.height;
    if (owner) {
      const pos = orbitingWispWorldPos(
        owner.x,
        owner.z,
        w.orbitPhase ?? 0,
        Date.now(),
        ORBITING_WISP_CAST,
      );
      const ease = spawnIn;
      tx = owner.x + (pos.x - owner.x) * ease;
      tz = owner.z + (pos.z - owner.z) * ease;
      ty = ORBITING_WISP_CAST.height;
    }
    const prevX = renderPos.current.x;
    const prevZ = renderPos.current.z;
    if (!seeded.current) {
      renderPos.current.set(tx, ty, tz);
      seeded.current = true;
    } else {
      renderPos.current.x = THREE.MathUtils.damp(renderPos.current.x, tx, 10, safeDt);
      renderPos.current.z = THREE.MathUtils.damp(renderPos.current.z, tz, 10, safeDt);
      renderPos.current.y = THREE.MathUtils.damp(renderPos.current.y, ty, 8, safeDt);
    }
    const movedX = renderPos.current.x - prevX;
    const movedZ = renderPos.current.z - prevZ;
    if (movedX * movedX + movedZ * movedZ > 1e-8) {
      travelYaw.current = Math.atan2(movedX, movedZ);
    }

    if (!trail.current) {
      const life = ORBITING_WISP_CAST.durationMs / 1000 + 0.4;
      trail.current = spawnElementRole("wind", "trail", tx, ty, tz, {
        duration: life,
        batch: BatchId.AlphaIce,
        atlasUv: ATLAS_UV.wind,
        rate: 34,
        burst: 6,
        size: 0.55,
        sizeEnd: 0.08,
        life: 0.62,
        lifeJitter: 0.3,
        spread: 0.08,
        dirY: 0.06,
        dirZ: -0.85,
        noise: 0.45,
        drag: 0.85,
        gravity: 0,
        opacity: 0.72,
        rotRate: 0,
        rotJitter: 0,
        color0: "#f0f9ff",
        color1: "#7dd3fc",
        color2: "#1d4ed8",
      });
    }
    const px = renderPos.current.x;
    const py = renderPos.current.y;
    const pz = renderPos.current.z;
    if (group.current) group.current.position.set(px, py, pz);
    const pulse = 0.9 + Math.sin(nowMs * 0.008) * 0.08;
    coreMat.opacity = 0.92 * opacity;
    if (group.current) group.current.scale.setScalar(0.46 * pulse * (0.4 + opacity * 0.6));
    trail.current.setPoseYaw(px, py, pz, travelYaw.current);
    trail.current.setRateScale(opacity);
  });

  return (
    <group ref={group}>
      <sprite material={coreMat} />
    </group>
  );
}

/** Schema-synced orbiting wisps. */
export function OrbitingWisps({
  room,
  localSessionId = null,
  predictedRef,
}: {
  room: Room | null;
  localSessionId?: string | null;
  predictedRef?: MutableRefObject<PredictedPose>;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.orbitingWisps) return;
    const next: string[] = [];
    room.state.orbitingWisps.forEach((_d: unknown, id: string) => next.push(id));
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setIds(next);
    }
  });

  if (!room) return null;
  return (
    <>
      {ids.map((id) => (
        <WispMesh
          key={id}
          room={room}
          id={id}
          localSessionId={localSessionId}
          predictedRef={predictedRef}
        />
      ))}
    </>
  );
}
