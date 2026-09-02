import { groundMaterial, type MapDoc } from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { PaintedGround } from "@web/game/PaintedGround";
import { useMemo, useSyncExternalStore } from "react";
import * as THREE from "three";
import { terrain } from "../state/terrain";

/**
 * The ground surface, and the raycast target every placement tool plants
 * against.
 *
 * Painted ground renders through the game's own `PaintedGround`, driven by the
 * editor's live splat and height buffers, so what you paint here is literally
 * the same shader that runs in a match.
 */

export const GROUND_NAME = "__editor_ground";

function BlenderGround({ url, scale, plantAt }: { url: string; scale: number; plantAt: { x: number; z: number } }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  return (
    <group position={[-plantAt.x * scale, 0, -plantAt.z * scale]} scale={scale}>
      <primitive object={scene} name={GROUND_NAME} />
    </group>
  );
}

/** Flat plane with one tiling material -- blockouts and simple maps. */
function PlaneGround({ sizeX, sizeZ, material }: { sizeX: number; sizeZ: number; material: string }) {
  // Falls back to a flat colour when the id is unknown, rather than failing to
  // render the one surface every tool raycasts against.
  const known = !!groundMaterial(material);
  return (
    <mesh
      name={GROUND_NAME}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      // Nudged below y=0 so coplanar decals and the grid do not z-fight.
      position={[0, -0.002, 0]}
    >
      <planeGeometry args={[sizeX, sizeZ]} />
      <meshStandardMaterial
        color={known ? "#8a8570" : "#6f7a52"}
        roughness={1}
        metalness={0}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

function PaintedTerrain({ ground }: { ground: Extract<MapDoc["ground"], { kind: "painted" }> }) {
  // Re-read on every terrain mutation so brush strokes show up immediately.
  useSyncExternalStore(terrain.subscribe, () => terrain.heightVersion);
  const splat = terrain.texture;

  // The live buffer, not a copy. `PaintedGround` reads it synchronously in a
  // layout effect and keeps nothing, so there is no aliasing to guard against
  // -- and copying a quarter-megabyte on every dab of a sculpt brush was pure
  // overhead. A fresh wrapper object per version is what triggers the update.
  const heights = useMemo(
    () =>
      ground.heightScale > 0
        ? { data: terrain.heights, resX: terrain.resX, resZ: terrain.resZ }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the version counter
    [terrain.heightVersion, ground.heightScale],
  );

  if (!splat) return null;
  return <PaintedGround ground={ground} splat={splat} heights={heights} name={GROUND_NAME} />;
}

export function Ground({ doc }: { doc: MapDoc }) {
  const g = doc.ground;

  if (g.kind === "mesh") return <BlenderGround url={g.url} scale={g.scale} plantAt={g.plantAt} />;
  if (g.kind === "painted") return <PaintedTerrain ground={g} />;
  return <PlaneGround sizeX={g.sizeX} sizeZ={g.sizeZ} material={g.material} />;
}
