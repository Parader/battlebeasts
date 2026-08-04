import { assetUrl } from "./assetUrl";
import type { CharacterAnimationConfig } from "./animation/animationConfig";

/**
 * PvE wave fodder (zombie) — NOT hub practice dummies.
 * Lightweight Mixamo-derived GLB beside hero.glb.
 */
export const ZOMBIE_URL = assetUrl("zombie.glb");

/** Clip names from zombie.glb (Mixamo export). */
export const zombieAnimationConfig: CharacterAnimationConfig = {
  idle: "walk",
  runForward: "run",
  runBackward: "run",
  strafeLeft: "run",
  strafeRight: "run",
  castPrimary: "attack",
  castMelee: "attack",
  hit: "scream",
  death: "death",
};
