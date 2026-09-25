import { ATLAS_UV } from "./atlas";
import { BatchId, Collide, LodRank, type EmitterSpawn } from "./types";
import type { ParticleWorld } from "./particleWorld";
import { spawnLightningCluster, killAllLightningClusters } from "./lightningArcs";

/**
 * Ardent Wilds–inspired element showcases for the lab only.
 * Recipes drawn from their handfx_*.vis layering (core + sparks + soft mist),
 * not asset copies. Does not change live spell VFX.
 */

export type ElementId =
  | "fire"
  | "frost"
  | "poison"
  | "lightning"
  | "void"
  | "wind"
  | "heal"
  | "holy"
  | "blood";

export const ELEMENT_GALLERY: readonly {
  id: ElementId;
  label: string;
}[] = [
  { id: "fire", label: "Fire" },
  { id: "frost", label: "Frost" },
  { id: "poison", label: "Poison" },
  { id: "lightning", label: "Lightning" },
  { id: "void", label: "Void" },
  { id: "wind", label: "Wind" },
  { id: "heal", label: "Heal" },
  { id: "holy", label: "Holy" },
  { id: "blood", label: "Blood" },
] as const;

type Layer = Partial<EmitterSpawn> & { x?: never; y?: never; z?: never };

function layersFor(id: ElementId): Layer[] {
  switch (id) {
    case "fire":
      return [
        {
          batch: BatchId.AdditiveFire,
          atlasUv: ATLAS_UV.fire,
          rate: 90,
          dirY: 2.4,
          spread: 0.14,
          gravity: 0.3,
          noise: 0.5,
          size: 0.85,
          sizeEnd: 0.18,
          life: 0.55,
          burst: 10,
          color0: "#fffbeb",
          color1: "#fb923c",
          color2: "#ea580c",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.spark,
          rate: 36,
          dirY: 1.6,
          spread: 0.22,
          size: 0.28,
          sizeEnd: 0.05,
          life: 0.75,
          burst: 4,
          color0: "#fef08a",
          color1: "#f97316",
          color2: "#b91c1c",
          lod: LodRank.Trail,
        },
        // Sandbox-style plume: fbm puffs, low opacity, billow + curl.
        {
          batch: BatchId.AlphaSmoke,
          rate: 28,
          dirY: 0.85,
          spread: 0.32,
          gravity: -0.75,
          drag: 1.4,
          noise: 0.55,
          size: 0.55,
          sizeEnd: 2.4,
          life: 2.4,
          lifeJitter: 0.4,
          opacity: 0.12,
          rotRate: 0.35,
          rotJitter: 1,
          color0: "#6b503f",
          color1: "#3b2c25",
          color2: "#141010",
          lod: LodRank.Trail,
        },
      ];
    case "frost":
      return [
        {
          batch: BatchId.AlphaIce,
          atlasUv: ATLAS_UV.ice,
          rate: 42,
          dirY: 1.4,
          spread: 0.22,
          gravity: 0.35,
          drag: 0.04,
          noise: 0.35,
          size: 0.5,
          sizeEnd: 0.18,
          life: 1.05,
          lifeJitter: 0.35,
          burst: 8,
          rotRate: 1.2,
          color0: "#ffffff",
          color1: "#bae6fd",
          color2: "#38bdf8",
          lod: LodRank.Core,
        },
        // Rolling frost mist — midway between vapor and plume.
        {
          batch: BatchId.AlphaSmoke,
          rate: 38,
          dirY: 0.38,
          spread: 0.42,
          gravity: -0.3,
          drag: 1.55,
          noise: 0.45,
          size: 0.6,
          sizeEnd: 2.3,
          life: 2.4,
          lifeJitter: 0.42,
          opacity: 0.045,
          rotRate: 0.22,
          rotJitter: 1,
          color0: "#f2feff",
          color1: "#cdefff",
          color2: "#09304c",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.glint,
          rate: 22,
          dirY: 1.0,
          spread: 0.4,
          gravity: 0.15,
          size: 0.24,
          sizeEnd: 0.04,
          life: 0.65,
          rotRate: 2.5,
          color0: "#ffffff",
          color1: "#e0f2fe",
          color2: "#7dd3fc",
          lod: LodRank.Trail,
        },
      ];
    case "poison":
      return [
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.spark,
          rate: 70,
          dirY: 1.5,
          spread: 0.2,
          gravity: 0.15,
          noise: 0.7,
          size: 0.42,
          sizeEnd: 0.08,
          life: 0.65,
          burst: 8,
          color0: "#ecfccb",
          color1: "#84cc16",
          color2: "#3f6212",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AlphaSmoke,
          atlasUv: ATLAS_UV.smoke,
          rate: 18,
          dirY: 0.7,
          spread: 0.4,
          gravity: -0.08,
          drag: 0.22,
          size: 0.85,
          sizeEnd: 1.6,
          life: 2.0,
          color0: "#a3e635",
          color1: "#4d7c0f",
          color2: "#1a2e05",
          lod: LodRank.Trail,
        },
      ];
    case "lightning":
      // Ribbon arcs are spawned separately (see spawnElementShowcase).
      return [
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.glint,
          rate: 18,
          dirY: 0.4,
          spread: 0.35,
          noise: 1.2,
          size: 0.18,
          sizeEnd: 0.03,
          life: 0.28,
          burst: 4,
          rotRate: 0,
          rotJitter: 0.25,
          color0: "#ffffff",
          color1: "#e0f2fe",
          color2: "#38bdf8",
          lod: LodRank.Trail,
        },
        // Ionised haze off the bolt (sandbox thunder.smoke).
        {
          batch: BatchId.AlphaSmoke,
          rate: 22,
          dirY: 0.55,
          spread: 0.28,
          gravity: -0.5,
          drag: 1.5,
          noise: 0.4,
          size: 0.5,
          sizeEnd: 2.0,
          life: 2.0,
          lifeJitter: 0.35,
          opacity: 0.07,
          rotRate: 0.3,
          rotJitter: 1,
          color0: "#3d546e",
          color1: "#33475e",
          color2: "#1c2938",
          lod: LodRank.Trail,
        },
      ];
    case "void":
      return [
        {
          batch: BatchId.AlphaSmoke,
          atlasUv: ATLAS_UV.void,
          rate: 22,
          dirY: 0.9,
          spread: 0.18,
          gravity: -0.15,
          drag: 0.12,
          noise: 0.35,
          size: 0.85,
          sizeEnd: 0.45,
          life: 1.1,
          burst: 4,
          rotRate: 0.8,
          color0: "#1e0736",
          color1: "#2e1065",
          color2: "#0c0218",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.void,
          rate: 36,
          dirY: 1.2,
          spread: 0.25,
          gravity: 0.05,
          noise: 0.7,
          size: 0.7,
          sizeEnd: 0.15,
          life: 0.55,
          rotRate: 1.4,
          color0: "#f5d0fe",
          color1: "#c026d3",
          color2: "#6b21a8",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.glint,
          rate: 20,
          dirY: 0.6,
          spread: 0.5,
          size: 0.2,
          sizeEnd: 0.03,
          life: 0.4,
          color0: "#fae8ff",
          color1: "#e879f9",
          color2: "#86198f",
          lod: LodRank.Trail,
        },
      ];
    case "wind":
      // Soft horizontal wisps — locked upright, no tumble scratches.
      return [
        {
          batch: BatchId.AlphaIce,
          atlasUv: ATLAS_UV.wind,
          rate: 55,
          dirX: 2.4,
          dirY: 0.4,
          dirZ: 0.1,
          spread: 0.2,
          gravity: 0.02,
          noise: 0.45,
          drag: 0.04,
          size: 1.2,
          sizeEnd: 0.55,
          life: 0.55,
          burst: 6,
          rotRate: 0,
          rotJitter: 0,
          color0: "#f8fafc",
          color1: "#e2e8f0",
          color2: "#94a3b8",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.wind,
          rate: 28,
          dirX: 2.0,
          dirY: 0.55,
          spread: 0.28,
          noise: 0.55,
          size: 0.85,
          sizeEnd: 0.25,
          life: 0.4,
          rotRate: 0,
          rotJitter: 0,
          color0: "#ffffff",
          color1: "#cbd5e1",
          color2: "#64748b",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AlphaSmoke,
          atlasUv: ATLAS_UV.smoke,
          rate: 6,
          dirX: 1.4,
          dirY: 0.3,
          spread: 0.4,
          drag: 0.18,
          size: 0.45,
          sizeEnd: 0.95,
          life: 0.9,
          color0: "#f8fafc",
          color1: "#e2e8f0",
          color2: "#cbd5e1",
          lod: LodRank.Trail,
        },
      ];
    case "heal":
      // Verdant restore: drifting leaves + soft green mist + gold glints.
      return [
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.leaf,
          rate: 28,
          dirY: 0.55,
          spread: 0.28,
          gravity: 0.28,
          drag: 0.35,
          noise: 0.35,
          size: 0.42,
          sizeEnd: 0.12,
          life: 1.8,
          lifeJitter: 0.4,
          burst: 6,
          rotRate: 1.0,
          rotJitter: 1,
          color0: "#ecfccb",
          color1: "#86efac",
          color2: "#16a34a",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.leaf,
          rate: 14,
          dirY: 0.28,
          dirX: 0.18,
          spread: 0.38,
          gravity: 0.15,
          drag: 0.4,
          noise: 0.45,
          size: 0.28,
          sizeEnd: 0.08,
          life: 1.6,
          rotRate: 1.4,
          rotJitter: 1,
          color0: "#fef9c3",
          color1: "#bbf7d0",
          color2: "#4ade80",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AlphaSmoke,
          rate: 22,
          dirY: 0.45,
          spread: 0.35,
          gravity: -0.35,
          drag: 1.4,
          noise: 0.4,
          size: 0.55,
          sizeEnd: 2.0,
          life: 2.0,
          lifeJitter: 0.35,
          opacity: 0.045,
          rotRate: 0.2,
          rotJitter: 1,
          color0: "#dcfce7",
          color1: "#86efac",
          color2: "#14532d",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.glint,
          rate: 16,
          dirY: 1.4,
          spread: 0.4,
          gravity: 0.1,
          size: 0.22,
          sizeEnd: 0.04,
          life: 0.55,
          rotRate: 0,
          rotJitter: 0.3,
          color0: "#fffbeb",
          color1: "#fef08a",
          color2: "#86efac",
          lod: LodRank.Trail,
        },
      ];
    case "holy":
      return [
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.glint,
          rate: 40,
          dirY: 1.8,
          spread: 0.22,
          gravity: 0.1,
          noise: 0.3,
          size: 0.45,
          sizeEnd: 0.08,
          life: 0.85,
          burst: 8,
          color0: "#fffbeb",
          color1: "#fef08a",
          color2: "#eab308",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.spark,
          rate: 22,
          dirY: 1.1,
          spread: 0.35,
          size: 0.3,
          sizeEnd: 0.05,
          life: 0.7,
          color0: "#fefce8",
          color1: "#fde68a",
          color2: "#ca8a04",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AlphaSmoke,
          rate: 14,
          dirY: 0.5,
          spread: 0.3,
          gravity: -0.4,
          drag: 1.3,
          noise: 0.35,
          size: 0.5,
          sizeEnd: 1.8,
          life: 1.8,
          opacity: 0.05,
          color0: "#fef9c3",
          color1: "#fde047",
          color2: "#713f12",
          lod: LodRank.Trail,
        },
      ];
    case "blood":
      // Heavy drip + floor spatters — same identity as caster blow (not an upward plume).
      return [
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.spark,
          rate: 55,
          dirY: -2.8,
          spread: 0.22,
          gravity: 5.2,
          drag: 0.05,
          noise: 0.15,
          size: 0.55,
          sizeEnd: 0.14,
          life: 0.7,
          burst: 16,
          color0: "#fecaca",
          color1: "#ef4444",
          color2: "#7f1d1d",
          lod: LodRank.Core,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.spark,
          rate: 32,
          dirY: -1.4,
          dirX: 0.35,
          dirZ: 0.35,
          spread: 0.55,
          gravity: 3.6,
          drag: 0.1,
          noise: 0.25,
          size: 0.32,
          sizeEnd: 0.08,
          life: 0.6,
          burst: 10,
          color0: "#f87171",
          color1: "#b91c1c",
          color2: "#450a0a",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.spark,
          rate: 22,
          dirY: 0.45,
          dirX: 1.1,
          dirZ: 1.1,
          spread: 1.35,
          gravity: 2.0,
          drag: 0.45,
          noise: 0.3,
          size: 0.22,
          sizeEnd: 0.05,
          life: 0.45,
          burst: 12,
          color0: "#ef4444",
          color1: "#7f1d1d",
          color2: "#1a0505",
          lod: LodRank.Trail,
        },
        {
          batch: BatchId.AlphaSmoke,
          rate: 14,
          dirY: 0.2,
          spread: 0.55,
          gravity: -0.15,
          drag: 1.1,
          noise: 0.35,
          size: 0.5,
          sizeEnd: 1.6,
          life: 1.4,
          opacity: 0.1,
          color0: "#9f1239",
          color1: "#4c0519",
          color2: "#1c0508",
          lod: LodRank.Trail,
        },
      ];
  }
}

