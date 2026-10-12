import {
  layoutFromGround,
  placementTileKey,
  propUrlForKey,
  tileKey,
  tilesWithin,
  ZONE_WARM_RADIUS,
  type MapColliderSpec,
  type MapPropPlacement,
} from "@battlebeasts/shared";
import { TransformControls, useGLTF } from "@react-three/drei";
import { Suspense, memo, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { GizmoMode } from "../state/docStore";
import { docStore, selectEntity, useEditorSlice } from "../state/docStore";
import { wasDragged } from "./clickGuard";
import { dressEnvironmentObject } from "@web/game/environmentMotion";
import { EnvParticleBurst, particleKind } from "@web/game/envParticles?fresh=7";
import { paintLife } from "./lifePaint";
import { paintToonWater } from "./waterPaint";
import { useEditorFocus } from "./viewFocus";

/** Repeated props at or above this count share one instanced draw. */
const INSTANCE_AT = 8;

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
    dressEnvironmentObject(template, propKey);
    paintToonWater(template, propKey);
    paintLife(template, propKey);
    template.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        // Receiving on every unique GLB is what fills the shadow map twice.
        o.receiveShadow = false;
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
  useEffect(() => {
    paintToonWater(scene, p.prop);
    paintLife(scene, p.prop);
  }, [scene, p.prop]);

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

  const puff = particleKind(p.prop);

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
          {puff && <EnvParticleBurst kind={puff} source={scene} />}
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
  if (prev.selected !== next.selected || prev.solo !== next.solo) return false;
  if (next.solo && (prev.gizmo !== next.gizmo || prev.gridSnap !== next.gridSnap || prev.angleSnap !== next.angleSnap)) {
    return false;
  }
  return samePlacement(prev.p, next.p);
});

function samePlacement(a: MapPropPlacement, b: MapPropPlacement): boolean {
  return (
    a.id === b.id &&
    a.prop === b.prop &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.yaw === b.yaw &&
    a.pitch === b.pitch &&
    a.roll === b.roll &&
    a.scale === b.scale &&
    a.pivotX === b.pivotX &&
    a.pivotZ === b.pivotZ &&
    sameCollider(a.collider, b.collider)
  );
}

function sameCollider(a: MapColliderSpec, b: MapColliderSpec): boolean {
  if (a === b) return true;
  if (a.mode !== b.mode) return false;
  if (a.mode === "none" || b.mode === "none") return a.mode === b.mode;
  if (a.offsetX !== b.offsetX || a.offsetZ !== b.offsetZ) return false;
  if (a.mode === "circle" && b.mode === "circle") return a.radius === b.radius;
  if (a.mode === "box" && b.mode === "box") {
    return a.halfX === b.halfX && a.halfZ === b.halfZ && a.yaw === b.yaw;
  }
  return false;
}

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

function placementMatrix(p: MapPropPlacement): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch ?? 0, p.yaw, p.roll ?? 0, "YXZ")),
    new THREE.Vector3(p.scale, p.scale, p.scale),
  );
  const px = p.pivotX ?? 0;
  const pz = p.pivotZ ?? 0;
  if (px !== 0 || pz !== 0) m.multiply(new THREE.Matrix4().makeTranslation(-px, 0, -pz));
  return m;
}

function InstancedEditorPart({
  geometry,
  material,
  local,
  placements,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
  placements: MapPropPlacement[];
}) {
  const mesh = useMemo(() => {
    const inst = new THREE.InstancedMesh(geometry, material, placements.length);
    const world = new THREE.Matrix4();
    for (let i = 0; i < placements.length; i++) {
      world.copy(placementMatrix(placements[i]!)).multiply(local);
      inst.setMatrixAt(i, world);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.computeBoundingSphere();
    return inst;
  }, [geometry, material, local, placements]);

  useEffect(() => () => mesh.dispose(), [mesh]);

  return (
    <primitive
      object={mesh}
      onPointerUp={(e: { button: number; instanceId?: number; stopPropagation: () => void; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) => {
        if (e.button !== 0 || wasDragged() || e.instanceId == null) return;
        const placement = placements[e.instanceId];
        if (!placement) return;
        e.stopPropagation();
        selectEntity(placement.id, {
          additive: Boolean(e.shiftKey || e.ctrlKey || e.metaKey),
          isolate: Boolean(e.altKey),
        });
      }}
    />
  );
}

function InstancedEditorProps({ propKey, placements }: { propKey: string; placements: MapPropPlacement[] }) {
  const gltf = useGLTF(propUrlForKey(propKey));
  const parts = useMemo(() => {
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    dressEnvironmentObject(source, propKey);
    paintLife(source, propKey);
    const out: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }> = [];
    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      out.push({ geometry: mesh.geometry, material: mesh.material, local: mesh.matrixWorld.clone() });
    });
    return out;
  }, [gltf.scene, propKey]);

  return (
    <>
      {parts.map((part, i) => (
        <InstancedEditorPart
          key={i}
          geometry={part.geometry}
          material={part.material}
          local={part.local}
          placements={placements}
        />
      ))}
    </>
  );
}

export const Props = memo(function Props() {
  const list = useEditorSlice((s) => s.doc.props);
  const ground = useEditorSlice((s) => s.doc.ground);
  const selectedIds = useEditorSlice((s) => s.selectedIds);
  const gizmo = useEditorSlice((s) => s.gizmo);
  const gridSnap = useEditorSlice((s) => s.gridSnap);
  const angleSnap = useEditorSlice((s) => s.angleSnap);
  const focus = useEditorFocus();
  const solo = selectedIds.length === 1 ? selectedIds[0] : null;

  const visible = useMemo(() => {
    if (ground.kind !== "painted") return list;
    const layout = layoutFromGround(ground);
    if (!layout.tiled) return list;
    const near = new Set(tilesWithin(layout, focus.tx, focus.tz, ZONE_WARM_RADIUS).map((t) => tileKey(t.tx, t.tz)));
    const selected = new Set(selectedIds);
    return list.filter((p) => selected.has(p.id) || near.has(placementTileKey(ground, p.x, p.z)));
  }, [list, ground, focus.tx, focus.tz, selectedIds]);

  const { singles, batches } = useMemo(() => {
    const selected = new Set(selectedIds);
    const groups = new Map<string, MapPropPlacement[]>();
    const alone: MapPropPlacement[] = [];
    for (const p of visible) {
      if (selected.has(p.id)) {
        alone.push(p);
        continue;
      }
      const group = groups.get(p.prop);
      if (group) group.push(p);
      else groups.set(p.prop, [p]);
    }
    const grouped: { prop: string; placements: MapPropPlacement[] }[] = [];
    for (const [prop, placements] of groups) {
      if (placements.length >= INSTANCE_AT) grouped.push({ prop, placements });
      else alone.push(...placements);
    }
    return { singles: alone, batches: grouped };
  }, [visible, selectedIds]);

  return (
    <>
      {batches.map((batch) => (
        <Suspense key={batch.prop} fallback={null}>
          <InstancedEditorProps propKey={batch.prop} placements={batch.placements} />
        </Suspense>
      ))}
      {singles.map((p) => (
        // Keyed by prop as well as id so swapping the model remounts the loader.
        <Suspense key={`${p.id}:${p.prop}:flag-spray3`} fallback={null}>
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
});
