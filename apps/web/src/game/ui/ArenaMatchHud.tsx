import { useEffect, useState } from "react";
import {
  BG_CTF_CAPTURES_TO_WIN,
  BG_DOMINATION_SCORE_TO_WIN,
  BG_KOTH_SCORE_TO_WIN,
  pvpModeById,
} from "@battlebeasts/shared";
import type { ArenaHudState, ArenaObjectiveHud } from "@/game/useBaseCityRoom";

type Props = {
  hud: ArenaHudState;
};

function phaseLabel(phase: string, round: number, battleground: boolean): string {
  if (battleground) {
    switch (phase) {
      case "countdown":
        return "Battleground";
      case "fighting":
        return "Fight";
      case "round_end":
        return "Round over";
      case "match_end":
      case "rematch_wait":
        return "Match over";
      default:
        return phase;
    }
  }
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

function formatClock(endsAt: number): string {
  if (!endsAt) return "";
  const sec = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function scoreCap(kind: string): number | null {
  if (kind === "ctf") return BG_CTF_CAPTURES_TO_WIN;
  if (kind === "koth") return BG_KOTH_SCORE_TO_WIN;
  if (kind === "domination") return BG_DOMINATION_SCORE_TO_WIN;
  return null;
}

function flagStatus(row: ArenaObjectiveHud): string {
  if (row.flagState === "carried") {
    return row.carrierName ? `Carried by ${row.carrierName}` : "Carried";
  }
  if (row.flagState === "dropped") return "Dropped";
  return "Home";
}

function pointStatus(row: ArenaObjectiveHud): string {
  if (row.contest === "contested") return "Contested";
  if (row.owner === "a") return "Team A";
  if (row.owner === "b") return "Team B";
  if (row.contest === "a" || row.contest === "b") {
    return `Capturing ${Math.round(row.progress * 100)}%`;
  }
  return "Neutral";
}

function pointLabel(row: ArenaObjectiveHud, kind: string): string {
  if (kind === "koth") return "Hill";
  if (row.id === "dom_mid") return "Mid";
  if (row.id === "dom_a") return "A";
  if (row.id === "dom_b") return "B";
  return row.id || "Point";
}

/** Top-center arena score + large round / countdown banners. */
export function ArenaMatchHud({ hud }: Props) {
  const [leftSec, setLeftSec] = useState(0);
  const [clock, setClock] = useState("");

  const battleground = Boolean(hud.objectiveKind) || hud.matchMode.startsWith("bg_");

  useEffect(() => {
    const tick = () => {
      if (!hud.phaseEndsAt) {
        setLeftSec(0);
      } else {
        setLeftSec(Math.max(0, Math.ceil((hud.phaseEndsAt - Date.now()) / 1000)));
      }
      setClock(hud.matchEndsAt > 0 ? formatClock(hud.matchEndsAt) : "");
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [hud.phaseEndsAt, hud.matchPhase, hud.matchEndsAt]);

  const isCountdown = hud.matchPhase === "countdown";
  const isRoundEnd = hud.matchPhase === "round_end";
  const showBigTimer = (isCountdown || isRoundEnd) && leftSec > 0;
  const label = phaseLabel(hud.matchPhase, hud.matchRound, battleground);
  const modeLabel = pvpModeById(hud.matchMode)?.label ?? hud.matchMode ?? "Arena";
  const cap = scoreCap(hud.objectiveKind);
  const flags = hud.objectives.filter((o) => o.tag === "flag_stand");
  const points = hud.objectives.filter((o) => o.tag === "capture_point");
  const showClock =
    battleground &&
    (hud.matchPhase === "fighting" || hud.matchPhase === "countdown") &&
    Boolean(clock);

  return (
    <div data-ui-overlay className="pointer-events-none absolute inset-0 z-25">
      <div className="absolute inset-x-0 top-16 flex justify-center">
        <div className="bb-parchment px-5 py-3 text-center">
          <p className="bb-section-label mb-1">{modeLabel}</p>
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
          {battleground ? (
            <p className="bb-meta mt-1 tabular-nums">
              {showClock ? clock : null}
              {showClock && cap != null ? " · " : null}
              {cap != null ? `First to ${cap}` : null}
            </p>
          ) : null}
          {hud.objectiveKind === "ctf" && flags.length > 0 ? (
            <div className="bb-meta mt-1 space-y-0.5">
              {flags.map((row) => (
                <p key={row.id}>
                  {row.team === "a" ? "A" : "B"} flag — {flagStatus(row)}
                </p>
              ))}
            </div>
          ) : null}
          {(hud.objectiveKind === "koth" || hud.objectiveKind === "domination") &&
          points.length > 0 ? (
            <div className="bb-meta mt-1 space-y-0.5">
              {points.map((row) => (
                <p key={row.id}>
                  {pointLabel(row, hud.objectiveKind)} — {pointStatus(row)}
                </p>
              ))}
            </div>
          ) : null}
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
