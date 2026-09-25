import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ATLAS_UV } from "./engine/atlas";
import {
  BatchId,
  Collide,
  LodRank,
  killEmitter,
  setEmitterPose,
  setEmitterRate,
  setEmitterLook,
  spawnEmitter,
  type EmitterSpawn,
} from "./engine";
import {
  killLightningCluster,
  setLightningSegment,
  spawnLightningSegment,
} from "./engine/lightningArcs";
import type { StatusRowLite } from "../statusBadgeUtils";

/**
 * Persistent on-body status particles (burning, poisoned, bleeding, chilled, HoT).
 *
 * Unlike a cast, these live for seconds and run on every afflicted body at once, so
 * they are the easiest way to drain the particle pool. Three rules keep that in check:
 * a global emitter reservation shared by every body on screen, a hard cap of two auras
 * per body, and a camera-distance gate that falls back to the HP badge read at range.
 *
 * Mount inside `StatusOrnaments` so the anchor inherits the character transform; the
 * emitters themselves live in world space and are posed from the anchor each frame.
 */

/** Emitters reserved for all statuses on all bodies (of MAX_EMITTERS = 96). */
const STATUS_EMITTER_BUDGET = 20;

/** Most auras one body may show at once — stops a stacked target hogging the pool. */
const MAX_AURAS_PER_BODY = 2;

/** Camera distance to start showing auras, and the further distance to drop them. */
const SHOW_DISTANCE = 18;
const HIDE_DISTANCE = 21;

/** Shared reservation. Module-level because the budget spans every mounted body. */
let emittersUsed = 0;

/** Shocked body arcs live in the lightning pool, not the particle emitter budget. */
const SHOCK_CLUSTER_BUDGET = 8;
let shockClustersUsed = 0;

function reserveEmitters(n: number): boolean {
  if (emittersUsed + n > STATUS_EMITTER_BUDGET) return false;
  emittersUsed += n;
  return true;
}

function releaseEmitters(n: number): void {
  emittersUsed = Math.max(0, emittersUsed - n);
}

/** Layer recipe plus where it sits relative to the character's feet. */
type AuraLayer = Omit<EmitterSpawn, "x" | "y" | "z"> & {
  offsetY: number;
  /** Horizontal jitter of the emitter itself, so layers do not stack on one axis. */
  offsetX?: number;
  offsetZ?: number;
};

type AuraSpec = {
  /** Status ids that drive this aura — any match activates it. */
  readonly ids: readonly string[];
  readonly layers: readonly AuraLayer[];
  /** Stacks to rate multiplier. Density scales, emitter count never does. */
  readonly stackScale?: (stacks: number) => number;
  /** Optional spread/size/height vs stacks. 1 = authored look. */
  readonly stackLook?: (stacks: number) => { spread: number; size: number; height: number };
};

const BASE: Partial<EmitterSpawn> = {
  groundY: 0,
  collide: Collide.None,
  lod: LodRank.Trail,
};

/**
 * Order is priority: when a body carries more auras than `MAX_AURAS_PER_BODY`,
 * the ones earlier in this list win. Hard conditions (chill, burn) read before
 * soft ones (regen glow) because they change how you should play against the target.
 */
