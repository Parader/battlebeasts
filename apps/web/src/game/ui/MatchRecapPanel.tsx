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
      className="pointer-events-auto absolute inset-0 z-45 flex items-center justify-center bg-black/45 p-4"
    >
      <div className="bb-parchment w-full max-w-lg px-4 py-3">
        <p className="bb-title text-base">{winnerLabel(recap.winner)}</p>
        <p className="mt-1 text-sm tabular-nums text-[var(--bb-ink-soft)]">
          {recap.scoreA} – {recap.scoreB}
        </p>
        <div className="bb-brass-rule my-3" />
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-xs text-[var(--bb-ink)]">
            <thead className="text-[var(--bb-ink-soft)]">
              <tr>
                <th className="pb-1 font-normal">Hunter</th>
                <th className="pb-1 font-normal">Team</th>
                <th className="pb-1 font-normal">K</th>
                <th className="pb-1 font-normal">Dmg</th>
                <th className="pb-1 font-normal">Taken</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sessionId} className="border-t border-[var(--bb-brass)]/20">
                  <td className="py-1 pr-2 truncate max-w-[8rem]">{row.displayName}</td>
                  <td className="py-1 pr-2 uppercase">{row.team || "—"}</td>
                  <td className="py-1 pr-2 tabular-nums">{row.kills}</td>
                  <td className="py-1 pr-2 tabular-nums">{Math.round(row.damageDealt)}</td>
                  <td className="py-1 tabular-nums">{Math.round(row.damageTaken)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="bb-btn-brass disabled:cursor-not-allowed disabled:opacity-50"
            disabled={rematchReady}
            onClick={onRematch}
          >
            {rematchReady ? "Waiting for others…" : "Rematch"}
          </button>
          <button type="button" className="bb-btn-ink" onClick={() => setConfirmReturn(true)}>
            Return to city
          </button>
        </div>
        <p className="mt-2 text-[0.65rem] text-[var(--bb-ink-soft)]">
          Rematch needs everyone. Return to city ends the match for all.
        </p>
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
