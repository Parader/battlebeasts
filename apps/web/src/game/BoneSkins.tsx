import { useEffect, useMemo, useRef, Suspense } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  COSMETIC_SLOTS,
  cosmeticFilePath,
  cosmeticSkinBones,
  getCosmeticItem,
  isBoneSkin,
  isSkinnedCosmetic,
  normalizeCosmeticBody,
  normalizeCosmeticsEquipped,
  type CosmeticFit,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";
import { assetUrl } from "./assetUrl";
import { hideRevealedEmbeddedSkinnedMeshes, revealEmbeddedSkinnedMeshes, setCharacterOpacity } from "./characterVisual";
import { useResolvedCosmeticFit } from "./cosmeticFitStore";
import { mountSkinnedCosmetic } from "./cosmeticSkinBind";
import { getGearEnvMap, prepareGearMaterial } from "./gearEnvMap";
import { attachToBoneKeepLocal, findMixamoBone } from "./vfx/attach";

type Props = {
  characterRoot: THREE.Object3D;
  equipped?: CosmeticsEquipped | null;
  opacity?: number;
  body?: string | null;
};

type Item = {
  catalogId: string;
  url: string;
  bone?: string;
  bones: string[];
  skinned: boolean;
};

type SkinBase = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};

const _fitEuler = new THREE.Euler();
const _fitQuat = new THREE.Quaternion();

function captureSkinBase(obj: THREE.Object3D): SkinBase {
  return {
    position: obj.position.clone(),
    quaternion: obj.quaternion.clone(),
    scale: obj.scale.clone(),
  };
}

function applyCosmeticFit(obj: THREE.Object3D, base: SkinBase, fit: CosmeticFit): void {
  obj.position.set(
    base.position.x + fit.position.x,
    base.position.y + fit.position.y,
    base.position.z + fit.position.z,
  );
  _fitEuler.set(
    THREE.MathUtils.degToRad(fit.rotation.x),
    THREE.MathUtils.degToRad(fit.rotation.y),
    THREE.MathUtils.degToRad(fit.rotation.z),
    "XYZ",
  );
  _fitQuat.setFromEuler(_fitEuler);
  obj.quaternion.copy(base.quaternion).multiply(_fitQuat);
  obj.scale.set(
    base.scale.x * fit.scale.x,
    base.scale.y * fit.scale.y,
    base.scale.z * fit.scale.z,
  );
}

function equippedSkinItems(
  equipped: CosmeticsEquipped | null | undefined,
  body?: string | null,
): Item[] {
  const eq = normalizeCosmeticsEquipped(equipped);
  const vessel = normalizeCosmeticBody(body);
  const out: Item[] = [];
  for (const slot of COSMETIC_SLOTS) {
    const id = eq[slot];
    if (!id) continue;
    const def = getCosmeticItem(id);
    if (!def || !isBoneSkin(def)) continue;
    const rel = cosmeticFilePath(def, vessel);
    if (!rel) continue;
    out.push({
      catalogId: def.id,
      url: assetUrl(rel),
      bone: def.bone,
      bones: cosmeticSkinBones(def),
      skinned: isSkinnedCosmetic(def),
    });
  }
  return out;
}

function declaredBoneName(obj: THREE.Object3D): string | null {
  const extra = obj.userData.bb_bone ?? obj.userData.bone;
  if (typeof extra === "string" && extra.trim()) return extra.trim();
  const stripped = obj.name.replace(/_export$/i, "").replace(/^mixamorig[:_]?/i, "");
  return stripped || null;
}

function ancestorIsBoneNode(
  obj: THREE.Object3D,
  root: THREE.Object3D,
  characterRoot: THREE.Object3D,
): boolean {
  let cur = obj.parent;
  while (cur && cur !== root) {
    const name = declaredBoneName(cur);
    if (name && findMixamoBone(characterRoot, name)) return true;
    cur = cur.parent;
  }
  return false;
}

/** Nodes in a set GLB that should each parent to a Mixamo bone. */
function skinBindings(
  clone: THREE.Object3D,
  characterRoot: THREE.Object3D,
  fallbackBone: string | undefined,
  listedBones: string[],
): Array<{ node: THREE.Object3D; bone: string }> {
  const named: Array<{ node: THREE.Object3D; bone: string }> = [];
  clone.traverse((obj) => {
    if (obj === clone) return;
    const name = declaredBoneName(obj);
    if (!name || !findMixamoBone(characterRoot, name)) return;
    if (ancestorIsBoneNode(obj, clone, characterRoot)) return;
    named.push({ node: obj, bone: name });
  });
  if (named.length > 1) return named;
  if (named.length === 1 && !fallbackBone) return named;

  if (fallbackBone) return [{ node: clone, bone: fallbackBone }];

  const kids = clone.children.filter((c) => c.type !== "Light" && c.type !== "Camera");
  if (listedBones.length > 0 && kids.length === listedBones.length) {
    return kids.map((node, i) => ({ node, bone: listedBones[i]! }));
  }
  return named;
}

