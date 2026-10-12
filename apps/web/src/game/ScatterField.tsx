import {
  expandScatter,
  forEachTile,
  layoutFromGround,
  placementTileKey,
  propUrlForKey,
  tileHeightUrl,
  tileKey,
  tileRect,
  sampleGridHeight,
  type MapDoc,
  type ScatterInstance,
} from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { assetUrl } from "./assetUrl";
import { dressEnvironmentObject } from "./environmentMotion";
import { reportMapPropMounted, reportMapPropUnmounted } from "./mapPropMountGate";
import { propGroupKey } from "./zoneFocus";

/**
 * Scatter patches as instanced draws.
 *
 * One batch per model per 48 m tile, with shadows and collision left off.
 * That is the whole saving versus planting each clump as its own prop.
 */

const CULL_TILE_M = 48;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pivot = new THREE.Matrix4();

type HeightGrid = { data: Float32Array; resX: number; resZ: number };

function instanceMatrix(inst: ScatterInstance): THREE.Matrix4 {
  _q.setFromEuler(new THREE.Euler(0, inst.yaw, 0, "YXZ"));
  _p.set(inst.x, inst.y, inst.z);
  _s.set(inst.scale, inst.scale, inst.scale);
  _m.compose(_p, _q, _s);
  if (inst.pivotX !== 0 || inst.pivotZ !== 0) {
    _m.multiply(_pivot.makeTranslation(-inst.pivotX, 0, -inst.pivotZ));
  }
  return _m;
}

async function loadHeight(url: string): Promise<HeightGrid | null> {
  try {
    const res = await fetch(assetUrl(url.replace(/^\//, "")));
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const out = new Float32Array(bitmap.width * bitmap.height);
    for (let i = 0; i < out.length; i++) out[i] = (data[i * 4] ?? 128) / 255;
    return { data: out, resX: bitmap.width, resZ: bitmap.height };
  } catch {
    return null;
  }
}

function useSurface(doc: MapDoc): ((x: number, z: number) => number) | null {
  const ground = doc.ground;
  const heightScale = ground.kind === "painted" ? ground.heightScale : 0;
  const [grids, setGrids] = useState<Map<string, HeightGrid> | null>(heightScale > 0 ? null : new Map());

  useEffect(() => {
    if (ground.kind !== "painted" || heightScale <= 0) {
      setGrids(new Map());
      return;
    }
    const layout = layoutFromGround(ground);
    let cancelled = false;
    void (async () => {
      const next = new Map<string, HeightGrid>();
      const jobs: Array<Promise<void>> = [];
      forEachTile(layout, ({ tx, tz }) => {
        const url = layout.tiled
          ? tileHeightUrl(doc.id, tx, tz)
          : ground.heightUrl;
        if (!url) return;
        jobs.push(
          loadHeight(url).then((grid) => {
            if (grid) next.set(tileKey(tx, tz), grid);
          }),
        );
      });
      await Promise.all(jobs);
      if (!cancelled) setGrids(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id, ground, heightScale]);

  return useMemo(() => {
    if (!grids || ground.kind !== "painted") return null;
    if (heightScale <= 0) return () => 0;
    const layout = layoutFromGround(ground);
    return (x: number, z: number) => {
      const tx = Math.min(layout.tilesX - 1, Math.max(0, Math.floor((x + layout.sizeX / 2) / layout.tileSizeX)));
      const tz = Math.min(layout.tilesZ - 1, Math.max(0, Math.floor((z + layout.sizeZ / 2) / layout.tileSizeZ)));
      const grid = grids.get(tileKey(tx, tz));
      if (!grid) return 0;
      const rect = tileRect(layout, tx, tz);
      const u = (x - rect.minX) / rect.sizeX;
      const v = (z - rect.minZ) / rect.sizeZ;
      return (sampleGridHeight(grid.data, grid.resX, grid.resZ, u, v) - 0.5) * 2 * heightScale;
    };
  }, [grids, ground, heightScale]);
}

function ScatterBatch({
  mapId,
  propKey,
  instances,
}: {
  mapId: string;
  propKey: string;
  instances: ScatterInstance[];
}) {
  const gltf = useGLTF(assetUrl(propUrlForKey(propKey)));
  const parts = useMemo(() => {
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    dressEnvironmentObject(source, propKey);
    const out: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }> = [];
    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      out.push({ geometry: mesh.geometry, material: mesh.material, local: mesh.matrixWorld.clone() });
    });
    return out;
  }, [gltf.scene, propKey]);

  const tiles = useMemo(() => {
    const groups = new Map<string, THREE.Matrix4[]>();
    for (const inst of instances) {
      const key = `${Math.floor(inst.x / CULL_TILE_M)}:${Math.floor(inst.z / CULL_TILE_M)}`;
      const list = groups.get(key);
      const matrix = instanceMatrix(inst).clone();
      if (list) list.push(matrix);
      else groups.set(key, [matrix]);
    }
    return [...groups.values()];
  }, [instances]);

  const meshes = useMemo(() => {
    const created: THREE.InstancedMesh[] = [];
    for (const matrices of tiles) {
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
        for (let i = 0; i < matrices.length; i++) {
          const world = matrices[i]!.clone();
          world.multiply(part.local);
          inst.setMatrixAt(i, world);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = false;
        inst.receiveShadow = false;
        inst.computeBoundingSphere();
        created.push(inst);
      }
    }
    return created;
  }, [parts, tiles]);

  useEffect(() => {
    reportMapPropMounted(mapId, propKey);
    return () => reportMapPropUnmounted(mapId, propKey);
  }, [mapId, propKey, meshes]);

  useEffect(() => () => {
    for (const mesh of meshes) mesh.dispose();
  }, [meshes]);

  return (
    <>
      {meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  );
}

export function DocScatter({ doc, admitted }: { doc: MapDoc; admitted: Set<string> | null }) {
  const surface = useSurface(doc);
  const batches = useMemo(() => {
    if (!surface || !doc.scatters.length) return [];
    const byProp = new Map<string, ScatterInstance[]>();
    const painted = doc.ground.kind === "painted";
    for (const field of doc.scatters) {
      for (const inst of expandScatter(field, surface)) {
        if (admitted && painted) {
          const tile = placementTileKey(doc.ground, inst.x, inst.z);
          if (!admitted.has(propGroupKey(tile, inst.prop))) continue;
        }
        const list = byProp.get(inst.prop);
        if (list) list.push(inst);
        else byProp.set(inst.prop, [inst]);
      }
    }
    return [...byProp.entries()];
  }, [doc, admitted, surface]);

  if (!batches.length) return null;
  return (
    <>
      {batches.map(([prop, instances]) => (
        <Suspense key={prop} fallback={null}>
          <ScatterBatch mapId={doc.id} propKey={prop} instances={instances} />
        </Suspense>
      ))}
    </>
  );
}
