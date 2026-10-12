import { skyboxById } from "@battlebeasts/shared";
import { useTexture } from "@react-three/drei";
import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Painted sky from the map's `env.skyPreset`.
 *
 * This is the background clear, not a mesh, so orbit clicks and prop placement
 * still hit the ground. Every preset is one equirectangular picture — the same
 * file the sky picker shows — so the view and the thumbnail stay the same sky.
 */
export function MapSky({ id }: { id: string }) {
  const sky = skyboxById(id);
  if (!sky) return null;
  return <PanoramaSky url={sky.url} />;
}

function PanoramaSky({ url }: { url: string }) {
  const texture = useTexture(url);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    // Full-resolution sample. Mipmaps pick a blurrier level on the horizon
    // and make an already-stretched panorama look blocky.
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
