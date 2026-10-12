/**
 * Ground material library for painted terrain.
 *
 * Deliberately data-only -- no three.js here. This module is reachable from
 * `shared/index`, which the game server imports, and the server has no
 * business pulling a renderer in just to know a material's id.
 *
 * A painted splat stores two materials per texel (what's underneath, and what
 * the brush is blending in) so a map can use every material in this catalog.
 * Older maps still store four layer weights; the editor converts those on load.
 *
 * `slot` is the byte written into the splat. It is the index in this catalog
 * and must only grow by appending. Reordering or inserting would retint every
 * saved map.
 *
 * Scanned sources are Poly Haven and ambientCG (both CC0), plus the terrain
 * layers shipped with the SICS prop packs. The 1k tier is deliberate: the
 * camera is top-down and every material stretches over a multi-metre repeat.
 *
 * FreePBR is intentionally skipped: its free downloads are personal-use only,
 * while Poly Haven / ambientCG stay CC0 for a commercial game.
 */

import { SICS_GROUND_MATERIALS } from "./groundMaterials.sics";

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
  /**
   * Byte stored in the splat. Assigned from catalog order; append-only.
   * Zero is a valid slot.
   */
  slot: number;
  /** Grouping for the material picker. */
  group: GroundMaterialGroup;
};

/** A catalog entry before its splat slot is assigned. */
type GroundMaterialSource = Omit<GroundMaterialDef, "slot">;

/**
 * Author-facing categories for the ground material picker.
 *
 * Keep this list short and terrain-shaped: authors filter by surface type,
 * not by source site.
 */
export type GroundMaterialGroup =
  | "Enchanted Meadow"
  | "Golden Valley"
  | "Deserted Temples"
  | "Spring Isles"
  | "Underworld"
  | "Stone Age"
  | "Ground"
  | "Grass & Moss"
  | "Sand"
  | "Rock"
  | "Earth"
  | "Snow"
  | "Desert"
  | "Built";

export const GROUND_MATERIAL_GROUP_ORDER: readonly GroundMaterialGroup[] = [
  "Enchanted Meadow",
  "Golden Valley",
  "Deserted Temples",
  "Spring Isles",
  "Underworld",
  "Stone Age",
  "Ground",
  "Grass & Moss",
  "Sand",
  "Rock",
  "Earth",
  "Snow",
  "Desert",
  "Built",
];

const DIR = "ground_textures";

function polyHaven(
  id: string,
  label: string,
  slug: string,
  tile: number,
  group: GroundMaterialGroup,
): GroundMaterialSource {
  return {
    id,
    label,
    diff: `${DIR}/${slug}_diff_1k.jpg`,
    nor: `${DIR}/${slug}_nor_gl_1k.jpg`,
    tile,
    group,
  };
}

/** ambientCG assets downloaded as Color + NormalGL into our naming scheme. */
function ambientCg(
  id: string,
  label: string,
  assetId: string,
  tile: number,
  group: GroundMaterialGroup,
): GroundMaterialSource {
  const slug = assetId.toLowerCase();
  return {
    id,
    label,
    diff: `${DIR}/acg_${slug}_diff_1k.jpg`,
    nor: `${DIR}/acg_${slug}_nor_gl_1k.jpg`,
    tile,
    group,
  };
}

/**
 * Scanned ground, in catalog order. SICS terrain layers are appended so their
 * slots stay after the scans that already shipped.
 *
 * Ids are stable and stored in map documents, so rename labels freely but
 * never an id. Slots follow this order and must only grow at the end.
 */
