import { MAX_GROUND_LAYERS, type MapDoc } from "@battlebeasts/shared";
import * as THREE from "three";

/**
 * Live splat and height buffers for the map being edited.
 *
 * Kept outside the document store on purpose. A 256x256 splat is a quarter of
 * a megabyte, and the store snapshots itself on every edit for undo -- copying
 * terrain into each snapshot would make undo cost grow with brush usage. The
 * document instead references sidecars by URL, and this module owns the pixels
 * between load and save.
 *
 * Undo for brush strokes is handled here too, as a bounded stack of the tiles
 * a stroke touched rather than whole-buffer copies.
 */

/** Splat and height share the document's grid, which is per-axis. */
function dims(doc: MapDoc): { sizeX: number; sizeZ: number; resX: number; resZ: number } {
  const g = doc.ground;
  if (g.kind !== "painted") return { sizeX: 80, sizeZ: 80, resX: 256, resZ: 256 };
  return {
    sizeX: g.sizeX,
    sizeZ: g.sizeZ,
    resX: Math.max(2, Math.floor(g.resX)),
    resZ: Math.max(2, Math.floor(g.resZ)),
  };
}

export type BrushMode = "paint" | "raise" | "lower" | "smooth" | "flatten";

export type BrushSettings = {
  mode: BrushMode;
  /** Layer index the paint mode writes, 0..3. */
  layer: number;
  /** Brush radius in world metres. */
  radius: number;
  /** 0..1 per-application weight. */
  strength: number;
  /** 0..1, where 1 is a hard edge. */
  hardness: number;
};

export const DEFAULT_BRUSH: BrushSettings = {
  mode: "paint",
  layer: 1,
  radius: 4,
  strength: 0.5,
  hardness: 0.4,
};

type Snapshot = { splat: Uint8Array; heights: Float32Array };

class TerrainStore {
  /** RGBA weights, one texel per grid vertex. */
  splat: Uint8Array = new Uint8Array(0);
  /** 0..1 with 0.5 neutral, so a brush can dig as well as raise. */
  heights: Float32Array = new Float32Array(0);
  resX = 0;
  resZ = 0;
  sizeX = 0;
  sizeZ = 0;

