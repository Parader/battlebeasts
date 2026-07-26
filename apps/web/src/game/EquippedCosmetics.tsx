import { useEffect } from "react";
import type * as THREE from "three";
import type { CosmeticsEquipped } from "@battlebeasts/shared";
import { setCharacterOpacity, syncEmbeddedCosmetics } from "./characterVisual";

type Props = {
  characterRoot: THREE.Object3D;
  equipped?: CosmeticsEquipped | null;
  /** Re-apply after gear show/hide (keeps cloak ghosting on newly visible pieces). */
  opacity?: number;
};

/**
 * Toggle `cosmetic_*` meshes inside hero.glb based on equipped slots.
 * Gear must be parented to the Mixamo skeleton in Blender and named
 * e.g. `cosmetic_hat_wizard` (see COSMETIC_CATALOG.meshName).
 */
export function EquippedCosmetics({ characterRoot, equipped, opacity = 1 }: Props) {
  useEffect(() => {
    syncEmbeddedCosmetics(characterRoot, equipped);
    setCharacterOpacity(characterRoot, opacity);
  }, [characterRoot, equipped, opacity]);

  return null;
}
