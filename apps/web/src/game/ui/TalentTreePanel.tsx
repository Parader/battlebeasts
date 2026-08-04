import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Room } from "colyseus.js";
import {
  ESSENCE_PER_TALENT_POINT,
  ESSENCE_PER_TALENT_REFUND,
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
  talentPointsRemoved,
  talentRank,
  talentRankCost,
  talentRefundEssenceCost,
  talentTreeLinks,
  totalPointsSpent,
  treePointsSpent,
  type CatalogTalentDef,
  type TalentBuild,
  type TalentTreeId,
} from "@battlebeasts/shared";

import { TalentNatureIcon, primaryTalentNatureTag } from "./TalentNatureIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { GameIcon } from "./GameIcon";
import { TALENT_TREE_ICONS } from "./gameIcons";
import { loadStandMenuMemory, saveStandMenuMemory } from "../standMenuMemory";

const TREE_ACCENT: Record<TalentTreeId, string> = {
  Destruction: "#b45309",
  Guardian: "#57534e",
  Control: "#0e7490",
  Flow: "#4d7c0f",
  Harmony: "#a16207",
};

/** Natural board size — scaled up to fill the stage, never down below readable. */
const CELL = 76;
const GAP_X = 40;
const GAP_Y = 52;
const PAD = 36;

type TipState = {
  talent: CatalogTalentDef;
  rank: number;
  nodeState: "locked" | "available" | "learned";
  anchor: DOMRect;
};

function TalentTooltipBody({
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
    <>
      <div className="bb-talent-tip__head">
        <span className="bb-talent-tip__icon" aria-hidden>
          <TalentNatureIcon tags={talent.affectedTags} size={22} />
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
              <TalentNatureIcon tags={[tag]} size={13} />
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <p className="bb-talent-tip__hint">
        {state === "learned" && rank < maxRank
          ? `Left-click to raise rank · Right-click to refund (${ESSENCE_PER_TALENT_REFUND} essence/pt on save)`
          : state === "learned"
            ? `Right-click to refund (${ESSENCE_PER_TALENT_REFUND} essence/pt on save)`
            : state === "available"
              ? "Left-click to invest"
              : "Locked — spend more points in this tree"}
      </p>
    </>
  );
}

/** Fixed-position tip outside overflow/scaled boards so top-row hovers stay readable. */
function TalentFloatingTip({ tip }: { tip: TipState | null }) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({
    position: "fixed",
    left: -9999,
    top: -9999,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!tip || !tipRef.current) {
      setPos({ position: "fixed", left: -9999, top: -9999, visibility: "hidden" });
      return;
    }
    const el = tipRef.current;
    const place = () => {
      const tipRect = el.getBoundingClientRect();
      const gap = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = tip.anchor.left + tip.anchor.width / 2 - tipRect.width / 2;
      left = Math.max(10, Math.min(left, vw - tipRect.width - 10));

      const above = tip.anchor.top - tipRect.height - gap;
      const below = tip.anchor.bottom + gap;
      let top = above >= 10 ? above : below;
      if (top + tipRect.height > vh - 10) {
        top = Math.max(10, vh - tipRect.height - 10);
      }

      setPos({
        position: "fixed",
        left,
        top,
        visibility: "visible",
        zIndex: 80,
      });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [tip]);

  if (!tip || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={tipRef}
      className="bb-talent-tip bb-talent-tip--float"
      role="tooltip"
      style={pos}
    >
      <TalentTooltipBody talent={tip.talent} rank={tip.rank} state={tip.nodeState} />
    </div>,
    document.body,
  );
}

