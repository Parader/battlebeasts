import { useEffect, useState } from "react";
import { BG_RESPAWN_MS, RESPAWN_LOCK_MS } from "@battlebeasts/shared";

type Props = {
  /** Epoch ms when local player hit 0 HP. */
  diedAt: number;
  /** Wait this long after death before showing the grey overlay (death clip length). */
  animDurationMs?: number;
  onRespawn: () => void;
  /** Arena mid-round: show death banner but no respawn button. */
  allowRespawn?: boolean;
  /** Battleground: server auto-revives. Show the countdown immediately. */
  autoRespawn?: boolean;
  /** Auto-respawn duration; defaults to battleground lock. */
  respawnMs?: number;
  /** Optional subtitle when respawn is disabled (e.g. Wave Assault). */
  fallenHint?: string;
  /** Local camera spectate (no server role change). */
  onSpectate?: () => void;
};

/**
 * After the death clip finishes: gray desaturate + "YOU DIE", then respawn panel.
 * Manual respawn unlock is `diedAt + RESPAWN_LOCK_MS`.
 * Battleground auto-respawn shows its own countdown as soon as death is known.
 */
export function DeathOverlay({
  diedAt,
  animDurationMs = 3000,
  onRespawn,
  allowRespawn = true,
  autoRespawn = false,
  respawnMs = BG_RESPAWN_MS,
  fallenHint,
  onSpectate,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [showBanner, setShowBanner] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const revealAt = autoRespawn ? diedAt : diedAt + Math.max(0, animDurationMs);
  const revealed = now >= revealAt;

  useEffect(() => {
    setShowBanner(false);
    setShowPanel(false);
    const tick = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(tick);
  }, [diedAt, animDurationMs, autoRespawn]);

  useEffect(() => {
    if (!revealed) {
      setShowBanner(false);
      setShowPanel(false);
      return;
    }
    setShowBanner(false);
    setShowPanel(false);
    const banner = window.setTimeout(() => setShowBanner(true), 40);
    const panel = window.setTimeout(() => setShowPanel(true), autoRespawn ? 80 : 900);
    return () => {
      window.clearTimeout(banner);
      window.clearTimeout(panel);
    };
  }, [revealed, diedAt, autoRespawn]);

  if (!revealed) return null;

  const unlockAt = autoRespawn ? diedAt + respawnMs : diedAt + RESPAWN_LOCK_MS;
  const leftSec = Math.max(0, Math.ceil((unlockAt - now) / 1000));
  const unlocked = now >= unlockAt;
  const showManualRespawn = allowRespawn && !autoRespawn;

  let sub: string;
  if (autoRespawn) {
    sub = unlocked ? "Returning to the fight…" : `Respawn in ${leftSec}s`;
  } else if (showManualRespawn) {
    sub = unlocked ? "Ready to return to the fight." : `Respawn in ${leftSec}s`;
  } else {
    sub = fallenHint ?? "Spectating until the round ends.";
  }

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
          <p className="bb-panel-sub">{sub}</p>
          {showManualRespawn ? (
            <button
              type="button"
              className="bb-btn-ink mt-4 w-full disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!unlocked}
              onClick={onRespawn}
            >
              {unlocked ? "Respawn" : `Respawn (${leftSec})`}
            </button>
          ) : null}
          {onSpectate ? (
            <button
              type="button"
              className="bb-btn-ink mt-4 w-full"
              onClick={onSpectate}
            >
              Spectate
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
