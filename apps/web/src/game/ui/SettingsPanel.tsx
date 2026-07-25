import { useState } from "react";
import { useAudioSettings } from "../useAudioSettings";
import { hasUnseenPatchNotes } from "../patchNotes";
import { PatchNotesPanel } from "./PatchNotesPanel";

type Props = {
  open: boolean;
  onClose: () => void;
};

function VolumeSlider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--bb-ink)]" style={{ fontFamily: "var(--bb-font-display)" }}>
          {label}
        </span>
        <span className="tabular-nums text-xs text-[var(--bb-ink-soft)]">{pct}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="bb-volume-slider w-full"
        aria-label={label}
      />
      {hint ? <p className="mt-1 text-[10px] text-[var(--bb-ink-soft)]">{hint}</p> : null}
    </label>
  );
}

export function SettingsPanel({ open, onClose }: Props) {
  const { settings, setMaster, setMusic, setEffects } = useAudioSettings();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const unseen = hasUnseenPatchNotes();

  if (!open && !updatesOpen) return null;

  return (
    <>
      {open ? (
        <div
          className="bb-overlay-dim fixed inset-0 z-40 flex items-center justify-center p-4"
          data-ui-overlay
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            aria-label="Settings"
            className="bb-parchment bb-book-panel relative z-10 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative mb-3 flex items-start justify-between gap-3">
              <h2 className="bb-title text-lg">Settings</h2>
              <button type="button" className="bb-btn-ink !px-2 !py-1 text-[10px]" onClick={onClose}>
                Close
              </button>
            </div>
            <div className="bb-brass-rule mb-4" />

            <div className="space-y-5">
              <p className="text-xs text-[var(--bb-ink-soft)]">Audio</p>
              <VolumeSlider label="Master" value={settings.master} onChange={setMaster} />
              <VolumeSlider label="Music" value={settings.music} onChange={setMusic} />
              <VolumeSlider
                label="Effects"
                value={settings.effects}
                onChange={setEffects}
                hint="Combat and UI sounds — coming soon."
              />

              <div className="bb-brass-rule" />

              <div>
                <p className="mb-2 text-xs text-[var(--bb-ink-soft)]">Updates</p>
                <button
                  type="button"
                  className="bb-btn-brass w-full"
                  onClick={() => {
                    onClose();
                    setUpdatesOpen(true);
                  }}
                >
                  {unseen ? "View patch notes · New" : "View patch notes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PatchNotesPanel open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
    </>
  );
}
