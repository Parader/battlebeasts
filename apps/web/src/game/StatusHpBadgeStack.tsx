import { type CSSProperties, type RefObject } from "react";
import { Html } from "@react-three/drei";
import { assetUrl } from "./assetUrl";

/** Status ids that show the poison badge above HP bars. */
export const POISON_BADGE_IDS = new Set(["poisoned"]);

/** Status ids that show the burning badge above HP bars. */
export const BURNING_BADGE_IDS = new Set(["burning"]);

/** Status ids that show the bleed badge above HP bars. */
export const BLEEDING_BADGE_IDS = new Set(["bleeding"]);

/** Status ids that show the rejuvenation badge above HP bars. */
export const REJUVENATION_BADGE_IDS = new Set(["rejuvenated"]);

export function readPoisonStacks(
  rows: { statusId?: string; stacks?: number }[],
): number {
  let stacks = 0;
  for (const row of rows) {
    if (row.statusId && POISON_BADGE_IDS.has(row.statusId)) {
      stacks = Math.max(stacks, row.stacks ?? 1);
    }
  }
  return stacks;
}

export function readBurningStacks(
  rows: { statusId?: string; stacks?: number }[],
): number {
  let stacks = 0;
  for (const row of rows) {
    if (row.statusId && BURNING_BADGE_IDS.has(row.statusId)) {
      stacks = Math.max(stacks, row.stacks ?? 1);
    }
  }
  return stacks;
}

export function readBleedingStacks(
  rows: { statusId?: string; stacks?: number }[],
): number {
  let stacks = 0;
  for (const row of rows) {
    if (row.statusId && BLEEDING_BADGE_IDS.has(row.statusId)) {
      stacks = Math.max(stacks, row.stacks ?? 1);
    }
  }
  return stacks;
}

export function readRejuvenationStacks(
  rows: { statusId?: string; stacks?: number }[],
): number {
  let stacks = 0;
  for (const row of rows) {
    if (row.statusId && REJUVENATION_BADGE_IDS.has(row.statusId)) {
      stacks = Math.max(stacks, row.stacks ?? 1);
    }
  }
  return stacks;
}

