import {
  convertWeightSplatToIndex,
  forEachTile,
  groundBySlot,
  groundMaterial,
  groundSlot,
  layoutFromGround,
  paintedBaseId,
  sampleGridHeight,
  tileKey,
  tileRect,
  type GroundTileLayout,
  type MapDoc,
} from "@battlebeasts/shared";
import * as THREE from "three";

/**
 * Live splat and height buffers for the map being edited.
 *
 * Kept outside the document store on purpose. A splat is large, and the store
 * snapshots itself on every edit for undo -- copying terrain into each
 * snapshot would make undo cost grow with brush usage. The document instead
 * references sidecars by URL, and this module owns the pixels between load
 * and save.
 *
 * A zone that does not fit in one 512² splat is a grid of tiles. Each tile is
 * its own buffer. A brush that crosses an edge writes every tile it touches,
 * and undo stores only those tiles.
 *
 * A tile that is still the base material and flat has no buffer. The base is
 * one material on the document, so a large unpainted map does not allocate or
 * decode a splat per tile. The first brush dab on a tile creates its buffer.
 */

export type BrushMode = "paint" | "raise" | "lower" | "smooth" | "flatten";

export type BrushSettings = {
  mode: BrushMode;
  /** Material id the paint brush blends in. */
  material: string;
  /** Brush radius in world metres. */
  radius: number;
  /** 0..1 per-application weight. */
  strength: number;
  /** 0..1, where 1 is a hard edge. */
  hardness: number;
};

export const DEFAULT_BRUSH: BrushSettings = {
  mode: "paint",
  material: "dirt",
  radius: 4,
  strength: 0.5,
  hardness: 0.4,
};

export type TerrainTile = {
  tx: number;
  tz: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  sizeX: number;
  sizeZ: number;
  originX: number;
  originZ: number;
  resX: number;
  resZ: number;
  /**
   * False once a brush or a saved sidecar has put real pixels here.
   * A solid tile is the base material, perfectly flat, and stores nothing.
   */
  solid: boolean;
  /** Set when any height sample leaves neutral. Flat tiles render as one quad. */
  hasHeight: boolean;
  splat: Uint8Array | null;
  heights: Float32Array | null;
  texture: THREE.DataTexture | null;
  heightVersion: number;
};

export type SidecarPayload = { width: number; height: number; data: string };

export type TerrainSidecars =
  | { splat: SidecarPayload | null; height: SidecarPayload | null }
  | { tiles: { tx: number; tz: number; splat: SidecarPayload; height: SidecarPayload | null }[] };

type TileImage = { tx: number; tz: number; splat: ImageData | null; height: ImageData | null };

type TileSnap =
  | { key: string; solid: true }
  | { key: string; solid?: false; splat: Uint8Array; heights: Float32Array };

/** Heights within this of 0.5 are still flat. A sculpt step is much larger. */
const FLAT_EPS = 1 / 512;

class TerrainStore {
  tiles: TerrainTile[] = [];
  sizeX = 0;
  sizeZ = 0;
  /** Bumped on every mutation. Subscribe to this; do not copy the tile list. */
  revision = 0;
  dirty = false;
  /**
   * The open buffers are the index format, but the files on disk are still
   * four-weight splats. The next save has to write both together.
   */
  pendingUpgrade = false;
  /**
   * A loaded sidecar turned out to be nothing but the base material.
   * The next save drops that file so the following open does not decode it.
   */
  pendingSlim = false;
  /** Bumped in `load` so a sidecar fetch for the previous map cannot land here. */
  generation = 0;
  /** Material id unpainted ground shows. */
  baseId = "grass";
  /** Material ids the live shader should upload, in array order. */
  paletteIds: string[] = ["grass"];

  private layout: GroundTileLayout | null = null;
  private baseSlot = 0;
  /** Base slot the files were saved with. Ingest rewrites it if the user changed base mid-load. */
  private loadedBaseSlot = 0;
  private fillIndex = true;
  /** Layer ids for a legacy weight splat, used while converting on ingest. */
  private legacyLayers: string[] = ["grass"];
  /** Tiles the user has edited since load. An in-flight sidecar must not overwrite them. */
  private locked = new Set<string>();
  private undoStack: TileSnap[][] = [];
  private redoStack: TileSnap[][] = [];
  private strokeBase: TileSnap[] | null = null;
  private strokeKeys = new Set<string>();
  private listeners = new Set<() => void>();
  private frame = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get tiled(): boolean {
    return this.layout?.tiled ?? false;
  }

