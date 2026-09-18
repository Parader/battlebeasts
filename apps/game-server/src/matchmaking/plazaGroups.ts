import type { PartyKind } from "@battlebeasts/shared";
import type { HubParty } from "./hubParty.js";

export type PersistentGroupMember = {
  userId: string;
  displayName: string;
  online: boolean;
  offlineSince?: number;
  seat?: "teamA" | "teamB" | "teamC" | "spectator";
};

export type PersistentGroup = {
  groupId: string;
  leaderUserId: string;
  members: Map<string, PersistentGroupMember>;
  plazaId: string | null;
  hubOwnerId: string | null;
  transferring: boolean;
  kind: PartyKind;
  modes: string[];
};

export type HunterSpot = {
  plazaId: string | null;
  hubOwnerId: string | null;
};

const groups = new Map<string, PersistentGroup>();
const byUser = new Map<string, string>();
const spots = new Map<string, HunterSpot>();

export function getGroup(groupId: string | undefined | null): PersistentGroup | undefined {
  if (!groupId) return undefined;
  return groups.get(groupId);
}

export function groupForUser(userId: string | undefined | null): PersistentGroup | undefined {
  if (!userId) return undefined;
  const id = byUser.get(userId);
  return id ? groups.get(id) : undefined;
}

function indexMembers(group: PersistentGroup) {
  for (const userId of byUser.keys()) {
    if (byUser.get(userId) === group.groupId) byUser.delete(userId);
  }
  for (const userId of group.members.keys()) byUser.set(userId, group.groupId);
}

export function upsertGroupFromParty(
  party: HubParty,
  dest: { plazaId?: string | null; hubOwnerId?: string | null },
): PersistentGroup {
  const existing = groups.get(party.partyId);
  const leader = party.members.get(party.leaderSessionId);
  const group: PersistentGroup = existing ?? {
    groupId: party.partyId,
    leaderUserId: leader?.userId ?? "",
    members: new Map(),
    plazaId: dest.plazaId ?? null,
    hubOwnerId: dest.hubOwnerId ?? null,
    transferring: false,
    kind: party.kind,
    modes: [...party.modes],
  };
  group.leaderUserId = leader?.userId ?? group.leaderUserId;
  group.kind = party.kind;
  group.modes = [...party.modes];
  if (dest.plazaId !== undefined) group.plazaId = dest.plazaId;
  if (dest.hubOwnerId !== undefined) group.hubOwnerId = dest.hubOwnerId;
  group.members.clear();
  for (const m of party.members.values()) {
    const online = m.online !== false;
    group.members.set(m.userId, {
      userId: m.userId,
      displayName: m.displayName,
      online,
      offlineSince: online ? undefined : (m.offlineSince ?? Date.now()),
      seat: m.seat,
    });
  }
  groups.set(group.groupId, group);
  indexMembers(group);
  return group;
}

/**
 * Drop hunters who stayed logged out past the grace window.
 * Only dissolves after an expiry drop leaves fewer than 2 people — a 1-person
 * invite lobby must not be treated as an expired group.
 */
export function pruneExpiredOfflineMembers(now: number, graceMs: number): string[] {
  const dissolved: string[] = [];
  for (const group of [...groups.values()]) {
    if (group.transferring) continue;
    let dropped = false;
    for (const [userId, member] of [...group.members]) {
      if (member.online) continue;
      if ((member.offlineSince ?? now) + graceMs > now) continue;
      group.members.delete(userId);
      byUser.delete(userId);
      dropped = true;
    }
    if (!dropped) continue;
    if (group.members.size < 2) {
      dissolveGroup(group.groupId);
      dissolved.push(group.groupId);
      continue;
    }
    if (!group.members.has(group.leaderUserId)) {
      const next =
        [...group.members.values()].find((m) => m.online) ?? [...group.members.values()][0];
      group.leaderUserId = next?.userId ?? "";
    }
  }
  return dissolved;
}

export function markGroupTransferring(groupId: string, transferring: boolean) {
  const g = groups.get(groupId);
  if (g) g.transferring = transferring;
}

export function dissolveGroup(groupId: string) {
  const g = groups.get(groupId);
  if (!g) return;
  for (const userId of g.members.keys()) byUser.delete(userId);
  groups.delete(groupId);
}

export function leaveGroup(userId: string) {
  const g = groupForUser(userId);
  if (!g) return;
  g.members.delete(userId);
  byUser.delete(userId);
  if (g.members.size === 0) dissolveGroup(g.groupId);
  else if (g.leaderUserId === userId) {
    g.leaderUserId = [...g.members.keys()][0] ?? "";
  }
}

export function setHunterSpot(userId: string, spot: HunterSpot) {
  if (!userId) return;
  spots.set(userId, spot);
}

export function clearHunterSpot(userId: string | undefined | null) {
  if (!userId) return;
  spots.delete(userId);
}

export function getHunterSpot(userId: string | undefined | null): HunterSpot | undefined {
  if (!userId) return undefined;
  return spots.get(userId);
}

export function listHunterSpots(userIds: readonly string[]): Array<HunterSpot & { userId: string }> {
  const out: Array<HunterSpot & { userId: string }> = [];
  for (const userId of userIds) {
    const spot = spots.get(userId);
    if (!spot) continue;
    out.push({ userId, plazaId: spot.plazaId, hubOwnerId: spot.hubOwnerId });
  }
  return out;
}
