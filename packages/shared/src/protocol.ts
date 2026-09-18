import type { NpcAction } from "./npcs";

export interface PlayerInput {
  seq: number;
  dt: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  castId?: string;
  /**
   * Ground aim point for placed abilities (Volcano).
   * Only meaningful when `castId` is set; server clamps to ability range.
   */
  aimX?: number;
  aimZ?: number;
  /** Cancel current cast — only honored while cancelUntilPhase allows. */
  cancelCast?: boolean;
  /** Confirm hold-to-release channel (e.g. Portal Space release). */
  confirmCast?: boolean;
  interactId?: string;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerSnapshot {
  id: string;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  color: string;
  /** Vessel aura id (persisted as `pattern`; see COSMETIC_AURAS). */
  pattern?: string;
  /** Aura ink color. */
  patternColor?: string;
  /** Equipped wearable cosmetic ids (empty string = none). */
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
  castLockUntil: number;
  cooldowns: Record<string, number>;
  disconnected: boolean;
}

export interface WorldSnapshot {
  tick: number;
  serverTime: number;
  lastProcessedInputSeq: Record<string, number>;
  players: PlayerSnapshot[];
  paused: boolean;
  pauseReason?: "pvp_reconnect" | "pve_reconnect" | "resume_grace" | null;
}

export type UiKind =
  | "customization"
  | "build"
  | "talent"
  | "shop"
  | "portal_pvp"
  | "portal_pve"
  | "party_lobby";

export type ClientMessage =
  | { type: "input"; input: PlayerInput }
  | { type: "open_ui"; ui: UiKind }
  | { type: "close_ui" }
  | {
      type: "portal_confirm";
      portal: "pvp" | "pve";
      params: Record<string, unknown>;
    }
  | { type: "shop_buy"; itemId: string }
  | { type: "unlock_ability"; abilityId: string }
  | { type: "set_loadout"; abilityIds: string[] }
  | { type: "save_loadout_preset"; slotIndex: number; abilityIds: string[]; name?: string }
  | { type: "select_loadout_preset"; slotIndex: number }
  | { type: "rename_loadout_preset"; slotIndex: number; name: string }
  | { type: "set_emote_loadout"; emoteSlots: (string | null)[] }
  | { type: "cast_emote"; emoteId: string }
  | { type: "cancel_emote" }
  | { type: "set_talents"; talentIds: string[] }
  | { type: "set_color"; color: string }
  | { type: "set_pattern"; pattern: string; patternColor?: string }
  | { type: "set_pattern_color"; patternColor: string }
  | { type: "set_vessel"; vessel: string }
  | { type: "set_cosmetic"; slot: string; itemId: string | null }
  | { type: "respawn" }
  | { type: "hub_kick"; sessionId: string }
  | { type: "hub_admin_tp_map"; mapId: string }
  | { type: "hub_admin_enter_mode"; modeId: string }
  | { type: "party_invite"; sessionId: string }
  /** Leader invites a friend (by user id) into the open party — often paired with a hub invite. */
  | { type: "party_invite_friend"; userId: string }
  | { type: "party_respond"; accept: boolean; partyId: string }
  | { type: "party_kick"; sessionId: string }
  | { type: "party_set_seat"; sessionId: string; seat: "teamA" | "teamB" | "teamC" | "spectator" }
  | { type: "party_set_layout"; splitSides?: boolean; teamCOpen?: boolean }
  | { type: "party_set_modes"; modes: string[]; family?: "skirmish" | "battleground" }
  | { type: "party_lock"; matchKind?: "ranked" | "unranked" }
  | { type: "party_leave" }
  | { type: "party_cancel" }
  | { type: "hub_ranked_request" }
  | { type: "hub_ranked_leaderboard" }
  | { type: "hub_pve_leaderboard" }
  | { type: "pve_upgrade_pick"; offerId: string }
  | { type: "join_plaza"; plazaId?: string }
  | { type: "join_home" }
  | { type: "join_hub"; hubOwnerId: string }
  | { type: "join_friend_plaza"; userId: string }
  | { type: "list_plazas" }
  | { type: "list_friend_locations"; userIds: string[] }
  | { type: "rematch_vote" }
  | { type: "return_hub" };

export type PartyMemberSnapshot = {
  sessionId: string;
  userId?: string;
  displayName: string;
  seat: "teamA" | "teamB" | "teamC" | "spectator";
  /** False while the hunter is disconnected / logged out. Omitted means online. */
  online?: boolean;
};

export type PartySnapshot = {
  partyId: string;
  leaderSessionId: string;
  /** Defaults to "pvp" when omitted (older snapshots). */
  kind?: "pvp" | "coop_pve";
  modes: string[];
  /** PvP family when kind is pvp (`skirmish` | `battleground`). */
  family?: "skirmish" | "battleground";
  members: PartyMemberSnapshot[];
  /** Outstanding in-hub session invites (legacy / rare). */
  pendingInvites: string[];
  /** Friend user ids invited via hub invite — auto-join party on hub entry. */
  pendingFriendInvites?: string[];
  /** True once the party has been locked into matchmaking. */
  queued?: boolean;
  /** PvP: show Team 1 / Team 2 so everyone can pick a side. Default true. */
  splitSides?: boolean;
  /** PvP skirmish: show an empty Team 3 column. */
  teamCOpen?: boolean;
  /** Battleground custom-side size (2–5). */
  teamSize?: number;
};

export type MatchRecapRewards = {
  essence: number;
  copper: number;
  activityMul: number;
  base: number;
  winBonus: number;
};

export type MatchRecapRanked = {
  label: string;
  mmrDelta: number;
  lpDelta: number;
  lpAfter: number;
  tierBefore: string;
  tierAfter: string;
  divisionBefore: number;
  divisionAfter: number;
  promoted: boolean;
  demoted: boolean;
  placementRemaining: number;
};

export type MatchRecapRow = {
  sessionId: string;
  displayName: string;
  team: string;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  healing: number;
  shield: number;
  rewards?: MatchRecapRewards;
  ranked?: MatchRecapRanked;
};

export type ServerMessage =
  | { type: "snapshot"; snapshot: WorldSnapshot }
  | { type: "ui"; ui: UiKind }
  /**
   * An NPC greeting, sent once the server has confirmed you are stood next to
   * the one you asked to talk to.
   *
   * Carries the authored text rather than an id the client looks up, so the
   * server stays the authority on what a villager says even though both sides
   * hold the same map document.
   */
  | { type: "npc_dialogue"; npcId: string; name: string; line: string; action: NpcAction }
  | { type: "toast"; message: string }
  | {
      type: "queue_status";
      queued: boolean;
      modes?: string[];
      family?: "skirmish" | "battleground";
      lookingFor?: string;
    }
  | { type: "transfer"; room: string; roomId?: string; options?: Record<string, unknown> }
  | { type: "inventory"; resources: Record<string, number>; loadout?: string[]; talents?: string[] }
  | {
      type: "emote_fx";
      sessionId: string;
      emoteId: string;
      phase: "start" | "cancel";
    }
  | {
      type: "match_pause";
      reason: "pvp_reconnect" | "pve_reconnect" | "resume_grace";
      until: number;
      playerName?: string;
    }
  | { type: "match_resume" }
  | { type: "match_forfeit"; playerName: string }
  | { type: "match_rebalance"; remaining: number; playerName?: string }
  | { type: "party_update"; party: PartySnapshot | null }
  | { type: "party_invite"; partyId: string; fromName: string; modes: string[] }
  | { type: "hub_roster"; players: { sessionId: string; displayName: string; isOwner: boolean }[] }
  | {
      type: "match_recap";
      winner: "a" | "b" | "c" | "draw";
      scoreA: number;
      scoreB: number;
      scoreC?: number;
      matchKind?: "ranked" | "custom";
      matchMode?: string;
      rows: MatchRecapRow[];
    }
  | {
      type: "hub_ranked_state";
      season: { id: string; slug: string; starts_at: string; ends_at: string | null; status: string } | null;
      rating: {
        mmr: number;
        lp: number;
        tier: string;
        division: number;
        wins: number;
        losses: number;
        placementRemaining: number;
        peakTier: string;
        gmRank: number | null;
      } | null;
      label: string | null;
    }
  | {
      type: "hub_ranked_leaderboard";
      rows: Array<{
        userId: string;
        displayName: string;
        mmr: number;
        lp: number;
        tier: string;
        division: number;
        rank: number;
      }>;
    }
  | {
      type: "hub_pve_leaderboard";
      rows: Array<{
        partyKey: string;
        memberIds: string[];
        displayName: string;
        wave: number;
        kills: number;
        damageDealt: number;
        partySize: number;
        rank: number;
      }>;
      mine: {
        partyKey: string;
        memberIds: string[];
        displayName: string;
        wave: number;
        kills: number;
        damageDealt: number;
        partySize: number;
        rank: number;
      } | null;
    }
  | {
      type: "pve_upgrades";
      picks: Array<{
        id: string;
        stat: string;
        rarity: string;
        magnitude: number;
        label: string;
        hint: string;
      }>;
    }
  | {
      type: "combat_fx";
      kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase" | "portal";
      abilityId: string;
      x: number;
      z: number;
      /** Portal blink end (kind === "portal"). */
      x2?: number;
      z2?: number;
      radius?: number;
      yaw?: number;
      ownerId?: string;
      targetId?: string;
      damage?: number;
      phase?: "anticipation" | "cast" | "impact" | "recovery" | "cancel" | "interrupt" | "idle";
      phaseEndsAt?: number;
      cooldownMs?: number;
      comboHit?: number;
    }
  | {
      type: "pve_upgrade_draft";
      wave: number;
      kills?: number;
      offers: Array<{
        offerId: string;
        id: string;
        stat: string;
        rarity: string;
        magnitude: number;
        label: string;
        hint: string;
      }>;
      waiting: Array<{ sessionId: string; displayName: string; picked: boolean }>;
    }
  | { type: "pve_upgrade_waiting"; waiting: Array<{ sessionId: string; displayName: string; picked: boolean }> }
  | { type: "plaza_list"; plazas: Array<{ plazaId: string; code: string; clients: number; walkIns: number; walkInCap: number; maxClients: number; roomId: string }>; currentPlazaId?: string }
  | { type: "plaza_state"; plazaId: string; code: string; clients: number; walkIns: number; walkInCap: number }
  | { type: "friend_locations"; locations: Array<{ userId: string; plazaId: string | null; hubOwnerId: string | null }> };
