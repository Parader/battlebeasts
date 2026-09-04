import { type CSSProperties, type RefObject } from "react";
import { Html } from "@react-three/drei";
import { STATUSES } from "@battlebeasts/shared";
import { assetUrl } from "./assetUrl";

/** Status ids that show the poison badge above HP bars. */
export const POISON_BADGE_IDS = new Set(["poisoned"]);

/** Status ids that show the burning badge above HP bars. */
export const BURNING_BADGE_IDS = new Set(["burning"]);

/** Status ids that show the bleed badge above HP bars. */
export const BLEEDING_BADGE_IDS = new Set(["bleeding"]);

/** Status ids that show the rejuvenation badge above HP bars. */
export const REJUVENATION_BADGE_IDS = new Set(["rejuvenated"]);

/** Status ids that show the silence badge above HP bars. */
export const SILENCE_BADGE_IDS = new Set(["silenced"]);

/** Status ids that show the holy blessing badge above HP bars. */
export const HOLY_BADGE_IDS = new Set(["holyBlessed"]);

/** Status ids that show the Soul Mark badge above HP bars. */
export const SOUL_MARK_BADGE_IDS = new Set(["soulMarked"]);

/** Status ids that show the Soul Sever badge above HP bars. */
export const SOUL_SEVER_BADGE_IDS = new Set(["soulSevered"]);

/** Status ids that show the Chilled badge above HP bars (Frost Mist / Runic Shard). */
export const CHILL_BADGE_IDS = new Set(["frostChill"]);

/** Status ids that show the Slowed badge above HP bars (Underground Pulse, etc.). */
export const SLOW_BADGE_IDS = new Set(["slowed"]);

/** Status ids that show the Slipstream Haste badge above HP bars. */
export const HASTE_BADGE_IDS = new Set(["slipstreamHaste"]);

/** Status ids that show the Soul Relay badge above HP bars. */
export const RELAY_BADGE_IDS = new Set(["soulRelayLinked"]);

export type StatusRowLite = {
  statusId?: string;
  stacks?: number;
  expiresAt?: number;
};

export type BadgeRead = {
  stacks: number;
  expiresAt: number;
};

function readBadge(rows: StatusRowLite[], ids: Set<string>): BadgeRead {
  let stacks = 0;
  let expiresAt = 0;
  for (const row of rows) {
    if (!row.statusId || !ids.has(row.statusId)) continue;
    stacks = Math.max(stacks, row.stacks ?? 1);
    expiresAt = Math.max(expiresAt, row.expiresAt ?? 0);
  }
  return { stacks, expiresAt };
}

export function readPoisonStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, POISON_BADGE_IDS).stacks;
}

export function readBurningStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, BURNING_BADGE_IDS).stacks;
}

export function readBleedingStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, BLEEDING_BADGE_IDS).stacks;
}

export function readRejuvenationStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, REJUVENATION_BADGE_IDS).stacks;
}

export function readPoisonBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, POISON_BADGE_IDS);
}

export function readBurningBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, BURNING_BADGE_IDS);
}

export function readBleedingBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, BLEEDING_BADGE_IDS);
}

export function readRejuvenationBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, REJUVENATION_BADGE_IDS);
}

export function readSilenceBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SILENCE_BADGE_IDS);
}

export function readHolyBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, HOLY_BADGE_IDS);
}

export function readSoulMarkBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SOUL_MARK_BADGE_IDS);
}

export function readSoulMarkStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, SOUL_MARK_BADGE_IDS).stacks;
}

export function readSoulSeverBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SOUL_SEVER_BADGE_IDS);
}

export function readChillBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, CHILL_BADGE_IDS);
}

export function readChillStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, CHILL_BADGE_IDS).stacks;
}

export function readSlowBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SLOW_BADGE_IDS);
}

export function readHasteBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, HASTE_BADGE_IDS);
}

export function readRelayBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, RELAY_BADGE_IDS);
}

const BADGE_SIZE = 20;
const RING_R = 8.25;
const RING_C = 2 * Math.PI * RING_R;

