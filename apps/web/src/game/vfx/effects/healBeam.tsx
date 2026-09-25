import { useEffect, useMemo, useRef } from "react";
import { coneRayMaxLength, isPveInstanceMobKind } from "@battlebeasts/shared";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getWorldProjectileBoxes, getWorldProjectileCircles, getWorldProjectileWalls } from "../../worldCollidersRuntime";
import type { VfxFollowContext } from "../catalog";
import { smooth01, softEnvelope } from "../easing";
import { type ElementHandle, burstElementRole, spawnElementRole } from "../engine";
import type { OneShotEffect } from "../types";

const BEAM_COLOR = "#6ee7b7";
const BEAM_HOT = "#a7f3d0";
const HAND_Y = 1.15;
const SPAWN = 0.55;
const SELF_BEAM_LEN = 1.55;

type OccludeBody = {
    id: string;
    x: number;
    z: number;
    hp?: number;
    vulnerable?: boolean;
};

function collectOccludeBodies(follow: VfxFollowContext | undefined, ownerId: string | undefined, excludeId?: string | null): OccludeBody[] {
    const room = follow?.room;
    if (!room?.state) return [];
    const out: OccludeBody[] = [];
    const players = room.state.players as Map<string, { x?: number; z?: number; hp?: number }> | undefined;
    players?.forEach((p, id) => {
        if (ownerId && id === ownerId) return;
        if (excludeId && id === excludeId) return;
        out.push({ id, x: p.x ?? 0, z: p.z ?? 0, hp: p.hp });
    });
    const targets = room.state.targets as Map<string, { x?: number; z?: number; hp?: number; kind?: string }> | undefined;
    targets?.forEach((t, id) => {
        if (excludeId && id === excludeId) return;
        if (isPveInstanceMobKind(t.kind)) return;
        out.push({ id, x: t.x ?? 0, z: t.z ?? 0, hp: t.hp });
    });
    return out;
}

function readBodyXZ(follow: VfxFollowContext | undefined, id: string | undefined): { x: number; z: number } | null {
    if (!id || !follow?.room?.state) return null;
    const p = follow.room.state.players?.get(id) as { x?: number; z?: number } | undefined;
    if (p) return { x: p.x ?? 0, z: p.z ?? 0 };
    const t = follow.room.state.targets?.get(id) as { x?: number; z?: number } | undefined;
    if (t) return { x: t.x ?? 0, z: t.z ?? 0 };
    return null;
}

/**
 * Divine Beam — mesh channel with ParticleWorld leaves and holy glints.
 */
