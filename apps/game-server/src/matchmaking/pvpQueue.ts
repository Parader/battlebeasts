import type { Client } from "@colyseus/core";
import { matchMaker } from "@colyseus/core";
import {
  MMR_MIDPOINT,
  PVP_MODES,
  isPvpFfaTriosMode,
  mmrBandForWaitMs,
  pvpModeFighterCount,
  resolvePvpTransfer,
  type MatchKind,
  type PvpModeId,
  type PvpSeat,
} from "@battlebeasts/shared";
import { randomUUID } from "node:crypto";
import { getActiveSeason, getPlayerMmrs } from "../ranked.js";

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
  /** Party average MMR (fighters only). */
  avgMmr: number;
};

/** Process-wide PvP queue — hubs are separate rooms, but matchmaking is global. */
const queue: PvpQueueEntry[] = [];
let matching = false;
let matchTimer: ReturnType<typeof setInterval> | null = null;

function ensureMatchTimer() {
  if (matchTimer) return;
  matchTimer = setInterval(() => {
    void tryMatch();
  }, 2000);
}

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

function partyWaitMs(entry: PvpQueueEntry, now: number): number {
  return Math.max(0, now - entry.enqueuedAt);
}

/**
 * Find a set of whole parties that fill both teams and whose team avg MMR
 * differ by at most the progressive band (based on max wait in the set).
 */
/**
 * Find a set of whole parties that fill the mode and whose side avg MMR
 * differ by at most the progressive band (based on max wait in the set).
 */
