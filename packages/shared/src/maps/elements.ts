/**
 * Map elements: every non-decorative point of interest a map can carry.
 *
 * This replaces what were three closed unions (player spawns, entity spawns,
 * objective areas). The problem with those was that each new interaction --
 * a shop, a portal, a spell trainer -- meant a schema change, a parser branch,
 * a renderer branch and an inspector branch. Since the game already has a set
 * of interaction kinds (`UiKind` and `INTERACT` in constants.ts) that keeps
 * growing, that shape was going to keep costing.
 *
 * Instead there is one `MapElement` with a `type` and free-form `params`, and
 * a catalog below describing each type: what it looks like, whether it has a
 * trigger volume, and what parameters it takes. Adding `portal_raid` is one
 * entry here -- the editor renders it, gives it an inspector and validates it
 * with no further code.
 *
 * Type ids deliberately match the runtime's existing `INTERACT` values so the
 * server can dispatch on them directly.
 */

import {
  npcModel,
  NPC_ACTIONS,
  NPC_MODEL_IDS,
  type NpcAction,
  type NpcModelDef,
} from "../npcs";

export type MapElementParamValue = string | number | boolean;
export type MapElementParams = Record<string, MapElementParamValue>;

/** Optional trigger volume. Absent means the element is a bare point. */
export type MapElementShape =
  | { kind: "circle"; radius: number }
  | { kind: "box"; halfX: number; halfZ: number };

export type MapElement = {
  id: string;
  /** Catalog id, e.g. `player_spawn`, `stand_shop`, `portal_pve`. */
  type: string;
  x: number;
  z: number;
  yaw: number;
  /**
   * Ground height at the placement, sampled from the terrain when placed.
   *
   * Optional because every map authored before sculpted ground existed omits
   * it, and 0 is the right answer for those -- their ground is flat. Only
   * renderers need it; proximity and interaction are decided on XZ alone, so a
   * stale value makes an NPC stand in a dip, not become untalkable.
   */
  y?: number;
  shape?: MapElementShape;
  params: MapElementParams;
  /**
   * Editor grouping id -- see `Groupable` in `mapDoc.ts`. Nothing at runtime
   * reads it; it exists so a spawn pad and its scenery stay one selection.
   */
  group?: string;
};

// --- catalog ----------------------------------------------------------------

export type ElementParamSpec =
  | { key: string; label: string; kind: "string"; default: string }
  | { key: string; label: string; kind: "number"; default: number; step?: number; min?: number }
  | { key: string; label: string; kind: "boolean"; default: boolean }
  | { key: string; label: string; kind: "enum"; options: readonly string[]; default: string };

export type ElementGroup =
  | "Spawns"
  | "NPCs"
  | "Hub stands"
  | "Portals"
  | "Objectives"
  | "Pickups";

/**
 * A numeric param drawn as a range circle in the editor.
 *
 * Distinct from `volume`: a volume is a trigger you walk into and is part of
 * the element's shape, whereas a ring visualises a distance the element cares
 * about -- how far a mob notices you, how far it will wander. Declaring them
 * here keeps the renderer free of per-type branches; a boss with a leash range
 * is a new entry, not new code.
 */
export type ElementRing = { param: string; label: string; color: string };

/**
 * How an entity spawned here behaves before anything provokes it.
 *
 * `guard` is the default because it is what most encounters want: the mob
 * holds its post and only commits once a player is inside its aggro range.
 */
export const ENTITY_BEHAVIOURS = ["fixed", "roam", "guard"] as const;
export type EntityBehaviour = (typeof ENTITY_BEHAVIOURS)[number];

/**
 * What walking over a pickup does.
 *
 * `instant` effects apply once and are done; `buff` effects run for the
 * element's `durationMs`. The distinction is kept here rather than inferred
 * from a non-zero duration so that a buff authored with duration 0 reads as a
 * mistake the validator can catch, instead of silently becoming instant.
 *
 * `magnitude` means different things per effect, which is why each entry
 * carries its own unit and a sensible starting value: flat HP for a heal,
 * whole pips for energy, a multiplier for the buffs.
 */
export type PickupEffectDef = {
  label: string;
  kind: "instant" | "buff";
  /** Shown next to the magnitude field in the inspector. */
  unit: string;
  defaultMagnitude: number;
};

