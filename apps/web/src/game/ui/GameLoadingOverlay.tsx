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
      <div className="bb-parchment bb-book-panel w-full max-w-sm px-6 py-8 text-center">
        <p
          className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--bb-ink)]"
          style={{ fontFamily: "var(--bb-font-display)" }}
        >
          Loading
        </p>
        <div className="bb-brass-rule mx-auto my-4 max-w-[12rem]" />
        <p className="tabular-nums text-2xl text-[var(--bb-ink)]" style={{ fontFamily: "var(--bb-font-display)" }}>
          {clamped}%
        </p>
        {statusLabel ? (
          <p className="mt-3 text-xs uppercase tracking-wide text-[var(--bb-ink-soft)]">{statusLabel}</p>
        ) : null}
        <div className="mt-5 h-1.5 overflow-hidden rounded-sm bg-[rgba(26,34,28,0.12)]">
          <div
            className="h-full rounded-sm bg-[var(--bb-brass)] transition-[width] duration-200 ease-out"
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
    </div>
  );
}
