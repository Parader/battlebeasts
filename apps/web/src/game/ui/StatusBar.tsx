import { useEffect, useState } from "react";
import { Room } from "colyseus.js";
import { STATUSES } from "@battlebeasts/shared";

type StatusHudRow = {
  statusId: string;
  stacks: number;
  expiresAt: number;
};

function readStatuses(room: Room | null, sessionId: string | null): StatusHudRow[] {
  if (!room || !sessionId) return [];
  const player = room.state?.players?.get(sessionId) as
    | {
        statuses?: {
          forEach: (cb: (row: { statusId: string; stacks: number; expiresAt: number }) => void) => void;
        };
      }
    | undefined;
  const map = player?.statuses;
  if (!map) return [];
  const rows: StatusHudRow[] = [];
  map.forEach((row) => {
    if (row?.statusId) {
      rows.push({
        statusId: row.statusId,
        stacks: row.stacks ?? 1,
        expiresAt: row.expiresAt ?? 0,
      });
    }
  });
  rows.sort((a, b) => a.statusId.localeCompare(b.statusId));
  return rows;
}

export function StatusBar({ room, sessionId }: { room: Room | null; sessionId: string | null }) {
  const [rows, setRows] = useState<StatusHudRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      setRows(readStatuses(room, sessionId));
    }, 100);
    return () => window.clearInterval(id);
  }, [room, sessionId]);

  if (rows.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-36 z-20 flex justify-center">
      <div className="bb-ability-tray !gap-1 !px-2 !py-1.5">
        {rows.map((row) => {
          const def = STATUSES[row.statusId];
          if (!def) return null;
          const left = Math.max(0, row.expiresAt - now);
          const total = Math.max(1, def.durationMs);
          const frac = Math.min(1, left / total);
          return (
            <div
              key={row.statusId}
              className="relative flex h-9 w-9 flex-col items-center justify-center overflow-hidden"
              style={{
                backgroundColor: `${def.color}44`,
                border: "1.5px solid var(--bb-brass-dim)",
                borderRadius: 3,
                fontFamily: "var(--bb-font-display)",
              }}
              title={`${def.name}${row.stacks > 1 ? ` x${row.stacks}` : ""}`}
            >
              <span className="text-[10px] font-bold text-[#f3e6c0] drop-shadow">{def.tag}</span>
              {row.stacks > 1 && (
                <span className="absolute right-0.5 top-0 text-[9px] font-bold text-[#f3e6c0]">
                  {row.stacks}
                </span>
              )}
              <div
                className="absolute bottom-0 left-0 h-0.5 bg-[#c9b27a]"
                style={{ width: `${frac * 100}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
