import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { VOLCANO_CAST } from "@battlebeasts/shared";
import { FireParticleField } from "./components/FireParticleField";
import { GroundDecal } from "./components/GroundDecal";
import { softEnvelope } from "./easing";
import { groundPresets } from "./presets/ground";
import {
  VOLCANO_GLB_URL,
  VOLCANO_TARGET_SIZE,
  cloneFittedTemplate,
  pickVolcanoTemplate,
  warmVolcanoAssets,
} from "./volcanoAsset";

/** Earth scar under the erupting cone — slightly past collide radius. */
const GROUND_SCAR_R = VOLCANO_CAST.collideRadius * 1.45;
const GROUND_SCAR_LIFE_MS =
  VOLCANO_CAST.riseMs + VOLCANO_CAST.zoneDurationMs + VOLCANO_CAST.sinkMs;

type VolcanoSchema = {
  x: number;
  z: number;
  yaw?: number;
  radius?: number;
  phase?: string;
  expiresAt?: number;
};

function VolcanoMesh({ room, id }: { room: Room; id: string }) {
  const gltf = useGLTF(VOLCANO_GLB_URL);
  const group = useRef<THREE.Group>(null);
  const scarRoot = useRef<THREE.Group>(null);
  const phaseRef = useRef("rising");
  const phaseStarted = useRef(performance.now());
  const scarBorn = useRef(performance.now());
  const opacityMul = useRef(1);
  const progressRef = useRef(1);
  const scarOpacity = useRef(0.35);

  const mesh = useMemo(() => {
    const tmpl = pickVolcanoTemplate(gltf.scene);
    warmVolcanoAssets(gltf.scene);
    return tmpl
      ? cloneFittedTemplate(tmpl, VOLCANO_TARGET_SIZE, { uprightVolcano: true, cloneMats: true })
      : null;
  }, [gltf.scene]);

  const fireEmitters = useMemo(
    () => [
      { x: 0, y: VOLCANO_TARGET_SIZE * 0.42, z: 0, reveal: 0 },
      { x: 0.28, y: VOLCANO_TARGET_SIZE * 0.32, z: -0.18, reveal: 0.1 },
      { x: -0.24, y: VOLCANO_TARGET_SIZE * 0.35, z: 0.2, reveal: 0.15 },
    ],
    [],
  );

  useFrame(() => {
    const v = room.state?.volcanoes?.get(id) as VolcanoSchema | undefined;
    const g = group.current;
    if (!v || !g) {
      if (g) g.visible = false;
      if (scarRoot.current) scarRoot.current.visible = false;
      return;
    }
    g.visible = true;
    g.position.x = v.x;
    g.position.z = v.z;
    g.rotation.y = v.yaw ?? 0;
    if (scarRoot.current) {
      scarRoot.current.visible = true;
      scarRoot.current.position.x = v.x;
      scarRoot.current.position.z = v.z;
    }

    const phase = v.phase ?? "active";
    if (phase !== phaseRef.current) {
      phaseRef.current = phase;
      phaseStarted.current = performance.now();
    }
    const age = performance.now() - phaseStarted.current;
    const riseMs = VOLCANO_CAST.riseMs;
    const sinkMs = VOLCANO_CAST.sinkMs;
    const bury = VOLCANO_TARGET_SIZE * 1.05;
    let y = 0;
    let scale = 1;
    if (phase === "rising") {
      const u = Math.max(0, Math.min(1, age / riseMs));
      const e = 1 - (1 - u) * (1 - u);
      y = -bury * (1 - e);
      scale = 0.72 + 0.28 * e;
      opacityMul.current = 0.45 + 0.55 * e;
      progressRef.current = e;
      scarOpacity.current = 0.4 + 0.6 * e;
    } else if (phase === "sinking") {
      const u = Math.max(0, Math.min(1, age / sinkMs));
      const e = u * u;
      y = -bury * e;
      scale = 1 - 0.25 * e;
      opacityMul.current = softEnvelope(u, 0.05, 0.55);
      progressRef.current = 1 - e;
      scarOpacity.current = softEnvelope(u, 0.05, 0.4);
    } else {
      y = 0;
      scale = 1;
      opacityMul.current = 1;
      progressRef.current = 1;
      scarOpacity.current = 1;
    }
    g.position.y = y;
    g.scale.setScalar(scale);
  });

  if (!mesh) return null;
  return (
    <>
      <group ref={scarRoot}>
        <GroundDecal
          preset={groundPresets.earthSlam}
          shape="circle"
          x={0}
          z={0}
          y={0.03}
          born={scarBorn.current}
          life={GROUND_SCAR_LIFE_MS}
          radius={GROUND_SCAR_R}
          opacityMulRef={scarOpacity}
        />
      </group>
      <group ref={group}>
        <primitive object={mesh} />
        <FireParticleField
          emitters={fireEmitters}
          rate={42}
          maxParticles={90}
          maxLife={0.9}
          maxSize={0.22}
          rise={1.8}
          spread={0.4}
          opacityMulRef={opacityMul}
          progressRef={progressRef}
        />
      </group>
    </>
  );
}

/** Schema-synced erupting volcanoes. */
export function Volcanoes({ room }: { room: Room | null }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room?.state?.volcanoes) return;
    const next: string[] = [];
    room.state.volcanoes.forEach((_d: unknown, id: string) => next.push(id));
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
        <VolcanoMesh key={id} room={room} id={id} />
      ))}
    </>
  );
}
