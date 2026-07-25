import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Room } from "colyseus.js";
import {
  ESSENCE_PER_TALENT_POINT,
  ESSENCE_RESET_ALL,
  ESSENCE_RESET_TREE,
  TALENT_CATALOG,
  TALENT_POINT_BUDGET,
  TALENT_TREE_CAP,
  TALENT_TREE_COLUMNS,
  TALENT_TREE_IDS,
  canInvestTalent,
  canRefundTalent,
  formatTalentEffectRanks,
  investTalent,
  isCatalogTalentImplemented,
  isTalentTaken,
  layoutTalentTree,
  normalizeTalentBuild,
  refundTalent,
  talentMaxRank,
  talentRank,
  talentRankCost,
  talentTreeLinks,
  totalPointsSpent,
  treePointsSpent,
  type CatalogTalentDef,
  type TalentBuild,
  type TalentTreeId,
} from "@battlebeasts/shared";

import { TalentNatureIcon, primaryTalentNatureTag } from "./TalentNatureIcon";

const TREE_ACCENT: Record<TalentTreeId, string> = {
  Destruction: "#b45309",
  Guardian: "#57534e",
  Control: "#0e7490",
  Flow: "#4d7c0f",
  Harmony: "#a16207",
};

const CELL = 52;
const GAP_X = 28;
const GAP_Y = 36;
const PAD = 20;