function spawnLayers(
  world: ParticleWorld,
  x: number,
  y: number,
  z: number,
  layers: Layer[],
): number[] {
  const ids: number[] = [];
  for (const layer of layers) {
    const id = world.spawnEmitter({
      x,
      y,
      z,
      collide: Collide.None,
      groundY: 0,
      ...layer,
    });
    if (id >= 0) ids.push(id);
  }
  return ids;
}

/** One element cone at a world point. */
export function spawnElementShowcase(
  world: ParticleWorld,
  id: ElementId,
  x: number,
  y: number,
  z: number,
): number[] {
  if (id === "blood") {
    // Drip from hand height + spatters near the floor (matches caster blow)
    const layers = layersFor(id);
    const drip = layers.slice(0, 2);
    const ground = layers.slice(2);
    const ids = [
      ...spawnLayers(world, x, y, z, drip),
      ...spawnLayers(world, x, 0.1, z, ground),
    ];
    return ids;
  }
  const ids = spawnLayers(world, x, y, z, layersFor(id));
  if (id === "lightning") {
    spawnLightningCluster(x, y, z);
  }
  return ids;
}

/**
 * Row of all elements in front of the player (or origin).
 * Clears existing emitters first so the gallery is the only thing on screen.
 */
export function spawnElementGallery(
  world: ParticleWorld,
  origin?: { x: number; y?: number; z: number },
  spacing = 2.6,
): number[] {
  world.killAll();
  killAllLightningClusters();
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 1.1;
  const oz = origin?.z ?? 0;
  const n = ELEMENT_GALLERY.length;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const el = ELEMENT_GALLERY[i]!;
    const x = ox + (i - (n - 1) / 2) * spacing;
    ids.push(...spawnElementShowcase(world, el.id, x, oy, oz));
  }
  return ids;
}

/** Single-element focus (clears first). */
export function spawnElementFocus(
  world: ParticleWorld,
  id: ElementId,
  origin?: { x: number; y?: number; z: number },
): number[] {
  world.killAll();
  killAllLightningClusters();
  return spawnElementShowcase(
    world,
    id,
    origin?.x ?? 0,
    origin?.y ?? 1.1,
    origin?.z ?? 0,
  );
}
