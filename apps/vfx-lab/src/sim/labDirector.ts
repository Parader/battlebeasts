import {
  ABILITIES,
  ARC_THREAD_CAST,
  ASCENDANT_FORM_CAST,
  ASTRAL_CHAIN_CAST,
  BARRIER_CAST,
  CAST_EXECUTION_SCALE,
  MOVE_SPEED,
  SOUL_SEVER_CAST,
  abilityEffectKind,
  nextCastPhase,
  phaseDurationMs,
  sampleTravel,
  type AbilityDef,
  type AbilityTiming,
  type CastPhaseId,
} from "@battlebeasts/shared";
import { combatOverlayRuntime } from "@web/game/combatOverlayRuntime";
import { setGroundAim } from "@web/game/groundAimRuntime";
import { castAimRuntime } from "@web/game/castAimRuntime";
import { getCombatOwnerPose } from "@web/game/characterRoots";
import { dispatchCombatFxVfx } from "@web/game/vfx/combatFxDispatch";
import { clearCrescentSpawnState } from "@web/game/vfx/crescentSpawn";
import { castEngines } from "@web/game/vfx/engines";
import { getAbilityVfxProfile } from "@web/game/vfx/profiles/registry";
import {
  cancelFollowOwnerVfx,
  vfxRuntime,
} from "@web/game/vfx/runtime";
import {
  cancelPlayerCastHandles,
  cleanupPlayerVfx,
  getPlayerVfxRuntime,
} from "@web/game/vfx/runtime/playerVfxRuntime";
import { getFlightDurationMs } from "@web/game/vfx/timing";
import { setPerfExtraLine } from "@web/game/perfHudRuntime";
import { CASTER_ID, TARGET_ID, labSim, type LabActor, type LabProjectile } from "./labSim";
import { getAim, getWorldStick, isShift } from "./labInput";
import {
  applyKnockback,
  applyPullToward,
  applySelfLeap,
  beginTravelFromCast,
  clearMotion,
  hasBusyMotion,
  isMotionLocked,
  peekTravel,
  tickMotion,
  tickWalk,
} from "./labMotion";
import { PHASES, labStore, type TimingOverrides } from "../state/labStore";

const FX_COLORS: Record<"aoe" | "melee" | "dash" | "hit", string> = {
  aoe: "#c084fc",
  melee: "#fb923c",
  dash: "#a3e635",
  hit: "#f87171",
};

type Snapshot = {
  timing: AbilityTiming;
  leadMs?: number;
};

type Inflight = {
  projectileId: string;
  ownerId: string;
  targetId: string;
  hitX: number;
  hitZ: number;
  hitAt: number;
};

let fxKey = 1;
let playing = false;
let paused = false;
let phase: CastPhaseId | null = null;
let phaseEndsAt = 0;
let castStartedAt = 0;
let inflight: Inflight[] = [];
let lingering = false;
let lingerUntil = 0;
let dummyScript: "none" | "chainStrain" | "severFlee" = "none";
let dummyRest: { x: number; z: number } | null = null;
type PoseSnap = { id: string; x: number; z: number; yaw: number };
let playRest: { caster: PoseSnap; dummy: PoseSnap; others: PoseSnap[] } | null = null;
type DelayedPulse = {
  explodeAt: number;
  x: number;
  z: number;
  radius: number;
  ownerId: string;
  abilityId: string;
};
let delayed: DelayedPulse[] = [];
let snapshot: Snapshot | null = null;
let playheadEl: HTMLElement | null = null;
let loopPeakShots = 0;
let shotSampleAt = 0;

export function setPlayheadEl(el: HTMLElement | null): void {
  playheadEl = el;
}

function wallPhaseMs(def: AbilityDef, id: CastPhaseId, over: TimingOverrides): number {
  if (id === "anticipation" && over.anticipationMs != null) return over.anticipationMs;
  if (id === "cast" && over.castMs != null) return over.castMs;
  if (id === "impact" && over.impactMs != null) return over.impactMs;
  if (id === "recovery" && over.recoveryMs != null) return over.recoveryMs;
  return phaseDurationMs(def, id);
}

function applyOverrides(def: AbilityDef, over: TimingOverrides): void {
  if (snapshot) return;
  const orig: Snapshot = {
    timing: { ...def.timing },
    leadMs: getAbilityVfxProfile(def.id).muzzleLead?.leadMs,
  };
  snapshot = orig;
  if (over.anticipationMs != null) def.timing.anticipationMs = over.anticipationMs / CAST_EXECUTION_SCALE;
  if (over.castMs != null) def.timing.castMs = over.castMs / CAST_EXECUTION_SCALE;
  if (over.impactMs != null) def.timing.impactMs = over.impactMs / CAST_EXECUTION_SCALE;
  if (over.recoveryMs != null) def.timing.recoveryMs = over.recoveryMs / CAST_EXECUTION_SCALE;
  if (over.leadMs != null) {
    const profile = getAbilityVfxProfile(def.id);
    if (profile.muzzleLead) profile.muzzleLead.leadMs = over.leadMs;
  }
}

function restoreOverrides(def: AbilityDef | undefined): void {
  if (!snapshot || !def) {
    snapshot = null;
    return;
  }
  def.timing.anticipationMs = snapshot.timing.anticipationMs;
  def.timing.castMs = snapshot.timing.castMs;
  def.timing.impactMs = snapshot.timing.impactMs;
  def.timing.recoveryMs = snapshot.timing.recoveryMs;
  if (snapshot.leadMs != null) {
    const profile = getAbilityVfxProfile(def.id);
    if (profile.muzzleLead) profile.muzzleLead.leadMs = snapshot.leadMs;
  }
  snapshot = null;
}

