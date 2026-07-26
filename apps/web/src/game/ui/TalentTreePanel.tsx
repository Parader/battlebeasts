import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
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

/** Natural board size — scaled up to fill the stage, never down below readable. */
const CELL = 64;
const GAP_X = 36;
const GAP_Y = 44;
const PAD = 28;

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
      style={
        {
          "--bb-talent-accent": accent,
          width,
          height,
        } as CSSProperties
      }
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
                <TalentNatureIcon tags={talent.affectedTags} size={28} />
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

function boardMetrics(tree: TalentTreeId) {
  const { rowCount } = layoutTalentTree(tree);
  return {
    width: PAD * 2 + TALENT_TREE_COLUMNS * CELL + (TALENT_TREE_COLUMNS - 1) * GAP_X,
    height: PAD * 2 + Math.max(1, rowCount) * CELL + Math.max(0, rowCount - 1) * GAP_Y,
  };
}

/** Scale board to fill the stage; prefer growing up, never crush below ~85% of natural size when stage is small. */
function useFitScale(
  stageRef: RefObject<HTMLElement | null>,
  boardSize: { width: number; height: number },
) {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      const availW = rect.width - 24;
      const availH = rect.height - 24;
      // Wait until the stage actually has layout height — avoid 0→tiny scale trap.
      if (availW < 80 || availH < 120 || boardSize.width <= 0 || boardSize.height <= 0) {
        return;
      }
      const fit = Math.min(availW / boardSize.width, availH / boardSize.height);
      // Fill the stage (upscale when there is room). Exact fit — never crush via bad measure.
      const next = Math.min(fit, 1.85);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    measure();
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stageRef, boardSize.width, boardSize.height]);

  return scale;
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
  const stageRef = useRef<HTMLDivElement>(null);

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

  const size = useMemo(() => boardMetrics(tree), [tree]);
  const scale = useFitScale(stageRef, size);

  const updateBuild = (next: TalentBuild) => {
    setBuild(next);
    setDirty(true);
  };

  return (
    <div className="bb-talent-panel">
      <aside className="bb-talent-rail">
        <p className="bb-section-label">Trees</p>
        <div className="bb-talent-rail__tabs" role="tablist" aria-label="Talent trees">
          {TALENT_TREE_IDS.map((id) => {
            const pts = treePointsSpent(build, id);
            const on = tree === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                className={["bb-talent-rail__tab", on ? "bb-talent-rail__tab--on" : ""].join(" ")}
                style={{ "--bb-talent-accent": TREE_ACCENT[id] } as CSSProperties}
                onClick={() => setTree(id)}
              >
                <span className="bb-talent-rail__tab-name">{id}</span>
                <span className="bb-talent-rail__tab-pts">
                  {pts}/{TALENT_TREE_CAP}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="bb-talent-main">
        <header className="bb-talent-bar">
          <div className="bb-talent-bar__info">
            <span className="bb-talent-bar__stat">
              <span className="bb-talent-bar__k">Points</span>
              <span className="bb-talent-bar__v">
                {owned}/{TALENT_POINT_BUDGET}
              </span>
              <span className="bb-meta">
                · {remainingOwned} free · {spent} spent
              </span>
            </span>
            <span className="bb-talent-bar__stat">
              <span className="bb-talent-bar__k">Essence</span>
              <span className="bb-talent-bar__v">{essence}</span>
              <span className="bb-meta">· {ESSENCE_PER_TALENT_POINT}/pt</span>
            </span>
          </div>
          <div className="bb-talent-bar__buy">
            <button
              type="button"
              className="bb-btn-brass disabled:opacity-40"
              disabled={!canBuy}
              onClick={() => room?.send("buy_talent_points", { count: 1 })}
            >
              Buy 1
            </button>
            <button
              type="button"
              className="bb-btn-ink disabled:opacity-40"
              disabled={owned >= TALENT_POINT_BUDGET || essence < ESSENCE_PER_TALENT_POINT * 5}
              onClick={() => room?.send("buy_talent_points", { count: 5 })}
            >
              Buy 5
            </button>
          </div>
        </header>

        <section
          className="bb-talent-stage"
          style={{ "--bb-talent-accent": TREE_ACCENT[tree] } as CSSProperties}
          aria-label={`${tree} talent tree`}
        >
          <div className="bb-talent-stage__label">
            <h3 className="bb-talent-stage__title">{tree}</h3>
            <span className="bb-meta">
              {treeSpent}/{TALENT_TREE_CAP} in tree · click invest · right-click refund
              {implementedCount < catalogCount
                ? ` · ${implementedCount}/${catalogCount} live`
                : ""}
            </span>
          </div>

          <div className="bb-talent-stage__fit" ref={stageRef}>
            <div
              className="bb-talent-stage__board"
              style={{
                width: size.width,
                height: size.height,
                transform: `translate(-50%, -50%) scale(${scale})`,
              }}
            >
              <TreeBoard
                tree={tree}
                build={build}
                ownedPoints={owned}
                onChange={updateBuild}
              />
            </div>
          </div>
        </section>

        <footer className="bb-talent-bar bb-talent-bar--foot">
          <button
            type="button"
            className="bb-btn-ink disabled:opacity-40"
            disabled={treeSpent <= 0 || essence < ESSENCE_RESET_TREE}
            title={`Costs ${ESSENCE_RESET_TREE} essence`}
            onClick={() => {
              room?.send("reset_talent_tree", { tree });
              setDirty(false);
            }}
          >
            Reset tree
          </button>
          <button
            type="button"
            className="bb-btn-ink disabled:opacity-40"
            disabled={spent <= 0 || essence < ESSENCE_RESET_ALL}
            title={`Costs ${ESSENCE_RESET_ALL} essence`}
            onClick={() => {
              room?.send("reset_talent_build");
              setDirty(false);
            }}
          >
            Clear all
          </button>
          <button
            type="button"
            className="bb-btn-brass disabled:opacity-40"
            disabled={!dirty}
            onClick={() => {
              room?.send("set_talent_build", { build });
              setDirty(false);
            }}
          >
            Save build
          </button>
        </footer>
      </div>
    </div>
  );
}
