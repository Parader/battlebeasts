import { skyboxById } from "@battlebeasts/shared";
import { useTexture } from "@react-three/drei";
import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { assetUrl } from "./assetUrl";

/** Painted sky for a map preset. Background only — fog still applies to the world. */
export function MapSky({ id }: { id: string }) {
  const sky = skyboxById(id);
  if (!sky) return null;
  return <PanoramaSky url={assetUrl(sky.url)} />;
}

function PanoramaSky({ url }: { url: string }) {
  const texture = useTexture(url);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    const previous = scene.background;
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = previous;
    };
  }, [gl, scene, texture]);
  return null;
}
