import { useEffect, useState } from "react";
import { RESPAWN_LOCK_MS } from "@battlebeasts/shared";

type Props = {
  /** Epoch ms when local player hit 0 HP. */
  diedAt: number;
  /** Wait this long after death before showing the grey overlay (death clip length). */
  animDurationMs?: number;
  onRespawn: () => void;
  /** Arena mid-round: show death banner but no respawn button. */
  allowRespawn?: boolean;
  /** Optional subtitle when respawn is disabled (e.g. Wave Assault). */
  fallenHint?: string;
};

/**
 * After the death clip finishes: gray desaturate + "YOU DIE", then respawn panel.
 * Respawn unlock is measured from death (`diedAt + RESPAWN_LOCK_MS`).
 */
export function DeathOverlay({
  diedAt,
  animDurationMs = 3000,
  onRespawn,
  allowRespawn = true,
  fallenHint,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [showBanner, setShowBanner] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const revealAt = diedAt + Math.max(0, animDurationMs);
  const revealed = now >= revealAt;

  useEffect(() => {
    setShowBanner(false);
    setShowPanel(false);
    const tick = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(tick);
  }, [diedAt, animDurationMs]);

  useEffect(() => {
    if (!revealed) {
      setShowBanner(false);
      setShowPanel(false);
      return;
    }
    setShowBanner(false);
    setShowPanel(false);
    const banner = window.setTimeout(() => setShowBanner(true), 40);
    const panel = window.setTimeout(() => setShowPanel(true), 900);
    return () => {
      window.clearTimeout(banner);
      window.clearTimeout(panel);
    };
  }, [revealed, diedAt]);

  if (!revealed) return null;

  const unlockAt = diedAt + RESPAWN_LOCK_MS;
  const leftSec = Math.max(0, Math.ceil((unlockAt - now) / 1000));
  const unlocked = now >= unlockAt;

  return (
    <div
      data-ui-overlay
      className="bb-death-overlay pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center"
    >
      <div className="bb-death-overlay__veil" aria-hidden />
      <p
        className={[
          "bb-death-overlay__banner",
          showBanner ? "bb-death-overlay__banner--in" : "",
        ].join(" ")}
      >
        YOU DIE
      </p>
      {showPanel ? (
        <div className="bb-death-overlay__panel bb-parchment px-5 py-4">
          <p className="bb-panel-title !text-lg">Fallen</p>
          <p className="bb-panel-sub">
            {allowRespawn
              ? unlocked
                ? "Ready to return to the fight."
                : `Respawn in ${leftSec}s`
              : fallenHint ?? "Spectating until the round ends."}
          </p>
          {allowRespawn ? (
            <button
              type="button"
              className="bb-btn-ink mt-4 w-full disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!unlocked}
              onClick={onRespawn}
            >
              {unlocked ? "Respawn" : `Respawn (${leftSec})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
