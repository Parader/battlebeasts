import { useEffect, useState } from "react";

type Props = {
  until: number;
  onResume: () => void;
  onHold: () => void;
};

function remainingSeconds(until: number): number {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/** Full-screen Wave Assault / Dungeon pause — hold, then a 3-2-1 resume. */
export function PvePauseOverlay({ until, onResume, onHold }: Props) {
  const counting = until > Date.now();
  const [left, setLeft] = useState(() => remainingSeconds(until));

  useEffect(() => {
    if (!counting) {
      setLeft(0);
      return;
    }
    setLeft(remainingSeconds(until));
    const id = window.setInterval(() => setLeft(remainingSeconds(until)), 100);
    return () => window.clearInterval(id);
  }, [until, counting]);

  return (
    <div
      data-ui-overlay
      className="bb-overlay-dim pointer-events-auto absolute inset-0 z-[45] flex items-center justify-center p-6"
    >
      <div className="bb-parchment bb-panel max-w-lg px-10 py-8 text-center">
        {counting ? (
          <>
            <p className="bb-panel-title !text-3xl">Get ready</p>
            <p
              className="mt-4 font-semibold tabular-nums text-[var(--bb-brass)]"
              style={{ fontFamily: "var(--bb-font-display)", fontSize: "5.5rem", lineHeight: 1 }}
            >
              {Math.max(1, left)}
            </p>
            <p className="bb-panel-sub">Encounter resumes</p>
            <button type="button" className="bb-btn-ink mt-6" onClick={onHold}>
              Stay paused
            </button>
          </>
        ) : (
          <>
            <p className="bb-panel-title !text-4xl">Paused</p>
            <p className="bb-panel-sub">Cooldowns and the encounter are frozen.</p>
            <button type="button" className="bb-btn-brass mt-6" onClick={onResume}>
              Resume
            </button>
          </>
        )}
      </div>
    </div>
  );
}
