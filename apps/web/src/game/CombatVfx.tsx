import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useRef, useState } from "react";
import * as THREE from "three";
import { abilityVfxColor, BoltProjectileEffect, hasCatalogProjectile } from "./vfx";

function LegacyProjectileMesh({ room, id }: { room: Room; id: string }) {
    const mesh = useRef<THREE.Mesh>(null);
    const color = useRef("#38bdf8");
    const renderPos = useRef(new THREE.Vector3());
    const lastServer = useRef({ x: 0, z: 0, vx: 0, vz: 0 });
    const seeded = useRef(false);

    useFrame((_, dt) => {
        const p = room.state?.projectiles?.get(id) as
            | { x: number; z: number; vx?: number; vz?: number; abilityId?: string }
            | undefined;
        const m = mesh.current;
        if (!p || !m) {
            if (m) m.visible = false;
            seeded.current = false;
            return;
        }
        m.visible = true;

        const vx = p.vx ?? 0;
        const vz = p.vz ?? 0;
        const safeDt = Math.min(0.05, Math.max(0, dt));

        if (!seeded.current) {
            renderPos.current.set(p.x, 0.6, p.z);
            lastServer.current = { x: p.x, z: p.z, vx, vz };
            seeded.current = true;
        } else {
            renderPos.current.x += vx * safeDt;
            renderPos.current.z += vz * safeDt;

            const serverMoved =
                p.x !== lastServer.current.x ||
                p.z !== lastServer.current.z ||
                vx !== lastServer.current.vx ||
                vz !== lastServer.current.vz;

            if (serverMoved) {
                lastServer.current = { x: p.x, z: p.z, vx, vz };
                const err = Math.hypot(renderPos.current.x - p.x, renderPos.current.z - p.z);
                if (err > 1.25) {
                    renderPos.current.x = p.x;
                    renderPos.current.z = p.z;
                } else {
                    const blend = 1 - Math.exp(-14 * safeDt);
                    renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, p.x, blend);
                    renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, p.z, blend);
                }
            }
        }

        m.position.copy(renderPos.current);

        const next = abilityVfxColor(p.abilityId ?? "", "#38bdf8");
        if (next !== color.current) {
            color.current = next;
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.color.set(next);
            mat.emissive.set(next);
        }
    });

    return (
        <mesh ref={mesh}>
            <sphereGeometry args={[0.22, 12, 12]} />
            <meshStandardMaterial color={color.current} emissive={color.current} emissiveIntensity={0.8} />
        </mesh>
    );
}

function ProjectileRouter({ room, id }: { room: Room; id: string }) {
    const abilityId = (room.state?.projectiles?.get(id) as { abilityId?: string } | undefined)
        ?.abilityId;
    if (hasCatalogProjectile(abilityId)) {
        return <BoltProjectileEffect room={room} id={id} />;
    }
    return <LegacyProjectileMesh room={room} id={id} />;
}

export function Projectiles({ room }: { room: Room | null }) {
    const [ids, setIds] = useState<string[]>([]);
    const keyRef = useRef("");

    useFrame(() => {
        if (!room?.state?.projectiles) return;
        const next: string[] = [];
        room.state.projectiles.forEach((_p: unknown, id: string) => next.push(id));
        next.sort();
        const key = next.join("|");
        if (key !== keyRef.current) {
            keyRef.current = key;
            setIds(next);
        }
    });

    if (!room) return null;
    return (
        <>
            {ids.map((id) => (
                <ProjectileRouter key={id} room={room} id={id} />
            ))}
        </>
    );
}

export type FxBurst = {
    key: number;
    kind: "aoe" | "melee" | "dash" | "hit";
    x: number;
    z: number;
    radius: number;
    born: number;
    life: number;
    color: string;
};

function FxRing({ burst }: { burst: FxBurst }) {
    const mesh = useRef<THREE.Mesh>(null);
    const mat = useRef<THREE.MeshBasicMaterial>(null);

    useFrame(() => {
        const m = mesh.current;
        const material = mat.current;
        if (!m || !material) return;
        const age = (performance.now() - burst.born) / burst.life;
        if (age >= 1) {
            m.visible = false;
            return;
        }
        m.visible = true;
        const scale = burst.kind === "hit" ? 0.4 + age * 0.6 : 1 + age * 0.35;
        m.scale.setScalar(scale);
        material.opacity = (1 - age) * 0.85;
    });

    return (
        <mesh ref={mesh} position={[burst.x, 0.05, burst.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[Math.max(0.2, burst.radius * 0.55), burst.radius, 32]} />
            <meshBasicMaterial ref={mat} color={burst.color} transparent opacity={0.85} depthWrite={false} />
        </mesh>
    );
}

export function CombatFxMeshes({ bursts }: { bursts: FxBurst[] }) {
    return (
        <>
            {bursts.map((b) => (
                <FxRing key={b.key} burst={b} />
            ))}
        </>
    );
}

export function WorldTargets({ room }: { room: Room | null }) {
    const group = useRef<THREE.Group>(null);
    const hpMat = useRef<THREE.MeshStandardMaterial>(null);

    useFrame(() => {
        const t = room?.state?.targets?.get("practice_dummy") as
            | { x: number; z: number; hp: number; maxHp: number }
            | undefined;
        const g = group.current;
        if (!g) return;
        if (!t) {
            g.visible = false;
            return;
        }
        g.visible = true;
        g.position.set(t.x, 0, t.z);
        if (hpMat.current) {
            const ratio = t.maxHp > 0 ? t.hp / t.maxHp : 0;
            hpMat.current.color.set(ratio > 0.4 ? "#78716c" : "#ef4444");
        }
    });

    return (
        <group ref={group}>
            <mesh position={[0, 1, 0]} castShadow>
                <cylinderGeometry args={[0.45, 0.55, 2, 12]} />
                <meshStandardMaterial ref={hpMat} color="#78716c" />
            </mesh>
            <HpBillboard room={room} targetId="practice_dummy" y={2.3} />
        </group>
    );
}

function HpBillboard({
    room,
    targetId,
    y,
}: {
    room: Room | null;
    targetId: string;
    y: number;
}) {
    const fill = useRef<THREE.Mesh>(null);
    useFrame(() => {
        const t = room?.state?.targets?.get(targetId) as { hp: number; maxHp: number } | undefined;
        const m = fill.current;
        if (!m || !t) return;
        const ratio = Math.max(0, Math.min(1, t.hp / Math.max(1, t.maxHp)));
        m.scale.x = Math.max(0.001, ratio);
        m.position.x = -0.5 * (1 - ratio);
    });
    return (
        <group position={[0, y, 0]}>
            <mesh>
                <planeGeometry args={[1, 0.12]} />
                <meshBasicMaterial color="#111827" />
            </mesh>
            <mesh ref={fill} position={[0, 0, 0.01]}>
                <planeGeometry args={[1, 0.1]} />
                <meshBasicMaterial color="#4ade80" />
            </mesh>
        </group>
    );
}
