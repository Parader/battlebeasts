import { useEffect, useMemo, useState } from "react";
import type { MatchRecapState } from "@/game/useBaseCityRoom";
import { ConfirmDialog } from "./ConfirmDialog";
import { RankRevealPanel, type RankRevealState } from "./RankRevealPanel";

type Props = {
  recap: MatchRecapState;
  rematchReady: boolean;
  localSessionId: string | null;
  /** Spectators cannot vote rematch. */
  isSpectator?: boolean;
  onRematch: () => void;
  onReturnHub: () => void;
};

function winnerLabel(winner: MatchRecapState["winner"]): string {
  if (winner === "draw") return "Draw";
  return `Team ${winner.toUpperCase()} wins`;
}

function buildRankReveal(
  ranked: NonNullable<MatchRecapState["rows"][number]["ranked"]>,
): RankRevealState | null {
  const tierChanged = ranked.tierBefore !== ranked.tierAfter;
  const divisionChanged = ranked.divisionBefore !== ranked.divisionAfter;
  if (!ranked.promoted && !ranked.demoted && !tierChanged && !divisionChanged) {
    return null;
  }

  return {
    kind: ranked.demoted ? "demote" : "promote",
    tierBefore: ranked.tierBefore,
    tierAfter: ranked.tierAfter,
    divisionBefore: ranked.divisionBefore,
    divisionAfter: ranked.divisionAfter,
    lpAfter: ranked.lpAfter ?? 0,
    label: ranked.label,
  };
}

