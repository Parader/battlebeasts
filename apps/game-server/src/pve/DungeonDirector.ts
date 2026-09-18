import {
  ABILITIES,
  COLLISION,
  DUNGEON_BOSS_ENRAGE_CD_MUL,
  DUNGEON_BOSS_ENRAGE_HP,
  PVE_BOSS_KIND,
  PVE_ELITE_HP_MUL,
  PVE_ELITE_KIND,
  PVE_ELITE_SPEED_MUL,
  PVE_ZOMBIE_KIND,
  PVE_ZOMBIE_MELEE_COOLDOWN_MS,
  PVE_ZOMBIE_MELEE_DAMAGE,
  PVE_ZOMBIE_MELEE_RANGE,
  PVE_ZOMBIE_RETARGET_MS,
  PVE_ZOMBIE_BASE_HP,
  clampInstancePartySize,
  dungeonAggroRadius,
  dungeonBossAura,
  dungeonBossHitRadius,
  dungeonBossHp,
  dungeonBossKit,
  dungeonBossScale,
  dungeonCircleRadius,
  dungeonElementPool,
  dungeonElementStage,
  dungeonObjectiveDurationMs,
  dungeonObjectiveTag,
  dungeonPackCount,
  dungeonPackElites,
  dungeonRoamRadius,
  dungeonRunChestDepth,
  hashSeed,
  instanceExtraFodder,
  instancePartyDamageMul,
  instancePartyHpMul,
  instanceStageDamageMul,
  instanceStageHpMul,
  isPveInstanceMobKind,
  mulberry32,
  phaseDurationMs,
  pveEliteComfortRange,
  pveEliteCooldownMs,
  pveElitePickAbility,
  pveEliteProjectileDamage,
  pveEliteProjectileSpeedMul,
  pveEliteStrafeDir,
  pveWaveSpeed,
  pveZombieSpeedMul,
  type DungeonRunChestDepth,
  type MapElement,
  type MapDoc,
  mobWalkYaw,
} from "@battlebeasts/shared";
import { mapElementsOfType } from "@battlebeasts/shared";
import type { CombatSystem } from "../combat/CombatSystem.js";
import type { BaseCityState } from "../schema/BaseCityState.js";

export type DungeonHud = {
  wave: number;
  phase: string;
  alive: number;
  goal: number;
  label?: string;
};

type LivingPlayer = { id: string; x: number; z: number };

type PackGroup = {
  elementId: string;
  required: boolean;
  mobIds: string[];
  origin: { x: number; z: number };
  aggroRadius: number;
  roamRadius: number;
  aggroed: boolean;
};

type BossGroup = {
  elementId: string;
  required: boolean;
  mobId: string;
  origin: { x: number; z: number };
  aggroRadius: number;
  aggroed: boolean;
  stage: number;
};

type ObjectiveRuntime = {
  element: MapElement;
  tag: "hold" | "survive";
  radius: number;
  durationMs: number;
  heldMs: number;
  started: boolean;
  done: boolean;
  ambushSpawned: boolean;
};

/**
 * Authored dungeon instance — packs wait for aggro, one optional wing fires,
 * required boss death unlocks the exit. No wave clock, no upgrade drafts.
 */
export class DungeonDirector {
  private nextId = 1;
  private started = false;
  private stopped = false;
  private readonly partySize: number;
  private seedKey = "";

  private meleeCd = new Map<string, number>();
  private retargetAt = new Map<string, number>();
  private targetSession = new Map<string, string>();
  private speedById = new Map<string, number>();
  private damageById = new Map<string, number>();
  private eliteKit = new Map<string, string[]>();
  private pendingReleaseAt = new Map<string, number>();
  private pendingAimYaw = new Map<string, number>();
  private pendingAbility = new Map<string, string>();
  private eliteAbilityCd = new Map<string, number>();
  private eliteLastAbility = new Map<string, string>();
  private stageById = new Map<string, number>();
  private enraged = new Set<string>();

  private packs: PackGroup[] = [];
  private bosses: BossGroup[] = [];
  private objective: ObjectiveRuntime | null = null;

  private packCleared = false;
  private optionalDone = false;
  private requiredBossesDead = false;
  private exitUnlocked = false;

