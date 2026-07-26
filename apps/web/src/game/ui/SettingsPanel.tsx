import { useState } from "react";
import { useAudioSettings } from "../useAudioSettings";
import { hasUnseenPatchNotes } from "../patchNotes";
import { GamePanelShell } from "./GamePanelShell";
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
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span
          className="text-sm font-semibold text-[var(--bb-ink)]"
          style={{ fontFamily: "var(--bb-font-display)" }}
        >
          {label}
        </span>
        <span className="bb-meta tabular-nums">{pct}%</span>
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
      {hint ? <p className="bb-meta mt-1.5">{hint}</p> : null}
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
        <GamePanelShell title="Settings" onClose={onClose}>
          <div className="space-y-5">
            <div>
              <p className="bb-section-label">Audio</p>
              <div className="space-y-4">
                <VolumeSlider label="Master" value={settings.master} onChange={setMaster} />
                <VolumeSlider label="Music" value={settings.music} onChange={setMusic} />
                <VolumeSlider
                  label="Effects"
                  value={settings.effects}
                  onChange={setEffects}
                  hint="Combat and UI sounds."
                />
              </div>
            </div>

            <div>
              <p className="bb-section-label">Updates</p>
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
        </GamePanelShell>
      ) : null}

      <PatchNotesPanel open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
    </>
  );
}
