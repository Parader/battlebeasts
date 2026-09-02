import { randomUUID } from "node:crypto";
import {
  COOP_PVE_MAX_PLAYERS,
  PVP_MODES,
  isPvpFfaTriosMode,
  pvpModeFitsPlayerCount,
  type PartyKind,
  type PartyMemberSnapshot,
  type PartySnapshot,
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
  /** sessionIds with an outstanding invite. */
  pendingInvites: Set<string>;
  /** Friend user ids invited from party lobby — join hub then auto-enter party. */
  pendingFriendInvites: Set<string>;
  /** True once the party has been locked into the PvP queue / coop transfer. */
  queued: boolean;
};

/** Filters `modes` down to the ones that fit `hubPlayerCount` (see PortalPanel's client-side check). */
export function filterModesForHubSize(modes: string[], hubPlayerCount: number): {
  validModes: string[];
  rejectedModes: string[];
} {
  const validModes: string[] = [];
  const rejectedModes: string[] = [];
  for (const mode of modes) {
    if (pvpModeFitsPlayerCount(mode, hubPlayerCount)) validModes.push(mode);
    else rejectedModes.push(mode);
  }
  return { validModes, rejectedModes };
}

/** Whether the party's current seat assignments could fill (or fit within) `modeId`. */
export function partyFitsMode(party: HubParty, modeId: string): boolean {
  if (party.kind === "coop_pve") return party.members.size <= COOP_PVE_MAX_PLAYERS;
  const mode = PVP_MODES.find((m) => m.id === modeId);
  if (!mode) return false;
  const { teamA, teamB, teamC, spectator } = seatCounts(party);
  if (spectator > mode.maxSpectators) return false;
  if (isPvpFfaTriosMode(modeId) || mode.teamCount >= 3) {
    return (
      teamA <= mode.teamSize &&
      teamB <= mode.teamSize &&
      teamC <= mode.teamSize
    );
  }
  return teamA <= mode.teamSize && teamB <= mode.teamSize && teamC === 0;
}

/** Full premade: all sides filled to mode capacity (can start without queue). */
export function isFullPremadeLobby(party: HubParty, modeId: string): boolean {
  if (party.kind === "coop_pve") return false;
  const mode = PVP_MODES.find((m) => m.id === modeId);
  if (!mode) return false;
  const { teamA, teamB, teamC, spectator } = seatCounts(party);
  if (spectator > mode.maxSpectators) return false;
  if (!partyFitsMode(party, modeId)) return false;
  if (isPvpFfaTriosMode(modeId) || mode.teamCount >= 3) {
    return (
      teamA === mode.teamSize &&
      teamB === mode.teamSize &&
      teamC === mode.teamSize
    );
  }
  return teamA === mode.teamSize && teamB === mode.teamSize && teamC === 0;
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

/** Puts a newly-joining member on whichever team currently has fewer fighters (coop: always teamA). */
export function defaultSeatFor(party: HubParty): PvpSeat {
  if (party.kind === "coop_pve") return "teamA";
  const { teamA, teamB, teamC } = seatCounts(party);
  const ffa = party.modes.some((m) => isPvpFfaTriosMode(m));
  if (ffa) {
    if (teamA <= teamB && teamA <= teamC) return "teamA";
    if (teamB <= teamC) return "teamB";
    return "teamC";
  }
  return teamA <= teamB ? "teamA" : "teamB";
}

export function toPartySnapshot(party: HubParty): PartySnapshot {
  const members: PartyMemberSnapshot[] = [...party.members.values()].map((m) => ({
    sessionId: m.sessionId,
    userId: m.userId,
    displayName: m.displayName,
    seat: m.seat,
  }));
  return {
    partyId: party.partyId,
    leaderSessionId: party.leaderSessionId,
    kind: party.kind,
    modes: [...party.modes],
    members,
    pendingInvites: [...party.pendingInvites],
    pendingFriendInvites: [...party.pendingFriendInvites],
    queued: party.queued,
  };
}

/**
 * Per-hub-room registry of active parties. A session may belong to at most one party
 * at a time. Pure bookkeeping only — callers (BaseCityRoom) own all client messaging.
 */
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
    const party: HubParty = {
      partyId: randomUUID(),
      leaderSessionId: leader.sessionId,
      kind,
      modes: [...modes],
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

  /** Party waiting for this friend user id to enter the hub. */
  findByPendingFriend(userId: string): HubParty | undefined {
    for (const party of this.parties.values()) {
      if (party.pendingFriendInvites.has(userId)) return party;
    }
    return undefined;
  }

  /** Tears the party down entirely — clears all bookkeeping for every current member. */
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
