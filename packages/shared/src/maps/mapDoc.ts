/**
 * Map documents: the data format the editor writes and the runtime reads.
 *
 * Replaces the bespoke per-map TypeScript module (see `arenaDesert.ts`, where
 * rock colliders are literal constants and team/facing are derived from a
 * spawn index). Everything here is plain JSON so the editor can snapshot it
 * for undo and git can diff it.
 *
 * Authoring is in world units at final scale -- there is no equivalent of
 * `ARENA_SCENE_SCALE`.
 */

import type {
  BoxCollider,
  CircleCollider,
  ProjectilePermeable,
  StaticCollider,
  WallCollider,
} from "../collision";
import { COLLISION, localToWorldXZ } from "../collision";
import { DEFAULT_GROUND_LAYERS } from "./groundMaterials";
import type {
  MapElement,
  MapElementParams,
  MapElementShape,
  NpcPlacement,
} from "./elements";
import {
  defaultElementParams,
  defaultElementShape,
  elementType,
  npcPlacement,
  paramNumber,
  paramString,
  pickupSpec,
} from "./elements";

/** Widest passage a player cannot fit through (diameter + separation skin). */
export const MIN_PASSABLE_GAP = COLLISION.playerRadius * 2 + COLLISION.skin;

// --- Colliders --------------------------------------------------------------

/**
 * Collider fitted to a prop, in PROP-LOCAL units (before placement scale).
 * Produced by scripts/gen-prop-manifest.mjs from the model's base slice and
 * baked into the document at save time, so the runtime needs no manifest.
 */
export type MapColliderSpec =
  | { mode: "none" }
  | ({ mode: "circle"; radius: number } & ColliderOffset & ProjectilePermeable)
  | ({ mode: "box"; halfX: number; halfZ: number; yaw?: number } & ColliderOffset &
      ProjectilePermeable);

/**
 * Where the collider sits relative to the prop's centre, in prop-local metres.
 *
 * Measured from the centre because that is what a placement's `x`/`z` means
 * once `pivotX`/`pivotZ` are subtracted. Fitting the collider to the base slice
 * gets the right *size*, but a tree's trunk or a house's footprint is not
 * always under the middle of the silhouette, so the remainder is recorded here.
 *
 * Rotated by the placement's yaw and multiplied by its scale at resolve time,
 * so a turned or resized prop keeps its collider aligned. Omitted when zero.
 */
export type ColliderOffset = { offsetX?: number; offsetZ?: number };

// --- Ground -----------------------------------------------------------------

export type MapGround =
  /** Editor-generated, painted surface. Height is baked into geometry on load. */
  | {
      kind: "painted";
      /** Extent in metres along X (width) and Z (depth). Centred on the origin. */
      sizeX: number;
      sizeZ: number;
      /**
       * Splat / height grid, in texels per axis.
       *
       * Stored per-axis rather than as one number so a long map keeps square
       * texels instead of stretching its paint along the longer side.
       */
      resX: number;
      resZ: number;
      /** Up to 4 material ids, one per RGBA splat channel. */
      layers: string[];
      splatUrl?: string;
      heightUrl?: string;
      /**
       * Peak displacement in metres. Clamped low on purpose: collision is
       * XZ-only and cursor aim raycasts a mathematical y=0 plane, so ground
       * must stay visually bumpy rather than traversable.
       */
      heightScale: number;
    }
  /** Flat plane with a single tiling material. Blockouts and simple maps. */
  | { kind: "plane"; sizeX: number; sizeZ: number; material: string }
  /** Escape hatch: bespoke Blender geometry, planted so `plantAt` sits at y=0. */
  | { kind: "mesh"; url: string; scale: number; plantAt: { x: number; z: number } };

/** Hard ceiling on `heightScale`, enforced by the parser. */
export const MAX_GROUND_HEIGHT_SCALE = 0.5;

/**
 * Per-axis texel ceiling.
 *
 * The splat is RGBA and the height map is one float per texel, both held in
 * memory while editing and both round-tripped as PNGs, so the grid cost is
 * quadratic. 512 on a side is already a 1 MB splat.
 */
export const MAX_GROUND_RES = 512;

/** Default splat/height texels per metre when creating or resizing ground. */
export const GROUND_TEXELS_PER_M = 3.2;

