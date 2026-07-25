import type { SpellSlot } from "@battlebeasts/shared";

/** Mouse LMB / RMB — red highlight on the active button. */
export function MouseGlyph({
  button,
  size = 22,
}: {
  button: "left" | "right";
  size?: number;
}) {
  const leftHot = button === "left";
  const rightHot = button === "right";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 40"
      aria-hidden
      className="bb-input-glyph"
    >
      {/* Body */}
      <path
        d="M16 2c-7.2 0-12 4.2-12 12v12c0 7 5.4 12 12 12s12-5 12-12V14c0-7.8-4.8-12-12-12z"
        fill="#1a1f1c"
        stroke="#c9b27a"
        strokeWidth="1.4"
      />
      {/* Seam */}
      <line x1="16" y1="2.5" x2="16" y2="16" stroke="#c9b27a" strokeWidth="1" opacity="0.55" />
      {/* Left button */}
      <path
        d="M5 14V12c0-5.2 3.5-9 11-9v13H5z"
        fill={leftHot ? "#dc2626" : "#2a322c"}
        stroke={leftHot ? "#fca5a5" : "#8a7a4e"}
        strokeWidth="1"
      />
      {/* Right button */}
      <path
        d="M27 14V12c0-5.2-3.5-9-11-9v13h11z"
        fill={rightHot ? "#dc2626" : "#2a322c"}
        stroke={rightHot ? "#fca5a5" : "#8a7a4e"}
        strokeWidth="1"
      />
      {/* Wheel */}
      <rect x="14.2" y="10" width="3.6" height="6" rx="1.2" fill="#0d100e" stroke="#c9b27a" strokeWidth="0.8" />
    </svg>
  );
}

/** Keyboard key cap with label (Q / E / Space…). */
export function KeyGlyph({
  label,
  size = 22,
  wide = false,
}: {
  label: string;
  size?: number;
  wide?: boolean;
}) {
  const w = wide ? size * 2.15 : size;
  const fontSize = wide ? 7.5 : label.length > 1 ? 8 : 11;
  return (
    <svg
      width={w}
      height={size}
      viewBox={wide ? "0 0 48 22" : "0 0 22 22"}
      aria-hidden
      className="bb-input-glyph"
    >
      <rect
        x="0.75"
        y="0.75"
        width={wide ? 46.5 : 20.5}
        height="20.5"
        rx="3.5"
        fill="#1a1f1c"
        stroke="#c9b27a"
        strokeWidth="1.4"
      />
      <rect
        x="2.4"
        y="2.2"
        width={wide ? 43.2 : 17.2}
        height="14.5"
        rx="2.2"
        fill="#2a322c"
        stroke="#8a7a4e"
        strokeWidth="0.7"
        opacity="0.9"
      />
      <text
        x={wide ? 24 : 11}
        y={wide ? 12.2 : 13.2}
        textAnchor="middle"
        fill="#f3e6c0"
        fontFamily="Cinzel, Georgia, serif"
        fontSize={fontSize}
        fontWeight="700"
        style={{ letterSpacing: wide ? "0.04em" : "0" }}
      >
        {label}
      </text>
    </svg>
  );
}

/** Resolve spell-slot → input pictogram. */
export function SpellSlotGlyph({
  slot,
  size = 20,
}: {
  slot: SpellSlot;
  size?: number;
}) {
  if (slot.input === "mouse0") return <MouseGlyph button="left" size={size} />;
  if (slot.input === "mouse2") return <MouseGlyph button="right" size={size} />;
  if (slot.input === "space") return <KeyGlyph label="SPACE" size={size} wide />;
  return <KeyGlyph label={slot.label} size={size} />;
}