function selectEntriesForMode(modeId: string, now: number): PvpQueueEntry[] | null {
  const mode = modeConfig(modeId);
  if (!mode || mode.noQueue) return null;
  const ffa = isPvpFfaTriosMode(modeId);
  const teamSize = teamSizeForMode(modeId);
  const need = pvpModeFighterCount(modeId) || teamSize * 2;
  const maxSpectators = maxSpectatorsForMode(modeId);
  const candidates = queue
    .filter((e) => e.modes.includes(modeId))
    // FFA: a party cannot bring more fighters than sides remaining in a solo FFA
    // (max 2 queued together looking for a third; full 3 goes direct-start).
    .filter((e) => !ffa || fighterCount(e) <= Math.max(1, need - 1))
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  type Pack = { entries: PvpQueueEntry[]; fighters: number };
  const packs: Pack[] = [];

  const dfs = (start: number, selected: PvpQueueEntry[], fighters: number) => {
    if (fighters === need) {
      packs.push({ entries: [...selected], fighters });
      return;
    }
    if (fighters > need) return;
    for (let i = start; i < candidates.length; i++) {
      const entry = candidates[i]!;
      const n = fighterCount(entry);
      if (n === 0) continue;
      if (fighters + n > need) continue;
      if (selected.includes(entry)) continue;
      selected.push(entry);
      dfs(i + 1, selected, fighters + n);
      selected.pop();
      // Bound search for large queues
      if (packs.length >= 40) return;
    }
  };
  dfs(0, [], 0);

  let best: { entries: PvpQueueEntry[]; gap: number } | null = null;

  for (const pack of packs) {
    const maxWait = Math.max(...pack.entries.map((e) => partyWaitMs(e, now)));
    const band = mmrBandForWaitMs(maxWait);

    const assignments = assignTeams(pack.entries, teamSize, modeId as PvpModeId);
    const sideSum = { a: 0, b: 0, c: 0 };
    const sideN = { a: 0, b: 0, c: 0 };
    for (const entry of pack.entries) {
      for (const member of entry.members) {
        if (member.seat === "spectator") continue;
        const a = assignments.get(member.key);
        if (!a || a.role !== "fighter") continue;
        const team = a.team;
        if (team !== "a" && team !== "b" && team !== "c") continue;
        const mmr = entry.avgMmr;
        sideSum[team] += mmr;
        sideN[team]++;
      }
    }

    if (ffa) {
      if (sideN.a !== 1 || sideN.b !== 1 || sideN.c !== 1) continue;
      const avgs = [sideSum.a, sideSum.b, sideSum.c];
      const gap = Math.max(...avgs) - Math.min(...avgs);
      if (gap > band) continue;
      if (!best || gap < best.gap) best = { entries: pack.entries, gap };
      continue;
    }

    if (sideN.a !== teamSize || sideN.b !== teamSize) continue;
    const gap = Math.abs(sideSum.a / sideN.a - sideSum.b / sideN.b);
    if (gap > band) continue;
    if (!best || gap < best.gap) best = { entries: pack.entries, gap };
  }

  if (!best) return null;

  const selected = [...best.entries];
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
 * leftover solos fill empty slots. Explicit teamA/teamB/teamC seats are preferred when packing
 * a single pre-balanced party, otherwise seats are remapped.
 */
function assignTeams(
  selected: PvpQueueEntry[],
  teamSize: number,
  modeId: PvpModeId,
): Map<string, { team: "a" | "b" | "c" | ""; role: "fighter" | "spectator"; spawnSlot: number }> {
  const out = new Map<string, { team: "a" | "b" | "c" | ""; role: "fighter" | "spectator"; spawnSlot: number }>();
  let slotA = 0;
  let slotB = 0;
  let slotC = 0;
  let slotSpec = 0;

  const placeFighter = (member: PvpPartyMember, team: "a" | "b" | "c") => {
    const spawnSlot =
      team === "a" ? slotA++ : team === "b" ? slotB++ : slotC++;
    out.set(member.key, { team, role: "fighter", spawnSlot });
  };

  if (isPvpFfaTriosMode(modeId)) {
    const used = new Set<"a" | "b" | "c">();
    const pending: PvpPartyMember[] = [];

    for (const entry of selected) {
      for (const member of entry.members) {
        if (member.seat === "spectator") {
          out.set(member.key, { team: "", role: "spectator", spawnSlot: slotSpec++ });
          continue;
        }
        const prefer =
          member.seat === "teamC" ? "c" : member.seat === "teamB" ? "b" : member.seat === "teamA" ? "a" : null;
        if (prefer && !used.has(prefer)) {
          placeFighter(member, prefer);
          used.add(prefer);
        } else {
          pending.push(member);
        }
      }
    }

    for (const member of pending) {
      const team =
        !used.has("a") ? "a" : !used.has("b") ? "b" : !used.has("c") ? "c" : null;
      if (!team) continue;
      placeFighter(member, team);
      used.add(team);
    }
    return out;
  }

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

async function createMatch(
  modeId: PvpModeId,
  selected: PvpQueueEntry[],
  matchKind: MatchKind,
): Promise<void> {
  const transfer = resolvePvpTransfer(modeId);
  const matchId = randomUUID();
  const teamSize = teamSizeForMode(modeId);
  const season = await getActiveSeason();

  const created = await matchMaker.createRoom(transfer.room, {
    matchId,
    mode: transfer.mode,
    matchKind,
    seasonId: season?.id ?? null,
  });

  const assignments = assignTeams(selected, teamSize, modeId);

  for (const entry of selected) {
    for (const member of entry.members) {
      const assigned = assignments.get(member.key) ?? {
        team: "a" as const,
        role: "fighter" as const,
        spawnSlot: 0,
      };

      member.client.send("queue_status", { queued: false });
      const label = isPvpFfaTriosMode(modeId)
        ? "1v1v1"
        : `${teamSize}v${teamSize}`;
      member.client.send("toast", {
        message:
          matchKind === "ranked"
            ? `Ranked match — ${modeId} (${label})`
            : `Unranked match — ${modeId} (${label})`,
      });
      member.client.send("transfer", {
        room: transfer.room,
        roomId: created.roomId,
        options: {
          mode: transfer.mode,
          matchId,
          matchKind,
          seasonId: season?.id ?? null,
          hubOwnerId: member.hubOwnerId,
          team: assigned.team,
          role: assigned.role,
          spawnSlot: assigned.spawnSlot,
        },
      });
    }
  }
}

/** Start a full premade lobby directly (skips queue banding). */
export async function startDirectPvpMatch(
  modeId: PvpModeId,
  entry: Omit<PvpQueueEntry, "enqueuedAt" | "avgMmr"> & { avgMmr?: number },
  matchKind: MatchKind,
): Promise<void> {
  const full: PvpQueueEntry = {
    ...entry,
    enqueuedAt: Date.now(),
    avgMmr: entry.avgMmr ?? MMR_MIDPOINT,
  };
  await createMatch(modeId, [full], matchKind);
}

async function tryMatch(): Promise<void> {
  if (matching) return;
  matching = true;

  try {
    let matchedAny = true;
    const now = Date.now();
    while (matchedAny) {
      matchedAny = false;

      const modes = new Set<string>();
      for (const entry of queue) {
        for (const mode of entry.modes) modes.add(mode);
      }

      for (const modeId of modes) {
        const selected = selectEntriesForMode(modeId, now);
        if (!selected) continue;

        const ids = new Set(selected.map((e) => e.partyId));
        for (let i = queue.length - 1; i >= 0; i--) {
          if (ids.has(queue[i]!.partyId)) queue.splice(i, 1);
        }

        await createMatch(modeId as PvpModeId, selected, "ranked");
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

/** Queues a party for ranked PvP matchmaking. */
export function enqueuePvpParty(entry: Omit<PvpQueueEntry, "enqueuedAt">): void {
  dequeuePvpParty(entry.partyId);
  queue.push({ ...entry, enqueuedAt: Date.now() });
  ensureMatchTimer();
  for (const member of entry.members) {
    member.client.send("queue_status", { queued: true, modes: entry.modes });
    member.client.send("toast", {
      message: `Ranked queue: ${entry.modes.join(", ")} — searching…`,
    });
  }
  void tryMatch();
}

export async function resolvePartyAvgMmr(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return MMR_MIDPOINT;
  const season = await getActiveSeason();
  if (!season) return MMR_MIDPOINT;
  const map = await getPlayerMmrs(userIds, season.id);
  let sum = 0;
  for (const id of userIds) sum += map.get(id) ?? MMR_MIDPOINT;
  return sum / userIds.length;
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