export const PICKUP_EFFECTS: Record<string, PickupEffectDef> = {
  heal: { label: "Heal", kind: "instant", unit: "hp", defaultMagnitude: 300 },
  energy: { label: "Energy", kind: "instant", unit: "pips", defaultMagnitude: 2 },
  absorb: { label: "Absorb shield", kind: "instant", unit: "hp", defaultMagnitude: 250 },
  speed: { label: "Move speed", kind: "buff", unit: "x", defaultMagnitude: 1.3 },
  power: { label: "Power", kind: "buff", unit: "x", defaultMagnitude: 1.5 },
  haste: { label: "Cooldown rate", kind: "buff", unit: "x", defaultMagnitude: 1.25 },
};

export const PICKUP_EFFECT_IDS = Object.keys(PICKUP_EFFECTS) as readonly string[];

export type ElementTypeDef = {
  id: string;
  label: string;
  group: ElementGroup;
  /** Editor display colour. Ignored when `teamColored`. */
  color: string;
  /** Volume created on placement. */
  volume: "none" | "circle" | "box";
  defaultRadius?: number;
  defaultHalfX?: number;
  defaultHalfZ?: number;
  /** Draw a facing arrow and treat `yaw` as meaningful. */
  facing: boolean;
  /** Colour by the `team` param instead of `color`. */
  teamColored?: boolean;
  /** Matching runtime INTERACT id, where one already exists. */
  interact?: string;
  /** Numeric params to draw as range circles. Skipped when the value is 0. */
  rings?: readonly ElementRing[];
  params: readonly ElementParamSpec[];
};