function relationTarget(): { x: number; z: number; id: string } {
  const ui = labStore.get();
  const caster = labSim.caster();
  const dummy = labSim.target();
  dummy.role = ui.relation;
  if (ui.relation === "self" || ui.targetMode === "self") {
    return { x: caster.x, z: caster.z, id: CASTER_ID };
  }
  return { x: dummy.x, z: dummy.z, id: TARGET_ID };
}

function aimPoint(): { x: number; z: number } {
  const ui = labStore.get();
  const caster = labSim.caster();
  if (ui.relation === "self" || ui.targetMode === "self") {
    return { x: caster.x, z: caster.z };
  }
  const mouse = getAim();
  if (ui.targetMode === "ground" && mouse) return mouse;
  const dummy = labSim.target();
  return { x: dummy.x, z: dummy.z };
}

function updateFacing(): void {
  const ui = labStore.get();
  const caster = labSim.caster();
  labSim.target().role = ui.relation;
  const aim = getAim() ?? aimPoint();
  const dx = aim.x - caster.x;
  const dz = aim.z - caster.z;
  if (dx * dx + dz * dz > 0.0001) caster.yaw = Math.atan2(dx, dz);
  setGroundAim(aim.x, aim.z);
  for (const id of labSim.crowdIds()) {
    const p = labSim.players.get(id);
    if (!p || isMotionLocked(id)) continue;
    const tgt = assignedTarget(id);
    const cx = tgt.x - p.x;
    const cz = tgt.z - p.z;
    if (cx * cx + cz * cz > 0.0001) p.yaw = Math.atan2(cx, cz);
  }
}

function assignedTarget(ownerId: string): { x: number; z: number; id: string } {
  if (ownerId === CASTER_ID) return relationTarget();
  const extras = labSim.extraDummyIds();
  const crowd = labSim.crowdIds();
  const i = crowd.indexOf(ownerId);
  if (extras.length > 0 && i >= 0) {
    const id = extras[i % extras.length]!;
    const t = labSim.targets.get(id);
    if (t) return { x: t.x, z: t.z, id };
  }
  return relationTarget();
}

function ownerActor(ownerId: string): LabActor {
  return labSim.players.get(ownerId) ?? labSim.caster();
}

/** Drive the live cast engines from the sim clock so shots spawn on Play. */
function tickCasterEngines(sessionId: string, now: number): void {
  const caster = labSim.players.get(sessionId);
  if (!caster) return;
  const abilityId = caster.castAbilityId ?? "";
  const phase = caster.castPhase ?? "";
  const runtime = getPlayerVfxRuntime(sessionId);
  const profile = getAbilityVfxProfile(abilityId);
  const engine = castEngines[profile.castEngine];
  if (!engine) return;
  const ctx = {
    sessionId,
    abilityId,
    phase,
    prevPhase: runtime.lastPhase,
    now,
    pose: caster,
    profile,
  };
  engine.onPhaseChange(ctx);
  engine.tick?.(ctx);
  if (phase === "" || phase === "idle" || phase === "cancel" || phase === "interrupt") {
    cancelPlayerCastHandles(sessionId);
  }
  runtime.lastPhase = phase;
}

function tickAllEngines(now: number): void {
  tickCasterEngines(CASTER_ID, now);
  for (const id of labSim.crowdIds()) tickCasterEngines(id, now);
}

function dispatchFx(
  kind: "aoe" | "melee" | "dash" | "hit",
  abilityId: string,
  x: number,
  z: number,
  extra?: {
    radius?: number;
    targetId?: string;
    yaw?: number;
    x2?: number;
    z2?: number;
    phaseEndsAt?: number;
    comboHit?: number;
    variant?: number;
    y?: number;
    ownerId?: string;
  },
): void {
  const ownerId = extra?.ownerId ?? CASTER_ID;
  const owner = ownerActor(ownerId);
  const hero = labSim.caster();
  dispatchCombatFxVfx(
    {
      kind,
      abilityId,
      x,
      z,
      y: extra?.y,
      yaw: extra?.yaw ?? owner.yaw,
      radius: extra?.radius,
      ownerId,
      targetId: extra?.targetId,
      x2: extra?.x2,
      z2: extra?.z2,
      phaseEndsAt: extra?.phaseEndsAt,
      comboHit: extra?.comboHit,
      variant: extra?.variant,
    },
    {
      localSessionId: CASTER_ID,
      localYaw: hero.yaw,
      predicted: { x: hero.x, z: hero.z },
      getOwner: (id: string) => getCombatOwnerPose(labSim.room, id),
      pushBurst: (burst: unknown) => combatOverlayRuntime.pushBurst(burst),
      nextFxKey: () => ++fxKey,
      fxColors: FX_COLORS,
    },
  );
}

