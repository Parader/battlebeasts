/**
 * One gizmo for a multi-entity selection.
 *
 * The per-entity gizmos in `Props`, `Walls` and `Elements` attach directly to
 * the thing they move, which cannot work for a group: there is no single object
 * to attach to. This drives an invisible proxy at the selection's centre and
 * fans its movement out to every member.
 */

import { TransformControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { docStore, snap, useEditor } from "../state/docStore";

/** Positions captured when a drag starts, so movement is absolute not cumulative. */
type DragStart = {
  centre: THREE.Vector3;
  props: Map<string, { x: number; z: number }>;
  walls: Map<string, [number, number][]>;
  elements: Map<string, { x: number; z: number }>;
};

export function GroupGizmo() {
  const { doc, selectedIds, gridSnap } = useEditor();
  const [proxy, setProxy] = useState<THREE.Group | null>(null);
  const drag = useRef<DragStart | null>(null);

  const ids = useMemo(() => new Set(selectedIds), [selectedIds]);

  /** Mean of every selected entity's ground position. */
  const centre = useMemo(() => {
    const c = new THREE.Vector3();
    let n = 0;
    for (const p of doc.props) {
      if (!ids.has(p.id)) continue;
      c.x += p.x;
      c.z += p.z;
      n++;
    }
    for (const e of doc.elements) {
      if (!ids.has(e.id)) continue;
      c.x += e.x;
      c.z += e.z;
      n++;
    }
    for (const w of doc.walls) {
      if (!ids.has(w.id) || !w.points.length) continue;
      // A wall counts once, at its own centre, so a 40-point boundary does not
      // drag the pivot onto itself.
      c.x += w.points.reduce((a, q) => a + q[0], 0) / w.points.length;
      c.z += w.points.reduce((a, q) => a + q[1], 0) / w.points.length;
      n++;
    }
    if (n > 0) c.divideScalar(n);
    return c;
  }, [doc, ids]);

  /*
   * Park the proxy on the centre, but never mid-drag.
   *
   * The document changes on every frame of a drag, which moves the centre,
   * which would yank the proxy out from under the pointer.
   */
  useEffect(() => {
    if (!proxy || drag.current) return;
    proxy.position.copy(centre);
  }, [proxy, centre]);

  if (selectedIds.length < 2) return null;

  const begin = () => {
    const start: DragStart = {
      centre: centre.clone(),
      props: new Map(),
      walls: new Map(),
      elements: new Map(),
    };
    for (const p of doc.props) if (ids.has(p.id)) start.props.set(p.id, { x: p.x, z: p.z });
    for (const e of doc.elements) if (ids.has(e.id)) start.elements.set(e.id, { x: e.x, z: e.z });
    for (const w of doc.walls) {
      if (ids.has(w.id)) start.walls.set(w.id, w.points.map((q) => [q[0], q[1]] as [number, number]));
    }
    drag.current = start;
  };

  const move = () => {
    const start = drag.current;
    if (!start || !proxy) return;

    /*
     * Snap the delta, not the destination.
     *
     * `translationSnap` would quantise the proxy's own position, and the centre
     * of a selection is rarely on the grid -- so every member would be shoved
     * off its own alignment by the same arbitrary fraction. Rounding the
     * movement instead preserves whatever alignment each entity already had.
     */
    const dx = snap(proxy.position.x - start.centre.x, gridSnap);
    const dz = snap(proxy.position.z - start.centre.z, gridSnap);

    docStore.edit((d) => {
      for (const p of d.props) {
        const from = start.props.get(p.id);
        if (from) {
          p.x = from.x + dx;
          p.z = from.z + dz;
        }
      }
      for (const e of d.elements) {
        const from = start.elements.get(e.id);
        if (from) {
          e.x = from.x + dx;
          e.z = from.z + dz;
        }
      }
      for (const w of d.walls) {
        const from = start.walls.get(w.id);
        if (from) w.points = from.map((q) => [q[0] + dx, q[1] + dz] as [number, number]);
      }
      // One coalesce key for the whole drag, so it is a single undo step.
    }, "group-move");
  };

  const end = () => {
    drag.current = null;
    if (proxy) proxy.position.copy(centre);
  };

  return (
    <>
      <group ref={setProxy} />
      {/*
        Y is hidden deliberately: walls and elements have no height in the
        document, so a vertical drag could only move part of a mixed selection.
        Props keep whatever ground height the terrain gave them.
      */}
      {proxy && (
        <TransformControls
          object={proxy}
          mode="translate"
          showY={false}
          size={1}
          onMouseDown={begin}
          onObjectChange={move}
          onMouseUp={end}
        />
      )}
    </>
  );
}
