import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useRef, useState } from "react";
import * as THREE from "three";

function RemotePlayerMesh({ room, sessionId }: { room: Room; sessionId: string }) {
    const group = useRef<THREE.Group>(null);
    const renderPos = useRef(new THREE.Vector3());
    const renderYaw = useRef(0);
    const vel = useRef({ x: 0, z: 0 });
    const lastServer = useRef({ x: 0, z: 0, t: 0 });
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
            seeded.current = false;
            return;
        }
        g.visible = true;
        const now = performance.now();
        const safeDt = Math.min(0.05, Math.max(0, dt));

        if (!seeded.current) {
            renderPos.current.set(p.x, 0, p.z);
            renderYaw.current = p.yaw;
            lastServer.current = { x: p.x, z: p.z, t: now };
            vel.current = { x: 0, z: 0 };
            seeded.current = true;
        }

        if (p.color && p.color !== colorRef.current) {
            colorRef.current = p.color;
            if (matRef.current) matRef.current.color.set(p.color);
        }

        const serverMoved = p.x !== lastServer.current.x || p.z !== lastServer.current.z;
        if (serverMoved) {
            const elapsed = Math.max(0.016, (now - lastServer.current.t) / 1000);
            vel.current.x = (p.x - lastServer.current.x) / elapsed;
            vel.current.z = (p.z - lastServer.current.z) / elapsed;
            lastServer.current = { x: p.x, z: p.z, t: now };
        }

        // Dead-reckon between patches, then soft-correct to authority
        renderPos.current.x += vel.current.x * safeDt;
        renderPos.current.z += vel.current.z * safeDt;
        const blend = 1 - Math.exp(-18 * safeDt);
        renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend * 0.85);
        renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend * 0.85);
        renderYaw.current = THREE.MathUtils.lerp(renderYaw.current, p.yaw, blend);

        const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
        if (err > 2.5) {
            renderPos.current.set(p.x, 0, p.z);
            vel.current = { x: 0, z: 0 };
        }

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

export function RemotePlayers({ room, localSessionId }: { room: Room | null; localSessionId: string | null }) {
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