export const ELEMENT_TYPES: readonly ElementTypeDef[] = [
  {
    id: "player_spawn",
    label: "Player spawn",
    group: "Spawns",
    color: "#4a9eff",
    volume: "none",
    facing: true,
    teamColored: true,
    params: [
      { key: "team", label: "Team", kind: "enum", options: ["a", "b", "c"], default: "a" },
      { key: "slot", label: "Slot", kind: "number", default: 0, step: 1, min: 0 },
    ],
  },
  {
    id: "entity_spawn",
    label: "Entity spawn",
    group: "Spawns",
    color: "#c58bff",
    volume: "none",
    facing: true,
    rings: [
      { param: "aggroRadius", label: "Aggro", color: "#ff5f5f" },
      { param: "roamRadius", label: "Roam", color: "#7ad9ff" },
    ],
    params: [
      { key: "entity", label: "Entity", kind: "string", default: "zombie" },
      {
        key: "behaviour",
        label: "Behaviour",
        kind: "enum",
        options: ENTITY_BEHAVIOURS,
        default: "guard",
      },
      // 0 disables aggro entirely, which is how you author a purely decorative
      // or scripted mob without inventing a fourth behaviour.
      { key: "aggroRadius", label: "Aggro range", kind: "number", default: 10, step: 0.5, min: 0 },
      // Only meaningful for `roam`; left at 0 so fixed and guard mobs do not
      // draw a ring they will never use.
      { key: "roamRadius", label: "Roam range", kind: "number", default: 0, step: 0.5, min: 0 },
    ],
  },
  {
    id: "practice_dummy",
    label: "Practice dummy",
    group: "Spawns",
    color: "#c58bff",
    volume: "none",
    facing: true,
    interact: "practice_dummy",
    params: [],
  },

  /*
   * A villager, shopkeeper or quest giver.
   *
   * Everything that makes this NPC *this* NPC is a param, so a town is built
   * by placing and typing rather than by adding code per character. The model
   * is the one exception: it names a GLB, which has to exist on disk.
   *
   * No volume. The talk range is a plain radius around the pose
   * (`NPC_INTERACT_RADIUS`) rather than an authored trigger box, because every
   * NPC wants the same reach and an author given the choice would only have to
   * get it right repeatedly.
   */
  {
    id: "npc",
    label: "NPC",
    group: "NPCs",
    color: "#7ee081",
    volume: "none",
    facing: true,
    params: [
      { key: "name", label: "Name", kind: "string", default: "Villager" },
      { key: "model", label: "Model", kind: "enum", options: NPC_MODEL_IDS, default: NPC_MODEL_IDS[0]! },
      { key: "line", label: "Greeting", kind: "string", default: "Good day to you." },
      { key: "action", label: "Action", kind: "enum", options: NPC_ACTIONS, default: "talk" },
    ],
  },

  // Hub stands. Half extents match BASE_CITY_STANDS in stands.ts.
  {
    id: "stand_shop",
    label: "Shop",
    group: "Hub stands",
    color: "#ffd166",
    volume: "box",
    defaultHalfX: 2.15,
    defaultHalfZ: 2.15,
    facing: true,
    interact: "stand_shop",
    params: [{ key: "label", label: "Label", kind: "string", default: "Shop" }],
  },
  {
    id: "stand_build",
    label: "Armoury (spells)",
    group: "Hub stands",
    color: "#ffd166",
    volume: "box",
    defaultHalfX: 2.15,
    defaultHalfZ: 2.15,
    facing: true,
    interact: "stand_build",
    params: [{ key: "label", label: "Label", kind: "string", default: "Armoury" }],
  },
  {
    id: "stand_talent",
    label: "Talents",
    group: "Hub stands",
    color: "#ffd166",
    volume: "box",
    defaultHalfX: 2.15,
    defaultHalfZ: 2.15,
    facing: true,
    interact: "stand_talent",
    params: [{ key: "label", label: "Label", kind: "string", default: "Talents" }],
  },
  {
    id: "stand_customization",
    label: "Customization",
    group: "Hub stands",
    color: "#ffd166",
    volume: "box",
    defaultHalfX: 2.15,
    defaultHalfZ: 2.15,
    facing: true,
    interact: "stand_customization",
    params: [{ key: "label", label: "Label", kind: "string", default: "Customization" }],
  },

  {
    id: "portal_pvp",
    label: "PvP portal",
    group: "Portals",
    color: "#ff7ad9",
    volume: "circle",
    defaultRadius: 2.5,
    facing: true,
    interact: "portal_pvp",
    params: [
      { key: "label", label: "Label", kind: "string", default: "PvP Portal" },
      { key: "mode", label: "Mode", kind: "string", default: "" },
    ],
  },
  {
    id: "portal_pve",
    label: "PvE portal",
    group: "Portals",
    color: "#ff7ad9",
    volume: "circle",
    defaultRadius: 2.5,
    facing: true,
    interact: "portal_pve",
    params: [
      { key: "label", label: "Label", kind: "string", default: "PvE Portal" },
      { key: "dungeon", label: "Dungeon", kind: "string", default: "" },
    ],
  },

  {
    id: "objective",
    label: "Objective",
    group: "Objectives",
    color: "#5fd08a",
    volume: "circle",
    defaultRadius: 3,
    facing: false,
    params: [
      {
        key: "tag",
        label: "Tag",
        kind: "enum",
        options: ["capture_point", "flag_stand", "payload_node", "custom"],
        default: "capture_point",
      },
      { key: "team", label: "Owner", kind: "enum", options: ["none", "a", "b", "c"], default: "none" },
    ],
  },

  {
    id: "pickup",
    label: "Pickup",
    group: "Pickups",
    color: "#4ecdc4",
    volume: "circle",
    // Walk-over sized, not an area you stand in: a pickup you can miss by a
    // step is a skill expression, one you soak up from three metres away is
    // not. Authors can still widen it per placement.
    defaultRadius: 1.2,
    facing: false,
    params: [
      { key: "effect", label: "Effect", kind: "enum", options: PICKUP_EFFECT_IDS, default: "energy" },
      // Meaning depends on the effect -- flat for heal/energy/absorb, a
      // multiplier for the buffs. See PICKUP_EFFECTS for units.
      { key: "magnitude", label: "Amount / multiplier", kind: "number", default: 2, step: 0.1, min: 0 },
      // Ignored by instant effects.
      { key: "durationMs", label: "Buff duration (ms)", kind: "number", default: 0, step: 500, min: 0 },
      { key: "respawnMs", label: "Respawn (ms)", kind: "number", default: 30000, step: 1000, min: 0 },
      // Staggers a contested pickup away from round start, so the opening is
      // decided by position rather than by who spawned nearest to it.
      { key: "firstSpawnMs", label: "First spawn delay (ms)", kind: "number", default: 0, step: 1000, min: 0 },
    ],
  },
];

const BY_ID = new Map(ELEMENT_TYPES.map((t) => [t.id, t]));

export function elementType(id: string): ElementTypeDef | undefined {
  return BY_ID.get(id);
}

/**
 * Palette groups, in catalog order.
 *
 * Derived rather than listed, because a hand-written copy is a second place to
 * remember: adding a type with a new group and forgetting this list produced a
 * type the editor could never place, with nothing to show for the mistake --
 * the dropdown simply had no such section.
 */
