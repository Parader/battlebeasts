import {
  TALENT_CATALOG,
  type CatalogTalentDef,
  type TalentTreeId,
} from "./talentCatalog";

/**
 * Match spend caps — raised above the workbook's 20 so a deep single-tree path
 * (tiers 1→4 + multi-rank foundations) is reachable. Power still soft-caps here;
 * essence buys *owned* points up to this budget (veterans unlock options, not infinite match power).
 *
 * Full reference: docs/talents-and-progression.md
 */
export const TALENT_POINT_BUDGET = 31;
/** Enough for keystone (needs 12) + path + multi-rank foundations. */
export const TALENT_TREE_CAP = 18;

/** Essence spent to purchase one owned talent point. */
export const ESSENCE_PER_TALENT_POINT = 40;
/**
 * Essence charged per talent point removed from a build (refund rank, reshape, reset).
 */
export const ESSENCE_PER_TALENT_REFUND = 10;
/** Free points for new hunters so the tree is playable immediately. */
export const STARTER_TALENT_POINTS = 10;

// Match payouts: see ./rewards (MATCH_REWARDS / computeMatchReward).

export const TALENT_TREE_IDS: readonly TalentTreeId[] = [
  "Destruction",
  "Guardian",
  "Control",
  "Flow",
  "Harmony",
] as const;

/** Points required in-tree before a tier unlocks. */
export const TALENT_TIER_REQUIRED_POINTS: Record<number, number> = {
  1: 0,
  2: 4,
  3: 8,
  4: 12,
};

/** Selected talent ids → ranks invested (1..maxRank). */
export type TalentBuild = Record<string, number>;

export function catalogTalentsInTree(tree: TalentTreeId): CatalogTalentDef[] {
  return Object.values(TALENT_CATALOG)
    .filter((t) => t.tree === tree)
    .sort((a, b) => {
      const ao = a.layoutOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.layoutOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.id.localeCompare(b.id);
    });
}

/** Ranks a node can take. Tier-1 / 1-cost foundations default to 3 ranks. */
export function talentMaxRank(def: CatalogTalentDef): number {
  if (typeof def.maxRank === "number" && def.maxRank >= 1) return def.maxRank;
  if (def.tier === 1 && def.pointCost === 1) return 3;
  return 1;
}

/**
 * Expand percent magnitudes for tooltips.
 * Multi-rank: show one step only — current rank if invested, otherwise rank 1 (next/first).
 * e.g. max 6% over 3 ranks at rank 0 → "2%"; at rank 2 → "4%"; at rank 3 → "6%".
 */
export function formatTalentEffectRanks(
  effect: string,
  maxRank: number,
  currentRank = 0,
): string {
  if (maxRank <= 1) return effect;
  const displayRank = currentRank > 0 ? Math.min(currentRank, maxRank) : 1;
  return effect.replace(/(\d+(?:\.\d+)?)%/g, (_match, numStr: string) => {
    const total = Number(numStr);
    if (!Number.isFinite(total)) return _match;
    const raw = (total * displayRank) / maxRank;
    const value =
      Number.isInteger(total) && total % maxRank === 0
        ? (total / maxRank) * displayRank
        : Math.round(raw * 10) / 10;
    return `${value}%`;
  });
}

/** Cost to invest one additional rank. */
export function talentRankCost(def: CatalogTalentDef): number {
  return Math.max(1, def.pointCost);
}

export function totalPointsSpent(build: TalentBuild): number {
  let sum = 0;
  for (const [id, rank] of Object.entries(build)) {
    if (rank <= 0) continue;
    const def = TALENT_CATALOG[id];
    if (!def) continue;
    sum += talentRankCost(def) * rank;
  }
  return sum;
}

export function treePointsSpent(build: TalentBuild, tree: TalentTreeId): number {
  let sum = 0;
  for (const [id, rank] of Object.entries(build)) {
    if (rank <= 0) continue;
    const def = TALENT_CATALOG[id];
    if (!def || def.tree !== tree) continue;
    sum += talentRankCost(def) * rank;
  }
  return sum;
}

