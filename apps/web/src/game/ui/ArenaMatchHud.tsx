import { useEffect, useState } from "react";
import type { ArenaHudState } from "@/game/useBaseCityRoom";

type Props = {
  hud: ArenaHudState;
};

function phaseLabel(phase: string, round: number): string {
  switch (phase) {
    case "countdown":
      return `Round ${round}`;
    case "fighting":
      return `Round ${round}`;
    case "round_end":
      return "Round over";
    case "match_end":
    case "rematch_wait":
      return "Match over";
    default:
      return phase;
  }
}

/** Top-center arena score + large round / countdown banners. */
export function ArenaMatchHud({ hud }: Props) {
  const [leftSec, setLeftSec] = useState(0);

  useEffect(() => {
    const tick = () => {
      if (!hud.phaseEndsAt) {
        setLeftSec(0);
        return;
      }
      setLeftSec(Math.max(0, Math.ceil((hud.phaseEndsAt - Date.now()) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [hud.phaseEndsAt, hud.matchPhase]);

  const isCountdown = hud.matchPhase === "countdown";
  const isRoundEnd = hud.matchPhase === "round_end";
  const showBigTimer = (isCountdown || isRoundEnd) && leftSec > 0;
  const label = phaseLabel(hud.matchPhase, hud.matchRound);

  return (
    <div data-ui-overlay className="pointer-events-none absolute inset-0 z-25">
      <div className="absolute inset-x-0 top-16 flex justify-center">
        <div className="bb-parchment px-5 py-3 text-center">
          <p className="bb-section-label mb-1">{hud.matchMode || "Arena"}</p>
          <p
            className="text-2xl tabular-nums text-[var(--bb-ink)]"
            style={{ fontFamily: "var(--bb-font-display)" }}
          >
            <span className={hud.localTeam === "a" ? "text-[var(--bb-brass)]" : ""}>
              {hud.scoreA}
            </span>
            <span className="mx-2 text-[var(--bb-ink-soft)]">–</span>
            <span className={hud.localTeam === "b" ? "text-[var(--bb-brass)]" : ""}>
              {hud.scoreB}
            </span>
            {typeof hud.scoreC === "number" ? (
              <>
                <span className="mx-2 text-[var(--bb-ink-soft)]">–</span>
                <span className={hud.localTeam === "c" ? "text-[var(--bb-brass)]" : ""}>
                  {hud.scoreC}
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {showBigTimer && (
        <div className="absolute inset-x-0 top-[28%] flex flex-col items-center px-4 text-center">
          <p className="bb-arena-banner__label">{label}</p>
          {isCountdown ? (
            <>
              <p className="bb-arena-banner__sub">Get ready</p>
              <p key={leftSec} className="bb-arena-banner__timer">
                {leftSec}
              </p>
            </>
          ) : (
            <p key={leftSec} className="bb-arena-banner__timer">
              {leftSec}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
