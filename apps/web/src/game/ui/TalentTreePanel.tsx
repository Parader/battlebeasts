import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Room } from "colyseus.js";
import {
  ESSENCE_PER_TALENT_POINT,
  ESSENCE_PER_TALENT_REFUND,
  TALENT_CATALOG,
  TALENT_POINT_BUDGET,
  TALENT_TREE_ACCENT,
  TALENT_TREE_CAP,
  TALENT_TREE_IDS,
  canInvestTalent,
  canRefundTalent,
  formatTalentEffectRanks,
  investTalent,
  isCatalogTalentImplemented,
  isTalentTaken,
  layoutTalentConstellation,
  normalizeTalentBuild,
  refundTalent,
  talentMaxRank,
  talentPointsRemoved,
  talentRank,
  talentRankCost,
  talentRefundEssenceCost,
  totalPointsSpent,
  treePointsSpent,
  type CatalogTalentDef,
  type ConstellationNode,
  type SpellUnlockPlaceholder,
  type TalentBuild,
  type TalentTreeId,
} from "@battlebeasts/shared";

import { TalentNatureIcon, primaryTalentNatureTag } from "./TalentNatureIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { GameIcon } from "./GameIcon";
import { TALENT_TREE_ICONS } from "./gameIcons";
import { loadStandMenuMemory, saveStandMenuMemory } from "../standMenuMemory";

const NODE_SIZE = 56;
const HUB_SIZE = 88;
const CORE_SIZE = 96;
const SPELL_SIZE = 48;
const ZOOM_MIN = 0.22;
const ZOOM_MAX = 1.65;

type TipState =
  | {
      kind: "talent";
      talent: CatalogTalentDef;
      rank: number;
      nodeState: "locked" | "available" | "learned";
      anchor: DOMRect;
    }
  | {
      kind: "spell";
      spell: SpellUnlockPlaceholder;
      anchor: DOMRect;
    }
  | {
      kind: "hub";
      tree: TalentTreeId;
      pts: number;
      anchor: DOMRect;
    }
  | {
      kind: "core";
      spent: number;
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
      {tip.kind === "talent" ? (
        <TalentTooltipBody talent={tip.talent} rank={tip.rank} state={tip.nodeState} />
      ) : tip.kind === "spell" ? (
        <>
          <div className="bb-talent-tip__name">{tip.spell.label}</div>
          <div className="bb-talent-tip__meta">{tip.spell.tree} · spell path</div>
          <p className="bb-talent-tip__body">{tip.spell.lockedNote}</p>
          <p className="bb-talent-tip__hint">Placeholder — unlock wiring comes later</p>
        </>
      ) : tip.kind === "hub" ? (
        <>
          <div className="bb-talent-tip__name">{tip.tree}</div>
          <div className="bb-talent-tip__meta">
            {tip.pts}/{TALENT_TREE_CAP} points in tree
          </div>
          <p className="bb-talent-tip__hint">Click to center this branch</p>
        </>
      ) : (
        <>
          <div className="bb-talent-tip__name">Hunter</div>
          <div className="bb-talent-tip__meta">
            {tip.spent}/{TALENT_POINT_BUDGET} points invested
          </div>
          <p className="bb-talent-tip__hint">Drag to pan · scroll to zoom</p>
        </>
      )}
    </div>,
    document.body,
  );
}