export const ELEMENT_GROUPS: readonly ElementGroup[] = [
  ...new Set(ELEMENT_TYPES.map((t) => t.group)),
];

/** Params an element of this type starts with. */
export function defaultElementParams(def: ElementTypeDef): MapElementParams {
  const out: MapElementParams = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}

/** Volume an element of this type starts with. */
export function defaultElementShape(def: ElementTypeDef): MapElementShape | undefined {
  if (def.volume === "circle") return { kind: "circle", radius: def.defaultRadius ?? 3 };
  if (def.volume === "box") {
    return { kind: "box", halfX: def.defaultHalfX ?? 2, halfZ: def.defaultHalfZ ?? 2 };
  }
  return undefined;
}

// --- typed readers ----------------------------------------------------------
// Params are free-form by design, so reads go through these rather than
// scattering casts across the server and editor.

export function paramString(el: MapElement, key: string, fallback = ""): string {
  const v = el.params[key];
  return typeof v === "string" ? v : fallback;
}

export function paramNumber(el: MapElement, key: string, fallback = 0): number {
  const v = el.params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function paramBool(el: MapElement, key: string, fallback = false): boolean {
  const v = el.params[key];
  return typeof v === "boolean" ? v : fallback;
}

/**
 * An entity spawn's behaviour, falling back to `guard` for anything unknown.
 *
 * Documents outlive the catalog: a spawn authored before behaviour existed has
 * no such param, and one authored after a behaviour is renamed would carry a
 * value this build does not know. Both should stand and fight rather than
 * crash or freeze.
 */
export function entityBehaviour(el: MapElement): EntityBehaviour {
  const v = paramString(el, "behaviour");
  return (ENTITY_BEHAVIOURS as readonly string[]).includes(v) ? (v as EntityBehaviour) : "guard";
}

/** Aggro range in metres. 0 means the entity never notices players on its own. */
export function entityAggroRadius(el: MapElement): number {
  return Math.max(0, paramNumber(el, "aggroRadius", 10));
}

/**
 * Everything the runtime needs to resolve a pickup, with the same
 * outlives-the-catalog tolerance as `entityBehaviour`: an unknown effect id
 * falls back to energy rather than throwing on a map authored by a newer
 * build.
 */
export type PickupSpec = {
  effect: string;
  def: PickupEffectDef;
  magnitude: number;
  durationMs: number;
  respawnMs: number;
  firstSpawnMs: number;
};

/**
 * An NPC placement, resolved against the model registry.
 *
 * Returns null when the element names a model that no longer exists, which is
 * the one authored value that can dangle -- names and greetings are free text
 * and cannot be wrong, but a model is a file. Callers skip nulls, so deleting
 * a GLB makes its NPCs quietly vanish rather than crashing a match.
 */
export type NpcPlacement = {
  /** Element id; the interact id is `npc:<id>`. */
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  name: string;
  line: string;
  action: NpcAction;
  model: NpcModelDef;
};

export function npcPlacement(el: MapElement): NpcPlacement | null {
  const model = npcModel(paramString(el, "model", NPC_MODEL_IDS[0]!));
  if (!model) return null;
  const rawAction = paramString(el, "action", "talk");
  return {
    id: el.id,
    x: el.x,
    y: el.y ?? 0,
    z: el.z,
    yaw: el.yaw,
    name: paramString(el, "name", "Villager"),
    line: paramString(el, "line", ""),
    action: (NPC_ACTIONS as readonly string[]).includes(rawAction)
      ? (rawAction as NpcAction)
      : "talk",
    model,
  };
}

export function pickupSpec(el: MapElement): PickupSpec {
  const raw = paramString(el, "effect", "energy");
  const effect = PICKUP_EFFECTS[raw] ? raw : "energy";
  const def = PICKUP_EFFECTS[effect]!;
  return {
    effect,
    def,
    magnitude: paramNumber(el, "magnitude", def.defaultMagnitude),
    // An instant effect has no duration no matter what the document says.
    durationMs: def.kind === "buff" ? Math.max(0, paramNumber(el, "durationMs", 0)) : 0,
    // 0 means one-shot: taken once, gone for the rest of the round.
    respawnMs: Math.max(0, paramNumber(el, "respawnMs", 30000)),
    firstSpawnMs: Math.max(0, paramNumber(el, "firstSpawnMs", 0)),
  };
}
