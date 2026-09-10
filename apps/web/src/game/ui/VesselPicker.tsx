import {
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  STARTER_COLORS,
  type CosmeticBodyId,
} from "@battlebeasts/shared";
import { AppearancePreview } from "./AppearancePreview";

const OPTIONS: { id: CosmeticBodyId; label: string; hint: string }[] = [
  { id: "female", label: "Female", hint: "Current Mixamo dummy" },
  { id: "male", label: "Male", hint: "Mixamo Y Bot" },
];

type Props = {
  value: CosmeticBodyId | null;
  onChange: (id: CosmeticBodyId) => void;
  /** Compact 3D preview of the selected body. */
  preview?: boolean;
  color?: string;
  pattern?: string;
  patternColor?: string;
};

export function VesselPicker({
  value,
  onChange,
  preview = false,
  color = STARTER_COLORS[0]!,
  pattern = DEFAULT_COSMETIC_PATTERN,
  patternColor = DEFAULT_COSMETIC_PATTERN_COLOR,
}: Props) {
  return (
    <div className="bb-vessel-picker">
      {preview ? (
        <AppearancePreview
          color={color}
          pattern={pattern}
          patternColor={patternColor}
          body={value ?? "female"}
          className="bb-appearance-preview--compact"
        />
      ) : null}
      <p className="bb-section-label mb-1">Body</p>
      <div className="flex gap-2">
        {OPTIONS.map((opt) => {
          const on = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              className={["bb-choice !w-auto !px-4 !py-2", on ? "bb-choice--on" : ""].join(" ")}
              onClick={() => onChange(opt.id)}
              aria-pressed={on}
            >
              <span className="block text-sm font-semibold">{opt.label}</span>
              <span className="bb-meta mt-0.5 block leading-snug">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
