import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { CAMERA } from "@battlebeasts/shared";
import { FixedFollowCamera } from "./FixedFollowCamera";
import { RemotePlayers } from "./RemotePlayers";
import { CharacterAvatar } from "./CharacterAvatar";
import { CombatFxMeshes, DamagePopups, Projectiles, Decoys, type FxBurst, type DamagePopup } from "./CombatVfx";
import { SpellVfxBridge, VfxWorld } from "./vfx";
import { TexturedGround } from "./TexturedGround";
import { FollowSun } from "./FollowSun";
import type { PredictedPose } from "./useBaseCityRoom";

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
    modeLabel: string;
    fxBursts: FxBurst[];
    damagePopups: DamagePopup[];
};

function LocalMesh({
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

/** Minimal content arena — same movement/camera, no hub props. */
export function ContentScene({ room, localSessionId, predictedRef, fxBursts, damagePopups }: Props) {
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

    return (
        <>
            <ambientLight intensity={0.55} />
            <FollowSun follow={localPos} intensity={1.15} />
            <TexturedGround size={40} />
            <mesh position={[0, 0.05, -10]}>
                <boxGeometry args={[6, 0.1, 2]} />
                <meshStandardMaterial color="#64748b" />
            </mesh>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[1.4, 32]} />
                <meshStandardMaterial color="#334155" />
            </mesh>
            <LocalMesh
                predictedRef={predictedRef}
                room={room}
                localSessionId={localSessionId}
                color={localColor}
            />
            <RemotePlayers room={room} localSessionId={localSessionId} />
            <Decoys room={room} />
            <Projectiles room={room} />
            <CombatFxMeshes bursts={fxBursts} />
            <DamagePopups popups={damagePopups} />
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