const GROUND_MATERIAL_SOURCES: readonly GroundMaterialSource[] = [
  // --- Ground (mixed cover: gravel, pebbles, leaves, forest litter) ---
  polyHaven("pebbles", "Pebbles", "pebble_ground_01", 5, "Ground"),
  polyHaven("pebbles_clean", "Pebbles, clean", "clean_pebbles", 5, "Ground"),
  polyHaven("gravel", "Gravel", "gravel_ground_01", 5, "Ground"),
  polyHaven("gravel_floor", "Gravel floor", "gravel_floor", 5, "Ground"),
  polyHaven("gravel_rocky", "Gravel, rocky", "rocky_gravel", 5, "Ground"),
  polyHaven("gravel_coral", "Gravel, coral", "coral_gravel", 5, "Ground"),
  ambientCg("acg_gravel_022", "Gravel 022", "Gravel022", 5, "Ground"),
  ambientCg("acg_gravel_023", "Gravel 023", "Gravel023", 5, "Ground"),
  ambientCg("acg_gravel_026", "Gravel 026", "Gravel026", 5, "Ground"),
  ambientCg("acg_gravel_040", "Gravel 040", "Gravel040", 5, "Ground"),
  polyHaven("forest_floor", "Forest floor", "forest_ground_04", 7, "Ground"),
  polyHaven("forest_floor_dense", "Forest floor, dense", "forest_ground_05", 7, "Ground"),
  polyHaven("forest_litter", "Forest litter", "forest_floor", 7, "Ground"),
  polyHaven("leaves", "Fallen leaves", "dry_decay_leaves", 5, "Ground"),
  polyHaven("leaves_forest", "Forest leaves", "leaves_forest_ground", 5, "Ground"),
  polyHaven("pine_needles", "Pine needles", "forrest_ground_03", 6, "Ground"),
  polyHaven("wood_chips", "Wood chips", "wood_chips", 5, "Ground"),
  ambientCg("acg_ground_106", "Ground 106", "Ground106", 7, "Ground"),
  ambientCg("acg_ground_110", "Ground 110", "Ground110", 7, "Ground"),

  // --- Grass & Moss ---
  polyHaven("grass", "Grass", "aerial_grass_rock", 8, "Grass & Moss"),
  polyHaven("grass_leafy", "Grass, leafy", "leafy_grass", 6, "Grass & Moss"),
  polyHaven("grass_woodland", "Grass, woodland", "forrest_ground_01", 6, "Grass & Moss"),
  polyHaven("grass_path", "Grass path", "grass_path_3", 6, "Grass & Moss"),
  polyHaven("grass_ground", "Grass ground", "grass_ground", 6, "Grass & Moss"),
  polyHaven("grass_sparse", "Grass, sparse", "sparse_grass", 6, "Grass & Moss"),
  polyHaven("grass_withered", "Grass, withered", "withered_grass", 6, "Grass & Moss"),
  polyHaven("leaves_mossy", "Mossy leaves", "forest_leaves_02", 5, "Grass & Moss"),
  polyHaven("rock_mossy", "Rock, mossy", "mossy_rock", 7, "Grass & Moss"),
  polyHaven("rock_mossy_pitted", "Rock, mossy pitted", "rock_pitted_mossy", 7, "Grass & Moss"),
  ambientCg("acg_grass_001", "Grass 001", "Grass001", 6, "Grass & Moss"),
  ambientCg("acg_grass_002", "Grass 002", "Grass002", 6, "Grass & Moss"),
  ambientCg("acg_grass_005", "Grass 005", "Grass005", 6, "Grass & Moss"),
  ambientCg("acg_grass_006", "Grass 006", "Grass006", 6, "Grass & Moss"),
  ambientCg("acg_moss_001", "Moss 001", "Moss001", 5, "Grass & Moss"),
  ambientCg("acg_moss_002", "Moss 002", "Moss002", 5, "Grass & Moss"),
  ambientCg("acg_moss_003", "Moss 003", "Moss003", 5, "Grass & Moss"),

  // --- Sand ---
  polyHaven("sand", "Sand / gravel", "sandy_gravel_02", 7, "Sand"),
  polyHaven("sand_beach", "Sand, beach", "coast_sand_01", 7, "Sand"),
  polyHaven("sand_beach_fine", "Sand, beach fine", "coast_sand_02", 7, "Sand"),
  polyHaven("sand_beach_wet", "Sand, beach wet", "coast_sand_03", 7, "Sand"),
  polyHaven("sand_pebbly", "Sand, pebbly", "coast_sand_04", 7, "Sand"),
  polyHaven("sand_damp", "Sand, damp", "damp_beach_sand", 7, "Sand"),
  polyHaven("sand_dense", "Sand, dense", "dense_sand", 7, "Sand"),
  polyHaven("sand_plain", "Sand", "sand_01", 7, "Sand"),
  polyHaven("sand_rippled", "Sand, rippled", "sand_02", 7, "Sand"),
  polyHaven("sand_aerial", "Sand, aerial", "aerial_sand", 9, "Sand"),
  polyHaven("sand_playground", "Sand, playground", "playground_sand", 6, "Sand"),
  polyHaven("sand_gravelly", "Sand, gravelly", "gravelly_sand", 7, "Sand"),
  ambientCg("acg_ground_054", "Sand, beach mud", "Ground054", 7, "Sand"),
  ambientCg("acg_ground_080", "Sand, yellow", "Ground080", 7, "Sand"),

  // --- Rock ---
  polyHaven("rock", "Rock", "rocky_terrain_02", 7, "Rock"),
  polyHaven("rock_rough", "Rock, rough", "rocky_terrain_03", 7, "Rock"),
  polyHaven("rock_aerial", "Rock, broken", "aerial_rocks_02", 9, "Rock"),
  polyHaven("rock_aerial_coarse", "Rock, aerial", "aerial_rocks_04", 9, "Rock"),
  polyHaven("rock_ground", "Rock ground", "rock_ground", 7, "Rock"),
  polyHaven("rocks_ground", "Rocks on ground", "rocks_ground_02", 7, "Rock"),
  polyHaven("rocks_scattered", "Rocks, scattered", "rocks_ground_04", 7, "Rock"),
  polyHaven("rock_gray", "Rock, gray", "gray_rocks", 7, "Rock"),
  polyHaven("rock_riverbed", "Rock, riverbed", "dry_riverbed_rock", 7, "Rock"),
  polyHaven("rocky_trail", "Rocky trail", "rocky_trail", 6, "Rock"),
  ambientCg("acg_rock_029", "Rock 029", "Rock029", 7, "Rock"),

  // --- Earth (dirt, mud, soil) ---
  polyHaven("dirt", "Dirt", "brown_mud_leaves_01", 6, "Earth"),
  polyHaven("dirt_plain", "Dirt, plain", "dirt", 6, "Earth"),
  polyHaven("dirt_woodland", "Dirt, woodland", "dirt_floor", 6, "Earth"),
  polyHaven("dirt_park", "Dirt, park", "park_dirt", 6, "Earth"),
  polyHaven("dirt_raked", "Dirt, raked", "raked_dirt", 6, "Earth"),
  polyHaven("dirt_red", "Dirt, red", "red_dirt_mud_01", 6, "Earth"),
  polyHaven("mud", "Mud, wet", "brown_mud_03", 6, "Earth"),
  polyHaven("mud_dry", "Mud, dry", "brown_mud_dry", 6, "Earth"),
  polyHaven("mud_rocks", "Mud and rocks", "brown_mud_rocks_01", 6, "Earth"),
  polyHaven("mud_aerial", "Mud, aerial", "aerial_mud_1", 8, "Earth"),
  polyHaven("mud_tracks", "Muddy tracks", "muddy_tracks", 6, "Earth"),
  polyHaven("soil_farm", "Farm soil", "farm_soil", 6, "Earth"),
  ambientCg("acg_ground_109", "Soil ground", "Ground109", 7, "Earth"),

  // --- Snow ---
  polyHaven("snow", "Snow", "snow_02", 8, "Snow"),
  polyHaven("snow_tracked", "Snow, tracked", "snow_01", 8, "Snow"),
  polyHaven("snow_muddy", "Snow, muddy", "snow_03", 8, "Snow"),
  polyHaven("snow_fresh", "Snow, fresh", "snow_04", 8, "Snow"),
  polyHaven("snow_packed", "Snow, packed", "snow_05", 8, "Snow"),
  polyHaven("snow_floor", "Snow floor", "snow_floor", 8, "Snow"),
  polyHaven("snow_field", "Snow field", "snow_field_aerial", 10, "Snow"),
  ambientCg("acg_snow_006", "Snow 006", "Snow006", 8, "Snow"),
  ambientCg("acg_snow_008a", "Snow 008 A", "Snow008A", 8, "Snow"),
  ambientCg("acg_snow_010a", "Snow 010 A", "Snow010A", 8, "Snow"),
  ambientCg("acg_snow_012", "Snow 012", "Snow012", 8, "Snow"),
  ambientCg("acg_snow_015", "Snow 015", "Snow015", 8, "Snow"),

  // --- Desert (arid, dunes, cracked, scorched) ---
  polyHaven("sand_red", "Sand, red", "red_sand", 7, "Desert"),
  polyHaven("dry_earth", "Dry earth", "dry_ground_01", 7, "Desert"),
  polyHaven("dry_earth_rocks", "Dry earth, rocky", "dry_ground_rocks", 7, "Desert"),
  polyHaven("cracked_earth", "Cracked earth", "cracked_red_ground", 7, "Desert"),
  polyHaven("dry_mud", "Dry mud, cracked", "mud_cracked_dry_03", 7, "Desert"),
  polyHaven("dry_mud_field", "Dry mud field", "dry_mud_field_001", 7, "Desert"),
  polyHaven("red_mud", "Red mud", "red_mud_stones", 7, "Desert"),
  polyHaven("laterite", "Laterite soil", "red_laterite_soil_stones", 7, "Desert"),
  polyHaven("burned", "Scorched earth", "burned_ground_01", 7, "Desert"),
  ambientCg("acg_ground_093a", "Desert dunes A", "Ground093A", 8, "Desert"),
  ambientCg("acg_ground_093c", "Desert dunes C", "Ground093C", 8, "Desert"),
  ambientCg("acg_ground_095a", "Desert sand wet", "Ground095A", 8, "Desert"),
  ambientCg("acg_ground_097", "Desert waves", "Ground097", 8, "Desert"),
  ambientCg("acg_ground_098", "Desert ground", "Ground098", 8, "Desert"),
  ambientCg("acg_ground_102", "Desert packed", "Ground102", 7, "Desert"),

  // --- Built ---
  polyHaven("cobblestone", "Cobblestone", "cobblestone_floor_08", 5, "Built"),
  polyHaven("cobblestone_large", "Cobblestone, large", "cobblestone_large_01", 6, "Built"),
  polyHaven("cobblestone_mossy", "Cobblestone, mossy", "mossy_cobblestone", 5, "Built"),
  polyHaven("brick_pavement", "Brick pavement", "brick_pavement", 5, "Built"),
  polyHaven("stone_path", "Stone path", "grey_stone_path", 5, "Built"),
  polyHaven("stone_tiles", "Stone tiles", "stone_tiles_03", 5, "Built"),
  polyHaven("dirt_path", "Dirt path", "stony_dirt_path", 5, "Built"),
  polyHaven("hex_pavement", "Hex pavement", "hexagonal_concrete_paving", 5, "Built"),
  polyHaven("concrete", "Concrete", "concrete_pavement", 6, "Built"),
  polyHaven("asphalt", "Asphalt", "asphalt_02", 8, "Built"),
];

