import { useMemo } from "react";
import { EMOTES, EMOTE_PIE_SLOT_COUNT, angleToEmoteSlotIndex } from "@battlebeasts/shared";

type Props = {
  /** Fixed 8-slot emote wheel loadout; null = empty wedge. */
  slots: (string | null)[];
  /** atan2(dy, dx) of cursor relative to screen center, radians. */
  aimAngleRad: number;
  visible: boolean;
};

const OUTER_R = 148;
const INNER_R = 48;
const PAD = 24;

function wedgePath(index: number, count: number, rOuter: number, rInner: number): string {
  const step = (Math.PI * 2) / count;
  const start = index * step - step / 2 - Math.PI / 2;
  const end = start + step;
  const largeArc = step > Math.PI ? 1 : 0;
  const x1o = Math.cos(start) * rOuter;
  const y1o = Math.sin(start) * rOuter;
  const x2o = Math.cos(end) * rOuter;
  const y2o = Math.sin(end) * rOuter;
  const x1i = Math.cos(end) * rInner;
  const y1i = Math.sin(end) * rInner;
  const x2i = Math.cos(start) * rInner;
  const y2i = Math.sin(start) * rInner;
  return [
    `M ${x1o} ${y1o}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o} ${y2o}`,
    `L ${x1i} ${y1i}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i} ${y2i}`,
    "Z",
  ].join(" ");
}

/**
 * V-key radial emote wheel. Purely presentational — `useBaseCityRoom` owns
 * the KeyV hold/release + mouse-angle input and decides what to cast; this
 * just renders the 8 wedges and highlights whichever one the cursor aims at.
 */
export function EmotePieHud({ slots, aimAngleRad, visible }: Props) {
  const highlighted = useMemo(
    () => angleToEmoteSlotIndex(aimAngleRad, EMOTE_PIE_SLOT_COUNT),
    [aimAngleRad],
  );

  if (!visible) return null;

  const size = (OUTER_R + PAD) * 2;
  const cx = size / 2;
  const cy = size / 2;
  const labelR = (OUTER_R + INNER_R) / 2;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
      <div className="bb-emote-pie">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="bb-emote-pie__svg"
        >
          <g transform={`translate(${cx} ${cy})`}>
            {Array.from({ length: EMOTE_PIE_SLOT_COUNT }, (_, i) => {
              const emoteId = slots[i] ?? null;
              const def = emoteId ? EMOTES[emoteId] : undefined;
              const isActive = i === highlighted;
              const angle = i * ((Math.PI * 2) / EMOTE_PIE_SLOT_COUNT) - Math.PI / 2;
              const lx = Math.cos(angle) * labelR;
              const ly = Math.sin(angle) * labelR;
              return (
                <g key={i}>
                  <path
                    d={wedgePath(i, EMOTE_PIE_SLOT_COUNT, OUTER_R, INNER_R)}
                    className={[
                      "bb-emote-pie__wedge",
                      isActive ? "bb-emote-pie__wedge--active" : "",
                      def ? "" : "bb-emote-pie__wedge--empty",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={[
                      "bb-emote-pie__label",
                      isActive ? "bb-emote-pie__label--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {def ? def.name : "—"}
                  </text>
                </g>
              );
            })}
            <circle r={INNER_R - 6} className="bb-emote-pie__center" />
          </g>
        </svg>
      </div>
    </div>
  );
}