function spawnWorldProp(def: AbilityDef, x: number, z: number, yaw: number, ownerId = CASTER_ID): void {
  const kind = abilityEffectKind(def);
  const id = `lab-${kind}-${ownerId}`;
  if (kind === "volcano") {
    labSim.world.volcanoes.set(id, {
      x,
      z,
      yaw,
      radius: def.radius ?? 1.8,
      phase: "active",
      expiresAt: Date.now() + 8000,
    });
  } else if (kind === "rockWall") {
    labSim.world.rockWalls.set(id, {
      x,
      z,
      yaw,
      halfWidth: 2.4,
      halfThickness: 0.45,
      durability: 8,
    });
  } else if (kind === "shrooms") {
    labSim.world.shrooms.set(id, {
      x,
      z,
      yaw,
      ownerSessionId: ownerId,
      triggerRadius: 1.2,
      blastRadius: 3.4,
      stage: 2,
      variant: 0,
    });
  } else if (kind === "worldTree") {
    labSim.world.worldTrees.set(id, { x, z, yaw, radius: def.radius ?? 4 });
  } else if (kind === "protectionBubble") {
    labSim.world.protectionBubbles.set(id, { x, z, yaw, radius: def.radius ?? 2.4 });
  }
}

function spawnProjectile(def: AbilityDef, now: number, ownerId: string): void {
  const caster = ownerActor(ownerId);
  const aim = assignedTarget(ownerId);
  const yaw = caster.yaw;
  const offset = def.spawnOffset ?? 0.7;
  const sx = caster.x + Math.sin(yaw) * offset;
  const sz = caster.z + Math.cos(yaw) * offset;
  const dx = aim.x - sx;
  const dz = aim.z - sz;
  const dist = Math.hypot(dx, dz) || 0.001;
  const speed = def.speed && def.speed > 0 ? def.speed : 18;
  const vx = (dx / dist) * speed;
  const vz = (dz / dist) * speed;
  const flightMs = (dist / speed) * 1000;
  const id = `p-${ownerId}-${now}`;
  const proj: LabProjectile = {
    x: sx,
    z: sz,
    vx,
    vz,
    abilityId: def.id,
    ownerSessionId: ownerId,
    targetX: aim.x,
    targetZ: aim.z,
  };
  labSim.projectiles.set(id, proj);
  inflight.push({
    projectileId: id,
    ownerId,
    targetId: aim.id,
    hitX: aim.x,
    hitZ: aim.z,
    hitAt: now + flightMs,
  });
}

function dispatchArcThreadFx(def: AbilityDef, ownerId: string): void {
  const ui = labStore.get();
  const caster = ownerActor(ownerId);
  const aim = assignedTarget(ownerId);
  const range = Math.max(2, def.range);
  const dist = Math.hypot(aim.x - caster.x, aim.z - caster.z);
  const lockDummy =
    ownerId === CASTER_ID &&
    ui.targetMode === "dummy" &&
    ui.relation !== "self" &&
    dist <= range + 0.05;
  const holdMs = def.threadDurationMs ?? ARC_THREAD_CAST.threadDurationMs;
  dispatchFx("aoe", def.id, caster.x, caster.z, {
    ownerId,
    yaw: caster.yaw,
    radius: range,
    comboHit: 1,
    phaseEndsAt: Date.now() + holdMs,
    ...(lockDummy
      ? { targetId: aim.id }
      : {
          x2: caster.x + Math.sin(caster.yaw) * range,
          z2: caster.z + Math.cos(caster.yaw) * range,
        }),
  });
  extendLinger(performance.now(), holdMs);
}

function splashHits(
  def: AbilityDef,
  x: number,
  z: number,
  radius: number,
  exceptId: string,
  ownerId: string,
): void {
  if (!(radius > 0.15)) return;
  const now = performance.now();
  labSim.targets.forEach((t, id) => {
    if (id === exceptId) return;
    if (Math.hypot(t.x - x, t.z - z) > radius) return;
    dispatchFx("hit", def.id, t.x, t.z, { targetId: id, radius, ownerId });
    applyRadialControl(def, { x, z }, id, ownerId, now);
  });
}

function applyProjectileControl(
  def: AbilityDef,
  ownerId: string,
  targetId: string,
  now: number,
): void {
  if (def.leapToTarget && def.pull) {
    applySelfLeap(ownerId, targetId, def.pull, def.pullMs ?? 280, now, def.pullStopDistance);
  } else if (def.pull) {
    const owner = ownerActor(ownerId);
    applyPullToward(owner, targetId, def.pull, def.pullMs ?? 280, now, def.pullStopDistance);
  }
  const hold = Math.max(def.pullMs ?? 0, def.knockbackMs ?? 0);
  if (hold > 0) extendLinger(now, hold + 80);
}

function applyRadialControl(
  def: AbilityDef,
  center: { x: number; z: number },
  targetId: string,
  ownerId: string,
  now: number,
): void {
  if (def.knockback) {
    applyKnockback(center, targetId, def.knockback, def.knockbackMs ?? 220, now);
  }
  if (def.pull && !def.leapToTarget) {
    applyPullToward(center, targetId, def.pull, def.pullMs ?? 280, now, def.pullStopDistance);
  }
  const hold = Math.max(def.pullMs ?? 0, def.knockbackMs ?? 0);
  if (hold > 0) extendLinger(now, hold + 80);
}

function snapshotPlayRest(): void {
  const caster = labSim.caster();
  const dummy = labSim.target();
  const others: PoseSnap[] = [];
  labSim.players.forEach((p, id) => {
    if (id === CASTER_ID) return;
    others.push({ id, x: p.x, z: p.z, yaw: p.yaw });
  });
  labSim.targets.forEach((t, id) => {
    if (id === TARGET_ID) return;
    others.push({ id, x: t.x, z: t.z, yaw: t.yaw });
  });
  playRest = {
    caster: { id: CASTER_ID, x: caster.x, z: caster.z, yaw: caster.yaw },
    dummy: { id: TARGET_ID, x: dummy.x, z: dummy.z, yaw: dummy.yaw },
    others,
  };
}

