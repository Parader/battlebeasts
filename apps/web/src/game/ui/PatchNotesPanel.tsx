import { useEffect } from "react";
import { markPatchNotesSeen, PATCH_NOTES, patchNoteLines, type PatchNote } from "../patchNotes";
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

function LineList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc space-y-1.5 pl-4">
      {items.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function PatchNoteSections({ note }: { note: PatchNote }) {
  const sections: [string, string[]][] = [
    ["Balance", patchNoteLines(note, "balance")],
    ["Bug fixes", patchNoteLines(note, "fixes")],
    ["New content", patchNoteLines(note, "content")],
    ["Updates", patchNoteLines(note, "highlights")],
  ].filter(([, items]) => items.length > 0) as [string, string[]][];

  if (sections.length === 0) return null;

  return (
    <>
      {sections.map(([label, items]) => (
        <li key={label}>
          {sections.length > 1 ? (
            <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--bb-brass)]">
              {label}
            </p>
          ) : null}
          <LineList items={items} />
        </li>
      ))}
    </>
  );
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
            <ul className="bb-muted mt-2 space-y-3">
              <PatchNoteSections note={note} />
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
