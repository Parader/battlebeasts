import { useMemo, useState } from "react";
import { useAudioSettings } from "../useAudioSettings";
import { hasUnseenPatchNotes } from "../patchNotes";
import { useAuth } from "@/providers/auth-provider";
import { GamePanelShell } from "./GamePanelShell";
import { PatchNotesPanel } from "./PatchNotesPanel";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  open: boolean;
  onClose: () => void;
};

const NAME_RE = /^[A-Za-z0-9_]+$/;
const RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

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

function formatCooldown(ms: number): string {
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return "1 day";
  return `${days} days`;
}

export function SettingsPanel({ open, onClose }: Props) {
  const { settings, setMaster, setMusic, setAmbiance, setEffects } = useAudioSettings();
  const { profile, claimDisplayName } = useAuth();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [confirmRename, setConfirmRename] = useState(false);
  const unseen = hasUnseenPatchNotes();

  const cooldownMs = useMemo(() => {
    if (!profile?.name_changed_at || !profile.name_confirmed) return 0;
    const unlockAt = new Date(profile.name_changed_at).getTime() + RENAME_COOLDOWN_MS;
    return Math.max(0, unlockAt - Date.now());
  }, [profile?.name_changed_at, profile?.name_confirmed]);

  const renameBlocked = cooldownMs > 0;

  if (!open && !updatesOpen) return null;

  const validateName = (value: string) => {
    const cleaned = value.trim();
    if (cleaned.length < 3 || cleaned.length > 20) return "Name must be 3–20 characters";
    if (!NAME_RE.test(cleaned)) return "Only letters, numbers, and underscores";
    if (profile?.display_name && cleaned.toLowerCase() === profile.display_name.toLowerCase()) {
      return "That is already your name";
    }
    return null;
  };

  const openRenameConfirm = () => {
    const validationError = validateName(renameDraft);
    if (validationError) {
      setRenameError(validationError);
      return;
    }
    setRenameError(null);
    setConfirmRename(true);
  };

  const commitRename = async () => {
    setRenameSaving(true);
    setRenameError(null);
    try {
      await claimDisplayName(renameDraft.trim());
      setRenameDraft("");
      setConfirmRename(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not rename";
      setRenameError(message.replace(/^.*error:\s*/i, "").split("\n")[0] ?? message);
      setConfirmRename(false);
    } finally {
      setRenameSaving(false);
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmRename}
        title="Change name?"
        message={
          <>
            Rename to <strong>{renameDraft.trim()}</strong>? You can change your name again in 30
            days.
          </>
        }
        confirmLabel={renameSaving ? "Saving…" : "Rename"}
        onConfirm={() => {
          if (renameSaving) return;
          void commitRename();
        }}
        onCancel={() => setConfirmRename(false)}
      />

      {open ? (
        <GamePanelShell title="Settings" onClose={onClose}>
          <div className="space-y-5">
            <div>
              <p className="bb-section-label">Hunter name</p>
              <p className="bb-muted mb-2">
                Current: <strong className="text-[var(--bb-ink)]">{profile?.display_name ?? "—"}</strong>
              </p>
              {renameBlocked ? (
                <p className="bb-meta">
                  You can rename again in {formatCooldown(cooldownMs)}.
                </p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1">
                    <span className="bb-meta mb-1 block">New name</span>
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => {
                        setRenameDraft(e.target.value);
                        if (renameError) setRenameError(null);
                      }}
                      maxLength={20}
                      className="bb-input w-full"
                      placeholder="3–20 characters"
                      aria-label="New display name"
                    />
                  </label>
                  <button
                    type="button"
                    className="bb-btn-brass shrink-0 disabled:opacity-40"
                    disabled={!renameDraft.trim() || renameSaving}
                    onClick={openRenameConfirm}
                  >
                    Change name
                  </button>
                </div>
              )}
              {renameError ? <p className="mt-2 text-sm text-[var(--bb-danger,#b91c1c)]">{renameError}</p> : null}
              {!renameBlocked ? (
                <p className="bb-meta mt-1.5">Once per 30 days · letters, numbers, underscore</p>
              ) : null}
            </div>

            <div>
              <p className="bb-section-label">Audio</p>
              <div className="space-y-4">
                <VolumeSlider label="Master" value={settings.master} onChange={setMaster} />
                <VolumeSlider
                  label="Music"
                  value={settings.music}
                  onChange={setMusic}
                  hint="Hub and arena soundtracks."
                />
                <VolumeSlider
                  label="Ambiance"
                  value={settings.ambiance}
                  onChange={setAmbiance}
                  hint="Environmental beds (village air, etc.)."
                />
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
