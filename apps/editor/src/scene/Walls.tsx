import type { MapWall } from "@battlebeasts/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { docStore, selectEntity, snap, useEditor } from "../state/docStore";
import { wasDragged } from "./clickGuard";

/**
 * Collision boundaries drawn straight onto the ground, independent of props.
 *
 * Fitting a collider to every individual rock in a cluster is fiddly and
 * produces dozens of shapes with impassable slivers between them. Drawing one
 * polyline around the cluster instead -- with the props themselves set to no
 * collision -- is both easier to author and cheaper at runtime, since it
 * becomes a single `WallCollider` segment buffer.
 *
 * Walls are invisible in game; the height here exists only so you can see and
 * click them in the editor.
 */

const WALL_H = 1.2;
const WALL_T = 0.09;
/** Click within this of the first point to close the loop. */
export const CLOSE_SNAP_M = 0.6;

type Seg = { x: number; z: number; len: number; angle: number };

function segments(points: ReadonlyArray<readonly [number, number]>, closed: boolean): Seg[] {
  const out: Seg[] = [];
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    // A box's length runs along +X, so rotating by -atan2 aligns it to the
    // segment (rotation.y = t maps +X to (cos t, 0, -sin t)).
    out.push({ x: a[0] + dx / 2, z: a[1] + dz / 2, len, angle: -Math.atan2(dz, dx) });
  }
  return out;
}

