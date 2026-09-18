import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";

type WaveHud = {
  wave: number;
  phase: string;
  alive: number;
  goal: number;
  label?: string;
};

type Props = {
  hud: WaveHud | null;
  paused: boolean;
  onTogglePause: () => void;
  onReturnHub: () => void;
  room: Room | null;
  localSessionId: string | null;
  friendlyFire: boolean;
  onToggleFriendlyFire: () => void;
};

type LiveRow = {
  sessionId: string;
  name: string;
  kills: number;
  damageDealt: number;
  healing: number;
};

function readLiveStats(room: Room | null): LiveRow[] {
  const players = room?.state?.players as
    | Map<string, {
        displayName?: string;
        role?: string;
        statKills?: number;
        statDamageDealt?: number;
        statHealing?: number;
      }>
    | undefined;
  if (!players) return [];
  const rows: LiveRow[] = [];
  players.forEach((p, sessionId) => {
    if (p.role === "spectator") return;
    rows.push({
      sessionId,
      name: p.displayName || "Hunter",
      kills: Math.max(0, Math.round(p.statKills ?? 0)),
      damageDealt: Math.max(0, p.statDamageDealt ?? 0),
      healing: Math.max(0, p.statHealing ?? 0),
    });
  });
  rows.sort((a, b) => b.damageDealt - a.damageDealt);
  return rows;
}

/** Wave Assault overlay — wave count, live stats, pause / leave, friendly fire. */
export function WaveAssaultHud({
  hud,
  paused,
  onTogglePause,
  onReturnHub,
  room,
  localSessionId,
  friendlyFire,
  onToggleFriendlyFire,
}: Props) {
  const [stats, setStats] = useState<LiveRow[]>(() => readLiveStats(room));

  useEffect(() => {
    const tick = () => setStats(readLiveStats(room));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [room]);

  return (
    <div
      data-ui-overlay
      className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col items-center gap-2 px-3 pt-3"
    >
      <div className="bb-panel pointer-events-auto flex flex-wrap items-center justify-center gap-3 px-3 py-2">
                    <span className="text-sm font-semibold text-[var(--bb-ink)]" style={{ fontFamily: "var(--bb-font-display)" }}>
          {hud?.label
            ? hud.label
            : hud && hud.wave > 0
              ? `Wave ${hud.wave}`
              : "Wave Assault"}
        </span>
        {hud && (hud.phase === "fighting" || hud.phase === "exploring") ? (
          <span className="bb-meta tabular-nums">{hud.alive} alive</span>
        ) : null}
        {hud && hud.phase === "complete" ? <span className="bb-meta">Exit unlocked</span> : null}
        {hud && hud.phase === "intro" ? <span className="bb-meta">Get ready…</span> : null}
        {paused ? <span className="text-sm text-[var(--bb-brass)]">Paused</span> : null}
        <button type="button" className="bb-btn-ink" onClick={onTogglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="bb-btn-ink"
          title={friendlyFire ? "Hunters can damage each other" : "Hunters cannot damage each other"}
          onClick={onToggleFriendlyFire}
        >
          FF {friendlyFire ? "On" : "Off"}
        </button>
        <button type="button" className="bb-btn-ink" onClick={onReturnHub}>
          Leave
        </button>
      </div>
      {stats.length > 0 ? (
        <div className="bb-panel pointer-events-none px-3 py-2">
          <table className="text-left text-xs text-[var(--bb-ink)]">
            <thead className="bb-section-label">
              <tr>
                <th className="pr-3 font-normal">Hunter</th>
                <th className="pr-3 font-normal">K</th>
                <th className="pr-3 font-normal">Dmg</th>
                <th className="font-normal">Heal</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr
                  key={row.sessionId}
                  className={row.sessionId === localSessionId ? "text-[var(--bb-brass)]" : ""}
                >
                  <td className="max-w-[8rem] truncate py-0.5 pr-3">{row.name}</td>
                  <td className="py-0.5 pr-3 tabular-nums">{row.kills}</td>
                  <td className="py-0.5 pr-3 tabular-nums">{Math.round(row.damageDealt)}</td>
                  <td className="py-0.5 tabular-nums">{Math.round(row.healing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

