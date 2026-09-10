import { randomUUID } from "node:crypto";
import {
  COOP_PVE_MAX_PLAYERS,
  parsePvpFamilyToken,
  pvpFamilyFromModes,
  pvpFamilyToken,
  pvpModesForFamily,
  resolvePremadeBattlegroundSize,
  resolvePremadeSkirmishMode,
  type PartyKind,
  type PartyMemberSnapshot,
  type PartySnapshot,
  type PvpFamily,
  type PvpModeId,
  type PvpSeat,
} from "@battlebeasts/shared";

export type HubPartyMember = {
  sessionId: string;
  userId: string;
  displayName: string;
  seat: PvpSeat;
};

export type HubParty = {
  partyId: string;
  leaderSessionId: string;
  kind: PartyKind;
  modes: string[];
  members: Map<string, HubPartyMember>;
  pendingInvites: Set<string>;
  pendingFriendInvites: Set<string>;
  queued: boolean;
};

export function partyFamily(party: HubParty): PvpFamily {
  return pvpFamilyFromModes(party.modes);
}

export function filterModesForHubSize(modes: string[], hubPlayerCount: number): {
  validModes: string[];
  rejectedModes: string[];
} {
  const validModes: string[] = [];
  const rejectedModes: string[] = [];
  for (const mode of modes) {
    const family = parsePvpFamilyToken(mode) ?? pvpFamilyFromModes([mode]);
    const cap = pvpModesForFamily(family).reduce(
      (max, m) => Math.max(max, m.teamSizeMax * m.teamCount + m.maxSpectators),
      0,
    );
    if (cap >= hubPlayerCount) validModes.push(mode);
    else rejectedModes.push(mode);
  }
  return { validModes, rejectedModes };
}

export function seatCounts(party: HubParty): {
  teamA: number;
  teamB: number;
  teamC: number;
  spectator: number;
} {
  let teamA = 0;
  let teamB = 0;
  let teamC = 0;
  let spectator = 0;
  for (const member of party.members.values()) {
    if (member.seat === "teamA") teamA++;
    else if (member.seat === "teamB") teamB++;
    else if (member.seat === "teamC") teamC++;
    else spectator++;
  }
  return { teamA, teamB, teamC, spectator };
}

/** Group queues together on team A; split-sides is opt-in for custom matches. */
export function defaultSeatFor(party: HubParty): PvpSeat {
  if (party.kind === "coop_pve") return "teamA";
  return "teamA";
}

export function partyFitsFamily(party: HubParty, family: PvpFamily = partyFamily(party)): boolean {
  if (party.kind === "coop_pve") return party.members.size <= COOP_PVE_MAX_PLAYERS;
  const modes = pvpModesForFamily(family);
  if (modes.length === 0) return false;
  const maxSpec = Math.max(...modes.map((m) => m.maxSpectators));
  const { teamA, teamB, teamC, spectator } = seatCounts(party);
  if (spectator > maxSpec) return false;
  const maxSide = Math.max(...modes.map((m) => m.teamSizeMax));
  if (family === "skirmish" && teamC > 0) {
    return teamA <= maxSide && teamB <= maxSide && teamC <= maxSide;
  }
  if (teamC > 0) return false;
  return teamA <= maxSide && teamB <= maxSide;
}

/** Both sides filled equally inside the family's legal range. */
export function isFullPremadeLobby(party: HubParty, family: PvpFamily = partyFamily(party)): boolean {
  if (party.kind === "coop_pve") return false;
  if (!partyFitsFamily(party, family)) return false;
  const { teamA, teamB, teamC } = seatCounts(party);
  if (family === "skirmish") return resolvePremadeSkirmishMode(teamA, teamB, teamC) != null;
  if (teamC > 0 || teamA < 1 || teamA !== teamB) return false;
  return resolvePremadeBattlegroundSize(teamA, teamB) != null;
}

export function resolvePremadeMode(party: HubParty): PvpModeId | null {
  const family = partyFamily(party);
  const { teamA, teamB, teamC } = seatCounts(party);
  if (family === "skirmish") return resolvePremadeSkirmishMode(teamA, teamB, teamC);
  if (resolvePremadeBattlegroundSize(teamA, teamB) == null) return null;
  return "bg_ctf";
}

/** @deprecated size-specific helper — family parties use partyFitsFamily. */
export function partyFitsMode(party: HubParty, modeId: string): boolean {
  const family = parsePvpFamilyToken(modeId) ?? pvpFamilyFromModes([modeId]);
  return partyFitsFamily(party, family);
}

export function toPartySnapshot(party: HubParty): PartySnapshot {
  const members: PartyMemberSnapshot[] = [...party.members.values()].map((m) => ({
    sessionId: m.sessionId,
    userId: m.userId,
    displayName: m.displayName,
    seat: m.seat,
  }));
  const family = party.kind === "pvp" ? partyFamily(party) : undefined;
  return {
    partyId: party.partyId,
    leaderSessionId: party.leaderSessionId,
    kind: party.kind,
    modes: [...party.modes],
    family,
    members,
    pendingInvites: [...party.pendingInvites],
    pendingFriendInvites: [...party.pendingFriendInvites],
    queued: party.queued,
  };
}

export class HubPartyRegistry {
  private parties = new Map<string, HubParty>();
  private partyBySession = new Map<string, string>();

  get(partyId: string): HubParty | undefined {
    return this.parties.get(partyId);
  }

  getBySession(sessionId: string): HubParty | undefined {
    const partyId = this.partyBySession.get(sessionId);
    return partyId ? this.parties.get(partyId) : undefined;
  }

  hasAnyParty(sessionId: string): boolean {
    return this.partyBySession.has(sessionId);
  }

  create(
    leader: { sessionId: string; userId: string; displayName: string },
    modes: string[],
    kind: PartyKind = "pvp",
  ): HubParty {
    const family = kind === "pvp" ? pvpFamilyFromModes(modes) : undefined;
    const stored = kind === "pvp" && family ? [pvpFamilyToken(family)] : [...modes];
    const party: HubParty = {
      partyId: randomUUID(),
      leaderSessionId: leader.sessionId,
      kind,
      modes: stored,
      members: new Map(),
      pendingInvites: new Set(),
      pendingFriendInvites: new Set(),
      queued: false,
    };
    party.members.set(leader.sessionId, { ...leader, seat: "teamA" });
    this.parties.set(party.partyId, party);
    this.partyBySession.set(leader.sessionId, party.partyId);
    return party;
  }

  addMember(party: HubParty, member: { sessionId: string; userId: string; displayName: string }, seat: PvpSeat): void {
    party.pendingFriendInvites.delete(member.userId);
    party.members.set(member.sessionId, { ...member, seat });
    this.partyBySession.set(member.sessionId, party.partyId);
  }

  removeMember(party: HubParty, sessionId: string): boolean {
    party.pendingInvites.delete(sessionId);
    if (!party.members.delete(sessionId)) return false;
    this.partyBySession.delete(sessionId);
    return true;
  }

  findByPendingFriend(userId: string): HubParty | undefined {
    for (const party of this.parties.values()) {
      if (party.pendingFriendInvites.has(userId)) return party;
    }
    return undefined;
  }

  dissolve(party: HubParty): void {
    for (const sessionId of party.members.keys()) {
      this.partyBySession.delete(sessionId);
    }
    party.members.clear();
    party.pendingInvites.clear();
    party.pendingFriendInvites.clear();
    this.parties.delete(party.partyId);
  }
}
