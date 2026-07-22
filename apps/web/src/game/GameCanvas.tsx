import { Canvas } from "@react-three/fiber";
import { Room } from "colyseus.js";
import type { MutableRefObject } from "react";
import { CAMERA } from "@battlebeasts/shared";
import { BaseCityScene } from "./BaseCityScene";
import { ContentScene } from "./ContentScene";
import type { PredictedPose, SessionPhase } from "./useBaseCityRoom";

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    onInteract: (id: string) => void;
    phase: SessionPhase;
    contentMode: string | null;
};

const pitch = (CAMERA.pitchDeg * Math.PI) / 180;

export function GameCanvas({
    room,
    localSessionId,
    predictedRef,
    onInteract,
    phase,
    contentMode,
}: Props) {
    const inContent = phase === "content";

    return (
        <Canvas
            className="h-full w-full touch-none"
            shadows
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            camera={{
                fov: CAMERA.fov,
                near: 0.1,
                far: 200,
                position: [0, Math.sin(pitch) * CAMERA.distance, Math.cos(pitch) * CAMERA.distance],
            }}
            onPointerMissed={() => undefined}
        >
            <color attach="background" args={[inContent ? "#0a1018" : "#0b1220"]} />
            <fog attach="fog" args={[inContent ? "#0a1018" : "#0b1220", 25, 55]} />
            {inContent ? (
                <ContentScene
                    room={room}
                    localSessionId={localSessionId}
                    predictedRef={predictedRef}
                    modeLabel={contentMode ?? "content"}
                />
            ) : (
                <BaseCityScene
                    room={room}
                    localSessionId={localSessionId}
                    predictedRef={predictedRef}
                    onInteract={onInteract}
                />
            )}
        </Canvas>
    );
}
