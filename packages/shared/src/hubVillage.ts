import type { StandKind } from "./stands";
import {
  BASE_CITY_PORTALS,
  BASE_CITY_STANDS,
  HUB_WORLD_SCALE,
  PORTAL_RING_COLLIDE_RADIUS,
  PORTAL_TORUS_MAJOR,
  PRACTICE_DUMMY,
  type PortalPadDef,
} from "./stands";
import type { CircleCollider, MeshCollider, StaticCollider } from "./collision";
import { COLLISION, decodeMeshMask } from "./collision";
import villageProps from "./maps/main_village.props.json";

export { HUB_WORLD_SCALE };

/** Baked mesh footprint at asset scale=1 (see scripts/bake-hub-colliders.mjs). */
export type PropMeshLocal = {
  ox: number;
  oz: number;
  cell: number;
  cols: number;
  rows: number;
  mask: string;
  segs: number[];
  cx: number;
  cz: number;
  hx: number;
  hz: number;
};

/**
 * Prop from Blender `map.json` import (see scripts/import-village-map.mjs).
 * Mesh colliders baked via scripts/bake-hub-colliders.mjs.
 * Positions/scales already include HUB_WORLD_SCALE at runtime.
 */
export type HubPropPlacement = {
  id: string;
  file: string;
  x: number;
  z: number;
  scale: number;
  rotationY: number | "faceOrigin";
  /** Mesh footprint collider in local space (scale=1). Absent = no solid. */
  mesh?: PropMeshLocal;
};

/** Interactive stands ↔ buildings in the Blender village map. */
export const STAND_MAP_OBJECT_ID: Record<StandKind, string> = {
  shop: "modified_stand3",
  build: "Barracks_SecondAge_Level2",
  customization: "Houses_SecondAge_2_Level1",
  talent: "Temple_SecondAge_Level1",
};

const S = HUB_WORLD_SCALE;

/** All decorative + building props from the imported map (world-scaled). */
export const HUB_MAP_PROPS: HubPropPlacement[] = villageProps.props.map((p) => {
  const raw = p as {
    id: string;
    file: string;
    x: number;
    z: number;
    scale: number;
    rotationY: number;
    mesh?: PropMeshLocal;
  };
  return {
    id: raw.id,
    file: raw.file,
    x: raw.x * S,
    z: raw.z * S,
    scale: raw.scale * S,
    rotationY: raw.rotationY,
    mesh: raw.mesh,
  };
});

/** Interact distance around stand markers / portals (character-scale). */
export const STAND_INTERACT_RADIUS = 2.15;

/** Ground plane edge length covering the scaled village + margin. */
export const HUB_GROUND_SIZE = 28 * S;

/** Vertical portal torus (XY plane): only the left/right legs block on XZ. Center stays open. */
export function portalRingColliders(portal: PortalPadDef): CircleCollider[] {
  return [
    {
      id: `${portal.id}_leg_l`,
      x: portal.x - PORTAL_TORUS_MAJOR,
      z: portal.z,
      radius: PORTAL_RING_COLLIDE_RADIUS,
    },
    {
      id: `${portal.id}_leg_r`,
      x: portal.x + PORTAL_TORUS_MAJOR,
      z: portal.z,
      radius: PORTAL_RING_COLLIDE_RADIUS,
    },
  ];
}

function yawOf(prop: HubPropPlacement): number {
  if (prop.rotationY === "faceOrigin") return Math.atan2(-prop.x, -prop.z);
  return prop.rotationY;
}

/** Place a baked mesh footprint into world space. */
export function propToMeshCollider(prop: HubPropPlacement): MeshCollider | null {
  if (!prop.mesh) return null;
  const m = prop.mesh;
  return {
    id: prop.id,
    shape: "mesh",
    x: prop.x,
    z: prop.z,
    yaw: yawOf(prop),
    scale: prop.scale,
    cx: m.cx,
    cz: m.cz,
    hx: m.hx,
    hz: m.hz,
    ox: m.ox,
    oz: m.oz,
    cell: m.cell,
    cols: m.cols,
    rows: m.rows,
    mask: decodeMeshMask(m.mask),
    segs: Float32Array.from(m.segs),
  };
}

export function hubStandProps(): HubPropPlacement[] {
  const byId = new Map(HUB_MAP_PROPS.map((p) => [p.id, p]));
  return BASE_CITY_STANDS.map((s) => {
    const id = STAND_MAP_OBJECT_ID[s.kind];
    const fromMap = byId.get(id.replace(/[^a-zA-Z0-9_]/g, "_")) ?? byId.get(id);
    if (fromMap) return fromMap;
    return {
      id: s.id,
      file: "modified/stand1.glb",
      x: s.x,
      z: s.z,
      scale: S,
      rotationY: "faceOrigin" as const,
    };
  });
}

/** All solid hub obstacles for movement (map props + dummy + portal rings). */
export function hubStaticColliders(): StaticCollider[] {
  const fromMap: StaticCollider[] = [];
  for (const p of HUB_MAP_PROPS) {
    const mesh = propToMeshCollider(p);
    if (mesh) fromMap.push(mesh);
  }
  const circles: CircleCollider[] = [
    {
      id: "practice_dummy",
      x: PRACTICE_DUMMY.x,
      z: PRACTICE_DUMMY.z,
      radius: COLLISION.dummyRadius,
    },
    ...BASE_CITY_PORTALS.flatMap(portalRingColliders),
  ];
  return [...circles, ...fromMap];
}
