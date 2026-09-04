import { MapSchema, Schema, type } from "@colyseus/schema";
import {
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  DEFAULT_LOADOUT,
  PLAYER_BASE_MAX_HP,
  PRACTICE_DUMMY_MAX_HP,
  STARTER_COLORS,
} from "@battlebeasts/shared";

export class StatusInstanceState extends Schema {
  /** Map key (usually statusId; per-source statuses use `statusId@sourceId`). */
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
  @type("string") color = STARTER_COLORS[0];
  /** Creature hide pattern id (`plain` | `scales` | …). */
  @type("string") pattern = DEFAULT_COSMETIC_PATTERN;
  /** Ink color for pattern markings. */
  @type("string") patternColor = DEFAULT_COSMETIC_PATTERN_COLOR;
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
  /**
   * Comma-separated flex picks (keys 1-3), empty string for an unused slot --
   * so `",frostBall,"` is a spell in slot 2 only. Positional, because which
   * key a spell sits on is the player's muscle memory, not a detail.
   *
   * Replicated like `loadout`: an opponent's flex picks are part of the read,
   * the same way their Energy is.
   */
  @type("string") flexLoadout = "";
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
  /**
   * Energy, in pips (see `packages/shared/src/energy.ts`). Fractional: it
   * accumulates continuously, and only spending will deal in whole pips.
   *
   * Replicated to everyone, not just its owner. A hidden burst resource makes
   * reads impossible in an arena -- an opponent sitting on a full bar is
   * supposed to be a visible threat.
   */
  @type("number") energy = 0;
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
  /**
   * Ground height. Only attackable map props set it, because only they sit on
   * authored terrain the client would otherwise have to raycast for -- and a
   * raycast from above would hit the prop's own mesh, not the ground under it.
   */
  @type("number") y = 0;
  @type("number") hp = PRACTICE_DUMMY_MAX_HP;
  @type("number") maxHp = PRACTICE_DUMMY_MAX_HP;
  /**
   * Hit footprint, when it is not player-sized. Zero means "use the default",
   * which is every target except an attackable map prop -- those take theirs
   * from the prop's collider so a barn is not as hard to hit as a fencepost.
   */
  @type("number") radius = 0;
  /** Mirror of player cast fields for attack anim sync. */
  @type("string") castAbilityId = "";
  @type("string") castPhase = "";
  @type("number") castLockUntil = 0;
  @type({ map: StatusInstanceState }) statuses = new MapSchema<StatusInstanceState>();
}

/** Visual clone from Decoy (Q) — drifts or idles; absorbs hits while owner is cloaked. */
export class DecoyState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") vx = 0;
  @type("number") vz = 0;
  @type("string") color = STARTER_COLORS[0];
  @type("string") pattern = DEFAULT_COSMETIC_PATTERN;
  @type("string") patternColor = DEFAULT_COSMETIC_PATTERN_COLOR;
  /** Mirrors owner HP at spawn; depleted by incoming damage. */
  @type("number") hp = 100;
  @type("number") maxHp = 100;
  /** Ground aim destination the decoy walks toward (cast-time). */
  @type("number") targetX = 0;
  @type("number") targetZ = 0;
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
  @type("string") color = STARTER_COLORS[0];
  @type("string") pattern = DEFAULT_COSMETIC_PATTERN;
  @type("string") patternColor = DEFAULT_COSMETIC_PATTERN_COLOR;
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

/** Linked Rift Fissure mouth — walk-through teleport when paired. */
export class RiftPortalState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  /** Empty while waiting for the second plant. */
  @type("string") pairId = "";
  /** 0 = first portal, 1 = second. */
  @type("number") index = 0;
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") radius = 1;
  /** "arming" | "open" | "closing" */
  @type("string") phase = "arming";
  /** Server epoch ms when arm window ends (portal A only). */
  @type("number") armEndsAt = 0;
  /** Server epoch ms when the portal despawns. */
  @type("number") expiresAt = 0;
}

/** Orbiting Wisp — persistent orbiting entity synced for client VFX + collision. */
export class OrbitingWispState extends Schema {
  @type("string") id = "";
  @type("string") ownerSessionId = "";
  @type("string") abilityId = "orbitingWisp";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") y = 1.15;
  /** Slot phase offset (radians); shared clock + this = world angle. */
  @type("number") orbitPhase = 0;
  /** Server epoch ms when the wisp was created. */
  @type("number") spawnedAt = 0;
  /** Server epoch ms when collision becomes active. */
  @type("number") armedAt = 0;
  /** Server epoch ms when the wisp expires if unused. */
  @type("number") expiresAt = 0;
}

/** Astral Chain tether — synced for client rope VFX between caster and target. */
export class AstralChainState extends Schema {
  @type("string") id = "";
  @type("string") casterId = "";
  @type("string") targetId = "";
  @type("string") abilityId = "astralChain";
  /** Server epoch ms when the tether started. */
  @type("number") startedAt = 0;
  /** Server epoch ms when the tether expires. */
  @type("number") endsAt = 0;
  /** Max separation (m) captured at impact. */
  @type("number") maxDistance = 1.5;
}

/** Soul Sever imprint — fixed origin + live target for client echo / thread VFX. */
export class SoulSeverState extends Schema {
  @type("string") id = "";
  @type("string") casterId = "";
  @type("string") targetId = "";
  @type("string") abilityId = "soulSever";
  @type("number") originX = 0;
  @type("number") originZ = 0;
  @type("number") startedAt = 0;
  @type("number") endsAt = 0;
}

/** Hub plaza beach ball (owner-purchased, 0–2 per lobby). */
export class HubBallState extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") z = 0;
  @type("number") vx = 0;
  @type("number") vz = 0;
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
  /** Third side score (Arena 1v1v1 FFA). Unused in classic A/B modes. */
  @type("number") scoreC = 0;
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
  @type({ map: RiftPortalState }) riftPortals = new MapSchema<RiftPortalState>();
  @type({ map: OrbitingWispState }) orbitingWisps = new MapSchema<OrbitingWispState>();
  @type({ map: AstralChainState }) astralChains = new MapSchema<AstralChainState>();
  @type({ map: SoulSeverState }) soulSevers = new MapSchema<SoulSeverState>();
  /** How many beach balls the lobby owner has purchased (0–2). */
  @type("number") beachBallCount = 0;
  /** Hub owner's account id (for own-lobby shop gates). */
  @type("string") hubOwnerUserId = "";
  @type({ map: HubBallState }) hubBalls = new MapSchema<HubBallState>();
}
