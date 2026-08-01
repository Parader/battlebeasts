import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import {
  HUB_INTRO_FACE_DIST,
  HUB_INTRO_LOOK_Y,
  HUB_INTRO_ORBIT_BIAS,
} from "./hubIntroScript";
import { getHubIntroSnapshot } from "./hubIntroRuntime";

type Pose = { x: number; z: number; yaw: number };

type Props = {
  predictedRef: MutableRefObject<Pose>;
};

/**
 * Face-character cinematic cam while intro plays.
 * Gameplay cam takes over under a black fade (no mid-air lerp).
 *
 * Uses live predicted yaw (House pose from hub_intro_posed / beginHubIntroPose)
 * so we never lock a stale spawn facing.
 */
export function HubIntroCamera({ predictedRef }: Props) {
  const { camera } = useThree();
  const tmpPos = useRef(new THREE.Vector3());
  const tmpLook = useRef(new THREE.Vector3());

  useFrame(() => {
    const snap = getHubIntroSnapshot();
    // Own the camera only while follow is disabled (playing + fade-to-black).
    if (snap.followCameraEnabled) return;
    if (snap.phase !== "playing" && snap.phase !== "handingOff") return;

    const p = predictedRef.current;
    // Place cam in front of character facing (+ small aesthetic bias).
    const orbitYaw = p.yaw + HUB_INTRO_ORBIT_BIAS;
    const fx = Math.sin(orbitYaw);
    const fz = Math.cos(orbitYaw);
    camera.position.copy(
      tmpPos.current.set(
        p.x + fx * HUB_INTRO_FACE_DIST,
        HUB_INTRO_LOOK_Y + 0.35,
        p.z + fz * HUB_INTRO_FACE_DIST,
      ),
    );
    camera.lookAt(tmpLook.current.set(p.x, HUB_INTRO_LOOK_Y, p.z));
  });

  return null;
}