function restorePlayRest(): void {
  if (!playRest) return;
  clearMotion();
  labSim.setCasterPos(playRest.caster.x, playRest.caster.z);
  const caster = labSim.caster();
  caster.yaw = playRest.caster.yaw;
  caster.vx = 0;
  caster.vz = 0;
  labSim.setTargetPos(playRest.dummy.x, playRest.dummy.z);
  const dummy = labSim.target();
  dummy.yaw = playRest.dummy.yaw;
  dummy.vx = 0;
  dummy.vz = 0;
  for (const pose of playRest.others) {
    const actor = unitById(pose.id);
    if (!actor) continue;
    labSim.setActorPos(pose.id, pose.x, pose.z);
    actor.yaw = pose.yaw;
    actor.vx = 0;
    actor.vz = 0;
  }
}

function dispatchSelfOrAimedAoe(def: AbilityDef, ownerId: string): void {
  const caster = ownerActor(ownerId);
  const selfCast = def.shape === "buff" || !(def.range > 0);
  const pos = selfCast ? caster : assignedTarget(ownerId);
  const radius =
    (def as AbilityDef & { auraRadius?: number }).auraRadius ?? def.radius ?? def.range;
  const targetId = selfCast ? ownerId : assignedTarget(ownerId).id;
  dispatchFx("aoe", def.id, pos.x, pos.z, {
    radius,
    yaw: caster.yaw,
    targetId,
    ownerId,
  });
  const now = performance.now();
  const delay = Math.max(0, def.delayedImpactMs ?? 0);
  if (delay > 0) {
    delayed.push({
      explodeAt: now + delay,
      x: pos.x,
      z: pos.z,
      radius,
      ownerId,
      abilityId: def.id,
    });
    extendLinger(now, delay + (def.pullMs ?? 280) + 80);
    return;
  }
  if (!selfCast) {
    applyRadialControl(def, pos, targetId, ownerId, now);
    splashHits(def, pos.x, pos.z, radius, targetId, ownerId);
  } else {
    splashHits(def, pos.x, pos.z, radius, ownerId, ownerId);
  }
}

function restoreDummyRest(): void {
  if (!dummyRest) return;
  labSim.setTargetPos(dummyRest.x, dummyRest.z);
  const dummy = labSim.target();
  dummy.vx = 0;
  dummy.vz = 0;
}

function extendLinger(now: number, ms: number): void {
  lingerUntil = Math.max(lingerUntil, now + Math.max(0, ms));
}

function postCastBusy(now: number): boolean {
  if (inflight.length > 0) return true;
  if (now < lingerUntil) return true;
  if (delayed.length > 0) return true;
  if (hasBusyMotion()) return true;
  if (labSim.world.astralChains.size > 0) return true;
  if (labSim.world.soulSevers.size > 0) return true;
  if (hasLiveStatus("barrier")) return true;
  return false;
}

function applyActorStatus(
  actor: LabActor,
  statusId: string,
  stacks: number,
  durationMs: number,
): void {
  actor.statuses.set(statusId, {
    statusId,
    stacks: Math.max(0, stacks),
    expiresAt: Date.now() + Math.max(1, durationMs),
  });
}

function hasLiveStatus(statusId: string): boolean {
  let found = false;
  labSim.players.forEach((actor) => {
    const row = actor.statuses.get(statusId);
    if (row && row.stacks > 0 && Date.now() < row.expiresAt) found = true;
  });
  return found;
}

function grantBarrierShield(ownerId: string, now: number): void {
  applyActorStatus(
    ownerActor(ownerId),
    "barrier",
    BARRIER_CAST.shieldStacks,
    BARRIER_CAST.shieldDurationMs,
  );
  extendLinger(now, BARRIER_CAST.shieldDurationMs + 400);
}

function tickBarrierCharge(now: number): void {
  const ui = labStore.get();
  const def = ABILITIES[ui.abilityId];
  if (!def || def.id !== "barrier") return;
  if (phase !== "anticipation" && phase !== "cast") return;
  const chargeMs =
    wallPhaseMs(def, "anticipation", ui.timing) + wallPhaseMs(def, "cast", ui.timing);
  const p = Math.max(0, Math.min(1, (now - castStartedAt) / Math.max(1, chargeMs)));
  const stacks = Math.max(1, Math.floor(BARRIER_CAST.shieldStacks * p));
  const remain = Math.max(0, chargeMs - (now - castStartedAt));
  const dur = remain + BARRIER_CAST.shieldDurationMs;
  applyActorStatus(labSim.caster(), "barrier", stacks, dur);
  for (const id of labSim.crowdIds()) {
    const actor = labSim.players.get(id);
    if (actor) applyActorStatus(actor, "barrier", stacks, dur);
  }
}

function tickStatuses(): void {
  const wall = Date.now();
  labSim.players.forEach((actor) => {
    const dead: string[] = [];
    actor.statuses.forEach((row, id) => {
      if (wall >= row.expiresAt) dead.push(id);
    });
    for (const id of dead) actor.statuses.delete(id);
  });
}

function clearCastPose(actor: LabActor): void {
  actor.castPhase = "";
  actor.castAbilityId = "";
  actor.castPhaseEndsAt = 0;
  actor.castLockUntil = 0;
}

function releaseCastPose(now: number): void {
  clearCastPose(labSim.caster());
  for (const id of labSim.crowdIds()) {
    const p = labSim.players.get(id);
    if (p) clearCastPose(p);
  }
  phase = null;
  castAimRuntime.clear();
  tickAllEngines(now);
}

