/**
 * NPC models — the characters a map author can place and talk to.
 *
 * Deliberately thin. An NPC's *identity* (name, greeting, what pressing Space
 * does) is authored per placement in the map editor, because that is where a
 * town is designed and a shopkeeper is only a shopkeeper by virtue of standing
 * behind a counter. What lives here is the part that cannot be typed into an
 * inspector: which GLB to load and what its animation clips happen to be
 * called.
 *
 * Adding a model is one entry plus the file in `apps/web/public`. See
 * `tools/README-npc-characters.md` for producing the GLB.
 */

/**
 * Clip names as they appear inside the GLB.
 *
 * `idle` is required and doubles as the rest pose the renderer measures the
 * character's height from. `talk` is optional so a silent statue or a stall
 * with no talking animation is still placeable; the renderer falls back to
 * idle rather than freezing on a T-pose.
 */
export type NpcClips = {
  idle: string;
  talk?: string;
};

export type NpcModelDef = {
  id: string;
  /** Shown in the editor's model dropdown. */
  label: string;
  /** Path under `apps/web/public`, resolved through `assetUrl` at load. */
  file: string;
  clips: NpcClips;
  /**
   * Height in metres, for models that should not be person-sized.
   *
   * The renderer scales every character to this, measured across its idle
   * pose, so a child, a dwarf or an ogre is a number here rather than a
   * fiddled scale factor baked into the mesh.
   */
  height?: number;
};

/**
 * Built with `tools/blender_build_npc.py`, which merges Mixamo animation FBXs
 * into a rigged character and names the clips as they appear here.
 */
export const NPC_MODELS: readonly NpcModelDef[] = [
  {
    id: "merchant",
    label: "Merchant",
    file: "merchant.glb",
    clips: { idle: "idle", talk: "talk" },
  },
  {
    id: "catalina",
    label: "Catalina",
    file: "catalina.glb",
    clips: { idle: "idle", talk: "talk" },
  },
  {
    id: "oldman",
    label: "Old Man",
    file: "oldman.glb",
    clips: { idle: "idle", talk: "talk" },
  },
  {
    id: "villageoise",
    label: "Villageoise",
    file: "villageoise.glb",
    clips: { idle: "idle", talk: "talk" },
  },
];

export const NPC_MODEL_IDS: readonly string[] = NPC_MODELS.map((m) => m.id);

export function npcModel(id: string): NpcModelDef | undefined {
  return NPC_MODELS.find((m) => m.id === id);
}

/**
 * What pressing Space on an NPC does.
 *
 * `talk` is the plain case: show the greeting and a way out. The rest add a
 * button handing off to a panel the game already has, which is why a
 * shopkeeper needed no new shop -- only a new door into the old one. The ids
 * after `talk` deliberately match the hub's own interact kinds, so an NPC is
 * an alternative doorway to a stand rather than a parallel system.
 */
export const NPC_ACTIONS = [
  "talk",
  "shop",
  "build",
  "talent",
  "customization",
  "quests",
  "portal_pvp",
  "portal_pve",
] as const;
export type NpcAction = (typeof NPC_ACTIONS)[number];

/**
 * Label for the hand-off button, or null when the NPC only talks.
 *
 * Phrased as something a person would offer rather than as the panel's name:
 * a blacksmith says "Browse wares", she does not say "Shop".
 */
const NPC_ACTION_LABELS: Record<string, string> = {
  shop: "Browse wares",
  build: "Study spells",
  talent: "Train talents",
  customization: "Change your look",
  quests: "Ask about work",
  portal_pvp: "Enter the arena",
  portal_pve: "Enter the dungeon",
};

export function npcActionLabel(action: string): string | null {
  return NPC_ACTION_LABELS[action] ?? null;
}

/**
 * How close you must stand to talk, in metres.
 *
 * Generous, because an NPC's collider keeps you at arm's length anyway and a
 * prompt that requires precise footwork reads as broken rather than strict.
 */
export const NPC_INTERACT_RADIUS = 2.6;

/** Interact id for an NPC placement. Namespaced against stands and dummies. */
export function npcInteractId(elementId: string): string {
  return `npc:${elementId}`;
}

/** The element id behind an interact id, or null when it is not an NPC. */
export function npcElementIdFrom(interactId: string): string | null {
  return interactId.startsWith("npc:") ? interactId.slice(4) : null;
}
