import {
  ARENA_SPAWNS,
  getMapSource,
  propUrlForKey,
  type MapDoc,
  type MapPropPlacement,
  type MapSource,
} from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { assetUrl } from "./assetUrl";
import { DocNpcs } from "./DocNpcs";
import { reportMapPropMounted, reportMapPropUnmounted } from "./mapPropMountGate";
import { PaintedGround, type HeightGrid } from "./PaintedGround";

/**
 * Renders whichever map a room is running, resolved through the shared
 * registry.
 *
 * Document maps instance repeated props into spatial tiles. Instancing shares
 * one geometry buffer per prop type (low memory) while tiling keeps frustum
 * culling local so off-screen props are not submitted every frame.
 */

// --- baked ------------------------------------------------------------------

/**
 * Drop the scene so its surface sits at y=0, sampled by a downward ray.
 *
 * `at` matters because the two baked maps are modelled differently: cemetery
 * is flat at the origin, while the desert bowl dips, so sampling at the spawn
 * centroid keeps fighters level instead of sunk.
 */
function plantAt(root: THREE.Object3D, at: { x: number; z: number }) {
  root.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o);
  });
  if (meshes.length === 0) return;
  const hits = new THREE.Raycaster(
    new THREE.Vector3(at.x, 200, at.z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObjects(meshes, false);
  const hit = hits[0];
  if (hit && Number.isFinite(hit.point.y)) root.position.y -= hit.point.y;
}

function spawnCentroid(): { x: number; z: number } {
  if (ARENA_SPAWNS.length === 0) return { x: 0, z: 0 };
  return {
    x: ARENA_SPAWNS.reduce((s, p) => s + p.x, 0) / ARENA_SPAWNS.length,
    z: ARENA_SPAWNS.reduce((s, p) => s + p.z, 0) / ARENA_SPAWNS.length,
  };
}

function BakedMap({ source }: { source: Extract<MapSource, { kind: "baked" }> }) {
  const url = assetUrl(source.sceneUrl.replace(/^\//, ""));
  const gltf = useGLTF(url);

  const scene = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    root.scale.setScalar(source.sceneScale);
    root.updateMatrixWorld(true);
    plantAt(root, source.plant === "mid" ? spawnCentroid() : { x: 0, z: 0 });
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Huge ground planes casting shadows crush albedo into mud; props still cast.
      const name = `${mesh.name} ${mesh.parent?.name ?? ""}`.toLowerCase();
      const isGround =
        name.includes("ground") || name.includes("terrain") || name.includes("floor");
      mesh.castShadow = !isGround;
      mesh.receiveShadow = true;
    });
    return root;
  }, [gltf.scene, source.sceneScale, source.plant]);

  return <primitive object={scene} />;
}

// --- document ---------------------------------------------------------------

function DocGround({ doc }: { doc: MapDoc }) {
  const g = doc.ground;

  if (g.kind === "mesh") return <MeshGround url={g.url} scale={g.scale} at={g.plantAt} />;
  if (g.kind === "painted") return <PaintedDocGround ground={g} />;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <planeGeometry args={[g.sizeX, g.sizeZ]} />
      <meshStandardMaterial color="#6f7a52" roughness={1} metalness={0} />
    </mesh>
  );
}

/**
 * Painted terrain, driven by the sidecars the editor saved next to the map.
 *
 * A map with no splat yet renders as its base material rather than failing --
 * that is the state every map is in before anyone paints it.
 */
function PaintedDocGround({ ground }: { ground: Extract<MapDoc["ground"], { kind: "painted" }> }) {
  const splat = useSidecarTexture(ground.splatUrl);
  const heights = useHeightData(ground.heightUrl, ground.heightScale);
  if (!splat) return null;
  return <PaintedGround ground={ground} splat={splat} heights={heights} />;
}