function unitById(id: string): LabActor | undefined {
  return labSim.players.get(id) ?? labSim.targets.get(id);
}

function breakAstralChain(
  id: string,
  reason: "expire" | "escape" | "hard" | "silent",
): void {
  const chain = labSim.world.astralChains.get(id) as
    | {
        casterId?: string;
        targetId?: string;
        abilityId?: string;
        maxDistance?: number;
      }
    | undefined;
  if (!chain) return;
  labSim.world.astralChains.delete(id);
  if (reason === "silent") return;
  const caster = unitById(chain.casterId ?? CASTER_ID) ?? labSim.caster();
  const dummy = unitById(chain.targetId ?? TARGET_ID) ?? labSim.target();
  const variant = reason === "expire" ? 0 : reason === "escape" ? 1 : 2;
  dispatchFx("aoe", chain.abilityId || "astralChain", caster.x, caster.z, {
    ownerId: chain.casterId,
    x2: dummy.x,
    z2: dummy.z,
    y: ASTRAL_CHAIN_CAST.handY,
    radius: chain.maxDistance,
    targetId: chain.targetId ?? TARGET_ID,
    variant,
  });
  extendLinger(performance.now(), 220);
}

function attachAstralChain(def: AbilityDef, ownerId: string, targetId: string): void {
  const caster = ownerActor(ownerId);
  const dummy = labSim.targets.get(targetId);
  if (!dummy) return;
  const replace: string[] = [];
  labSim.world.astralChains.forEach((c, id) => {
    if ((c as { casterId?: string }).casterId === ownerId) replace.push(id);
  });
  for (const id of replace) breakAstralChain(id, "hard");
  if (targetId === TARGET_ID) dummyRest = { x: dummy.x, z: dummy.z };
  const dist = Math.hypot(dummy.x - caster.x, dummy.z - caster.z);
  const maxDistance = Math.max(dist, ASTRAL_CHAIN_CAST.minTetherDistance);
  const durationMs = def.tetherDurationMs ?? ASTRAL_CHAIN_CAST.tetherDurationMs;
  const wall = Date.now();
  labSim.world.astralChains.set(`achain_${fxKey++}`, {
    casterId: ownerId,
    targetId,
    abilityId: def.id,
    startedAt: wall,
    endsAt: wall + durationMs,
    maxDistance,
  });
  if (targetId === TARGET_ID) dummyScript = "chainStrain";
}

function attachSoulSever(def: AbilityDef, ownerId: string, targetId: string): void {
  const dummy = labSim.targets.get(targetId);
  if (!dummy) return;
  if (targetId === TARGET_ID) dummyRest = { x: dummy.x, z: dummy.z };
  const durationMs = def.severDurationMs ?? SOUL_SEVER_CAST.severDurationMs;
  const wall = Date.now();
  labSim.world.soulSevers.set(`ssever_${fxKey++}`, {
    casterId: ownerId,
    targetId,
    abilityId: def.id,
    originX: dummy.x,
    originZ: dummy.z,
    startedAt: wall,
    endsAt: wall + durationMs,
  });
  if (targetId === TARGET_ID) dummyScript = "severFlee";
  dispatchFx("aoe", def.id, dummy.x, dummy.z, {
    ownerId,
    radius: 0.4,
    targetId,
    variant: 0,
  });
}

function resolveSoulSever(id: string): void {
  const sever = labSim.world.soulSevers.get(id) as
    | {
        originX?: number;
        originZ?: number;
        abilityId?: string;
        targetId?: string;
        casterId?: string;
      }
    | undefined;
  if (!sever) return;
  const dummy = unitById(sever.targetId ?? TARGET_ID) ?? labSim.target();
  const ox = sever.originX ?? dummy.x;
  const oz = sever.originZ ?? dummy.z;
  const displacement = Math.hypot(dummy.x - ox, dummy.z - oz);
  const power01 = Math.max(
    0,
    Math.min(1, displacement / Math.max(1e-4, SOUL_SEVER_CAST.severMaxDistance)),
  );
  dispatchFx("aoe", sever.abilityId || "soulSever", dummy.x, dummy.z, {
    ownerId: sever.casterId,
    x2: ox,
    z2: oz,
    y: 1,
    radius: 0.35 + power01 * 0.45,
    targetId: sever.targetId ?? TARGET_ID,
    variant: 1,
  });
  labSim.world.soulSevers.delete(id);
  extendLinger(performance.now(), 320);
}

function applyProjectileHit(
  def: AbilityDef,
  x: number,
  z: number,
  ownerId: string,
  targetId: string,
): void {
  dispatchFx("hit", def.id, x, z, { targetId, ownerId });
  const radius = def.radius ?? 0;
  const now = performance.now();
  applyProjectileControl(def, ownerId, targetId, now);
  splashHits(def, x, z, radius, targetId, ownerId);
  if (def.id === "astralChain") {
    attachAstralChain(def, ownerId, targetId);
    return;
  }
  if (def.id === "soulSever") {
    attachSoulSever(def, ownerId, targetId);
    return;
  }
  const onAoe = getAbilityVfxProfile(def.id).combatFx?.onAoe;
  if (onAoe && onAoe !== "none") {
    dispatchFx("aoe", def.id, x, z, {
      radius: def.radius ?? def.range,
      targetId,
      ownerId,
    });
  }
}

