import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
    BASE_CITY_PORTALS,
    BASE_CITY_STANDS,
    CAMERA,
    HUB_GROUND_SIZE,
    HUB_MAP_PROPS,
    PORTAL_TORUS_MAJOR,
    PORTAL_TORUS_TUBE,
    PRACTICE_DUMMY,
    STAND_INTERACT_RADIUS,
} from "@battlebeasts/shared";
import { FixedFollowCamera } from "./FixedFollowCamera";
import { RemotePlayers } from "./RemotePlayers";
import { CharacterAvatar } from "./CharacterAvatar";
import { CombatFxMeshes, Projectiles, WorldTargets, type FxBurst } from "./CombatVfx";
import { SpellVfxBridge, VfxWorld } from "./vfx";
import { TexturedGround } from "./TexturedGround";
import { FollowSun } from "./FollowSun";
import { HubProp, hubAssetUrl } from "./FantasyProp";
import { CollisionDebugOverlay } from "./CollisionDebugOverlay";
import { PlacementHelper } from "./PlacementHelper";
import { useGLTF } from "@react-three/drei";
import type { PredictedPose } from "./useBaseCityRoom";

// Preload every unique village asset once
for (const file of new Set(HUB_MAP_PROPS.map((p) => p.file))) {
    useGLTF.preload(hubAssetUrl(file));
}

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    onInteract: (id: string) => void;
    fxBursts: FxBurst[];
};

function PortalMarker({ x, z, color }: { x: number; z: number; color: string }) {
    return (
        <group position={[x, 0, z]}>
            <mesh position={[0, PORTAL_TORUS_MAJOR * 0.85, 0]} castShadow>
                <torusGeometry args={[PORTAL_TORUS_MAJOR, PORTAL_TORUS_TUBE, 12, 32]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <circleGeometry args={[PORTAL_TORUS_MAJOR * 1.15, 32]} />
                <meshStandardMaterial color={color} transparent opacity={0.28} />
            </mesh>
        </group>
    );
}

/** Soft pale ground discs for interact kinds. */
const STAND_MARKER_COLOR: Record<string, string> = {
    shop: "#f5e6b8",
    build: "#c5d8f0",
    customization: "#edd0e0",
    talent: "#d9d0f0",
};

/** Ground-only interact zone — pale disc, no floating markers. */
function InteractSpot({ x, z, color }: { x: number; z: number; color: string }) {
    const r = STAND_INTERACT_RADIUS * 0.92;
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, z]} receiveShadow={false}>
            <circleGeometry args={[r, 48]} />
            <meshBasicMaterial
                color={color}
                transparent
                opacity={0.32}
                depthWrite={false}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

function LocalPlayerMesh({
    predictedRef,
    room,
    localSessionId,
    color,
}: {
    predictedRef: MutableRefObject<PredictedPose>;
    room: Room | null;
    localSessionId: string | null;
    color: string;
}) {
    return (
        <CharacterAvatar
            predictedRef={predictedRef}
            room={room}
            localSessionId={localSessionId}
            color={color}
        />
    );
}

export function BaseCityScene({ room, localSessionId, predictedRef, onInteract, fxBursts }: Props) {
    const localPos = useRef(new THREE.Vector3(0, 0, 0));
    const aimNdc = useRef(new THREE.Vector2(0, 0));
    const { camera, gl } = useThree();
    const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const hit = useMemo(() => new THREE.Vector3(), []);
    const localColor = (localSessionId && room?.state?.players?.get(localSessionId)?.color) || "#4ade80";

    useFrame(() => {
        const p = predictedRef.current;
        localPos.current.set(p.x, 0, p.z);
    });

    useEffect(() => {
        const el = gl.domElement;
        const onMove = (e: PointerEvent) => {
            const rect = el.getBoundingClientRect();
            const ndc = aimNdc.current;
            ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(ndc, camera);
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                const origin = predictedRef.current;
                const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
                (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw?.(yaw);
            }
        };
        el.addEventListener("pointermove", onMove);
        return () => el.removeEventListener("pointermove", onMove);
    }, [camera, gl, groundPlane, hit, predictedRef, raycaster]);

    useEffect(() => {
        const handler = () => {
            const me = predictedRef.current;
            const targets: Array<{ id: string; x: number; z: number; radius: number }> = [
                ...BASE_CITY_STANDS.map((s) => ({
                    id: s.id,
                    x: s.x,
                    z: s.z,
                    radius: STAND_INTERACT_RADIUS,
                })),
                ...BASE_CITY_PORTALS.map((p) => ({
                    id: p.id,
                    x: p.x,
                    z: p.z,
                    radius: PORTAL_TORUS_MAJOR * 0.85,
                })),
                { id: "practice_dummy", x: PRACTICE_DUMMY.x, z: PRACTICE_DUMMY.z, radius: 2.2 },
            ];
            let best: { id: string; d: number } | null = null;
            for (const t of targets) {
                const d = Math.hypot(me.x - t.x, me.z - t.z);
                if (d <= t.radius && (!best || d < best.d)) best = { id: t.id, d };
            }
            if (best) onInteract(best.id);
        };
        window.addEventListener("bb-interact", handler);
        return () => window.removeEventListener("bb-interact", handler);
    }, [onInteract, predictedRef]);

    return (
        <>
            <ambientLight intensity={0.55} />
            <FollowSun follow={localPos} intensity={1.2} />
            <TexturedGround size={HUB_GROUND_SIZE} />

            {HUB_MAP_PROPS.map((prop) => (
                <HubProp key={prop.id} prop={prop} />
            ))}

            <CollisionDebugOverlay />
            <PlacementHelper />

            {BASE_CITY_STANDS.map((s) => (
                <InteractSpot
                    key={s.id}
                    x={s.x}
                    z={s.z}
                    color={STAND_MARKER_COLOR[s.kind] ?? "#94a3b8"}
                />
            ))}

            {BASE_CITY_PORTALS.map((p) => (
                <PortalMarker key={p.id} x={p.x} z={p.z} color={p.kind === "pvp" ? "#ef4444" : "#22c55e"} />
            ))}

            <WorldTargets room={room} />

            <LocalPlayerMesh
                predictedRef={predictedRef}
                room={room}
                localSessionId={localSessionId}
                color={localColor}
            />
            <RemotePlayers room={room} localSessionId={localSessionId} />
            <Projectiles room={room} />
            <CombatFxMeshes bursts={fxBursts} />
            <VfxWorld
                room={room}
                localSessionId={localSessionId}
                predictedRef={predictedRef}
            />
            <SpellVfxBridge room={room} />
            <FixedFollowCamera
                target={localPos}
                pitchDeg={CAMERA.pitchDeg}
                distance={CAMERA.distance}
                fov={CAMERA.fov}
                followLambda={CAMERA.followLambda}
                cursorLambda={CAMERA.cursorLambda}
                cursorInfluence={CAMERA.cursorInfluence}
            />
        </>
    );
}
