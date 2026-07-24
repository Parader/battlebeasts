import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import * as THREE from "three";
import type { HubPropPlacement } from "@battlebeasts/shared";

const ASSETS = "/assets";

type Props = {
  url: string;
  position?: [number, number, number];
  scale?: number;
  rotationY?: number;
};

/**
 * Static fantasy_rts glTF prop — clones, enables shadows, plants on y=0.
 */
export function FantasyProp({
  url,
  position = [0, 0, 0],
  scale = 1,
  rotationY = 0,
}: Props) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const root = cloneSkinned(gltf.scene) as THREE.Object3D;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.position.y -= box.min.y;
    return root;
  }, [gltf.scene, scale]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={scene} />
    </group>
  );
}

export function yawTowardOrigin(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

export function resolvePropYaw(prop: HubPropPlacement): number {
  if (prop.rotationY === "faceOrigin") return yawTowardOrigin(prop.x, prop.z);
  return prop.rotationY;
}

export function hubAssetUrl(file: string): string {
  return `${ASSETS}/${file}`;
}

export function HubProp({ prop }: { prop: HubPropPlacement }) {
  return (
    <FantasyProp
      url={hubAssetUrl(prop.file)}
      position={[prop.x, 0, prop.z]}
      scale={prop.scale}
      rotationY={resolvePropYaw(prop)}
    />
  );
}
