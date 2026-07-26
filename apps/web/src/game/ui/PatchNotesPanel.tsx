import { useEffect } from "react";
import { markPatchNotesSeen, PATCH_NOTES } from "../patchNotes";
import { GamePanelShell } from "./GamePanelShell";

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PatchNotesPanel({ open, onClose }: Props) {
  useEffect(() => {
    if (open) markPatchNotesSeen();
  }, [open]);

  if (!open) return null;

  return (
    <GamePanelShell
      title="Updates"
      subtitle="Patch notes"
      onClose={onClose}
      maxWidthClass="max-w-lg"
      maxHeightClass="max-h-[min(36rem,85dvh)]"
    >
      <ul className="space-y-5">
        {PATCH_NOTES.map((note, i) => (
          <li key={note.id}>
            <div className="flex items-baseline justify-between gap-3">
              <h3
                className="text-[0.95rem] font-semibold text-[var(--bb-ink)]"
                style={{ fontFamily: "var(--bb-font-display)" }}
              >
                {note.title}
                {i === 0 ? <span className="bb-tag ml-2 align-middle">Latest</span> : null}
              </h3>
              <time className="bb-meta shrink-0 tabular-nums">{formatDate(note.date)}</time>
            </div>
            <ul className="bb-muted mt-2 list-disc space-y-1.5 pl-4">
              {note.highlights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {i < PATCH_NOTES.length - 1 ? (
              <div className="mt-5 border-t border-[var(--bb-panel-line)]" />
            ) : null}
          </li>
        ))}
      </ul>
    </GamePanelShell>
  );
}