function useConstellationCamera(
  viewportRef: React.RefObject<HTMLElement | null>,
  world: { width: number; height: number; centerX: number; centerY: number },
) {
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 0.42 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;

  const fitOverview = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const pad = 48;
    const zx = (rect.width - pad * 2) / world.width;
    const zy = (rect.height - pad * 2) / world.height;
    const zoom = Math.min(Math.max(Math.min(zx, zy), ZOOM_MIN), 0.55);
    setCam({
      x: rect.width / 2 - world.centerX * zoom,
      y: rect.height / 2 - world.centerY * zoom,
      zoom,
    });
  }, [viewportRef, world.width, world.height, world.centerX, world.centerY]);

  useLayoutEffect(() => {
    fitOverview();
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fitOverview());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitOverview, viewportRef]);

  // Non-passive so we can preventDefault and keep page scroll locked while zooming.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { x, y, zoom } = camRef.current;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldX = (mx - x) / zoom;
      const worldY = (my - y) / zoom;
      const factor = e.deltaY > 0 ? 0.9 : 1.11;
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
      setCam({
        zoom: nextZoom,
        x: mx - worldX * nextZoom,
        y: my - worldY * nextZoom,
      });
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [viewportRef]);

  const centerOn = useCallback(
    (wx: number, wy: number, zoom = camRef.current.zoom) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
      setCam({
        x: rect.width / 2 - wx * z,
        y: rect.height / 2 - wy * z,
        zoom: z,
      });
    },
    [viewportRef],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "button.bb-constel-node, button.bb-constel-hub, button.bb-constel-core, button.bb-constel-spell",
      )
    ) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: camRef.current.x,
      originY: camRef.current.y,
    };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setCam((c) => ({ ...c, x: d.originX + dx, y: d.originY + dy }));
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    cam,
    fitOverview,
    centerOn,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
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
  const [focusTree, setFocusTree] = useState<TalentTreeId>(
    () => loadStandMenuMemory().talentTree,
  );
  const [build, setBuild] = useState<TalentBuild>(() => normalizeTalentBuild(talentBuild));
  const [dirty, setDirty] = useState(false);
  const [hoverTip, setHoverTip] = useState<TipState | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSaveRespec, setConfirmSaveRespec] = useState(false);
  const [confirmBuyPoints, setConfirmBuyPoints] = useState(false);
  const [buyPointQty, setBuyPointQty] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutTalentConstellation(), []);
  const camera = useConstellationCamera(viewportRef, layout);

  useEffect(() => {
    if (!dirty) setBuild(normalizeTalentBuild(talentBuild));
  }, [talentBuild, dirty]);

  useEffect(() => {
    setDirty(false);
    setBuild(normalizeTalentBuild(talentBuild));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slot change is the intentional trigger
  }, [activeLoadoutSlot]);

  const spent = totalPointsSpent(build);
  const savedBuild = normalizeTalentBuild(talentBuild);
  const savedTreeSpent = treePointsSpent(savedBuild, focusTree);
  const respecPoints = talentPointsRemoved(savedBuild, build);
  const respecCost = talentRefundEssenceCost(respecPoints);
  const resetTreeCost = talentRefundEssenceCost(savedTreeSpent);
  const owned = talentPoints;
  const spendable = Math.max(0, owned - spent);
  const atPointCap = owned >= TALENT_POINT_BUDGET;
  const roomForPoints = Math.max(0, TALENT_POINT_BUDGET - owned);
  const maxBuyByEssence = Math.floor(essence / ESSENCE_PER_TALENT_POINT);
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
        <span className="bb-talent-header-pts__budget tabular-nums">
          {spent}/{TALENT_POINT_BUDGET}
        </span>
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
  }, [onHeaderActions, spendable, spent, atPointCap, canBuy, essence, maxBuyPoints]);

  useEffect(() => {
    return () => onHeaderActions?.(null);
  }, [onHeaderActions]);

  const implementedCount = useMemo(
    () => Object.values(TALENT_CATALOG).filter((t) => isCatalogTalentImplemented(t)).length,
    [],
  );
  const catalogCount = Object.keys(TALENT_CATALOG).length;

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
    room?.send("reset_talent_tree", { tree: focusTree });
    setDirty(false);
    setConfirmReset(false);
  };

  const selectTree = (tree: TalentTreeId, center = true) => {
    setFocusTree(tree);
    saveStandMenuMemory({ talentTree: tree });
    if (center) {
      const hub = layout.nodes.find((n) => n.kind === "treeHub" && n.tree === tree);
      if (hub) camera.centerOn(hub.x, hub.y, Math.max(camera.cam.zoom, 0.7));
    }
  };

  const posById = useMemo(() => {
    const m = new Map<string, ConstellationNode>();
    for (const n of layout.nodes) m.set(n.id, n);
    return m;
  }, [layout.nodes]);

  return (
    <div className="bb-talent-panel bb-talent-panel--constel">
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
        title={`Reset ${focusTree}?`}
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

      <div className="bb-constel-chrome">
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

        <div className="bb-constel-legend" role="tablist" aria-label="Talent trees">
          {TALENT_TREE_IDS.map((id) => {
            const pts = treePointsSpent(build, id);
            const on = focusTree === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                className={["bb-constel-legend__chip", on ? "bb-constel-legend__chip--on" : ""].join(
                  " ",
                )}
                style={{ "--bb-talent-accent": TALENT_TREE_ACCENT[id] } as CSSProperties}
                onClick={() => selectTree(id, true)}
              >
                <GameIcon
                  id={TALENT_TREE_ICONS[id]}
                  size={18}
                  gray={on ? 0.95 : 0.7}
                  className="bb-constel-legend__icon"
                />
                <span className="bb-constel-legend__name">{id}</span>
                <span className="bb-constel-legend__pts">
                  {pts}/{TALENT_TREE_CAP}
                </span>
              </button>
            );
          })}
        </div>

        <div className="bb-constel-chrome__actions">
          <button
            type="button"
            className="bb-btn-ink"
            title="Fit all trees in view"
            onClick={() => camera.fitOverview()}
          >
            Overview
          </button>
          <button
            type="button"
            className="bb-btn-ink disabled:opacity-40"
            disabled={!canResetTree}
            title={
              savedTreeSpent <= 0
                ? `Nothing invested in ${focusTree}`
                : `Costs ${resetTreeCost} essence (${savedTreeSpent} pt × ${ESSENCE_PER_TALENT_REFUND})`
            }
            onClick={() => setConfirmReset(true)}
          >
            Reset {focusTree}
            {savedTreeSpent > 0 ? ` (−${resetTreeCost})` : ""}
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
        </div>
      </div>

      <div
        ref={viewportRef}
        className="bb-constel-viewport"
        aria-label="Talent constellation"
        onPointerDown={camera.onPointerDown}
        onPointerMove={camera.onPointerMove}
        onPointerUp={camera.onPointerUp}
        onPointerCancel={camera.onPointerUp}
      >
        <div
          className="bb-constel-world"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${camera.cam.x}px, ${camera.cam.y}px) scale(${camera.cam.zoom})`,
          }}
        >
          <div className="bb-constel-field" aria-hidden />

          <svg
            className="bb-constel-links"
            width={layout.width}
            height={layout.height}
            aria-hidden
          >
            {layout.links.map((link) => {
              const a = posById.get(link.fromId);
              const b = posById.get(link.toId);
              if (!a || !b) return null;
              const fromOn =
                link.fromId === "CORE" ||
                link.fromId.startsWith("HUB_") ||
                isTalentTaken(build, link.fromId);
              const toOn =
                link.toId.startsWith("HUB_") ||
                link.toId.startsWith("SPELL_") ||
                isTalentTaken(build, link.toId);
              const accent = TALENT_TREE_ACCENT[link.tree];
              const active = fromOn && toOn;
              const unlocked = fromOn && !toOn;
              return (
                <line
                  key={`${link.fromId}-${link.toId}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={
                    active
                      ? "bb-constel-link bb-constel-link--on"
                      : unlocked
                        ? "bb-constel-link bb-constel-link--open"
                        : "bb-constel-link"
                  }
                  style={{ "--bb-talent-accent": accent } as CSSProperties}
                />
              );
            })}
          </svg>

          {layout.nodes.map((node) => {
            if (node.kind === "core") {
              return (
                <button
                  key={node.id}
                  type="button"
                  className="bb-constel-core"
                  style={{
                    left: node.x - CORE_SIZE / 2,
                    top: node.y - CORE_SIZE / 2,
                    width: CORE_SIZE,
                    height: CORE_SIZE,
                  }}
                  aria-label="Hunter core"
                  onMouseEnter={(e) =>
                    setHoverTip({
                      kind: "core",
                      spent,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onMouseLeave={() => setHoverTip(null)}
                  onClick={() => camera.centerOn(node.x, node.y, 0.55)}
                >
                  <span className="bb-constel-core__label">Hunter</span>
                  <span className="bb-constel-core__pts">
                    {spent}/{TALENT_POINT_BUDGET}
                  </span>
                </button>
              );
            }

            if (node.kind === "treeHub" && node.tree) {
              const tree = node.tree;
              const pts = treePointsSpent(build, tree);
              const on = focusTree === tree;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={["bb-constel-hub", on ? "bb-constel-hub--on" : ""].join(" ")}
                  style={
                    {
                      left: node.x - HUB_SIZE / 2,
                      top: node.y - HUB_SIZE / 2,
                      width: HUB_SIZE,
                      height: HUB_SIZE,
                      "--bb-talent-accent": TALENT_TREE_ACCENT[tree],
                    } as CSSProperties
                  }
                  aria-label={`${tree} tree`}
                  onMouseEnter={(e) =>
                    setHoverTip({
                      kind: "hub",
                      tree,
                      pts,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onMouseLeave={() => setHoverTip(null)}
                  onClick={() => selectTree(tree, true)}
                >
                  <GameIcon id={TALENT_TREE_ICONS[tree]} size={36} gray={0.95} />
                  <span className="bb-constel-hub__name">{tree}</span>
                  <span className="bb-constel-hub__pts">
                    {pts}/{TALENT_TREE_CAP}
                  </span>
                </button>
              );
            }

            if (node.kind === "spellUnlock" && node.spell) {
              const spell = node.spell;
              const accent = node.tree ? TALENT_TREE_ACCENT[node.tree] : undefined;
              return (
                <button
                  key={node.id}
                  type="button"
                  className="bb-constel-spell"
                  style={
                    {
                      left: node.x - SPELL_SIZE / 2,
                      top: node.y - SPELL_SIZE / 2,
                      width: SPELL_SIZE,
                      height: SPELL_SIZE,
                      "--bb-talent-accent": accent,
                    } as CSSProperties
                  }
                  aria-label={spell.label}
                  onMouseEnter={(e) =>
                    setHoverTip({
                      kind: "spell",
                      spell,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onMouseLeave={() => setHoverTip(null)}
                >
                  <span className="bb-constel-spell__glyph" aria-hidden>
                    ✦
                  </span>
                  <span className="bb-constel-spell__lock">?</span>
                </button>
              );
            }

            if (node.kind === "talent" && node.talent) {
              const talent = node.talent;
              const rank = talentRank(build, talent.id);
              const maxRank = talentMaxRank(talent);
              const canUp = canInvestTalent(build, talent.id, owned);
              const canDown = canRefundTalent(build, talent.id);
              const implemented = isCatalogTalentImplemented(talent);
              const state: "locked" | "available" | "learned" =
                rank > 0 ? "learned" : canUp ? "available" : "locked";
              const accent = TALENT_TREE_ACCENT[talent.tree];

              return (
                <button
                  key={node.id}
                  type="button"
                  aria-label={talent.name}
                  className={[
                    "bb-constel-node",
                    state === "learned" ? "bb-constel-node--learned" : "",
                    state === "available" ? "bb-constel-node--available" : "",
                    state === "locked" ? "bb-constel-node--locked" : "",
                    !implemented ? "bb-constel-node--wip" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    {
                      left: node.x - NODE_SIZE / 2,
                      top: node.y - NODE_SIZE / 2,
                      width: NODE_SIZE,
                      height: NODE_SIZE,
                      "--bb-talent-accent": accent,
                    } as CSSProperties
                  }
                  onMouseEnter={(e) =>
                    setHoverTip({
                      kind: "talent",
                      talent,
                      rank,
                      nodeState: state,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onMouseLeave={() => setHoverTip(null)}
                  onFocus={(e) =>
                    setHoverTip({
                      kind: "talent",
                      talent,
                      rank,
                      nodeState: state,
                      anchor: e.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onBlur={() => setHoverTip(null)}
                  onClick={() => {
                    if (canUp) updateBuild(investTalent(build, talent.id, owned));
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (canDown) updateBuild(refundTalent(build, talent.id));
                  }}
                >
                  <span className="bb-constel-node__glyph" aria-hidden>
                    <TalentNatureIcon tags={talent.affectedTags} size={28} />
                  </span>
                  {!implemented ? <span className="bb-constel-node__wip">WIP</span> : null}
                  {maxRank > 1 ? (
                    <span className="bb-constel-node__rank">
                      {rank}/{maxRank}
                    </span>
                  ) : (
                    <span className="bb-constel-node__cost">{talentRankCost(talent)}</span>
                  )}
                </button>
              );
            }

            return null;
          })}
        </div>
      </div>

      <p className="bb-constel-hint bb-meta">
        Drag to pan · scroll to zoom · left-click invest · right-click refund
        {implementedCount < catalogCount
          ? ` · ${implementedCount}/${catalogCount} live`
          : ""}
      </p>
    </div>
  );
}
