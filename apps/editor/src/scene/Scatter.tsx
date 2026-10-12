import {
  expandScatter,
  propUrlForKey,
  type MapScatter,
  type ScatterInstance,
} from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useSyncExternalStore } from "react";
import { dressEnvironmentObject } from "@web/game/environmentMotion";
import { selectEntity, useEditorSlice } from "../state/docStore";
import { terrain } from "../state/terrain";

/**
 * Painted grass, leaves, and rocks.
 *
 * Every copy of one model in one patch is a single instanced draw. The meshes
 * do not cast shadows and do not collide, which is what keeps a meadow from
 * costing what a thousand placed props would.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pivot = new THREE.Matrix4();

function instanceMatrix(inst: ScatterInstance): THREE.Matrix4 {
  _q.setFromEuler(new THREE.Euler(0, inst.yaw, 0, "YXZ"));
  _p.set(inst.x, inst.y, inst.z);
  _s.set(inst.scale, inst.scale, inst.scale);
  _m.compose(_p, _q, _s);
  if (inst.pivotX !== 0 || inst.pivotZ !== 0) {
    _m.multiply(_pivot.makeTranslation(-inst.pivotX, 0, -inst.pivotZ));
  }
  return _m;
}

function ScatterBatch({
  fieldId,
  propKey,
  instances,
  pickable,
}: {
  fieldId: string;
  propKey: string;
  instances: ScatterInstance[];
  pickable: boolean;
}) {
  const gltf = useGLTF(propUrlForKey(propKey));
  const parts = useMemo(() => {
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    dressEnvironmentObject(source, propKey);
    const out: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }> = [];
    source.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      out.push({ geometry: mesh.geometry, material: mesh.material, local: mesh.matrixWorld.clone() });
    });
    return out;
  }, [gltf.scene, propKey]);

  const meshes = useMemo(() => {
    return parts.map((part) => {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, instances.length);
      for (let i = 0; i < instances.length; i++) {
        const world = instanceMatrix(instances[i]!).clone();
        world.multiply(part.local);
        inst.setMatrixAt(i, world);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = false;
      inst.receiveShadow = false;
      inst.computeBoundingSphere();
      inst.userData.scatterId = fieldId;
      return inst;
    });
  }, [parts, instances, fieldId]);

  useEffect(() => {
    for (const mesh of meshes) {
      mesh.raycast = pickable ? THREE.InstancedMesh.prototype.raycast : () => {};
    }
  }, [meshes, pickable]);

  useEffect(() => () => {
    for (const mesh of meshes) mesh.dispose();
  }, [meshes]);

  return (
    <>
      {meshes.map((mesh, i) => (
        <primitive
          key={i}
          object={mesh}
          onClick={(e: { stopPropagation: () => void; shiftKey?: boolean; instanceId?: number }) => {
            if (!pickable) return;
            e.stopPropagation();
            selectEntity(fieldId, { additive: Boolean(e.shiftKey), tool: "select" });
          }}
        />
      ))}
    </>
  );
}

function FieldRings({ field, selected }: { field: MapScatter; selected: boolean }) {
  if (!selected) return null;
  return (
    <>
      {field.dabs.map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
          <ringGeometry args={[Math.max(0.05, r - 0.12), r, 40]} />
          <meshBasicMaterial color="#e7c15a" transparent opacity={0.75} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}

export function ScatterFields() {
  const scatters = useEditorSlice((s) => s.doc.scatters);
  const heightScale = useEditorSlice((s) => (s.doc.ground.kind === "painted" ? s.doc.ground.heightScale : 0));
  const selectedId = useEditorSlice((s) => s.selectedId);
  const tool = useEditorSlice((s) => s.tool);
  const revision = useSyncExternalStore(terrain.subscribe, () => terrain.revision);

  const batches = useMemo(() => {
    void revision;
    const surface = (x: number, z: number) => terrain.surfaceY(x, z, heightScale);
    return scatters.map((field) => {
      const instances = expandScatter(field, surface);
      const byProp = new Map<string, ScatterInstance[]>();
      for (const inst of instances) {
        const list = byProp.get(inst.prop);
        if (list) list.push(inst);
        else byProp.set(inst.prop, [inst]);
      }
      return { field, groups: [...byProp.entries()] };
    });
  }, [scatters, heightScale, revision]);

  const pickable = tool === "select";

  return (
    <>
      {batches.map(({ field, groups }) => (
        <group key={field.id}>
          {groups.map(([prop, instances]) => (
            <ScatterBatch
              key={prop}
              fieldId={field.id}
              propKey={prop}
              instances={instances}
              pickable={pickable}
            />
          ))}
          <FieldRings field={field} selected={selectedId === field.id} />
        </group>
      ))}
    </>
  );
}
