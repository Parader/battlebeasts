import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Room } from "colyseus.js";
import { Suspense, memo, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import { CAMERA } from "@battlebeasts/shared";
import { BaseCityScene } from "./BaseCityScene";
import { ContentScene } from "./ContentScene";
import type { PredictedPose, SessionPhase } from "./useBaseCityRoom";

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    phase: SessionPhase;
    contentMode: string | null;
    /** Freeze the main WebGL loop (e.g. while a second preview Canvas is open). */
    suspended?: boolean;
};

const pitch = (CAMERA.pitchDeg * Math.PI) / 180;

/**
 * Bloom pipeline sized to the WebGL drawing buffer.
 * Default CSS-pixel composer sizing + dpr mismatch shifts the scene off-center.
 */
function PostFX() {
    const composerRef = useRef<EffectComposerImpl>(null);
    const { gl, size } = useThree();

    useLayoutEffect(() => {
        const composer = composerRef.current;
        if (!composer) return;
        composer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    }, [gl, size.width, size.height]);

    return (
        <EffectComposer ref={composerRef} multisampling={0} enableNormalPass={false}>
            <Bloom
                luminanceThreshold={0.85}
                luminanceSmoothing={0.25}
                intensity={0.55}
                mipmapBlur
            />
        </EffectComposer>
    );
}

export const GameCanvas = memo(function GameCanvas({
    room,
    localSessionId,
    predictedRef,
    phase,
    contentMode,
    /** Freeze the main WebGL loop (e.g. while a second preview Canvas is open). */
    suspended = false,
}: Props) {
    const inContent = phase === "content";

    return (
        <Canvas
            className="h-full w-full touch-none"
            shadows
            dpr={[1, 1.5]}
            frameloop={suspended ? "never" : "always"}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            camera={{
                fov: CAMERA.fov,
                near: 0.1,
                far: 280,
                position: [0, Math.sin(pitch) * CAMERA.distance, Math.cos(pitch) * CAMERA.distance],
            }}
            onPointerMissed={() => undefined}
        >
            <color attach="background" args={[inContent ? "#0a1018" : "#0b1220"]} />
            <fog
                attach="fog"
                args={[
                    inContent ? "#0a1018" : "#0b1220",
                    inContent ? 25 : 55,
                    inContent ? 55 : 160,
                ]}
            />
            <Suspense fallback={null}>
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
                    />
                )}
            </Suspense>
            <PostFX />
        </Canvas>
    );
});
