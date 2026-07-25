import { MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_LOADOUT } from "@battlebeasts/shared";

export class StatusInstanceState extends Schema {
  /** Same as statusId for map key stability (one row per status id). */
  @type("string") id = "";
  @type("string") statusId = "";
  @type("number") expiresAt = 0;
  @type("number") stacks = 1;
  @type("number") nextTickAt = 0;
  @type("string") sourceId = "";
}

export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") displayName = "Hunter";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") hp = 100;
  @type("number") maxHp = 100;
  @type("string") color = "#4ade80";
  /** Creature hide pattern id (`plain` | `scales` | …). */
  @type("string") pattern = "plain";
  /** Ink color for pattern markings. */
  @type("string") patternColor = "#1f2937";
  @type("number") castLockUntil = 0;
  /** "" | anticipation | cast | impact | recovery */
  @type("string") castPhase = "";
  @type("string") castAbilityId = "";
  /** 1-based combo swing index while casting a combo ability; 0 otherwise. */
  @type("number") castComboHit = 0;
  /** Server epoch ms when current cast phase ends. */
  @type("number") castPhaseEndsAt = 0;
  /** True while inside configured i-frame window. */
  @type("boolean") invulnerable = false;
  @type("boolean") disconnected = false;
  @type("number") lastInputSeq = 0;
  /** WoW-style metal purse (stored separately, normalized in game logic). */
  @type("number") copper = 0;
  @type("number") silver = 0;
  @type("number") gold = 0;
  /** Magical currency. */
  @type("number") essence = 0;
  /** Comma-separated ability ids (Battlerite slots). */
  @type("string") loadout = DEFAULT_LOADOUT.join(",");
  /** Comma-separated talent ids. */
  @type("string") talents = "";
  /** Arena: "a" | "b" | "" */
  @type("string") team = "";
  /** Arena: "fighter" | "spectator" */
  @type("string") role = "fighter";
  /** Dead for current round (fighters only). */
  @type("boolean") roundDead = false;
  /** Match stats (arena). */
  @type("number") statKills = 0;
  @type("number") statDamageDealt = 0;
  @type("number") statDamageTaken = 0;
  @type("number") statHealing = 0;
  @type("number") statShield = 0;
  /** Rematch vote while phase is rematch_wait. */
  @type("boolean") rematchReady = false;
  @type({ map: StatusInstanceState }) statuses = new MapSchema<StatusInstanceState>();
}

export class ProjectileState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("string") abilityId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") vx = 0;
  @type("number") vz = 0;
  @type("number") radius = 0.35;
  /** Outer slow shell for aura projectiles (0 = none). */
  @type("number") slowRadius = 0;
}

/** Practice dummy / neutral world target. */
export class WorldTargetState extends Schema {
  @type("string") id = "";
  @type("string") kind = "dummy";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") hp = 200;
  @type("number") maxHp = 200;
  /** Mirror of player cast fields for attack anim sync. */
  @type("string") castAbilityId = "";
  @type("string") castPhase = "";
  @type("number") castLockUntil = 0;
  @type({ map: StatusInstanceState }) statuses = new MapSchema<StatusInstanceState>();
}

/** Visual clone from Decoy (Q) — drifts or idles; not a combat body. */
export class DecoyState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") vx = 0;
  @type("number") vz = 0;
  @type("string") color = "#4ade80";
  @type("string") pattern = "plain";
  @type("string") patternColor = "#1f2937";
  /** Server epoch ms when this decoy despawns. */
  @type("number") expiresAt = 0;
}

export class BaseCityState extends Schema {
  @type("number") tick = 0;
  @type("boolean") paused = false;
  /** "pvp_reconnect" | "pve_reconnect" | "resume_grace" | "" */
  @type("string") pauseReason = "";
  /** Server epoch ms when reconnect grace ends (0 if not paused). */
  @type("number") reconnectUntil = 0;
  /** Arena match phase (empty in hub). */
  @type("string") matchPhase = "";
  @type("number") matchRound = 0;
  @type("number") scoreA = 0;
  @type("number") scoreB = 0;
  @type("number") phaseEndsAt = 0;
  @type("string") matchMode = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: ProjectileState }) projectiles = new MapSchema<ProjectileState>();
  @type({ map: WorldTargetState }) targets = new MapSchema<WorldTargetState>();
  @type({ map: DecoyState }) decoys = new MapSchema<DecoyState>();
}
