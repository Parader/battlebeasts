import { useEffect } from "react";
import { markPatchNotesSeen, PATCH_NOTES } from "../patchNotes";

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
        aria-label="Updates"
        className="bb-parchment bb-book-panel relative z-10 flex max-h-[min(36rem,85dvh)] w-full max-w-lg flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mb-3 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 className="bb-title text-lg">Updates</h2>
            <p className="mt-0.5 text-xs text-[var(--bb-ink-soft)]">Patch notes</p>
          </div>
          <button type="button" className="bb-btn-ink !px-2 !py-1 text-[10px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="bb-brass-rule mb-4 shrink-0" />

        <ul className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {PATCH_NOTES.map((note, i) => (
            <li key={note.id}>
              <div className="flex items-baseline justify-between gap-2">
                <h3
                  className="text-sm font-semibold text-[var(--bb-ink)]"
                  style={{ fontFamily: "var(--bb-font-display)" }}
                >
                  {note.title}
                  {i === 0 ? (
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-[var(--bb-brass)]">
                      Latest
                    </span>
                  ) : null}
                </h3>
                <time className="shrink-0 text-[10px] tabular-nums text-[var(--bb-ink-soft)]">
                  {formatDate(note.date)}
                </time>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-snug text-[var(--bb-ink-soft)]">
                {note.highlights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {i < PATCH_NOTES.length - 1 ? <div className="bb-brass-rule mt-5 opacity-50" /> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
