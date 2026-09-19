import {
  ABILITIES,
  MOVE_SPEED,
  applyMovement,
  aimTravelAlongCursor,
  dashTravelYaw,
  resolveCastMoveMul,
  resolveTravel,
  sampleTravel,
  travelDistance,
  travelDurationMs,
  travelProgress01,
  travelTakeoffDelayMs,
  type AbilityDef,
  type CastPhaseId,
} from "@battlebeasts/shared";
import { CASTER_ID, TARGET_ID, labSim, type LabActor } from "./labSim";
import { getAim, getWorldStick, isShift } from "./labInput";

type Travel = {
  actorId: string;
  abilityId: string;
  fromX: number;
  fromZ: number;
  yaw: number;
  distance: number;
  startMs: number;
  durationMs: number;
  pendingLanding: boolean;
  hitAlongPath: boolean;
  pathHitIds: Set<string>;
  lastX: number;
  lastZ: number;
};

type Slide = {
  actorId: string;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  startAt: number;
  endAt: number;
};

const travels = new Map<string, Travel>();
const slides = new Map<string, Slide>();

export type MotionHooks = {
  onLand?: (ownerId: string, def: AbilityDef) => void;
  onPathHit?: (ownerId: string, def: AbilityDef, targetId: string, x: number, z: number) => void;
};

function actorById(id: string): LabActor | undefined {
  return labSim.players.get(id) ?? labSim.targets.get(id);
}

function writePos(id: string, actor: LabActor, x: number, z: number, dt: number): void {
  const px = actor.x;
  const pz = actor.z;
  labSim.setActorPos(id, x, z);
  if (dt > 1e-4) {
    actor.vx = (actor.x - px) / dt;
    actor.vz = (actor.z - pz) / dt;
  }
}

export function clearMotion(): void {
  travels.clear();
  slides.clear();
}

export function peekTravel(id: string): {
  fromX: number;
  fromZ: number;
  yaw: number;
  distance: number;
  startMs: number;
  durationMs: number;
} | null {
  const t = travels.get(id);
  if (!t) return null;
  return {
    fromX: t.fromX,
    fromZ: t.fromZ,
    yaw: t.yaw,
    distance: t.distance,
    startMs: t.startMs,
    durationMs: t.durationMs,
  };
}

export function hasBusyMotion(): boolean {
  return travels.size > 0 || slides.size > 0;
}

export function isMotionLocked(id: string): boolean {
  return travels.has(id) || slides.has(id);
}

export function beginTravelFromCast(
  def: AbilityDef,
  ownerId: string,
  now: number,
  aim?: { x: number; z: number } | null,
): { deferHit: boolean } {
  const actor = actorById(ownerId);
  if (!actor) return { deferHit: false };
  const travel = resolveTravel(def);
  if (def.confirmOnRelease && travel.mode === "instant") {
    const cap = travelDistance(def);
    const along = aimTravelAlongCursor(actor, aim ?? getAim(), cap);
    const dest = sampleTravel(actor, along.yaw, along.distance, 1);
    slides.delete(ownerId);
    travels.delete(ownerId);
    labSim.setActorPos(ownerId, dest.x, dest.z);
    actor.yaw = along.yaw;
    actor.vx = 0;
    actor.vz = 0;
    return { deferHit: false };
  }
  if (def.confirmOnRelease) return { deferHit: false };
  if (travel.mode === "none") return { deferHit: false };

  const stick = ownerId === CASTER_ID ? getWorldStick() : { x: 0, z: 0 };
  let travelYaw = def.id === "dash" ? dashTravelYaw(actor.yaw, stick.x, stick.z) : actor.yaw;
  if (travel.mode === "instant") {
    const dest = sampleTravel(actor, travelYaw, travelDistance(def), 1);
    slides.delete(ownerId);
    travels.delete(ownerId);
    labSim.setActorPos(ownerId, dest.x, dest.z);
    actor.yaw = travelYaw;
    actor.vx = 0;
    actor.vz = 0;
    return { deferHit: false };
  }
  if (travel.mode !== "translate") return { deferHit: false };

  let dist = travelDistance(def);
  if (def.id === "smash" || def.id === "dash") {
    const along = aimTravelAlongCursor(
      { x: actor.x, z: actor.z, yaw: travelYaw },
      aim ?? (ownerId === CASTER_ID ? getAim() : null),
      dist,
    );
    dist = along.distance;
    travelYaw = along.yaw;
    if (def.id === "dash") actor.yaw = travelYaw;
  }

  const from = { x: actor.x, z: actor.z };
  const takeoff = travelTakeoffDelayMs(def);
  const dur = travelDurationMs(def);
  slides.delete(ownerId);
  travels.set(ownerId, {
    actorId: ownerId,
    abilityId: def.id,
    fromX: from.x,
    fromZ: from.z,
    yaw: travelYaw,
    distance: dist,
    startMs: now + takeoff,
    durationMs: Math.max(16, dur),
    pendingLanding: travel.effectOnArrive === true && (def.shape === "aoe" || def.shape === "melee"),
    hitAlongPath: travel.hitAlongPath === true,
    pathHitIds: new Set(),
    lastX: from.x,
    lastZ: from.z,
  });
  return { deferHit: travel.effectOnArrive === true && (def.shape === "aoe" || def.shape === "melee") };
}