function tickDummyScript(dt: number): void {
  if (dummyScript === "none") return;
  if (isMotionLocked(TARGET_ID)) return;
  const stick = getWorldStick();
  if (isShift() && Math.hypot(stick.x, stick.z) > 0.12) return;
  const dummy = labSim.target();
  dummy.vx = 0;
  dummy.vz = 0;
  const caster = labSim.caster();
  const origin =
    dummyScript === "severFlee" && dummyRest ? dummyRest : { x: caster.x, z: caster.z };
  const dx = dummy.x - origin.x;
  const dz = dummy.z - origin.z;
  const dist = Math.hypot(dx, dz);
  const nx = dist < 1e-4 ? Math.sin(caster.yaw) : dx / dist;
  const nz = dist < 1e-4 ? Math.cos(caster.yaw) : dz / dist;
  const speed = MOVE_SPEED;
  labSim.setTargetPos(dummy.x + nx * speed * dt, dummy.z + nz * speed * dt);
  dummy.vx = nx * speed;
  dummy.vz = nz * speed;
  dummy.yaw = Math.atan2(nx, nz);
}

function tickAstralChains(): void {
  if (labSim.world.astralChains.size === 0) {
    if (dummyScript === "chainStrain") dummyScript = "none";
    return;
  }
  const wall = Date.now();
  const toBreak: string[] = [];
  labSim.world.astralChains.forEach((raw, id) => {
    const chain = raw as {
      endsAt?: number;
      maxDistance?: number;
      casterId?: string;
      targetId?: string;
    };
    if (wall >= (chain.endsAt ?? 0)) {
      toBreak.push(id);
      return;
    }
    const caster = unitById(chain.casterId ?? CASTER_ID);
    const dummy = unitById(chain.targetId ?? TARGET_ID);
    if (!caster || !dummy) {
      toBreak.push(id);
      return;
    }
    const dist = Math.hypot(dummy.x - caster.x, dummy.z - caster.z);
    const maxDistance = chain.maxDistance ?? dist;
    if (dist <= maxDistance + 0.04 || dist < 1e-6) return;
    const pullStrength = ASTRAL_CHAIN_CAST.casterPullStrength;
    const softStretch = ASTRAL_CHAIN_CAST.softStretchMeters;
    const excess = dist - maxDistance;
    const inv = 1 / dist;
    const nx = (dummy.x - caster.x) * inv;
    const nz = (dummy.z - caster.z) * inv;
    const tug =
      dist > maxDistance + softStretch
        ? excess
        : excess * Math.max(0, Math.min(1, pullStrength));
    if (chain.targetId === TARGET_ID) {
      labSim.setTargetPos(dummy.x - nx * tug, dummy.z - nz * tug);
    } else {
      dummy.x -= nx * tug;
      dummy.z -= nz * tug;
    }
  });
  for (const id of toBreak) breakAstralChain(id, "expire");
  if (labSim.world.astralChains.size === 0 && dummyScript === "chainStrain") {
    dummyScript = "none";
    const d = labSim.target();
    d.vx = 0;
    d.vz = 0;
  }
}

function tickSoulSevers(): void {
  if (labSim.world.soulSevers.size === 0) {
    if (dummyScript === "severFlee") dummyScript = "none";
    return;
  }
  const wall = Date.now();
  const toResolve: string[] = [];
  labSim.world.soulSevers.forEach((raw, id) => {
    const sever = raw as { endsAt?: number };
    if (wall >= (sever.endsAt ?? 0)) toResolve.push(id);
  });
  for (const id of toResolve) resolveSoulSever(id);
  if (labSim.world.soulSevers.size === 0 && dummyScript === "severFlee") {
    dummyScript = "none";
    const dummy = labSim.target();
    dummy.vx = 0;
    dummy.vz = 0;
  }
}

function tickWorldExpiry(): void {
  const wall = Date.now();
  labSim.world.volcanoes.forEach((raw, id) => {
    const expiresAt = (raw as { expiresAt?: number }).expiresAt;
    if (typeof expiresAt === "number" && wall >= expiresAt) {
      labSim.world.volcanoes.delete(id);
    }
  });
}

function tickDelayedPulses(now: number): void {
  if (delayed.length === 0) return;
  const remain: DelayedPulse[] = [];
  for (const pulse of delayed) {
    if (now < pulse.explodeAt) {
      remain.push(pulse);
      continue;
    }
    const def = ABILITIES[pulse.abilityId];
    if (!def) continue;
    labSim.targets.forEach((t, id) => {
      if (Math.hypot(t.x - pulse.x, t.z - pulse.z) > pulse.radius) return;
      dispatchFx("hit", def.id, t.x, t.z, {
        targetId: id,
        radius: pulse.radius,
        ownerId: pulse.ownerId,
      });
      applyRadialControl(def, pulse, id, pulse.ownerId, now);
    });
  }
  delayed = remain;
}

function resolveLanding(ownerId: string, def: AbilityDef): void {
  const caster = ownerActor(ownerId);
  const aim = assignedTarget(ownerId);
  const radius = def.radius ?? def.range;
  const now = performance.now();
  if (def.shape === "melee") {
    dispatchFx("melee", def.id, caster.x, caster.z, { radius, yaw: caster.yaw, ownerId });
    dispatchFx("hit", def.id, aim.x, aim.z, { targetId: aim.id, radius, ownerId });
    applyRadialControl(def, caster, aim.id, ownerId, now);
    splashHits(def, caster.x, caster.z, radius, aim.id, ownerId);
    return;
  }
  dispatchSelfOrAimedAoe(def, ownerId);
}

