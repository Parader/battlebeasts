import { useEffect, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { renderOneShot } from "./catalog";
import { vfxRuntime } from "./runtime";
import { VfxWarmup } from "./VfxWarmup";
import type { OneShotEffect } from "./types";

type Props = {
  room: Room | null;
  localSessionId: string | null;
  predictedRef?: MutableRefObject<{ x: number; z: number; yaw: number }>;
};

/** Mounts one-shot cast/impact effects from the imperative VFX bus. */
export function VfxWorld({ room, localSessionId, predictedRef }: Props) {
  const [shots, setShots] = useState<readonly OneShotEffect[]>(() => vfxRuntime.getShots());

  useEffect(() => {
    return vfxRuntime.subscribe(() => {
      setShots(vfxRuntime.getShots().slice());
    });
  }, []);

  useFrame(() => {
    vfxRuntime.prune();
  });

  const ctx = { room, localSessionId, predictedRef };

  return (
    <>
      <VfxWarmup />
      {shots.map((shot) => renderOneShot(shot, ctx))}
    </>
  );
}
