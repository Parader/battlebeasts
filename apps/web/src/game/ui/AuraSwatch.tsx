import type { CSSProperties } from "react";
import {
  COSMETIC_AURA_TINTS,
  mixAuraColor,
  normalizeCosmeticAura,
  type CosmeticAuraId,
} from "@battlebeasts/shared";

export function AuraSwatch({ auraId, auraColor }: { auraId: string; auraColor?: string }) {
  const id = normalizeCosmeticAura(auraId);
  const inked = id !== "plain" && Boolean(auraColor);
  const painted = inked
    ? mixAuraColor(COSMETIC_AURA_TINTS[id], auraColor!)
    : undefined;
  return (
    <span
      className={[
        "bb-aura-swatch",
        `bb-aura-swatch--${id as CosmeticAuraId}`,
        inked ? "bb-aura-swatch--inked" : "",
      ].join(" ")}
      style={painted ? ({ ["--bb-aura-ink"]: painted } as CSSProperties) : undefined}
      aria-hidden
    >
      <span className="bb-aura-swatch__core" />
      <span className="bb-aura-swatch__speck bb-aura-swatch__speck--a" />
      <span className="bb-aura-swatch__speck bb-aura-swatch__speck--b" />
      <span className="bb-aura-swatch__speck bb-aura-swatch__speck--c" />
    </span>
  );
}