  get stroking(): boolean {
    return this.strokeBase !== null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  tileAt(tx: number, tz: number): TerrainTile | undefined {
    return this.tiles.find((tile) => tile.tx === tx && tile.tz === tz);
  }

  /** World height of the painted surface. Flat when the map has no height range. */
  surfaceY(x: number, z: number, heightScale: number): number {
    if (!(heightScale > 0)) return 0;
    const tile = this.tileAtWorld(x, z);
    if (!tile?.heights) return 0;
    const u = (x - tile.minX) / tile.sizeX;
    const v = (z - tile.minZ) / tile.sizeZ;
    const h = sampleGridHeight(tile.heights, tile.resX, tile.resZ, u, v);
    return (h - 0.5) * 2 * heightScale;
  }

  /**
   * Coalesce notifications to one per animation frame.
   *
   * A brush drag stamps on every pointermove, and a pointermove can fire
   * several times per frame on a high-polling mouse. Each notification used to
   * rebuild the whole ground geometry, so the sculpt brushes got slower the
   * faster you moved -- work was proportional to event count, not to time.
   */
  private emit() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.emitNow();
    });
  }

  /** Notify synchronously. For load and resize, where a frame of lag shows. */
  private emitNow() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  /**
   * Point the store at a document, reusing nothing from the previous map.
   *
   * `images` are decoded sidecars. A single-buffer map passes the one image
   * as tile 0,0. Absent images start as pure layer 0 and dead flat.
   */
  load(doc: MapDoc, images?: TileImage[] | null) {
    this.generation++;
    this.disposeTiles();
    const ground = doc.ground;
    const painted = ground.kind === "painted" ? ground : null;
    const layout =
      painted
        ? layoutFromGround(painted)
        : layoutFromGround({ sizeX: 80, sizeZ: 80, resX: 256, resZ: 256 });
    this.layout = layout;
    this.sizeX = layout.sizeX;
    this.sizeZ = layout.sizeZ;
    this.pendingUpgrade = !!painted && painted.paint !== "index";
    this.pendingSlim = false;
    this.fillIndex = !this.pendingUpgrade;
    this.legacyLayers = painted?.layers.length ? painted.layers : ["grass"];
    this.baseId = painted ? paintedBaseId(painted) : "grass";
    this.baseSlot = groundSlot(this.baseId);
    this.loadedBaseSlot = this.baseSlot;
    this.locked.clear();
    this.tiles = [];
    forEachTile(layout, ({ tx, tz }) => {
      this.tiles.push(this.blankTile(layout, tx, tz));
    });
    this.undoStack = [];
    this.redoStack = [];
    this.strokeBase = null;
    this.strokeKeys.clear();
    this.dirty = false;

    for (const image of images ?? []) this.ingest(image.tx, image.tz, image.splat, image.height);
    this.scanPalette();
    this.emitNow();
  }

  /**
   * Apply one decoded sidecar without resetting the other tiles.
   *
   * `generation` is the value of `this.generation` when the fetch started.
   * A newer `load` makes the result a no-op, and so does a tile the user has
   * already brushed.
   */
  ingestLoaded(
    generation: number,
    tx: number,
    tz: number,
    splat: ImageData | null,
    height: ImageData | null,
  ) {
    if (generation !== this.generation) return;
    if (this.locked.has(tileKey(tx, tz))) return;
    if (!splat && !height) return;
    this.ingest(tx, tz, splat, height);
    this.scanPalette();
    this.emit();
  }

  /**
   * Change the material unpainted ground shows.
   *
   * Solid tiles update immediately. Texels that still show the old base,
   * including the underneath side of a blend, are rewritten. Fully painted
   * texels are left alone.
   */
  setBase(id: string) {
    if (!groundMaterial(id) || id === this.baseId) return;
    const previous = this.baseSlot;
    this.baseId = id;
    this.baseSlot = groundSlot(id);
    for (const tile of this.tiles) {
      if (tile.solid || !tile.splat) continue;
      const splat = tile.splat;
      for (let i = 0; i < splat.length; i += 4) {
        if ((splat[i] ?? 0) === previous) splat[i] = this.baseSlot;
        if ((splat[i + 1] ?? 0) === previous) splat[i + 1] = this.baseSlot;
      }
      if (this.canCollapse(tile)) this.collapse(tile);
      else if (tile.texture) tile.texture.needsUpdate = true;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.strokeBase = null;
    this.strokeKeys.clear();
    this.dirty = true;
    this.scanPalette();
    this.emitNow();
  }

  /**
   * Re-grid onto a new extent, carrying the existing paint with the content.
   *
   * `shift` is how far everything on the map moves in world space, which is
   * what lets a resize appear to grow from one edge: the document always keeps
   * the ground centred on the origin, so "grow eastward" is really "grow both
   * ways and move the contents west".
   */
  resize(
    next: { sizeX: number; sizeZ: number; resX: number; resZ: number; tilesX: number; tilesZ: number },
    shift: { x: number; z: number },
  ) {
    if (!this.tiles.length) return;
    const layout = layoutFromGround(next);
    const old = this.tiles;
    const tiles: TerrainTile[] = [];
    forEachTile(layout, ({ tx, tz }) => {
      const tile = this.blankTile(layout, tx, tz);
      const rect = tileRect(layout, tx, tz);
      // New ground, and ground that only covered solid tiles, stays solid.
      // Resampling every texel of a large empty zone was the slow part of a resize.
      if (this.regionIsSolid(old, rect.minX - shift.x, rect.minZ - shift.z, rect.maxX - shift.x, rect.maxZ - shift.z)) {
        tiles.push(tile);
        return;
      }
      this.materialize(tile);
      for (let j = 0; j < tile.resZ; j++) {
        for (let i = 0; i < tile.resX; i++) {
          const wx = rect.minX + ((i + 0.5) / tile.resX) * rect.sizeX - shift.x;
          const wz = rect.minZ + ((j + 0.5) / tile.resZ) * rect.sizeZ - shift.z;
          const sample = sampleTiles(old, wx, wz, this.baseSlot);
          const n = j * tile.resX + i;
          tile.splat!.set(sample.splat, n * 4);
          tile.splat![n * 4 + 3] = 255;
          tile.heights![n] = sample.height;
          if (Math.abs(sample.height - 0.5) >= FLAT_EPS) tile.hasHeight = true;
        }
      }
      if (this.canCollapse(tile)) this.collapse(tile);
      else if (tile.texture) tile.texture.needsUpdate = true;
      tiles.push(tile);
    });

    for (const tile of old) tile.texture?.dispose();
    this.tiles = tiles;
    this.layout = layout;
    this.sizeX = layout.sizeX;
    this.sizeZ = layout.sizeZ;
    this.undoStack = [];
    this.redoStack = [];
    this.strokeBase = null;
    this.strokeKeys.clear();
    this.dirty = true;
    this.emit();
  }

  /** Call once when a drag begins, so the whole stroke is one undo step. */
  beginStroke() {
    this.strokeBase = [];
    this.strokeKeys.clear();
  }

  /** Call when a drag ends; pushes the stroke onto the undo stack. */
  endStroke() {
    if (!this.strokeBase) return;
    for (const key of this.strokeKeys) {
      const [tx, tz] = key.split(":").map(Number);
      const tile = this.tileAt(tx!, tz!);
      if (tile && this.canCollapse(tile)) this.collapse(tile);
    }
    if (this.strokeBase.length) {
      this.undoStack.push(this.strokeBase);
      if (this.undoStack.length > 24) this.undoStack.shift();
      this.redoStack = [];
    }
    this.strokeBase = null;
    this.strokeKeys.clear();
    this.scanPalette();
    this.emitNow();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.capture(prev));
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.capture(next));
    this.restore(next);
  }

  /**
   * Apply one brush dab centred on a world position.
   *
   * Called per pointer-move during a drag. Only texels inside the brush are
   * visited, and a dab that crosses a tile edge writes both tiles.
   */
  stamp(x: number, z: number, brush: BrushSettings) {
    if (!this.layout) return;
    const radius = Math.max(0.05, brush.radius);
    const hit = this.tiles.filter((tile) => circleHitsTile(tile, x, z, radius));
    if (!hit.length) return;
    for (const tile of hit) {
      this.locked.add(tileKey(tile.tx, tile.tz));
      this.remember(tile);
      this.materialize(tile);
    }

    let mean = 0.5;
    let centre = 0.5;
    if (brush.mode === "smooth" || brush.mode === "flatten") {
      let sum = 0;
      let n = 0;
      for (const tile of hit) {
        const heights = tile.heights;
        if (!heights) continue;
        this.forTexels(tile, x, z, radius, (index) => {
          sum += heights[index]!;
          n++;
        });
      }
      mean = n ? sum / n : 0.5;
    }
    const home = this.tileAtWorld(x, z);
    if (home?.heights) {
      const local = this.texelIndex(home, x, z);
      if (local >= 0) centre = home.heights[local] ?? 0.5;
    }

    const paintSlot = brush.mode === "paint" ? groundSlot(brush.material) : 0;
    if (brush.mode === "paint") this.ensureMaterial(brush.material);

    for (const tile of hit) {
      let painted = false;
      let sculpted = false;
      this.forTexels(tile, x, z, radius, (index, wx, wz) => {
        const d = Math.hypot((wx - x) / radius, (wz - z) / radius);
        if (d > 1) return;
        const t = 1 - d;
        const falloff = t * t * (3 - 2 * t);
        const w = brush.strength * Math.pow(falloff, 1 + (1 - brush.hardness) * 3);
        if (w <= 0) return;
        if (brush.mode === "paint") {
          this.paintTexel(tile, index, paintSlot, w);
          painted = true;
        } else {
          this.heightTexel(tile, index, brush.mode, w, mean, centre);
          sculpted = true;
        }
      });
      if (painted && tile.texture) tile.texture.needsUpdate = true;
      if (sculpted) tile.heightVersion++;
    }

    this.dirty = true;
    this.emit();
  }

  /** Terrain matches the last save; sidecar PNGs on disk are still authoritative. */
  markClean() {
    this.dirty = false;
    this.pendingUpgrade = false;
    this.pendingSlim = false;
  }

  /** Materials actually painted, for the document saved next to the splat. */
  materialIds(): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id: string | undefined) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    add(this.baseId);
    for (const tile of this.tiles) {
      const splat = tile.splat;
      if (!splat) continue;
      for (let i = 0; i < splat.length; i += 4) {
        add(groundBySlot(splat[i] ?? 0)?.id);
        if ((splat[i + 2] ?? 0) > 0) add(groundBySlot(splat[i + 1] ?? 0)?.id);
      }
    }
    return ids.length ? ids : ["grass"];
  }

  /** Make sure the live shader has this material before a stroke samples it. */
  ensureMaterial(id: string) {
    if (!id || this.paletteIds.includes(id)) return;
    this.paletteIds = [...this.paletteIds, id];
    this.emitNow();
  }

  /** Base64 payloads for the save endpoint, or null when there is nothing to write. */
  sidecars(): TerrainSidecars | null {
    if (!this.tiles.length || !this.layout) return null;
    if (!this.layout.tiled) {
      const tile = this.tiles[0]!;
      if (tile.solid || !tile.splat) return { splat: null, height: null };
      return { splat: encodeSplat(tile), height: tile.hasHeight ? encodeHeight(tile) : null };
    }
    return {
      tiles: this.tiles.flatMap((tile) => {
        if (tile.solid || !tile.splat) return [];
        return [{
          tx: tile.tx,
          tz: tile.tz,
          splat: encodeSplat(tile),
          height: tile.hasHeight ? encodeHeight(tile) : null,
        }];
      }),
    };
  }

  private blankTile(layout: GroundTileLayout, tx: number, tz: number): TerrainTile {
    const rect = tileRect(layout, tx, tz);
    return {
      tx,
      tz,
      minX: rect.minX,
      minZ: rect.minZ,
      maxX: rect.maxX,
      maxZ: rect.maxZ,
      sizeX: rect.sizeX,
      sizeZ: rect.sizeZ,
      originX: rect.originX,
      originZ: rect.originZ,
      resX: layout.resX,
      resZ: layout.resZ,
      solid: true,
      hasHeight: false,
      splat: null,
      heights: null,
      texture: null,
      heightVersion: 0,
    };
  }

  /** Allocate the splat and height buffers, filled with the base material. */
  private materialize(tile: TerrainTile) {
    if (!tile.solid && tile.splat && tile.heights && tile.texture) return;
    const texels = tile.resX * tile.resZ;
    const splat = new Uint8Array(texels * 4);
    const heights = new Float32Array(texels);
    for (let i = 0; i < texels; i++) {
      splat[i * 4] = this.baseSlot;
      splat[i * 4 + 1] = this.baseSlot;
      splat[i * 4 + 3] = 255;
      heights[i] = 0.5;
    }
    tile.splat = splat;
    tile.heights = heights;
    tile.texture = this.makeTexture(splat, tile.resX, tile.resZ);
    tile.solid = false;
    tile.hasHeight = false;
    // Fresh buffers are index texels. A legacy weight image overwrites these
    // and converts before anything asks whether the tile can collapse.
    this.fillIndex = true;
  }

  private makeTexture(splat: Uint8Array, resX: number, resZ: number): THREE.DataTexture {
    const texture = new THREE.DataTexture(splat, resX, resZ, THREE.RGBAFormat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /** Drop a tile back to the base material when nothing painted or sculpted remains. */
  private collapse(tile: TerrainTile) {
    tile.texture?.dispose();
    tile.splat = null;
    tile.heights = null;
    tile.texture = null;
    tile.solid = true;
    tile.hasHeight = false;
    tile.heightVersion++;
  }

  private canCollapse(tile: TerrainTile): boolean {
    if (!this.fillIndex || !tile.splat || !tile.heights) return false;
    const slot = this.baseSlot;
    const splat = tile.splat;
    for (let i = 0; i < splat.length; i += 4) {
      if ((splat[i] ?? 0) !== slot) return false;
      if ((splat[i + 2] ?? 0) > 0 && (splat[i + 1] ?? 0) !== slot) return false;
    }
    if (tile.hasHeight) {
      for (let i = 0; i < tile.heights.length; i++) {
        if (Math.abs(tile.heights[i]! - 0.5) >= FLAT_EPS) return false;
      }
    }
    return true;
  }

  private ingest(tx: number, tz: number, splatPng: ImageData | null, heightPng: ImageData | null) {
    const tile = this.tileAt(tx, tz);
    if (!tile) return;
    const splatOk = !!splatPng && splatPng.width === tile.resX && splatPng.height === tile.resZ;
    const heightOk = !!heightPng && heightPng.width === tile.resX && heightPng.height === tile.resZ;
    if (!splatOk && !heightOk) return;
    this.materialize(tile);
    if (splatOk && splatPng && tile.splat) {
      tile.splat.set(splatPng.data);
      for (let i = 0; i < tile.resX * tile.resZ; i++) tile.splat[i * 4 + 3] = 255;
    }
    if (heightOk && heightPng && tile.heights) {
      let varied = false;
      for (let i = 0; i < tile.heights.length; i++) {
        const h = (heightPng.data[i * 4] ?? 128) / 255;
        tile.heights[i] = h;
        if (Math.abs(h - 0.5) >= FLAT_EPS) varied = true;
      }
      tile.hasHeight = varied;
    }
    if (this.pendingUpgrade && splatOk && tile.splat) {
      convertWeightSplatToIndex(tile.splat, this.legacyLayers);
      this.fillIndex = true;
    }
    if (this.baseSlot !== this.loadedBaseSlot && tile.splat) {
      const splat = tile.splat;
      for (let i = 0; i < splat.length; i += 4) {
        if ((splat[i] ?? 0) === this.loadedBaseSlot) splat[i] = this.baseSlot;
        if ((splat[i + 1] ?? 0) === this.loadedBaseSlot) splat[i + 1] = this.baseSlot;
      }
    }
    if (this.canCollapse(tile)) {
      this.collapse(tile);
      this.pendingSlim = true;
      return;
    }
    if (tile.texture) tile.texture.needsUpdate = true;
    tile.heightVersion++;
  }

  private tileAtWorld(x: number, z: number): TerrainTile | undefined {
    return this.tiles.find((tile) => x >= tile.minX && x < tile.maxX && z >= tile.minZ && z < tile.maxZ);
  }

  private texelIndex(tile: TerrainTile, x: number, z: number): number {
    const i = Math.floor(((x - tile.minX) / tile.sizeX) * tile.resX);
    const j = Math.floor(((z - tile.minZ) / tile.sizeZ) * tile.resZ);
    if (i < 0 || j < 0 || i >= tile.resX || j >= tile.resZ) return -1;
    return j * tile.resX + i;
  }

  private forTexels(
    tile: TerrainTile,
    x: number,
    z: number,
    radius: number,
    fn: (index: number, wx: number, wz: number) => void,
  ) {
    const i0 = Math.max(0, Math.floor(((x - radius - tile.minX) / tile.sizeX) * tile.resX));
    const i1 = Math.min(tile.resX - 1, Math.ceil(((x + radius - tile.minX) / tile.sizeX) * tile.resX));
    const j0 = Math.max(0, Math.floor(((z - radius - tile.minZ) / tile.sizeZ) * tile.resZ));
    const j1 = Math.min(tile.resZ - 1, Math.ceil(((z + radius - tile.minZ) / tile.sizeZ) * tile.resZ));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = tile.minX + ((i + 0.5) / tile.resX) * tile.sizeX;
        const wz = tile.minZ + ((j + 0.5) / tile.resZ) * tile.sizeZ;
        fn(j * tile.resX + i, wx, wz);
      }
    }
  }

  private remember(tile: TerrainTile) {
    if (!this.strokeBase) return;
    const key = tileKey(tile.tx, tile.tz);
    if (this.strokeKeys.has(key)) return;
    this.strokeKeys.add(key);
    if (tile.solid || !tile.splat || !tile.heights) {
      this.strokeBase.push({ key, solid: true });
      return;
    }
    this.strokeBase.push({ key, splat: tile.splat.slice(), heights: tile.heights.slice() });
  }

  private capture(snaps: TileSnap[]): TileSnap[] {
    const out: TileSnap[] = [];
    for (const snap of snaps) {
      const [tx, tz] = snap.key.split(":").map(Number);
      const tile = this.tileAt(tx!, tz!);
      if (!tile) continue;
      if (tile.solid || !tile.splat || !tile.heights) {
        out.push({ key: snap.key, solid: true });
        continue;
      }
      out.push({ key: snap.key, splat: tile.splat.slice(), heights: tile.heights.slice() });
    }
    return out;
  }

  private restore(snaps: TileSnap[]) {
    for (const snap of snaps) {
      const [tx, tz] = snap.key.split(":").map(Number);
      const tile = this.tileAt(tx!, tz!);
      if (!tile) continue;
      if (snap.solid) {
        if (!tile.solid) this.collapse(tile);
        continue;
      }
      if (tile.solid || !tile.splat || !tile.heights || !tile.texture) this.materialize(tile);
      if (!tile.splat || !tile.heights || !tile.texture || snap.splat.length !== tile.splat.length) continue;
      tile.splat.set(snap.splat);
      tile.heights.set(snap.heights);
      tile.hasHeight = snap.heights.some((h) => Math.abs(h - 0.5) >= FLAT_EPS);
      tile.solid = false;
      tile.texture.needsUpdate = true;
      tile.heightVersion++;
    }
    this.dirty = true;
    this.scanPalette();
    this.emitNow();
  }

  /**
   * Blend `slot` into the texel.
   *
   * The texel keeps two materials: the one showing through, and the one the
   * brush is bringing in. A third material replaces whichever is less visible,
   * so a map can use the whole catalog while a pixel only ever samples two.
   */
  private paintTexel(tile: TerrainTile, n: number, slot: number, w: number) {
    const splat = tile.splat;
    if (!splat) return;
    const base = n * 4;
    let idA = splat[base] ?? 0;
    let idB = splat[base + 1] ?? idA;
    let weightB = (splat[base + 2] ?? 0) / 255;
    if (slot === idB) {
      weightB += (1 - weightB) * w;
    } else if (slot === idA) {
      weightB *= 1 - w;
    } else {
      const visible = weightB >= 0.5 ? idB : idA;
      idA = visible;
      idB = slot;
      weightB = w;
    }
    if (weightB >= 0.996) {
      idA = idB;
      weightB = 0;
    } else if (weightB <= 0.004) {
      idB = idA;
      weightB = 0;
    }
    splat[base] = idA;
    splat[base + 1] = idB;
    splat[base + 2] = Math.round(weightB * 255);
    splat[base + 3] = 255;
  }

  private scanPalette() {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of this.materialIds()) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    this.paletteIds = ids;
  }

  /**
   * Heights are 0..1, which the renderer maps to -heightScale..+heightScale.
   * The range is a hard ceiling by construction, but running into it head-on
   * flattens a hill into a mesa: every texel under the brush pins to exactly
   * 1.0 and the shape turns into a plateau with a hard rim.
   *
   * `EASE_BAND` keeps the brush at full speed through the middle of the range
   * and tapers it over the last stretch, so the surface approaches the limit
   * asymptotically and keeps its rounded top. The clamp stays as a backstop.
   */
  private heightTexel(tile: TerrainTile, n: number, mode: BrushMode, w: number, mean: number, centre: number) {
    const EASE_BAND = 0.15;
    const heights = tile.heights;
    if (!heights) return;
    const cur = heights[n]!;
    let next = cur;
    const step = w * 0.05;
    if (mode === "raise") next = cur + step * Math.min(1, (1 - cur) / EASE_BAND);
    else if (mode === "lower") next = cur - step * Math.min(1, cur / EASE_BAND);
    else if (mode === "smooth") next = cur + (mean - cur) * w;
    else if (mode === "flatten") next = cur + (centre - cur) * w;
    const clamped = Math.min(1, Math.max(0, next));
    heights[n] = clamped;
    if (Math.abs(clamped - 0.5) >= FLAT_EPS) tile.hasHeight = true;
  }

  private disposeTiles() {
    for (const tile of this.tiles) tile.texture?.dispose();
    this.tiles = [];
  }

  /** True when every old tile overlapping the rect is solid. Gaps count as new ground. */
  private regionIsSolid(tiles: TerrainTile[], minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    for (const tile of tiles) {
      if (maxX <= tile.minX || minX >= tile.maxX || maxZ <= tile.minZ || minZ >= tile.maxZ) continue;
      if (!tile.solid) return false;
    }
    return true;
  }
}

