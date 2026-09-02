import { useEffect, useState, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { renderOneShot } from "./catalog";
import { vfxRuntime } from "./runtime";
import type { OneShotEffect } from "./types";
import { PortalLandingTelegraph } from "./effects/portalChannel";
import { CastAimTelegraph } from "./CastAimTelegraph";

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
      {shots.map((shot) => renderOneShot(shot, ctx))}
      {room && localSessionId && predictedRef ? (
        <>
          <CastAimTelegraph
            room={room}
            sessionId={localSessionId}
            getPos={() => ({ x: predictedRef.current.x, z: predictedRef.current.z })}
            getYaw={() => predictedRef.current.yaw}
          />
          <PortalLandingTelegraph
            room={room}
            sessionId={localSessionId}
            getPos={() => ({ x: predictedRef.current.x, z: predictedRef.current.z })}
            getYaw={() => predictedRef.current.yaw}
          />
        </>
      ) : null}
    </>
  );
}
