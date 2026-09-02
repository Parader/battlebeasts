import { COLLISION } from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

/**
 * A ghost of the actual player character, standing at the origin.
 *
 * Props were authored across several kits at different times, and "does this
 * archway read as something you can walk under" is not answerable from an
 * orbit camera. Putting the real hero mesh in the scene at true scale makes it
 * a glance instead of a guess. The disc under it is the collision radius the
 * server actually uses, so it doubles as a gap gauge you can eyeball.
 *
 * The GLB is loaded only when this component mounts — toggling Scale off should
 * not pull the hero asset into memory.
 */
function ScaleReferenceMesh() {
  const gltf = useGLTF("/hero.glb");

  const ghost = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Unlit and translucent so it never reads as part of the map.
      const mat = new THREE.MeshBasicMaterial({
        color: "#6aa9ff",
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      mesh.material = mat;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    return clone;
  }, [gltf]);

  return (
    <group position={[0, 0, 0]}>
      <primitive object={ghost} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[COLLISION.playerRadius - 0.04, COLLISION.playerRadius, 32]} />
        <meshBasicMaterial color="#6aa9ff" transparent opacity={0.9} depthTest={false} />
      </mesh>
    </group>
  );
}

export function ScaleReference() {
  return <ScaleReferenceMesh />;
}
