import { useMemo } from "react";
import { EMOTES, EMOTE_PIE_SLOT_COUNT, angleToEmoteSlotIndex } from "@battlebeasts/shared";

export function wedgePath(
  index: number,
  count: number,
  rOuter: number,
  rInner: number,
): string {
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

type HudProps = {
  /** Fixed 8-slot emote wheel loadout; null = empty wedge. */
  slots: (string | null)[];
  /** atan2(dy, dx) of cursor relative to screen center, radians. */
  aimAngleRad: number;
  visible: boolean;
};

const HUD_OUTER_R = 148;
const HUD_INNER_R = 48;
const HUD_PAD = 24;

/**
 * V-key radial emote wheel. Purely presentational — `useBaseCityRoom` owns
 * the KeyV hold/release + mouse-angle input and decides what to cast; this
 * just renders the 8 wedges and highlights whichever one the cursor aims at.
 */
export function EmotePieHud({ slots, aimAngleRad, visible }: HudProps) {
  const highlighted = useMemo(
    () => angleToEmoteSlotIndex(aimAngleRad, EMOTE_PIE_SLOT_COUNT),
    [aimAngleRad],
  );

  if (!visible) return null;

  const size = (HUD_OUTER_R + HUD_PAD) * 2;
  const cx = size / 2;
  const cy = size / 2;
  const labelR = (HUD_OUTER_R + HUD_INNER_R) / 2;

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
                    d={wedgePath(i, EMOTE_PIE_SLOT_COUNT, HUD_OUTER_R, HUD_INNER_R)}
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
            <circle r={HUD_INNER_R - 6} className="bb-emote-pie__center" />
          </g>
        </svg>
      </div>
    </div>
  );
}

type EditorProps = {
  slots: (string | null)[];
  /** Emote currently picked from the owned list (place on click). */
  selectedEmoteId: string | null;
  onSlotClick: (index: number) => void;
  /** Right-click a filled wedge to clear it. */
  onSlotClear?: (index: number) => void;
  /** Drop from owned list or another wedge. */
  onSlotDrop?: (index: number, emoteId: string, fromSlot?: number) => void;
  /** Outer radius in SVG units. */
  outerR?: number;
};

const EDITOR_INNER_RATIO = 48 / 148;
const EDITOR_PAD = 18;
const EMOTE_DND = "application/x-bb-emote";
const EMOTE_FROM_SLOT = "application/x-bb-emote-slot";

/**
 * Interactive emote wheel for Appearance → Emotes.
 * Same layout as the in-game pie; click to preview / place, right-click to clear.
 */
export function EmotePieEditor({
  slots,
  selectedEmoteId,
  onSlotClick,
  onSlotClear,
  onSlotDrop,
  outerR = 118,
}: EditorProps) {
  const innerR = outerR * EDITOR_INNER_RATIO;
  const size = (outerR + EDITOR_PAD) * 2;
  const cx = size / 2;
  const cy = size / 2;
  const labelR = (outerR + innerR) / 2;
  const selectedName = selectedEmoteId ? EMOTES[selectedEmoteId]?.name : null;

  return (
    <div className="bb-emote-pie-editor">
      <div className="bb-emote-pie bb-emote-pie--editor">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="bb-emote-pie__svg"
          role="group"
          aria-label="Emote wheel"
        >
          <g transform={`translate(${cx} ${cy})`}>
            {Array.from({ length: EMOTE_PIE_SLOT_COUNT }, (_, i) => {
              const emoteId = slots[i] ?? null;
              const def = emoteId ? EMOTES[emoteId] : undefined;
              const angle = i * ((Math.PI * 2) / EMOTE_PIE_SLOT_COUNT) - Math.PI / 2;
              const lx = Math.cos(angle) * labelR;
              const ly = Math.sin(angle) * labelR;
              const title = def
                ? selectedEmoteId
                  ? `Replace ${def.name}`
                  : `Preview ${def.name} (right-click to clear)`
                : selectedEmoteId
                  ? `Place ${selectedName ?? "emote"}`
                  : "Empty slot";
              return (
                <g key={i}>
                  <path
                    d={wedgePath(i, EMOTE_PIE_SLOT_COUNT, outerR, innerR)}
                    className={[
                      "bb-emote-pie__wedge",
                      "bb-emote-pie__wedge--clickable",
                      def ? "" : "bb-emote-pie__wedge--empty",
                      selectedEmoteId ? "bb-emote-pie__wedge--placing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    role="button"
                    tabIndex={0}
                    aria-label={`Slot ${i + 1}: ${title}`}
                    draggable={Boolean(def)}
                    onClick={() => onSlotClick(i)}
                    onContextMenu={(e) => {
                      if (!def || !onSlotClear) return;
                      e.preventDefault();
                      onSlotClear(i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSlotClick(i);
                      }
                      if ((e.key === "Delete" || e.key === "Backspace") && def && onSlotClear) {
                        e.preventDefault();
                        onSlotClear(i);
                      }
                    }}
                    onDragStart={(e) => {
                      if (!emoteId) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.setData(EMOTE_DND, emoteId);
                      e.dataTransfer.setData(EMOTE_FROM_SLOT, String(i));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const types = Array.from(e.dataTransfer.types as ArrayLike<string>);
                      e.dataTransfer.dropEffect = types.includes(EMOTE_FROM_SLOT)
                        ? "move"
                        : "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData(EMOTE_DND);
                      if (!id || !onSlotDrop) return;
                      const fromRaw = e.dataTransfer.getData(EMOTE_FROM_SLOT);
                      const fromSlot =
                        fromRaw !== "" && Number.isFinite(Number(fromRaw))
                          ? Number(fromRaw)
                          : undefined;
                      onSlotDrop(i, id, fromSlot);
                    }}
                  >
                    <title>{title}</title>
                  </path>
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={[
                      "bb-emote-pie__label",
                      def ? "bb-emote-pie__label--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {def ? def.name : "—"}
                  </text>
                </g>
              );
            })}
            <circle r={innerR - 6} className="bb-emote-pie__center" />
            <text
              x={0}
              y={0}
              textAnchor="middle"
              dominantBaseline="middle"
              className="bb-emote-pie__hub-label"
            >
              {selectedName ? "Place" : "V"}
            </text>
          </g>
        </svg>
      </div>
      <p className="bb-meta text-center">
        {selectedEmoteId
          ? `Click or drop onto a wedge to place ${selectedName ?? "emote"}`
          : "Click a wedge to preview · right-click to clear"}
      </p>
    </div>
  );
}
