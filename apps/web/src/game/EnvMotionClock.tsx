import { useFrame } from "@react-three/fiber";
import { tickEnvMotion } from "./environmentMotion";

/** Advances the shared clock used by water, fire, cloth, and foliage. */
export function EnvMotionClock() {
  useFrame((_, dt) => tickEnvMotion(Math.min(0.05, dt)));
  return null;
}
