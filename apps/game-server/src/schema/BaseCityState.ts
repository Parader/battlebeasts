import { MapSchema, Schema, type } from "@colyseus/schema";

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
}

export class BaseCityState extends Schema {
  @type("number") tick = 0;
  @type("boolean") paused = false;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