/** Texel counts for an extent, keeping texels square and within the cap. */
export function groundResFor(
  sizeX: number,
  sizeZ: number,
  texelsPerM = GROUND_TEXELS_PER_M,
): { resX: number; resZ: number } {
  // Scale both axes by the same factor if either would blow the cap, so the
  // grid stays square-texelled rather than squashing one side.
  const longest = Math.max(sizeX, sizeZ, 1);
  const density = Math.min(texelsPerM, MAX_GROUND_RES / longest);
  return {
    resX: Math.max(2, Math.min(MAX_GROUND_RES, Math.round(sizeX * density))),
    resZ: Math.max(2, Math.min(MAX_GROUND_RES, Math.round(sizeZ * density))),
  };
}

export type MapEnv = {
  skyPreset?: string;
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
};

// --- Entities ---------------------------------------------------------------

/**
 * Authoring-time grouping: entities sharing a `group` move and select as one.
 *
 * Purely editorial -- nothing at runtime reads it. It lives in the document
 * rather than a sidecar so that a market stall assembled from twelve pieces
 * survives a save and stays one thing to whoever opens the map next.
 *
 * Membership is flat. Grouping a selection that already contains groups
 * dissolves them into the new one, because nested groups need a tree of
 * expansion rules to answer "what did I just click", and a map editor gains
 * little from that over simply regrouping.
 */
type Groupable = {
  group?: string;
};

export type MapPropPlacement = Groupable & {
  id: string;
  /** Manifest key, e.g. `forest/PP_Fir_Tree_17`. */
  prop: string;
  x: number;
  /** Written by the editor from a raycast onto the ground surface. */
  y: number;
  z: number;
  yaw: number;
  /**
   * Tilt, in radians, applied as an XYZ euler alongside `yaw`. Purely visual:
   * collision is XZ-only, so a tipped-over pillar still blocks on its upright
   * footprint. Needed for modular kit pieces -- sloped roofs, leaning fences,
   * rubble -- and omitted from the JSON when zero to keep diffs quiet.
   */
  pitch?: number;
  roll?: number;
  scale: number;
  /**
   * Where the model's own origin sits relative to its geometric centre, in
   * prop-local metres.
   *
   * Kit models are rarely built around their pivot -- a house whose origin is
   * at a corner, a wall segment whose origin is at one end. Renderers subtract
   * this, which makes `x`/`z` mean "where the prop appears" rather than "where
   * its pivot happens to be". That is what lets rotation spin a prop in place
   * instead of swinging it around a point off in space, and it is why the
   * collider stays on the mesh at every angle.
   *
   * Absent means zero, so documents written before pivots existed still render
   * exactly as they did: their colliders were measured from the origin, and
   * with no pivot to subtract that is still where they land.
   */
  pivotX?: number;
  pivotZ?: number;
  collider: MapColliderSpec;
  /**
   * Hit points, when the prop is a target players can attack.
   *
   * Absent -- the overwhelming case -- means scenery: the prop is a collider
   * and nothing more. Any positive value promotes it to a world target with
   * its own health bar, hittable by every ability, which is how a straw dummy
   * or a training post becomes usable without modelling an NPC for it.
   *
   * Reaching zero refills rather than destroys. These are practice targets,
   * and a map whose dummies evaporate on the first pull is a map you can only
   * train on once. The collider is therefore permanent, which also spares the
   * runtime from rebuilding its static collider list mid-match.
   */
  hp?: number;
};

export type MapWall = ProjectilePermeable &
  Groupable & {
    id: string;
    closed: boolean;
    /** World-space XZ polyline. */
    points: Array<[number, number]>;
  };

export type MapTeam = "a" | "b" | "c";

export type MapDoc = {
  version: 1;
  id: string;
  name: string;
  ground: MapGround;
  env: MapEnv;
  props: MapPropPlacement[];
  walls: MapWall[];
  /**
   * Spawns, hub stands, portals, objectives -- everything interactive. One
   * open-ended list rather than a field per concept; see `elements.ts`.
   */
  elements: MapElement[];
  /**
   * Playability warnings the author has judged acceptable, by
   * `mapWarningKey`. Two decorative flowers overlapping is a real geometric
   * finding and a false alarm at the same time; muting it here keeps the
   * report short enough to stay worth reading.
   *
   * Errors are never suppressible -- only `severity: "warning"` consults this.
   */
  suppressedWarnings?: string[];
};

export const MAP_DOC_VERSION = 1;

// --- Derivation -------------------------------------------------------------

/** Prop manifest key to its served URL. Mechanical, so no manifest at runtime. */
export function propUrlForKey(key: string): string {
  return `/assets/props/${key}.glb`;
}

