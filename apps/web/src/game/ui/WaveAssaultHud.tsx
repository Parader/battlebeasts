import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import {
  PVE_RARITY_COLOR,
  PVE_RARITY_LABEL,
  type PveUpgradeRarity,
} from "@battlebeasts/shared";

type WaveHud = {
  wave: number;
  phase: string;
  alive: number;
  goal: number;
  label?: string;
};

type PvePick = {
  id: string;
  rarity: string;
  label: string;
  hint: string;
};

type Props = {
  hud: WaveHud | null;
  paused: boolean;
  resuming?: boolean;
  onTogglePause: () => void;
  onReturnHub: () => void;
  room: Room | null;
  localSessionId: string | null;
  friendlyFire: boolean;
  onToggleFriendlyFire: () => void;
  picks?: readonly PvePick[];
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

function teamName(rows: LiveRow[]): string {
  const names = rows.map((row) => row.name);
  if (names.length <= 1) return names[0] ?? "Team";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Wave Assault overlay — wave count, team score, selected buffs, pause / leave. */
export function WaveAssaultHud({
  hud,
  paused,
  resuming = false,
  onTogglePause,
  onReturnHub,
  room,
  localSessionId,
  friendlyFire,
  onToggleFriendlyFire,
  picks = [],
}: Props) {
  const [stats, setStats] = useState<LiveRow[]>(() => readLiveStats(room));
  const [buffsOpen, setBuffsOpen] = useState(false);

  useEffect(() => {
    const tick = () => setStats(readLiveStats(room));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [room]);

  const teamKills = stats.reduce((sum, row) => sum + row.kills, 0);
  const teamDamage = stats.reduce((sum, row) => sum + row.damageDealt, 0);
  const teamHeal = stats.reduce((sum, row) => sum + row.healing, 0);

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
        {resuming ? (
          <span className="text-sm text-[var(--bb-brass)]">Resuming</span>
        ) : paused ? (
          <span className="text-sm text-[var(--bb-brass)]">Paused</span>
        ) : null}
        <button type="button" className="bb-btn-ink" onClick={onTogglePause}>
          {resuming ? "Pause" : paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="bb-btn-ink"
          title={friendlyFire ? "Hunters can damage each other" : "Hunters cannot damage each other"}
          onClick={onToggleFriendlyFire}
        >
          FF {friendlyFire ? "On" : "Off"}
        </button>
        <button
          type="button"
          className={buffsOpen ? "bb-btn-brass" : "bb-btn-ink"}
          onClick={() => setBuffsOpen((open) => !open)}
        >
          Buffs{picks.length > 0 ? ` (${picks.length})` : ""}
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
                <th className="pr-3 font-normal">{stats.length > 1 ? "Team" : "Hunter"}</th>
                <th className="pr-3 font-normal">K</th>
                <th className="pr-3 font-normal">Dmg</th>
                <th className="font-normal">Heal</th>
              </tr>
            </thead>
            <tbody>
              <tr className={stats.some((row) => row.sessionId === localSessionId) ? "text-[var(--bb-brass)]" : ""}>
                <td className="max-w-[14rem] truncate py-0.5 pr-3">{teamName(stats)}</td>
                <td className="py-0.5 pr-3 tabular-nums">{teamKills}</td>
                <td className="py-0.5 pr-3 tabular-nums">{Math.round(teamDamage)}</td>
                <td className="py-0.5 tabular-nums">{Math.round(teamHeal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {buffsOpen ? (
        <div className="bb-panel pointer-events-auto max-h-[40vh] w-[min(22rem,92vw)] overflow-auto px-3 py-2">
          <p className="bb-section-label mb-2">Selected upgrades</p>
          {picks.length === 0 ? (
            <p className="bb-muted text-xs">No upgrades yet — slay packs to draft.</p>
          ) : (
            <ul className="space-y-1.5">
              {picks.map((pick, i) => {
                const rarity = (pick.rarity in PVE_RARITY_COLOR ? pick.rarity : "common") as PveUpgradeRarity;
                return (
                  <li key={`${pick.id}-${i}`} className="text-xs">
                    <span className="font-semibold" style={{ color: PVE_RARITY_COLOR[rarity] }}>
                      {PVE_RARITY_LABEL[rarity]}
                    </span>
                    <span className="ml-2 font-semibold text-[var(--bb-ink)]">{pick.label}</span>
                    <span className="mt-0.5 block text-[var(--bb-ink-soft)]">{pick.hint}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
