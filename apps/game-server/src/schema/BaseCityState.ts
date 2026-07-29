import { MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_LOADOUT, PLAYER_BASE_MAX_HP, PRACTICE_DUMMY_MAX_HP } from "@battlebeasts/shared";

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
  @type("number") hp = PLAYER_BASE_MAX_HP;
  @type("number") maxHp = PLAYER_BASE_MAX_HP;
  @type("string") color = "#4ade80";
  /** Creature hide pattern id (`plain` | `scales` | …). */
  @type("string") pattern = "plain";
  /** Ink color for pattern markings. */
  @type("string") patternColor = "#f8fafc";
  /** Equipped wearable cosmetics (catalog id, or "" = none). */
  @type("string") cosmeticHat = "";
  @type("string") cosmeticShoulders = "";
  @type("string") cosmeticChest = "";
  @type("string") cosmeticGloves = "";
  @type("string") cosmeticBelt = "";
  @type("string") cosmeticLegs = "";
  @type("string") cosmeticShoes = "";
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
  /** Premium placeholder (no match earn / no v1 gates). */
  @type("number") rubies = 0;
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
  /** "flight" | "stuck" | "grounded" — sticky fuse projectiles. */
  @type("string") mode = "flight";
  /** Target id while stuck (empty otherwise). */
  @type("string") stuckTargetId = "";
}

/** Practice dummy / neutral world target. */
export class WorldTargetState extends Schema {
  @type("string") id = "";
  @type("string") kind = "dummy";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") hp = PRACTICE_DUMMY_MAX_HP;
  @type("number") maxHp = PRACTICE_DUMMY_MAX_HP;
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
  @type("string") patternColor = "#f8fafc";
  /** Server epoch ms when this decoy despawns. */
  @type("number") expiresAt = 0;
}

/** Spirit Form husk — body left behind while the caster is unbound. */
export class SpiritHuskState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("string") color = "#4ade80";
  @type("string") pattern = "plain";
  @type("string") patternColor = "#f8fafc";
  /** Server epoch ms when the form started (timer ring clock). */
  @type("number") startedAt = 0;
  /** Server epoch ms when the form expires / snap back. */
  @type("number") expiresAt = 0;
}

/** Persistent Volcano zone — walk collision + client mesh sync. */
export class VolcanoState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") radius = 1.35;
  /** rising | active | sinking */
  @type("string") phase = "rising";
  /** Server epoch ms when the volcano should finish sinking / despawn. */
  @type("number") expiresAt = 0;
}

/** Fixed protection dome — blocks inbound projectiles only. */
export class ProtectionBubbleState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  /** Fully formed radius. */
  @type("number") radius = 4.75;
  /** forming | active | fading */
  @type("string") phase = "forming";
  /** Server epoch ms when form completes. */
  @type("number") formEndsAt = 0;
  /** Server epoch ms when active protection ends (fade begins). */
  @type("number") activeEndsAt = 0;
  /** Server epoch ms when schema entry is deleted. */
  @type("number") expiresAt = 0;
}

/** Planted Spore Shroom — step trap with growth stages. */
export class ShroomState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  /** Step trigger radius. */
  @type("number") triggerRadius = 0.9;
  /** Explosion / spore cloud radius. */
  @type("number") blastRadius = 3.4;
  /** 1 | 2 | 3 growth stage. */
  @type("number") stage = 1;
  /** Which mesh variant from the GLB (0 or 1). */
  @type("number") variant = 0;
  /** False while still casting — visual only until armed. */
  @type("boolean") armed = false;
  /** "alive" | "sinking" — sinking plays a bury anim before delete. */
  @type("string") phase = "alive";
  /** Server epoch ms when the shroom despawns if never triggered. */
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
  @type({ map: SpiritHuskState }) spiritHusks = new MapSchema<SpiritHuskState>();
  @type({ map: VolcanoState }) volcanoes = new MapSchema<VolcanoState>();
  @type({ map: ProtectionBubbleState }) protectionBubbles = new MapSchema<ProtectionBubbleState>();
  @type({ map: ShroomState }) shrooms = new MapSchema<ShroomState>();
}
