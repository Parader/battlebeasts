import { useEffect } from "react";
import type * as THREE from "three";
import { normalizeCosmeticBody, type CosmeticsEquipped } from "@battlebeasts/shared";
import { BoneSkins } from "./BoneSkins";
import { setCharacterOpacity, syncEmbeddedCosmetics } from "./characterVisual";

type Props = {
  characterRoot: THREE.Object3D;
  equipped?: CosmeticsEquipped | null;
  /** Re-apply after gear show/hide (keeps cloak ghosting on newly visible pieces). */
  opacity?: number;
  body?: string | null;
};

/**
 * Toggle embedded hero.glb gear and mount bone-attached skin GLBs.
 * New skins: `file` + `bone` in COSMETIC_CATALOG (see tools/blender_export_skin.py).
 */
export function EquippedCosmetics({ characterRoot, equipped, opacity = 1, body }: Props) {
  const vessel = normalizeCosmeticBody(body);
  useEffect(() => {
    try {
      syncEmbeddedCosmetics(characterRoot, equipped);
      setCharacterOpacity(characterRoot, opacity);
    } catch (err) {
      console.warn("[EquippedCosmetics] sync failed:", err);
    }
  }, [characterRoot, equipped, opacity]);

  return (
    <BoneSkins
      key={vessel}
      characterRoot={characterRoot}
      equipped={equipped}
      opacity={opacity}
      body={vessel}
    />
  );
}
