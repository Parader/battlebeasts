import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Room } from "colyseus.js";
import { Suspense, memo, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import { CAMERA, HUB_GROUND_SIZE } from "@battlebeasts/shared";
import { BaseCityScene } from "./BaseCityScene";
import { ContentScene } from "./ContentScene";
import { PerfOverlay, PerfProbe } from "./PerfHud";
import { SpellLightPool } from "./vfx/spellLights";
import { HubPropShaderWarmup } from "./HubPropShaderWarmup";
import { VfxWarmup } from "./vfx";
import type { PredictedPose, SessionPhase } from "./useBaseCityRoom";

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    phase: SessionPhase;
    contentMode: string | null;
    /** Freeze the main WebGL loop (e.g. while a second preview Canvas is open). */
    suspended?: boolean;
    /** Camera-only death spectate target (content). */
    spectateTargetId?: string | null;
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
                luminanceThreshold={0.92}
                luminanceSmoothing={0.35}
                intensity={0.4}
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
    spectateTargetId = null,
}: Props) {
    const inContent = phase === "content";
    const isDungeon = inContent && contentMode === "dungeon";
    const isArena = inContent && !isDungeon;
    // Hub: cool night. Arena: warm sand haze so albedo isn't crushed to mud. Dungeon: dark.
    const skyColor = isDungeon ? "#0a1018" : isArena ? "#b59a6a" : "#0b1220";
    const fogNear = isDungeon ? 28 : isArena ? 42 : 55;
    const fogFar = isDungeon ? 62 : isArena ? 130 : Math.min(HUB_GROUND_SIZE * 0.65, 240);
    const cameraFar = isDungeon || isArena ? 280 : 420;

    return (
        <>
        <PerfOverlay />
        <Canvas
            className="h-full w-full touch-none"
            shadows
            dpr={[1, 1.5]}
            frameloop={suspended ? "never" : "always"}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            camera={{
                fov: CAMERA.fov,
                near: 0.1,
                far: cameraFar,
                position: [0, Math.sin(pitch) * CAMERA.distance, Math.cos(pitch) * CAMERA.distance],
            }}
            onPointerMissed={() => undefined}
        >
            <color attach="background" args={[skyColor]} />
            <fog attach="fog" args={[skyColor, fogNear, fogFar]} />
            {/* Before the warmup, and outside the scenes, so the light count
                materials compile against is the one they run with. */}
            <SpellLightPool />
            <Suspense fallback={null}>
                {/* Inside Suspense so warm runs under remounted hub/content lights. */}
                <VfxWarmup warmKey={isDungeon ? "dungeon" : isArena ? "arena" : "hub"} />
                {!inContent ? <HubPropShaderWarmup /> : null}
                {inContent ? (
                    <ContentScene
                        room={room}
                        localSessionId={localSessionId}
                        predictedRef={predictedRef}
                        modeLabel={contentMode ?? "content"}
                        spectateTargetId={spectateTargetId}
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
            {/* Last child so its sampler reads a fully built frame. */}
            <PerfProbe />
        </Canvas>
        </>
    );
});
