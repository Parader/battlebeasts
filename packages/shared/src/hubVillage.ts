import type { StandKind } from "./stands";
import {
  BASE_CITY_PORTALS,
  BASE_CITY_STANDS,
  HUB_SPAWN_FALLBACK,
  type InteractZone,
  type PortalPadDef,
  type StandDef,
} from "./stands";
import type { StaticCollider } from "./collision";
import villageRaw from "./maps/village.map.json";
import {
  mapElementsOfType,
  mapNpcs,
  mapSpawnForSlot,
  mapStaticColliders,
  parseMapDoc,
} from "./maps/mapDoc";
import {
  defaultElementShape,
  elementType,
  paramString,
  type MapElement,
} from "./maps/elements";
import type { NpcPlacement } from "./maps/elements";

export { HUB_WORLD_SCALE, pointInInteractZone, interactZoneDist, type InteractZone } from "./stands";

/** Authored map the hub uses for geometry, collision and interact layout. */
export const HUB_MAP_ID = "village" as const;

const parsed = parseMapDoc(villageRaw);
if (!parsed.doc) {
  throw new Error(
    `Hub map "${HUB_MAP_ID}" failed to parse: ${parsed.errors.join("; ") || "unknown"}`,
  );
}
const HUB_DOC = parsed.doc;

/** Legacy baked village — login backdrop only; gameplay uses {@link HUB_MAP_ID}. */
export const HUB_SCENE_URL = `/assets/maps/village.glb?v=${encodeURIComponent(
  (villageRaw as { exportedAt?: string }).exportedAt ?? "1",
)}`;

/** Scale for the legacy GLB on the auth screen. */
export const HUB_SCENE_SCALE = 0.2;

const DEFAULT_HALF = 2.15;

function zoneFromElement(el: MapElement): InteractZone {
  const def = elementType(el.type);
  const shape = el.shape ?? (def ? defaultElementShape(def) : undefined);
  if (shape?.kind === "box") {
    return {
      x: el.x,
      z: el.z,
      halfX: shape.halfX,
      halfZ: shape.halfZ,
      rotationY: el.yaw ?? 0,
    };
  }
  if (shape?.kind === "circle") {
    const r = shape.radius;
    return { x: el.x, z: el.z, halfX: r, halfZ: r, rotationY: el.yaw ?? 0 };
  }
  return {
    x: el.x,
    z: el.z,
    halfX: DEFAULT_HALF,
    halfZ: DEFAULT_HALF,
    rotationY: el.yaw ?? 0,
  };
}

const STAND_TYPE_TO_KIND: Record<string, StandKind> = {
  stand_shop: "shop",
  stand_build: "build",
  stand_customization: "customization",
  stand_talent: "talent",
};

function standFromElement(el: MapElement): StandDef | null {
  const kind = STAND_TYPE_TO_KIND[el.type];
  if (!kind) return null;
  const fallback = BASE_CITY_STANDS.find((s) => s.kind === kind);
  return {
    id: el.type,
    kind,
    label: paramString(el, "label", fallback?.label ?? kind),
    ...zoneFromElement(el),
  };
}

/** Stands read from the village map document. */
export const HUB_STANDS: StandDef[] = (["shop", "build", "customization", "talent"] as StandKind[]).map(
  (kind) => {
    const typeId = Object.entries(STAND_TYPE_TO_KIND).find(([, k]) => k === kind)?.[0];
    const el = typeId ? mapElementsOfType(HUB_DOC, typeId)[0] : undefined;
    if (el) {
      const stand = standFromElement(el);
      if (stand) return stand;
    }
    return BASE_CITY_STANDS.find((s) => s.kind === kind)!;
  },
);

/** Portals read from the village map document. */
export const HUB_PORTALS: PortalPadDef[] = (
  [
    { type: "portal_pvp", kind: "pvp" as const },
    { type: "portal_pve", kind: "pve" as const },
  ] as const
).map((spec) => {
  const el = mapElementsOfType(HUB_DOC, spec.type)[0];
  if (el) {
    const fallback = BASE_CITY_PORTALS.find((p) => p.kind === spec.kind)!;
    return {
      id: spec.type,
      kind: spec.kind,
      label: paramString(el, "label", fallback.label),
      ...zoneFromElement(el),
    };
  }
  return BASE_CITY_PORTALS.find((p) => p.kind === spec.kind)!;
});

/** Team A slot 0 (A0) in the hub map — where players join and respawn. */
const hubSpawnEl = mapSpawnForSlot(HUB_DOC, "a", 0);
export const HUB_SPAWN = hubSpawnEl
  ? { x: hubSpawnEl.x, z: hubSpawnEl.z }
  : { ...HUB_SPAWN_FALLBACK };

export type PracticeDummyDef = InteractZone & {
  id: string;
  /** If false, dummy never retaliates (training dummy on the left). */
  retaliates?: boolean;
};

const dummyEls = mapElementsOfType(HUB_DOC, "practice_dummy");
/** Practice dummies authored into the hub map; empty when none are placed. */
export const HUB_PRACTICE_DUMMIES: PracticeDummyDef[] =
  dummyEls.length > 0
    ? (() => {
        const zones = dummyEls.map((d, i) => ({
          id: i === 0 ? "practice_dummy" : `practice_dummy_${i}`,
          ...zoneFromElement(d),
        }));
        const leftX = Math.min(...zones.map((z) => z.x));
        return zones.map((z) => ({
          ...z,
          retaliates: z.x > leftX + 1e-4,
        }));
      })()
    : [];

/** @deprecated Prefer HUB_PRACTICE_DUMMIES — first dummy when the map defines one. */
export const HUB_PRACTICE_DUMMY = HUB_PRACTICE_DUMMIES[0];

/** NPCs placed in the village hub map. */
export const HUB_NPCS: readonly NpcPlacement[] = mapNpcs(HUB_DOC);

/** Ground extent for legacy helpers (sky/fog tuning). */
export const HUB_GROUND_SIZE =
  HUB_DOC.ground.kind === "painted" || HUB_DOC.ground.kind === "plane"
    ? Math.max(HUB_DOC.ground.sizeX, HUB_DOC.ground.sizeZ)
    : 360;

/** @deprecated Prefer {@link STAND_INTERACT_RADIUS} — rough pad radius fallback. */
export const STAND_INTERACT_RADIUS = DEFAULT_HALF;

/** Painted-ground splat for hub preload (null when the hub uses a flat plane). */
export const HUB_SPLAT_URL =
  HUB_DOC.ground.kind === "painted" && HUB_DOC.ground.splatUrl
    ? `/${HUB_DOC.ground.splatUrl}`
    : null;

/** Cached hub solids — props + walls from the authored map. */
let hubStaticsCache: StaticCollider[] | null = null;

/** All solid hub obstacles for movement. */
export function hubStaticColliders(): StaticCollider[] {
  if (hubStaticsCache) return hubStaticsCache;
  hubStaticsCache = mapStaticColliders(HUB_DOC);
  return hubStaticsCache;
}

/** @deprecated Use {@link hubStaticColliders}; kept for callers expecting wall-only segs. */
export function hubWallColliders() {
  return hubStaticColliders().filter((c) => c.shape === "walls");
}