function circleHitsTile(tile: TerrainTile, x: number, z: number, radius: number): boolean {
  const nx = Math.min(tile.maxX, Math.max(tile.minX, x));
  const nz = Math.min(tile.maxZ, Math.max(tile.minZ, z));
  return Math.hypot(x - nx, z - nz) <= radius;
}

const solidSample = new Uint8Array(4);

function sampleTiles(
  tiles: TerrainTile[],
  x: number,
  z: number,
  baseSlot: number,
): { splat: Uint8Array; height: number } {
  const tile = tiles.find((item) => x >= item.minX && x < item.maxX && z >= item.minZ && z < item.maxZ);
  if (!tile || tile.solid || !tile.splat || !tile.heights) {
    solidSample[0] = baseSlot;
    solidSample[1] = baseSlot;
    solidSample[2] = 0;
    solidSample[3] = 255;
    return { splat: solidSample, height: 0.5 };
  }
  const i = Math.min(tile.resX - 1, Math.max(0, Math.floor(((x - tile.minX) / tile.sizeX) * tile.resX)));
  const j = Math.min(tile.resZ - 1, Math.max(0, Math.floor(((z - tile.minZ) / tile.sizeZ) * tile.resZ)));
  const n = j * tile.resX + i;
  return { splat: tile.splat.subarray(n * 4, n * 4 + 4), height: tile.heights[n] ?? 0.5 };
}

function encodeSplat(tile: TerrainTile): SidecarPayload {
  return { width: tile.resX, height: tile.resZ, data: toBase64(tile.splat!) };
}

function encodeHeight(tile: TerrainTile): SidecarPayload {
  const heights = tile.heights ?? new Float32Array();
  const gray = new Uint8Array(heights.length);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(heights[i]! * 255);
  return { width: tile.resX, height: tile.resZ, data: toBase64(gray) };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export const terrain = new TerrainStore();

/** Decode a sidecar PNG to raw samples, or null if it is missing. */
export async function loadSidecar(url: string): Promise<ImageData | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return image;
  } catch {
    return null;
  }
}
