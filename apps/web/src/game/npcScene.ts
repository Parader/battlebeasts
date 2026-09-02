import type { NpcModelDef } from "@battlebeasts/shared";
import * as THREE from "three";
import { CharacterAnimationController } from "./animation";
import { npcAnimationConfig } from "./npcPrepare";

export { npcAnimationConfig, prepareNpcCharacterScene } from "./npcPrepare";

export function createNpcAnimationController(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  model: NpcModelDef,
): CharacterAnimationController {
  const controller = new CharacterAnimationController(scene, animations, npcAnimationConfig(model));
  controller.spineCursorAim = false;
  return controller;
}