  constructor(
    private readonly state: BaseCityState,
    private readonly combat: CombatSystem,
    private readonly broadcastHud: (hud: DungeonHud) => void,
    private readonly onExitUnlock: () => void,
    partySize = 1,
    private readonly doc: MapDoc | null = null,
  ) {
    this.partySize = clampInstancePartySize(partySize);
  }

  start(now: number, seedKey: string) {
    if (this.started) return;
    this.started = true;
    this.seedKey = seedKey;
    this.spawnRun(now, seedKey);
    this.pushHud();
  }

  stop() {
    this.stopped = true;
  }

  resetRun(now: number, seedKey: string) {
    this.stopped = false;
    this.started = true;
    this.seedKey = seedKey;
    this.clearMobs();
    this.spawnRun(now, seedKey);
    this.pushHud();
  }

  exitIsUnlocked(): boolean {
    return this.exitUnlocked;
  }

  chestDepth(): DungeonRunChestDepth {
    return dungeonRunChestDepth({
      packCleared: this.packCleared,
      optionalDone: this.optionalDone,
      bossKilled: this.requiredBossesDead,
    });
  }

  checkpointWave(): number {
    if (this.requiredBossesDead) return 3;
    if (this.optionalDone) return 2;
    if (this.packCleared) return 1;
    return 0;
  }

  onTargetKilled(id: string) {
    this.forgetMob(id);
    this.refreshCheckpoints();
    this.pushHud();
  }

  tick(dt: number, now: number) {
    if (!this.started || this.stopped) return;
    this.tickObjective(dt, now);
    this.tickMobs(dt, now);
    this.separateMobs();
    this.refreshCheckpoints();
  }

  private spawnRun(_now: number, seedKey: string) {
    this.packCleared = false;
    this.optionalDone = false;
    this.requiredBossesDead = false;
    this.exitUnlocked = false;
    this.state.dungeonExitUnlocked = false;
    this.packs = [];
    this.bosses = [];
    this.objective = null;
    this.enraged.clear();

    if (!this.doc) return;
    const rng = mulberry32(hashSeed(seedKey));

    const requiredPacks = mapElementsOfType(this.doc, "dungeon_pack").filter(
      (el) => dungeonElementPool(el) === "required",
    );
    const requiredBosses = mapElementsOfType(this.doc, "dungeon_boss").filter(
      (el) => dungeonElementPool(el) === "required",
    );
    const optionalPacks = mapElementsOfType(this.doc, "dungeon_pack").filter(
      (el) => dungeonElementPool(el) === "optional",
    );
    const optionalBosses = mapElementsOfType(this.doc, "dungeon_boss").filter(
      (el) => dungeonElementPool(el) === "optional",
    );
    const optionalObjectives = mapElementsOfType(this.doc, "dungeon_objective");

    const optionalPool: Array<
      | { kind: "pack"; el: MapElement }
      | { kind: "boss"; el: MapElement }
      | { kind: "objective"; el: MapElement }
    > = [
      ...optionalPacks.map((el) => ({ kind: "pack" as const, el })),
      ...optionalBosses.map((el) => ({ kind: "boss" as const, el })),
      ...optionalObjectives.map((el) => ({ kind: "objective" as const, el })),
    ];

    for (const el of requiredPacks) this.spawnPack(el, true);
    for (const el of requiredBosses) this.spawnBoss(el, true);

    if (optionalPool.length > 0) {
      const pick = optionalPool[Math.floor(rng() * optionalPool.length)]!;
      if (pick.kind === "pack") this.spawnPack(pick.el, false);
      else if (pick.kind === "boss") this.spawnBoss(pick.el, false);
      else this.armObjective(pick.el);
    }
  }