const BADGE_BOX: CSSProperties = {
  display: "none",
  position: "relative",
  width: BADGE_SIZE,
  height: BADGE_SIZE,
  borderRadius: 4,
  boxShadow: "0 1px 2px rgba(0,0,0,0.55)",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  overflow: "visible",
};

const STACK_PILL: CSSProperties = {
  position: "absolute",
  right: -5,
  top: -5,
  zIndex: 2,
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

const RING_STYLE: CSSProperties = {
  position: "absolute",
  inset: -3,
  width: BADGE_SIZE + 6,
  height: BADGE_SIZE + 6,
  pointerEvents: "none",
  overflow: "visible",
};

type StackProps = {
  poisonBadgeRef: RefObject<HTMLDivElement | null>;
  poisonStacksRef: RefObject<HTMLSpanElement | null>;
  poisonRingRef: RefObject<SVGCircleElement | null>;
  burningBadgeRef: RefObject<HTMLDivElement | null>;
  burningRingRef: RefObject<SVGCircleElement | null>;
  bleedingBadgeRef: RefObject<HTMLDivElement | null>;
  bleedingStacksRef: RefObject<HTMLSpanElement | null>;
  bleedingRingRef: RefObject<SVGCircleElement | null>;
  rejuvenationBadgeRef: RefObject<HTMLDivElement | null>;
  rejuvenationStacksRef: RefObject<HTMLSpanElement | null>;
  rejuvenationRingRef: RefObject<SVGCircleElement | null>;
  silenceBadgeRef: RefObject<HTMLDivElement | null>;
  silenceRingRef: RefObject<SVGCircleElement | null>;
  holyBadgeRef: RefObject<HTMLDivElement | null>;
  holyRingRef: RefObject<SVGCircleElement | null>;
  soulMarkBadgeRef: RefObject<HTMLDivElement | null>;
  soulMarkStacksRef: RefObject<HTMLSpanElement | null>;
  soulMarkRingRef: RefObject<SVGCircleElement | null>;
  soulSeverBadgeRef: RefObject<HTMLDivElement | null>;
  soulSeverRingRef: RefObject<SVGCircleElement | null>;
  chillBadgeRef: RefObject<HTMLDivElement | null>;
  chillStacksRef: RefObject<HTMLSpanElement | null>;
  chillRingRef: RefObject<SVGCircleElement | null>;
  slowBadgeRef: RefObject<HTMLDivElement | null>;
  slowRingRef: RefObject<SVGCircleElement | null>;
  hasteBadgeRef: RefObject<HTMLDivElement | null>;
  hasteRingRef: RefObject<SVGCircleElement | null>;
  relayBadgeRef: RefObject<HTMLDivElement | null>;
  relayRingRef: RefObject<SVGCircleElement | null>;
  /** Anchor for the left edge of the icon row (above HP bar). */
  position?: [number, number, number];
};

function DurationRing({
  ringRef,
  accent,
  track = "rgba(0,0,0,0.45)",
}: {
  ringRef: RefObject<SVGCircleElement | null>;
  accent: string;
  track?: string;
}) {
  const c = BADGE_SIZE / 2 + 3;
  return (
    <svg style={RING_STYLE} viewBox={`0 0 ${BADGE_SIZE + 6} ${BADGE_SIZE + 6}`} aria-hidden>
      <circle
        cx={c}
        cy={c}
        r={RING_R}
        fill="none"
        stroke={track}
        strokeWidth={2.25}
      />
      <circle
        ref={ringRef}
        cx={c}
        cy={c}
        r={RING_R}
        fill="none"
        stroke={accent}
        strokeWidth={2.25}
        strokeLinecap="butt"
        strokeDasharray={RING_C}
        strokeDashoffset={0}
        transform={`rotate(-90 ${c} ${c})`}
      />
    </svg>
  );
}

/**
 * World HP status icons — pack left-to-right from the bar’s left side.
 * Outline ring drains with remaining duration (buffs + debuffs).
 */
export function StatusHpBadgeStack({
  poisonBadgeRef,
  poisonStacksRef,
  poisonRingRef,
  burningBadgeRef,
  burningRingRef,
  bleedingBadgeRef,
  bleedingStacksRef,
  bleedingRingRef,
  rejuvenationBadgeRef,
  rejuvenationStacksRef,
  rejuvenationRingRef,
  silenceBadgeRef,
  silenceRingRef,
  holyBadgeRef,
  holyRingRef,
  soulMarkBadgeRef,
  soulMarkStacksRef,
  soulMarkRingRef,
  soulSeverBadgeRef,
  soulSeverRingRef,
  chillBadgeRef,
  chillStacksRef,
  chillRingRef,
  slowBadgeRef,
  slowRingRef,
  hasteBadgeRef,
  hasteRingRef,
  relayBadgeRef,
  relayRingRef,
  position = [-0.55, 0.22, 0],
}: StackProps) {
  return (
    <Html position={position} center={false} style={{ pointerEvents: "none" }} zIndexRange={[30, 0]}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          transform: "translate(0, -50%)",
        }}
      >
        <div
          ref={holyBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(113, 63, 18, 0.94)",
            border: "1px solid rgba(251, 191, 36, 0.45)",
          }}
          title="Holy Blessing"
        >
          <DurationRing ringRef={holyRingRef} accent="#fbbf24" />
          <img
            src={assetUrl("icons/game/shield.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1, filter: "invert(1)" }}
          />
        </div>

        <div
          ref={silenceBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(46, 16, 101, 0.94)",
            border: "1px solid rgba(167, 139, 250, 0.4)",
          }}
          title="Silenced"
        >
          <DurationRing ringRef={silenceRingRef} accent="#a78bfa" />
          <img
            src={assetUrl("icons/game/silence.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1, filter: "invert(1)" }}
          />
        </div>

        <div
          ref={rejuvenationBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(20, 83, 45, 0.94)",
            border: "1px solid rgba(74, 222, 128, 0.35)",
          }}
          title="Rejuvenation"
        >
          <DurationRing ringRef={rejuvenationRingRef} accent="#4ade80" />
          <img
            src={assetUrl("icons/game/heart-plus.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1 }}
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
          ref={soulMarkBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(46, 16, 101, 0.94)",
            border: "1px solid rgba(167, 139, 250, 0.45)",
          }}
          title="Soul Mark"
        >
          <DurationRing ringRef={soulMarkRingRef} accent="#a78bfa" />
          <img
            src={assetUrl("icons/game/sparkles.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1, filter: "invert(1)" }}
          />
          <span
            ref={soulMarkStacksRef}
            style={{
              ...STACK_PILL,
              background: "#2e1065",
              border: "1px solid #a78bfa",
              color: "#ede9fe",
            }}
          >
            1
          </span>
        </div>

        <div
          ref={chillBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(12, 74, 110, 0.94)",
            border: "1px solid rgba(186, 230, 253, 0.45)",
          }}
          title="Chilled"
        >
          <DurationRing ringRef={chillRingRef} accent="#7dd3fc" />
          <img
            src={assetUrl("icons/game/ice-bolt.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1, filter: "invert(1)" }}
          />
          <span
            ref={chillStacksRef}
            style={{
              ...STACK_PILL,
              background: "#0c4a6e",
              border: "1px solid #7dd3fc",
              color: "#e0f2fe",
            }}
          >
            1
          </span>
        </div>

        <div
          ref={slowBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(30, 58, 138, 0.94)",
            border: "1px solid rgba(147, 197, 253, 0.45)",
          }}
          title="Slowed"
        >
          <DurationRing ringRef={slowRingRef} accent="#93c5fd" />
          <img
            src={assetUrl("icons/game/stopwatch.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1, filter: "invert(1)" }}
          />
        </div>

        <div
          ref={hasteBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(14, 116, 144, 0.94)",
            border: "1px solid rgba(165, 243, 252, 0.45)",
          }}
          title="Slipstream (+50% speed, 25% faster cast)"
        >
          <DurationRing ringRef={hasteRingRef} accent="#67e8f9" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
            <path
              fill="#a5f3fc"
              d="M3 8l5-6v4h5l-5 6V8H3z"
            />
          </svg>
        </div>

        <div
          ref={relayBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(52, 120, 98, 0.94)",
            border: "1px solid rgba(167, 243, 208, 0.55)",
          }}
          title="Soul Relay (next hit heals for damage dealt)"
        >
          <DurationRing ringRef={relayRingRef} accent="#86efac" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
            <path
              fill="#d1fae5"
              d="M7 2h2v5h5v2H9v5H7V9H2V7h5V2z"
            />
          </svg>
        </div>

        <div
          ref={poisonBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(63, 98, 18, 0.94)",
            border: "1px solid rgba(163, 230, 53, 0.35)",
          }}
          title="Poison"
        >
          <DurationRing ringRef={poisonRingRef} accent="#a3e635" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
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
            background: "rgba(124, 45, 18, 0.94)",
            border: "1px solid rgba(251, 146, 60, 0.35)",
          }}
          title="Burning"
        >
          <DurationRing ringRef={burningRingRef} accent="#fb923c" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
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
            background: "rgba(127, 29, 29, 0.94)",
            border: "1px solid rgba(248, 113, 113, 0.35)",
          }}
          title="Bleeding"
        >
          <DurationRing ringRef={bleedingRingRef} accent="#f87171" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
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

        <div
          ref={soulSeverBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(127, 29, 29, 0.94)",
            border: "1px solid rgba(239, 68, 68, 0.45)",
          }}
          title="Soul Severed"
        >
          <DurationRing ringRef={soulSeverRingRef} accent="#EF4444" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
            <path
              fill="#FECACA"
              d="M8 1.5c.12 1.35 1.35 2.4 2.05 3.55.7 1.15.95 2.2.95 3.05 0 1.75-1.45 3-3 3s-3-1.25-3-3c0-.85.25-1.9.95-3.05C6.65 3.9 7.88 2.85 8 1.5z"
            />
            <path
              fill="#EF4444"
              d="M8 4.6c.1.85.65 1.4 1 2 .3.55.42 1 .42 1.4 0 .85-.65 1.5-1.42 1.5S6.58 8.85 6.58 8c0-.4.12-.85.42-1.4.35-.6.9-1.15 1-2z"
            />
            <path
              fill="#7f1d1d"
              d="M8 7.3c.05.4.28.62.45.92.14.25.2.46.2.64 0 .4-.3.68-.65.68s-.65-.28-.65-.68c0-.18.06-.39.2-.64.17-.3.4-.52.45-.92z"
            />
          </svg>
        </div>
      </div>
    </Html>
  );
}

