import { RefObject } from "react";
import { Html } from "@react-three/drei";

/** Status ids that show the poison badge above HP bars. */
export const POISON_BADGE_IDS = new Set(["poisonDart", "poisoned", "spikeVenom"]);

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

type Props = {
  badgeRef: RefObject<HTMLDivElement | null>;
  stacksRef: RefObject<HTMLSpanElement | null>;
  /** Local offset above the bar center. */
  position?: [number, number, number];
};

/** Small poison droplet + stack count for world HP bars. */
export function PoisonHpBadge({
  badgeRef,
  stacksRef,
  position = [-0.45, 0.22, 0],
}: Props) {
  return (
    <Html position={position} center style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
      <div
        ref={badgeRef}
        style={{
          visibility: "hidden",
          position: "relative",
          width: 18,
          height: 18,
          borderRadius: 3,
          background: "rgba(63, 98, 18, 0.92)",
          border: "1px solid #a3e635",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
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
          ref={stacksRef}
          style={{
            position: "absolute",
            right: -4,
            top: -5,
            minWidth: 11,
            height: 11,
            padding: "0 2px",
            borderRadius: 2,
            background: "#14532d",
            border: "1px solid #a3e635",
            color: "#ecfccb",
            fontSize: 9,
            fontWeight: 700,
            lineHeight: "11px",
            textAlign: "center",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          }}
        >
          1
        </span>
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
    badge.style.visibility = "hidden";
    lastStacks.current = 0;
    return;
  }
  badge.style.visibility = "visible";
  if (poisonStacks !== lastStacks.current) {
    lastStacks.current = poisonStacks;
    if (stacksEl) stacksEl.textContent = String(poisonStacks);
  }
}
