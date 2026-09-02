import type { NpcModelDef } from "@battlebeasts/shared";
import * as THREE from "three";
import type { CharacterAnimationConfig } from "./animation/animationConfig";
import { prepareCharacterScene } from "./characterVisual";

/** Locomotion config for a stationary NPC — every slot uses idle. */
export function npcAnimationConfig(model: NpcModelDef): CharacterAnimationConfig {
  const { idle, talk } = model.clips;
  return {
    idle,
    runForward: idle,
    runBackward: idle,
    strafeLeft: idle,
    strafeRight: idle,
    castPrimary: talk ?? idle,
  };
}

/** Scale and plant an NPC mesh the same way in the hub and the map editor. */
export function prepareNpcCharacterScene(
  sourceScene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  model: NpcModelDef,
): THREE.Object3D {
  const idle =
    animations.find((clip) => clip.name === model.clips.idle) ?? animations[0] ?? null;
  return prepareCharacterScene(sourceScene, {
    restClip: idle,
    upAxis: "y",
    splitScaleAndPlant: true,
    ...(model.height ? { targetHeight: model.height } : {}),
  });
}
