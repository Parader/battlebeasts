import type { Client } from "@colyseus/core";
import { matchMaker } from "@colyseus/core";
import {
  BATTLEGROUND_MODE_IDS,
  MMR_MIDPOINT,
  QUEUE_DOWNSIZE_WAIT_MS,
  formatTeamSizeLabel,
  mmrBandForWaitMs,
  pvpFamilyFromModes,
  pvpFamilyMaxSpectators,
  pvpFamilyTeamSizes,
  pvpModeById,
  resolvePvpTransfer,
  skirmishModeForTeamSize,
  type MatchKind,
  type PvpFamily,
  type PvpModeId,
  type PvpSeat,
} from "@battlebeasts/shared";
import { randomUUID } from "node:crypto";
import { getActiveSeason, getPlayerMmrs } from "../ranked.js";

export type PvpPartyMember = {
  key: string;
  client: Client;
  userId: string;
  seat: PvpSeat;
  hubOwnerId: string | null;
  plazaId?: string | null;
  groupId?: string | null;
};

export type PvpQueueEntry = {
  partyId: string;
  modes: string[];
  family: PvpFamily;
  members: PvpPartyMember[];
  enqueuedAt: number;
  avgMmr: number;
};

const queue: PvpQueueEntry[] = [];
let matching = false;
let matchTimer: ReturnType<typeof setInterval> | null = null;
let lastBgModeIndex = -1;

function ensureMatchTimer() {
  if (matchTimer) return;
  matchTimer = setInterval(() => {
    void tryMatch();
  }, 2000);
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

function nextBattlegroundMode(): PvpModeId {
  lastBgModeIndex = (lastBgModeIndex + 1) % BATTLEGROUND_MODE_IDS.length;
  return BATTLEGROUND_MODE_IDS[lastBgModeIndex]!;
}

function resolveQueueMode(family: PvpFamily, teamSize: number): PvpModeId {
  if (family === "battleground") return nextBattlegroundMode();
  return skirmishModeForTeamSize(teamSize);
}

function maxSpectatorsForFamily(family: PvpFamily): number {
  return pvpFamilyMaxSpectators(family);
}

function allowedTeamSizes(family: PvpFamily, fighterTotal: number, maxWait: number): number[] {
  const sizes = pvpFamilyTeamSizes(family);
  const out: number[] = [];
  for (const teamSize of sizes) {
    const need = teamSize * 2;
    if (fighterTotal < need) continue;
    const leftover = fighterTotal - need;
    const canGrow = sizes.some((larger) => larger > teamSize && fighterTotal < larger * 2);
    if (leftover === 0) {
      out.push(teamSize);
    } else if (maxWait >= QUEUE_DOWNSIZE_WAIT_MS) {
      out.push(teamSize);
    } else if (leftover >= 2 && !canGrow) {
      out.push(teamSize);
    }
  }
  return out;
}

function predictLookingFor(family: PvpFamily): string {
  const pool = queue.filter((e) => e.family === family);
  const fighters = pool.reduce((n, e) => n + fighterCount(e), 0);
  const maxWait = pool.length === 0 ? 0 : Math.max(...pool.map((e) => partyWaitMs(e, Date.now())));
  const sizes = allowedTeamSizes(family, fighters, maxWait);
  const teamSize = sizes[0] ?? pvpFamilyTeamSizes(family).find((s) => fighters < s * 2) ?? 1;
  const label = formatTeamSizeLabel(teamSize);
  return family === "battleground" ? `${label} battleground` : label;
}

function broadcastQueuePrediction() {
  for (const entry of queue) {
    const lookingFor = predictLookingFor(entry.family);
    for (const member of entry.members) {
      member.client.send("queue_status", {
        queued: true,
        modes: entry.modes,
        family: entry.family,
        lookingFor,
      });
    }
  }
}

type Pack = { entries: PvpQueueEntry[]; fighters: number };

function packsForNeed(candidates: PvpQueueEntry[], need: number): Pack[] {
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
      if (n === 0 || fighters + n > need) continue;
      selected.push(entry);
      dfs(i + 1, selected, fighters + n);
      selected.pop();
      if (packs.length >= 40) return;
    }
  };
  dfs(0, [], 0);
  return packs;
}

