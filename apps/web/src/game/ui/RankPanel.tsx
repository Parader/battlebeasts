import { useEffect, useMemo, useState } from "react";
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
  partyKey: string;
  memberIds: string[];
  displayName: string;
  wave: number;
  kills: number;
  damageDealt: number;
  partySize: number;
  rank: number;
};

type PartyFilter = 0 | 1 | 2 | 3 | 4;

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

function rowIncludesUser(row: HubPveLeaderboardRow, userId: string | null | undefined) {
  if (!userId) return false;
  if (row.memberIds.includes(userId)) return true;
  return row.partyKey === userId;
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
  const [partyFilter, setPartyFilter] = useState<PartyFilter>(0);

  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

  const filteredPve = useMemo(() => {
    const src =
      partyFilter === 0
        ? pveLeaderboard
        : pveLeaderboard.filter((row) => row.partySize === partyFilter);
    return src.map((row, i) => ({ ...row, rank: i + 1 }));
  }, [pveLeaderboard, partyFilter]);

  const filteredMine = useMemo(() => {
    return filteredPve.find((row) => rowIncludesUser(row, localUserId)) ?? null;
  }, [filteredPve, localUserId]);

  if (!open) return null;

  const snap = rating ? normalizeRankSnapshot(rating) : null;
  const display =
    (snap ? formatRankLabel(snap) : null) ??
    label ??
    "Unranked";
  const shownBest = filteredMine ?? (partyFilter === 0 ? pveBest : null);

  return (
    <GamePanelShell
      title={board === "ranked" ? "Ranked" : "Wave Assault"}
      subtitle={
        board === "ranked"
          ? season
            ? `Season · ${season.slug}`
            : "No active season"
          : "Highest team wave"
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
          <div className="flex flex-wrap gap-2">
            {([0, 1, 2, 3, 4] as const).map((size) => (
              <button
                key={size}
                type="button"
                className={partyFilter === size ? "bb-btn-brass" : "bb-btn-ink"}
                onClick={() => setPartyFilter(size)}
              >
                {size === 0 ? "All" : partyLabel(size)}
              </button>
            ))}
          </div>

          <div className="bb-list-row bb-list-row--stack">
            {shownBest ? (
              <>
                <p className="bb-panel-title !text-2xl">#{shownBest.rank}</p>
                <p className="bb-meta tabular-nums">
                  {pveScore(shownBest)} · {partyLabel(shownBest.partySize)}
                </p>
                <p className="bb-muted truncate">{shownBest.displayName}</p>
              </>
            ) : (
              <>
                <p className="bb-panel-title !text-2xl">Unranked</p>
                <p className="bb-muted">
                  {partyFilter === 0
                    ? "Survive a Wave Assault run to place on the board."
                    : `No ${partyLabel(partyFilter).toLowerCase()} runs on the board yet.`}
                </p>
              </>
            )}
          </div>

          <div className="max-h-80 space-y-1 overflow-auto">
            {filteredPve.length === 0 ? (
              <p className="bb-muted">Leaderboard empty — be the first.</p>
            ) : (
              filteredPve.map((row) => (
                <div
                  key={row.partyKey}
                  className={[
                    "bb-list-row flex items-center justify-between gap-2",
                    rowIncludesUser(row, localUserId)
                      ? "bg-[color-mix(in_srgb,var(--bb-brass)_12%,transparent)]"
                      : "",
                  ].join(" ")}
                >
                  <span className="tabular-nums text-[var(--bb-ink-soft)]">#{row.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--bb-ink)]">{row.displayName}</span>
                    <span className="block text-[10px] uppercase tracking-wide text-[var(--bb-ink-soft)]">
                      {partyLabel(row.partySize)}
                    </span>
                  </span>
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
