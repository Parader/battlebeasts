import { ATLAS_UV } from "./atlas";
import { BatchId, Collide, LodRank, type AtlasUv, type EmitterSpawn } from "./types";
import type { ParticleWorld } from "./particleWorld";
import { killAllLightningClusters } from "./lightningArcs";
import { getElementSettings } from "./elementSettings";
import type { ElementId } from "./elementGallery";
import type { ShapeId } from "./shapeKinds";
import { spawnElementShowcase } from "./elementGallery";

type Palette = { c0: string; c1: string; c2: string; batch: BatchId; uv?: AtlasUv };

const PALETTE: Record<ElementId, Palette> = {
  fire: { c0: "#fffbeb", c1: "#fb923c", c2: "#ea580c", batch: BatchId.AdditiveFire, uv: ATLAS_UV.fire },
  frost: { c0: "#ffffff", c1: "#bae6fd", c2: "#38bdf8", batch: BatchId.AlphaIce, uv: ATLAS_UV.ice },
  poison: { c0: "#ecfccb", c1: "#84cc16", c2: "#3f6212", batch: BatchId.AdditiveSpark, uv: ATLAS_UV.spark },
  lightning: { c0: "#ffffff", c1: "#e0f2fe", c2: "#38bdf8", batch: BatchId.AdditiveSpark, uv: ATLAS_UV.glint },
  void: { c0: "#f5d0fe", c1: "#c026d3", c2: "#6b21a8", batch: BatchId.AdditiveSpark, uv: ATLAS_UV.void },
  wind: { c0: "#f8fafc", c1: "#e2e8f0", c2: "#94a3b8", batch: BatchId.AlphaIce, uv: ATLAS_UV.wind },
  heal: { c0: "#ecfccb", c1: "#86efac", c2: "#16a34a", batch: BatchId.AdditiveSpark, uv: ATLAS_UV.leaf },
  holy: { c0: "#fffbeb", c1: "#fef08a", c2: "#eab308", batch: BatchId.AdditiveSpark, uv: ATLAS_UV.glint },
  blood: { c0: "#fecaca", c1: "#ef4444", c2: "#7f1d1d", batch: BatchId.AdditiveSpark, uv: ATLAS_UV.spark },
};

function spawn(
  world: ParticleWorld,
  cfg: EmitterSpawn,
): number {
  return world.spawnEmitter({ collide: Collide.None, groundY: 0, ...cfg });
}

/**
 * Caster blow accents — element-specific particle recipes (mesh is the form; this is the feel).
 */
