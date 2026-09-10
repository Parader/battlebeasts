/**
 * Radial constellation layout for the talent stand.
 * Positions talent + spell-unlock placeholder nodes in world space.
 */
import {
  TALENT_CATALOG,
  isSpellTalent,
  type CatalogTalentDef,
  type TalentNodeType,
  type TalentTreeId,
} from "./talentCatalog";
import {
  TALENT_TREE_IDS,
  TALENT_TREE_COLUMNS,
  catalogTalentsInTree,
  layoutTalentTree,
  talentTreeLinks,
} from "./talentTrees";

export type ConstellationNodeKind = "talent" | "spellUnlock" | "treeHub" | "core";

/** Spell unlock stubs — abilityId filled later when spells are chosen. */
export type SpellUnlockPlaceholder = {
  id: string;
  tree: TalentTreeId;
  /** Order along the outer spell ring (0 = first). */
  layoutOrder: number;
  /** Reserved for future unlock wiring. */
  abilityId: string | null;
  label: string;
  lockedNote: string;
};

export const SPELL_UNLOCK_PLACEHOLDERS: readonly SpellUnlockPlaceholder[] = [];

export type ConstellationNode = {
  id: string;
  kind: ConstellationNodeKind;
  nodeType?: TalentNodeType;
  tree: TalentTreeId | null;
  x: number;
  y: number;
  talent?: CatalogTalentDef;
  spell?: SpellUnlockPlaceholder;
};

export type ConstellationLink = {
  fromId: string;
  toId: string;
  tree: TalentTreeId;
};

export type ConstellationLayout = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  nodes: ConstellationNode[];
  links: ConstellationLink[];
  /** Tree hub node id → tree. */
  hubByTree: Record<TalentTreeId, string>;
};

/** World canvas size (pan/zoom around this). */
export const CONSTELLATION_WORLD = 3200;
const HUB_RADIUS = 220;
const TIER_STEP = 140;
const ROW_STEP = 72;
/** Half-width of each tree sector in radians (~58° usable of 72°). */
const SECTOR_HALF = (Math.PI * 2) / TALENT_TREE_IDS.length / 2 - 0.12;

function polar(cx: number, cy: number, angle: number, radius: number) {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

/** Tree wedge center angles — start slightly above +X so Destruction sits near top-right. */
function treeAngle(treeIndex: number): number {
  const step = (Math.PI * 2) / TALENT_TREE_IDS.length;
  return -Math.PI / 2 + treeIndex * step;
}

/**
 * Build a full radial constellation: core, 5 tree hubs, talent nodes by tier,
 * spell placeholders on the outer ring, and parent→child links.
 */
export function layoutTalentConstellation(): ConstellationLayout {
  const width = CONSTELLATION_WORLD;
  const height = CONSTELLATION_WORLD;
  const centerX = width / 2;
  const centerY = height / 2;

  const nodes: ConstellationNode[] = [];
  const links: ConstellationLink[] = [];
  const linkKeys = new Set<string>();
  const hubByTree = {} as Record<TalentTreeId, string>;
  const posById = new Map<string, { x: number; y: number }>();

  const addLink = (fromId: string, toId: string, tree: TalentTreeId) => {
    const key = `${fromId}->${toId}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ fromId, toId, tree });
  };

  nodes.push({
    id: "CORE",
    kind: "core",
    tree: null,
    x: centerX,
    y: centerY,
  });
  posById.set("CORE", { x: centerX, y: centerY });

  TALENT_TREE_IDS.forEach((tree, treeIndex) => {
    const mid = treeAngle(treeIndex);
    const hubId = `HUB_${tree}`;
    hubByTree[tree] = hubId;
    const hubPos = polar(centerX, centerY, mid, HUB_RADIUS);
    nodes.push({
      id: hubId,
      kind: "treeHub",
      tree,
      x: hubPos.x,
      y: hubPos.y,
    });
    posById.set(hubId, hubPos);
    addLink("CORE", hubId, tree);

    const { cells } = layoutTalentTree(tree);
    const byId = new Map(cells.map((c) => [c.talent.id, c]));

    // Group by tier for angular fan within the sector.
    const byTier = new Map<number, CatalogTalentDef[]>();
    for (const t of catalogTalentsInTree(tree)) {
      const list = byTier.get(t.tier) ?? [];
      list.push(t);
      byTier.set(t.tier, list);
    }

    for (const [tier, list] of byTier) {
      const n = list.length;
      list.forEach((talent, i) => {
        const cell = byId.get(talent.id);
        const rowInTier = cell?.row ?? Math.max(0, tier - 1);
        // Spread across sector based on grid column position (0..4) so spokes align cleanly
        const t =
          cell != null
            ? cell.col / (TALENT_TREE_COLUMNS - 1)
            : n <= 1
              ? 0.5
              : i / (n - 1);
        const angle = mid - SECTOR_HALF + t * SECTOR_HALF * 2;
        const radius = HUB_RADIUS + TIER_STEP * 0.55 + rowInTier * TIER_STEP + ROW_STEP * 0.15;
        const p = polar(centerX, centerY, angle, radius);
        const isSpell = isSpellTalent(talent);
        nodes.push({
          id: talent.id,
          kind: isSpell ? "spellUnlock" : "talent",
          nodeType: isSpell ? "spell" : "passive",
          tree,
          x: p.x,
          y: p.y,
          talent,
        });
        posById.set(talent.id, p);
      });
    }

    // Link hub → first-tier talents (nearest parents already cover deeper).
    for (const t of byTier.get(1) ?? []) {
      addLink(hubId, t.id, tree);
    }

    for (const link of talentTreeLinks(cells)) {
      if (!posById.has(link.fromId) || !posById.has(link.toId)) continue;
      addLink(link.fromId, link.toId, tree);
    }
  });

  return { width, height, centerX, centerY, nodes, links, hubByTree };
}

export function spellPlaceholdersForTree(tree: TalentTreeId): SpellUnlockPlaceholder[] {
  return SPELL_UNLOCK_PLACEHOLDERS.filter((s) => s.tree === tree);
}

export function getSpellUnlockPlaceholder(id: string): SpellUnlockPlaceholder | undefined {
  return SPELL_UNLOCK_PLACEHOLDERS.find((s) => s.id === id);
}

/** Accent colors for constellation UI (shared so CSS vars stay consistent). */
export const TALENT_TREE_ACCENT: Record<TalentTreeId, string> = {
  Destruction: "#b45309",
  Guardian: "#57534e",
  Control: "#0e7490",
  Flow: "#4d7c0f",
  Harmony: "#a16207",
};

/** Sanity: every talent in the layout exists in the catalog. */
export function constellationTalentIds(): string[] {
  return Object.values(TALENT_CATALOG)
    .filter((t) => !t.hidden)
    .map((t) => t.id);
}
