export const CASTER_ID = "lab-caster";
export const TARGET_ID = "lab-target";
export const CROWD_PREFIX = "lab-crowd-";
export const EXTRA_DUMMY_PREFIX = "lab-dummy-";

/** Dummy starts 8m along the caster's default facing (-Z). */
export const DEFAULT_TARGET_X = 0;
export const DEFAULT_TARGET_Z = -8;
export const LAB_BOUNDS = 22;

export function clampLab(n: number): number {
  return Math.max(-LAB_BOUNDS, Math.min(LAB_BOUNDS, n));
}
const EXTRA_DUMMY_RADIUS = 1.65;
const CROWD_RING_RADIUS = 5.2;

export const SANDBOX_DUMMY_COUNTS = [1, 3, 5, 8] as const;
export const SANDBOX_CASTER_COUNTS = [1, 4, 10] as const;

export type LabStatus = {
  statusId: string;
  stacks: number;
  expiresAt: number;
};

export class LabStatusBag {
  private readonly data = new Map<string, LabStatus>();
  get(id: string): LabStatus | undefined {
    return this.data.get(id);
  }
  set(id: string, value: LabStatus): void {
    this.data.set(id, value);
  }
  delete(id: string): boolean {
    return this.data.delete(id);
  }
  clear(): void {
    this.data.clear();
  }
  forEach(fn: (value: LabStatus, key: string) => void): void {
    this.data.forEach((v, k) => fn(v, k));
  }
  get size(): number {
    return this.data.size;
  }
}

export type LabActor = {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  hp: number;
  kind?: string;
  role?: string;
  castPhase: string;
  castAbilityId: string;
  castPhaseEndsAt: number;
  castComboHit: number;
  castLockUntil: number;
  statuses: LabStatusBag;
};

export type LabProjectile = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  abilityId: string;
  ownerSessionId: string;
  targetX: number;
  targetZ: number;
};

function blankActor(kind: string, role: string): LabActor {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    hp: 1,
    kind,
    role,
    castPhase: "",
    castAbilityId: "",
    castPhaseEndsAt: 0,
    castComboHit: 0,
    castLockUntil: 0,
    statuses: new LabStatusBag(),
  };
}

function idsWithPrefix(map: LabMap<LabActor>, prefix: string): string[] {
  const ids: string[] = [];
  map.forEach((_v, id) => {
    if (id.startsWith(prefix)) ids.push(id);
  });
  ids.sort();
  return ids;
}

type LabMapLike<T> = {
  get: (id: string) => T | undefined;
  forEach: (fn: (value: T, key: string) => void) => void;
};

type Listener = () => void;

class LabMap<T> implements LabMapLike<T> {
  private readonly data = new Map<string, T>();
  constructor(private readonly emit: () => void) {}

  get(id: string): T | undefined {
    return this.data.get(id);
  }

  set(id: string, value: T, silent = false): void {
    this.data.set(id, value);
    if (!silent) this.emit();
  }

  delete(id: string): void {
    if (!this.data.delete(id)) return;
    this.emit();
  }

  clear(): void {
    if (this.data.size === 0) return;
    this.data.clear();
    this.emit();
  }

  forEach(fn: (value: T, key: string) => void): void {
    this.data.forEach((v, k) => fn(v, k));
  }

  get size(): number {
    return this.data.size;
  }
}

function emptyMaps(emit: () => void) {
  return {
    volcanoes: new LabMap<Record<string, unknown>>(emit),
    rockWalls: new LabMap<Record<string, unknown>>(emit),
    worldTrees: new LabMap<Record<string, unknown>>(emit),
    protectionBubbles: new LabMap<Record<string, unknown>>(emit),
    orbitingWisps: new LabMap<Record<string, unknown>>(emit),
    astralChains: new LabMap<Record<string, unknown>>(emit),
    soulSevers: new LabMap<Record<string, unknown>>(emit),
    riftPortals: new LabMap<Record<string, unknown>>(emit),
    shrooms: new LabMap<Record<string, unknown>>(emit),
    spiritHusks: new LabMap<Record<string, unknown>>(emit),
    pickups: new LabMap<Record<string, unknown>>(emit),
    decoys: new LabMap<Record<string, unknown>>(emit),
    spellbreakerProjectiles: new LabMap<Record<string, unknown>>(emit),
  };
}