const AURA_SPECS: readonly AuraSpec[] = [
  {
    // Chilled — fog pours down the body and spreads at the feet, flakes tumble in it.
    ids: ["frostChill"],
    stackScale: (stacks) => 0.45 + Math.min(10, Math.max(1, stacks)) * 0.075,
    layers: [
      {
        offsetY: 0.95,
        batch: BatchId.AlphaSmoke,
        atlasUv: ATLAS_UV.smoke,
        rate: 16,
        dirY: -0.35,
        spread: 0.42,
        gravity: 0.3,
        drag: 1.9,
        noise: 0.3,
        size: 0.5,
        sizeEnd: 1.9,
        life: 2.4,
        lifeJitter: 0.45,
        opacity: 0.06,
        rotRate: 0.18,
        color0: "#f2feff",
        color1: "#cdefff",
        color2: "#09304c",
      },
      {
        offsetY: 0.75,
        batch: BatchId.AlphaIce,
        atlasUv: ATLAS_UV.ice,
        rate: 9,
        dirY: -0.1,
        spread: 0.48,
        gravity: 0.22,
        drag: 0.7,
        noise: 0.55,
        size: 0.11,
        sizeEnd: 0.05,
        life: 2.0,
        lifeJitter: 0.5,
        opacity: 0.9,
        rotRate: 1.4,
        color0: "#ffffff",
        color1: "#bae6fd",
        color2: "#7dd3fc",
      },
    ],
  },
  {
    // Burning — flame licks up off the torso, a few embers peel away and die in air.
    ids: ["burning"],
    layers: [
      {
        offsetY: 0.95,
        batch: BatchId.AdditiveFire,
        atlasUv: ATLAS_UV.fire,
        rate: 15,
        dirY: 1.3,
        spread: 0.3,
        gravity: -0.55,
        drag: 1.0,
        noise: 0.5,
        size: 0.34,
        sizeEnd: 0.07,
        life: 0.65,
        lifeJitter: 0.4,
        rotRate: 1.5,
        color0: "#fffbeb",
        color1: "#fb923c",
        color2: "#ea580c",
      },
      {
        offsetY: 1.15,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        rate: 7,
        dirY: 1.5,
        spread: 0.36,
        gravity: -0.3,
        drag: 0.5,
        noise: 0.8,
        size: 0.075,
        sizeEnd: 0.015,
        life: 1.0,
        lifeJitter: 0.5,
        color0: "#fef08a",
        color1: "#f97316",
        color2: "#b91c1c",
      },
    ],
  },
  {
    // Poisoned — lime bubbles up the torso + sickly mist at the feet.
    ids: ["poisoned"],
    stackScale: (stacks) => 0.75 + Math.min(3, Math.max(1, stacks)) * 0.28,
    stackLook: (stacks) => {
      const u = Math.min(3, Math.max(1, stacks));
      return {
        spread: 0.9 + u * 0.08,
        size: 0.9 + u * 0.1,
        height: 0.94 + u * 0.04,
      };
    },
    layers: [
      {
        offsetY: 0.78,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        rate: 14,
        dirY: 0.85,
        spread: 0.26,
        gravity: -0.22,
        drag: 0.85,
        noise: 0.8,
        size: 0.2,
        sizeEnd: 0.04,
        life: 1.35,
        lifeJitter: 0.4,
        opacity: 0.95,
        rotRate: 0.55,
        lod: LodRank.Core,
        color0: "#ecfccb",
        color1: "#84cc16",
        color2: "#3f6212",
      },
      {
        offsetY: 0.12,
        batch: BatchId.AlphaSmoke,
        atlasUv: ATLAS_UV.smoke,
        rate: 7,
        dirY: 0.22,
        spread: 0.32,
        gravity: -0.1,
        drag: 1.6,
        noise: 0.32,
        size: 0.36,
        sizeEnd: 1.15,
        life: 1.7,
        lifeJitter: 0.35,
        opacity: 0.14,
        rotRate: 0.22,
        lod: LodRank.Trail,
        color0: "#a3e635",
        color1: "#4d7c0f",
        color2: "#1a2e05",
      },
    ],
  },
  {
    // Bleeding — drips fall with real weight and break up on the floor.
    ids: ["bleeding"],
    stackScale: (stacks) => 0.65 + Math.min(3, Math.max(1, stacks)) * 0.18,
    layers: [
      {
        offsetY: 1.2,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        rate: 9,
        dirY: -0.5,
        spread: 0.26,
        gravity: 5.4,
        drag: 0.05,
        noise: 0.1,
        size: 0.1,
        sizeEnd: 0.035,
        life: 0.7,
        lifeJitter: 0.3,
        opacity: 0.95,
        rotRate: 0.1,
        rotJitter: 0.4,
        color0: "#fecaca",
        color1: "#ef4444",
        color2: "#7f1d1d",
      },
      {
        // Spatter: short-lived, low and wide, reads as the drip breaking on the ground.
        offsetY: 0.06,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        rate: 7,
        dirY: 0.5,
        spread: 0.3,
        gravity: 2.6,
        drag: 0.5,
        noise: 0.2,
        size: 0.06,
        sizeEnd: 0.015,
        life: 0.4,
        lifeJitter: 0.4,
        opacity: 0.8,
        rotRate: 0.1,
        rotJitter: 0.4,
        color0: "#f87171",
        color1: "#b91c1c",
        color2: "#450a0a",
      },
    ],
  },
  {
    // Soul severed — the same fluid language as bleed, drained of colour into violet.
    ids: ["soulSevered"],
    layers: [
      {
        offsetY: 1.25,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.void,
        rate: 8,
        dirY: -0.4,
        spread: 0.24,
        gravity: 4.2,
        drag: 0.1,
        noise: 0.15,
        size: 0.13,
        sizeEnd: 0.03,
        life: 0.8,
        lifeJitter: 0.35,
        opacity: 0.9,
        rotRate: 0.8,
        color0: "#f5d0fe",
        color1: "#c026d3",
        color2: "#6b21a8",
      },
    ],
  },
  {
    // Regeneration — leaves spiral up the body. 1 stack is a thin whisper; 3 is the full well.
    ids: ["rejuvenated", "overflowingGraceHot"],
    stackScale: (stacks) => {
      const s = Math.max(1, Math.min(3, stacks));
      return s === 1 ? 0.78 : s === 2 ? 1.08 : 1.42;
    },
    stackLook: (stacks) => {
      const s = Math.max(1, Math.min(3, stacks));
      if (s === 1) return { spread: 0.55, size: 0.78, height: 0.84 };
      if (s === 2) return { spread: 0.8, size: 0.94, height: 0.94 };
      return { spread: 1.08, size: 1.14, height: 1.08 };
    },
    layers: [
      {
        offsetY: 0.35,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.leaf,
        rate: 16,
        dirY: 1.15,
        spread: 0.42,
        gravity: -0.45,
        drag: 0.75,
        noise: 0.55,
        size: 0.24,
        sizeEnd: 0.05,
        life: 1.5,
        lifeJitter: 0.35,
        opacity: 0.95,
        rotRate: 1.6,
        rotJitter: 1,
        color0: "#ecfccb",
        color1: "#86efac",
        color2: "#16a34a",
      },
      {
        offsetY: 0.6,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        rate: 8,
        dirY: 1.35,
        spread: 0.36,
        gravity: -0.3,
        drag: 0.65,
        size: 0.12,
        sizeEnd: 0.025,
        life: 0.9,
        lifeJitter: 0.4,
        rotRate: 0,
        rotJitter: 0.3,
        color0: "#fffbeb",
        color1: "#fef08a",
        color2: "#86efac",
      },
    ],
  },
  {
    // Weakened — ash sifts down off the body. Falling, not rising: decay, not another cloud.
    ids: ["weakened"],
    layers: [
      {
        offsetY: 1.1,
        batch: BatchId.AlphaSmoke,
        atlasUv: ATLAS_UV.smoke,
        rate: 9,
        dirY: -0.45,
        spread: 0.34,
        gravity: 0.55,
        drag: 1.5,
        noise: 0.3,
        size: 0.26,
        sizeEnd: 0.9,
        life: 1.7,
        lifeJitter: 0.45,
        opacity: 0.11,
        rotRate: 0.3,
        color0: "#cbd5e1",
        color1: "#64748b",
        color2: "#1e293b",
      },
    ],
  },
];