function TreeBoard({
  tree,
  build,
  ownedPoints,
  onChange,
  onHoverTip,
}: {
  tree: TalentTreeId;
  build: TalentBuild;
  ownedPoints: number;
  onChange: (next: TalentBuild) => void;
  onHoverTip: (tip: TipState | null) => void;
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

  const showTip = (
    talent: CatalogTalentDef,
    rank: number,
    nodeState: TipState["nodeState"],
    el: HTMLElement,
  ) => {
    onHoverTip({
      talent,
      rank,
      nodeState,
      anchor: el.getBoundingClientRect(),
    });
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
          // Lit when the previous node has a point (path unlocked), brighter when both taken.
          const fromOn = isTalentTaken(build, link.fromId);
          const toOn = isTalentTaken(build, link.toId);
          const active = fromOn && toOn;
          const unlocked = fromOn && !toOn;
          const midY = (a.y + b.y) / 2;
          return (
            <path
              key={`${link.fromId}-${link.toId}`}
              d={`M ${a.x} ${a.y + CELL / 2 - 2} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y - CELL / 2 + 2}`}
              className={
                active
                  ? "bb-talent-link bb-talent-link--on"
                  : unlocked
                    ? "bb-talent-link bb-talent-link--open"
                    : "bb-talent-link"
              }
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
              aria-label={talent.name}
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
              onMouseEnter={(e) => showTip(talent, rank, state, e.currentTarget)}
              onMouseLeave={() => onHoverTip(null)}
              onFocus={(e) => showTip(talent, rank, state, e.currentTarget)}
              onBlur={() => onHoverTip(null)}
              onClick={() => {
                if (canUp) onChange(investTalent(build, talent.id, ownedPoints));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (canDown) onChange(refundTalent(build, talent.id));
              }}
            >
              <span className="bb-talent-node__glyph" aria-hidden>
                <TalentNatureIcon tags={talent.affectedTags} size={34} />
              </span>
              {!implemented ? <span className="bb-talent-node__wip">WIP</span> : null}
              {maxRank > 1 ? (
                <span className="bb-talent-node__rank">
                  {rank}/{maxRank}
                </span>
              ) : (
                <span className="bb-talent-node__cost">{talentRankCost(talent)}</span>
              )}
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
  loadoutPresets: Array<{ slotIndex: number; name: string; abilityIds: string[] }>;
  activeLoadoutSlot: number;
  loadoutSlotCount: number;
  onSelectPreset: (slotIndex: number) => void;
  /** Points + Buy controls for the stand panel header. */
  onHeaderActions?: (node: ReactNode | null) => void;
};

export function TalentTreePanel({
  room,
  essence,
  talentPoints,
  talentBuild,
  loadoutPresets,
  activeLoadoutSlot,
  loadoutSlotCount,
  onSelectPreset,
  onHeaderActions,
}: Props) {
  const [tree, setTree] = useState<TalentTreeId>(() => loadStandMenuMemory().talentTree);
  const [build, setBuild] = useState<TalentBuild>(() => normalizeTalentBuild(talentBuild));
  const [dirty, setDirty] = useState(false);
  const [hoverTip, setHoverTip] = useState<TipState | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSaveRespec, setConfirmSaveRespec] = useState(false);
  const [confirmBuyPoints, setConfirmBuyPoints] = useState(false);
  const [buyPointQty, setBuyPointQty] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dirty) setBuild(normalizeTalentBuild(talentBuild));
  }, [talentBuild, dirty]);

  useEffect(() => {
    setHoverTip(null);
  }, [tree]);

  useEffect(() => {
    // Switching loadout pulls a different talent build from the server.
    setDirty(false);
    setBuild(normalizeTalentBuild(talentBuild));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slot change is the intentional trigger
  }, [activeLoadoutSlot]);

  const spent = totalPointsSpent(build);
  const treeSpent = treePointsSpent(build, tree);
  const savedBuild = normalizeTalentBuild(talentBuild);
  const savedTreeSpent = treePointsSpent(savedBuild, tree);
  const respecPoints = talentPointsRemoved(savedBuild, build);
  const respecCost = talentRefundEssenceCost(respecPoints);
  const resetTreeCost = talentRefundEssenceCost(savedTreeSpent);
  const owned = talentPoints;
  const spendable = Math.max(0, owned - spent);
  const atPointCap = owned >= TALENT_POINT_BUDGET;
  const roomForPoints = Math.max(0, TALENT_POINT_BUDGET - owned);
  const maxBuyByEssence = Math.floor(essence / ESSENCE_PER_TALENT_POINT);
  /** Server also caps a single purchase at 20. */
  const maxBuyPoints = Math.max(0, Math.min(20, roomForPoints, maxBuyByEssence));
  const canBuy = !atPointCap && maxBuyPoints >= 1;
  const buyCost = buyPointQty * ESSENCE_PER_TALENT_POINT;
  const canSave = dirty && (respecCost <= 0 || essence >= respecCost);
  const canResetTree = savedTreeSpent > 0 && essence >= resetTreeCost;

  useEffect(() => {
    if (!confirmBuyPoints) return;
    setBuyPointQty((q) => Math.min(Math.max(1, q), Math.max(1, maxBuyPoints)));
  }, [confirmBuyPoints, maxBuyPoints]);

  const openBuyPoints = () => {
    setBuyPointQty(1);
    setConfirmBuyPoints(true);
  };

  const roomRef = useRef(room);
  roomRef.current = room;

  useLayoutEffect(() => {
    if (!onHeaderActions) return;
    onHeaderActions(
      <div className="bb-talent-header-pts">
        <span className="bb-talent-header-pts__label">Points</span>
        <span className="bb-talent-header-pts__value">{spendable}</span>
        {!atPointCap ? (
          <button
            type="button"
            className="bb-btn-brass bb-talent-header-pts__buy disabled:opacity-40"
            disabled={!canBuy}
            title={
              essence < ESSENCE_PER_TALENT_POINT
                ? `Need ${ESSENCE_PER_TALENT_POINT} essence`
                : `Buy talent points (−${ESSENCE_PER_TALENT_POINT} essence each, up to ${maxBuyPoints})`
            }
            onClick={openBuyPoints}
          >
            Buy
          </button>
        ) : null}
      </div>,
    );
  }, [onHeaderActions, spendable, atPointCap, canBuy, essence, maxBuyPoints]);

  useEffect(() => {
    return () => onHeaderActions?.(null);
  }, [onHeaderActions]);

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

  const commitSave = () => {
    room?.send("set_talent_build", { build });
    setDirty(false);
    setConfirmSaveRespec(false);
  };

  const commitResetTree = () => {
    room?.send("reset_talent_tree", { tree });
    setDirty(false);
    setConfirmReset(false);
  };

  return (
    <div className="bb-talent-panel">
      <ConfirmDialog
        open={confirmBuyPoints}
        title="Buy talent points?"
        message={
          <span className="bb-talent-buy-confirm">
            <span>
              Each point costs <strong>{ESSENCE_PER_TALENT_POINT} essence</strong>.
              You can buy up to <strong>{maxBuyPoints}</strong> right now.
            </span>
            <span className="bb-talent-buy-qty" role="group" aria-label="Quantity">
              <button
                type="button"
                className="bb-talent-buy-qty__btn"
                disabled={buyPointQty <= 1}
                aria-label="Fewer points"
                onClick={() => setBuyPointQty((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="bb-talent-buy-qty__value">{buyPointQty}</span>
              <button
                type="button"
                className="bb-talent-buy-qty__btn"
                disabled={buyPointQty >= maxBuyPoints}
                aria-label="More points"
                onClick={() => setBuyPointQty((q) => Math.min(maxBuyPoints, q + 1))}
              >
                +
              </button>
            </span>
            <span>
              Total: <strong>{buyCost} essence</strong>
              {buyPointQty > 1 ? ` for ${buyPointQty} points` : " for 1 point"}
            </span>
          </span>
        }
        confirmLabel={`Buy ${buyPointQty} (−${buyCost})`}
        onConfirm={() => {
          const count = Math.min(Math.max(1, buyPointQty), maxBuyPoints);
          if (count >= 1) roomRef.current?.send("buy_talent_points", { count });
          setConfirmBuyPoints(false);
        }}
        onCancel={() => setConfirmBuyPoints(false)}
      />
      <ConfirmDialog
        open={confirmReset}
        title={`Reset ${tree}?`}
        message={
          <>
            Respeccing this tree removes <strong>{savedTreeSpent}</strong> talent point
            {savedTreeSpent === 1 ? "" : "s"} and costs{" "}
            <strong>{resetTreeCost} essence</strong> ({ESSENCE_PER_TALENT_REFUND} per point).
            Owned points are kept; you can reinvest after.
          </>
        }
        confirmLabel={`Reset (−${resetTreeCost})`}
        onConfirm={commitResetTree}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmSaveRespec}
        title="Confirm respec?"
        message={
          <>
            Saving removes or moves <strong>{respecPoints}</strong> talent point
            {respecPoints === 1 ? "" : "s"} and costs{" "}
            <strong>{respecCost} essence</strong> ({ESSENCE_PER_TALENT_REFUND} per point).
          </>
        }
        confirmLabel={`Save (−${respecCost})`}
        onConfirm={commitSave}
        onCancel={() => setConfirmSaveRespec(false)}
      />
      <TalentFloatingTip tip={hoverTip} />
      <aside className="bb-talent-rail">
        <p className="bb-section-label bb-talent-rail__trees-label">
          <span>Trees</span>
          <span className="bb-talent-rail__budget tabular-nums">
            {spent}/{TALENT_POINT_BUDGET}
          </span>
        </p>
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
                onClick={() => {
                  setTree(id);
                  saveStandMenuMemory({ talentTree: id });
                }}
              >
                <span className="bb-talent-rail__tab-main">
                  <GameIcon
                    id={TALENT_TREE_ICONS[id]}
                    size={22}
                    gray={on ? 0.95 : 0.72}
                    className="bb-talent-rail__tab-icon"
                  />
                  <span className="bb-talent-rail__tab-name">{id}</span>
                </span>
                <span className="bb-talent-rail__tab-pts">
                  {pts}/{TALENT_TREE_CAP}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="bb-talent-main">
        <div className="bb-loadout-presets" role="tablist" aria-label="Loadout presets">
          {Array.from({ length: loadoutSlotCount }, (_, i) => i).map((i) => {
            const preset = loadoutPresets.find((p) => p.slotIndex === i);
            const active = activeLoadoutSlot === i;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active}
                className={["bb-slot-chip", active ? "bb-slot-chip--on" : ""].join(" ")}
                onClick={() => onSelectPreset(i)}
              >
                {preset?.name ?? `Loadout ${i + 1}`}
              </button>
            );
          })}
        </div>

        <section
          className="bb-talent-stage"
          style={{ "--bb-talent-accent": TREE_ACCENT[tree] } as CSSProperties}
          aria-label={`${tree} talent tree`}
        >
          <div className="bb-talent-stage__label">
            <h3 className="bb-talent-stage__title">{tree}</h3>
            <span className="bb-meta">
              {treeSpent}/{TALENT_TREE_CAP} in tree · click invest · right-click refund (
              {ESSENCE_PER_TALENT_REFUND} essence/pt on save)
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
                onHoverTip={setHoverTip}
              />
            </div>
          </div>
        </section>

        <footer className="bb-talent-bar bb-talent-bar--foot">
          <button
            type="button"
            className="bb-btn-ink disabled:opacity-40"
            disabled={!canResetTree}
            title={
              savedTreeSpent <= 0
                ? "Nothing invested in this tree"
                : `Costs ${resetTreeCost} essence (${savedTreeSpent} pt × ${ESSENCE_PER_TALENT_REFUND})`
            }
            onClick={() => setConfirmReset(true)}
          >
            Reset tree{savedTreeSpent > 0 ? ` (−${resetTreeCost})` : ""}
          </button>
          <button
            type="button"
            className="bb-btn-brass disabled:opacity-40"
            disabled={!canSave}
            title={
              !dirty
                ? "No changes"
                : respecCost > 0
                  ? essence < respecCost
                    ? `Need ${respecCost} essence to respec (${respecPoints} pt)`
                    : `Costs ${respecCost} essence (${respecPoints} pt removed/changed)`
                  : "Save talent build"
            }
            onClick={() => {
              if (respecCost > 0) setConfirmSaveRespec(true);
              else commitSave();
            }}
          >
            Save build{respecCost > 0 ? ` (−${respecCost})` : ""}
          </button>
        </footer>
      </div>
    </div>
  );
}