/**
 * Convert an XZ polyline to the flat `[ax,az,bx,bz,...]` segment buffer that
 * `WallCollider` expects. Mirrors the private helper in `arenaDesert.ts`.
 */
export function polylineToWall(id: string, points: ReadonlyArray<readonly [number, number]>, closed: boolean): WallCollider | null {
  if (points.length < 2) return null;
  const segs: number[] = [];
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
    segs.push(a[0], a[1], b[0], b[1]);
  }
  if (!segs.length) return null;
  return { id, shape: "walls", segs: Float32Array.from(segs) };
}

/** Collider for one placement, with the placement's scale and yaw applied. */
export function propCollider(p: MapPropPlacement): CircleCollider | BoxCollider | null {
  const spec = p.collider;
  if (spec.mode === "none") return null;
  const s = Math.abs(p.scale) || 1;
  // Attackable props must stay hittable: their collider still blocks movement,
  // but projectiles reach the target radius instead of dying on the shell.
  const attackable = (p.hp ?? 0) > 0;
  const permeable =
    spec.blocksProjectiles === false || attackable ? { blocksProjectiles: false as const } : {};

  // Local offset -> world: scale with the prop, then turn with it. Without the
  // rotation a corner-pivoted building's collider would swing off the geometry
  // as soon as the prop was turned. Via the shared helper because `p.yaw` is a
  // Three.js `rotation.y`, whose sine terms are negated relative to the usual
  // maths convention -- hand-rolling it here rotated offsets the wrong way.
  const { x, z } = localToWorldXZ(
    p.x,
    p.z,
    p.yaw,
    (spec.offsetX ?? 0) * s,
    (spec.offsetZ ?? 0) * s,
  );

  if (spec.mode === "circle") {
    const radius = spec.radius * s;
    if (!(radius > 1e-3)) return null;
    return { id: p.id, shape: "circle", x, z, radius, ...permeable };
  }
  const halfX = spec.halfX * s;
  const halfZ = spec.halfZ * s;
  if (!(halfX > 1e-3) || !(halfZ > 1e-3)) return null;
  return {
    id: p.id,
    shape: "box",
    x,
    z,
    halfX,
    halfZ,
    yaw: p.yaw + (spec.yaw ?? 0),
    ...permeable,
  };
}

/** `WorldTarget.kind` for an attackable map prop. */
export const PROP_TARGET_KIND = "prop";

/**
 * Props the map wants players to be able to hit.
 *
 * Read once at room create; the result becomes one world target apiece.
 */
export function mapAttackableProps(doc: MapDoc): MapPropPlacement[] {
  return doc.props.filter((p) => (p.hp ?? 0) > 0);
}

/**
 * Server id for a prop's world target.
 *
 * Namespaced because target ids share one keyspace with player session ids and
 * decoys, and a prop id like `p012` is short enough to collide by accident.
 */
export function propTargetId(p: MapPropPlacement | string): string {
  return `prop:${typeof p === "string" ? p : p.id}`;
}

/** The prop id behind a target id, or null when the target is not a prop. */
export function propIdFromTargetId(targetId: string): string | null {
  return targetId.startsWith("prop:") ? targetId.slice(5) : null;
}

/**
 * How big a circle the prop presents to attacks.
 *
 * Taken from its collider so a barn is easier to hit than a fencepost, which
 * is the whole reason hit radius is per-body rather than a constant. A box is
 * approximated by its longer half-extent: the inscribed circle would leave the
 * ends of a long crate unhittable, and the circumscribed one would let attacks
 * land in the empty air past its corners.
 *
 * A collider-less prop still needs *some* footprint -- it is a target, so it
 * has to be hittable -- and falls back to roughly a body's width.
 */
export function propTargetRadius(p: MapPropPlacement): number {
  const s = Math.abs(p.scale) || 1;
  if (p.collider.mode === "circle") return Math.max(0.2, p.collider.radius * s);
  if (p.collider.mode === "box") {
    return Math.max(0.2, Math.max(p.collider.halfX, p.collider.halfZ) * s);
  }
  return COLLISION.dummyRadius;
}

/** Every static collider a map contributes. Called once per room create. */
export function mapStaticColliders(doc: MapDoc): StaticCollider[] {
  const out: StaticCollider[] = [];
  for (const wall of doc.walls) {
    const w = polylineToWall(wall.id, wall.points, wall.closed);
    if (!w) continue;
    if (wall.blocksProjectiles === false) w.blocksProjectiles = false;
    out.push(w);
  }
  for (const p of doc.props) {
    const c = propCollider(p);
    if (c) out.push(c);
  }
  return out;
}

