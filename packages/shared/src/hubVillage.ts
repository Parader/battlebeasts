import type { StandKind } from "./stands";
import {
  BASE_CITY_PORTALS,
  BASE_CITY_STANDS,
  HUB_WORLD_SCALE,
  HUB_SPAWN_FALLBACK,
  PORTAL_RING_COLLIDE_RADIUS,
  PORTAL_TORUS_MAJOR,
  PRACTICE_DUMMY,
  type InteractZone,
  type PortalPadDef,
  type StandDef,
} from "./stands";
import type { CircleCollider, StaticCollider, WallCollider } from "./collision";
import villageMarkers from "./maps/main_village.markers.json";
import villageWalls from "./maps/main_village.walls.json";

export { HUB_WORLD_SCALE };
export {
  pointInInteractZone,
  interactZoneDist,
  type InteractZone,
} from "./stands";

/** Single-scene hub visual (Blender Collection → glTF). */
export const HUB_SCENE_URL = "/assets/maps/village.glb";

/**
 * Blender village is authored at oversized RTS placement sizes.
 * Uniform scale for the GLB + markers + wall segments (keep in sync).
 */
export const HUB_SCENE_SCALE = 0.2;

type MarkerDoc = {
  version?: number;
  markers?: Array<{
    id: string;
    kind: string;
    x: number;
    z: number;
    halfX?: number;
    halfZ?: number;
    rotationY?: number;
    label?: string | null;
  }>;
};

type WallsDoc = {
  version?: number;
  walls?: Array<{
    id: string;
    segs: number[];
  }>;
};

const markersDoc = villageMarkers as MarkerDoc;
const wallsDoc = villageWalls as WallsDoc;
const S = HUB_SCENE_SCALE;
/** Fallback pad when a marker has no empty box size. */
const DEFAULT_HALF = 2.15;

function sx(v: number) {
  return v * S;
}

function zoneFromMarker(m: NonNullable<MarkerDoc["markers"]>[number]): InteractZone {
  return {
    x: sx(m.x),
    z: sx(m.z),
    halfX: sx(m.halfX ?? DEFAULT_HALF / S),
    halfZ: sx(m.halfZ ?? DEFAULT_HALF / S),
    rotationY: m.rotationY ?? 0,
  };
}

function interactsOf(kind: string) {
  return (markersDoc.markers ?? []).filter((i) => i.kind === kind);
}

function firstInteract(kind: string) {
  return interactsOf(kind)[0];
}

/**
 * @deprecated Prefer oriented {@link InteractZone} half-extents from empty boxes.
 * Kept as a rough radius fallback for legacy callers.
 */
export const STAND_INTERACT_RADIUS = DEFAULT_HALF;

/** Ground plane size from markers + wall extents. */
function computeGroundSize(): number {
  let max = 40;
  for (const m of markersDoc.markers ?? []) {
    max = Math.max(max, Math.abs(sx(m.x)), Math.abs(sx(m.z)));
  }
  for (const w of wallsDoc.walls ?? []) {
    for (let i = 0; i < w.segs.length; i++) {
      max = Math.max(max, Math.abs(sx(w.segs[i]!)));
    }
  }
  return Math.max(40, Math.ceil(max * 2 + 24));
}

export const HUB_GROUND_SIZE = computeGroundSize();

const STAND_KIND_TO_ID: Record<StandKind, string> = {
  shop: "stand_shop",
  build: "stand_build",
  customization: "stand_customization",
  talent: "stand_talent",
};

/** Stands driven by Blender Interact empties when present. */
export const HUB_STANDS: StandDef[] = (["shop", "build", "customization", "talent"] as StandKind[]).map(
  (kind) => {
    const fromMap = firstInteract(kind);
    const fallback = BASE_CITY_STANDS.find((s) => s.kind === kind)!;
    if (fromMap) {
      return {
        id: STAND_KIND_TO_ID[kind],
        kind,
        label: fromMap.label ?? fallback.label,
        ...zoneFromMarker(fromMap),
      };
    }
    return fallback;
  },
);

/** Portals from map Interact markers. */
export const HUB_PORTALS: PortalPadDef[] = (
  [
    { kind: "portal_pvp", id: "portal_pvp", label: "PvP Portal", fallbackKind: "pvp" },
    { kind: "portal_pve", id: "portal_pve", label: "PvE Portal", fallbackKind: "pve" },
  ] as const
).map((spec) => {
  const fromMap = firstInteract(spec.kind);
  const fallback = BASE_CITY_PORTALS.find((p) => p.id === spec.id)!;
  if (fromMap) {
    return {
      id: spec.id,
      kind: spec.fallbackKind,
      label: fromMap.label ?? spec.label,
      ...zoneFromMarker(fromMap),
    };
  }
  return fallback;
});

const spawnIx = firstInteract("spawn");
export const HUB_SPAWN = spawnIx
  ? { x: sx(spawnIx.x), z: sx(spawnIx.z) }
  : { ...HUB_SPAWN_FALLBACK };

export type PracticeDummyDef = InteractZone & {
  id: string;
  /** If false, dummy never retaliates (training dummy on the left). */
  retaliates?: boolean;
};

const dummyMarks = interactsOf("dummy");
export const HUB_PRACTICE_DUMMIES: PracticeDummyDef[] =
  dummyMarks.length > 0
    ? (() => {
        const zones = dummyMarks.map((d, i) => ({
          id: i === 0 ? "practice_dummy" : `practice_dummy_${i}`,
          ...zoneFromMarker(d),
        }));
        const leftX = Math.min(...zones.map((z) => z.x));
        return zones.map((z) => ({
          ...z,
          // Left pad is passive practice; right one fights back.
          retaliates: z.x > leftX + 1e-4,
        }));
      })()
    : [
        {
          id: "practice_dummy",
          x: PRACTICE_DUMMY.x,
          z: PRACTICE_DUMMY.z,
          halfX: DEFAULT_HALF,
          halfZ: DEFAULT_HALF,
          rotationY: 0,
          retaliates: false,
        },
      ];

/** @deprecated Prefer HUB_PRACTICE_DUMMIES — first dummy for single-target APIs. */
export const HUB_PRACTICE_DUMMY = HUB_PRACTICE_DUMMIES[0]!;

/** Vertical portal torus: only left/right legs block on XZ. */
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

export function hubWallColliders(): WallCollider[] {
  return (wallsDoc.walls ?? []).map((w) => ({
    id: w.id,
    shape: "walls" as const,
    segs: Float32Array.from(w.segs.map(sx)),
  }));
}

/** All solid hub obstacles for movement (Bezier walls + portal rings).
 * Practice dummies are not static — walk solids come from live `state.targets`. */
export function hubStaticColliders(): StaticCollider[] {
  const walls = hubWallColliders();
  const circles: CircleCollider[] = [...HUB_PORTALS.flatMap(portalRingColliders)];
  return [...circles, ...walls];
}