function withSlots(defs: readonly GroundMaterialSource[]): GroundMaterialDef[] {
  if (defs.length > 255) {
    throw new Error(`ground catalog has ${defs.length} materials; a splat slot is one byte`);
  }
  return defs.map((def, slot) => ({ ...def, slot }));
}

export const GROUND_MATERIALS: readonly GroundMaterialDef[] = withSlots([
  ...GROUND_MATERIAL_SOURCES,
  ...SICS_GROUND_MATERIALS.map(
    (material): GroundMaterialSource => ({
      id: material.id,
      label: material.label,
      diff: material.diff,
      nor: material.nor,
      tile: material.tile,
      group: material.group as GroundMaterialGroup,
    }),
  ),
]);

/** Pool grouped for a picker, in catalog order within each group. */
export function groundMaterialsByGroup(opts?: {
  /** When set, materials whose ids are in this set are omitted. */
  excludeIds?: ReadonlySet<string>;
}): Array<{
  group: GroundMaterialGroup;
  items: GroundMaterialDef[];
}> {
  const exclude = opts?.excludeIds;
  return GROUND_MATERIAL_GROUP_ORDER.map((group) => ({
    group,
    items: GROUND_MATERIALS.filter(
      (m) => m.group === group && !(exclude?.has(m.id) ?? false),
    ),
  })).filter((g) => g.items.length > 0);
}