function selectEntriesForSize(
  family: PvpFamily,
  teamSize: number,
  now: number,
): PvpQueueEntry[] | null {
  const need = teamSize * 2;
  const maxSpectators = maxSpectatorsForFamily(family);
  const candidates = queue
    .filter((e) => e.family === family)
    .filter((e) => fighterCount(e) <= teamSize)
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  const packs = packsForNeed(candidates, need);
  let best: { entries: PvpQueueEntry[]; gap: number } | null = null;

  for (const pack of packs) {
    const maxWait = Math.max(...pack.entries.map((e) => partyWaitMs(e, now)));
    const band = mmrBandForWaitMs(maxWait);
    const assignments = assignTeams(pack.entries, teamSize);
    const sideSum = { a: 0, b: 0 };
    const sideN = { a: 0, b: 0 };
    for (const entry of pack.entries) {
      for (const member of entry.members) {
        if (member.seat === "spectator") continue;
        const a = assignments.get(member.key);
        if (!a || a.role !== "fighter") continue;
        if (a.team !== "a" && a.team !== "b") continue;
        sideSum[a.team] += entry.avgMmr;
        sideN[a.team]++;
      }
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

type SeatAssign = { team: "a" | "b" | "c" | ""; role: "fighter" | "spectator"; spawnSlot: number };

function assignFfaTeams(selected: PvpQueueEntry[]): Map<string, SeatAssign> {
  const out = new Map<string, SeatAssign>();
  const used = { a: false, b: false, c: false };
  let slotSpec = 0;

  const take = (prefer: "a" | "b" | "c" | null): "a" | "b" | "c" => {
    if (prefer && !used[prefer]) {
      used[prefer] = true;
      return prefer;
    }
    for (const team of ["a", "b", "c"] as const) {
      if (!used[team]) {
        used[team] = true;
        return team;
      }
    }
    return "a";
  };

  const fighters: PvpPartyMember[] = [];
  for (const entry of selected) {
    for (const member of entry.members) {
      if (member.seat === "spectator") {
        out.set(member.key, { team: "", role: "spectator", spawnSlot: slotSpec++ });
      } else {
        fighters.push(member);
      }
    }
  }
  for (const member of fighters) {
    const prefer =
      member.seat === "teamB" ? "b" : member.seat === "teamC" ? "c" : member.seat === "teamA" ? "a" : null;
    const team = take(prefer);
    out.set(member.key, { team, role: "fighter", spawnSlot: 0 });
  }
  return out;
}

function assignTeams(
  selected: PvpQueueEntry[],
  teamSize: number,
): Map<string, SeatAssign> {
  const out = new Map<string, SeatAssign>();
  let slotA = 0;
  let slotB = 0;
  let slotSpec = 0;

  const placeFighter = (member: PvpPartyMember, team: "a" | "b") => {
    const spawnSlot = team === "a" ? slotA++ : slotB++;
    out.set(member.key, { team, role: "fighter", spawnSlot });
  };

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
  teamSize: number,
): Promise<void> {
  const transfer = resolvePvpTransfer(modeId);
  const matchId = randomUUID();
  const season = await getActiveSeason();
  const mode = pvpModeById(modeId);
  const label = modeId === "arena_1v1v1" ? "1v1v1" : formatTeamSizeLabel(teamSize);

  const created = await matchMaker.createRoom(transfer.room, {
    matchId,
    mode: transfer.mode,
    matchKind,
    seasonId: season?.id ?? null,
    teamSize,
  });

  const assignments =
    modeId === "arena_1v1v1" ? assignFfaTeams(selected) : assignTeams(selected, teamSize);

  for (const entry of selected) {
    for (const member of entry.members) {
      const assigned = assignments.get(member.key) ?? {
        team: "a" as const,
        role: "fighter" as const,
        spawnSlot: 0,
      };

      member.client.send("queue_status", { queued: false });
      member.client.send("toast", {
        message:
          matchKind === "ranked"
            ? `Ranked ${mode?.label ?? modeId} — ${label}`
            : `${mode?.label ?? modeId} — ${label}`,
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
          plazaId: member.plazaId ?? undefined,
          groupId: member.groupId ?? undefined,
          team: assigned.team,
          role: assigned.role,
          spawnSlot: assigned.spawnSlot,
        },
      });
    }
  }
}

export async function startDirectPvpMatch(
  modeId: PvpModeId,
  entry: Omit<PvpQueueEntry, "enqueuedAt" | "avgMmr" | "family"> & {
    avgMmr?: number;
    family?: PvpFamily;
  },
  matchKind: MatchKind,
): Promise<void> {
  const family = entry.family ?? pvpFamilyFromModes(entry.modes);
  const full: PvpQueueEntry = {
    ...entry,
    family,
    enqueuedAt: Date.now(),
    avgMmr: entry.avgMmr ?? MMR_MIDPOINT,
  };
  const fighters = fighterCount(full);
  const teamSize = modeId === "arena_1v1v1" ? 1 : Math.max(1, Math.round(fighters / 2));
  await createMatch(modeId, [full], matchKind, teamSize);
}

async function tryMatch(): Promise<void> {
  if (matching) return;
  matching = true;

  try {
    let matchedAny = true;
    const now = Date.now();
    while (matchedAny) {
      matchedAny = false;
      for (const family of ["battleground", "skirmish"] as const) {
        const pool = queue.filter((e) => e.family === family);
        if (pool.length === 0) continue;
        const fighters = pool.reduce((n, e) => n + fighterCount(e), 0);
        const maxWait = Math.max(...pool.map((e) => partyWaitMs(e, now)));
        const sizes = allowedTeamSizes(family, fighters, maxWait);
        for (const teamSize of sizes) {
          const selected = selectEntriesForSize(family, teamSize, now);
          if (!selected) continue;
          const ids = new Set(selected.map((e) => e.partyId));
          for (let i = queue.length - 1; i >= 0; i--) {
            if (ids.has(queue[i]!.partyId)) queue.splice(i, 1);
          }
          const modeId = resolveQueueMode(family, teamSize);
          await createMatch(modeId, selected, "ranked", teamSize);
          matchedAny = true;
          break;
        }
        if (matchedAny) break;
      }
    }
    broadcastQueuePrediction();
  } catch (err) {
    console.error("[pvpQueue] match failed", err);
  } finally {
    matching = false;
  }
}

export function enqueuePvpParty(
  entry: Omit<PvpQueueEntry, "enqueuedAt" | "family"> & { family?: PvpFamily },
): void {
  dequeuePvpParty(entry.partyId);
  const family = entry.family ?? pvpFamilyFromModes(entry.modes);
  const full: PvpQueueEntry = { ...entry, family, enqueuedAt: Date.now() };
  queue.push(full);
  ensureMatchTimer();
  const lookingFor = predictLookingFor(family);
  for (const member of full.members) {
    member.client.send("queue_status", {
      queued: true,
      modes: full.modes,
      family,
      lookingFor,
    });
    member.client.send("toast", {
      message:
        family === "battleground"
          ? `Battleground queue — looking for ${lookingFor}`
          : `Skirmish queue — looking for ${lookingFor}`,
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

export function dequeuePvpSession(key: string): boolean {
  const idx = queue.findIndex((e) => e.members.some((m) => m.key === key));
  if (idx < 0) return false;
  queue.splice(idx, 1);
  return true;
}

export function isPartyQueued(partyId: string): boolean {
  return queue.some((e) => e.partyId === partyId);
}