function scheduleSlide(
  actorId: string,
  toX: number,
  toZ: number,
  now: number,
  durationMs: number,
): void {
  const actor = actorById(actorId);
  if (!actor) return;
  const dx = toX - actor.x;
  const dz = toZ - actor.z;
  if (Math.hypot(dx, dz) < 0.05) return;
  travels.delete(actorId);
  slides.set(actorId, {
    actorId,
    fromX: actor.x,
    fromZ: actor.z,
    toX,
    toZ,
    startAt: now,
    endAt: now + Math.max(80, durationMs),
  });
}

export function applyKnockback(
  center: { x: number; z: number },
  targetId: string,
  distance: number,
  durationMs: number,
  now: number,
): void {
  if (!(distance > 0)) return;
  const actor = actorById(targetId);
  if (!actor) return;
  let dx = actor.x - center.x;
  let dz = actor.z - center.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-4) {
    dx = Math.sin(actor.yaw);
    dz = Math.cos(actor.yaw);
    len = 1;
  }
  const nx = dx / len;
  const nz = dz / len;
  scheduleSlide(targetId, actor.x + nx * distance, actor.z + nz * distance, now, durationMs);
}

export function applyPullToward(
  origin: { x: number; z: number },
  targetId: string,
  distance: number,
  durationMs: number,
  now: number,
  stopDistance = 1.2,
): void {
  if (!(distance > 0)) return;
  const actor = actorById(targetId);
  if (!actor) return;
  const minDist = Math.max(0.6, stopDistance);
  const dx = origin.x - actor.x;
  const dz = origin.z - actor.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4 || len <= minDist + 0.05) return;
  const travel = Math.min(distance, Math.max(0, len - minDist));
  if (travel < 0.05) return;
  const nx = dx / len;
  const nz = dz / len;
  scheduleSlide(targetId, actor.x + nx * travel, actor.z + nz * travel, now, durationMs);
}

export function applySelfLeap(
  ownerId: string,
  targetId: string,
  distance: number,
  durationMs: number,
  now: number,
  stopDistance = 1.2,
): void {
  if (!(distance > 0)) return;
  const owner = actorById(ownerId);
  const target = actorById(targetId);
  if (!owner || !target) return;
  const minDist = Math.max(0.6, stopDistance ?? 1.2);
  const dx = target.x - owner.x;
  const dz = target.z - owner.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4 || len <= minDist + 0.05) return;
  const travel = Math.max(0, len - minDist);
  if (travel < 0.05) return;
  const nx = dx / len;
  const nz = dz / len;
  owner.yaw = Math.atan2(dx, dz);
  scheduleSlide(ownerId, owner.x + nx * travel, owner.z + nz * travel, now, durationMs);
}

function segmentHits(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  tx: number,
  tz: number,
  radius: number,
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) return Math.hypot(tx - fromX, tz - fromZ) <= radius;
  let t = ((tx - fromX) * dx + (tz - fromZ) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = fromX + dx * t;
  const pz = fromZ + dz * t;
  return Math.hypot(tx - px, tz - pz) <= radius;
}