  private spawnPack(el: MapElement, required: boolean) {
    const stage = dungeonElementStage(el);
    const elites = dungeonPackElites(el);
    const fodder = dungeonPackCount(el) + (required ? instanceExtraFodder(this.partySize) : 0);
    const aggroRadius = dungeonAggroRadius(el);
    const roamRadius = dungeonRoamRadius(el);
    const mobIds: string[] = [];
    let ordinal = 0;
    for (let i = 0; i < fodder; i++) {
      mobIds.push(this.spawnFodder(el.x, el.z, el.yaw, stage, ordinal++, i, fodder + elites));
    }
    for (let i = 0; i < elites; i++) {
      mobIds.push(
        this.spawnCaster(
          el.x,
          el.z,
          el.yaw,
          stage,
          ordinal++,
          fodder + i,
          fodder + elites,
          ["iceLance", "poisonDart", "frostBall"][i % 3]!,
        ),
      );
    }
    this.packs.push({
      elementId: el.id,
      required,
      mobIds,
      origin: { x: el.x, z: el.z },
      aggroRadius,
      roamRadius,
      aggroed: false,
    });
  }

  private spawnBoss(el: MapElement, required: boolean) {
    const stage = dungeonElementStage(el);
    const hpMul = instancePartyHpMul(this.partySize) * instanceStageHpMul(stage);
    const dmgMul = instancePartyDamageMul(this.partySize) * instanceStageDamageMul(stage);
    const hp = Math.round(dungeonBossHp(el) * hpMul);
    const scale = dungeonBossScale(el);
    const aura = dungeonBossAura(el);
    const kit = dungeonBossKit(el);
    const id = `boss_${this.nextId++}`;
    const yaw = el.yaw;
    this.combat.spawnWaveMob(id, el.x, el.z, {
      kind: PVE_BOSS_KIND,
      hp,
      yaw,
      abilityId: kit[0] ?? "",
      scale,
      aura,
      radius: dungeonBossHitRadius(scale),
    });
    this.speedById.set(id, pveWaveSpeed(stage) * PVE_ELITE_SPEED_MUL * 0.9);
    this.damageById.set(id, Math.round(PVE_ZOMBIE_MELEE_DAMAGE * dmgMul * 1.15));
    this.eliteKit.set(id, kit);
    this.stageById.set(id, stage);
    this.bosses.push({
      elementId: el.id,
      required,
      mobId: id,
      origin: { x: el.x, z: el.z },
      aggroRadius: dungeonAggroRadius(el) || 14,
      aggroed: false,
      stage,
    });
  }

  private spawnFodder(
    ox: number,
    oz: number,
    yaw: number,
    stage: number,
    ordinal: number,
    index: number,
    total: number,
  ): string {
    const id = `zombie_${this.nextId++}`;
    const pos = this.ringOffset(ox, oz, index, total);
    const hpMul = instancePartyHpMul(this.partySize) * instanceStageHpMul(stage);
    const dmgMul = instancePartyDamageMul(this.partySize) * instanceStageDamageMul(stage);
    const hp = Math.round(PVE_ZOMBIE_BASE_HP * hpMul);
    this.combat.spawnWaveMob(id, pos.x, pos.z, { kind: PVE_ZOMBIE_KIND, hp, yaw });
    this.speedById.set(id, pveWaveSpeed(stage) * pveZombieSpeedMul(ordinal));
    this.damageById.set(id, Math.round(PVE_ZOMBIE_MELEE_DAMAGE * dmgMul));
    this.stageById.set(id, stage);
    return id;
  }

