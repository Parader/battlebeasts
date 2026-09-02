/**
 * Ground material library for painted terrain.
 *
 * Deliberately data-only -- no three.js here. This module is reachable from
 * `shared/index`, which the game server imports, and the server has no
 * business pulling a renderer in just to know a material's id.
 *
 * A painted ground names up to four of these in `MapGround.layers`; the splat
 * texture's R, G, B and A channels weight them in that order.
 *
 * Sources are Poly Haven (CC0). The 1k tier is deliberate: the camera is
 * top-down and every material stretches over a multi-metre repeat, so 2k buys
 * nothing but download size.
 */

export type GroundMaterialDef = {
  id: string;
  label: string;
  /**
   * Public URLs, relative to the web root.
   *
   * Colour and normal only. Roughness and ambient occlusion are deliberately
   * absent: the painted-ground shader cannot afford the texture units, and
   * outdoor ground is uniformly rough with AO already baked into these scans.
   */
  diff: string;
  nor: string;
  /**
   * World metres per texture repeat. Larger reads softer and hides seams;
   * matched per-material so pebbles and grass blades stay plausibly sized
   * next to a ~1.7 m character.
   */
  tile: number;
  /** Grouping for the material picker. */
  group: GroundMaterialGroup;
};

export type GroundMaterialGroup = "Natural" | "Arid" | "Cold" | "Built";

const DIR = "ground_textures";

function polyHaven(
  id: string,
  label: string,
  slug: string,
  tile: number,
  group: GroundMaterialGroup,
): GroundMaterialDef {
  return {
    id,
    label,
    diff: `${DIR}/${slug}_diff_1k.jpg`,
    nor: `${DIR}/${slug}_nor_gl_1k.jpg`,
    tile,
    group,
  };
}

/**
 * The pool a map picks its layers from.
 *
 * Far larger than `MAX_GROUND_LAYERS`, and deliberately so: the four-channel
 * limit is about what one surface can blend at once, not about how much choice
 * an author has. Ids are stable and stored in map documents, so rename labels
 * freely but never an id.
 */
export const GROUND_MATERIALS: readonly GroundMaterialDef[] = [
  // Natural
  polyHaven("grass", "Grass", "aerial_grass_rock", 8, "Natural"),
  polyHaven("grass_leafy", "Grass, leafy", "leafy_grass", 6, "Natural"),
  polyHaven("dirt", "Dirt", "brown_mud_leaves_01", 6, "Natural"),
  polyHaven("mud", "Mud, wet", "brown_mud_03", 6, "Natural"),
  polyHaven("forest_floor", "Forest floor", "forest_ground_04", 7, "Natural"),
  polyHaven("leaves", "Fallen leaves", "dry_decay_leaves", 5, "Natural"),
  polyHaven("rock", "Rock", "rocky_terrain_02", 7, "Natural"),
  polyHaven("rock_aerial", "Rock, broken", "aerial_rocks_02", 9, "Natural"),

  // Arid
  polyHaven("sand_beach", "Sand, beach", "coast_sand_01", 7, "Arid"),
  polyHaven("dry_earth", "Dry earth", "dry_ground_01", 7, "Arid"),
  polyHaven("burned", "Scorched earth", "burned_ground_01", 7, "Arid"),

  // Cold
  polyHaven("snow", "Snow", "snow_02", 8, "Cold"),

  // Built
  polyHaven("cobblestone", "Cobblestone", "cobblestone_floor_08", 5, "Built"),
  polyHaven("stone_path", "Stone path", "grey_stone_path", 5, "Built"),
  polyHaven("dirt_path", "Dirt path", "stony_dirt_path", 5, "Built"),

  // Pre-existing set, also what the hub and baked arenas use.
  {
    id: "sand",
    label: "Sand / gravel",
    diff: `${DIR}/sandy_gravel_02_diff_1k.jpg`,
    nor: `${DIR}/sandy_gravel_02_nor_gl_1k.jpg`,
    tile: 7,
    group: "Arid",
  },
];

/** Pool grouped for a picker, in catalog order within each group. */
export function groundMaterialsByGroup(): Array<{
  group: GroundMaterialGroup;
  items: GroundMaterialDef[];
}> {
  const order: GroundMaterialGroup[] = ["Natural", "Arid", "Cold", "Built"];
  return order
    .map((group) => ({ group, items: GROUND_MATERIALS.filter((m) => m.group === group) }))
    .filter((g) => g.items.length > 0);
}

const BY_ID = new Map(GROUND_MATERIALS.map((m) => [m.id, m]));

export function groundMaterial(id: string): GroundMaterialDef | undefined {
  return BY_ID.get(id);
}

/** Splat channels available, and so the layer cap on a painted ground. */
export const MAX_GROUND_LAYERS = 4;

/** Layers a new painted ground starts with: base first, painted on top. */
export const DEFAULT_GROUND_LAYERS: readonly string[] = ["grass", "dirt", "rock", "sand"];

/**
 * Every texture URL a set of layers needs, for preloading.
 *
 * Colour and normal only. The renderer does not sample roughness or AO -- four
 * layers of all four maps exceeds the guaranteed texture-unit budget, and
 * those two are the least missed on outdoor ground.
 */
export function groundLayerUrls(layers: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of layers.slice(0, MAX_GROUND_LAYERS)) {
    const m = groundMaterial(id);
    if (m) out.push(m.diff, m.nor);
  }
  return out;
}
