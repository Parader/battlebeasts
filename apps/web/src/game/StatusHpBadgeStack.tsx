import { type CSSProperties, type RefObject } from "react";
import { Html } from "@react-three/drei";
import { assetUrl } from "./assetUrl";
import { BADGE_SIZE, RING_C, RING_R } from "./statusBadgeUtils";

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
  bloodPactBadgeRef: RefObject<HTMLDivElement | null>;
  bloodPactRingRef: RefObject<SVGCircleElement | null>;
  soulMarkBadgeRef: RefObject<HTMLDivElement | null>;
  soulMarkStacksRef: RefObject<HTMLSpanElement | null>;
  soulMarkRingRef: RefObject<SVGCircleElement | null>;
  soulSeverBadgeRef: RefObject<HTMLDivElement | null>;
  soulSeverRingRef: RefObject<SVGCircleElement | null>;
  chillBadgeRef: RefObject<HTMLDivElement | null>;
  chillStacksRef: RefObject<HTMLSpanElement | null>;
  chillRingRef: RefObject<SVGCircleElement | null>;
  shockBadgeRef?: RefObject<HTMLDivElement | null>;
  shockStacksRef?: RefObject<HTMLSpanElement | null>;
  shockRingRef?: RefObject<SVGCircleElement | null>;
  slowBadgeRef: RefObject<HTMLDivElement | null>;
  slowRingRef: RefObject<SVGCircleElement | null>;
  hasteBadgeRef: RefObject<HTMLDivElement | null>;
  hasteRingRef: RefObject<SVGCircleElement | null>;
  relayBadgeRef: RefObject<HTMLDivElement | null>;
  relayRingRef: RefObject<SVGCircleElement | null>;
  spellbreakerBadgeRef: RefObject<HTMLDivElement | null>;
  spellbreakerStacksRef: RefObject<HTMLSpanElement | null>;
  spellbreakerRingRef: RefObject<SVGCircleElement | null>;
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
  bloodPactBadgeRef,
  bloodPactRingRef,
  soulMarkBadgeRef,
  soulMarkStacksRef,
  soulMarkRingRef,
  soulSeverBadgeRef,
  soulSeverRingRef,
  chillBadgeRef,
  chillStacksRef,
  chillRingRef,
  shockBadgeRef,
  shockStacksRef,
  shockRingRef,
  slowBadgeRef,
  slowRingRef,
  hasteBadgeRef,
  hasteRingRef,
  relayBadgeRef,
  relayRingRef,
  spellbreakerBadgeRef,
  spellbreakerStacksRef,
  spellbreakerRingRef,
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
          ref={bloodPactBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(127, 29, 29, 0.94)",
            border: "1px solid rgba(239, 68, 68, 0.55)",
          }}
          title="Blood Pact (+35% damage dealt)"
        >
          <DurationRing ringRef={bloodPactRingRef} accent="#ef4444" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
            <path
              fill="#fca5a5"
              d="M8 1.2c-.4 1.5-2.2 3.1-3.3 5C3.5 7.8 3 9.1 3 10.3 3 13 5.2 15 8 15s5-2 5-4.7c0-1.2-.5-2.5-1.7-4.1C10.2 4.3 8.4 2.7 8 1.2z"
            />
            <path
              fill="#b91c1c"
              d="M8 3.8c-.2.9-1.3 2-2 3.2-.7 1.1-1 2-1 2.8 0 1.8 1.3 3.1 3 3.1s3-1.3 3-3.1c0-.8-.3-1.7-1-2.8-.7-1.2-1.8-2.3-2-3.2z"
            />
            <path
              fill="#ffffff"
              d="M7.4 6.8h1.2v4.2H7.4z M6.4 7.6l1.6-1.6 1.6 1.6-0.8 0.8-0.8-0.8-0.8 0.8z"
            />
          </svg>
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
          ref={shockBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(14, 116, 144, 0.94)",
            border: "1px solid rgba(56, 189, 248, 0.55)",
          }}
          title="Shocked (+10% damage taken/stack · Static Discharge)"
        >
          <DurationRing ringRef={shockRingRef ?? { current: null }} accent="#38bdf8" />
          <img
            src={assetUrl("icons/game/power-lightning.svg")}
            alt=""
            width={12}
            height={12}
            draggable={false}
            aria-hidden
            style={{ display: "block", position: "relative", zIndex: 1, filter: "invert(1)" }}
          />
          <span
            ref={shockStacksRef}
            style={{
              ...STACK_PILL,
              background: "#0891b2",
              border: "1px solid #38bdf8",
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
          title="Haste (move speed)"
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
          ref={spellbreakerBadgeRef}
          style={{
            ...BADGE_BOX,
            background: "rgba(113, 63, 18, 0.94)",
            border: "1px solid rgba(251, 191, 36, 0.5)",
          }}
          title="Spellbreaker (bonus damage on next damaging spell)"
        >
          <DurationRing ringRef={spellbreakerRingRef} accent="#fbbf24" />
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            aria-hidden
            style={{ position: "relative", zIndex: 1 }}
          >
            <circle cx="8" cy="8" r="4.5" fill="#fde68a" />
            <circle cx="8" cy="8" r="2.2" fill="#a16207" />
          </svg>
          <span
            ref={spellbreakerStacksRef}
            style={{
              ...STACK_PILL,
              background: "#78350f",
              border: "1px solid #fbbf24",
              color: "#fef3c7",
            }}
          >
            1
          </span>
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
