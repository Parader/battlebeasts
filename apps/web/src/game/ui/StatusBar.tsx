import { useEffect, useState, useRef, useCallback } from "react";
import { Room } from "colyseus.js";
import { STATUSES, type StatusDef } from "@battlebeasts/shared";

type StatusHudRow = {
  statusId: string;
  stacks: number;
  expiresAt: number;
  key: string;
};

function readStatuses(room: Room | null, sessionId: string | null): StatusHudRow[] {
  if (!room || !sessionId) return [];
  const player = room.state?.players?.get(sessionId) as
    | {
        statuses?: {
          forEach: (
            cb: (
              row: { statusId: string; stacks: number; expiresAt: number; sourceId?: string },
              key?: string,
            ) => void,
          ) => void;
        };
      }
    | undefined;
  const map = player?.statuses;
  if (!map) return [];
  const rows: StatusHudRow[] = [];
  map.forEach((row, key) => {
    if (row?.statusId) {
      rows.push({
        statusId: row.statusId,
        stacks: row.stacks ?? 1,
        expiresAt: row.expiresAt ?? 0,
        key: typeof key === "string" ? key : `${row.statusId}:${row.sourceId ?? ""}`,
      });
    }
  });
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

function describeStatus(def: StatusDef, row: StatusHudRow): string {
  const parts: string[] = [];
  if (def.moveMul !== undefined && def.moveMul !== 1) {
    const pct = Math.round((def.moveMul - 1) * 100);
    parts.push(pct > 0 ? `+${pct}% move speed` : `${pct}% move speed`);
  }
  if ((def as any).anticipationMul !== undefined && (def as any).anticipationMul !== 1) {
    const pct = Math.round(((def as any).anticipationMul - 1) * 100);
    parts.push(pct < 0 ? `${Math.abs(pct)}% faster cast windup` : `+${pct}% cast windup`);
  }
  if ((def as any).damageDealtMul !== undefined && (def as any).damageDealtMul !== 1) {
    const pct = Math.round(((def as any).damageDealtMul - 1) * 100);
    parts.push(`+${pct}% damage dealt`);
  }
  if ((def as any).damageTakenMul !== undefined && (def as any).damageTakenMul !== 1) {
    const pct = Math.round(((def as any).damageTakenMul - 1) * 100);
    parts.push(pct > 0 ? `+${pct}% damage taken` : `${pct}% damage taken`);
  }
  if (def.mechanic === "stun") parts.push("Stunned");
  if (def.mechanic === "root") parts.push("Rooted");
  if (def.mechanic === "silence") parts.push("Silenced");
  if (row.statusId === "frostChill") parts.push(`${row.stacks * 10}% slow`);
  if (row.statusId === "soulRelayLinked") {
    parts.push("Next direct hit heals for damage dealt");
  }
  if (row.statusId === "fifthSpellCadence") parts.push(`${row.stacks}/5 stacks`);
  if (parts.length === 0) {
    parts.push(def.polarity === "buff" ? "Buff" : "Debuff");
  }
  return parts.join(" · ");
}

function StatusTooltip({ def, row, now }: { def: StatusDef; row: StatusHudRow; now: number }) {
  const permanent = (def as any).permanent === true || def.durationMs <= 0;
  const left = permanent ? 0 : Math.max(0, row.expiresAt - now);
  return (
    <div
      className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[200px] -translate-x-1/2"
      style={{ fontFamily: "var(--bb-font-display)" }}
    >
      <div
        className="rounded px-2.5 py-1.5 shadow-lg"
        style={{
          background: "rgba(12, 12, 18, 0.94)",
          border: `1px solid ${def.color}88`,
          backdropFilter: "blur(6px)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-bold"
            style={{ color: def.color }}
          >
            {def.name}
          </span>
          <span
            className="text-[9px] font-semibold uppercase"
            style={{ color: def.polarity === "buff" ? "#86efac" : "#fca5a5" }}
          >
            {def.polarity}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] leading-tight text-[#d4cbb3]">
          {describeStatus(def, row)}
        </div>
        {!permanent && (
          <div className="mt-1 text-[9px] text-[#a09880]">
            {(left / 1000).toFixed(1)}s remaining
          </div>
        )}
      </div>
    </div>
  );
}

export function StatusBar({ room, sessionId }: { room: Room | null; sessionId: string | null }) {
  const [rows, setRows] = useState<StatusHudRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      setRows(readStatuses(room, sessionId));
    }, 100);
    return () => window.clearInterval(id);
  }, [room, sessionId]);

  const onEnter = useCallback((key: string) => setHoveredKey(key), []);
  const onLeave = useCallback(() => setHoveredKey(null), []);

  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[14.75rem] z-10 flex justify-center">
      <div className="bb-ability-tray !gap-1 !px-2 !py-1.5">
        {rows.map((row) => {
          const def = STATUSES[row.statusId];
          if (!def) return null;
          const permanent = (def as any).permanent === true || def.durationMs <= 0;
          const left = permanent ? 0 : Math.max(0, row.expiresAt - now);
          const total = Math.max(1, def.durationMs);
          const frac = permanent ? 0 : Math.min(1, left / total);
          const showStacks =
            row.statusId === "fifthSpellCadence" ||
            row.statusId === "soulMarked" ||
            row.statusId === "frostChill" ||
            row.stacks > 1;
          const hovered = hoveredKey === row.key;
          return (
            <div
              key={row.key}
              className="pointer-events-auto relative flex h-9 w-9 cursor-default flex-col items-center justify-center overflow-visible"
              style={{
                backgroundColor: `${def.color}44`,
                border: hovered
                  ? `1.5px solid ${def.color}`
                  : "1.5px solid var(--bb-brass-dim)",
                borderRadius: 3,
                fontFamily: "var(--bb-font-display)",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={() => onEnter(row.key)}
              onMouseLeave={onLeave}
            >
              <span
                className="text-[10px] font-bold drop-shadow"
                style={{
                  color: row.statusId === "soulRelayLinked" ? "#d1fae5" : "#f3e6c0",
                  fontSize: row.statusId === "soulRelayLinked" ? 14 : 10,
                  lineHeight: 1,
                }}
              >
                {row.statusId === "soulRelayLinked" ? "+" : def.tag}
              </span>
              {showStacks && (
                <span className="absolute right-0.5 top-0 text-[9px] font-bold text-[#f3e6c0]">
                  {row.stacks}
                </span>
              )}
              {!permanent && (
                <div
                  className="absolute bottom-0 left-0 h-0.5 bg-[#c9b27a]"
                  style={{ width: `${frac * 100}%` }}
                />
              )}
              {hovered && <StatusTooltip def={def} row={row} now={now} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
