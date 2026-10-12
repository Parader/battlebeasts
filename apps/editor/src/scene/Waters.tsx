import { buildWaterMesh, DEFAULT_WATER_WIDTH, type MapWater } from "@battlebeasts/shared";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { docStore, selectEntity, snap, useEditor, useEditorSlice } from "../state/docStore";
import { wasDragged } from "./clickGuard";
import { CLOSE_SNAP_M } from "./Walls";
import { paintToonWater } from "./waterPaint";

/**
 * Rivers and ponds drawn the same way as boundaries.
 *
 * An open stroke is a river of the stored width. Closing the loop fills a
 * pond. The mesh sits just above the ground and does not block clicks while
 * another stroke is being drawn.
 */

function geometryFor(water: Pick<MapWater, "points" | "closed" | "width">): THREE.BufferGeometry | null {
  const data = buildWaterMesh(water);
  if (!data) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((data.positions.length / 3) * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function Surface({
  water,
  onPointerUp,
  pickable,
}: {
  water: Pick<MapWater, "points" | "closed" | "width">;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  pickable: boolean;
}) {
  const geometry = useMemo(() => geometryFor(water), [water]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ name: "water_disk" }), []);

  useEffect(() => {
    if (!geometry) return;
    paintToonWater(new THREE.Mesh(geometry, material), "water_disk");
    return () => geometry.dispose();
  }, [geometry, material]);

  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={1}
      raycast={pickable ? undefined : () => {}}
      onPointerUp={onPointerUp}
    />
  );
}

function EditableVertices({ water }: { water: MapWater }) {
  const { gridSnap } = useEditor();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  useEffect(() => {
    if (!controls || dragIndex === null) return;
    controls.enabled = false;
    return () => {
      controls.enabled = true;
    };
  }, [controls, dragIndex]);

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
      const w = d.waters.find((v) => v.id === water.id);
      if (w?.points[i]) w.points[i] = [snap(x, gridSnap), snap(z, gridSnap)];
    }, `waterpt:${water.id}:${i}`);
  };

  const removePoint = (i: number) => {
    if (water.points.length <= 2) return;
    docStore.edit((d) => {
      const w = d.waters.find((v) => v.id === water.id);
      if (!w) return;
      w.points.splice(i, 1);
      if (w.points.length < 3) w.closed = false;
    });
  };

  const insertAfter = (i: number, x: number, z: number) => {
    docStore.edit((d) => {
      const w = d.waters.find((v) => v.id === water.id);
      if (w) w.points.splice(i + 1, 0, [snap(x, gridSnap), snap(z, gridSnap)]);
    });
  };

  const mids: Array<{ i: number; x: number; z: number }> = [];
  const n = water.points.length;
  for (let i = 0; i < (water.closed ? n : n - 1); i++) {
    const a = water.points[i]!;
    const b = water.points[(i + 1) % n]!;
    mids.push({ i, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
  }

  return (
    <>
      {water.points.map((p, i) => (
        <mesh
          key={`v${i}`}
          position={[p[0], 0.08, p[1]]}
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
          <meshBasicMaterial color={dragIndex === i ? "#ffffff" : "#7fd0e8"} depthTest={false} />
        </mesh>
      ))}
      {dragIndex === null &&
        mids.map((m) => (
          <mesh
            key={`m${m.i}`}
            position={[m.x, 0.08, m.z]}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              insertAfter(m.i, m.x, m.z);
            }}
          >
            <sphereGeometry args={[0.1, 8, 6]} />
            <meshBasicMaterial color="#b7fff0" transparent opacity={0.8} depthTest={false} />
          </mesh>
        ))}
      {dragIndex !== null && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            e.stopPropagation();
            movePoint(dragIndex, e.point.x, e.point.z);
          }}
        >
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

function Draft() {
  const wallDraft = useEditorSlice((s) => s.wallDraft);
  const wallCursor = useEditorSlice((s) => s.wallCursor);
  const tool = useEditorSlice((s) => s.tool);
  if (tool !== "water" || !wallDraft?.length) return null;
  const preview = wallCursor ? [...wallDraft, wallCursor] : wallDraft;
  const water = { points: preview, closed: false, width: DEFAULT_WATER_WIDTH };
  return (
    <group>
      <Surface water={water} pickable={false} />
      {wallDraft.map((p, i) => (
        <mesh key={i} position={[p[0], 0.08, p[1]]}>
          <sphereGeometry args={[0.14, 10, 8]} />
          <meshBasicMaterial color="#7fd0e8" depthTest={false} />
        </mesh>
      ))}
      {wallDraft.length > 2 && (
        <mesh position={[wallDraft[0]![0], 0.05, wallDraft[0]![1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[CLOSE_SNAP_M - 0.06, CLOSE_SNAP_M, 28]} />
          <meshBasicMaterial color="#7fd0e8" transparent opacity={0.75} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

export function Waters() {
  const waters = useEditorSlice((s) => s.doc.waters);
  const selectedIds = useEditorSlice((s) => s.selectedIds);
  const tool = useEditorSlice((s) => s.tool);
  const solo = selectedIds.length === 1 ? selectedIds[0] : null;
  const pickable = tool === "select";
  return (
    <>
      {(waters ?? []).map((water) => (
        <group key={water.id}>
          <Surface
            water={water}
            pickable={pickable}
            onPointerUp={(e) => {
              if (e.button !== 0 || wasDragged()) return;
              e.stopPropagation();
              selectEntity(water.id, {
                additive: e.shiftKey || e.ctrlKey || e.metaKey,
                isolate: e.altKey,
                tool: "select",
              });
            }}
          />
          {water.id === solo && <EditableVertices water={water} />}
        </group>
      ))}
      <Draft />
    </>
  );
}
