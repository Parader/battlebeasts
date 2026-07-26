type Props = {
  /** 0–100 asset download/compile progress */
  percent: number;
  /** Room connection / auth status line */
  statusLabel?: string;
};

/**
 * Full-screen gate while critical GLBs/textures (and room) prepare.
 */
export function GameLoadingOverlay({ percent, statusLabel }: Props) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      className="bb-overlay-dim absolute inset-0 z-50 flex items-center justify-center p-4"
      data-ui-overlay
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading game assets"
    >
      <div className="bb-parchment bb-book-panel w-full max-w-sm text-center">
        <p className="bb-panel-title">Loading</p>
        <p
          className="mt-4 tabular-nums text-3xl text-[var(--bb-ink)]"
          style={{ fontFamily: "var(--bb-font-display)" }}
        >
          {clamped}%
        </p>
        {statusLabel ? <p className="bb-panel-sub mt-2">{statusLabel}</p> : null}
        <div className="mt-5 h-1.5 overflow-hidden rounded-sm border border-[var(--bb-panel-line)] bg-[rgba(6,18,32,0.9)]">
          <div
            className="h-full rounded-sm bg-[var(--bb-brass)] transition-[width] duration-200 ease-out"
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
    </div>
  );
}
