export interface PlayerInput {
  seq: number;
  dt: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  castId?: string;
  /** Cancel current cast — only honored during anticipation. */
  cancelCast?: boolean;
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
  | "portal_pve";

export type ClientMessage =
  | { type: "input"; input: PlayerInput }
  | { type: "open_ui"; ui: UiKind }
  | { type: "close_ui" }
  | { type: "portal_confirm"; portal: "pvp" | "pve"; params: Record<string, unknown> }
  | { type: "shop_buy"; itemId: string }
  | { type: "set_loadout"; abilityIds: string[] }
  | { type: "set_talents"; talentIds: string[] }
  | { type: "set_color"; color: string };

export type ServerMessage =
  | { type: "snapshot"; snapshot: WorldSnapshot }
  | { type: "ui"; ui: UiKind }
  | { type: "toast"; message: string }
  | { type: "queue_status"; queued: boolean; modes?: string[] }
  | { type: "transfer"; room: string; roomId?: string; options?: Record<string, unknown> }
  | { type: "inventory"; resources: Record<string, number>; loadout?: string[]; talents?: string[] }
  | {
      type: "match_pause";
      reason: "pvp_reconnect" | "pve_reconnect" | "resume_grace";
      until: number;
      playerName?: string;
    }
  | { type: "match_resume" }
  | { type: "match_forfeit"; playerName: string }
  | { type: "match_rebalance"; remaining: number; playerName?: string }
  | {
      type: "combat_fx";
      kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase";
      abilityId: string;
      x: number;
      z: number;
      radius?: number;
      ownerId?: string;
      targetId?: string;
      phase?: "anticipation" | "cast" | "impact" | "recovery" | "cancel" | "interrupt" | "idle";
      phaseEndsAt?: number;
    };