export type LabSim = {
  room: {
    roomId: string;
    subscribeMaps: (fn: Listener) => () => void;
    state: {
      players: LabMap<LabActor>;
      targets: LabMap<LabActor>;
      projectiles: LabMap<LabProjectile>;
      volcanoes: LabMap<Record<string, unknown>>;
      rockWalls: LabMap<Record<string, unknown>>;
      worldTrees: LabMap<Record<string, unknown>>;
      protectionBubbles: LabMap<Record<string, unknown>>;
      orbitingWisps: LabMap<Record<string, unknown>>;
      astralChains: LabMap<Record<string, unknown>>;
      soulSevers: LabMap<Record<string, unknown>>;
      riftPortals: LabMap<Record<string, unknown>>;
      shrooms: LabMap<Record<string, unknown>>;
      spiritHusks: LabMap<Record<string, unknown>>;
      pickups: LabMap<Record<string, unknown>>;
      decoys: LabMap<Record<string, unknown>>;
      spellbreakerProjectiles: LabMap<Record<string, unknown>>;
    };
  };
  players: LabMap<LabActor>;
  targets: LabMap<LabActor>;
  projectiles: LabMap<LabProjectile>;
  world: ReturnType<typeof emptyMaps>;
  caster(): LabActor;
  target(): LabActor;
  extraDummyIds(): string[];
  crowdIds(): string[];
  setTargetPos(x: number, z: number): void;
  setCasterPos(x: number, z: number): void;
  setActorPos(id: string, x: number, z: number): void;
  placeTargetAtRange(dist: number): void;
  syncRoster(dummyCount: number, casterCount: number): void;
  /** Wall-clock (performance.now) until Ascendant Form scale should hold. */
  ascendantUntil: number;
  resetActors(): void;
  clearEphemeral(): void;
};

