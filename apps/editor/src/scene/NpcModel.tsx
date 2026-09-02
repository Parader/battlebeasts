import { npcModel, NPC_MODEL_IDS, NPC_MODELS, paramString, type MapElement, type NpcModelDef } from "@battlebeasts/shared";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { stripHorizontalRootMotion } from "@web/game/animation/clipUtils";
import { prepareNpcCharacterScene } from "@web/game/npcPrepare";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * Map-editor preview for a placed NPC.
 *
 * Uses the same scale/plant as the game but a lightweight idle mixer instead
 * of the full CharacterAnimationController — that controller targets the hero
 * rig and is easy to break in an editor-only import graph.
 */

function NpcMesh({ model }: { model: NpcModelDef }) {
  const gltf = useGLTF(`/${model.file}`);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const scene = useMemo(
    () => prepareNpcCharacterScene(gltf.scene, gltf.animations, model),
    [gltf.scene, gltf.animations, model],
  );

  useEffect(() => {
    const src =
      gltf.animations.find((clip) => clip.name === model.clips.idle) ?? gltf.animations[0];
    if (!src) return;
    const clip = stripHorizontalRootMotion(src);
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    mixerRef.current = mixer;
    scene.traverse((o) => {
      o.raycast = () => {};
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [scene, gltf.animations, model.clips.idle]);

  useFrame((_, dt) => {
    mixerRef.current?.update(Math.min(0.05, Math.max(0, dt)));
  });

  return <primitive object={scene} />;
}

export function NpcModel({ el }: { el: MapElement }) {
  if (el.type !== "npc") return null;
  const model = npcModel(paramString(el, "model", NPC_MODEL_IDS[0]!));
  if (!model) return null;
  return <NpcMesh model={model} />;
}

for (const { file } of NPC_MODELS) {
  useGLTF.preload(`/${file}`);
}