/** Every element of one catalog type, e.g. `stand_shop` or `portal_pve`. */
export function mapElementsOfType(doc: MapDoc, type: string): MapElement[] {
  return doc.elements.filter((e) => e.type === type);
}

export function mapPlayerSpawns(doc: MapDoc, team: MapTeam): MapElement[] {
  return doc.elements
    .filter((e) => e.type === "player_spawn" && paramString(e, "team", "a") === team)
    .sort((a, b) => paramNumber(a, "slot") - paramNumber(b, "slot"));
}

/** nth fighter slot on a team. Clamps rather than returning undefined. */
export function mapSpawnForSlot(doc: MapDoc, team: MapTeam, slot: number): MapElement | undefined {
  const list = mapPlayerSpawns(doc, team);
  if (!list.length) return undefined;
  return list[Math.max(0, Math.min(list.length - 1, slot))];
}

/**
 * Every placeable NPC in a map, resolved and ready to render or talk to.
 *
 * Read by the client to draw them and by the server to validate that a player
 * asking to talk is actually standing next to one. Both sides read the same
 * authored document rather than syncing entities, because these do not move:
 * an NPC is map furniture, like a shop stand, and replicating a constant every
 * tick would buy nothing.
 */
export function mapNpcs(doc: MapDoc): NpcPlacement[] {
  const out: NpcPlacement[] = [];
  for (const el of doc.elements) {
    if (el.type !== "npc") continue;
    const npc = npcPlacement(el);
    if (npc) out.push(npc);
  }
  return out;
}

export function mapEntitySpawns(doc: MapDoc, entity?: string): MapElement[] {
  return doc.elements.filter(
    (e) => e.type === "entity_spawn" && (entity == null || paramString(e, "entity") === entity),
  );
}

/** A blank document, for "new map" in the editor. */
export function emptyMapDoc(id: string, name = id): MapDoc {
  return {
    version: MAP_DOC_VERSION,
    id,
    name,
    ground: {
      kind: "painted",
      sizeX: 80,
      sizeZ: 80,
      ...groundResFor(80, 80),
      layers: [...DEFAULT_GROUND_LAYERS],
      heightScale: 0,
    },
    env: {},
    props: [],
    walls: [],
    elements: [],
  };
}

// --- Parsing ----------------------------------------------------------------

type Parsed = { doc: MapDoc | null; errors: string[] };

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseCollider(raw: unknown): MapColliderSpec {
  if (!isRec(raw)) return { mode: "none" };
  // Only an explicit `false` opts out; anything else blocks, so a typo cannot
  // silently make a wall shootable.
  const permeable = raw.blocksProjectiles === false ? { blocksProjectiles: false as const } : {};
  // Kept out of the JSON when zero, so absent is the normal case rather than
  // a sign the prop was authored before offsets existed.
  const offset = {
    ...(isNum(raw.offsetX) && raw.offsetX !== 0 ? { offsetX: raw.offsetX } : {}),
    ...(isNum(raw.offsetZ) && raw.offsetZ !== 0 ? { offsetZ: raw.offsetZ } : {}),
  };
  if (raw.mode === "circle" && isNum(raw.radius)) {
    return { mode: "circle", radius: raw.radius, ...offset, ...permeable };
  }
  if (raw.mode === "box" && isNum(raw.halfX) && isNum(raw.halfZ)) {
    return {
      mode: "box",
      halfX: raw.halfX,
      halfZ: raw.halfZ,
      yaw: isNum(raw.yaw) ? raw.yaw : 0,
      ...offset,
      ...permeable,
    };
  }
  return { mode: "none" };
}

/**
 * Extent from either the per-axis fields or the legacy square `size`.
 *
 * Ground used to be one number. Documents authored before it split are still
 * on disk, so a bare `size` is read as an equal-sided extent rather than
 * failing the parse.
 */
function parseExtent(raw: Record<string, unknown>): { sizeX: number; sizeZ: number } | null {
  if (isNum(raw.sizeX) && isNum(raw.sizeZ)) {
    return { sizeX: Math.max(1, raw.sizeX), sizeZ: Math.max(1, raw.sizeZ) };
  }
  if (isNum(raw.size)) {
    const s = Math.max(1, raw.size);
    return { sizeX: s, sizeZ: s };
  }
  return null;
}

