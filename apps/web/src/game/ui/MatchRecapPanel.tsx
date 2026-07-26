import { useState } from "react";
import type { MatchRecapState } from "@/game/useBaseCityRoom";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  recap: MatchRecapState;
  rematchReady: boolean;
  onRematch: () => void;
  onReturnHub: () => void;
};

function winnerLabel(winner: MatchRecapState["winner"]): string {
  if (winner === "draw") return "Draw";
  return `Team ${winner.toUpperCase()} wins`;
}

/** Post-match stats + rematch vote. */
export function MatchRecapPanel({ recap, rematchReady, onRematch, onReturnHub }: Props) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  const rows = [...recap.rows].sort((a, b) => b.damageDealt - a.damageDealt);

  return (
    <div
      data-ui-overlay
      className="bb-overlay-dim pointer-events-auto absolute inset-0 z-45 flex items-center justify-center p-4"
    >
      <div className="bb-parchment bb-book-panel w-full max-w-lg">
        <header className="bb-panel-header">
          <div>
            <h2 className="bb-panel-title">{winnerLabel(recap.winner)}</h2>
            <p className="bb-panel-sub tabular-nums">
              {recap.scoreA} – {recap.scoreB}
            </p>
          </div>
        </header>

        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-sm text-[var(--bb-ink)]">
            <thead className="bb-section-label">
              <tr>
                <th className="pb-2 font-normal">Hunter</th>
                <th className="pb-2 font-normal">Team</th>
                <th className="pb-2 font-normal">K</th>
                <th className="pb-2 font-normal">Dmg</th>
                <th className="pb-2 font-normal">Taken</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sessionId} className="border-t border-[var(--bb-panel-line)]">
                  <td className="max-w-[8rem] truncate py-2 pr-2">{row.displayName}</td>
                  <td className="py-2 pr-2 uppercase">{row.team || "—"}</td>
                  <td className="py-2 pr-2 tabular-nums">{row.kills}</td>
                  <td className="py-2 pr-2 tabular-nums">{Math.round(row.damageDealt)}</td>
                  <td className="py-2 tabular-nums">{Math.round(row.damageTaken)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="bb-panel-footer justify-between">
          <p className="bb-meta max-w-[14rem]">
            Rematch needs everyone. Return to city ends the match for all.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="bb-btn-brass disabled:cursor-not-allowed disabled:opacity-50"
              disabled={rematchReady}
              onClick={onRematch}
            >
              {rematchReady ? "Waiting…" : "Rematch"}
            </button>
            <button type="button" className="bb-btn-ink" onClick={() => setConfirmReturn(true)}>
              Return to city
            </button>
          </div>
        </footer>
      </div>

      <ConfirmDialog
        open={confirmReturn}
        title="Return to city?"
        message="Leave this match and send everyone back to the city?"
        confirmLabel="Return to city"
        onConfirm={() => {
          setConfirmReturn(false);
          onReturnHub();
        }}
        onCancel={() => setConfirmReturn(false)}
      />
    </div>
  );
}
