import { propUrlForKey, type MapPropPlacement } from "@battlebeasts/shared";
import { TransformControls, useGLTF } from "@react-three/drei";
import { Suspense, memo, useMemo, useState } from "react";
import * as THREE from "three";
import type { GizmoMode } from "../state/docStore";
import { docStore, selectEntity, useEditor } from "../state/docStore";
import { wasDragged } from "./clickGuard";

/**
 * Placed props.
 *
 * Rendering is one cloned scene per placement, which is fine at editor scale
 * and keeps per-prop selection and gizmos trivial. The runtime path batches
 * these into InstancedMesh instead -- that is a separate concern, and doing it
 * here would cost hit-testing.
 *
 * `placement.y` is the final world Y of the group: the editor already
 * subtracted the model's `baseY` when planting, so nothing at render or
 * runtime needs the manifest to sit a prop on the ground.
 */

/** Shadow-ready template per prop key — traverse once, clone per placement. */
const propSceneTemplates = new Map<string, THREE.Object3D>();

function clonePropScene(propKey: string, gltf: { scene: THREE.Object3D }): THREE.Object3D {
  let template = propSceneTemplates.get(propKey);
  if (!template) {
    template = gltf.scene.clone(true);
    template.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    propSceneTemplates.set(propKey, template);
  }
  return template.clone(true);
}

const PropModel = memo(function PropModel({
  p,
  selected,
  solo,
  gizmo,
  gridSnap,
  angleSnap,
}: {
  p: MapPropPlacement;
  selected: boolean;
  /** Only selection there is, so it owns the gizmo. A group uses `GroupGizmo`. */
  solo: boolean;
  gizmo: GizmoMode;
  gridSnap: number;
  angleSnap: number;
}) {
  const gltf = useGLTF(propUrlForKey(p.prop));
  // Held in state, not a ref: TransformControls needs the instance at render
  // time, and a ref alone would not re-render once it is populated.
  const [group, setGroup] = useState<THREE.Group | null>(null);

  const scene = useMemo(() => clonePropScene(p.prop, gltf), [p.prop, gltf]);

  /** Read the live object back into the document as the gizmo drags. */
  const commit = () => {
    if (!group) return;
    // A single `scale` field means non-uniform gizmo drags have to collapse;
    // averaging keeps the prop proportionate whichever handle you grab.
    const scale = (group.scale.x + group.scale.y + group.scale.z) / 3;
    docStore.edit((d) => {
      const target = d.props.find((x) => x.id === p.id);
      if (!target) return;
      target.x = group.position.x;
      target.y = group.position.y;
      target.z = group.position.z;
      target.yaw = group.rotation.y;
      // Tilt is stored only when non-zero, so upright props stay clean in the
      // JSON and in diffs.
      const pitch = group.rotation.x;
      const roll = group.rotation.z;
      if (Math.abs(pitch) > 1e-4) target.pitch = pitch;
      else delete target.pitch;
      if (Math.abs(roll) > 1e-4) target.roll = roll;
      else delete target.roll;
      if (scale > 0.01) target.scale = scale;
    }, `gizmo:${p.id}`);
  };

  return (
    <>
      <group
        ref={setGroup}
        position={[p.x, p.y, p.z]}
        // YXZ, not the default XYZ. Three extracts the *second* axis of the
        // order with `asin`, which clamps it to +/-90 degrees; under XYZ that
        // is yaw, so turning a prop past a quarter turn made the gizmo write
        // back a wrapped yaw with pitch and roll flipped to pi. The model still
        // looked right -- same orientation, different decomposition -- but the
        // collider reads yaw alone and swung the wrong way. Yaw leads here, so
        // it is the one axis that must never be the clamped one.
        rotation={[p.pitch ?? 0, p.yaw, p.roll ?? 0, "YXZ"]}
        scale={p.scale}
        onPointerUp={(e) => {
          if (e.button !== 0 || wasDragged()) return;
          e.stopPropagation();
          selectEntity(p.id, {
            additive: e.shiftKey || e.ctrlKey || e.metaKey,
            isolate: e.altKey,
          });
        }}
      >
        {/*
          Pivot correction lives on an inner node so the outer group's position
          is the prop's visible centre. The gizmo drives the outer group, which
          is why rotating now spins the model in place rather than swinging it
          around whatever corner the artist left the origin at.
        */}
        <group position={[-(p.pivotX ?? 0), 0, -(p.pivotZ ?? 0)]}>
          <primitive object={scene} />
        </group>
        {selected && <SelectionRing prop={p} />}
      </group>

      {solo && group && (
        <>
          <TransformControls
            object={group}
            mode={gizmo}
            translationSnap={gridSnap > 0 ? gridSnap : null}
            rotationSnap={angleSnap > 0 ? angleSnap : null}
            size={0.8}
            onObjectChange={commit}
          />
          {/*
            Yaw ring alongside the move gizmo.

            Turning a prop is most of the work of dressing a map, and bouncing
            between W and E for every fence post is a tax on the common case.
            Hiding X and Z leaves only the green Y ring -- three hides the
            screen-space rings too, since their names contain X and Z -- so
            there is no ambiguity about what this one does. It is drawn wider
            than the arrows so the two gizmos never compete for a click.
          */}
          {gizmo === "translate" && (
            <TransformControls
              object={group}
              mode="rotate"
              showX={false}
              showZ={false}
              rotationSnap={angleSnap > 0 ? angleSnap : null}
              size={1.25}
              onObjectChange={commit}
            />
          )}
        </>
      )}
    </>
  );
}, (prev, next) => {
  if (prev.p !== next.p || prev.selected !== next.selected || prev.solo !== next.solo) return false;
  if (!next.solo) return true;
  return (
    prev.gizmo === next.gizmo &&
    prev.gridSnap === next.gridSnap &&
    prev.angleSnap === next.angleSnap
  );
});

/** Drawn in prop-local space, so it inherits the placement rotation and scale. */
function SelectionRing({ prop }: { prop: MapPropPlacement }) {
  const r =
    prop.collider.mode === "circle"
      ? prop.collider.radius
      : prop.collider.mode === "box"
        ? Math.hypot(prop.collider.halfX, prop.collider.halfZ)
        : 0.5;
  // On the collider, not the pivot. For a model authored away from its own
  // origin those are different places, and a ring floating beside the building
  // reads as the building being misplaced.
  const ox = prop.collider.mode === "none" ? 0 : (prop.collider.offsetX ?? 0);
  const oz = prop.collider.mode === "none" ? 0 : (prop.collider.offsetZ ?? 0);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[ox, 0.03, oz]}>
      <ringGeometry args={[r * 1.05, r * 1.05 + 0.08 / Math.abs(prop.scale || 1), 40]} />
      <meshBasicMaterial color="#6aa9ff" transparent opacity={0.95} depthTest={false} />
    </mesh>
  );
}

export function Props() {
  const { doc, selectedIds, gizmo, gridSnap, angleSnap } = useEditor();
  const solo = selectedIds.length === 1 ? selectedIds[0] : null;
  return (
    <>
      {doc.props.map((p) => (
        // Keyed by prop as well as id so swapping the model remounts the loader.
        <Suspense key={`${p.id}:${p.prop}`} fallback={null}>
          <PropModel
            p={p}
            selected={selectedIds.includes(p.id)}
            solo={p.id === solo}
            gizmo={gizmo}
            gridSnap={gridSnap}
            angleSnap={angleSnap}
          />
        </Suspense>
      ))}
    </>
  );
}
