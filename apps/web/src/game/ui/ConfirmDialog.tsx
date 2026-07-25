import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Small parchment confirm dialog over the game. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="bb-overlay-dim fixed inset-0 z-50 flex items-center justify-center p-4"
      data-ui-overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal
        aria-labelledby="bb-confirm-title"
        className="bb-parchment bb-book-panel relative z-10 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="bb-confirm-title" className="bb-title text-lg">
          {title}
        </h2>
        <div className="bb-brass-rule my-3" />
        <p className="text-sm text-[var(--bb-ink-soft)]">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="bb-btn-ink" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="bb-btn-brass" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
