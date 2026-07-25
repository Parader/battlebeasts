import type { Client } from "@colyseus/core";
import { matchMaker } from "@colyseus/core";
import { PVP_MODES, resolvePvpTransfer, type PvpModeId, type PvpSeat } from "@battlebeasts/shared";
import { randomUUID } from "node:crypto";

export type PvpPartyMember = {
  /** Unique per (room, session) — used for dequeueing on disconnect / queue_cancel. */
  key: string;
  client: Client;
  userId: string;
  seat: PvpSeat;
  hubOwnerId: string | null;
};

export type PvpQueueEntry = {
  partyId: string;
  modes: string[];
  members: PvpPartyMember[];
  enqueuedAt: number;
};

/** Process-wide PvP queue — hubs are separate rooms, but matchmaking is global. */
const queue: PvpQueueEntry[] = [];
let matching = false;

function modeConfig(modeId: string) {
  return PVP_MODES.find((m) => m.id === modeId);
}

function teamSizeForMode(modeId: string): number {
  return modeConfig(modeId)?.teamSize ?? 1;
}

function maxSpectatorsForMode(modeId: string): number {
  return modeConfig(modeId)?.maxSpectators ?? 0;
}

function fighterCount(entry: PvpQueueEntry): number {
  return entry.members.filter((m) => m.seat !== "spectator").length;
}

function spectatorCount(entry: PvpQueueEntry): number {
  return entry.members.filter((m) => m.seat === "spectator").length;
}

/**
 * Pack whole parties until fighter count equals teamSize*2.
 * Solo parties that all default to teamA still match — seats are reassigned in createMatch.
 */
function selectEntriesForMode(modeId: string): PvpQueueEntry[] | null {
  const teamSize = teamSizeForMode(modeId);
  const need = teamSize * 2;
  const maxSpectators = maxSpectatorsForMode(modeId);
  const candidates = queue
    .filter((e) => e.modes.includes(modeId))
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  const selected: PvpQueueEntry[] = [];
  let fighters = 0;

  for (const entry of candidates) {
    const n = fighterCount(entry);
    if (n === 0) continue;
    if (fighters + n > need) continue;
    selected.push(entry);
    fighters += n;
    if (fighters === need) break;
  }

  if (fighters !== need) return null;

  let spectatorSlots = maxSpectators;
  for (const entry of candidates) {
    if (selected.includes(entry)) continue;
    if (fighterCount(entry) > 0) continue;
    const specs = spectatorCount(entry);
    if (specs === 0 || specs > spectatorSlots) continue;
    selected.push(entry);
    spectatorSlots -= specs;
  }

  return selected;
}

/**
 * Assign sides for a match. Multi-fighter parties stay together on one side when they fit;
 * leftover solos fill empty slots. Explicit teamA/teamB seats are preferred when packing
 * a single pre-balanced party, otherwise seats are remapped.
 */
function assignTeams(
  selected: PvpQueueEntry[],
  teamSize: number,
): Map<string, { team: "a" | "b" | ""; role: "fighter" | "spectator"; spawnSlot: number }> {
  const out = new Map<string, { team: "a" | "b" | ""; role: "fighter" | "spectator"; spawnSlot: number }>();
  let slotA = 0;
  let slotB = 0;
  let slotSpec = 0;

  const placeFighter = (member: PvpPartyMember, team: "a" | "b") => {
    const spawnSlot = team === "a" ? slotA++ : slotB++;
    out.set(member.key, { team, role: "fighter", spawnSlot });
  };

  // Single party that already has both sides filled — honor seats.
  if (selected.length === 1) {
    const entry = selected[0]!;
    let a = 0;
    let b = 0;
    for (const member of entry.members) {
      if (member.seat === "spectator") {
        out.set(member.key, { team: "", role: "spectator", spawnSlot: slotSpec++ });
        continue;
      }
      const preferB = member.seat === "teamB";
      if (preferB && b < teamSize) {
        placeFighter(member, "b");
        b++;
      } else if (!preferB && a < teamSize) {
        placeFighter(member, "a");
        a++;
      } else if (a < teamSize) {
        placeFighter(member, "a");
        a++;
      } else {
        placeFighter(member, "b");
        b++;
      }
    }
    return out;
  }

  // Multi-party: keep each party on one side, fill A then B.
  for (const entry of selected) {
    const fighters = entry.members.filter((m) => m.seat !== "spectator");
    const specs = entry.members.filter((m) => m.seat === "spectator");
    for (const member of specs) {
      out.set(member.key, { team: "", role: "spectator", spawnSlot: slotSpec++ });
    }
    if (fighters.length === 0) continue;

    const roomA = teamSize - slotA;
    const roomB = teamSize - slotB;
    let team: "a" | "b";
    if (fighters.length <= roomA && (roomA >= roomB || fighters.length > roomB)) {
      team = "a";
    } else if (fighters.length <= roomB) {
      team = "b";
    } else if (fighters.length <= roomA) {
      team = "a";
    } else {
      // Split only if a party is larger than a side (shouldn't happen for valid locks).
      for (const member of fighters) {
        if (slotA < teamSize) placeFighter(member, "a");
        else placeFighter(member, "b");
      }
      continue;
    }
    for (const member of fighters) placeFighter(member, team);
  }

  return out;
}