export function createLabSim(): LabSim {
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  const subscribeMaps = (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const players = new LabMap<LabActor>(emit);
  const targets = new LabMap<LabActor>(emit);
  const projectiles = new LabMap<LabProjectile>(emit);
  const world = emptyMaps(emit);

  const caster: LabActor = {
    x: 0,
    z: 0,
    yaw: Math.PI,
    vx: 0,
    vz: 0,
    hp: 1,
    kind: "player",
    role: "self",
    castPhase: "",
    castAbilityId: "",
    castPhaseEndsAt: 0,
    castComboHit: 0,
    castLockUntil: 0,
    statuses: new LabStatusBag(),
  };
  const dummy: LabActor = {
    x: DEFAULT_TARGET_X,
    z: DEFAULT_TARGET_Z,
    yaw: 0,
    vx: 0,
    vz: 0,
    hp: 1,
    kind: "dummy",
    role: "enemy",
    castPhase: "",
    castAbilityId: "",
    castPhaseEndsAt: 0,
    castComboHit: 0,
    castLockUntil: 0,
    statuses: new LabStatusBag(),
  };
  players.set(CASTER_ID, caster, true);
  targets.set(TARGET_ID, dummy, true);

  const clamp = clampLab;

  const extraDummyIds = () => idsWithPrefix(targets, EXTRA_DUMMY_PREFIX);
  const crowdIds = () => idsWithPrefix(players, CROWD_PREFIX);

  const layoutExtraDummies = () => {
    const extras = extraDummyIds();
    extras.forEach((id, i) => {
      const t = targets.get(id);
      if (!t) return;
      const a = ((i + 1) / (extras.length + 1)) * Math.PI * 2 - Math.PI * 0.5;
      t.x = clamp(dummy.x + Math.sin(a) * EXTRA_DUMMY_RADIUS);
      t.z = clamp(dummy.z + Math.cos(a) * EXTRA_DUMMY_RADIUS);
      t.role = dummy.role;
    });
  };

  const layoutCrowd = () => {
    const extras = crowdIds();
    extras.forEach((id, i) => {
      const p = players.get(id);
      if (!p) return;
      const a = (i / Math.max(1, extras.length)) * Math.PI * 2;
      p.x = clamp(Math.sin(a) * CROWD_RING_RADIUS);
      p.z = clamp(Math.cos(a) * CROWD_RING_RADIUS);
      const dx = dummy.x - p.x;
      const dz = dummy.z - p.z;
      if (dx * dx + dz * dz > 0.0001) p.yaw = Math.atan2(dx, dz);
    });
  };

  const prunePrefix = (map: LabMap<LabActor>, prefix: string, keep: number) => {
    const ids = idsWithPrefix(map, prefix);
    for (const id of ids) {
      const n = Number(id.slice(prefix.length));
      if (!Number.isFinite(n) || n >= keep) map.delete(id);
    }
  };

  const room: LabSim["room"] = {
    roomId: "vfx-lab",
    subscribeMaps,
    state: {
      players,
      targets,
      projectiles,
      volcanoes: world.volcanoes,
      rockWalls: world.rockWalls,
      worldTrees: world.worldTrees,
      protectionBubbles: world.protectionBubbles,
      orbitingWisps: world.orbitingWisps,
      astralChains: world.astralChains,
      soulSevers: world.soulSevers,
      riftPortals: world.riftPortals,
      shrooms: world.shrooms,
      spiritHusks: world.spiritHusks,
      pickups: world.pickups,
      decoys: world.decoys,
      spellbreakerProjectiles: world.spellbreakerProjectiles,
    },
  };

  return {
    room,
    players,
    targets,
    projectiles,
    world,
    caster: () => players.get(CASTER_ID)!,
    target: () => targets.get(TARGET_ID)!,
    extraDummyIds,
    crowdIds,
    setTargetPos(x: number, z: number) {
      dummy.x = clamp(x);
      dummy.z = clamp(z);
      layoutExtraDummies();
    },
    setCasterPos(x: number, z: number) {
      caster.x = clamp(x);
      caster.z = clamp(z);
    },
    setActorPos(id: string, x: number, z: number) {
      if (id === TARGET_ID) {
        dummy.x = clamp(x);
        dummy.z = clamp(z);
        layoutExtraDummies();
        return;
      }
      if (id === CASTER_ID) {
        caster.x = clamp(x);
        caster.z = clamp(z);
        return;
      }
      const actor = players.get(id) ?? targets.get(id);
      if (!actor) return;
      actor.x = clamp(x);
      actor.z = clamp(z);
    },
    placeTargetAtRange(dist: number) {
      const range = Math.max(0, dist);
      dummy.x = clamp(caster.x + Math.sin(caster.yaw) * range);
      dummy.z = clamp(caster.z + Math.cos(caster.yaw) * range);
      layoutExtraDummies();
    },
    syncRoster(dummyCount: number, casterCount: number) {
      const extras = Math.max(0, dummyCount - 1);
      prunePrefix(targets, EXTRA_DUMMY_PREFIX, extras);
      for (let i = 0; i < extras; i++) {
        const id = `${EXTRA_DUMMY_PREFIX}${i}`;
        if (!targets.get(id)) targets.set(id, blankActor("dummy", dummy.role ?? "enemy"));
      }
      const crowd = Math.max(0, casterCount - 1);
      prunePrefix(players, CROWD_PREFIX, crowd);
      for (let i = 0; i < crowd; i++) {
        const id = `${CROWD_PREFIX}${i}`;
        if (!players.get(id)) players.set(id, blankActor("crowd", "ally"));
      }
      layoutExtraDummies();
      layoutCrowd();
    },
    ascendantUntil: 0,
    resetActors() {
      const resetCast = (a: LabActor) => {
        a.castPhase = "";
        a.castAbilityId = "";
        a.castPhaseEndsAt = 0;
        a.castComboHit = 0;
        a.castLockUntil = 0;
        a.vx = 0;
        a.vz = 0;
        a.statuses.clear();
      };
      resetCast(caster);
      resetCast(dummy);
      dummy.hp = 1;
      players.forEach((p, id) => {
        if (id === CASTER_ID) return;
        resetCast(p);
      });
      targets.forEach((t, id) => {
        if (id === TARGET_ID) return;
        resetCast(t);
      });
    },
    clearEphemeral() {
      projectiles.clear();
      world.volcanoes.clear();
      world.rockWalls.clear();
      world.worldTrees.clear();
      world.protectionBubbles.clear();
      world.orbitingWisps.clear();
      world.astralChains.clear();
      world.soulSevers.clear();
      world.riftPortals.clear();
      world.shrooms.clear();
      world.spiritHusks.clear();
      world.pickups.clear();
      world.decoys.clear();
      world.spellbreakerProjectiles.clear();
    },
  };
}

export const labSim = createLabSim();
