import { GROUND_TEXELS_PER_M, MAX_GROUND_RES, groundResFor, type MapGround } from "./mapDoc";

/**
 * Painted ground past the single-splat cap is a grid of tiles.
 *
 * One sidecar stays under 512 texels, which is about 160 m at the editor's
 * paint density. A larger zone keeps that density by splitting into tiles of
 * about 128 m. The document still describes one ground; `tilesX` / `tilesZ`
 * say how the sidecars are cut. Maps that omit them are one buffer, including
 * older maps whose paint is softer than 3.2 texels per metre.
 */

/** Target tile edge. The real edge is the zone divided evenly by the count. */
export const GROUND_TILE_M = 128;

/** Largest extent the builder will resize to. Eight tiles on a side. */
export const MAX_ZONE_M = 1024;

/** Tiles drawn around the player. A 3×3 neighbourhood. */
export const ZONE_SHOW_RADIUS = 1;

/**
 * Tiles prepared beyond the drawn neighbourhood.
 *
 * Chebyshev radius 2 is a 5×5. The outer ring is uploaded while it is still
 * outside the fog, so crossing into it does not compile shaders on arrival.
 */
export const ZONE_WARM_RADIUS = 2;

const MAX_TILES = 16;

export type GroundTileLayout = {
  sizeX: number;
  sizeZ: number;
  tilesX: number;
  tilesZ: number;
  tileSizeX: number;
  tileSizeZ: number;
  resX: number;
  resZ: number;
  tiled: boolean;
};

export type TileCoord = { tx: number; tz: number };

export type TileRect = TileCoord & {
  sizeX: number;
  sizeZ: number;
  originX: number;
  originZ: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

type TileFields = {
  sizeX: number;
  sizeZ: number;
  resX: number;
  resZ: number;
  tilesX?: number;
  tilesZ?: number;
};

/** Layout stored on a painted ground. Does not retile; resize does that. */
export function layoutFromGround(ground: TileFields): GroundTileLayout {
  const tilesX = clampTiles(ground.tilesX ?? 1);
  const tilesZ = clampTiles(ground.tilesZ ?? 1);
  return {
    sizeX: ground.sizeX,
    sizeZ: ground.sizeZ,
    tilesX,
    tilesZ,
    tileSizeX: ground.sizeX / tilesX,
    tileSizeZ: ground.sizeZ / tilesZ,
    resX: ground.resX,
    resZ: ground.resZ,
    tiled: tilesX > 1 || tilesZ > 1,
  };
}

/**
 * Layout for a resize.
 *
 * Extents that still fit in one 512² splat stay one buffer, so existing maps
 * are unchanged until someone grows them past that. Past it, the zone is cut
 * into even tiles and each tile gets a full-density grid of its own.
 */
export function groundTileLayout(sizeX: number, sizeZ: number): GroundTileLayout {
  const sx = Math.max(1, sizeX);
  const sz = Math.max(1, sizeZ);
  const singleMax = MAX_GROUND_RES / GROUND_TEXELS_PER_M;
  if (sx <= singleMax && sz <= singleMax) {
    const res = groundResFor(sx, sz);
    return {
      sizeX: sx,
      sizeZ: sz,
      tilesX: 1,
      tilesZ: 1,
      tileSizeX: sx,
      tileSizeZ: sz,
      resX: res.resX,
      resZ: res.resZ,
      tiled: false,
    };
  }
  const tilesX = clampTiles(Math.ceil(sx / GROUND_TILE_M));
  const tilesZ = clampTiles(Math.ceil(sz / GROUND_TILE_M));
  const tileSizeX = sx / tilesX;
  const tileSizeZ = sz / tilesZ;
  const res = groundResFor(tileSizeX, tileSizeZ);
  return {
    sizeX: sx,
    sizeZ: sz,
    tilesX,
    tilesZ,
    tileSizeX,
    tileSizeZ,
    resX: res.resX,
    resZ: res.resZ,
    tiled: true,
  };
}

export function isTiledGround(ground: MapGround): ground is Extract<MapGround, { kind: "painted" }> {
  return ground.kind === "painted" && layoutFromGround(ground).tiled;
}

export function tileIndexAt(size: number, tiles: number, value: number): number {
  if (tiles <= 1) return 0;
  const i = Math.floor(((value + size / 2) / size) * tiles);
  return Math.min(tiles - 1, Math.max(0, i));
}

export function tileRect(layout: GroundTileLayout, tx: number, tz: number): TileRect {
  const minX = -layout.sizeX / 2 + tx * layout.tileSizeX;
  const minZ = -layout.sizeZ / 2 + tz * layout.tileSizeZ;
  return {
    tx,
    tz,
    sizeX: layout.tileSizeX,
    sizeZ: layout.tileSizeZ,
    originX: minX + layout.tileSizeX / 2,
    originZ: minZ + layout.tileSizeZ / 2,
    minX,
    minZ,
    maxX: minX + layout.tileSizeX,
    maxZ: minZ + layout.tileSizeZ,
  };
}

export function tileKey(tx: number, tz: number): string {
  return `${tx}:${tz}`;
}

export function tilesWithin(layout: GroundTileLayout, tx: number, tz: number, radius: number): TileCoord[] {
  const out: TileCoord[] = [];
  for (let z = Math.max(0, tz - radius); z <= Math.min(layout.tilesZ - 1, tz + radius); z++) {
    for (let x = Math.max(0, tx - radius); x <= Math.min(layout.tilesX - 1, tx + radius); x++) {
      out.push({ tx: x, tz: z });
    }
  }
  return out;
}

export function forEachTile(layout: GroundTileLayout, fn: (coord: TileCoord) => void): void {
  for (let tz = 0; tz < layout.tilesZ; tz++) {
    for (let tx = 0; tx < layout.tilesX; tx++) fn({ tx, tz });
  }
}

/** Sidecar URL for one tile. The single-buffer maps keep their old filenames. */
export function tileSplatUrl(mapId: string, tx: number, tz: number): string {
  return `assets/maps/${mapId}.t${tx}_${tz}.splat.png`;
}

export function tileHeightUrl(mapId: string, tx: number, tz: number): string {
  return `assets/maps/${mapId}.t${tx}_${tz}.height.png`;
}

export function placementTileKey(
  ground: { sizeX: number; sizeZ: number; tilesX?: number; tilesZ?: number },
  x: number,
  z: number,
): string {
  const tilesX = clampTiles(ground.tilesX ?? 1);
  const tilesZ = clampTiles(ground.tilesZ ?? 1);
  return tileKey(tileIndexAt(ground.sizeX, tilesX, x), tileIndexAt(ground.sizeZ, tilesZ, z));
}

function clampTiles(n: number): number {
  return Math.max(1, Math.min(MAX_TILES, Math.round(n) || 1));
}
