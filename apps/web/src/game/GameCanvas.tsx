import { Canvas } from "@react-three/fiber";
import { Room } from "colyseus.js";
import type { MutableRefObject } from "react";
import { BaseCityScene } from "./BaseCityScene";
import type { PredictedPose } from "./useBaseCityRoom";

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    onInteract: (id: string) => void;
};

export function GameCanvas({ room, localSessionId, predictedRef, onInteract }: Props) {
    return (
        <Canvas
            className="h-full w-full touch-none"
            shadows
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            onPointerMissed={() => undefined}
        >
            <color attach="background" args={["#0b1220"]} />
            <fog attach="fog" args={["#0b1220", 25, 55]} />
            <BaseCityScene
                room={room}
                localSessionId={localSessionId}
                predictedRef={predictedRef}
                onInteract={onInteract}
            />
        </Canvas>
    );
}