function Ribbon({
  points,
  closed,
  color,
  opacity = 0.55,
  onPointerUp,
}: {
  points: ReadonlyArray<readonly [number, number]>;
  closed: boolean;
  color: string;
  opacity?: number;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const segs = useMemo(() => segments(points, closed), [points, closed]);
  return (
    <>
      {segs.map((s, i) => (
        <mesh
          key={i}
          position={[s.x, WALL_H / 2, s.z]}
          rotation={[0, s.angle, 0]}
          onPointerUp={onPointerUp}
        >
          <boxGeometry args={[s.len, WALL_H, WALL_T]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function Vertices({ points, color }: { points: ReadonlyArray<readonly [number, number]>; color: string }) {
  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={[p[0], 0.05, p[1]]}>
          <sphereGeometry args={[0.14, 10, 8]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Invisible ground-plane proxy that supplies positions while dragging a vertex.
 *
 * Raycasting the real ground would break as soon as the cursor passed over a
 * prop, so the drag tracks a plane that spans the whole scene instead. It has
 * to be a transparent material rather than `visible={false}`, because three's
 * raycaster skips invisible objects entirely.
 *
 * Movement only -- the release is handled on the window, since a pointerup
 * over a prop never reaches this mesh.
 */
function DragPlane({ onMove }: { onMove: (x: number, z: number) => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(e) => {
        e.stopPropagation();
        onMove(e.point.x, e.point.z);
      }}
    >
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * Vertex handles for the selected boundary: drag to move, click a midpoint to
 * insert, Alt-click a point to remove it.
 */
function EditableVertices({ wall }: { wall: MapWall }) {
  const { gridSnap } = useEditor();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  // Orbit would otherwise fight the drag for the same pointer.
  useEffect(() => {
    if (!controls) return;
    if (dragIndex === null) return;
    controls.enabled = false;
    return () => {
      controls.enabled = true;
    };
  }, [controls, dragIndex]);

  /*
   * End the drag from the window, not from the drag plane's own pointerup.
   *
   * The plane only receives the event when the ray reaches it, so releasing
   * over a prop that stops propagation dropped the release entirely and left
   * the vertex stuck to the cursor. The window always sees it.
   */
  useEffect(() => {
    if (dragIndex === null) return;
    const end = () => setDragIndex(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragIndex]);

  const movePoint = (i: number, x: number, z: number) => {
    docStore.edit((d) => {
      const w = d.walls.find((v) => v.id === wall.id);
      if (w?.points[i]) w.points[i] = [snap(x, gridSnap), snap(z, gridSnap)];
    }, `wallpt:${wall.id}:${i}`);
  };

  const removePoint = (i: number) => {
    // Two points are the minimum for a segment; below that the wall is gone.
    if (wall.points.length <= 2) return;
    docStore.edit((d) => {
      const w = d.walls.find((v) => v.id === wall.id);
      if (w) w.points.splice(i, 1);
    });
  };

  const insertAfter = (i: number, x: number, z: number) => {
    docStore.edit((d) => {
      const w = d.walls.find((v) => v.id === wall.id);
      if (w) w.points.splice(i + 1, 0, [snap(x, gridSnap), snap(z, gridSnap)]);
    });
  };

  // Midpoints, including the closing segment on a loop.
  const mids: Array<{ i: number; x: number; z: number }> = [];
  const n = wall.points.length;
  for (let i = 0; i < (wall.closed ? n : n - 1); i++) {
    const a = wall.points[i]!;
    const b = wall.points[(i + 1) % n]!;
    mids.push({ i, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
  }

  return (
    <>
      {wall.points.map((p, i) => (
        <mesh
          key={`v${i}`}
          position={[p[0], 0.05, p[1]]}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            if (e.altKey) {
              removePoint(i);
              return;
            }
            setDragIndex(i);
          }}
        >
          <sphereGeometry args={[0.18, 12, 10]} />
          <meshBasicMaterial color={dragIndex === i ? "#ffffff" : "#6aa9ff"} depthTest={false} />
        </mesh>
      ))}

      {dragIndex === null &&
        mids.map((m) => (
          <mesh
            key={`m${m.i}`}
            position={[m.x, 0.05, m.z]}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              insertAfter(m.i, m.x, m.z);
            }}
          >
            <sphereGeometry args={[0.1, 8, 6]} />
            <meshBasicMaterial color="#5fd08a" transparent opacity={0.75} depthTest={false} />
          </mesh>
        ))}

      {dragIndex !== null && (
        <DragPlane onMove={(x, z) => movePoint(dragIndex, x, z)} />
      )}
    </>
  );
}

function WallMesh({
  wall,
  selected,
  solo,
}: {
  wall: MapWall;
  selected: boolean;
  /** Vertex editing is a single-wall job, so a group selection suppresses it. */
  solo: boolean;
}) {
  return (
    <group>
      <Ribbon
        points={wall.points}
        closed={wall.closed}
        color={selected ? "#6aa9ff" : "#ffb454"}
        opacity={selected ? 0.8 : 0.5}
        onPointerUp={(e) => {
          if (e.button !== 0 || wasDragged()) return;
          e.stopPropagation();
          selectEntity(wall.id, {
            additive: e.shiftKey || e.ctrlKey || e.metaKey,
            isolate: e.altKey,
            tool: "select",
          });
        }}
      />
      {solo && <EditableVertices wall={wall} />}
    </group>
  );
}

/** The polyline currently being drawn, plus a rubber band to the cursor. */
function Draft() {
  const { wallDraft, wallCursor } = useEditor();
  if (!wallDraft?.length) return null;
  const preview = wallCursor ? [...wallDraft, wallCursor] : wallDraft;
  return (
    <group>
      <Ribbon points={preview} closed={false} color="#5fd08a" opacity={0.55} />
      <Vertices points={wallDraft} color="#5fd08a" />
      {wallDraft.length > 2 && (
        // Target showing where a click would close the loop.
        <mesh position={[wallDraft[0]![0], 0.05, wallDraft[0]![1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[CLOSE_SNAP_M - 0.06, CLOSE_SNAP_M, 28]} />
          <meshBasicMaterial color="#5fd08a" transparent opacity={0.7} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

export function Walls() {
  const { doc, selectedIds } = useEditor();
  const solo = selectedIds.length === 1 ? selectedIds[0] : null;
  return (
    <>
      {doc.walls.map((w) => (
        <WallMesh
          key={w.id}
          wall={w}
          selected={selectedIds.includes(w.id)}
          solo={w.id === solo}
        />
      ))}
      <Draft />
    </>
  );
}