function BoneSkinItem({
  item,
  characterRoot,
  opacity,
}: {
  item: Item;
  characterRoot: THREE.Object3D;
  opacity: number;
}) {
  const gltf = useGLTF(item.url);
  const { gl } = useThree();
  const envMap = useMemo(() => getGearEnvMap(gl), [gl]);
  const fit = useResolvedCosmeticFit(item.catalogId);
  const fitKey = [
    fit.position.x,
    fit.position.y,
    fit.position.z,
    fit.rotation.x,
    fit.rotation.y,
    fit.rotation.z,
    fit.scale.x,
    fit.scale.y,
    fit.scale.z,
  ].join(",");
  const { root, skinnedMeshes } = useMemo(() => {
    const cloned = item.skinned
      ? (cloneSkinned(gltf.scene) as THREE.Object3D)
      : gltf.scene.clone(true);
    cloned.name = `cosmetic_${item.catalogId}`;
    cloned.userData.bbBoneSkin = true;
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    cloned.traverse((obj) => {
      obj.userData.bbBoneSkin = true;
      obj.userData.bbSkinBase = captureSkinBase(obj);
      const mesh = obj as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.skeleton) skinnedMeshes.push(mesh);
      const asMesh = obj as THREE.Mesh;
      if (!asMesh.isMesh || !asMesh.material) return;
      asMesh.material = Array.isArray(asMesh.material)
        ? asMesh.material.map((m) => m.clone())
        : asMesh.material.clone();
      const mats = Array.isArray(asMesh.material) ? asMesh.material : [asMesh.material];
      for (const m of mats) prepareGearMaterial(m, envMap);
      asMesh.castShadow = true;
    });
    return { root: cloned, skinnedMeshes };
  }, [gltf.scene, item.catalogId, item.skinned, item.url, envMap]);

  const bonesKey = item.bones.join(",");
  const boundRef = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    if (item.skinned) {
      const mounted = mountSkinnedCosmetic(root, characterRoot, skinnedMeshes);
      if (!mounted) {
        const def = getCosmeticItem(item.catalogId);
        // hero.glb leftovers are the female dummy cut. File skins (fileMale
        // especially) must not fall back to that mesh.
        const recovered =
          def && !def.file && !def.fileMale
            ? revealEmbeddedSkinnedMeshes(characterRoot, def)
            : false;
        if (!recovered) {
          console.warn(`[BoneSkins] skinned bind failed for ${item.catalogId}`);
        }
      }
      boundRef.current = mounted ?? [];
      for (const node of boundRef.current) {
        node.userData.bbSkinBase = captureSkinBase(node);
        applyCosmeticFit(node, node.userData.bbSkinBase as SkinBase, fit);
      }
      return () => {
        for (const node of boundRef.current) node.removeFromParent();
        boundRef.current = [];
        const def = getCosmeticItem(item.catalogId);
        if (def) hideRevealedEmbeddedSkinnedMeshes(characterRoot, def);
      };
    }
    const listed = bonesKey ? bonesKey.split(",") : [];
    const bindings = skinBindings(root, characterRoot, item.bone, listed);
    if (bindings.length === 0) {
      console.warn(`[BoneSkins] no bone bindings in ${item.catalogId}`);
      boundRef.current = [];
      return;
    }
    boundRef.current = bindings.map((b) => b.node);
    const handles = bindings.map(({ node, bone }) => {
      const handle = attachToBoneKeepLocal(node, characterRoot, bone);
      if (!handle) console.warn(`[BoneSkins] bone "${bone}" not found for ${item.catalogId}`);
      return handle;
    });
    for (const node of boundRef.current) {
      const base = node.userData.bbSkinBase as SkinBase | undefined;
      if (base) applyCosmeticFit(node, base, fit);
    }
    return () => {
      boundRef.current = [];
      for (const handle of handles) handle?.release();
    };
  }, [root, skinnedMeshes, characterRoot, item.catalogId, item.skinned, item.bone, bonesKey]);

  useEffect(() => {
    for (const node of boundRef.current) {
      const base = node.userData.bbSkinBase as SkinBase | undefined;
      if (base) applyCosmeticFit(node, base, fit);
    }
  }, [root, item.skinned, fit, fitKey]);

  useEffect(() => {
    setCharacterOpacity(characterRoot, opacity);
  }, [characterRoot, opacity, root]);

  useEffect(() => {
    return () => {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      });
    };
  }, [root]);

  return null;
}

/**
 * Load one GLB per catalog item.
 * Rigid: meshes named after Mixamo bones parent to those bones.
 * Skinned (`rig: "skinned"`): rebind to the live Mixamo skeleton (chest, later pants).
 */
export function BoneSkins({ characterRoot, equipped, opacity = 1, body }: Props) {
  const items = equippedSkinItems(equipped, body);
  if (items.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {items.map((item) => (
        <BoneSkinItem
          key={`${item.catalogId}:${item.url}`}
          item={item}
          characterRoot={characterRoot}
          opacity={opacity}
        />
      ))}
    </Suspense>
  );
}
