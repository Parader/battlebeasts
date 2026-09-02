/**
 * Groups prop families into browsable categories.
 *
 * The library spans 900+ families, and biome alone does not narrow it -- the
 * `kingdom` biome by itself is 578 families, most of them modular building
 * pieces. Family name alone is not enough either, because
 * `Castle_Roof_L_Corner_Half` and `House_Roof_Tile_Edge` are the same kind of
 * thing filed under different buildings.
 *
 * Matching is on WHOLE WORDS, not substrings: the family name is split on
 * underscores and camelCase humps first, so `Street_Lamp` is [street, lamp]
 * and cannot match "tree" the way a substring search does (s-TREE-t).
 *
 * Rules are evaluated in order and FIRST MATCH WINS, which makes the ordering
 * below load-bearing: `Castle_Roof_*` must reach Roofs before Buildings, and
 * `Stone_Path` must reach Paths before Rocks. These are heuristics, not truth;
 * the search box stays the precise tool.
 */

export type Category = { id: string; label: string; words: string[] };

const RULES: Category[] = [
  // Whole assembled buildings. First, because they are the fastest way to
  // fill a map and would otherwise scatter across Buildings and Furniture.
  { id: "prefab", label: "Prefabs (ready-made)", words: ["preset"] },

  // Modular kit pieces, pulled out of Buildings so that category stays usable.
  { id: "roof", label: "Roofs", words: ["roof", "roofs", "thatch", "shingle"] },
  {
    id: "wall",
    label: "Walls & Fences",
    words: ["wall", "walls", "walledge", "battlement", "battlements", "hoarding", "fence", "fences", "railing", "palisade", "corbel", "corbels", "arrowslit"],
  },
  {
    id: "floor",
    label: "Floors, Paths & Stairs",
    words: ["floor", "flooring", "path", "paths", "paving", "tile", "tiles", "walkway", "stair", "stairs", "ramp", "step", "steps", "bridge", "dock", "podest"],
  },
  {
    id: "building",
    label: "Buildings & Structures",
    words: ["castle", "keep", "tower", "towergap", "house", "hut", "tent", "gazebo", "stage", "windmill", "waterwheel", "lighthouse", "church", "iglo", "pyramid", "sphinx", "structure", "arch", "archway", "stonearch", "woodarch", "pillar", "pillars", "column", "obelisk", "gate", "door", "chimney", "balcony", "observatory", "stables", "tavern", "outhouse", "shelter", "blacksmith", "supports", "glass"],
  },

  { id: "tree", label: "Trees", words: ["tree", "trees", "palm", "baobab", "cactus", "willow", "trunk", "stump", "deadfall", "coconut"] },
  {
    id: "plant",
    label: "Bushes & Plants",
    words: ["bush", "shrub", "hedge", "fern", "grass", "ivy", "vine", "plant", "reed", "reeds", "leaf", "leaves", "tendril", "moss", "algae", "papyrus", "wheat", "pumpkin", "cabbage", "mushroom", "coral", "seashell", "starfish", "herb", "garlic", "onion", "agaric"],
  },
  {
    id: "flower",
    label: "Flowers",
    words: ["flower", "flowers", "rose", "tulip", "daisy", "daffodil", "lily", "sunflower", "pansy", "gladiolus", "hyacinth", "dandelion", "arum"],
  },

  {
    id: "rock",
    label: "Rocks & Terrain",
    words: ["rock", "rocks", "stone", "boulder", "cliff", "mountain", "mountains", "hill", "canyon", "dune", "plateau", "pebble", "pebbles", "menhir", "iceberg", "ice", "icicle", "crystal", "ore", "sandstone", "sand", "sandcastle", "snowdrift", "volcano", "lava"],
  },
  { id: "water", label: "Water", words: ["water", "river", "riverbed", "lake", "fountain", "pool", "well", "waterfall", "floe", "puddle"] },

  { id: "light", label: "Lighting & Fire", words: ["torch", "lamp", "lantern", "lanturn", "candle", "candlestand", "candlestick", "brazier", "campfire", "firepit", "fireplace", "fire", "chandelier", "forge"] },
  { id: "sign", label: "Signs, Flags & Market", words: ["sign", "banner", "flag", "bunting", "poster", "board", "label", "awning", "market", "weathervane", "direction", "quest"] },
  { id: "container", label: "Containers & Planters", words: ["barrel", "crate", "chest", "sack", "basket", "bucket", "pot", "cauldron", "box", "planter", "planterbox", "bag", "bindle", "kettle"] },
  {
    id: "furniture",
    label: "Furniture & Workstations",
    words: ["table", "chair", "bench", "stool", "bed", "shelf", "shelves", "cabinet", "dresser", "workbench", "anvil", "rack", "throne", "desk", "stand", "divider", "lectern", "grinding", "cooking", "plow"],
  },
  { id: "vehicle", label: "Vehicles & Carts", words: ["cart", "coach", "boat", "wheelbarrow", "sleigh", "dinghy", "wagon", "sled", "surfboard"] },

  {
    id: "monument",
    label: "Monuments & Grim",
    words: ["grave", "gravestone", "tomb", "skull", "bone", "skeleton", "spiderweb", "rune", "statue", "cross", "gallows", "guillotine", "cage", "dummy", "target", "spike", "teleporter", "relic", "shrine", "limb"],
  },
  {
    id: "debris",
    label: "Debris, Logs & Timber",
    words: ["destroyed", "debris", "rubble", "ruin", "burnt", "burned", "broken", "damaged", "wreck", "log", "logs", "plank", "planks", "beam", "beams", "pile", "hay", "chain", "rope", "ladder", "tether", "washing", "clothes"],
  },
];

const FALLBACK = "other";

/** Word-set per rule, so classification is a set lookup rather than a scan. */
const RULE_SETS = RULES.map((r) => ({ id: r.id, words: new Set(r.words) }));

export const CATEGORY_LABELS = new Map<string, string>([
  ...RULES.map((r) => [r.id, r.label] as [string, string]),
  [FALLBACK, "Other"],
]);

/** Display order; `other` always sinks to the bottom. */
export const CATEGORY_ORDER = [...RULES.map((r) => r.id), FALLBACK];

/** `House_RoofTile_01` -> ["house", "roof", "tile", "01"] */
function words(family: string): string[] {
  return family
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

const memo = new Map<string, string>();

export function categorize(family: string): string {
  const cached = memo.get(family);
  if (cached) return cached;
  const toks = words(family);
  const found = RULE_SETS.find((r) => toks.some((t) => r.words.has(t)))?.id ?? FALLBACK;
  memo.set(family, found);
  return found;
}
