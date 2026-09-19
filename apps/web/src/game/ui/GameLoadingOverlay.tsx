import { useEffect, useState } from "react";

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
  const [showReload, setShowReload] = useState(false);

  useEffect(() => {
    if (clamped < 98) {
      setShowReload(false);
      return;
    }
    const id = window.setTimeout(() => setShowReload(true), 6000);
    return () => window.clearTimeout(id);
  }, [clamped]);

  return (
    <div
      className="bb-splash"
      data-ui-overlay
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading game assets"
    >
      <img className="bb-splash__art" src="/brand/splash.png" alt="" />
      <div className="bb-splash__veil" />
      <div className="bb-splash__panel">
        <p className="bb-splash__title">Loading</p>
        <p className="bb-splash__pct">{clamped}%</p>
        {statusLabel ? <p className="bb-splash__status">{statusLabel}</p> : null}
        <div className="bb-splash__bar">
          <div className="bb-splash__fill" style={{ width: `${clamped}%` }} />
        </div>
        {showReload ? (
          <div className="bb-splash__reload">
            <p>Taking longer than expected.</p>
            <button type="button" className="bb-btn-brass" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
