import { MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_LOADOUT } from "@battlebeasts/shared";

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") displayName = "Hunter";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") hp = 100;
  @type("number") maxHp = 100;
  @type("string") color = "#4ade80";
  @type("number") castLockUntil = 0;
  @type("boolean") disconnected = false;
  @type("number") lastInputSeq = 0;
  /** WoW-style metal purse (stored separately, normalized in game logic). */
  @type("number") copper = 0;
  @type("number") silver = 0;
  @type("number") gold = 0;
  /** Magical currency. */
  @type("number") essence = 0;
  /** Comma-separated ability ids (3 slots). */
  @type("string") loadout = DEFAULT_LOADOUT.join(",");
  /** Comma-separated talent ids. */
  @type("string") talents = "";
}

export class BaseCityState extends Schema {
  @type("number") tick = 0;
  @type("boolean") paused = false;
  /** "pvp_reconnect" | "pve_reconnect" | "resume_grace" | "" */
  @type("string") pauseReason = "";
  /** Server epoch ms when reconnect grace ends (0 if not paused). */
  @type("number") reconnectUntil = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
