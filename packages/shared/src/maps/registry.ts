/**
 * Map registry: one lookup that serves both document-based maps (authored in
 * the editor) and the existing baked maps (a single Blender GLB plus a
 * hand-written module).
 *
 * This exists so `ContentRoom.onCreate` and `ContentScene` stop branching on
 * `kind === "pvp"` / `mode === "dungeon"` to decide which colliders and scene
 * to use. Desert, cemetery and the hub stay on the baked path unchanged --
 * there is no migration, and both kinds work side by side indefinitely.
 */

import type { StaticCollider } from "../collision";
import {
  ARENA_SCENE_SCALE,
  ARENA_SCENE_URL,
  arenaFfaSpawnForTeam,
  arenaSpawnForSlot,
  arenaStaticColliders,
} from "../arenaDesert";
import {
  CEMETERY_SCENE_SCALE,
  CEMETERY_SCENE_URL,
  cemeteryPlayerSpawn,
  cemeteryStaticColliders,
} from "../cemeteryArena";
import {
  mapAttackableProps,
  mapNpcs,
  mapSpawnForSlot,
  mapStaticColliders,
  type MapDoc,
  type MapPropPlacement,
  type MapTeam,
} from "./mapDoc";
import type { NpcPlacement } from "./elements";

export type MapId = string;

export type SpawnPose = { x: number; z: number; yaw: number };

export type SpawnQuery = {
  team: MapTeam;
  /** Fighter index within the team. */
  slot: number;
  /**
   * Three solo teams sharing one arena. Only the baked desert cares: it remaps
   * to its corner pads. Document maps just author their own team C spawns.
   */
  ffa?: boolean;
};

export type MapSource =
  | { kind: "doc"; id: MapId; name: string; doc: MapDoc }
  | {
      kind: "baked";
      id: MapId;
      name: string;
      sceneUrl: string;
      sceneScale: number;
      /**
       * How the scene is vertically aligned. `mid` raycasts at the spawn
       * centroid (desert), `origin` at world zero (cemetery).
       */
      plant: "origin" | "mid";
      colliders: () => StaticCollider[];
      spawn: (q: SpawnQuery) => SpawnPose | undefined;
    };

const BAKED: MapSource[] = [
  {
    kind: "baked",
    id: "desert",
    name: "Desert Arena",
    sceneUrl: ARENA_SCENE_URL,
    sceneScale: ARENA_SCENE_SCALE,
    plant: "mid",
    colliders: arenaStaticColliders,
    spawn: ({ team, slot, ffa }) =>
      ffa
        ? arenaFfaSpawnForTeam(team)
        : // Only the FFA layout has a third corner; A/B arenas have no team C pad.
          team === "c"
          ? undefined
          : arenaSpawnForSlot(team, slot),
  },
  {
    kind: "baked",
    id: "cemetery",
    name: "Cemetery",
    sceneUrl: CEMETERY_SCENE_URL,
    sceneScale: CEMETERY_SCENE_SCALE,
    plant: "origin",
    colliders: cemeteryStaticColliders,
    // Coop PvE: pads are staggered by slot around centre, team is irrelevant.
    spawn: ({ slot }) => cemeteryPlayerSpawn(slot),
  },
];

const registry = new Map<MapId, MapSource>(BAKED.map((m) => [m.id, m]));

/**
 * Register a document-based map. The editor's output is loaded and registered
 * at startup rather than hardcoded here, so adding a map never means editing
 * this file.
 */
export function registerMapDoc(doc: MapDoc, name = doc.name): void {
  registry.set(doc.id, { kind: "doc", id: doc.id, name, doc });
}

export function getMapSource(id: MapId): MapSource | undefined {
  return registry.get(id);
}

export function listMaps(): MapSource[] {
  return [...registry.values()];
}

/** Static colliders for a map, whichever kind it is. Empty for unknown ids. */
export function mapCollidersFor(id: MapId): StaticCollider[] {
  const source = registry.get(id);
  if (!source) return [];
  return source.kind === "doc" ? mapStaticColliders(source.doc) : source.colliders();
}

/**
 * Attackable props a map contributes.
 *
 * Empty for baked maps, which predate the concept -- their scenery is one
 * welded GLB with no per-prop identity to hang health on.
 */
export function mapAttackablePropsFor(id: MapId): MapPropPlacement[] {
  const source = registry.get(id);
  if (!source || source.kind !== "doc") return [];
  return mapAttackableProps(source.doc);
}

/**
 * NPCs a map contributes. Empty for baked maps, which have no element layer.
 */
export function mapNpcsFor(id: MapId): NpcPlacement[] {
  const source = registry.get(id);
  if (!source || source.kind !== "doc") return [];
  return mapNpcs(source.doc);
}

/** A single NPC by element id, for validating an interact request. */
export function mapNpcFor(id: MapId, elementId: string): NpcPlacement | null {
  return mapNpcsFor(id).find((n) => n.id === elementId) ?? null;
}

/**
 * Spawn pose for a fighter, whichever kind of map it is.
 *
 * Callers get `undefined` when the map has no pad for that team/slot rather
 * than a silent origin fallback, so a map missing spawns surfaces as fighters
 * stacked at 0,0 in exactly one place instead of everywhere.
 */
export function mapSpawn(id: MapId, q: SpawnQuery): SpawnPose | undefined {
  const source = registry.get(id);
  if (!source) return undefined;
  if (source.kind === "baked") return source.spawn(q);
  const el = mapSpawnForSlot(source.doc, q.team, q.slot);
  return el ? { x: el.x, z: el.z, yaw: el.yaw } : undefined;
}