function parseGround(raw: unknown, errors: string[]): MapGround {
  if (isRec(raw)) {
    if (raw.kind === "plane" && isStr(raw.material)) {
      const extent = parseExtent(raw);
      if (extent) return { kind: "plane", ...extent, material: raw.material };
    }
    if (raw.kind === "mesh" && isStr(raw.url)) {
      const at = isRec(raw.plantAt) ? raw.plantAt : {};
      return {
        kind: "mesh",
        url: raw.url,
        scale: isNum(raw.scale) ? raw.scale : 1,
        plantAt: { x: isNum(at.x) ? at.x : 0, z: isNum(at.z) ? at.z : 0 },
      };
    }
    if (raw.kind === "painted" && parseExtent(raw)) {
      const { sizeX, sizeZ } = parseExtent(raw)!;
      const layers = Array.isArray(raw.layers) ? raw.layers.filter(isStr).slice(0, 4) : [];
      const requested = isNum(raw.heightScale) ? raw.heightScale : 0;
      const heightScale = Math.min(Math.max(0, requested), MAX_GROUND_HEIGHT_SCALE);
      if (requested > MAX_GROUND_HEIGHT_SCALE) {
        errors.push(
          `ground.heightScale ${requested} exceeds the ${MAX_GROUND_HEIGHT_SCALE} m cap and was clamped; ` +
            `taller ground cannot be represented by XZ-only collision`,
        );
      }
      /*
       * A legacy `resolution` was one number for a square grid, so it carries
       * straight over to both axes. Anything else is derived from the extent,
       * which also repairs a grid saved before the cap existed.
       */
      const res =
        isNum(raw.resX) && isNum(raw.resZ)
          ? {
              resX: Math.max(2, Math.min(MAX_GROUND_RES, Math.round(raw.resX))),
              resZ: Math.max(2, Math.min(MAX_GROUND_RES, Math.round(raw.resZ))),
            }
          : isNum(raw.resolution) && sizeX === sizeZ
            ? {
                resX: Math.max(2, Math.min(MAX_GROUND_RES, Math.round(raw.resolution))),
                resZ: Math.max(2, Math.min(MAX_GROUND_RES, Math.round(raw.resolution))),
              }
            : groundResFor(sizeX, sizeZ);

      return {
        kind: "painted",
        sizeX,
        sizeZ,
        ...res,
        layers,
        splatUrl: isStr(raw.splatUrl) ? raw.splatUrl : undefined,
        heightUrl: isStr(raw.heightUrl) ? raw.heightUrl : undefined,
        heightScale,
      };
    }
  }
  errors.push("ground is missing or malformed; defaulted to an 80 m flat plane");
  return { kind: "plane", sizeX: 80, sizeZ: 80, material: "grass_forest" };
}

function parseShape(raw: unknown): MapElementShape | undefined {
  if (!isRec(raw)) return undefined;
  if (raw.kind === "circle" && isNum(raw.radius)) return { kind: "circle", radius: raw.radius };
  if (raw.kind === "box" && isNum(raw.halfX) && isNum(raw.halfZ)) {
    return { kind: "box", halfX: raw.halfX, halfZ: raw.halfZ };
  }
  return undefined;
}

