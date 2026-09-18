import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { ROCK_WALL_CAST } from "@battlebeasts/shared";
import {
  ROCK_WALL_GLB_URL,
  instantiateRockWallPiles,
  warmRockWallAssets,
} from "./rockWallAsset";
import { useOccluderRef } from "../useOccluder";

type RockWallSchema = {
  x: number;
  z: number;
  yaw?: number;
  halfWidth?: number;
  halfThickness?: number;
  durability?: number;
};

const RISE_MS = 560;

function RockWallMesh({
  room,
  id,
  scene,
}: {
  room: Room;
  id: string;
  scene: THREE.Object3D;
}) {
  const root = useRef<THREE.Group>(null);
  const anim = useRef<THREE.Group>(null);
  const born = useRef(performance.now());
  useOccluderRef(root);

  const piles = useMemo(() => {
    warmRockWallAssets(scene);
    // Seed from id hash so each wall looks a bit different.
    let seed = 0;
    for (let i = 0; i < id.length; i++) seed = (seed + id.charCodeAt(i) * (i + 1)) % 97;
    return instantiateRockWallPiles(scene, seed);
  }, [scene, id]);

  useFrame(() => {
    const w = room.state?.rockWalls?.get(id) as RockWallSchema | undefined;
    const g = root.current;
    const a = anim.current;
    if (!w || !g || (w.durability ?? 0) <= 0) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.yaw ?? 0;

    if (!a) return;
    const age = performance.now() - born.current;
    const u = Math.max(0, Math.min(1, age / RISE_MS));
    const rise = 1 - (1 - u) * (1 - u);
    const bury = ROCK_WALL_CAST.wallHeight * 1.05;
    a.position.y = -bury * (1 - rise);
    // Animate parent only — never overwrite fitted pile scale.
    const pop = 0.78 + 0.22 * rise;
    a.scale.setScalar(pop);

    const shake = u < 1 ? (1 - u) * 0.08 : 0;
    for (const child of a.children) {
      const phase = (child.userData.phase as number) ?? 0;
      const baseY = (child.userData.baseY as number) ?? 0;
      const localU = Math.max(
        0,
        Math.min(1, (u - phase * 0.4) / Math.max(0.01, 1 - phase * 0.4)),
      );
      const wobble =
        localU < 1
          ? Math.sin((age * 0.05 + phase * 14) * Math.PI) * shake * 1.2
          : 0;
      child.position.y = baseY + wobble * 0.15;
      child.rotation.z = wobble * 0.2;
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={anim}>
        <primitive object={piles} />
      </group>
    </group>
  );
}

function RockWallsInner({ room }: { room: Room }) {
  const gltf = useGLTF(ROCK_WALL_GLB_URL);
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room.state?.rockWalls) return;
    const next: string[] = [];
    room.state.rockWalls.forEach((_d: unknown, id: string) => next.push(id));
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setIds(next);
    }
  });

  return (
    <>
      {ids.map((id) => (
        <RockWallMesh key={id} room={room} id={id} scene={gltf.scene} />
      ))}
    </>
  );
}

/**
 * Schema-synced Rock Wall — Forest Rock Pile 02 GLB row.
 * Local Suspense so a cold load never blanks the whole GameCanvas.
 */
export function RockWalls({ room }: { room: Room | null }) {
  if (!room) return null;
  return (
    <Suspense fallback={null}>
      <RockWallsInner room={room} />
    </Suspense>
  );
}