async function createMatch(modeId: PvpModeId, selected: PvpQueueEntry[]): Promise<void> {
  const transfer = resolvePvpTransfer(modeId);
  const matchId = randomUUID();
  const teamSize = teamSizeForMode(modeId);

  const created = await matchMaker.createRoom(transfer.room, {
    matchId,
    mode: transfer.mode,
  });

  const assignments = assignTeams(selected, teamSize);

  for (const entry of selected) {
    for (const member of entry.members) {
      const assigned = assignments.get(member.key) ?? {
        team: "a" as const,
        role: "fighter" as const,
        spawnSlot: 0,
      };

      member.client.send("queue_status", { queued: false });
      member.client.send("toast", {
        message: `Match found — ${modeId} (${teamSize}v${teamSize})`,
      });
      member.client.send("transfer", {
        room: transfer.room,
        roomId: created.roomId,
        options: {
          mode: transfer.mode,
          matchId,
          hubOwnerId: member.hubOwnerId,
          team: assigned.team,
          role: assigned.role,
          spawnSlot: assigned.spawnSlot,
        },
      });
    }
  }
}

async function tryMatch(): Promise<void> {
  if (matching) return;
  matching = true;

  try {
    let matchedAny = true;
    while (matchedAny) {
      matchedAny = false;

      const modes = new Set<string>();
      for (const entry of queue) {
        for (const mode of entry.modes) modes.add(mode);
      }

      for (const modeId of modes) {
        const selected = selectEntriesForMode(modeId);
        if (!selected) continue;

        const ids = new Set(selected.map((e) => e.partyId));
        for (let i = queue.length - 1; i >= 0; i--) {
          if (ids.has(queue[i]!.partyId)) queue.splice(i, 1);
        }

        await createMatch(modeId as PvpModeId, selected);
        matchedAny = true;
        break;
      }
    }
  } catch (err) {
    console.error("[pvpQueue] match failed", err);
  } finally {
    matching = false;
  }
}

/** Queues a party (solo parties are just a single-member entry) for PvP matchmaking. */
export function enqueuePvpParty(entry: Omit<PvpQueueEntry, "enqueuedAt">): void {
  dequeuePvpParty(entry.partyId);
  queue.push({ ...entry, enqueuedAt: Date.now() });
  for (const member of entry.members) {
    member.client.send("queue_status", { queued: true, modes: entry.modes });
    member.client.send("toast", {
      message: `Queued: ${entry.modes.join(", ")} — waiting for a full lobby`,
    });
  }
  void tryMatch();
}

export function dequeuePvpParty(partyId: string): boolean {
  const idx = queue.findIndex((e) => e.partyId === partyId);
  if (idx < 0) return false;
  queue.splice(idx, 1);
  return true;
}

/** Dequeues whichever party contains a member with this key (never splits the party). */
export function dequeuePvpSession(key: string): boolean {
  const idx = queue.findIndex((e) => e.members.some((m) => m.key === key));
  if (idx < 0) return false;
  queue.splice(idx, 1);
  return true;
}

export function isPartyQueued(partyId: string): boolean {
  return queue.some((e) => e.partyId === partyId);
}