const BADGE_BOX: CSSProperties = {
  display: "none",
  position: "relative",
  width: 18,
  height: 18,
  borderRadius: 3,
  boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const STACK_PILL: CSSProperties = {
  position: "absolute",
  right: -4,
  top: -5,
  minWidth: 11,
  height: 11,
  padding: "0 2px",
  borderRadius: 2,
  fontSize: 9,
  fontWeight: 700,
  lineHeight: "11px",
  textAlign: "center",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};

type StackProps = {
  poisonBadgeRef: RefObject<HTMLDivElement | null>;
  poisonStacksRef: RefObject<HTMLSpanElement | null>;
  burningBadgeRef: RefObject<HTMLDivElement | null>;
  bleedingBadgeRef: RefObject<HTMLDivElement | null>;
  bleedingStacksRef: RefObject<HTMLSpanElement | null>;
  rejuvenationBadgeRef: RefObject<HTMLDivElement | null>;
  rejuvenationStacksRef: RefObject<HTMLSpanElement | null>;
  /** Anchor for the left edge of the icon row (above HP bar). */
  position?: [number, number, number];
};

/**
 * World HP status icons — pack left-to-right from the bar’s left side.
 * Hidden badges use display:none so active icons stay stacked left.
 */
export function StatusHpBadgeStack({
  poisonBadgeRef,
  poisonStacksRef,
  burningBadgeRef,
  bleedingBadgeRef,
  bleedingStacksRef,
  rejuvenationBadgeRef,
  rejuvenationStacksRef,
  position = [-0.55, 0.22, 0],
}: StackProps) {
  return (
    <Html position={position} center={false} style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          transform: "translate(0, -50%)",
        }}
      >
        <div
          ref={rejuvenationBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(20, 83, 45, 0.92)",
            border: "1px solid #4ade80",
          }}
          title="Rejuvenation"
        >
          {/* heart-plus — clear heal/HoT (distinct from poison droplet). */}
          <img
            src={assetUrl("icons/game/heart-plus.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block" }}
          />
          <span
            ref={rejuvenationStacksRef}
            style={{
              ...STACK_PILL,
              background: "#14532d",
              border: "1px solid #4ade80",
              color: "#dcfce7",
            }}
          >
            1
          </span>
        </div>

        <div
          ref={poisonBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(63, 98, 18, 0.92)",
            border: "1px solid #a3e635",
          }}
          title="Poison"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
            <path
              fill="#bef264"
              d="M8 1c-.4 1.6-2.2 3.2-3.4 5.1C3.4 8 3 9.4 3 10.6 3 13 5.2 15 8 15s5-2 5-4.4c0-1.2-.4-2.6-1.6-4.5C10.2 4.2 8.4 2.6 8 1z"
            />
            <circle cx="6.2" cy="10.2" r="0.9" fill="#365314" />
            <circle cx="9.4" cy="9.4" r="0.7" fill="#365314" />
            <circle cx="7.6" cy="12.2" r="0.65" fill="#365314" />
          </svg>
          <span
            ref={poisonStacksRef}
            style={{
              ...STACK_PILL,
              background: "#14532d",
              border: "1px solid #a3e635",
              color: "#ecfccb",
            }}
          >
            1
          </span>
        </div>

        <div
          ref={burningBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(124, 45, 18, 0.92)",
            border: "1px solid #fb923c",
          }}
          title="Burning"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
            <path
              fill="#fdba74"
              d="M8 1.2c.2 1.8 1.6 2.9 2.4 4.2.9 1.4 1.2 2.6 1.2 3.6 0 2.2-1.8 3.8-3.6 3.8S4.4 11.2 4.4 9c0-1 .3-2.2 1.2-3.6C6.4 4.1 7.8 3 8 1.2z"
            />
            <path
              fill="#ea580c"
              d="M8 5.2c.15 1.1.9 1.7 1.35 2.5.4.7.55 1.3.55 1.8 0 1.15-.9 2-1.9 2s-1.9-.85-1.9-2c0-.5.15-1.1.55-1.8C7.1 6.9 7.85 6.3 8 5.2z"
            />
            <path
              fill="#fff7ed"
              d="M8 8.1c.08.55.4.85.65 1.25.2.35.28.65.28.9 0 .55-.42.95-.93.95s-.93-.4-.93-.95c0-.25.08-.55.28-.9.25-.4.57-.7.65-1.25z"
            />
          </svg>
        </div>

        <div
          ref={bleedingBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(127, 29, 29, 0.92)",
            border: "1px solid #f87171",
          }}
          title="Bleeding"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
            <path
              fill="#fecaca"
              d="M8 1.4c.15 1.5 1.55 2.7 2.35 4 .85 1.35 1.15 2.55 1.15 3.55 0 2.05-1.7 3.55-3.5 3.55S4.5 10.95 4.5 8.95c0-1 .3-2.2 1.15-3.55C6.45 4.1 7.85 2.9 8 1.4z"
            />
            <path
              fill="#ef4444"
              d="M8 4.8c.12.95.75 1.55 1.15 2.25.35.6.5 1.15.5 1.6 0 1-.75 1.75-1.65 1.75S6.35 9.65 6.35 8.65c0-.45.15-1 .5-1.6.4-.7 1.03-1.3 1.15-2.25z"
            />
            <path
              fill="#7f1d1d"
              d="M8 7.6c.06.45.32.7.52 1.05.16.28.23.52.23.72 0 .45-.35.78-.75.78s-.75-.33-.75-.78c0-.2.07-.44.23-.72.2-.35.46-.6.52-1.05z"
            />
          </svg>
          <span
            ref={bleedingStacksRef}
            style={{
              ...STACK_PILL,
              background: "#7f1d1d",
              border: "1px solid #f87171",
              color: "#fee2e2",
            }}
          >
            1
          </span>
        </div>
      </div>
    </Html>
  );
}

export function syncPoisonBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  poisonStacks: number,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (poisonStacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (poisonStacks !== lastStacks.current) {
    lastStacks.current = poisonStacks;
    if (stacksEl) stacksEl.textContent = String(poisonStacks);
  }
}

export function syncBurningBadge(badge: HTMLDivElement | null, burningStacks: number) {
  if (!badge) return;
  badge.style.display = burningStacks > 0 ? "flex" : "none";
}

export function syncBleedingBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  bleedingStacks: number,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (bleedingStacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (bleedingStacks !== lastStacks.current) {
    lastStacks.current = bleedingStacks;
    if (stacksEl) stacksEl.textContent = String(bleedingStacks);
  }
}

export function syncRejuvenationBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  stacks: number,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (stacks !== lastStacks.current) {
    lastStacks.current = stacks;
    if (stacksEl) stacksEl.textContent = String(stacks);
  }
}