/** Post-match stats, reward reveal, rematch vote. */
export function MatchRecapPanel({
  recap,
  rematchReady,
  localSessionId,
  isSpectator = false,
  onRematch,
  onReturnHub,
}: Props) {
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [rankRevealDone, setRankRevealDone] = useState(false);
  const [lpFill, setLpFill] = useState(0);

  const rows = [...recap.rows].sort((a, b) => b.damageDealt - a.damageDealt);
  const localRow = localSessionId
    ? rows.find((r) => r.sessionId === localSessionId)
    : undefined;
  const localRewards = localRow?.rewards;
  const ranked = localRow?.ranked;

  const pendingReveal = useMemo(
    () => (ranked ? buildRankReveal(ranked) : null),
    [ranked],
  );

  useEffect(() => {
    setRankRevealDone(false);
  }, [recap.scoreA, recap.scoreB, recap.scoreC, recap.winner, localSessionId]);

  useEffect(() => {
    if (!ranked) {
      setLpFill(0);
      return;
    }
    setLpFill(0);
    const id = window.setTimeout(() => {
      setLpFill(Math.max(0, Math.min(100, ranked.lpAfter ?? 0)));
    }, 80);
    return () => window.clearTimeout(id);
  }, [ranked]);

  const showReveal = Boolean(pendingReveal) && !rankRevealDone;

  return (
    <div
      data-ui-overlay
      className="bb-overlay-dim pointer-events-auto absolute inset-0 z-45 flex items-center justify-center p-4"
    >
      {!showReveal ? (
        <div className="bb-parchment bb-book-panel w-full max-w-lg">
          <header className="bb-panel-header">
            <div>
              <h2 className="bb-panel-title">{winnerLabel(recap.winner)}</h2>
              <p className="bb-panel-sub tabular-nums">
                {typeof recap.scoreC === "number"
                  ? `${recap.scoreA} – ${recap.scoreB} – ${recap.scoreC}`
                  : `${recap.scoreA} – ${recap.scoreB}`}
              </p>
            </div>
          </header>

          {localRewards ? (
            <div className="mb-3 rounded border border-[var(--bb-panel-line)] px-3 py-2 text-sm text-[var(--bb-ink)]">
              <p className="bb-section-label mb-1">Your rewards</p>
              <p className="tabular-nums">
                +{localRewards.essence} essence
                {localRewards.copper > 0 ? ` · +${localRewards.copper} copper` : ""}
              </p>
              {localRewards.winBonus > 0 ? (
                <p className="bb-meta mt-0.5">Includes +{localRewards.winBonus} win bonus essence</p>
              ) : null}
              {localRewards.activityMul < 1 ? (
                <p className="bb-meta mt-0.5">
                  Reduced for low activity ({Math.round(localRewards.activityMul * 100)}%)
                </p>
              ) : null}
            </div>
          ) : null}

          {ranked ? (
            <div className="bb-rank-lp mb-3 rounded border border-[var(--bb-panel-line)] px-3 py-2 text-sm text-[var(--bb-ink)]">
              <p className="bb-section-label mb-1">Ranked</p>
              <p className="tabular-nums font-semibold">{ranked.label}</p>
              <p className="bb-meta mt-0.5 tabular-nums">
                {ranked.lpDelta === 0 && !ranked.promoted && !ranked.demoted ? (
                  <>LP unchanged{ranked.lpAfter === 0 ? " (shield at 0 LP)" : ""}</>
                ) : (
                  <>
                    LP {ranked.lpDelta >= 0 ? "+" : ""}
                    {ranked.lpDelta}
                  </>
                )}
                {ranked.mmrDelta !== 0 ? (
                  <>
                    {" "}
                    · MMR {ranked.mmrDelta >= 0 ? "+" : ""}
                    {ranked.mmrDelta}
                  </>
                ) : null}
              </p>
              {ranked.tierAfter !== "master" && ranked.tierAfter !== "grandmaster" ? (
                <div className="bb-rank-lp__bar mt-2" aria-hidden>
                  <div className="bb-rank-lp__fill" style={{ width: `${lpFill}%` }} />
                </div>
              ) : null}
              {ranked.promoted ? <p className="bb-meta mt-0.5">Promoted!</p> : null}
              {ranked.demoted ? <p className="bb-meta mt-0.5">Demoted</p> : null}
            </div>
          ) : null}

          <div className="max-h-56 overflow-auto">
            <table className="w-full text-left text-sm text-[var(--bb-ink)]">
              <thead className="bb-section-label">
                <tr>
                  <th className="pb-2 font-normal">Hunter</th>
                  <th className="pb-2 font-normal">Team</th>
                  <th className="pb-2 font-normal">K</th>
                  <th className="pb-2 font-normal">Dmg</th>
                  <th className="pb-2 font-normal">Taken</th>
                  <th className="pb-2 font-normal">Heal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isLocal = row.sessionId === localSessionId;
                  return (
                    <tr
                      key={row.sessionId}
                      className={[
                        "border-t border-[var(--bb-panel-line)]",
                        isLocal ? "bg-[color-mix(in_srgb,var(--bb-brass)_12%,transparent)]" : "",
                      ].join(" ")}
                    >
                      <td className="max-w-[8rem] truncate py-2 pr-2">{row.displayName}</td>
                      <td className="py-2 pr-2 uppercase">{row.team || "—"}</td>
                      <td className="py-2 pr-2 tabular-nums">{row.kills}</td>
                      <td className="py-2 pr-2 tabular-nums">{Math.round(row.damageDealt)}</td>
                      <td className="py-2 pr-2 tabular-nums">{Math.round(row.damageTaken)}</td>
                      <td className="py-2 tabular-nums">{Math.round(row.healing)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="bb-panel-footer justify-between">
            <p className="bb-meta max-w-[14rem]">
              {isSpectator
                ? "Spectating — rematch is decided by fighters."
                : "Rematch needs every fighter. Return to city ends the match for all."}
            </p>
            <div className="flex flex-wrap gap-2">
              {!isSpectator ? (
                <button
                  type="button"
                  className="bb-btn-brass disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={rematchReady}
                  onClick={onRematch}
                >
                  {rematchReady ? "Waiting…" : "Rematch"}
                </button>
              ) : null}
              <button type="button" className="bb-btn-ink" onClick={() => setConfirmReturn(true)}>
                Return to city
              </button>
            </div>
          </footer>
        </div>
      ) : null}

      {showReveal && pendingReveal ? (
        <RankRevealPanel reveal={pendingReveal} onClose={() => setRankRevealDone(true)} />
      ) : null}

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
