type Props = {
  kills: number;
  wave: number;
  bestKills: number;
  isNewBest: boolean;
  retryReady: boolean;
  onRetry: () => void;
  onReturnHub: () => void;
};

/** Wave Assault wipe — kills + best run, retry or return to village. */
export function WaveRunRecapPanel({
  kills,
  wave,
  bestKills,
  isNewBest,
  retryReady,
  onRetry,
  onReturnHub,
}: Props) {
  return (
    <div
      data-ui-overlay
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
    >
      <div className="bb-parchment pointer-events-auto w-full max-w-md px-5 py-5">
        <p className="bb-panel-title !text-2xl">Run over</p>
        <p className="bb-panel-sub">All hunters have fallen.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bb-panel px-3 py-3 text-center">
            <p className="bb-meta">Wave reached</p>
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

        <p className="bb-meta mt-3 text-center">
          Best run: <span className="tabular-nums text-[var(--bb-ink)]">{bestKills}</span> kills
          {isNewBest ? (
            <span className="ml-2 text-[var(--bb-brass)]">New best!</span>
          ) : null}
        </p>

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
