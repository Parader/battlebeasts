import { GamePanelShell } from "./GamePanelShell";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onReloadUi: () => void;
  inContent: boolean;
  onReturnHub?: () => void;
  onLeave: () => void;
};

export function GameMenuPanel({
  open,
  onClose,
  onOpenSettings,
  onReloadUi,
  inContent,
  onReturnHub,
  onLeave,
}: Props) {
  if (!open) return null;

  return (
    <GamePanelShell title="Menu" subtitle="Esc to resume" onClose={onClose} maxWidthClass="max-w-sm">
      <div className="flex flex-col gap-2">
        <button type="button" className="bb-btn-brass w-full" onClick={onClose}>
          Resume
        </button>
        <button type="button" className="bb-btn-ink w-full" onClick={onOpenSettings}>
          Settings
        </button>
        {inContent && onReturnHub ? (
          <button type="button" className="bb-btn-ink w-full" onClick={onReturnHub}>
            Return to city
          </button>
        ) : null}
        <button type="button" className="bb-btn-ink w-full" onClick={onReloadUi}>
          Reload UI
        </button>
        <p className="bb-meta">
          Remounts the 3D view and HUD without leaving the room. Handy if a visual glitch sticks.
        </p>
        <button type="button" className="bb-btn-ink w-full" onClick={onLeave}>
          Leave
        </button>
      </div>
    </GamePanelShell>
  );
}
