import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Room } from "colyseus.js";
import { Suspense, memo, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { EffectComposer as EffectComposerImpl } from "postprocessing";
import * as THREE from "three";
import { CAMERA, DEFAULT_PLAY_MAP_ID, HUB_GROUND_SIZE, HUB_MAP_ID, isPveRunMode, mapIdForMode } from "@battlebeasts/shared";
import { BaseCityScene } from "./BaseCityScene";
import { ContentScene } from "./ContentScene";
import { PerfOverlay, PerfProbe } from "./PerfHud";
import { SpellLightPool } from "./vfx/spellLights";
import { HubPropShaderWarmup } from "./HubPropShaderWarmup";
import { GpuWarmDummies } from "./GpuWarmDummies";
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
 *
 * @react-three/postprocessing sizes the composer in CSS pixels. With dpr > 1
 * that RT is smaller than the canvas, and the leftover strip is uncleared
 * black — it crawls when the camera look-ahead moves. Half-float bloom mips
 * also NaN into black tiles on mostly-empty sky, which is exactly the
 * extreme-cursor view. Unsigned bytes + a drawing-buffer size lock both.
 */
function PostFX() {
    const composerRef = useRef<EffectComposerImpl>(null);
    const gl = useThree((s) => s.gl);

    useFrame(() => {
        const composer = composerRef.current;
        if (!composer) return;
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const buf = (
            composer as EffectComposerImpl & {
                inputBuffer?: { width: number; height: number };
            }
        ).inputBuffer;
        if (!buf || buf.width !== w || buf.height !== h) {
            composer.setSize(w, h);
        }
    }, 0);

    return (
        <EffectComposer
            ref={composerRef}
            multisampling={0}
            enableNormalPass={false}
            frameBufferType={THREE.UnsignedByteType}
        >
            <Bloom
                luminanceThreshold={0.92}
                luminanceSmoothing={0.35}
                intensity={0.4}
                mipmapBlur
            />
        </EffectComposer>
    );
}

/** Keep the renderer clear colour on the fog/sky so empty samples are never black. */
function SyncClearColor({ color }: { color: string }) {
    const gl = useThree((s) => s.gl);
    const parsed = useMemo(() => new THREE.Color(color), [color]);
    useLayoutEffect(() => {
        gl.setClearColor(parsed, 1);
    }, [gl, parsed]);
    return null;
}

/**
 * Skirt under the authored ground. Extreme cursor pull looks past the map
 * edge; without this those pixels are the composer clear colour (black).
 */
function HorizonFill({ color }: { color: string }) {
    return (
        <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.05, 0]}
            frustumCulled={false}
            renderOrder={-10}
        >
            <planeGeometry args={[2400, 2400]} />
            <meshBasicMaterial color={color} depthWrite={false} />
        </mesh>
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
    const isDungeon = inContent && isPveRunMode(contentMode);
    const isArena = inContent && !isDungeon;
    const mapId = inContent ? (mapIdForMode(contentMode) ?? DEFAULT_PLAY_MAP_ID) : HUB_MAP_ID;
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
            <SyncClearColor color={skyColor} />
            <HorizonFill color={skyColor} />
            {/* Before the warmup, and outside the scenes, so the light count
                materials compile against is the one they run with. */}
            <SpellLightPool />
            <Suspense fallback={null}>
                {/* Inside Suspense so warm runs under remounted hub/content lights. */}
                <VfxWarmup warmKey={isDungeon ? "dungeon" : isArena ? "arena" : "hub"} />
                <GpuWarmDummies includeZombie={isDungeon} />
                <HubPropShaderWarmup mapId={mapId} />
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
