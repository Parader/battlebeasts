import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
    BASE_CITY_PORTALS,
    BASE_CITY_STANDS,
    CAMERA,
    PRACTICE_DUMMY,
} from "@battlebeasts/shared";
import { FixedFollowCamera } from "./FixedFollowCamera";
import type { PredictedPose } from "./useBaseCityRoom";

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    onInteract: (id: string) => void;
};

function Ground() {
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[60, 60]} />
            <meshStandardMaterial color="#1e293b" />
        </mesh>
    );
}

function StandMarker({ x, z, color }: { x: number; z: number; color: string }) {
    return (
        <group position={[x, 0, z]}>
            <mesh position={[0, 0.75, 0]} castShadow>
                <boxGeometry args={[1.4, 1.5, 1.4]} />
                <meshStandardMaterial color={color} />
            </mesh>
        </group>
    );
}

function PortalMarker({ x, z, color }: { x: number; z: number; color: string }) {
    return (
        <group position={[x, 0, z]}>
            <mesh position={[0, 1.2, 0]} castShadow>
                <torusGeometry args={[1.1, 0.12, 12, 32]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <circleGeometry args={[1.2, 32]} />
                <meshStandardMaterial color={color} transparent opacity={0.35} />
            </mesh>
        </group>
    );
}

function LocalPlayerMesh({
    predictedRef,
    color,
}: {
    predictedRef: MutableRefObject<PredictedPose>;
    color: string;
}) {
    const group = useRef<THREE.Group>(null);

    useFrame(() => {
        const g = group.current;
        if (!g) return;
        const p = predictedRef.current;
        g.position.set(p.x, 0, p.z);
        g.rotation.y = p.yaw;
    });

    return (
        <group ref={group}>
            <mesh position={[0, 0.7, 0]} castShadow>
                <capsuleGeometry args={[0.35, 0.7, 4, 8]} />
                <meshStandardMaterial color={color} />
            </mesh>
            <mesh position={[0, 0.85, 0.35]}>
                <boxGeometry args={[0.25, 0.15, 0.35]} />
                <meshStandardMaterial color="#fef08a" />
            </mesh>
        </group>
    );
}

function RemotePlayerMesh({ room, sessionId }: { room: Room; sessionId: string }) {
    const group = useRef<THREE.Group>(null);
    const renderPos = useRef(new THREE.Vector3());
    const renderYaw = useRef(0);
    const colorRef = useRef("#60a5fa");
    const matRef = useRef<THREE.MeshStandardMaterial>(null);
    const seeded = useRef(false);

    useFrame((_, dt) => {
        const p = room.state?.players?.get(sessionId) as
            | { x: number; z: number; yaw: number; color: string; disconnected?: boolean }
            | undefined;
        const g = group.current;
        if (!p || !g || p.disconnected) {
            if (g) g.visible = false;
            return;
        }
        g.visible = true;
        if (!seeded.current) {
            renderPos.current.set(p.x, 0, p.z);
            renderYaw.current = p.yaw;
            seeded.current = true;
        }
        if (p.color && p.color !== colorRef.current) {
            colorRef.current = p.color;
            if (matRef.current) matRef.current.color.set(p.color);
        }

        const alpha = 1 - Math.exp(-16 * dt);
        renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, alpha);
        renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, alpha);
        renderYaw.current = THREE.MathUtils.lerp(renderYaw.current, p.yaw, alpha);
        g.position.set(renderPos.current.x, 0, renderPos.current.z);
        g.rotation.y = renderYaw.current;
    });

    return (
        <group ref={group}>
            <mesh position={[0, 0.7, 0]} castShadow>
                <capsuleGeometry args={[0.35, 0.7, 4, 8]} />
                <meshStandardMaterial ref={matRef} color={colorRef.current} />
            </mesh>
            <mesh position={[0, 0.85, 0.35]}>
                <boxGeometry args={[0.25, 0.15, 0.35]} />
                <meshStandardMaterial color="#94a3b8" />
            </mesh>
        </group>
    );
}