  private spawnCaster(
    ox: number,
    oz: number,
    yaw: number,
    stage: number,
    ordinal: number,
    index: number,
    total: number,
    signature: string,
  ): string {
    const id = `elite_${this.nextId++}`;
    const pos = this.ringOffset(ox, oz, index, total);
    const hpMul = instancePartyHpMul(this.partySize) * instanceStageHpMul(stage);
    const dmgMul = instancePartyDamageMul(this.partySize) * instanceStageDamageMul(stage);
    const hp = Math.round(PVE_ZOMBIE_BASE_HP * PVE_ELITE_HP_MUL * hpMul);
    this.combat.spawnWaveMob(id, pos.x, pos.z, {
      kind: PVE_ELITE_KIND,
      hp,
      yaw,
      abilityId: signature,
    });
    this.speedById.set(id, pveWaveSpeed(stage) * PVE_ELITE_SPEED_MUL);
    this.damageById.set(id, Math.round(PVE_ZOMBIE_MELEE_DAMAGE * dmgMul));
    this.eliteKit.set(id, [signature, "iceLance", "poisonDart"].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3));
    this.stageById.set(id, stage);
    return id;
  }

  private armObjective(el: MapElement) {
    this.objective = {
      element: el,
      tag: dungeonObjectiveTag(el),
      radius: dungeonCircleRadius(el, 4),
      durationMs: dungeonObjectiveDurationMs(el),
      heldMs: 0,
      started: false,
      done: false,
      ambushSpawned: false,
    };
  }

  private ringOffset(ox: number, oz: number, index: number, total: number): { x: number; z: number } {
    if (total <= 1) return { x: ox, z: oz };
    const a = (index / total) * Math.PI * 2;
    const r = 1.2;
    return { x: ox + Math.sin(a) * r, z: oz + Math.cos(a) * r };
  }

  private livingPlayers(): LivingPlayer[] {
    const out: LivingPlayer[] = [];
    this.state.players.forEach((p, id) => {
      if (p.disconnected || p.role === "spectator" || p.hp <= 0) return;
      out.push({ id, x: p.x, z: p.z });
    });
    return out;
  }

  private tickObjective(dt: number, now: number) {
    const obj = this.objective;
    if (!obj || obj.done) return;
    const living = this.livingPlayers();
    const inside = living.some(
      (p) => Math.hypot(p.x - obj.element.x, p.z - obj.element.z) <= obj.radius,
    );
    if (obj.tag === "hold") {
      if (inside) {
        obj.started = true;
        obj.heldMs += dt * 1000;
        if (obj.heldMs >= obj.durationMs) this.completeOptional();
      }
      return;
    }
    if (inside || obj.started) {
      if (!obj.started) {
        obj.started = true;
        if (!obj.ambushSpawned) {
          obj.ambushSpawned = true;
          this.spawnAmbush(obj.element, now);
        }
      }
      obj.heldMs += dt * 1000;
      if (obj.heldMs >= obj.durationMs) this.completeOptional();
    }
  }

  private spawnAmbush(el: MapElement, _now: number) {
    const stage = Math.max(1, dungeonElementStage(el));
    const fake: MapElement = {
      ...el,
      type: "dungeon_pack",
      params: {
        ...el.params,
        stage,
        count: 3,
        elites: 1,
        pool: "optional",
        aggroRadius: 16,
      },
    };
    this.spawnPack(fake, false);
    const pack = this.packs[this.packs.length - 1];
    if (pack) pack.aggroed = true;
  }

  private completeOptional() {
    if (this.optionalDone) return;
    this.optionalDone = true;
    if (this.objective) this.objective.done = true;
    this.pushHud();
  }

  private tickMobs(dt: number, now: number) {
    const living = this.livingPlayers();
    this.updateAggro(living);
    if (living.length > 0) this.combat.refreshMobFlow(living, now);

    this.state.targets.forEach((t, id) => {
      if (!isPveInstanceMobKind(t.kind) || t.hp <= 0) return;
      if (!this.isAggroed(id)) return;
      if (t.kind === PVE_BOSS_KIND && t.hp / Math.max(1, t.maxHp) <= DUNGEON_BOSS_ENRAGE_HP) {
        this.enraged.add(id);
      }
      if (living.length === 0) return;
      const focus = this.pickFocus(id, t, living, now);
      const dx = focus.x - t.x;
      const dz = focus.z - t.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      if (t.kind === PVE_ZOMBIE_KIND) {
        this.tickZombie(id, t, focus, dx, dz, dist, dt, now);
      } else {
        this.tickElite(id, t, focus, dx, dz, dist, dt, now);
      }
    });
  }

  private updateAggro(living: LivingPlayer[]) {
    for (const pack of this.packs) {
      if (pack.aggroed) continue;
      const hit = living.some(
        (p) => Math.hypot(p.x - pack.origin.x, p.z - pack.origin.z) <= pack.aggroRadius,
      );
      if (hit) pack.aggroed = true;
    }
    for (const boss of this.bosses) {
      if (boss.aggroed) continue;
      const t = this.state.targets.get(boss.mobId);
      if (t && t.hp < t.maxHp) {
        boss.aggroed = true;
        continue;
      }
      const hit = living.some(
        (p) => Math.hypot(p.x - boss.origin.x, p.z - boss.origin.z) <= boss.aggroRadius,
      );
      if (hit) boss.aggroed = true;
    }
  }

  private isAggroed(id: string): boolean {
    for (const pack of this.packs) {
      if (pack.mobIds.includes(id)) return pack.aggroed;
    }
    for (const boss of this.bosses) {
      if (boss.mobId === id) return boss.aggroed;
    }
    return true;
  }

  private pickFocus(
    id: string,
    t: { x: number; z: number },
    living: LivingPlayer[],
    now: number,
  ): LivingPlayer {
    let focusId = this.targetSession.get(id);
    const until = this.retargetAt.get(id) ?? 0;
    if (!focusId || until <= now || !living.some((p) => p.id === focusId)) {
      let best = living[0]!;
      let bestD = Infinity;
      for (const p of living) {
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      focusId = best.id;
      this.targetSession.set(id, focusId);
      this.retargetAt.set(id, now + PVE_ZOMBIE_RETARGET_MS);
    }
    return living.find((p) => p.id === focusId) ?? living[0]!;
  }

  private mobCrowdControl(id: string): {
    canMove: boolean;
    canCast: boolean;
    feared: boolean;
    speedMul: number;
  } {
    return {
      canMove: this.combat.statuses.canMove(id),
      canCast: this.combat.statuses.canCast(id),
      feared: Boolean(this.combat.getFearSource(id)),
      speedMul: Math.max(0, this.combat.statuses.getMoveMul(id)),
    };
  }

  private tickZombie(
    id: string,
    t: { x: number; z: number; yaw: number; castAbilityId: string; castPhase: string; castLockUntil: number },
    focus: LivingPlayer,
    dx: number,
    dz: number,
    dist: number,
    dt: number,
    now: number,
  ) {
    const cc = this.mobCrowdControl(id);
    if (!cc.canCast && t.castLockUntil && now < t.castLockUntil) {
      t.castAbilityId = "";
      t.castPhase = "";
      t.castLockUntil = 0;
    }
    const speed = (this.speedById.get(id) ?? 3) * cc.speedMul;
    if (cc.feared && cc.canMove) {
      this.fleeElite(id, t, speed, dt);
      return;
    }
    if (!cc.canMove) return;
    const attacking = Boolean(t.castLockUntil && now < t.castLockUntil);
    if (attacking) {
      t.yaw = mobWalkYaw(t.yaw, 0, 0, dx, dz, dt, true);
    } else if (dist > PVE_ZOMBIE_MELEE_RANGE * 0.85) {
      const step = Math.min(dist - 0.4, speed * dt);
      const from = { x: t.x, z: t.z };
      const desired = this.combat.steerWaveMob(from, { x: focus.x, z: focus.z }, step);
      const next = this.combat.moveWaveMob(id, from, desired);
      t.yaw = mobWalkYaw(t.yaw, next.x - from.x, next.z - from.z, dx, dz, dt, false);
      t.x = next.x;
      t.z = next.z;
    } else if (cc.canCast) {
      t.yaw = mobWalkYaw(t.yaw, 0, 0, dx, dz, dt, true);
      const ready = (this.meleeCd.get(id) ?? 0) <= now;
      if (ready) {
        const dmg = this.damageById.get(id) ?? 8;
        this.combat.npcStrikePlayer(id, focus.id, dmg, "zombie_melee");
        this.meleeCd.set(id, now + PVE_ZOMBIE_MELEE_COOLDOWN_MS);
        t.castAbilityId = "zombie_melee";
        t.castPhase = "impact";
        t.castLockUntil = now + 700;
      }
    } else {
      t.yaw = mobWalkYaw(t.yaw, 0, 0, dx, dz, dt, true);
    }
  }

  private tickElite(
    id: string,
    t: {
      x: number;
      z: number;
      yaw: number;
      hp: number;
      maxHp: number;
      castAbilityId: string;
      castPhase: string;
      castLockUntil: number;
    },
    focus: LivingPlayer,
    dx: number,
    dz: number,
    dist: number,
    dt: number,
    now: number,
  ) {
    const kit = this.eliteKit.get(id) ?? [t.castAbilityId || "iceLance"];
    const lastId = this.eliteLastAbility.get(id) ?? null;
    const readyIds = new Set(
      kit.filter((spell) => (this.eliteAbilityCd.get(`${id}:${spell}`) ?? 0) <= now),
    );
    const abilityId = pveElitePickAbility(kit, dist, { readyIds, lastId });
    const def = ABILITIES[abilityId];
    const comfort = pveEliteComfortRange(abilityId);
    const from = { x: t.x, z: t.z };
    const to = { x: focus.x, z: focus.z };
    const los = this.combat.hasWorldLos(from, to);
    const cc = this.mobCrowdControl(id);
    const speed = (this.speedById.get(id) ?? 2.4) * cc.speedMul;
    let pendingAt = this.pendingReleaseAt.get(id) ?? 0;

    if (cc.feared || !cc.canCast) {
      if (t.castAbilityId || pendingAt > 0) this.clearEliteCast(id, t);
      pendingAt = 0;
      if (cc.feared && cc.canMove) this.fleeElite(id, t, speed, dt);
      if (!cc.canMove || cc.feared) return;
    }

    if (
      (t.castAbilityId || pendingAt > 0) &&
      this.combat.checkDreadAuraTriggerTarget(id, t.x, t.z, now)
    ) {
      this.clearEliteCast(id, t);
      return;
    }

    if (pendingAt > 0) {
      this.pendingAimYaw.set(id, t.yaw);
      if (now >= pendingAt) this.releaseEliteCast(id, t, dist, los, now);
    }

    if (t.castAbilityId && t.castLockUntil > 0) {
      this.advanceElitePhases(id, t, now);
    }

    const casting = Boolean(t.castLockUntil && now < t.castLockUntil);
    if (casting || !cc.canMove) {
      if (casting) t.yaw = mobWalkYaw(t.yaw, 0, 0, dx, dz, dt, true);
      return;
    }

    const nx = dx / dist;
    const nz = dz / dist;
    const inCastRange = dist <= comfort.maxCast;
    const tooClose = dist < comfort.min;
    const tooFar = dist > comfort.max || !los;

    if (tooFar || tooClose) {
      const step = speed * dt;
      let desired: { x: number; z: number };
      if (!los || tooFar) {
        desired = this.combat.steerWaveMob(from, { x: focus.x, z: focus.z }, step);
      } else {
        desired = {
          x: t.x + -nx * step,
          z: t.z + -nz * step,
        };
      }
      const next = this.combat.moveWaveMob(id, from, desired);
      t.yaw = mobWalkYaw(t.yaw, next.x - from.x, next.z - from.z, dx, dz, dt, false);
      t.x = next.x;
      t.z = next.z;
    } else if (inCastRange) {
      const step = speed * dt * 0.55;
      const strafe = pveEliteStrafeDir(nx, nz, id);
      const next = this.combat.moveWaveMob(
        id,
        from,
        { x: t.x + strafe.x * step, z: t.z + strafe.z * step },
      );
      t.yaw = mobWalkYaw(t.yaw, next.x - from.x, next.z - from.z, dx, dz, dt, true);
      t.x = next.x;
      t.z = next.z;
    }

    if (
      cc.canCast &&
      los &&
      inCastRange &&
      pendingAt <= 0 &&
      (this.meleeCd.get(id) ?? 0) <= now &&
      readyIds.has(abilityId) &&
      !t.castAbilityId &&
      def
    ) {
      if (this.combat.checkDreadAuraTriggerTarget(id, t.x, t.z, now)) {
        this.clearEliteCast(id, t);
        return;
      }
      this.beginEliteCast(id, t, abilityId, now);
    }
  }

  private beginEliteCast(
    id: string,
    t: { yaw: number; castAbilityId: string; castPhase: string; castLockUntil: number },
    abilityId: string,
    now: number,
  ) {
    const def = ABILITIES[abilityId];
    if (!def) return;
    const windupMs = phaseDurationMs(def, "anticipation") + phaseDurationMs(def, "cast");
    const impactMs = phaseDurationMs(def, "impact");
    const recoveryMs = phaseDurationMs(def, "recovery");
    const totalMs = Math.max(280, windupMs + impactMs + recoveryMs);
    t.castAbilityId = abilityId;
    t.castPhase = "cast";
    t.castLockUntil = now + totalMs;
    this.pendingAbility.set(id, abilityId);
    this.pendingAimYaw.set(id, t.yaw);
    this.pendingReleaseAt.set(id, now + Math.max(80, windupMs));
  }

  private releaseEliteCast(
    id: string,
    t: { x: number; z: number; yaw: number; hp: number; maxHp: number; castAbilityId: string; castPhase: string },
    dist: number,
    los: boolean,
    now: number,
  ) {
    const abilityId = this.pendingAbility.get(id) ?? t.castAbilityId;
    this.pendingReleaseAt.set(id, 0);
    const def = ABILITIES[abilityId];
    const maxCast = pveEliteComfortRange(abilityId || "iceLance").maxCast;
    if (!def || !los || dist > maxCast * 1.18) {
      this.meleeCd.set(id, now + 280);
      return;
    }
    const yaw = this.pendingAimYaw.get(id) ?? t.yaw;
    const waveDmg = this.damageById.get(id) ?? 8;
    const scaled = pveEliteProjectileDamage(abilityId, waveDmg);
    const speedMul = pveEliteProjectileSpeedMul(abilityId);
    this.combat.fireProjectileFrom(
      id,
      {
        id,
        x: t.x,
        z: t.z,
        yaw,
        hp: t.hp,
        maxHp: t.maxHp,
        vulnerable: true,
      },
      abilityId,
      {
        ...(scaled != null ? { damage: scaled } : {}),
        ...(speedMul !== 1 ? { speedMul } : {}),
      },
    );
    t.castPhase = "impact";
    this.meleeCd.set(id, now + 1100);
    const stage = this.stageById.get(id) ?? 3;
    let cd = pveEliteCooldownMs(abilityId, Math.max(2, stage + 1));
    if (this.enraged.has(id)) cd = Math.max(900, Math.round(cd * DUNGEON_BOSS_ENRAGE_CD_MUL));
    this.eliteAbilityCd.set(`${id}:${abilityId}`, now + cd);
    this.eliteLastAbility.set(id, abilityId);
  }

  private advanceElitePhases(
    id: string,
    t: { castAbilityId: string; castPhase: string; castLockUntil: number },
    now: number,
  ) {
    const def = ABILITIES[t.castAbilityId];
    if (!def || t.castLockUntil <= 0) return;
    const impactMs = phaseDurationMs(def, "impact");
    const recoveryMs = phaseDurationMs(def, "recovery");
    const recoveryStart = t.castLockUntil - recoveryMs;
    const impactStart = recoveryStart - impactMs;
    if (now >= recoveryStart) t.castPhase = "recovery";
    else if (now >= impactStart) t.castPhase = "impact";
  }

  private clearEliteCast(
    id: string,
    t: { castAbilityId: string; castPhase: string; castLockUntil: number },
  ) {
    t.castAbilityId = "";
    t.castPhase = "";
    t.castLockUntil = 0;
    this.pendingReleaseAt.set(id, 0);
    this.pendingAbility.delete(id);
    this.pendingAimYaw.delete(id);
  }

  private fleeElite(
    id: string,
    t: { x: number; z: number; yaw: number },
    speed: number,
    dt: number,
  ) {
    const fearId = this.combat.getFearSource(id);
    const src = fearId
      ? (this.state.players.get(fearId) ?? this.state.targets.get(fearId))
      : undefined;
    let fx = Math.sin(t.yaw);
    let fz = Math.cos(t.yaw);
    if (src) {
      const dx = t.x - src.x;
      const dz = t.z - src.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        fx = dx / d;
        fz = dz / d;
      }
    }
    const step = speed * dt;
    const from = { x: t.x, z: t.z };
    const next = this.combat.moveWaveMob(
      id,
      from,
      { x: t.x + fx * step, z: t.z + fz * step },
    );
    t.yaw = mobWalkYaw(t.yaw, next.x - from.x, next.z - from.z, fx, fz, dt, false);
    t.x = next.x;
    t.z = next.z;
  }

  private separateMobs() {
    const list: Array<{ id: string; x: number; z: number; locked: boolean }> = [];
    const now = Date.now();
    this.state.targets.forEach((t, id) => {
      if (!isPveInstanceMobKind(t.kind) || t.hp <= 0) return;
      list.push({
        id,
        x: t.x,
        z: t.z,
        locked:
          Boolean(t.castLockUntil && now < t.castLockUntil) ||
          !this.combat.statuses.canMove(id),
      });
    });
    if (list.length < 2) return;
    const minDist = COLLISION.dummyRadius * 1.85;
    const minDist2 = minDist * minDist;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d2 = dx * dx + dz * dz;
        if (d2 >= minDist2) continue;
        if (d2 < 1e-8) {
          dx = 0.05;
          dz = 0;
          d2 = dx * dx;
        }
        const d = Math.sqrt(d2);
        const push = (minDist - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        if (!a.locked) {
          a.x -= nx * push;
          a.z -= nz * push;
        }
        if (!b.locked) {
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
    for (const row of list) {
      if (row.locked) continue;
      const t = this.state.targets.get(row.id);
      if (!t) continue;
      const next = this.combat.moveWaveMob(row.id, { x: t.x, z: t.z }, { x: row.x, z: row.z });
      t.x = next.x;
      t.z = next.z;
    }
  }

  private refreshCheckpoints() {
    for (const pack of this.packs) {
      if (!pack.required) continue;
      const alive = pack.mobIds.some((id) => {
        const t = this.state.targets.get(id);
        return t && t.hp > 0;
      });
      if (!alive && pack.mobIds.length > 0) this.packCleared = true;
    }
    if (this.objective?.done) this.optionalDone = true;
    const optionalPacksDone = this.packs
      .filter((p) => !p.required)
      .every((p) => p.mobIds.every((id) => {
        const t = this.state.targets.get(id);
        return !t || t.hp <= 0;
      }));
    const optionalBossesDone = this.bosses
      .filter((b) => !b.required)
      .every((b) => {
        const t = this.state.targets.get(b.mobId);
        return !t || t.hp <= 0;
      });
    if (
      !this.optionalDone &&
      ((this.packs.some((p) => !p.required) && optionalPacksDone) ||
        (this.bosses.some((b) => !b.required) && optionalBossesDone))
    ) {
      this.optionalDone = true;
    }

    const requiredBosses = this.bosses.filter((b) => b.required);
    const allRequiredDead =
      requiredBosses.length > 0 &&
      requiredBosses.every((b) => {
        const t = this.state.targets.get(b.mobId);
        return !t || t.hp <= 0;
      });
    if (allRequiredDead && !this.requiredBossesDead) {
      this.requiredBossesDead = true;
      this.exitUnlocked = true;
      this.state.dungeonExitUnlocked = true;
      this.onExitUnlock();
    }
  }

  private forgetMob(id: string) {
    this.meleeCd.delete(id);
    this.retargetAt.delete(id);
    this.targetSession.delete(id);
    this.speedById.delete(id);
    this.damageById.delete(id);
    this.eliteKit.delete(id);
    this.pendingReleaseAt.delete(id);
    this.pendingAimYaw.delete(id);
    this.pendingAbility.delete(id);
    this.eliteLastAbility.delete(id);
    this.stageById.delete(id);
    this.enraged.delete(id);
  }

  private clearMobs() {
    const ids: string[] = [];
    this.state.targets.forEach((t, id) => {
      if (isPveInstanceMobKind(t.kind)) ids.push(id);
    });
    for (const id of ids) {
      this.forgetMob(id);
      this.state.targets.delete(id);
    }
  }

  private countAlive(): number {
    let n = 0;
    this.state.targets.forEach((t) => {
      if (isPveInstanceMobKind(t.kind) && t.hp > 0) n += 1;
    });
    return n;
  }

  private pushHud() {
    const phase = this.exitUnlocked
      ? "complete"
      : this.bosses.some((b) => b.required && b.aggroed)
        ? "fighting"
        : "exploring";
    this.broadcastHud({
      wave: this.checkpointWave(),
      phase,
      alive: this.countAlive(),
      goal: this.packs.filter((p) => p.required).length + this.bosses.filter((b) => b.required).length,
      label: "Dungeon",
    });
  }
}
