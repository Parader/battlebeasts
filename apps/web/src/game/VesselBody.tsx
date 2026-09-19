import { useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  normalizeCosmeticBody,
  type CosmeticBodyId,
} from "@battlebeasts/shared";
import { YBOT_URL, setHeroSurfaceVisible, tintCharacterSurface } from "./characterVisual";
import { mountSkinnedCosmetic } from "./cosmeticSkinBind";

useGLTF.preload(YBOT_URL);

type Props = {
  characterRoot: THREE.Object3D;
  body?: string | null;
  color: string;
};

/**
 * Swap Mixamo Y Bot onto the live hero skeleton. Clips stay on hero.glb.
 */
export function VesselBody({ characterRoot, body, color }: Props) {
  const male = normalizeCosmeticBody(body) === "male";
  const gltf = useGLTF(YBOT_URL);

  useEffect(() => {
    setHeroSurfaceVisible(characterRoot, !male);
    if (!male) {
      tintCharacterSurface(characterRoot, color);
      return;
    }

    const clone = cloneSkinned(gltf.scene) as THREE.Object3D;
    const meshes = mountSkinnedCosmetic(clone, characterRoot, undefined, {
      hostBindInverses: false,
    });
    if (!meshes) {
      setHeroSurfaceVisible(characterRoot, true);
      return;
    }
    const owned: THREE.Material[] = [];
    for (const mesh of meshes) {
      mesh.userData.bbVesselBody = true;
      if (mesh.material) {
        const cloned = Array.isArray(mesh.material)
          ? mesh.material.map((m) => {
              const next = m.clone();
              owned.push(next);
              return next;
            })
          : mesh.material.clone();
        if (!Array.isArray(cloned)) owned.push(cloned);
        mesh.material = cloned;
        const mats = Array.isArray(cloned) ? cloned : [cloned];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (!("opacity" in std)) continue;
          std.transparent = true;
          std.opacity = 1;
          std.depthWrite = true;
        }
      }
      const lower = mesh.name.toLowerCase();
      if (lower.includes("joint")) {
        mesh.visible = false;
        continue;
      }
      if (!lower.includes("surface")) mesh.name = "Beta_Surface";
      mesh.visible = true;
    }
    tintCharacterSurface(characterRoot, color);

    return () => {
      for (const mesh of meshes) mesh.removeFromParent();
      for (const mat of owned) mat.dispose();
      setHeroSurfaceVisible(characterRoot, true);
    };
  }, [characterRoot, male, gltf.scene, color]);

  return null;
}

export function vesselBodyId(raw: string | null | undefined): CosmeticBodyId {
  return normalizeCosmeticBody(raw);
}
