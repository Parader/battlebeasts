import { randomUUID } from "node:crypto";
import {
  coopPveCapForModes,
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
  /** False while disconnected / logged out. Omitted or true means in-world. */
  online?: boolean;
  offlineSince?: number;
};

export function offlinePartySessionId(userId: string): string {
  return `offline:${userId}`;
}

export type HubParty = {
  partyId: string;
  leaderSessionId: string;
  kind: PartyKind;
  modes: string[];
  members: Map<string, HubPartyMember>;
  pendingInvites: Set<string>;
  pendingFriendInvites: Set<string>;
  queued: boolean;
  /** True after the leader opens a portal lobby (PvP / Wave Assault). */
  lobbyOpen: boolean;
  /** PvP custom sides — everyone sees Team 1 / Team 2. */
  splitSides: boolean;
  /** PvP skirmish third column. */
  teamCOpen: boolean;
  /** Battleground custom-side size (2–5). */
  teamSize?: number;
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
  if (party.kind === "coop_pve") return party.members.size <= coopPveCapForModes(party.modes);
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

export function retargetParty(party: HubParty, kind: PartyKind, modes: string[]): void {
  const family = kind === "pvp" ? pvpFamilyFromModes(modes) : undefined;
  party.kind = kind;
  party.modes = kind === "pvp" && family ? [pvpFamilyToken(family)] : [...modes];
  party.splitSides = kind === "pvp";
  party.teamCOpen = false;
  party.teamSize = family === "battleground" ? (party.teamSize ?? 5) : undefined;
  if (kind === "coop_pve") {
    for (const member of party.members.values()) member.seat = "teamA";
  }
}

export function toPartySnapshot(party: HubParty): PartySnapshot {
  const members: PartyMemberSnapshot[] = [...party.members.values()].map((m) => ({
    sessionId: m.sessionId,
    userId: m.userId,
    displayName: m.displayName,
    seat: m.seat,
    online: m.online !== false,
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
    splitSides: party.splitSides,
    teamCOpen: party.teamCOpen,
    teamSize: party.teamSize,
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
    partyId?: string,
  ): HubParty {
    const family = kind === "pvp" ? pvpFamilyFromModes(modes) : undefined;
    const stored = kind === "pvp" && family ? [pvpFamilyToken(family)] : [...modes];
    const party: HubParty = {
      partyId: partyId ?? randomUUID(),
      leaderSessionId: leader.sessionId,
      kind,
      modes: stored,
      members: new Map(),
      pendingInvites: new Set(),
      pendingFriendInvites: new Set(),
      queued: false,
      lobbyOpen: false,
      splitSides: kind === "pvp",
      teamCOpen: false,
      teamSize: family === "battleground" ? 5 : undefined,
    };
    party.members.set(leader.sessionId, { ...leader, seat: "teamA", online: true });
    this.parties.set(party.partyId, party);
    this.partyBySession.set(leader.sessionId, party.partyId);
    return party;
  }

  addMember(
    party: HubParty,
    member: { sessionId: string; userId: string; displayName: string },
    seat: PvpSeat,
    presence: { online?: boolean; offlineSince?: number } = {},
  ): void {
    party.pendingFriendInvites.delete(member.userId);
    const online = presence.online !== false;
    party.members.set(member.sessionId, {
      ...member,
      seat,
      online,
      offlineSince: online ? undefined : (presence.offlineSince ?? Date.now()),
    });
    this.partyBySession.set(member.sessionId, party.partyId);
  }

  addOfflineMember(
    party: HubParty,
    member: { userId: string; displayName: string; seat?: PvpSeat; offlineSince?: number },
  ): void {
    const sessionId = offlinePartySessionId(member.userId);
    this.addMember(
      party,
      { sessionId, userId: member.userId, displayName: member.displayName },
      member.seat ?? defaultSeatFor(party),
      { online: false, offlineSince: member.offlineSince ?? Date.now() },
    );
  }

  getByUserId(userId: string): HubParty | undefined {
    for (const party of this.parties.values()) {
      for (const member of party.members.values()) {
        if (member.userId === userId) return party;
      }
    }
    return undefined;
  }

  all(): HubParty[] {
    return [...this.parties.values()];
  }

  /** Move a parked / stale member onto a live session and mark them online. */
  rebindUser(userId: string, sessionId: string, displayName?: string): HubParty | undefined {
    const party = this.getByUserId(userId);
    if (!party) return undefined;
    const member = [...party.members.values()].find((m) => m.userId === userId);
    if (!member) return undefined;
    if (member.sessionId !== sessionId) {
      party.members.delete(member.sessionId);
      this.partyBySession.delete(member.sessionId);
      if (party.leaderSessionId === member.sessionId) party.leaderSessionId = sessionId;
      member.sessionId = sessionId;
      party.members.set(sessionId, member);
    }
    if (displayName) member.displayName = displayName;
    member.online = true;
    member.offlineSince = undefined;
    this.partyBySession.set(sessionId, party.partyId);
    return party;
  }

  markOffline(sessionId: string, at = Date.now()): HubParty | undefined {
    const party = this.getBySession(sessionId);
    const member = party?.members.get(sessionId);
    if (!party || !member) return undefined;
    if (member.online !== false) {
      member.online = false;
      member.offlineSince = at;
    }
    return party;
  }

  markOnline(sessionId: string): HubParty | undefined {
    const party = this.getBySession(sessionId);
    const member = party?.members.get(sessionId);
    if (!party || !member) return undefined;
    member.online = true;
    member.offlineSince = undefined;
    return party;
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