function parseParams(raw: unknown): MapElementParams {
  const out: MapElementParams = {};
  if (!isRec(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" || typeof v === "boolean") out[k] = v;
    else if (isNum(v)) out[k] = v;
  }
  return out;
}

/**
 * Elements, plus a migration from the original `markers` / `areas` fields.
 *
 * Those were replaced by the unified element list; the migration exists so any
 * document written before the change still loads rather than silently losing
 * its spawns.
 */
function parseElements(raw: Record<string, unknown>, errors: string[]): MapElement[] {
  const out: MapElement[] = [];

  for (const [i, e] of (Array.isArray(raw.elements) ? raw.elements : []).entries()) {
    if (!isRec(e) || !isStr(e.type) || !isNum(e.x) || !isNum(e.z)) {
      errors.push(`elements[${i}] is malformed and was dropped`);
      continue;
    }
    const def = elementType(e.type);
    if (!def) {
      // Kept, not dropped: an unknown type is more likely a newer editor or a
      // hand edit than corruption, and dropping it would lose real work.
      errors.push(`elements[${i}] has unknown type "${e.type}" and was kept as-is`);
    }
    out.push({
      id: isStr(e.id) ? e.id : `e${i}`,
      type: e.type,
      x: e.x,
      z: e.z,
      yaw: isNum(e.yaw) ? e.yaw : 0,
      // Absent on maps predating sculpted ground, where flat means 0 anyway.
      ...(isNum(e.y) ? { y: e.y } : {}),
      shape: parseShape(e.shape) ?? (def ? defaultElementShape(def) : undefined),
      params: { ...(def ? defaultElementParams(def) : {}), ...parseParams(e.params) },
      ...(isStr(e.group) ? { group: e.group } : {}),
    });
  }

  // --- legacy: markers[] and areas[] ---
  for (const [i, m] of (Array.isArray(raw.markers) ? raw.markers : []).entries()) {
    if (!isRec(m) || !isNum(m.x) || !isNum(m.z)) continue;
    const base = { x: m.x, z: m.z, yaw: isNum(m.yaw) ? m.yaw : 0 };
    if (m.kind === "player_spawn") {
      out.push({
        id: isStr(m.id) ? m.id : `m${i}`,
        type: "player_spawn",
        ...base,
        params: {
          team: m.team === "b" || m.team === "c" ? m.team : "a",
          slot: isNum(m.slot) ? Math.max(0, Math.floor(m.slot)) : 0,
        },
      });
    } else if (m.kind === "entity_spawn" && isStr(m.entity)) {
      out.push({
        id: isStr(m.id) ? m.id : `m${i}`,
        type: "entity_spawn",
        ...base,
        params: { entity: m.entity },
      });
    }
  }

  for (const [i, a] of (Array.isArray(raw.areas) ? raw.areas : []).entries()) {
    if (!isRec(a) || !isNum(a.x) || !isNum(a.z)) continue;
    const shape: MapElementShape | undefined =
      a.shape === "box" && isNum(a.halfX) && isNum(a.halfZ)
        ? { kind: "box", halfX: a.halfX, halfZ: a.halfZ }
        : isNum(a.radius)
          ? { kind: "circle", radius: a.radius }
          : undefined;
    out.push({
      id: isStr(a.id) ? a.id : `a${i}`,
      type: "objective",
      x: a.x,
      z: a.z,
      yaw: isNum(a.yaw) ? a.yaw : 0,
      shape,
      params: { tag: isStr(a.tag) ? a.tag : "capture_point", team: "none" },
    });
  }

  const hadLegacy =
    (Array.isArray(raw.markers) && raw.markers.length > 0) ||
    (Array.isArray(raw.areas) && raw.areas.length > 0);
  if (hadLegacy) {
    errors.push("migrated legacy markers/areas into elements; re-save to update the file");
  }

  return out;
}

/** Structural parse. Recoverable problems are reported but do not fail the doc. */
export function parseMapDoc(raw: unknown): Parsed {
  const errors: string[] = [];
  if (!isRec(raw)) return { doc: null, errors: ["document is not an object"] };
  if (raw.version !== MAP_DOC_VERSION) {
    return { doc: null, errors: [`unsupported map version ${String(raw.version)}`] };
  }
  if (!isStr(raw.id)) return { doc: null, errors: ["map id is missing"] };

  const props: MapPropPlacement[] = [];
  for (const [i, p] of (Array.isArray(raw.props) ? raw.props : []).entries()) {
    if (!isRec(p) || !isStr(p.prop) || !isNum(p.x) || !isNum(p.z)) {
      errors.push(`props[${i}] is malformed and was dropped`);
      continue;
    }
    props.push({
      id: isStr(p.id) ? p.id : `p${i}`,
      prop: p.prop,
      x: p.x,
      y: isNum(p.y) ? p.y : 0,
      z: p.z,
      yaw: isNum(p.yaw) ? p.yaw : 0,
      ...(isNum(p.pitch) && p.pitch !== 0 ? { pitch: p.pitch } : {}),
      ...(isNum(p.roll) && p.roll !== 0 ? { roll: p.roll } : {}),
      scale: isNum(p.scale) && p.scale !== 0 ? p.scale : 1,
      ...(isNum(p.pivotX) && p.pivotX !== 0 ? { pivotX: p.pivotX } : {}),
      ...(isNum(p.pivotZ) && p.pivotZ !== 0 ? { pivotZ: p.pivotZ } : {}),
      ...(isStr(p.group) ? { group: p.group } : {}),
      ...(isNum(p.hp) && p.hp > 0 ? { hp: p.hp } : {}),
      collider: parseCollider(p.collider),
    });
  }

  const walls: MapWall[] = [];
  for (const [i, w] of (Array.isArray(raw.walls) ? raw.walls : []).entries()) {
    if (!isRec(w) || !Array.isArray(w.points)) {
      errors.push(`walls[${i}] is malformed and was dropped`);
      continue;
    }
    const points = w.points
      .filter((pt): pt is [number, number] => Array.isArray(pt) && isNum(pt[0]) && isNum(pt[1]))
      .map((pt) => [pt[0], pt[1]] as [number, number]);
    if (points.length < 2) {
      errors.push(`walls[${i}] has fewer than 2 valid points and was dropped`);
      continue;
    }
    walls.push({
      id: isStr(w.id) ? w.id : `w${i}`,
      closed: w.closed === true,
      points,
      ...(isStr(w.group) ? { group: w.group } : {}),
      ...(w.blocksProjectiles === false ? { blocksProjectiles: false as const } : {}),
    });
  }

  const elements = parseElements(raw, errors);
  const env = isRec(raw.env) ? raw.env : {};

  return {
    doc: {
      version: MAP_DOC_VERSION,
      id: raw.id,
      name: isStr(raw.name) ? raw.name : raw.id,
      ground: parseGround(raw.ground, errors),
      env: {
        skyPreset: isStr(env.skyPreset) ? env.skyPreset : undefined,
        fogColor: isStr(env.fogColor) ? env.fogColor : undefined,
        fogNear: isNum(env.fogNear) ? env.fogNear : undefined,
        fogFar: isNum(env.fogFar) ? env.fogFar : undefined,
      },
      props,
      walls,
      elements,
      suppressedWarnings: Array.isArray(raw.suppressedWarnings)
        ? raw.suppressedWarnings.filter(isStr)
        : undefined,
    },
    errors,
  };
}

// --- Gameplay validation ----------------------------------------------------

export type MapWarningCode =
  | "duplicate-id"
  | "unknown-element-type"
  | "missing-spawns"
  | "duplicate-spawn-slot"
  | "out-of-bounds"
  | "element-in-collider"
  | "narrow-gap"
  | "narrow-gap-overflow"
  | "pickup-buff-no-duration"
  | "pickup-no-effect";

export type MapWarning = {
  severity: "error" | "warning";
  message: string;
  code: MapWarningCode;
  /**
   * Entity ids the warning is about, so a UI can select and frame them.
   * Raw ids are useless to a human on their own -- the editor resolves them
   * to prop names before display.
   */
  subjects: string[];
  /**
   * Stable identity for suppression. Derived from code + subjects rather than
   * the message, so rewording a message does not un-dismiss it.
   */
  key: string;
  /** True when `doc.suppressedWarnings` lists this key. Errors never suppress. */
  suppressed: boolean;
};

/** Stable suppression key. Subjects are sorted so pair order cannot matter. */
export function mapWarningKey(code: MapWarningCode, subjects: string[]): string {
  return `${code}:${[...subjects].sort().join("|")}`;
}

/**
 * Playability checks, run on save. Separate from `parseMapDoc`: these are
 * things that load fine but play badly.
 *
 * Suppressed warnings are returned flagged rather than dropped, so the editor
 * can show a dismissed count and offer to restore them. Callers that just want
 * the live list should filter on `!w.suppressed`.
 */
export function validateMapDoc(
  doc: MapDoc,
  opts?: { requiredTeams?: MapTeam[]; fightersPerTeam?: number },
): MapWarning[] {
  const out: MapWarning[] = [];
  const muted = new Set(doc.suppressedWarnings ?? []);

  const err = (code: MapWarningCode, subjects: string[], message: string) =>
    out.push({
      severity: "error",
      message,
      code,
      subjects,
      key: mapWarningKey(code, subjects),
      suppressed: false,
    });

  const warn = (code: MapWarningCode, subjects: string[], message: string) => {
    const key = mapWarningKey(code, subjects);
    out.push({ severity: "warning", message, code, subjects, key, suppressed: muted.has(key) });
  };

  const ids = new Set<string>();
  for (const entity of [...doc.props, ...doc.walls, ...doc.elements]) {
    if (ids.has(entity.id)) err("duplicate-id", [entity.id], `duplicate id "${entity.id}"`);
    ids.add(entity.id);
  }

  for (const el of doc.elements) {
    if (!elementType(el.type)) {
      warn("unknown-element-type", [el.id], `unknown element type "${el.type}"`);
      continue;
    }
    if (el.type === "pickup") {
      const spec = pickupSpec(el);
      // A buff with no duration applies and expires in the same tick, which
      // looks like a pickup that does nothing rather than an authoring slip.
      if (spec.def.kind === "buff" && spec.durationMs <= 0) {
        warn("pickup-buff-no-duration", [el.id], `${spec.def.label} buff has no duration - it will do nothing`);
      }
      if (spec.magnitude <= 0) {
        warn("pickup-no-effect", [el.id], `${spec.def.label} pickup has an amount of 0`);
      }
    }
  }

  for (const team of opts?.requiredTeams ?? []) {
    const spawns = mapPlayerSpawns(doc, team);
    const needed = opts?.fightersPerTeam ?? 1;
    if (spawns.length < needed) {
      err("missing-spawns", [], `team ${team} has ${spawns.length} spawn(s) but needs ${needed}`);
    }
    const slots = new Set(spawns.map((s) => paramNumber(s, "slot")));
    if (slots.size !== spawns.length) {
      err("duplicate-spawn-slot", [], `team ${team} has duplicate spawn slots`);
    }
  }

  const extent = mapGroundExtent(doc);
  const halfX = extent.x / 2;
  const halfZ = extent.z / 2;
  for (const p of doc.props) {
    if (Math.abs(p.x) > halfX || Math.abs(p.z) > halfZ) {
      warn("out-of-bounds", [p.id], "sits outside the ground extent");
    }
  }

  // Spawns buried inside a collider leave a player stuck on round start.
  const solids = doc.props.map(propCollider).filter((c): c is CircleCollider | BoxCollider => !!c);
  for (const m of doc.elements) {
    for (const c of solids) {
      // Test for "box": CircleCollider.shape is optional, so it does not narrow.
      const reach = c.shape === "box" ? Math.hypot(c.halfX, c.halfZ) : c.radius;
      if (Math.hypot(m.x - c.x, m.z - c.z) < reach + COLLISION.playerRadius) {
        warn("element-in-collider", [m.id, c.id], "sits inside a collider - a player would spawn stuck");
        break;
      }
    }
  }

  // Gaps a 0.45 m-radius player cannot squeeze through, which look passable in
  // an orbit camera. Circle-vs-circle only; box pairs use a bounding radius, so
  // this is approximate and errs toward reporting.
  const circles = solids.map((c) => ({
    id: c.id,
    x: c.x,
    z: c.z,
    r: c.shape === "box" ? Math.hypot(c.halfX, c.halfZ) : c.radius,
  }));
  // Dismissed pairs are always emitted (bounded by what the author actually
  // dismissed) so the UI can offer to restore them; live ones are capped,
  // because a dense prop field can produce thousands and a list that long is
  // no more useful than a count.
  const NARROW_GAP_LIMIT = 25;
  let liveNarrow = 0;
  let hiddenNarrow = 0;
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i]!;
      const b = circles[j]!;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;
      if (gap <= 0 || gap >= MIN_PASSABLE_GAP) continue;

      const subjects = [a.id, b.id];
      if (muted.has(mapWarningKey("narrow-gap", subjects))) {
        warn("narrow-gap", subjects, `gap is ${gap.toFixed(2)} m`);
        continue;
      }
      liveNarrow++;
      if (liveNarrow <= NARROW_GAP_LIMIT) {
        warn(
          "narrow-gap",
          subjects,
          `gap is ${gap.toFixed(2)} m - a player cannot fit (needs ${MIN_PASSABLE_GAP.toFixed(2)} m)`,
        );
      } else {
        hiddenNarrow++;
      }
    }
  }
  if (hiddenNarrow > 0) {
    warn("narrow-gap-overflow", [], `...and ${hiddenNarrow} more impassable gaps not listed`);
  }

  return out;
}

/** Extent of the playable surface in metres, per axis, centred on the origin. */
export function mapGroundExtent(doc: MapDoc): { x: number; z: number } {
  const g = doc.ground;
  if (g.kind === "mesh") {
    // No authored extent; infer from content so callers still get a usable number.
    let max = 20;
    for (const p of doc.props) max = Math.max(max, Math.abs(p.x), Math.abs(p.z));
    for (const w of doc.walls) {
      for (const [x, z] of w.points) max = Math.max(max, Math.abs(x), Math.abs(z));
    }
    const s = Math.max(40, Math.ceil(max * 2 + 16));
    return { x: s, z: s };
  }
  return { x: g.sizeX, z: g.sizeZ };
}

/**
 * Longest side of the playable surface, in metres.
 *
 * For callers that need one number to size something that must cover the whole
 * map -- camera framing, grid fade, shadow frustums -- rather than the extent
 * of a particular axis.
 */
export function mapGroundSize(doc: MapDoc): number {
  const { x, z } = mapGroundExtent(doc);
  return Math.max(x, z);
}
