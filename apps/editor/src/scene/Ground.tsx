import { groundMaterial, layoutFromGround, tilesWithin, ZONE_WARM_RADIUS, type MapDoc } from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { assetUrl } from "@web/game/assetUrl";
import { PaintedGround } from "@web/game/PaintedGround";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { terrain, type TerrainTile } from "../state/terrain";
import { bindEditorLayout, useEditorFocus } from "./viewFocus";

/** Editor displacement lattice. Splat/height buffers stay at document res. */
const EDITOR_GROUND_MESH_SEGS = 160;

/**
 * The ground surface, and the raycast target every placement tool plants
 * against.
 *
 * Painted ground renders through the game's own `PaintedGround`, driven by the
 * editor's live splat and height buffers, so what you paint here is literally
 * the same shader that runs in a match. A tiled zone draws the neighbourhood
 * around the camera; the other tiles stay in memory and come in as you pan.
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
  const known = !!groundMaterial(material);
  return (
    <mesh
      name={GROUND_NAME}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
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

function LiveTile({
  tile,
  ground,
}: {
  tile: TerrainTile;
  ground: Extract<MapDoc["ground"], { kind: "painted" }>;
}) {
  const raised = ground.heightScale > 0 && tile.hasHeight && tile.heights != null;
  const heights = useMemo(
    () => (raised && tile.heights ? { data: tile.heights, resX: tile.resX, resZ: tile.resZ } : null),
    // The buffer is stable; the version says the samples changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tile, tile.heightVersion, raised],
  );
  const tileGround = useMemo(
    () => ({ ...ground, sizeX: tile.sizeX, sizeZ: tile.sizeZ, resX: tile.resX, resZ: tile.resZ }),
    [ground, tile.sizeX, tile.sizeZ, tile.resX, tile.resZ],
  );
  if (!tile.texture) return null;
  return (
    <PaintedGround
      ground={tileGround}
      splat={tile.texture}
      heights={heights}
      // Flat paint is a texture on a quad. The dense lattice is only for sculpt.
      maxMeshSegs={raised ? EDITOR_GROUND_MESH_SEGS : 1}
      skipNormals={terrain.stroking}
      offset={[tile.originX, tile.originZ]}
      splatMode="index"
      palette={terrain.paletteIds}
    />
  );
}

/**
 * Unpainted tiles: one repeating material, one quad each.
 *
 * No splat texture and no displaced lattice. A 1024 m map of base ground is a
 * handful of planes instead of dozens of 160² meshes.
 */
function SolidTiles({
  tiles,
  materialId,
}: {
  tiles: TerrainTile[];
  materialId: string;
}) {
  const sample = tiles[0];
  const def = groundMaterial(materialId);
  const [material, setMaterial] = useState<THREE.Material | null>(null);
  const fallback = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#6a7354", roughness: 1, metalness: 0 }),
    [],
  );

  useEffect(() => {
    if (!def || !sample) return;
    let dead = false;
    const loader = new THREE.TextureLoader();
    const diff = loader.load(assetUrl(def.diff));
    const nor = loader.load(assetUrl(def.nor));
    const prep = (tex: THREE.Texture, srgb: boolean) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(sample.sizeX / def.tile, sample.sizeZ / def.tile);
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = 4;
    };
    prep(diff, true);
    prep(nor, false);
    const next = new THREE.MeshStandardMaterial({ map: diff, normalMap: nor, roughness: 1, metalness: 0 });
    if (!dead) setMaterial(next);
    return () => {
      dead = true;
      diff.dispose();
      nor.dispose();
      next.dispose();
    };
  }, [def, sample, materialId]);

  useEffect(() => () => fallback.dispose(), [fallback]);

  if (!sample) return null;
  const mat = material ?? fallback;
  return (
    <>
      {tiles.map((tile) => (
        <mesh
          key={`${tile.tx}:${tile.tz}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[tile.originX, -0.002, tile.originZ]}
          material={mat}
          receiveShadow
        >
          <planeGeometry args={[tile.sizeX, tile.sizeZ]} />
        </mesh>
      ))}
    </>
  );
}

function PaintedTerrain({ ground }: { ground: Extract<MapDoc["ground"], { kind: "painted" }> }) {
  const revision = useSyncExternalStore(terrain.subscribe, () => terrain.revision);
  const focus = useEditorFocus();
  const layout = useMemo(() => layoutFromGround(ground), [ground]);
  useLayoutEffect(() => {
    if (!terrain.tiles.length) terrain.load({ ground } as MapDoc);
    bindEditorLayout(layout);
  }, [ground, layout]);

  const visible = useMemo(() => {
    if (!layout.tiled) return terrain.tiles;
    const wanted = new Set(tilesWithin(layout, focus.tx, focus.tz, ZONE_WARM_RADIUS).map((t) => `${t.tx}:${t.tz}`));
    return terrain.tiles.filter((tile) => wanted.has(`${tile.tx}:${tile.tz}`));
  }, [layout, focus.tx, focus.tz, revision]);

  if (!visible.length) return null;
  const solid = visible.filter((tile) => tile.solid);
  const painted = visible.filter((tile) => !tile.solid);
  return (
    <group name={GROUND_NAME}>
      {solid.length > 0 && <SolidTiles tiles={solid} materialId={terrain.baseId} />}
      {painted.map((tile) => (
        <LiveTile key={`${tile.tx}:${tile.tz}:${tile.resX}x${tile.resZ}:${tile.hasHeight ? "h" : "f"}`} tile={tile} ground={ground} />
      ))}
    </group>
  );
}

export function Ground({ doc }: { doc: MapDoc }) {
  const g = doc.ground;

  if (g.kind === "mesh") return <BlenderGround url={g.url} scale={g.scale} plantAt={g.plantAt} />;
  if (g.kind === "painted") return <PaintedTerrain ground={g} />;
  return <PlaneGround sizeX={g.sizeX} sizeZ={g.sizeZ} material={g.material} />;
}
