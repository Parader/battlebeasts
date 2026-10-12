import { buildWaterMesh, type MapDoc, type MapWater } from "@battlebeasts/shared";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { dressEnvironmentObject } from "./environmentMotion";

/**
 * Rivers and ponds from the map document, on the match ground.
 *
 * The editor draws the same meshes. This copy is what a match actually shows.
 */

function WaterBody({ water }: { water: MapWater }) {
  const geometry = useMemo(() => {
    const data = buildWaterMesh(water);
    if (!data) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((data.positions.length / 3) * 2), 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    return geometry;
  }, [water]);

  const material = useMemo(() => new THREE.MeshStandardMaterial({ name: "water_disk" }), []);

  useEffect(() => {
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, material);
    dressEnvironmentObject(mesh, "water_disk");
    return () => geometry.dispose();
  }, [geometry, material]);

  useEffect(() => () => material.dispose(), [material]);

  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} renderOrder={1} />;
}

export function WaterBodies({ doc }: { doc: MapDoc }) {
  return (
    <>
      {(doc.waters ?? []).map((water) => (
        <WaterBody key={water.id} water={water} />
      ))}
    </>
  );
}
