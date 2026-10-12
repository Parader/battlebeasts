import {
  placementTileKey,
  tileIndexAt,
  tileKey,
  tilesWithin,
  ZONE_SHOW_RADIUS,
  ZONE_WARM_RADIUS,
  type GroundTileLayout,
  type MapDoc,
  type MapPropPlacement,
} from "@battlebeasts/shared";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Player position on the ground, quantised to a tile.
 *
 * Streaming listens for a tile change. Updating every frame would rebuild the
 * neighbourhood while the player is still standing in the same tile.
 */

type Center = { x: number; z: number; tx: number; tz: number };

let center: Center = { x: 0, z: 0, tx: 0, tz: 0 };
let layout: Pick<GroundTileLayout, "sizeX" | "sizeZ" | "tilesX" | "tilesZ"> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function bindZoneLayout(next: GroundTileLayout | null) {
  layout = next;
  const tx = next ? tileIndexAt(next.sizeX, next.tilesX, center.x) : 0;
  const tz = next ? tileIndexAt(next.sizeZ, next.tilesZ, center.z) : 0;
  if (tx === center.tx && tz === center.tz && layout === next) return;
  center = { ...center, tx, tz };
  emit();
}

export function setZoneFocus(x: number, z: number) {
  const tx = layout ? tileIndexAt(layout.sizeX, layout.tilesX, x) : center.tx;
  const tz = layout ? tileIndexAt(layout.sizeZ, layout.tilesZ, z) : center.tz;
  if (tx === center.tx && tz === center.tz) {
    center.x = x;
    center.z = z;
    return;
  }
  center = { x, z, tx, tz };
  emit();
}

function tileAtFocus(ground: GroundTileLayout): { tx: number; tz: number } {
  const here = getZoneCenter();
  return {
    tx: tileIndexAt(ground.sizeX, ground.tilesX, here.x),
    tz: tileIndexAt(ground.sizeZ, ground.tilesZ, here.z),
  };
}

export function getZoneCenter(): Center {
  return center;
}

export function useZoneCenter(): Center {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => center,
  );
}

function groupKey(kind: "ground" | "prop", tile: string, prop?: string): string {
  return kind === "ground" ? `ground\0${tile}` : `prop\0${tile}\0${prop}`;
}

function groupsNear(doc: MapDoc, layout: GroundTileLayout, radius: number): string[] {
  const { tx, tz } = tileAtFocus(layout);
  const near = new Set(tilesWithin(layout, tx, tz, radius).map((t) => tileKey(t.tx, t.tz)));
  const out: string[] = [];
  for (const tile of near) out.push(groupKey("ground", tile));
  const seen = new Set<string>();
  const addProp = (tile: string, prop: string) => {
    if (!near.has(tile)) return;
    const key = groupKey("prop", tile, prop);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const placement of doc.props) {
    addProp(placementTileKey(layout, placement.x, placement.z), placement.prop);
  }
  for (const field of doc.scatters) {
    const tiles = new Set<string>();
    for (const [x, z] of field.dabs) tiles.add(placementTileKey(layout, x, z));
    for (const tile of tiles) {
      for (const prop of field.props) addProp(tile, prop.prop);
    }
  }
  return out;
}

/**
 * Ground tiles and prop groups the player can see, plus the ring being warmed.
 *
 * The visible neighbourhood is admitted together (the loading gate compiles
 * it). After that, one further group is admitted per frame, while it is still
 * outside the fog. Dropping a group that fell behind the player is immediate.
 */
export function useAdmittedGroups(doc: MapDoc, layout: GroundTileLayout | null): string[] | null {
  const center = useZoneCenter();
  const admitted = useRef<Set<string>>(new Set());
  const [keys, setKeys] = useState<string[]>(() => {
    if (!layout?.tiled) return [];
    const show = groupsNear(doc, layout, ZONE_SHOW_RADIUS);
    admitted.current = new Set(show);
    return show;
  });

  useLayoutEffect(() => {
    if (!layout?.tiled) return;
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const warm = groupsNear(doc, layout, ZONE_WARM_RADIUS);
      const warmSet = new Set(warm);
      const show = new Set(groupsNear(doc, layout, ZONE_SHOW_RADIUS));
      let changed = false;
      for (const key of admitted.current) {
        if (!warmSet.has(key)) {
          admitted.current.delete(key);
          changed = true;
        }
      }
      for (const key of show) {
        if (!admitted.current.has(key)) {
          admitted.current.add(key);
          changed = true;
        }
      }
      const next = warm.find((key) => !admitted.current.has(key));
      if (next) {
        admitted.current.add(next);
        changed = true;
      }
      if (changed) setKeys([...admitted.current]);
      if (next) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [doc, layout, center.tx, center.tz]);

  if (!layout?.tiled) return null;
  return keys;
}

export function groundGroupKey(tile: string): string {
  return groupKey("ground", tile);
}

export function propGroupKey(tile: string, prop: string): string {
  return groupKey("prop", tile, prop);
}

export function propTypesInShow(doc: MapDoc, layout: GroundTileLayout): string[] {
  const { tx, tz } = tileAtFocus(layout);
  const near = new Set(tilesWithin(layout, tx, tz, ZONE_SHOW_RADIUS).map((t) => tileKey(t.tx, t.tz)));
  const types = new Set<string>();
  for (const placement of doc.props) {
    if (near.has(placementTileKey(layout, placement.x, placement.z))) types.add(placement.prop);
  }
  for (const field of doc.scatters) {
    const nearField = field.dabs.some(([x, z]) => near.has(placementTileKey(layout, x, z)));
    if (!nearField) continue;
    for (const prop of field.props) types.add(prop.prop);
  }
  return [...types];
}

export type { MapPropPlacement };