function TalentTooltip({
  talent,
  rank,
  state,
}: {
  talent: CatalogTalentDef;
  rank: number;
  state: "locked" | "available" | "learned";
}) {
  const maxRank = talentMaxRank(talent);
  const cost = talentRankCost(talent);
  const effectText = formatTalentEffectRanks(talent.exactEffect, maxRank, rank);
  const implemented = isCatalogTalentImplemented(talent);
  const nature = primaryTalentNatureTag(talent.affectedTags);
  return (
    <div className="bb-talent-tip" role="tooltip">
      <div className="bb-talent-tip__head">
        <span className="bb-talent-tip__icon" aria-hidden>
          <TalentNatureIcon tags={talent.affectedTags} size={18} />
        </span>
        <div>
          <div className="bb-talent-tip__name">{talent.name}</div>
          <div className="bb-talent-tip__meta">
            Tier {talent.tier}
            {nature ? ` · ${nature}` : ""}
            {maxRank > 1 ? ` · Rank ${rank}/${maxRank}` : ""}
            {" · "}
            {cost} pt{cost === 1 ? "" : "s"}
            {maxRank > 1 ? "/rank" : ""}
            {talent.requiredPoints > 0 ? ` · needs ${talent.requiredPoints} in tree` : ""}
          </div>
        </div>
      </div>
      {!implemented ? (
        <p className="bb-talent-tip__wip">Not implemented — design preview only</p>
      ) : null}
      <p className="bb-talent-tip__body">{effectText}</p>
      {talent.affectedTags.length > 0 ? (
        <div className="bb-talent-tip__tags">
          {talent.affectedTags.map((tag) => (
            <span key={tag} className="bb-talent-tip__tag">
              <TalentNatureIcon tags={[tag]} size={11} />
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <p className="bb-talent-tip__hint">
        {state === "learned" && rank < maxRank
          ? "Left-click to raise rank · Right-click to refund"
          : state === "learned"
            ? "Right-click to refund a rank"
            : state === "available"
              ? "Left-click to invest"
              : "Locked — spend more points in this tree"}
      </p>
    </div>
  );
}

function TreeBoard({
  tree,
  build,
  ownedPoints,
  onChange,
}: {
  tree: TalentTreeId;
  build: TalentBuild;
  ownedPoints: number;
  onChange: (next: TalentBuild) => void;
}) {
  const { cells, rowCount } = useMemo(() => layoutTalentTree(tree), [tree]);
  const links = useMemo(() => talentTreeLinks(cells), [cells]);
  const byId = useMemo(() => {
    const m = new Map<string, (typeof cells)[number]>();
    for (const c of cells) m.set(c.talent.id, c);
    return m;
  }, [cells]);

  const width = PAD * 2 + TALENT_TREE_COLUMNS * CELL + (TALENT_TREE_COLUMNS - 1) * GAP_X;
  const height = PAD * 2 + Math.max(1, rowCount) * CELL + Math.max(0, rowCount - 1) * GAP_Y;
  const accent = TREE_ACCENT[tree];

  const cellCenter = (id: string) => {
    const c = byId.get(id);
    if (!c) return { x: 0, y: 0 };
    return {
      x: PAD + c.col * (CELL + GAP_X) + CELL / 2,
      y: PAD + c.row * (CELL + GAP_Y) + CELL / 2,
    };
  };

  return (
    <div
      className="bb-talent-board"
      style={{ "--bb-talent-accent": accent } as CSSProperties}
    >
      <svg className="bb-talent-board__links" width={width} height={height} aria-hidden>
        {links.map((link) => {
          const a = cellCenter(link.fromId);
          const b = cellCenter(link.toId);
          const active = isTalentTaken(build, link.fromId) && isTalentTaken(build, link.toId);
          const midY = (a.y + b.y) / 2;
          return (
            <path
              key={`${link.fromId}-${link.toId}`}
              d={`M ${a.x} ${a.y + CELL / 2 - 2} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y - CELL / 2 + 2}`}
              className={active ? "bb-talent-link bb-talent-link--on" : "bb-talent-link"}
              fill="none"
            />
          );
        })}
      </svg>

      <div className="bb-talent-board__nodes" style={{ width, height }}>
        {cells.map(({ talent, col, row }) => {
          const rank = talentRank(build, talent.id);
          const maxRank = talentMaxRank(talent);
          const canUp = canInvestTalent(build, talent.id, ownedPoints);
          const canDown = canRefundTalent(build, talent.id);
          const implemented = isCatalogTalentImplemented(talent);
          const state: "locked" | "available" | "learned" =
            rank > 0 ? "learned" : canUp ? "available" : "locked";

          return (
            <button
              key={talent.id}
              type="button"
              title={talent.name}
              className={[
                "bb-talent-node",
                state === "learned" ? "bb-talent-node--learned" : "",
                state === "available" ? "bb-talent-node--available" : "",
                state === "locked" ? "bb-talent-node--locked" : "",
                !implemented ? "bb-talent-node--wip" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: PAD + col * (CELL + GAP_X),
                top: PAD + row * (CELL + GAP_Y),
                width: CELL,
                height: CELL,
              }}
              onClick={() => {
                if (canUp) onChange(investTalent(build, talent.id, ownedPoints));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (canDown) onChange(refundTalent(build, talent.id));
              }}
            >
              <span className="bb-talent-node__glyph" aria-hidden>
                <TalentNatureIcon tags={talent.affectedTags} size={22} />
              </span>
              {!implemented ? <span className="bb-talent-node__wip">WIP</span> : null}
              {maxRank > 1 ? (
                <span className="bb-talent-node__rank">
                  {rank}/{maxRank}
                </span>
              ) : (
                <span className="bb-talent-node__cost">{talentRankCost(talent)}</span>
              )}
              <TalentTooltip talent={talent} rank={rank} state={state} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  room: Room | null;
  essence: number;
  talentPoints: number;
  talentBuild: TalentBuild;
};

export function TalentTreePanel({ room, essence, talentPoints, talentBuild }: Props) {
  const [tree, setTree] = useState<TalentTreeId>("Destruction");
  const [build, setBuild] = useState<TalentBuild>(() => normalizeTalentBuild(talentBuild));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setBuild(normalizeTalentBuild(talentBuild));
  }, [talentBuild, dirty]);

  const spent = totalPointsSpent(build);
  const treeSpent = treePointsSpent(build, tree);
  const owned = talentPoints;
  const remainingOwned = Math.max(0, owned - spent);
  const canBuy = owned < TALENT_POINT_BUDGET && essence >= ESSENCE_PER_TALENT_POINT;
  const implementedCount = useMemo(
    () => Object.values(TALENT_CATALOG).filter((t) => isCatalogTalentImplemented(t)).length,
    [],
  );
  const catalogCount = Object.keys(TALENT_CATALOG).length;

  const updateBuild = (next: TalentBuild) => {
    setBuild(next);
    setDirty(true);
  };

  return (
    <div className="bb-talent-panel space-y-3">
      <p className="text-sm text-[var(--bb-ink-soft)]">
        Earn essence in matches (more for wins). Spend essence to buy talent points, then invest
        them in trees. Tier-1 foundations take up to 3 ranks. Cap {TALENT_POINT_BUDGET} points (
        {TALENT_TREE_CAP}/tree). Nodes marked WIP are design-only until implemented in combat (
        {implementedCount}/{catalogCount} live).
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--bb-brass-dim)]/50 bg-[rgba(26,34,28,0.06)] px-2.5 py-2">
        <span className="text-xs font-semibold text-[var(--bb-ink)]">
          Owned points{" "}
          <span className="text-[var(--bb-brass-dim)]">
            {owned}/{TALENT_POINT_BUDGET}
          </span>
        </span>
        <span className="text-[var(--bb-ink-soft)]">·</span>
        <span className="text-xs text-[var(--bb-ink-soft)]">
          Essence {essence} · {ESSENCE_PER_TALENT_POINT} / point
        </span>
        <button
          type="button"
          className="bb-btn-brass !px-2 !py-1 text-[10px] disabled:opacity-40"
          disabled={!canBuy}
          onClick={() => room?.send("buy_talent_points", { count: 1 })}
        >
          Buy 1 point
        </button>
        <button
          type="button"
          className="bb-btn-ink !px-2 !py-1 text-[10px] disabled:opacity-40"
          disabled={owned >= TALENT_POINT_BUDGET || essence < ESSENCE_PER_TALENT_POINT * 5}
          onClick={() => room?.send("buy_talent_points", { count: 5 })}
        >
          Buy 5
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {TALENT_TREE_IDS.map((id) => {
            const pts = treePointsSpent(build, id);
            const on = tree === id;
            return (
              <button
                key={id}
                type="button"
                className={["bb-talent-tab", on ? "bb-talent-tab--on" : ""].join(" ")}
                style={{ "--bb-talent-accent": TREE_ACCENT[id] } as CSSProperties}
                onClick={() => setTree(id)}
              >
                <span>{id}</span>
                <span className="bb-talent-tab__pts">{pts}</span>
              </button>
            );
          })}
        </div>
        <div className="text-xs font-semibold text-[var(--bb-ink)]">
          Spent{" "}
          <span className="text-[var(--bb-brass-dim)]">
            {spent}/{owned}
          </span>
          <span className="mx-1.5 text-[var(--bb-ink-soft)]">·</span>
          {tree} {treeSpent}/{TALENT_TREE_CAP}
          <span className="mx-1.5 text-[var(--bb-ink-soft)]">·</span>
          {remainingOwned} free
        </div>
      </div>

      <div className="bb-talent-frame">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3
            className="text-sm font-semibold tracking-wide"
            style={{ fontFamily: "var(--bb-font-display)", color: TREE_ACCENT[tree] }}
          >
            {tree}
          </h3>
          <button
            type="button"
            className="bb-btn-ink !px-2 !py-1 text-[10px] disabled:opacity-40"
            disabled={treeSpent <= 0 || essence < ESSENCE_RESET_TREE}
            title={`Costs ${ESSENCE_RESET_TREE} essence`}
            onClick={() => {
              room?.send("reset_talent_tree", { tree });
              setDirty(false);
            }}
          >
            Reset tree ({ESSENCE_RESET_TREE} essence)
          </button>
        </div>
        <div className="bb-talent-scroll">
          <TreeBoard
            tree={tree}
            build={build}
            ownedPoints={owned}
            onChange={updateBuild}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="bb-btn-brass text-xs disabled:opacity-40"
          disabled={!dirty}
          onClick={() => {
            room?.send("set_talent_build", { build });
            setDirty(false);
          }}
        >
          Save build
        </button>
        <button
          type="button"
          className="bb-btn-ink text-xs disabled:opacity-40"
          disabled={spent <= 0 || essence < ESSENCE_RESET_ALL}
          title={`Costs ${ESSENCE_RESET_ALL} essence`}
          onClick={() => {
            room?.send("reset_talent_build");
            setDirty(false);
          }}
        >
          Clear all ({ESSENCE_RESET_ALL} essence)
        </button>
      </div>
    </div>
  );
}