  texture: THREE.DataTexture | null = null;
  /** Bumped whenever heights change, so geometry rebuilds can be memoised. */
  heightVersion = 0;
  dirty = false;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private strokeBase: Snapshot | null = null;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private frame = 0;

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
    for (const fn of this.listeners) fn();
  }

  /**
   * Point the store at a document, reusing nothing from the previous map.
   *
   * `splatPng` / `heightPng` are decoded images when the map had saved
   * sidecars; absent, the terrain starts as pure layer 0 and dead flat.
   */
  load(doc: MapDoc, splatPng: ImageData | null, heightPng: ImageData | null) {
    const { sizeX, sizeZ, resX, resZ } = dims(doc);
    const texels = resX * resZ;

    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.resX = resX;
    this.resZ = resZ;
    this.splat = new Uint8Array(texels * 4);
    this.heights = new Float32Array(texels);
    this.undoStack = [];
    this.redoStack = [];
    this.strokeBase = null;
    this.dirty = false;

    if (splatPng && splatPng.width === resX && splatPng.height === resZ) {
      this.splat.set(splatPng.data);
    } else {
      // Unpainted ground is entirely the base layer.
      for (let i = 0; i < texels; i++) this.splat[i * 4] = 255;
    }
    // Alpha is never a layer weight -- see the shader's note on canvas
    // premultiplication. Forced opaque so a round trip cannot alter RGB.
    for (let i = 0; i < texels; i++) this.splat[i * 4 + 3] = 255;

    if (heightPng && heightPng.width === resX && heightPng.height === resZ) {
      for (let i = 0; i < texels; i++) this.heights[i] = (heightPng.data[i * 4] ?? 128) / 255;
    } else {
      this.heights.fill(0.5);
    }

    this.texture?.dispose();
    const tex = new THREE.DataTexture(this.splat, resX, resZ, THREE.RGBAFormat);
    // Row 0 is world -Z; must match PNG sidecars and runtime TextureLoader (flipY false).
    tex.flipY = false;
    // Bilinear so brush strokes blend smoothly instead of showing the grid.
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.texture = tex;

    this.heightVersion++;
    this.emitNow();
  }

  /**
   * Re-grid onto a new extent, carrying the existing paint with the content.
   *
   * `shift` is how far everything on the map moves in world space, which is
   * what lets a resize appear to grow from one edge: the document always keeps
   * the ground centred on the origin, so "grow eastward" is really "grow both
   * ways and move the contents west".
   *
   * Samples nearest-neighbour. The alternative is blurring the whole splat on
   * every resize, and a resize is usually followed by painting the new area
   * anyway.
   */
  resize(
    next: { sizeX: number; sizeZ: number; resX: number; resZ: number },
    shift: { x: number; z: number },
  ) {
    if (!this.resX || !this.resZ) return;

    const texels = next.resX * next.resZ;
    const splat = new Uint8Array(texels * 4);
    const heights = new Float32Array(texels);

    for (let j = 0; j < next.resZ; j++) {
      for (let i = 0; i < next.resX; i++) {
        const n = j * next.resX + i;

        // Centre of this new texel, in world space, mapped back to where its
        // contents used to sit before the shift.
        const wx = -next.sizeX / 2 + ((i + 0.5) / next.resX) * next.sizeX - shift.x;
        const wz = -next.sizeZ / 2 + ((j + 0.5) / next.resZ) * next.sizeZ - shift.z;

        const oldI = Math.floor(((wx + this.sizeX / 2) / this.sizeX) * this.resX);
        const oldJ = Math.floor(((wz + this.sizeZ / 2) / this.sizeZ) * this.resZ);

        if (oldI < 0 || oldI >= this.resX || oldJ < 0 || oldJ >= this.resZ) {
          // Newly exposed ground: base layer, flat.
          splat[n * 4] = 255;
          splat[n * 4 + 3] = 255;
          heights[n] = 0.5;
          continue;
        }

        const src = (oldJ * this.resX + oldI) * 4;
        splat[n * 4] = this.splat[src]!;
        splat[n * 4 + 1] = this.splat[src + 1]!;
        splat[n * 4 + 2] = this.splat[src + 2]!;
        splat[n * 4 + 3] = 255;
        heights[n] = this.heights[oldJ * this.resX + oldI]!;
      }
    }

    this.splat = splat;
    this.heights = heights;
    this.sizeX = next.sizeX;
    this.sizeZ = next.sizeZ;
    this.resX = next.resX;
    this.resZ = next.resZ;

    // Buffers were replaced, so the old texture points at freed memory.
    this.texture?.dispose();
    const tex = new THREE.DataTexture(this.splat, next.resX, next.resZ, THREE.RGBAFormat);
    tex.flipY = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.texture = tex;

    // A resize is not a brush stroke; folding it into stroke undo would make
    // one Ctrl+Z revert both the extent and whatever was painted before it.
    this.undoStack = [];
    this.redoStack = [];
    this.strokeBase = null;

    this.heightVersion++;
    this.dirty = true;
    this.emit();
  }

  /** Grid index for a world XZ position, or -1 outside the ground. */
  private indexAt(x: number, z: number): number {
    const u = (x + this.sizeX / 2) / this.sizeX;
    const v = (z + this.sizeZ / 2) / this.sizeZ;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const i = Math.min(this.resX - 1, Math.floor(u * this.resX));
    const j = Math.min(this.resZ - 1, Math.floor(v * this.resZ));
    return j * this.resX + i;
  }

  /** Call once when a drag begins, so the whole stroke is one undo step. */
  beginStroke() {
    this.strokeBase = {
      splat: this.splat.slice(),
      heights: this.heights.slice(),
    };
  }

  /** Call when a drag ends; pushes the stroke onto the undo stack. */
  endStroke() {
    if (!this.strokeBase) return;
    this.undoStack.push(this.strokeBase);
    // Bounded: terrain snapshots are large and deep history is rarely wanted.
    if (this.undoStack.length > 24) this.undoStack.shift();
    this.redoStack = [];
    this.strokeBase = null;
    this.emitNow();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push({ splat: this.splat.slice(), heights: this.heights.slice() });
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push({ splat: this.splat.slice(), heights: this.heights.slice() });
    this.restore(next);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  private restore(s: Snapshot) {
    this.splat.set(s.splat);
    this.heights.set(s.heights);
    if (this.texture) this.texture.needsUpdate = true;
    this.heightVersion++;
    this.dirty = true;
    this.emitNow();
  }

  /**
   * Apply one brush dab centred on a world position.
   *
   * Called per pointer-move during a drag, so it walks only the texels inside
   * the brush rather than the whole grid.
   */
  stamp(x: number, z: number, brush: BrushSettings) {
    if (!this.resX || !this.resZ) return;
    // Texels are square by construction, but the two axes are tracked
    // separately so an off-by-one density never skews the brush into an oval.
    const mPerTexelX = this.sizeX / this.resX;
    const mPerTexelZ = this.sizeZ / this.resZ;
    const radiusX = Math.max(1, brush.radius / mPerTexelX);
    const radiusZ = Math.max(1, brush.radius / mPerTexelZ);

    const ci = (x + this.sizeX / 2) / mPerTexelX;
    const cj = (z + this.sizeZ / 2) / mPerTexelZ;
    const i0 = Math.max(0, Math.floor(ci - radiusX));
    const i1 = Math.min(this.resX - 1, Math.ceil(ci + radiusX));
    const j0 = Math.max(0, Math.floor(cj - radiusZ));
    const j1 = Math.min(this.resZ - 1, Math.ceil(cj + radiusZ));
    if (i1 < i0 || j1 < j0) return;

    // Averaged once up front so smoothing pulls toward the pre-stroke shape
    // rather than chasing its own output across the dab.
    let mean = 0;
    if (brush.mode === "smooth" || brush.mode === "flatten") {
      let n = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          mean += this.heights[j * this.resX + i]!;
          n++;
        }
      }
      mean = n ? mean / n : 0.5;
    }
    const centre = this.heights[this.indexAt(x, z)] ?? 0.5;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // Normalised per axis so the falloff stays a circle in world space.
        const d = Math.hypot((i + 0.5 - ci) / radiusX, (j + 0.5 - cj) / radiusZ);
        if (d > 1) continue;
        // Smoothstep falloff, tightened by hardness.
        const t = 1 - d;
        const falloff = t * t * (3 - 2 * t);
        const w = brush.strength * Math.pow(falloff, 1 + (1 - brush.hardness) * 3);
        if (w <= 0) continue;

        const n = j * this.resX + i;
        if (brush.mode === "paint") {
          this.paintTexel(n, brush.layer, w);
        } else {
          this.heightTexel(n, brush.mode, w, mean, centre);
        }
      }
    }

    if (brush.mode === "paint") {
      if (this.texture) this.texture.needsUpdate = true;
    } else {
      this.heightVersion++;
    }
    this.dirty = true;
    this.emit();
  }

  /**
   * Push one layer's weight up and pull the others down to compensate.
   *
   * Only layers 0-2 have a stored channel; layer 3 is the remainder, so
   * painting it means fading the other three toward zero. That falls out of
   * the same loop rather than needing a special case.
   */
  private paintTexel(n: number, layer: number, w: number) {
    const base = n * 4;
    const target = Math.min(MAX_GROUND_LAYERS - 1, Math.max(0, layer));
    for (let c = 0; c < MAX_GROUND_LAYERS - 1; c++) {
      const cur = this.splat[base + c]!;
      const want = c === target ? 255 : 0;
      this.splat[base + c] = Math.round(cur + (want - cur) * w);
    }
    this.splat[base + 3] = 255;
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
  private heightTexel(n: number, mode: BrushMode, w: number, mean: number, centre: number) {
    const EASE_BAND = 0.15;
    const cur = this.heights[n]!;
    let next = cur;
    // Scaled so a full-strength dab moves a sensible fraction of the range
    // rather than slamming to the clamp on first contact.
    const step = w * 0.05;
    if (mode === "raise") next = cur + step * Math.min(1, (1 - cur) / EASE_BAND);
    else if (mode === "lower") next = cur - step * Math.min(1, cur / EASE_BAND);
    // Smooth and flatten pull toward samples that are already inside the
    // range, so they cannot overshoot it and need no easing.
    else if (mode === "smooth") next = cur + (mean - cur) * w;
    else if (mode === "flatten") next = cur + (centre - cur) * w;
    this.heights[n] = Math.min(1, Math.max(0, next));
  }

  /** Terrain matches the last save; sidecar PNGs on disk are still authoritative. */
  markClean() {
    this.dirty = false;
  }

  /** Base64 payloads for the save endpoint, or null when there is nothing to write. */
  sidecars(): { splat: SidecarPayload; height: SidecarPayload } | null {
    if (!this.resX || !this.resZ) return null;
    const gray = new Uint8Array(this.resX * this.resZ);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(this.heights[i]! * 255);
    return {
      splat: { width: this.resX, height: this.resZ, data: toBase64(this.splat) },
      height: { width: this.resX, height: this.resZ, data: toBase64(gray) },
    };
  }
}

export type SidecarPayload = { width: number; height: number; data: string };

function toBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked: spreading a quarter-million bytes into one call overflows the
  // argument limit.
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
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch {
    return null;
  }
}
