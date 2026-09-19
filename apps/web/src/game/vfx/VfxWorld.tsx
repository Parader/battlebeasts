import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { renderOneShot } from "./catalog";
import { vfxRuntime } from "./runtime";
import type { OneShotEffect } from "./types";
import { PortalLandingTelegraph } from "./effects/portalChannel";
import { CastAimTelegraph } from "./CastAimTelegraph";
import { disposeVfxHierarchy } from "./vfxDisposal";
import type { VfxRoomLike } from "./vfxRoomLike";

function VfxOneShotContainer({ children }: { children: ReactNode }) {
  const rootRef = useRef<THREE.Group>(null);
  useEffect(() => {
    return () => {
      disposeVfxHierarchy(rootRef.current);
    };
  }, []);
  return <group ref={rootRef}>{children}</group>;
}

type Props = {
  room: VfxRoomLike | null;
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
      {shots.map((shot) => {
        const node = renderOneShot(shot, ctx);
        if (!node) return null;
        return (
          <VfxOneShotContainer key={shot.key}>
            {node}
          </VfxOneShotContainer>
        );
      })}
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