/** The splat map, or a solid base-layer fallback when the map is unpainted. */
function useSidecarTexture(url: string | undefined): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fallback = () => {
      // One texel of pure layer 0 -- the shader normalises, so size is moot.
      const data = new Uint8Array([255, 0, 0, 255]);
      const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      t.needsUpdate = true;
      return t;
    };

    if (!url) {
      setTex(fallback());
      return;
    }

    new THREE.TextureLoader().load(
      assetUrl(url.replace(/^\//, "")),
      (t) => {
        if (cancelled) return;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        setTex(t);
      },
      undefined,
      () => {
        if (!cancelled) setTex(fallback());
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  return tex;
}

/**
 * Height samples decoded to the flat array `PaintedGround` bakes into geometry.
 *
 * Skipped entirely when the map has no height range, which avoids decoding an
 * image only to displace every vertex by zero.
 */
function useHeightData(url: string | undefined, heightScale: number): HeightGrid | null {
  const [heights, setHeights] = useState<HeightGrid | null>(null);

  useEffect(() => {
    if (!url || heightScale <= 0) {
      setHeights(null);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(assetUrl(url.replace(/^\//, "")));
        if (!res.ok) throw new Error(String(res.status));
        const bitmap = await createImageBitmap(await res.blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const out = new Float32Array(bitmap.width * bitmap.height);
        for (let i = 0; i < out.length; i++) out[i] = (data[i * 4] ?? 128) / 255;
        if (!cancelled) setHeights({ data: out, resX: bitmap.width, resZ: bitmap.height });
      } catch {
        // Flat is a fine fallback; a missing height map is not worth a blank map.
        if (!cancelled) setHeights(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, heightScale]);

  return heights;
}

function MeshGround({
  url,
  scale,
  at,
}: {
  url: string;
  scale: number;
  at: { x: number; z: number };
}) {
  const gltf = useGLTF(assetUrl(url.replace(/^\//, "")));
  const scene = useMemo(() => {
    const root = cloneSkinned(gltf.scene);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.receiveShadow = true;
    });
    return root;
  }, [gltf.scene]);

  return (
    <group position={[-at.x * scale, 0, -at.z * scale]} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}

function DocMap({ doc }: { doc: MapDoc }) {
  const byProp = useMemo(() => {
    const groups = new Map<string, MapPropPlacement[]>();
    for (const p of doc.props) {
      const list = groups.get(p.prop);
      if (list) list.push(p);
      else groups.set(p.prop, [p]);
    }
    return [...groups.entries()];
  }, [doc.props]);

  return (
    <>
      <DocGround doc={doc} />
      <Suspense fallback={null}>
        <DocNpcs doc={doc} />
      </Suspense>
      {byProp.map(([propKey, placements]) => (
        <Suspense key={propKey} fallback={null}>
          <InstancedProp
            mapId={doc.id}
            propKey={propKey}
            placements={placements}
          />
        </Suspense>
      ))}
    </>
  );
}

/** World matrix for one placement, matching the editor's group transform. */
function placementMatrix(p: MapPropPlacement): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(p.pitch ?? 0, p.yaw, p.roll ?? 0, "YXZ"),
    ),
    new THREE.Vector3(p.scale, p.scale, p.scale),
  );
  const px = p.pivotX ?? 0;
  const pz = p.pivotZ ?? 0;
  if (px !== 0 || pz !== 0) {
    m.multiply(new THREE.Matrix4().makeTranslation(-px, 0, -pz));
  }
  return m;
}

const CULL_TILE_M = 48;
const MIN_INSTANCES_TO_TILE = 8;

function tilePlacements(placements: MapPropPlacement[]): MapPropPlacement[][] {
  if (placements.length < MIN_INSTANCES_TO_TILE) return [placements];

  const tiles = new Map<string, MapPropPlacement[]>();
  for (const p of placements) {
    const key = `${Math.floor(p.x / CULL_TILE_M)}:${Math.floor(p.z / CULL_TILE_M)}`;
    const list = tiles.get(key);
    if (list) list.push(p);
    else tiles.set(key, [p]);
  }
  return tiles.size > 1 ? [...tiles.values()] : [placements];
}

function InstancedProp({
  mapId,
  propKey,
  placements,
}: {
  mapId: string;
  propKey: string;
  placements: MapPropPlacement[];
}) {
  const gltf = useGLTF(assetUrl(propUrlForKey(propKey)));

  const parts = useMemo(() => {
    const source = gltf.scene;
    source.updateMatrixWorld(true);

    const out: Array<{
      geometry: THREE.BufferGeometry;
      material: THREE.Material | THREE.Material[];
      local: THREE.Matrix4;
    }> = [];

    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      out.push({
        geometry: mesh.geometry,
        material: mesh.material,
        local: mesh.matrixWorld.clone(),
      });
    });
    return out;
  }, [gltf.scene]);

  const tiles = useMemo(
    () => tilePlacements(placements).map((tile) => tile.map(placementMatrix)),
    [placements],
  );

  // Signal after this prop type's InstancedMeshes are in the React tree so
  // hub shader warmup can compile the real USE_INSTANCING programs.
  useEffect(() => {
    reportMapPropMounted(mapId, propKey);
    return () => reportMapPropUnmounted(mapId, propKey);
  }, [mapId, propKey, parts, tiles]);

  return (
    <>
      {tiles.map((matrices, t) =>
        parts.map((part, i) => (
          <InstancedPart
            key={`${t}:${i}`}
            geometry={part.geometry}
            material={part.material}
            local={part.local}
            matrices={matrices}
          />
        )),
      )}
    </>
  );
}

function InstancedPart({
  geometry,
  material,
  local,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
  matrices: THREE.Matrix4[];
}) {
  const mesh = useMemo(() => {
    const inst = new THREE.InstancedMesh(geometry, material, matrices.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < matrices.length; i++) {
      m.copy(matrices[i]!).multiply(local);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    return inst;
  }, [geometry, material, local, matrices]);

  useEffect(() => () => mesh.dispose(), [mesh]);

  return <primitive object={mesh} />;
}

// --- entry ------------------------------------------------------------------

export function MapScene({ mapId }: { mapId: string }) {
  const source = getMapSource(mapId);
  if (!source) {
    console.warn(`[MapScene] unknown map "${mapId}" -- rendering nothing`);
    return null;
  }
  return source.kind === "baked" ? <BakedMap source={source} /> : <DocMap doc={source.doc} />;
}