/** One aura's live emitters. */
type LiveAura = {
  specIndex: number;
  ids: number[];
  baseRates: number[];
  baseSpread: number[];
  baseSize: number[];
  baseSizeEnd: number[];
  offsetY: number[];
  offsetX: number[];
  offsetZ: number[];
};

type Props = {
  /** Same per-frame poll `StatusOrnaments` uses — returns [] while stealthed. */
  getStatuses: () => StatusRowLite[];
  /** The local player's own body — always shown, never distance-gated. */
  local?: boolean;
};

export function StatusAuraFx({ getStatuses, local = false }: Props) {
  const anchor = useRef<THREE.Group>(null);
  const live = useRef<LiveAura[]>([]);
  const world = useRef(new THREE.Vector3());
  /** Hysteresis latch so bodies at the range boundary do not churn emitters. */
  const inRange = useRef(local);
  /** Reused between frames so the per-frame scan allocates nothing. */
  const wanted = useRef<{ specIndex: number; scale: number; spread: number; size: number; height: number }[]>([]);
  const shockId = useRef(-1);

  const dropShock = () => {
    if (shockId.current < 0) return;
    killLightningCluster(shockId.current);
    shockId.current = -1;
    shockClustersUsed = Math.max(0, shockClustersUsed - 1);
  };

  const dropAura = (aura: LiveAura) => {
    for (const id of aura.ids) killEmitter(id);
    releaseEmitters(aura.ids.length);
  };

  const dropAll = () => {
    for (const aura of live.current) dropAura(aura);
    live.current.length = 0;
  };

  useEffect(
    () => () => {
      dropAll();
      dropShock();
    },
    [],
  );

  useFrame((state) => {
    const anchorGroup = anchor.current;
    if (!anchorGroup) return;

    const rows = getStatuses();
    anchorGroup.getWorldPosition(world.current);

    if (!local) {
      const dist = state.camera.position.distanceTo(world.current);
      if (inRange.current ? dist > HIDE_DISTANCE : dist < SHOW_DISTANCE) {
        inRange.current = !inRange.current;
      }
    }

    if (rows.length === 0 || !inRange.current) {
      if (live.current.length > 0) dropAll();
      dropShock();
      return;
    }

    // Collect what this body should be showing, in priority order.
    const want = wanted.current;
    want.length = 0;
    for (let i = 0; i < AURA_SPECS.length && want.length < MAX_AURAS_PER_BODY; i++) {
      const spec = AURA_SPECS[i]!;
      let stacks = 0;
      let found = false;
      for (const row of rows) {
        if (!spec.ids.includes(row.statusId)) continue;
        found = true;
        stacks = Math.max(stacks, row.stacks ?? 1);
      }
      if (!found) continue;
      const look = spec.stackLook?.(stacks);
      want.push({
        specIndex: i,
        scale: spec.stackScale?.(stacks) ?? 1,
        spread: look?.spread ?? 1,
        size: look?.size ?? 1,
        height: look?.height ?? 1,
      });
    }

    // Retire auras whose status dropped (or lost its priority slot).
    for (let i = live.current.length - 1; i >= 0; i--) {
      const aura = live.current[i]!;
      let stillWanted = false;
      for (let w = 0; w < want.length; w++) {
        if (want[w]!.specIndex === aura.specIndex) {
          stillWanted = true;
          break;
        }
      }
      if (stillWanted) continue;
      dropAura(aura);
      live.current.splice(i, 1);
    }

    const x = world.current.x;
    const y = world.current.y;
    const z = world.current.z;

    for (let w = 0; w < want.length; w++) {
      const entry = want[w]!;
      let aura: LiveAura | undefined;
      for (let i = 0; i < live.current.length; i++) {
        if (live.current[i]!.specIndex === entry.specIndex) {
          aura = live.current[i];
          break;
        }
      }
      if (!aura) {
        const spec = AURA_SPECS[entry.specIndex]!;
        if (!reserveEmitters(spec.layers.length)) continue;
        const next: LiveAura = {
          specIndex: entry.specIndex,
          ids: [],
          baseRates: [],
          baseSpread: [],
          baseSize: [],
          baseSizeEnd: [],
          offsetY: [],
          offsetX: [],
          offsetZ: [],
        };
        for (const layer of spec.layers) {
          const id = spawnEmitter({
            ...BASE,
            ...layer,
            x: x + (layer.offsetX ?? 0),
            y: y + layer.offsetY,
            z: z + (layer.offsetZ ?? 0),
          });
          if (id < 0) continue;
          next.ids.push(id);
          next.baseRates.push(layer.rate ?? 0);
          next.baseSpread.push(layer.spread ?? 0.18);
          next.baseSize.push(layer.size ?? 0.2);
          next.baseSizeEnd.push(layer.sizeEnd ?? 0.04);
          next.offsetY.push(layer.offsetY);
          next.offsetX.push(layer.offsetX ?? 0);
          next.offsetZ.push(layer.offsetZ ?? 0);
        }
        // Partial spawn (pool full): release the slack so the budget stays honest.
        if (next.ids.length < spec.layers.length) {
          releaseEmitters(spec.layers.length - next.ids.length);
        }
        if (next.ids.length === 0) continue;
        live.current.push(next);
        aura = next;
      }

      for (let i = 0; i < aura.ids.length; i++) {
        setEmitterPose(
          aura.ids[i]!,
          x + aura.offsetX[i]!,
          y + aura.offsetY[i]! * entry.height,
          z + aura.offsetZ[i]!,
        );
        setEmitterRate(aura.ids[i]!, aura.baseRates[i]! * entry.scale);
        setEmitterLook(
          aura.ids[i]!,
          aura.baseSpread[i]! * entry.spread,
          aura.baseSize[i]! * entry.size,
          aura.baseSizeEnd[i]! * entry.size,
        );
      }
    }

    // Shocked keeps the lab ground mark in StatusOrnaments. This is the body crackle.
    let shockStacks = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.statusId === "shocked") {
        shockStacks = Math.max(shockStacks, rows[i]!.stacks ?? 1);
      }
    }
    if (shockStacks <= 0) {
      dropShock();
    } else {
      const reach = 0.22 + Math.min(3, shockStacks) * 0.1;
      const t = state.clock.elapsedTime;
      const ax = x + Math.cos(t * 7) * reach;
      const az = z + Math.sin(t * 7) * reach;
      const bx = x - Math.cos(t * 5.3) * reach;
      const bz = z - Math.sin(t * 5.3) * reach;
      const ay = y + 1.2;
      const by = y + 0.72;
      if (shockId.current < 0 && shockClustersUsed < SHOCK_CLUSTER_BUDGET) {
        const id = spawnLightningSegment(ax, ay, az, bx, by, bz, {
          strands: Math.min(3, shockStacks),
          spreadMul: 0.22,
          jitterMul: 0.4,
          sag: 0.04,
          tipGlow: 0.15,
          colorCore: "#f8fafc",
          colorInner: "#67e8f9",
          colorOuter: "#38bdf8",
          colorHalo: "#0b3fc8",
        });
        if (id >= 0) {
          shockId.current = id;
          shockClustersUsed++;
        }
      } else if (shockId.current >= 0) {
        setLightningSegment(shockId.current, ax, ay, az, bx, by, bz);
      }
    }
  });

  return <group ref={anchor} />;
}