export function tickWalk(dt: number, phase: CastPhaseId | null, abilityId: string): void {
  const stick = getWorldStick();
  const mag = Math.hypot(stick.x, stick.z);
  const dummy = labSim.target();
  if (isShift() && mag > 0.12) {
    if (!isMotionLocked(TARGET_ID)) {
      const next = applyMovement(
        { x: dummy.x, z: dummy.z },
        { moveX: stick.x, moveZ: stick.z, dt },
        MOVE_SPEED,
      );
      dummy.vx = stick.x;
      dummy.vz = stick.z;
      dummy.yaw = Math.atan2(stick.x, stick.z);
      labSim.setTargetPos(next.x, next.z);
    }
    const caster = labSim.caster();
    if (!isMotionLocked(CASTER_ID)) {
      caster.vx = 0;
      caster.vz = 0;
    }
    return;
  }
  if (!isMotionLocked(TARGET_ID)) {
    dummy.vx = 0;
    dummy.vz = 0;
  }

  const caster = labSim.caster();
  if (isMotionLocked(CASTER_ID) || mag < 0.12) {
    if (!isMotionLocked(CASTER_ID)) {
      caster.vx = 0;
      caster.vz = 0;
    }
    return;
  }
  const def = ABILITIES[abilityId];
  const mul =
    phase && def ? resolveCastMoveMul(def, phase) : 1;
  const next = applyMovement(
    { x: caster.x, z: caster.z },
    { moveX: stick.x, moveZ: stick.z, dt },
    MOVE_SPEED * mul,
  );
  caster.vx = stick.x * MOVE_SPEED * mul;
  caster.vz = stick.z * MOVE_SPEED * mul;
  labSim.setCasterPos(next.x, next.z);
}

export function tickMotion(now: number, dt: number, hooks: MotionHooks = {}): void {
  for (const [id, travel] of [...travels]) {
    const actor = actorById(id);
    if (!actor) {
      travels.delete(id);
      continue;
    }
    const def = ABILITIES[travel.abilityId];
    if (now < travel.startMs) continue;
    const linear = Math.min(
      1,
      Math.max(0, (now - travel.startMs) / Math.max(1, travel.durationMs)),
    );
    const p = def ? travelProgress01(def, linear) : linear;
    const next = sampleTravel(
      { x: travel.fromX, z: travel.fromZ },
      travel.yaw,
      travel.distance,
      p,
    );
    const prevX = travel.lastX;
    const prevZ = travel.lastZ;
    writePos(id, actor, next.x, next.z, dt);
    travel.lastX = actor.x;
    travel.lastZ = actor.z;

    if (travel.hitAlongPath && def) {
      const radius = def.radius ?? 0.75;
      labSim.targets.forEach((t, tid) => {
        if (travel.pathHitIds.has(tid)) return;
        if (!segmentHits(prevX, prevZ, actor.x, actor.z, t.x, t.z, radius)) return;
        travel.pathHitIds.add(tid);
        hooks.onPathHit?.(id, def, tid, t.x, t.z);
      });
    }

    if (now >= travel.startMs + travel.durationMs) {
      travels.delete(id);
      actor.vx = 0;
      actor.vz = 0;
      if (travel.pendingLanding && def) hooks.onLand?.(id, def);
    }
  }

  for (const [id, slide] of [...slides]) {
    const actor = actorById(id);
    if (!actor) {
      slides.delete(id);
      continue;
    }
    const dur = Math.max(1, slide.endAt - slide.startAt);
    const linear = Math.min(1, Math.max(0, (now - slide.startAt) / dur));
    const t = 1 - (1 - linear) * (1 - linear);
    writePos(
      id,
      actor,
      slide.fromX + (slide.toX - slide.fromX) * t,
      slide.fromZ + (slide.toZ - slide.fromZ) * t,
      dt,
    );
    if (now >= slide.endAt) {
      slides.delete(id);
      actor.vx = 0;
      actor.vz = 0;
    }
  }
}
