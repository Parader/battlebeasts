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

export type HubPveLeaderboardRow = {
  userId: string;
  displayName: string;
  wave: number;
  kills: number;
  damageDealt: number;
  partySize: number;
  rank: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  localUserId?: string | null;
  season: HubRankedSeason | null;
  rating: RankSnapshot | null;
  label: string | null;
  leaderboard: HubLeaderboardRow[];
  pveLeaderboard: HubPveLeaderboardRow[];
  pveBest: HubPveLeaderboardRow | null;
  onRefresh: () => void;
};

function partyLabel(size: number) {
  return size <= 1 ? "Solo" : `${size} hunters`;
}

function pveScore(row: HubPveLeaderboardRow) {
  return `Wave ${row.wave} · ${row.kills} kills`;
}

/** Hub ranked + Wave Assault ladders. */
export function RankPanel({
  open,
  onClose,
  localUserId,
  season,
  rating,
  label,
  leaderboard,
  pveLeaderboard,
  pveBest,
  onRefresh,
}: Props) {
  const [board, setBoard] = useState<"ranked" | "pve">("ranked");
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
      title={board === "ranked" ? "Ranked" : "Wave Assault"}
      subtitle={
        board === "ranked"
          ? season
            ? `Season · ${season.slug}`
            : "No active season"
          : "Highest wave"
      }
      onClose={onClose}
      maxHeightClass="max-h-[min(80dvh,640px)]"
    >
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={board === "ranked" ? "bb-btn-brass" : "bb-btn-ink"}
          onClick={() => setBoard("ranked")}
        >
          Ranked
        </button>
        <button
          type="button"
          className={board === "pve" ? "bb-btn-brass" : "bb-btn-ink"}
          onClick={() => setBoard("pve")}
        >
          Wave Assault
        </button>
      </div>

      {board === "ranked" ? (
        <>
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
                  <div
                    key={row.userId}
                    className={[
                      "bb-list-row flex items-center justify-between gap-2",
                      row.userId === localUserId
                        ? "bg-[color-mix(in_srgb,var(--bb-brass)_12%,transparent)]"
                        : "",
                    ].join(" ")}
                  >
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
        </>
      ) : (
        <div className="space-y-4">
          <div className="bb-list-row bb-list-row--stack">
            {pveBest ? (
              <>
                <p className="bb-panel-title !text-2xl">#{pveBest.rank}</p>
                <p className="bb-meta tabular-nums">
                  {pveScore(pveBest)} · {partyLabel(pveBest.partySize)}
                </p>
              </>
            ) : (
              <>
                <p className="bb-panel-title !text-2xl">Unranked</p>
                <p className="bb-muted">Survive a Wave Assault run to place on the board.</p>
              </>
            )}
          </div>

          <div className="max-h-80 space-y-1 overflow-auto">
            {pveLeaderboard.length === 0 ? (
              <p className="bb-muted">Leaderboard empty — be the first.</p>
            ) : (
              pveLeaderboard.map((row) => (
                <div
                  key={row.userId}
                  className={[
                    "bb-list-row flex items-center justify-between gap-2",
                    row.userId === localUserId
                      ? "bg-[color-mix(in_srgb,var(--bb-brass)_12%,transparent)]"
                      : "",
                  ].join(" ")}
                >
                  <span className="tabular-nums text-[var(--bb-ink-soft)]">#{row.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--bb-ink)]">{row.displayName}</span>
                  <span className="shrink-0 text-right tabular-nums text-sm text-[var(--bb-ink-soft)]">
                    {pveScore(row)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </GamePanelShell>
  );
}