function spawnCaster(world: ParticleWorld, id: ElementId, x: number, y: number, z: number): number[] {
  const s = getElementSettings(id);
  const p = PALETTE[id];
  const handY = Math.max(y, 1.05);
  const hx = x + 0.2;
  const hz = z + 0.55;
  const ids: number[] = [];

  if (id === "fire") {
    // Flame plume + ember sparks around the hand light
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 2.4,
        rate: Math.max(40, s.rate * 1.1),
        spread: 0.2,
        gravity: 0.25,
        drag: 0.18,
        noise: 0.6,
        batch: BatchId.AdditiveFire,
        atlasUv: ATLAS_UV.fire,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.5,
        sizeEnd: 0.12,
        life: 0.5,
        burst: 16,
        opacity: s.opacity,
        rotRate: 1.6,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 1.8,
        rate: 28,
        spread: 0.4,
        gravity: 0.5,
        noise: 0.45,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        color0: "#fef08a",
        color1: p.c1,
        color2: p.c2,
        size: 0.18,
        sizeEnd: 0.03,
        life: 0.55,
        burst: 10,
        opacity: 0.9,
        rotRate: 2.2,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "frost") {
    // Ice shards + frosted smoke
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.7,
        rate: 28,
        spread: 0.45,
        gravity: 0.55,
        drag: 0.08,
        noise: 0.35,
        batch: BatchId.AlphaIce,
        atlasUv: ATLAS_UV.ice,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.32,
        sizeEnd: 0.1,
        life: 0.9,
        burst: 14,
        opacity: s.opacity,
        rotRate: 1.5,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY - 0.05,
        z: hz,
        dirY: 0.35,
        rate: 22,
        spread: 0.5,
        gravity: -0.25,
        drag: 1.4,
        noise: 0.4,
        batch: BatchId.AlphaSmoke,
        color0: "#f2feff",
        color1: "#cdefff",
        color2: "#09304c",
        size: 0.4,
        sizeEnd: 1.4,
        life: 1.6,
        opacity: 0.08,
        rotRate: 0.25,
        lod: LodRank.Trail,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.5,
        rate: 14,
        spread: 0.55,
        gravity: 0.1,
        noise: 0.3,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: "#ffffff",
        color1: p.c1,
        color2: p.c2,
        size: 0.1,
        sizeEnd: 0.02,
        life: 0.5,
        burst: 6,
        opacity: 0.75,
        rotRate: 2,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "poison") {
    // Compact toxic emissions
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.55,
        rate: 18,
        spread: 0.28,
        gravity: -0.1,
        drag: 0.45,
        noise: 0.55,
        batch: BatchId.AlphaSmoke,
        atlasUv: ATLAS_UV.smoke,
        color0: "#a3e635",
        color1: "#4d7c0f",
        color2: "#1a2e05",
        size: 0.28,
        sizeEnd: 0.7,
        life: 0.9,
        opacity: 0.14,
        rotRate: 0.3,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.7,
        rate: 22,
        spread: 0.28,
        gravity: 0.05,
        drag: 0.25,
        noise: 0.6,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.12,
        sizeEnd: 0.03,
        life: 0.45,
        burst: 6,
        opacity: s.opacity,
        rotRate: 0.8,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "lightning") {
    // Filament strikes come from LabShapePreview; particles are local crackle only
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.55,
        rate: 28,
        spread: 0.45,
        gravity: 0,
        drag: 0.08,
        noise: 1.2,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: "#ffffff",
        color1: "#e0f2fe",
        color2: p.c2,
        size: 0.16,
        sizeEnd: 0.03,
        life: 0.26,
        burst: 12,
        opacity: 1,
        rotRate: 0,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.3,
        rate: 8,
        spread: 0.35,
        gravity: -0.2,
        drag: 1.0,
        noise: 0.35,
        batch: BatchId.AlphaSmoke,
        color0: "#3d546e",
        color1: "#33475e",
        color2: "#1c2938",
        size: 0.3,
        sizeEnd: 0.7,
        life: 0.65,
        opacity: 0.07,
        rotRate: 0.2,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "void") {
    // Visible purple pull — bright motes + dark haze around the small sphere
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.15,
        rate: 28,
        spread: 0.45,
        gravity: -0.35,
        drag: 0.35,
        noise: 0.7,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.void,
        color0: "#fae8ff",
        color1: "#e879f9",
        color2: "#a21caf",
        size: 0.28,
        sizeEnd: 0.08,
        life: 0.65,
        burst: 12,
        opacity: 0.95,
        rotRate: 1.5,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.4,
        rate: 16,
        spread: 0.5,
        gravity: 0,
        drag: 0.4,
        noise: 0.5,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: "#f5d0fe",
        color1: "#c026d3",
        color2: "#6b21a8",
        size: 0.12,
        sizeEnd: 0.025,
        life: 0.45,
        burst: 8,
        opacity: 0.85,
        rotRate: 0.5,
        lod: LodRank.Trail,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: -0.15,
        rate: 10,
        spread: 0.35,
        gravity: 0,
        drag: 0.55,
        noise: 0.4,
        batch: BatchId.AlphaSmoke,
        atlasUv: ATLAS_UV.void,
        color0: "#2e1065",
        color1: "#1e0736",
        color2: "#0c0218",
        size: 0.35,
        sizeEnd: 0.7,
        life: 0.9,
        opacity: 0.22,
        rotRate: 0.5,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "wind") {
    // Short gust wisps
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirX: 1.15,
        dirY: 0.3,
        dirZ: 0.15,
        rate: 28,
        spread: 0.28,
        gravity: 0.02,
        drag: 0.08,
        noise: 0.5,
        batch: BatchId.AlphaIce,
        atlasUv: ATLAS_UV.wind,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.45,
        sizeEnd: 0.15,
        life: 0.32,
        burst: 8,
        opacity: s.opacity,
        rotRate: 0,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirX: 0.95,
        dirY: 0.35,
        rate: 16,
        spread: 0.3,
        noise: 0.55,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.wind,
        color0: "#ffffff",
        color1: p.c1,
        color2: p.c2,
        size: 0.28,
        sizeEnd: 0.08,
        life: 0.28,
        burst: 5,
        opacity: 0.75,
        rotRate: 0,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "heal") {
    // Leaf emission around the soft sphere
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.75,
        rate: 22,
        spread: 0.45,
        gravity: 0.22,
        drag: 0.35,
        noise: 0.45,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.leaf,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.3,
        sizeEnd: 0.08,
        life: 1.0,
        burst: 10,
        opacity: 0.85,
        rotRate: 2.0,
        rotJitter: 1,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.9,
        rate: 12,
        spread: 0.35,
        gravity: 0.1,
        noise: 0.3,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: "#fffbeb",
        color1: "#fef08a",
        color2: p.c1,
        size: 0.1,
        sizeEnd: 0.02,
        life: 0.5,
        burst: 5,
        opacity: 0.65,
        rotRate: 0,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "holy") {
    // Soft motes around the small hand light
    ids.push(
      spawn(world, {
        x: hx,
        y: handY,
        z: hz,
        dirY: 0.45,
        rate: 14,
        spread: 0.35,
        gravity: -0.1,
        drag: 0.5,
        noise: 0.3,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.14,
        sizeEnd: 0.03,
        life: 0.7,
        burst: 6,
        opacity: 0.7,
        rotRate: 0.2,
        lod: LodRank.Core,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "blood") {
    // Blood spray along the melee slash arc (particles accent the crescent swipe mesh)
    ids.push(
      spawn(world, {
        x: hx + 0.2,
        y: handY + 0.05,
        z: hz + 0.15,
        dirX: 1.4,
        dirY: -0.35,
        dirZ: 0.9,
        rate: 22,
        spread: 0.35,
        gravity: 1.4,
        drag: 0.12,
        noise: 0.45,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        color0: "#fecaca",
        color1: p.c1,
        color2: p.c2,
        size: 0.16,
        sizeEnd: 0.03,
        life: 0.28,
        burst: 8,
        opacity: 0.95,
        rotRate: 0.4,
        lod: LodRank.Core,
        duration: 12,
      }),
      spawn(world, {
        x: hx + 0.05,
        y: handY - 0.05,
        z: hz + 0.1,
        dirX: 0.6,
        dirY: -1.2,
        dirZ: 0.35,
        rate: 12,
        spread: 0.25,
        gravity: 2.2,
        drag: 0.08,
        noise: 0.3,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.spark,
        color0: "#ef4444",
        color1: "#7f1d1d",
        color2: "#450a0a",
        size: 0.1,
        sizeEnd: 0.02,
        life: 0.35,
        burst: 4,
        opacity: 0.75,
        rotRate: 0.2,
        lod: LodRank.Trail,
        duration: 12,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  return ids;
}

/**
 * Impact particles — element identity bursts (mark mesh carries the ground look).
 */
function spawnImpact(world: ParticleWorld, id: ElementId, x: number, y: number, z: number): number[] {
  const s = getElementSettings(id);
  const p = PALETTE[id];
  const ids: number[] = [];

  if (id === "fire") {
    ids.push(
      spawn(world, {
        x, y: 0.2, z, dirY: 2.2, rate: 50, spread: 0.55, gravity: 0.4, drag: 0.15, noise: 0.5,
        batch: BatchId.AdditiveFire, atlasUv: ATLAS_UV.fire,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: 0.55, sizeEnd: 0.12, life: 0.4, burst: 18, opacity: s.opacity, rotRate: 1.8,
        lod: LodRank.Core, duration: 0.45,
      }),
    );
  } else if (id === "frost") {
    ids.push(
      spawn(world, {
        x, y: 0.25, z, dirY: 1.0, rate: 36, spread: 0.85, gravity: 0.8, drag: 0.08, noise: 0.35,
        batch: BatchId.AlphaIce, atlasUv: ATLAS_UV.ice,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: 0.35, sizeEnd: 0.1, life: 0.55, burst: 16, opacity: s.opacity, rotRate: 1.5,
        lod: LodRank.Core, duration: 0.5,
      }),
    );
  } else if (id === "poison") {
    ids.push(
      spawn(world, {
        x, y: 0.15, z, dirY: 0.8, rate: 30, spread: 0.7, gravity: 0.2, drag: 0.3, noise: 0.7,
        batch: BatchId.AdditiveSpark, atlasUv: ATLAS_UV.spark,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: 0.28, sizeEnd: 0.06, life: 0.5, burst: 14, opacity: s.opacity, rotRate: 0.8,
        lod: LodRank.Core, duration: 0.5,
      }),
      spawn(world, {
        x, y: 0.1, z, dirY: 0.4, rate: 12, spread: 0.6, gravity: -0.1, drag: 0.5, noise: 0.5,
        batch: BatchId.AlphaSmoke, atlasUv: ATLAS_UV.smoke,
        color0: "#a3e635", color1: "#4d7c0f", color2: "#1a2e05",
        size: 0.4, sizeEnd: 1.0, life: 0.8, opacity: 0.14, rotRate: 0.3,
        lod: LodRank.Trail, duration: 0.55,
      }),
    );
  } else if (id === "lightning") {
    ids.push(
      spawn(world, {
        x, y: 0.3, z, dirY: 0.5, rate: 40, spread: 1.0, gravity: 0, drag: 0.1, noise: 1.4,
        batch: BatchId.AdditiveSpark, atlasUv: ATLAS_UV.glint,
        color0: "#ffffff", color1: p.c1, color2: p.c2,
        size: 0.12, sizeEnd: 0.02, life: 0.2, burst: 20, opacity: 0.95, rotRate: 0,
        lod: LodRank.Core, duration: 0.35,
      }),
    );
  } else if (id === "void") {
    ids.push(
      spawn(world, {
        x, y: 0.25, z, dirY: 0.3, rate: 28, spread: 0.7, gravity: -0.4, drag: 0.35, noise: 0.7,
        batch: BatchId.AdditiveSpark, atlasUv: ATLAS_UV.void,
        color0: "#fae8ff", color1: "#e879f9", color2: "#a21caf",
        size: 0.35, sizeEnd: 0.08, life: 0.5, burst: 14, opacity: 0.9, rotRate: 1.5,
        lod: LodRank.Core, duration: 0.5,
      }),
    );
  } else if (id === "wind") {
    ids.push(
      spawn(world, {
        x, y: 0.2, z, dirX: 1.4, dirY: 0.5, dirZ: 0.3, rate: 36, spread: 0.5, gravity: 0.02, drag: 0.06, noise: 0.55,
        batch: BatchId.AlphaIce, atlasUv: ATLAS_UV.wind,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: 0.55, sizeEnd: 0.15, life: 0.35, burst: 12, opacity: s.opacity, rotRate: 0,
        lod: LodRank.Core, duration: 0.4,
      }),
    );
  } else if (id === "heal") {
    ids.push(
      spawn(world, {
        x, y: 0.2, z, dirY: 1.0, rate: 24, spread: 0.7, gravity: 0.3, drag: 0.35, noise: 0.45,
        batch: BatchId.AdditiveSpark, atlasUv: ATLAS_UV.leaf,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: 0.32, sizeEnd: 0.08, life: 0.6, burst: 12, opacity: 0.85, rotRate: 2, rotJitter: 1,
        lod: LodRank.Core, duration: 0.55,
      }),
    );
  } else if (id === "holy") {
    ids.push(
      spawn(world, {
        x, y: 0.25, z, dirY: 1.4, rate: 28, spread: 0.6, gravity: -0.1, drag: 0.4, noise: 0.3,
        batch: BatchId.AdditiveSpark, atlasUv: ATLAS_UV.glint,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: 0.22, sizeEnd: 0.04, life: 0.45, burst: 14, opacity: 0.85, rotRate: 0.3,
        lod: LodRank.Core, duration: 0.45,
      }),
    );
  } else if (id === "blood") {
    const claws = [
      { dx: 1.0, dy: 0.4, dz: 0.3 },
      { dx: 0.3, dy: 0.9, dz: 0.2 },
      { dx: -0.5, dy: 0.7, dz: -0.2 },
      { dx: -1.0, dy: 0.35, dz: 0.15 },
    ];
    for (const claw of claws) {
      ids.push(
        spawn(world, {
          x, y: 0.2, z, dirX: claw.dx, dirY: claw.dy, dirZ: claw.dz,
          rate: 8, spread: 0.12, gravity: 1.8, drag: 0.12, noise: 0.3,
          batch: BatchId.AdditiveSpark, atlasUv: ATLAS_UV.spark,
          color0: "#fecaca", color1: p.c1, color2: p.c2,
          size: 0.16, sizeEnd: 0.03, life: 0.28, burst: 5, opacity: 0.9, rotRate: 0.8,
          lod: LodRank.Core, duration: 0.4,
        }),
      );
    }
  } else {
    ids.push(
      spawn(world, {
        x, y: 0.3, z, dirY: 1.15, rate: s.rate * 1.2, spread: 0.7, gravity: 1.6, drag: 0.15, noise: 0.3,
        batch: p.batch, atlasUv: p.uv,
        color0: p.c0, color1: p.c1, color2: p.c2,
        size: s.size * 0.8, sizeEnd: s.sizeEnd * 0.3, life: 0.4, burst: 14, opacity: s.opacity, rotRate: 1.5,
        lod: LodRank.Core, duration: 0.4,
      }),
    );
  }

  return ids.filter((n) => n >= 0);
}

/**
 * Beam accents — hand sparkle, thin channel stream, sparse element corona
 * shedding around the tube so the beam feels alive (low count).
 */
function spawnBeam(world: ParticleWorld, id: ElementId, x: number, y: number, z: number): number[] {
  const s = getElementSettings(id);
  const p = PALETTE[id];
  const handY = Math.max(y, 1.1);
  const spawnZ = 0.55;
  const beamLen = 6.5;
  const ids: number[] = [];

  // Hand emitter motes
  ids.push(
    spawn(world, {
      x,
      y: handY,
      z: z + spawnZ,
      dirY: 0.45,
      dirX: 0.1,
      dirZ: 0.15,
      rate: Math.max(8, s.rate * 0.28),
      spread: 0.12,
      gravity: 0.05,
      drag: 0.4,
      noise: 0.3,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.glint,
      color0: p.c0,
      color1: p.c1,
      color2: p.c2,
      size: 0.1,
      sizeEnd: 0.025,
      life: 0.35,
      opacity: Math.min(0.85, s.opacity),
      rotRate: 0,
      rotJitter: 0.35,
      lod: LodRank.Core,
      burst: 4,
    }),
  );

  // Thin stream along the channel
  ids.push(
    spawn(world, {
      x,
      y: handY,
      z: z + spawnZ + 0.35,
      dirY: 0.06,
      dirX: 0.02,
      dirZ: 1.5,
      rate: Math.max(10, s.rate * 0.4),
      spread: 0.045,
      gravity: 0,
      drag: 0.06,
      noise: 0.1,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.glint,
      color0: p.c0,
      color1: p.c1,
      color2: p.c2,
      size: 0.08,
      sizeEnd: 0.02,
      life: 0.55,
      opacity: Math.min(0.75, s.opacity),
      rotRate: 0,
      rotJitter: 0.2,
      lod: LodRank.Trail,
      burst: 3,
      duration: 10,
    }),
  );

  // Element corona — a few nodes along the beam shedding outward
  const coronaN = 3;
  for (let i = 0; i < coronaN; i++) {
    const t = (i + 0.55) / coronaN;
    const along = spawnZ + t * beamLen;
    ids.push(
      spawn(world, {
        x,
        y: handY,
        z: z + along,
        dirY: 0.15,
        dirX: 0,
        dirZ: 0.05,
        rate: Math.max(3, s.rate * 0.12),
        spread: 0.28,
        gravity: id === "blood" ? 1.2 : id === "frost" ? 0.15 : 0.05,
        drag: 0.35,
        noise: 0.55,
        batch: p.batch,
        atlasUv: p.uv ?? ATLAS_UV.glint,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: id === "fire" || id === "heal" ? 0.14 : 0.09,
        sizeEnd: 0.02,
        life: 0.5,
        opacity: Math.min(0.55, s.opacity * 0.55),
        rotRate: 0.6,
        rotJitter: 0.5,
        lod: LodRank.Trail,
        burst: 1,
        duration: 10,
      }),
    );
  }

  // Soft trailing mist for a couple of elements (very sparse)
  if (id === "frost" || id === "poison" || id === "void" || id === "wind") {
    ids.push(
      spawn(world, {
        x,
        y: handY,
        z: z + spawnZ + beamLen * 0.35,
        dirY: 0.2,
        dirZ: 0.4,
        rate: 4,
        spread: 0.35,
        gravity: -0.05,
        drag: 0.5,
        noise: 0.4,
        batch: BatchId.AlphaSmoke,
        atlasUv: id === "void" ? ATLAS_UV.void : ATLAS_UV.smoke,
        color0: p.c1,
        color1: p.c2,
        color2: "#0a0a0a",
        size: 0.2,
        sizeEnd: 0.45,
        life: 0.7,
        opacity: 0.08,
        rotRate: 0.2,
        lod: LodRank.Trail,
        burst: 0,
        duration: 10,
      }),
    );
  }

  return ids.filter((n) => n >= 0);
}

/** Ground accents — heal gets circling leaf particles; others stay sparse. */
function spawnGround(world: ParticleWorld, id: ElementId, x: number, _y: number, z: number): number[] {
  const s = getElementSettings(id);
  const p = PALETTE[id];
  if (id === "holy" || id === "void") return [];

  if (id === "heal") {
    // Leaves blown in a circle — ring of tangential emitters (wind swirl)
    const ids: number[] = [];
    const n = 10;
    const r = 0.95;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      // Tangential + slight inward so they orbit near the floor
      const tx = -Math.sin(a) * 2.1 - Math.cos(a) * 0.35;
      const tz = Math.cos(a) * 2.1 - Math.sin(a) * 0.35;
      ids.push(
        spawn(world, {
          x: px,
          y: 0.14,
          z: pz,
          dirX: tx,
          dirY: 0.35,
          dirZ: tz,
          rate: 8,
          spread: 0.28,
          gravity: 0.22,
          drag: 0.38,
          noise: 0.4,
          batch: BatchId.AdditiveSpark,
          atlasUv: ATLAS_UV.leaf,
          color0: p.c0,
          color1: p.c1,
          color2: p.c2,
          size: 0.32,
          sizeEnd: 0.1,
          life: 1.35,
          opacity: 0.8,
          rotRate: 2.4,
          rotJitter: 1,
          lod: LodRank.Core,
          burst: 2,
          duration: 12,
          collide: Collide.None,
        }),
      );
    }
    // Soft center loft of leaves
    ids.push(
      spawn(world, {
        x,
        y: 0.12,
        z,
        dirY: 0.65,
        rate: 10,
        spread: 0.75,
        gravity: 0.28,
        drag: 0.42,
        noise: 0.45,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.leaf,
        color0: "#fef9c3",
        color1: p.c1,
        color2: p.c2,
        size: 0.26,
        sizeEnd: 0.08,
        life: 1.1,
        opacity: 0.7,
        rotRate: 1.8,
        rotJitter: 1,
        lod: LodRank.Trail,
        burst: 3,
        duration: 12,
        collide: Collide.None,
      }),
    );
    return ids.filter((n) => n >= 0);
  }

  if (id === "frost") {
    // Sandbox ground ice accents: soft glitter plume + cold mist (no tumbling ice sprites)
    return [
      spawn(world, {
        x,
        y: 0.35,
        z,
        dirY: 0.55,
        rate: 18,
        spread: 0.85,
        gravity: -0.15,
        drag: 1.0,
        noise: 0.55,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: "#ffffff",
        color1: "#e0f2fe",
        color2: "#79b6dd",
        size: 0.08,
        sizeEnd: 0.015,
        life: 1.4,
        opacity: 0.7,
        rotRate: 0,
        lod: LodRank.Core,
        burst: 4,
        duration: 12,
        collide: Collide.None,
      }),
      spawn(world, {
        x,
        y: 0.12,
        z,
        dirY: 0.25,
        rate: 10,
        spread: 0.9,
        gravity: -0.2,
        drag: 1.4,
        noise: 0.35,
        batch: BatchId.AlphaSmoke,
        color0: "#dbeafe",
        color1: "#93c5fd",
        color2: "#64748b",
        size: 0.55,
        sizeEnd: 1.1,
        life: 2.2,
        opacity: 0.08,
        rotRate: 0.15,
        lod: LodRank.Trail,
        burst: 2,
        duration: 12,
        collide: Collide.None,
      }),
    ].filter((n) => n >= 0);
  }

  return [
    spawn(world, {
      x,
      y: 0.06,
      z,
      dirY: id === "blood" ? -0.05 : 0.12,
      rate: Math.max(2, s.rate * 0.12),
      spread: 1.2,
      gravity: id === "blood" ? 1.5 : 0.55,
      drag: 0.85,
      noise: 0.2,
      batch: BatchId.AdditiveSpark,
      atlasUv: p.uv ?? ATLAS_UV.glint,
      color0: p.c0,
      color1: p.c1,
      color2: p.c2,
      size: 0.12,
      sizeEnd: 0.03,
      life: 0.55,
      opacity: Math.min(0.5, s.opacity * 0.6),
      rotRate: 0.4,
      lod: LodRank.Trail,
      burst: 2,
      collide: Collide.None,
    }),
  ].filter((n) => n >= 0);
}

/** Shield — orbiting rim sparks + soft vertical wash (alive edge, hollow center). */
function spawnShield(world: ParticleWorld, id: ElementId, x: number, y: number, z: number): number[] {
  const s = getElementSettings(id);
  const p = PALETTE[id];
  const ids: number[] = [];
  const n = 6;
  const rx = 0.75;
  const ry = 0.88;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const px = x + Math.cos(a) * rx;
    const py = y + Math.sin(a) * ry;
    // Tangential around the oval rim
    const tx = -Math.sin(a) * 1.6;
    const ty = Math.cos(a) * 1.4;
    ids.push(
      spawn(world, {
        x: px,
        y: py,
        z,
        dirX: tx,
        dirY: ty,
        dirZ: 0.15,
        rate: Math.max(4, s.rate * 0.28),
        spread: 0.2,
        gravity: 0,
        drag: 0.35,
        noise: 0.45,
        batch: BatchId.AdditiveSpark,
        atlasUv: ATLAS_UV.glint,
        color0: p.c0,
        color1: p.c1,
        color2: p.c2,
        size: 0.12,
        sizeEnd: 0.02,
        life: 0.55,
        opacity: Math.min(0.75, s.opacity),
        rotRate: 0,
        lod: LodRank.Core,
        burst: 2,
        duration: 12,
        collide: Collide.None,
      }),
    );
  }
  // Soft rising motes inside the volume
  ids.push(
    spawn(world, {
      x,
      y: y - 0.2,
      z,
      dirY: 0.55,
      rate: s.rate * 0.2,
      spread: 0.55,
      gravity: -0.08,
      drag: 0.55,
      noise: 0.5,
      batch: BatchId.AdditiveSpark,
      atlasUv: ATLAS_UV.glint,
      color0: p.c0,
      color1: p.c1,
      color2: p.c2,
      size: 0.1,
      sizeEnd: 0.02,
      life: 0.7,
      opacity: Math.min(0.45, s.opacity * 0.7),
      rotRate: 0,
      lod: LodRank.Trail,
      burst: 3,
      duration: 12,
      collide: Collide.None,
    }),
  );
  return ids.filter((n) => n >= 0);
}

/**
 * Spawn element × shape at a world point. Clears prior emitters first when
 * `clear` is true (default). Mesh/decal shapes are drawn by LabShapePreview;
 * this only spawns particle accents.
 */
export function spawnShapeShowcase(
  world: ParticleWorld,
  element: ElementId,
  shape: ShapeId,
  x: number,
  y: number,
  z: number,
  clear = true,
): number[] {
  if (clear) {
    world.killAll();
    killAllLightningClusters();
  }
  if (shape === "telegraph") return [];
  if (shape === "emitter") return spawnElementShowcase(world, element, x, y, z);
  if (shape === "caster") return spawnCaster(world, element, x, y, z);
  if (shape === "impact") return spawnImpact(world, element, x, y, z);
  if (shape === "beam") return spawnBeam(world, element, x, y, z);
  if (shape === "ground") return spawnGround(world, element, x, y, z);
  if (shape === "shield") return spawnShield(world, element, x, y, z);
  return [];
}

const GALLERY_SPACING = 2.8;

/** All elements for one shape — mesh row via LabShapePreview + particle accents. */
export function spawnShapeGallery(
  world: ParticleWorld,
  shape: ShapeId,
  origin: { x: number; y: number; z: number },
  elements: readonly ElementId[],
): number[] {
  world.killAll();
  killAllLightningClusters();
  if (shape === "telegraph") return [];
  const n = elements.length;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const el = elements[i]!;
    const x = origin.x + (i - (n - 1) / 2) * GALLERY_SPACING;
    ids.push(...spawnShapeShowcase(world, el, shape, x, origin.y, origin.z, false));
  }
  return ids;
}
