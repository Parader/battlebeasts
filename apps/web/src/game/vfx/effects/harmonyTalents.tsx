import { useEffect, useMemo, useRef } from "react";
import { REBIRTH_CAST } from "@battlebeasts/shared";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VfxFollowContext } from "../catalog";
import { softEnvelope } from "../easing";
import { burstElementRole } from "../engine";
import type { OneShotEffect } from "../types";

const GOLD = "#fef08a";
const CREAM = "#fff7ed";

type FollowPose = { x: number; z: number };

function updateFollowPose(out: FollowPose, shot: OneShotEffect, follow: VfxFollowContext): void {
    const id = shot.followTargetId ?? shot.targetId ?? shot.followOwnerId;
    if (id && follow.room) {
        const p = follow.room.state?.players?.get(id) as { x?: number; z?: number } | undefined;
        if (p && typeof p.x === "number" && typeof p.z === "number") {
            out.x = p.x;
            out.z = p.z;
            return;
        }
    }
    out.x = shot.x;
    out.z = shot.z;
}

/** Harmony talent procs — one ParticleWorld impact at the recipient. */
export function HarmonyHealBurstEffect({ shot, follow }: { shot: OneShotEffect; follow: VfxFollowContext }) {
    const pose = useRef<FollowPose>({ x: shot.x, z: shot.z });

    useEffect(() => {
        updateFollowPose(pose.current, shot, follow);
        const element = shot.abilityId === "guardianAngel" || shot.abilityId === "battleRhythm" ? "heal" : "holy";
        burstElementRole(element, "impact", pose.current.x, shot.y + 0.18, pose.current.z);
    }, [follow, shot]);

    return null;
}

function RebirthPillar({ shot, follow }: { shot: OneShotEffect; follow: VfxFollowContext }) {
    const lifeMs = Math.max(REBIRTH_CAST.delayMs, shot.life || REBIRTH_CAST.delayMs);
    const root = useRef<THREE.Group>(null);
    const pose = useRef<FollowPose>({ x: shot.x, z: shot.z });
    const pillarMat = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: GOLD,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                toneMapped: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            }),
        [],
    );
    const coreMat = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: CREAM,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                toneMapped: false,
                blending: THREE.AdditiveBlending,
            }),
        [],
    );
    const ringMat = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                color: GOLD,
                transparent: true,
                opacity: 0,
                depthWrite: false,
                toneMapped: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            }),
        [],
    );
    useEffect(
        () => () => {
            pillarMat.dispose();
            coreMat.dispose();
            ringMat.dispose();
        },
        [pillarMat, coreMat, ringMat],
    );

    useFrame(() => {
        const age = performance.now() - shot.born;
        const u = Math.max(0, Math.min(1, age / lifeMs));
        const env = softEnvelope(u, 0.08, 0.82);
        pillarMat.opacity = env * 0.42;
        coreMat.opacity = env * 0.7;
        ringMat.opacity = env * 0.55;
        if (!root.current) return;
        updateFollowPose(pose.current, shot, follow);
        root.current.position.set(pose.current.x, 0.02, pose.current.z);
        root.current.rotation.y += 0.012;
    });

    return (
        <group ref={root} position={[shot.x, 0.02, shot.z]}>
            <mesh material={pillarMat} position={[0, 2.4, 0]}>
                <cylinderGeometry args={[0.22, 0.34, 4.8, 12, 1, true]} />
            </mesh>
            <mesh material={coreMat} position={[0, 2.4, 0]}>
                <cylinderGeometry args={[0.07, 0.07, 4.8, 8]} />
            </mesh>
            <mesh material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
                <ringGeometry args={[0.55, 0.82, 24]} />
            </mesh>
        </group>
    );
}

/** Rebirth — holy impact plus the delayed-rez pillar mesh for variant 1. */
export function RebirthEffect({ shot, follow }: { shot: OneShotEffect; follow: VfxFollowContext }) {
    const pose = useRef<FollowPose>({ x: shot.x, z: shot.z });

    useEffect(() => {
        updateFollowPose(pose.current, shot, follow);
        burstElementRole("holy", "impact", pose.current.x, shot.y + 0.18, pose.current.z);
    }, [follow, shot]);

    if ((shot.variant ?? 0) !== 1) return null;
    return <RebirthPillar shot={shot} follow={follow} />;
}
