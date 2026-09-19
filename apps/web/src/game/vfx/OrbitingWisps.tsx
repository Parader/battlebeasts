import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { ORBITING_WISP_CAST, orbitingWispWorldPos } from "@battlebeasts/shared";
import { createEnergyBallMaterial } from "./materials/energyBall";
import { createCirclePointMaterial } from "./materials/circlePoint";
import type { PredictedPose } from "../useBaseCityRoom";

const CORE = "#0c1a2e";
const BLUE = "#2563eb";
const BRIGHT = "#38bdf8";
const HIGHLIGHT = "#e0f2fe";

const TAIL = 4;
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

type Fleck = {
  alive: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
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
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const renderPos = useRef(new THREE.Vector3());
  const seeded = useRef(false);
  const spawnLocal = useRef(performance.now());
  const flecks = useRef<Fleck[]>(
    Array.from({ length: TAIL }, () => ({
      alive: false,
      age: 0,
      life: 0.22,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.03,
    })),
  );
  const spawnAcc = useRef(0);

  const positions = useMemo(() => new Float32Array(TAIL * 3), []);
  const sizes = useMemo(() => new Float32Array(TAIL), []);
  const alphas = useMemo(() => new Float32Array(TAIL), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [positions, sizes, alphas]);

  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CORE,
        emissive: BLUE,
        emissiveIntensity: 0.85,
        metalness: 0.1,
        roughness: 0.35,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    [],
  );
  const glowMat = useMemo(() => createEnergyBallMaterial(BRIGHT, 0.55), []);
  const pointMat = useMemo(() => createCirclePointMaterial(HIGHLIGHT), []);

  useEffect(() => {
    return () => {
      geo.dispose();
      coreMat.dispose();
      glowMat.dispose();
      pointMat.dispose();
    };
  }, [geo, coreMat, glowMat, pointMat]);

  useFrame((_, dt) => {
    const w = room.state?.orbitingWisps?.get(id) as WispNet | undefined;
    const g = group.current;
    if (!w || !g) {
      if (g) g.visible = false;
      seeded.current = false;
      return;
    }
    const owner = ownerPose(room, w.ownerSessionId, localSessionId, predictedRef);
    const schemaOk =
      Number.isFinite(w.x) &&
      Number.isFinite(w.z) &&
      (w.x !== 0 || w.z !== 0 || (owner != null && Math.hypot(owner.x, owner.z) < 2));
    if (!owner && !schemaOk) {
      g.visible = false;
      return;
    }
    g.visible = true;

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
    if (!seeded.current) {
      renderPos.current.set(tx, ty, tz);
      seeded.current = true;
    } else {
      renderPos.current.x = THREE.MathUtils.damp(renderPos.current.x, tx, 18, safeDt);
      renderPos.current.z = THREE.MathUtils.damp(renderPos.current.z, tz, 18, safeDt);
      renderPos.current.y = THREE.MathUtils.damp(renderPos.current.y, ty, 14, safeDt);
    }
    g.position.copy(renderPos.current);

    const pulse = 0.92 + 0.08 * Math.sin(performance.now() * 0.008 + id.length);
    const scale = (0.55 + 0.45 * appear) * (0.55 + 0.45 * fadeOut) * pulse;
    if (core.current) {
      core.current.scale.setScalar(scale);
      coreMat.opacity = 0.95 * opacity;
      coreMat.emissiveIntensity = 0.7 + 0.35 * opacity;
    }
    if (glow.current) {
      glow.current.scale.setScalar(scale * 1.15);
      glowMat.opacity = 0.45 * opacity;
    }

    // Soft wispy tail opposite orbit tangent.
    spawnAcc.current += safeDt;
    if (spawnAcc.current > 0.045 && opacity > 0.2) {
      spawnAcc.current = 0;
      const slot = flecks.current.find((f) => !f.alive);
      if (slot) {
        const ang = (w.orbitPhase ?? 0) + (Date.now() / 1000) * ORBITING_WISP_CAST.angularSpeed;
        const txDir = Math.sin(ang);
        const tzDir = -Math.cos(ang);
        slot.alive = true;
        slot.age = 0;
        slot.life = 0.16 + Math.random() * 0.12;
        slot.x = (Math.random() - 0.5) * 0.06;
        slot.y = (Math.random() - 0.5) * 0.05;
        slot.z = (Math.random() - 0.5) * 0.06;
        slot.vx = txDir * (0.4 + Math.random() * 0.35);
        slot.vy = 0.15 + Math.random() * 0.35;
        slot.vz = tzDir * (0.4 + Math.random() * 0.35);
        slot.size = 0.025 + Math.random() * 0.02;
      }
    }

    for (let i = 0; i < TAIL; i++) {
      const f = flecks.current[i]!;
      if (!f.alive) {
        alphas[i] = 0;
        continue;
      }
      f.age += safeDt;
      if (f.age >= f.life) {
        f.alive = false;
        alphas[i] = 0;
        continue;
      }
      f.x += f.vx * safeDt;
      f.y += f.vy * safeDt;
      f.z += f.vz * safeDt;
      f.vy += 0.4 * safeDt;
      const t = f.age / f.life;
      positions[i * 3] = f.x;
      positions[i * 3 + 1] = f.y;
      positions[i * 3 + 2] = f.z;
      sizes[i] = f.size * (1 - t) * 48;
      alphas[i] = (1 - t) * 0.75 * opacity;
    }
    geo.attributes.position!.needsUpdate = true;
    geo.attributes.aSize!.needsUpdate = true;
    geo.attributes.aAlpha!.needsUpdate = true;
  });

  return (
    <group ref={group} frustumCulled={false}>
      <mesh ref={core} material={coreMat} renderOrder={6} frustumCulled={false}>
        <sphereGeometry args={[0.11, 10, 10]} />
      </mesh>
      <mesh ref={glow} material={glowMat} renderOrder={5} frustumCulled={false}>
        <sphereGeometry args={[0.2, 10, 10]} />
      </mesh>
      <points geometry={geo} material={pointMat} renderOrder={7} frustumCulled={false} />
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