/**
 * Talent points dropped when reshaping `from` → `to` (adds elsewhere do not cancel).
 * e.g. remove 3 from A and put 3 in B → 3 points removed (respec fee).
 */
export function talentPointsRemoved(from: TalentBuild, to: TalentBuild): number {
  let removed = 0;
  const ids = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const id of ids) {
    const def = TALENT_CATALOG[id];
    if (!def) continue;
    const cost = talentRankCost(def);
    const before = talentRank(from, id) * cost;
    const after = talentRank(to, id) * cost;
    if (before > after) removed += before - after;
  }
  return removed;
}

/** Essence to charge for removing / reshaping `pointsRemoved` invested points. */
export function talentRefundEssenceCost(pointsRemoved: number): number {
  return Math.max(0, Math.floor(pointsRemoved)) * ESSENCE_PER_TALENT_REFUND;
}

export function isTalentTaken(build: TalentBuild, talentId: string): boolean {
  return (build[talentId] ?? 0) > 0;
}

export function talentRank(build: TalentBuild, talentId: string): number {
  return Math.max(0, build[talentId] ?? 0);
}

function tierNeed(def: CatalogTalentDef): number {
  const raw = def.requiredPoints ?? TALENT_TIER_REQUIRED_POINTS[def.tier] ?? 0;
  const cost = talentRankCost(def);
  // Keep keystones reachable inside the tree cap.
  return Math.min(raw, Math.max(0, TALENT_TREE_CAP - cost));
}

/**
 * Can spend one more rank on this node?
 * `ownedPoints` caps how many points the account may have invested in the build.
 */
export function canInvestTalent(
  build: TalentBuild,
  talentId: string,
  ownedPoints: number = TALENT_POINT_BUDGET,
): boolean {
  const def = TALENT_CATALOG[talentId];
  if (!def) return false;

  const rank = talentRank(build, talentId);
  if (rank >= talentMaxRank(def)) return false;

  const cost = talentRankCost(def);
  const treePts = treePointsSpent(build, def.tree);
  const total = totalPointsSpent(build);

  if (rank === 0 && treePts < tierNeed(def)) return false;
  if (treePts + cost > TALENT_TREE_CAP) return false;
  if (total + cost > TALENT_POINT_BUDGET) return false;
  if (total + cost > ownedPoints) return false;
  return true;
}

/**
 * Refund one rank if the remaining build still meets tier requirements.
 */
export function canRefundTalent(build: TalentBuild, talentId: string): boolean {
  const def = TALENT_CATALOG[talentId];
  const rank = talentRank(build, talentId);
  if (!def || rank <= 0) return false;

  const next: TalentBuild = { ...build };
  if (rank <= 1) delete next[talentId];
  else next[talentId] = rank - 1;

  const ptsAfter = treePointsSpent(next, def.tree);
  for (const [id, r] of Object.entries(next)) {
    if (r <= 0) continue;
    const other = TALENT_CATALOG[id];
    if (!other || other.tree !== def.tree) continue;
    if (ptsAfter < tierNeed(other)) return false;
  }
  return true;
}

export function investTalent(
  build: TalentBuild,
  talentId: string,
  ownedPoints: number = TALENT_POINT_BUDGET,
): TalentBuild {
  if (!canInvestTalent(build, talentId, ownedPoints)) return build;
  const rank = talentRank(build, talentId);
  return { ...build, [talentId]: rank + 1 };
}

export function refundTalent(build: TalentBuild, talentId: string): TalentBuild {
  if (!canRefundTalent(build, talentId)) return build;
  const rank = talentRank(build, talentId);
  const next = { ...build };
  if (rank <= 1) delete next[talentId];
  else next[talentId] = rank - 1;
  return next;
}

/** @deprecated use investTalent */
export function learnTalent(build: TalentBuild, talentId: string): TalentBuild {
  return investTalent(build, talentId);
}

/** @deprecated use refundTalent */
export function unlearnTalent(build: TalentBuild, talentId: string): TalentBuild {
  return refundTalent(build, talentId);
}