function RemotePlayers({ room, localSessionId }: { room: Room | null; localSessionId: string | null }) {
    const [remoteIds, setRemoteIds] = useState<string[]>([]);
    const prevKey = useRef("");

    useFrame(() => {
        if (!room?.state?.players) return;
        const next: string[] = [];
        room.state.players.forEach((_p: unknown, id: string) => {
            if (id !== localSessionId) next.push(id);
        });
        next.sort();
        const key = next.join("|");
        if (key !== prevKey.current) {
            prevKey.current = key;
            setRemoteIds(next);
        }
    });

    if (!room) return null;

    return (
        <>
            {remoteIds.map((id) => (
                <RemotePlayerMesh key={id} room={room} sessionId={id} />
            ))}
        </>
    );
}

export function BaseCityScene({ room, localSessionId, predictedRef, onInteract }: Props) {
    const localPos = useRef(new THREE.Vector3(0, 0, 0));
    const { camera, gl } = useThree();
    const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const pointer = useMemo(() => new THREE.Vector2(), []);
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
            pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointer, camera);
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                const origin = predictedRef.current;
                const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
                (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw?.(yaw);
            }
        };
        el.addEventListener("pointermove", onMove);
        return () => el.removeEventListener("pointermove", onMove);
    }, [camera, gl, groundPlane, hit, pointer, predictedRef, raycaster]);

    useEffect(() => {
        const handler = () => {
            const me = predictedRef.current;
            const targets = [
                ...BASE_CITY_STANDS.map((s) => ({ id: s.id, x: s.x, z: s.z })),
                ...BASE_CITY_PORTALS.map((p) => ({ id: p.id, x: p.x, z: p.z })),
                { id: "practice_dummy", x: PRACTICE_DUMMY.x, z: PRACTICE_DUMMY.z },
            ];
            let best: { id: string; d: number } | null = null;
            for (const t of targets) {
                const d = Math.hypot(me.x - t.x, me.z - t.z);
                if (d <= 2.5 && (!best || d < best.d)) best = { id: t.id, d };
            }
            if (best) onInteract(best.id);
        };
        window.addEventListener("bb-interact", handler);
        return () => window.removeEventListener("bb-interact", handler);
    }, [onInteract, predictedRef]);

    return (
        <>
            <ambientLight intensity={0.55} />
            <directionalLight castShadow position={[12, 18, 8]} intensity={1.2} />
            <Ground />
            <gridHelper args={[60, 60, "#334155", "#1e293b"]} position={[0, 0.01, 0]} />

            {BASE_CITY_STANDS.map((s) => (
                <StandMarker
                    key={s.id}
                    x={s.x}
                    z={s.z}
                    color={
                        s.kind === "shop"
                            ? "#f59e0b"
                            : s.kind === "build"
                              ? "#38bdf8"
                              : s.kind === "talent"
                                ? "#a78bfa"
                                : "#fb7185"
                    }
                />
            ))}

            {BASE_CITY_PORTALS.map((p) => (
                <PortalMarker key={p.id} x={p.x} z={p.z} color={p.kind === "pvp" ? "#ef4444" : "#22c55e"} />
            ))}

            <group position={[PRACTICE_DUMMY.x, 0, PRACTICE_DUMMY.z]}>
                <mesh position={[0, 1, 0]} castShadow>
                    <cylinderGeometry args={[0.45, 0.55, 2, 12]} />
                    <meshStandardMaterial color="#78716c" />
                </mesh>
            </group>

            <LocalPlayerMesh predictedRef={predictedRef} color={localColor} />
            <RemotePlayers room={room} localSessionId={localSessionId} />
            <FixedFollowCamera target={localPos} pitchDeg={CAMERA.pitchDeg} distance={CAMERA.distance} />
        </>
    );
}
