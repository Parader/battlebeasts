import { useEffect, useRef, useState } from "react";
import {
  LOADOUT_PRESET_NAME_MAX,
  sanitizeLoadoutPresetName,
} from "@battlebeasts/shared";

export type LoadoutPresetTab = {
  slotIndex: number;
  name: string;
};

type Props = {
  loadoutPresets: LoadoutPresetTab[];
  activeLoadoutSlot: number;
  loadoutSlotCount: number;
  onSelectPreset: (slotIndex: number) => void;
  onRenamePreset: (slotIndex: number, name: string) => void;
  disabled?: boolean;
  className?: string;
};

/** Loadout slot chips — click to switch, click the active chip to rename. */
export function LoadoutPresetTabs({
  loadoutPresets,
  activeLoadoutSlot,
  loadoutSlotCount,
  onSelectPreset,
  onRenamePreset,
  disabled = false,
  className,
}: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    if (editing === null) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const beginRename = (slotIndex: number, current: string) => {
    skipCommitRef.current = false;
    setDraft(current);
    setEditing(slotIndex);
  };

  const cancelRename = () => {
    skipCommitRef.current = true;
    setEditing(null);
    setDraft("");
  };

  const commitRename = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    if (editing === null) return;
    const slotIndex = editing;
    const name = sanitizeLoadoutPresetName(draft, slotIndex);
    const current =
      loadoutPresets.find((p) => p.slotIndex === slotIndex)?.name ??
      `Loadout ${slotIndex + 1}`;
    setEditing(null);
    setDraft("");
    if (name !== current) onRenamePreset(slotIndex, name);
  };

  return (
    <div
      className={["bb-loadout-presets", className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label="Loadout presets"
    >
      {Array.from({ length: loadoutSlotCount }, (_, i) => i).map((i) => {
        const preset = loadoutPresets.find((p) => p.slotIndex === i);
        const label = preset?.name ?? `Loadout ${i + 1}`;
        const active = activeLoadoutSlot === i;
        if (editing === i) {
          return (
            <form
              key={i}
              className="bb-slot-chip bb-slot-chip--on bb-slot-chip--edit"
              onSubmit={(e) => {
                e.preventDefault();
                commitRename();
              }}
            >
              <input
                ref={inputRef}
                className="bb-slot-chip__input"
                value={draft}
                maxLength={LOADOUT_PRESET_NAME_MAX}
                aria-label="Loadout name"
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelRename();
                  }
                }}
              />
            </form>
          );
        }
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled}
            disabled={disabled}
            title={active ? "Click to rename" : label}
            className={["bb-slot-chip", active ? "bb-slot-chip--on" : ""].join(" ")}
            onClick={() => {
              if (disabled) return;
              if (active) beginRename(i, label);
              else onSelectPreset(i);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