function resolvePathHit(
  ownerId: string,
  def: AbilityDef,
  targetId: string,
  x: number,
  z: number,
): void {
  dispatchFx("hit", def.id, x, z, { targetId, ownerId });
  applyRadialControl(def, { x, z }, targetId, ownerId, performance.now());
}

function resolveImpact(def: AbilityDef, now: number, ownerId: string): void {
  const caster = ownerActor(ownerId);
  const aim = assignedTarget(ownerId);
  const profile = getAbilityVfxProfile(def.id);
  const radius = def.radius ?? def.range;
  const targetId = aim.id;
  const onAoe = profile.combatFx?.onAoe;

  spawnWorldProp(def, aim.x, aim.z, caster.yaw, ownerId);

  if (def.id === "arcThread") {
    dispatchArcThreadFx(def, ownerId);
    return;
  }

  if (def.id === "ascendantForm" && ownerId === CASTER_ID) {
    labSim.ascendantUntil = now + (def.durationMs ?? ASCENDANT_FORM_CAST.durationMs);
  }

  if (def.id === "barrier") {
    grantBarrierShield(ownerId, now);
  }

  const travelAim = ownerId === CASTER_ID ? (getAim() ?? aim) : aim;
  const travel = beginTravelFromCast(def, ownerId, now, travelAim);

  if (def.shape === "projectile") {
    if (onAoe && onAoe !== "none" && profile.projectile === "none") {
      dispatchSelfOrAimedAoe(def, ownerId);
      return;
    }
    if (profile.projectile === "ownedByCast") {
      const flightMs = getFlightDurationMs(def.range, def.speed, 10, 10, 800);
      inflight.push({
        projectileId: "",
        ownerId,
        targetId,
        hitX: aim.x,
        hitZ: aim.z,
        hitAt: now + flightMs,
      });
    } else if (profile.projectile === "catalog" || profile.projectile !== "none") {
      spawnProjectile(def, now, ownerId);
    } else {
      dispatchFx("hit", def.id, aim.x, aim.z, { targetId, ownerId });
      applyProjectileControl(def, ownerId, targetId, now);
      splashHits(def, aim.x, aim.z, radius, targetId, ownerId);
    }
    return;
  }

  if (def.shape === "melee") {
    if (travel.deferHit) return;
    dispatchFx("melee", def.id, caster.x, caster.z, { radius, yaw: caster.yaw, ownerId });
    dispatchFx("hit", def.id, aim.x, aim.z, { targetId, radius, ownerId });
    applyRadialControl(def, caster, targetId, ownerId, now);
    splashHits(def, caster.x, caster.z, radius, targetId, ownerId);
    return;
  }

  if (def.shape === "dash") {
    const live = peekTravel(ownerId);
    if (live) {
      const dest = sampleTravel(
        { x: live.fromX, z: live.fromZ },
        live.yaw,
        live.distance,
        1,
      );
      dispatchFx("dash", def.id, live.fromX, live.fromZ, {
        yaw: live.yaw,
        radius,
        ownerId,
        x2: dest.x,
        z2: dest.z,
        phaseEndsAt: Date.now() + live.durationMs,
      });
    } else {
      dispatchFx("dash", def.id, caster.x, caster.z, {
        yaw: caster.yaw,
        radius,
        ownerId,
      });
    }
    return;
  }

  if (travel.deferHit) return;

  dispatchSelfOrAimedAoe(def, ownerId);
}

function stampCast(actor: LabActor, def: AbilityDef, next: CastPhaseId, now: number, dur: number): void {
  actor.castAbilityId = def.id;
  actor.castPhase = next;
  actor.castPhaseEndsAt = Date.now() + dur;
  if (next === "anticipation") actor.castComboHit = 1;
  actor.castLockUntil = now + totalWallMs(def, labStore.get().timing);
}

function enterPhase(def: AbilityDef, next: CastPhaseId, now: number): void {
  const ui = labStore.get();
  const dur = Math.max(16, wallPhaseMs(def, next, ui.timing));
  phase = next;
  phaseEndsAt = now + dur;
  const caster = labSim.caster();
  stampCast(caster, def, next, now, dur);
  for (const id of labSim.crowdIds()) {
    const p = labSim.players.get(id);
    if (p) stampCast(p, def, next, now, dur);
  }
  if (next === "impact") {
    resolveImpact(def, now, CASTER_ID);
    for (const id of labSim.crowdIds()) resolveImpact(def, now, id);
  }
  castAimRuntime.set(def.id, next, caster.castComboHit || 1);
  tickAllEngines(now);
}

function finishCast(now: number): void {
  const ui = labStore.get();
  const def = ABILITIES[ui.abilityId];
  phase = null;
  lingering = false;
  if (ui.looping && playing && !paused) {
    restorePlayRest();
    if (!ui.allowOverlap) hardTeardown();
    startCast(now);
    return;
  }
  clearCastPose(labSim.caster());
  for (const id of labSim.crowdIds()) {
    const p = labSim.players.get(id);
    if (p) clearCastPose(p);
  }
  playing = false;
  dummyScript = "none";
  const dummy = labSim.target();
  dummy.vx = 0;
  dummy.vz = 0;
  castAimRuntime.clear();
  labStore.set({ playing: false });
  restoreOverrides(def);
  tickAllEngines(now);
}