/** @deprecated use canInvestTalent */
export function canLearnTalent(build: TalentBuild, talentId: string): boolean {
  return canInvestTalent(build, talentId);
}

/** @deprecated use canRefundTalent */
export function canUnlearnTalent(build: TalentBuild, talentId: string): boolean {
  return canRefundTalent(build, talentId);
}

export function clearTree(build: TalentBuild, tree: TalentTreeId): TalentBuild {
  const next = { ...build };
  for (const id of Object.keys(next)) {
    if (TALENT_CATALOG[id]?.tree === tree) delete next[id];
  }
  return next;
}

/** Sanitize a persisted build (drop unknown ids / clamp ranks). */
export function normalizeTalentBuild(raw: unknown): TalentBuild {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TalentBuild = {};
  for (const [id, rank] of Object.entries(raw as Record<string, unknown>)) {
    const def = TALENT_CATALOG[id];
    if (!def) continue;
    const n = typeof rank === "number" ? rank : Number(rank);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[id] = Math.min(talentMaxRank(def), Math.floor(n));
  }
  return out;
}

/** Drop deepest investments until build fits owned + budget. */
export function clampBuildToOwned(build: TalentBuild, ownedPoints: number): TalentBuild {
  const next: TalentBuild = { ...build };
  const cap = Math.min(Math.max(0, ownedPoints), TALENT_POINT_BUDGET);
  let guard = 200;
  while (totalPointsSpent(next) > cap && guard-- > 0) {
    const entries = Object.entries(next)
      .filter(([, r]) => r > 0)
      .map(([id, rank]) => ({ id, rank, def: TALENT_CATALOG[id] }))
      .filter((e): e is { id: string; rank: number; def: CatalogTalentDef } => !!e.def)
      .sort((a, b) => b.def.tier - a.def.tier || b.rank - a.rank);
    const top = entries[0];
    if (!top) break;
    if (top.rank <= 1) delete next[top.id];
    else next[top.id] = top.rank - 1;
  }
  return next;
}

export const TALENT_TREE_COLUMNS = 4;

export type TalentGridCell = {
  talent: CatalogTalentDef;
  col: number;
  row: number;
};

export function layoutTalentTree(tree: TalentTreeId): {
  cells: TalentGridCell[];
  rowCount: number;
} {
  const byTier = new Map<number, CatalogTalentDef[]>();
  for (const t of catalogTalentsInTree(tree)) {
    const list = byTier.get(t.tier) ?? [];
    list.push(t);
    byTier.set(t.tier, list);
  }

  const cells: TalentGridCell[] = [];
  let row = 0;
  const cols = TALENT_TREE_COLUMNS;
  const tiers = [...byTier.keys()].sort((a, b) => a - b);

  for (const tier of tiers) {
    const list = byTier.get(tier) ?? [];
    for (let start = 0; start < list.length; start += cols) {
      const chunk = list.slice(start, start + cols);
      const offset = Math.floor((cols - chunk.length) / 2);
      chunk.forEach((talent, i) => {
        cells.push({ talent, col: i + offset, row });
      });
      row += 1;
    }
  }

  return { cells, rowCount: row };
}

export function talentTreeLinks(cells: TalentGridCell[]): Array<{
  fromId: string;
  toId: string;
}> {
  const byRow = new Map<number, TalentGridCell[]>();
  for (const c of cells) {
    const list = byRow.get(c.row) ?? [];
    list.push(c);
    byRow.set(c.row, list);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const links: Array<{ fromId: string; toId: string }> = [];

  for (let ri = 1; ri < rows.length; ri++) {
    const prev = byRow.get(rows[ri - 1]!) ?? [];
    const cur = byRow.get(rows[ri]!) ?? [];
    for (const cell of cur) {
      let best: TalentGridCell | null = null;
      let bestDist = Infinity;
      for (const p of prev) {
        const d = Math.abs(p.col - cell.col);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      if (best) links.push({ fromId: best.talent.id, toId: cell.talent.id });
    }
  }
  return links;
}
