import type { Client } from "@colyseus/core";
import { matchMaker } from "@colyseus/core";
import { PVP_MODES, resolvePvpTransfer, type PvpModeId } from "@battlebeasts/shared";
import { randomUUID } from "node:crypto";

export type PvpQueueEntry = {
  key: string;
  client: Client;
  modes: string[];
  hubOwnerId: string | null;
  enqueuedAt: number;
};

/** Process-wide PvP queue — hubs are separate rooms, but matchmaking is global. */
const queue: PvpQueueEntry[] = [];
let matching = false;

function playersNeededForMode(modeId: string): number {
  const mode = PVP_MODES.find((m) => m.id === modeId);
  return Math.max(2, (mode?.teamSize ?? 1) * 2);
}

function sharedModes(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((m) => setB.has(m));
}

function pickMode(candidates: PvpQueueEntry[]): PvpModeId | null {
  const counts = new Map<string, number>();
  for (const entry of candidates) {
    for (const mode of entry.modes) {
      counts.set(mode, (counts.get(mode) ?? 0) + 1);
    }
  }

  let best: { id: string; count: number; need: number } | null = null;
  for (const [id, count] of counts) {
    if (count < 2) continue;
    const need = playersNeededForMode(id);
    if (!best || count > best.count || (count === best.count && need <= best.need)) {
      best = { id, count, need };
    }
  }

  if (!best || best.count < 2) return null;
  return (PVP_MODES.find((m) => m.id === best!.id)?.id ?? null) as PvpModeId | null;
}

async function tryMatch(): Promise<void> {
  if (matching || queue.length < 2) return;
  matching = true;

  try {
    for (let i = 0; i < queue.length; i++) {
      const seed = queue[i]!;
      const group = [seed];
      for (let j = 0; j < queue.length; j++) {
        if (j === i) continue;
        const other = queue[j]!;
        if (sharedModes(seed.modes, other.modes).length > 0) {
          group.push(other);
        }
      }

      const mode = pickMode(group);
      if (!mode) continue;

      const need = Math.min(playersNeededForMode(mode), group.length);
      const takeCount = Math.min(Math.max(2, need), group.length);
      if (takeCount < 2) continue;

      const matched = group.filter((e) => e.modes.includes(mode)).slice(0, takeCount);
      if (matched.length < 2) continue;

      const keys = new Set(matched.map((m) => m.key));
      for (let k = queue.length - 1; k >= 0; k--) {
        if (keys.has(queue[k]!.key)) queue.splice(k, 1);
      }

      const transfer = resolvePvpTransfer(mode);
      const matchId = randomUUID();

      // Create one room first so everyone joins the same instance
      const created = await matchMaker.createRoom(transfer.room, {
        matchId,
        mode: transfer.mode,
      });

      for (const entry of matched) {
        entry.client.send("queue_status", { queued: false });
        entry.client.send("toast", {
          message: `Match found — ${mode} (${matched.length} hunters)`,
        });
        entry.client.send("transfer", {
          room: transfer.room,
          roomId: created.roomId,
          options: {
            mode: transfer.mode,
            matchId,
            hubOwnerId: entry.hubOwnerId,
          },
        });
      }
      return;
    }
  } catch (err) {
    console.error("[pvpQueue] match failed", err);
  } finally {
    matching = false;
  }
}

export function enqueuePvp(entry: Omit<PvpQueueEntry, "enqueuedAt">): void {
  dequeuePvp(entry.key);
  queue.push({ ...entry, enqueuedAt: Date.now() });
  entry.client.send("queue_status", { queued: true, modes: entry.modes });
  entry.client.send("toast", {
    message: `Queued: ${entry.modes.join(", ")} — waiting for players`,
  });
  void tryMatch();
}

export function dequeuePvp(key: string): boolean {
  const idx = queue.findIndex((e) => e.key === key);
  if (idx < 0) return false;
  queue.splice(idx, 1);
  return true;
}

export function isQueued(key: string): boolean {
  return queue.some((e) => e.key === key);
}