function durationMsFor(statusId: string): number {
  return Math.max(1, STATUSES[statusId]?.durationMs ?? 3000);
}

/** Remaining fraction 1 → 0 based on server expiresAt (epoch ms). */
export function badgeRemainFrac(expiresAt: number, durationMs: number, now = Date.now()): number {
  if (!(expiresAt > 0)) return 0;
  const left = Math.max(0, expiresAt - now);
  return Math.max(0, Math.min(1, left / Math.max(1, durationMs)));
}

function setRingRemain(ring: SVGCircleElement | null, remain: number) {
  if (!ring) return;
  ring.style.strokeDashoffset = String(RING_C * (1 - remain));
}

export function syncPoisonBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("poisoned")));
}

export function syncBurningBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("burning")));
}

export function syncBleedingBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("bleeding")));
}

export function syncSoulSeverBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("soulSevered")));
}

export function syncRejuvenationBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("rejuvenated")));
}

export function syncSilenceBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("silenced")));
}

export function syncHolyBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  // Zone-driven refresh uses remaining zone life; fall back to status base duration.
  const span = Math.max(durationMsFor("holyBlessed"), 6500);
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, span));
}

export function syncSoulMarkBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("soulMarked")));
}

export function syncChillBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("frostChill")));
}

export function syncHasteBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  // Detect if this is the short lane-refresh (≤600ms remaining) or the full 3s tailwind grant
  const remaining = Math.max(0, read.expiresAt - Date.now());
  const span = remaining > 700 ? 3000 : 600;
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, span));
}

export function syncRelayBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, 3500));
}

export function syncSlowBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFrac(read.expiresAt, durationMsFor("slowed")));
}