export function HealBeamEffect({ shot, follow }: { shot: OneShotEffect; follow?: VfxFollowContext }) {
    const root = useRef<THREE.Group>(null);
    const core = useRef<THREE.Mesh>(null);
    const glow = useRef<THREE.Mesh>(null);
    const pose = useRef({ x: shot.x, z: shot.z, yaw: shot.yaw });
    const liveLen = useRef(shot.radius ?? 14);
    const done = useRef(false);
    const lifeMs = useRef(Math.max(200, shot.life));
    const healTrail = useRef<ElementHandle | null>(null);
    const holyTrail = useRef<ElementHandle | null>(null);
    const impactFired = useRef(false);

    const endLength = shot.radius ?? 14;

    const coreMat = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: BEAM_HOT,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                toneMapped: false,
                blending: THREE.AdditiveBlending,
            }),
        [],
    );
    const glowMat = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: BEAM_COLOR,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                toneMapped: false,
                blending: THREE.AdditiveBlending,
            }),
        [],
    );

    useEffect(() => {
        healTrail.current = spawnElementRole("heal", "trail", shot.x, HAND_Y, shot.z);
        holyTrail.current = spawnElementRole("holy", "trail", shot.x, HAND_Y, shot.z);
        return () => {
            healTrail.current?.kill();
            holyTrail.current?.kill();
            healTrail.current = null;
            holyTrail.current = null;
        };
    }, [shot.key, shot.x, shot.z]);

    useFrame(() => {
        if (done.current) return;

        const ageMs = performance.now() - shot.born;
        const life = lifeMs.current;
        const t = ageMs / life;
        const fade = softEnvelope(t, 0.06, 0.88);

        if (fade <= 0.01 || t >= 1) {
            done.current = true;
            coreMat.opacity = 0;
            glowMat.opacity = 0;
            if (root.current) root.current.visible = false;
            healTrail.current?.setRateScale(0);
            holyTrail.current?.setRateScale(0);
            shot.life = Math.min(shot.life, ageMs);
            return;
        }

        if (shot.followOwnerId) {
            const local = follow?.localSessionId && shot.followOwnerId === follow.localSessionId && follow.predictedRef ? follow.predictedRef.current : null;
            if (local) {
                pose.current.x = local.x;
                pose.current.z = local.z;
                pose.current.yaw = local.yaw;
            } else {
                const p = follow?.room?.state?.players?.get(shot.followOwnerId) as { x?: number; z?: number; yaw?: number } | undefined;
                if (p) {
                    pose.current.x = p.x ?? pose.current.x;
                    pose.current.z = p.z ?? pose.current.z;
                    pose.current.yaw = p.yaw ?? pose.current.yaw;
                }
            }
        }

        const targetId = shot.followTargetId ?? shot.targetId;
        const targetPose = targetId && targetId !== shot.followOwnerId ? readBodyXZ(follow, targetId) : null;
        const aimX = targetPose?.x ?? (typeof shot.originX === "number" && Number.isFinite(shot.originX) ? shot.originX : pose.current.x);
        const aimZ = targetPose?.z ?? (typeof shot.originZ === "number" && Number.isFinite(shot.originZ) ? shot.originZ : pose.current.z);
        const dx = aimX - pose.current.x;
        const dz = aimZ - pose.current.z;
        const dist = Math.hypot(dx, dz);
        const targeting = dist > 0.35;
        const rayYaw = targeting ? Math.atan2(dx, dz) : pose.current.yaw;
        const wantLen = targeting ? Math.min(dist, endLength) : SELF_BEAM_LEN;
        const excludeId = targeting ? (targetId ?? null) : null;

        const bodies = collectOccludeBodies(follow, shot.followOwnerId, excludeId);
        const walls = getWorldProjectileWalls();
        const maxLen = coneRayMaxLength(
            { x: pose.current.x, z: pose.current.z },
            rayYaw,
            Math.max(wantLen, SPAWN + 0.4),
            walls,
            bodies,
            shot.followOwnerId ?? "",
            {
                circles: getWorldProjectileCircles(),
                boxes: getWorldProjectileBoxes(),
                excludeId,
            },
        );
        const grow = smooth01(Math.min(1, ageMs / Math.max(80, shot.growMs ?? 140)));
        liveLen.current = THREE.MathUtils.lerp(SPAWN, Math.max(SPAWN, targeting ? Math.min(wantLen, maxLen) : maxLen), grow);

        if (root.current) {
            root.current.visible = true;
            root.current.position.set(pose.current.x, 0, pose.current.z);
            root.current.rotation.y = rayYaw;
        }

        const len = liveLen.current;
        const midZ = SPAWN + (len - SPAWN) * 0.5;
        const cylLen = Math.max(0.05, len - SPAWN);
        const pulse = 1 + 0.04 * Math.sin(performance.now() * 0.012);

        if (core.current) {
            core.current.position.set(0, HAND_Y, midZ);
            core.current.scale.set(0.055 * pulse, cylLen, 0.055 * pulse);
        }
        if (glow.current) {
            glow.current.position.set(0, HAND_Y, midZ);
            glow.current.scale.set(0.14 * pulse, cylLen, 0.14 * pulse);
        }
        coreMat.opacity = fade * 0.85;
        glowMat.opacity = fade * 0.28;

        const fx = Math.sin(rayYaw);
        const fz = Math.cos(rayYaw);
        const trailAlong = SPAWN + (len - SPAWN) * 0.5;
        const trailX = pose.current.x + fx * trailAlong;
        const trailZ = pose.current.z + fz * trailAlong;
        const tipX = pose.current.x + fx * len;
        const tipZ = pose.current.z + fz * len;
        healTrail.current?.setPoseYaw(trailX, HAND_Y, trailZ, rayYaw);
        holyTrail.current?.setPoseYaw(tipX, HAND_Y, tipZ, rayYaw);
        healTrail.current?.setRateScale(fade);
        holyTrail.current?.setRateScale(fade * 0.45);

        const connects = targeting && dist <= endLength + 0.08 && maxLen >= wantLen - 0.08;
        if (connects && grow >= 0.98 && !impactFired.current) {
            impactFired.current = true;
            burstElementRole("heal", "impact", tipX, HAND_Y, tipZ);
        }
    });

    return (
        <group ref={root} position={[shot.x, 0, shot.z]} rotation={[0, shot.yaw, 0]}>
            <mesh ref={core} material={coreMat} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1, 1, 1, 10, 1, true]} />
            </mesh>
            <mesh ref={glow} material={glowMat} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
            </mesh>
        </group>
    );
}