export function hardTeardown(): void {
  const ui = labStore.get();
  restoreOverrides(ABILITIES[ui.abilityId]);
  const casterIds = [CASTER_ID, TARGET_ID, ...labSim.crowdIds(), ...labSim.extraDummyIds()];
  for (const id of casterIds) {
    cancelPlayerCastHandles(id);
    cleanupPlayerVfx(id);
    clearCrescentSpawnState(id);
    cancelFollowOwnerVfx("barrier", id);
  }
  vfxRuntime.clear();
  combatOverlayRuntime.clear();
  castAimRuntime.clear();
  labSim.clearEphemeral();
  labSim.resetActors();
  inflight = [];
  delayed = [];
  lingering = false;
  lingerUntil = 0;
  dummyScript = "none";
  dummyRest = null;
  clearMotion();
  const dummy = labSim.target();
  dummy.vx = 0;
  dummy.vz = 0;
  loopPeakShots = 0;
  labStore.set({ shotCount: 0, shotWarn: false });
  setPerfExtraLine({ label: "one-shots", value: "0" });
}

function startCast(now: number): void {
  const ui = labStore.get();
  const leftover = vfxRuntime.getShots().length;
  if (!ui.allowOverlap && leftover > 2) labStore.set({ shotWarn: true });
  const def = ABILITIES[ui.abilityId];
  if (!def) return;
  lingering = false;
  dummyScript = "none";
  applyOverrides(def, ui.timing);
  updateFacing();
  const first = nextCastPhase(def, null) ?? "anticipation";
  castStartedAt = now;
  labSim.caster().castLockUntil = now + totalWallMs(def, ui.timing);
  enterPhase(def, first, now);
}

export function labPlay(): void {
  const ui = labStore.get();
  if (!ui.allowOverlap) hardTeardown();
  playing = true;
  paused = false;
  labStore.set({ playing: true, paused: false, shotWarn: false });
  snapshotPlayRest();
  startCast(performance.now());
}

export function labStop(): void {
  playing = false;
  paused = false;
  labSim.ascendantUntil = 0;
  playRest = null;
  hardTeardown();
  labStore.set({ playing: false, paused: false });
}

export function labPause(): void {
  if (!playing) return;
  paused = !paused;
  labStore.set({ paused });
}

export function labReplay(): void {
  labPlay();
}

export function totalWallMs(def: AbilityDef, over: TimingOverrides): number {
  let sum = 0;
  for (const id of PHASES) sum += wallPhaseMs(def, id, over);
  return Math.max(1, sum);
}

export function labTick(now: number, dt: number): void {
  updateFacing();

  if (!paused) {
    const abilityId = labStore.get().abilityId;
    tickWalk(dt, phase, abilityId);
    tickMotion(now, dt, {
      onLand: resolveLanding,
      onPathHit: resolvePathHit,
    });
    labSim.projectiles.forEach((p) => {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
    });

    if (inflight.length > 0) {
      const def = ABILITIES[labStore.get().abilityId];
      for (let i = inflight.length - 1; i >= 0; i--) {
        const shot = inflight[i]!;
        if (now < shot.hitAt) continue;
        if (def && def.shape === "projectile") {
          applyProjectileHit(def, shot.hitX, shot.hitZ, shot.ownerId, shot.targetId);
        }
        if (shot.projectileId) labSim.projectiles.delete(shot.projectileId);
        inflight.splice(i, 1);
      }
    }

    if (playing) tickDummyScript(dt);
    tickBarrierCharge(now);
    tickStatuses();
    tickAstralChains();
    tickSoulSevers();
    tickWorldExpiry();
    tickDelayedPulses(now);
  } else {
    const dummy = labSim.target();
    dummy.vx = 0;
    dummy.vz = 0;
  }

  if (playing && !paused && phase) {
    const def = ABILITIES[labStore.get().abilityId];
    if (def && now >= phaseEndsAt) {
      const nxt = nextCastPhase(def, phase);
      if (!nxt) {
        if (postCastBusy(now)) {
          lingering = true;
          releaseCastPose(now);
        } else {
          finishCast(now);
        }
      } else enterPhase(def, nxt, now);
    }
  }

  if (playing && !paused && lingering && !phase && !postCastBusy(now)) {
    lingering = false;
    finishCast(now);
  }

  tickAllEngines(now);

  if (playheadEl) {
    const def = ABILITIES[labStore.get().abilityId];
    if (def && (playing || paused)) {
      const total = totalWallMs(def, labStore.get().timing);
      const elapsed = Math.min(total, Math.max(0, now - castStartedAt));
      playheadEl.style.transform = `translateX(${(elapsed / total) * 100}%)`;
    } else {
      playheadEl.style.transform = "translateX(0%)";
    }
  }

  if (now - shotSampleAt > 200) {
    shotSampleAt = now;
    const shots = vfxRuntime.getShots().length;
    if (shots > loopPeakShots) loopPeakShots = shots;
    const warn = labStore.get().looping && !labStore.get().allowOverlap && shots > loopPeakShots + 4;
    if (shots !== labStore.get().shotCount || warn !== labStore.get().shotWarn) {
      labStore.set({ shotCount: shots, shotWarn: warn });
    }
    setPerfExtraLine({
      label: "one-shots",
      value: String(shots),
      warn,
    });
  }
}

export function labElapsedRatio(now = performance.now()): number {
  const def = ABILITIES[labStore.get().abilityId];
  if (!def || !playing) return 0;
  const total = totalWallMs(def, labStore.get().timing);
  return Math.min(1, Math.max(0, (now - castStartedAt) / total));
}

export function isLabPlaying(): boolean {
  return playing;
}