const BY_ID = new Map(GROUND_MATERIALS.map((m) => [m.id, m]));
const BY_SLOT = new Map(GROUND_MATERIALS.map((m) => [m.slot, m]));

export function groundMaterial(id: string): GroundMaterialDef | undefined {
  return BY_ID.get(id);
}

/** Splat byte for a material id. Unknown ids fall back to slot 0. */
export function groundSlot(id: string): number {
  return BY_ID.get(id)?.slot ?? 0;
}

export function groundBySlot(slot: number): GroundMaterialDef | undefined {
  return BY_SLOT.get(slot);
}

/**
 * Rewrite a legacy four-weight splat into the two-material index format.
 *
 * Each texel keeps its two strongest layers. The fourth weight is whatever
 * the first three do not use, matching the shader those maps were painted with.
 * Channel A stays opaque so a canvas reload cannot premultiply the indices away.
 */
export function convertWeightSplatToIndex(splat: Uint8Array, layerIds: readonly string[]): void {
  const slots = [0, 1, 2, 3].map((index) => groundSlot(layerIds[index] ?? layerIds[0] ?? "grass"));
  for (let i = 0; i < splat.length; i += 4) {
    const weights = [
      (splat[i] ?? 0) / 255,
      (splat[i + 1] ?? 0) / 255,
      (splat[i + 2] ?? 0) / 255,
      0,
    ];
    weights[3] = Math.max(0, 1 - weights[0]! - weights[1]! - weights[2]!);
    let first = 0;
    let second = 1;
    for (let channel = 1; channel < 4; channel++) {
      if (weights[channel]! > weights[first]!) first = channel;
    }
    second = first === 0 ? 1 : 0;
    for (let channel = 0; channel < 4; channel++) {
      if (channel !== first && weights[channel]! > weights[second]!) second = channel;
    }
    const sum = weights[first]! + weights[second]!;
    const blend = sum > 0.001 ? weights[second]! / sum : 0;
    splat[i] = slots[first] ?? 0;
    splat[i + 1] = slots[second] ?? slots[first] ?? 0;
    splat[i + 2] = Math.round(blend * 255);
    splat[i + 3] = 255;
  }
}

/** Splat channels of a legacy weight map, and so its layer cap. */
export const MAX_GROUND_LAYERS = 4;

/** Layers a new painted ground starts with: base first, painted on top. */
export const DEFAULT_GROUND_LAYERS: readonly string[] = ["grass", "dirt", "rock", "sand"];

/**
 * Every colour and normal URL a set of materials needs, for preloading.
 * Materials without a normal (flat) contribute only their colour.
 */
export function groundLayerUrls(layers: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of layers) {
    const material = groundMaterial(id);
    if (!material) continue;
    out.push(material.diff);
    if (material.nor) out.push(material.nor);
  }
  return out;
}
