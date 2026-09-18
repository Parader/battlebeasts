import type { MatchRecapRow } from "@battlebeasts/shared";

type Props = {
  kills: number;
  wave: number;
  bestKills: number;
  isNewBest: boolean;
  retryReady: boolean;
  onRetry: () => void;
  onReturnHub: () => void;
  rows?: MatchRecapRow[];
  localSessionId?: string | null;
  victory?: boolean;
  chestQuality?: string | null;
  instance?: boolean;
};

/** Wave Assault / Dungeon run recap — retry or return to village. */
export function WaveRunRecapPanel({
  kills,
  wave,
  bestKills,
  isNewBest,
  retryReady,
  onRetry,
  onReturnHub,
  rows = [],
  localSessionId = null,
  victory = false,
  chestQuality = null,
  instance = false,
}: Props) {
  const ranked = [...rows].sort((a, b) => b.damageDealt - a.damageDealt);

  return (
    <div
      data-ui-overlay
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
    >
      <div className="bb-parchment pointer-events-auto w-full max-w-md px-5 py-5">
        <p className="bb-panel-title !text-2xl">
          {instance ? (victory ? "Dungeon cleared" : "Run over") : "Run over"}
        </p>
        <p className="bb-panel-sub">
          {instance
            ? victory
              ? "The exit is open. The party made it out."
              : "All hunters have fallen."
            : "All hunters have fallen."}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bb-panel px-3 py-3 text-center">
            <p className="bb-meta">{instance ? "Progress" : "Wave reached"}</p>
            <p
              className="text-2xl font-semibold tabular-nums text-[var(--bb-ink)]"
              style={{ fontFamily: "var(--bb-font-display)" }}
            >
              {wave}
            </p>
          </div>
          <div className="bb-panel px-3 py-3 text-center">
            <p className="bb-meta">Kills</p>
            <p
              className="text-2xl font-semibold tabular-nums text-[var(--bb-ink)]"
              style={{ fontFamily: "var(--bb-font-display)" }}
            >
              {kills}
            </p>
          </div>
        </div>

        {ranked.length > 0 ? (
          <div className="mt-4 max-h-40 overflow-auto">
            <table className="w-full text-left text-sm text-[var(--bb-ink)]">
              <thead className="bb-section-label">
                <tr>
                  <th className="pb-2 font-normal">Hunter</th>
                  <th className="pb-2 font-normal">K</th>
                  <th className="pb-2 font-normal">Dmg</th>
                  <th className="pb-2 font-normal">Heal</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr
                    key={row.sessionId}
                    className={[
                      "border-t border-[var(--bb-panel-line)]",
                      row.sessionId === localSessionId
                        ? "bg-[color-mix(in_srgb,var(--bb-brass)_12%,transparent)]"
                        : "",
                    ].join(" ")}
                  >
                    <td className="max-w-[8rem] truncate py-1.5 pr-2">{row.displayName}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{row.kills}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{Math.round(row.damageDealt)}</td>
                    <td className="py-1.5 tabular-nums">{Math.round(row.healing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {chestQuality ? (
          <p className="bb-meta mt-3 text-center">
            Run chest: <span className="text-[var(--bb-brass)]">{chestQuality}</span>
          </p>
        ) : null}

        {instance ? null : (
        <p className="bb-meta mt-3 text-center">
          Best run: <span className="tabular-nums text-[var(--bb-ink)]">{bestKills}</span> kills
          {isNewBest ? (
            <span className="ml-2 text-[var(--bb-brass)]">New best!</span>
          ) : null}
        </p>
        )}

        <footer className="bb-panel-footer mt-4 justify-end gap-2">
          <button
            type="button"
            className="bb-btn-brass disabled:cursor-not-allowed disabled:opacity-50"
            disabled={retryReady}
            onClick={onRetry}
          >
            {retryReady ? "Restarting…" : "Retry"}
          </button>
          <button type="button" className="bb-btn-ink" onClick={onReturnHub}>
            Village
          </button>
        </footer>
      </div>
    </div>
  );
}
