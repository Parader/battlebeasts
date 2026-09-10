import { useState } from "react";
import {
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  STARTER_COLORS,
  type CosmeticBodyId,
} from "@battlebeasts/shared";
import { GamePanelShell } from "./GamePanelShell";
import { VesselPicker } from "./VesselPicker";

type Props = {
  open: boolean;
  color?: string;
  pattern?: string;
  patternColor?: string;
  saving?: boolean;
  onConfirm: (body: CosmeticBodyId) => void;
};

/** Blocking pick for hunters whose account never chose Female / Male. */
export function VesselSetupPanel({
  open,
  color,
  pattern,
  patternColor,
  saving = false,
  onConfirm,
}: Props) {
  const [body, setBody] = useState<CosmeticBodyId | null>(null);
  if (!open) return null;

  return (
    <GamePanelShell
      title="Choose your body"
      subtitle="Female is the current dummy. Male is Mixamo Y Bot. This choice is permanent."
      showCloseButton={false}
      zClass="z-50"
      role="alertdialog"
      ariaLabel="Choose your body"
      maxHeightClass="max-h-[min(80dvh,560px)]"
      footer={
        <button
          type="button"
          className="bb-btn-brass w-full"
          disabled={!body || saving}
          onClick={() => {
            if (!body) return;
            onConfirm(body);
          }}
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
      }
    >
      <VesselPicker
        value={body}
        onChange={setBody}
        preview
        color={color ?? STARTER_COLORS[0]!}
        pattern={pattern ?? DEFAULT_COSMETIC_PATTERN}
        patternColor={patternColor ?? DEFAULT_COSMETIC_PATTERN_COLOR}
      />
    </GamePanelShell>
  );
}
