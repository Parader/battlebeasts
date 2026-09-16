import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { PredictedPose } from "../useBaseCityRoom";
import { useAdminThirdPerson } from "../adminThirdPerson";
import {
  applyThirdPersonLookYaw,
  thirdPersonLookSensitivity,
} from "../thirdPersonInputTest";

type Props = {
  predictedRef: MutableRefObject<PredictedPose>;
  /** Panels / intro — don't steal the pointer. */
  locked?: boolean;
};

/**
 * Admin-only mouse-look harness. Pointer-lock the game canvas; movementX
 * drives yaw. Does not touch combat, prediction, or the isometric path.
 */
export function ThirdPersonLookOverlay({ predictedRef, locked = false }: Props) {
  const thirdPerson = useAdminThirdPerson();
  const yawRef = useRef(0);
  const [lockedOn, setLockedOn] = useState(false);

  useEffect(() => {
    if (!thirdPerson) {
      yawRef.current = predictedRef.current.yaw;
      if (document.pointerLockElement) document.exitPointerLock();
      setLockedOn(false);
      return;
    }
    yawRef.current = predictedRef.current.yaw;
    applyThirdPersonLookYaw(yawRef.current);
  }, [thirdPerson, predictedRef]);

  useEffect(() => {
    if (!thirdPerson || locked) {
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }

    const canvas = () => document.querySelector("canvas");

    const onClick = (e: MouseEvent) => {
      const el = canvas();
      if (!el || e.target !== el) return;
      void el.requestPointerLock();
    };

    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas()) return;
      yawRef.current -= e.movementX * thirdPersonLookSensitivity();
      applyThirdPersonLookYaw(yawRef.current);
    };

    const onLockChange = () => {
      setLockedOn(document.pointerLockElement === canvas());
    };

    document.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, [thirdPerson, locked]);

  if (!thirdPerson) return null;

  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-md bg-black/55 px-3 py-1.5 text-center text-xs text-white/80">
      {lockedOn
        ? "3rd person test — WASD is relative to facing · Esc releases mouse"
        : "3rd person test — click the world to mouse-look"}
    </div>
  );
}
