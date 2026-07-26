import type { ReactNode } from "react";
import { GamePanelShell } from "./GamePanelShell";

type Props = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Small confirm dialog over the game. */
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
    <GamePanelShell
      title={title}
      onClose={onCancel}
      showCloseButton={false}
      maxWidthClass="max-w-sm"
      zClass="z-50"
      role="alertdialog"
      footer={
        <>
          <button type="button" className="bb-btn-ink" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="bb-btn-brass" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="bb-muted">{message}</p>
    </GamePanelShell>
  );
}
