import { useEffect, useState } from "react";
import {
  formatLeaderboardRank,
  formatRankLabel,
  normalizeRankSnapshot,
  type RankSnapshot,
} from "@battlebeasts/shared";
import { GamePanelShell } from "./GamePanelShell";

export type HubRankedSeason = {
  id: string;
  slug: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
};

export type HubLeaderboardRow = {
  userId: string;
  displayName: string;
  mmr: number;
  lp: number;
  tier: string;
  division: number;
  rank: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  season: HubRankedSeason | null;
  rating: RankSnapshot | null;
  label: string | null;
  leaderboard: HubLeaderboardRow[];
  onRefresh: () => void;
};

/** Hub ranked ladder panel — season rating + top 100. */
export function RankPanel({
  open,
  onClose,
  season,
  rating,
  label,
  leaderboard,
  onRefresh,
}: Props) {
  const [tab, setTab] = useState<"rank" | "leaderboard">("rank");

  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

  if (!open) return null;

  const snap = rating ? normalizeRankSnapshot(rating) : null;
  const display =
    (snap ? formatRankLabel(snap) : null) ??
    label ??
    "Unranked";

  return (
    <GamePanelShell
      title="Ranked"
      subtitle={season ? `Season · ${season.slug}` : "No active season"}
      onClose={onClose}
      maxHeightClass="max-h-[min(80dvh,640px)]"
    >
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={tab === "rank" ? "bb-btn-brass" : "bb-btn-ink"}
          onClick={() => setTab("rank")}
        >
          My rank
        </button>
        <button
          type="button"
          className={tab === "leaderboard" ? "bb-btn-brass" : "bb-btn-ink"}
          onClick={() => setTab("leaderboard")}
        >
          Leaderboard
        </button>
      </div>

      {tab === "rank" ? (
        <div className="space-y-4">
          <div className="bb-list-row bb-list-row--stack">
            <p className="bb-panel-title !text-2xl">{display}</p>
            {snap ? (
              <>
                <p className="bb-meta tabular-nums">
                  {snap.wins}W · {snap.losses}L
                  {snap.peakTier && snap.peakTier !== snap.tier
                    ? ` · Peak ${snap.peakTier.charAt(0).toUpperCase()}${snap.peakTier.slice(1)}`
                    : ""}
                </p>
                {snap.tier !== "master" && snap.tier !== "grandmaster" ? (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-[var(--bb-panel-line)]">
                    <div
                      className="h-full bg-[var(--bb-brass)]"
                      style={{ width: `${Math.max(0, Math.min(100, snap.lp))}%` }}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="bb-muted">Play a ranked match to receive a rating.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="max-h-80 space-y-1 overflow-auto">
          {leaderboard.length === 0 ? (
            <p className="bb-muted">Leaderboard empty — be the first.</p>
          ) : (
            leaderboard.map((row) => (
              <div key={row.userId} className="bb-list-row flex items-center justify-between gap-2">
                <span className="tabular-nums text-[var(--bb-ink-soft)]">#{row.rank}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--bb-ink)]">{row.displayName}</span>
                <span className="tabular-nums text-sm text-[var(--bb-ink-soft)]">
                  {formatLeaderboardRank(row)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </GamePanelShell>
  );
}
