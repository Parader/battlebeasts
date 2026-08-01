import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Room } from "colyseus.js";
import * as THREE from "three";
import {
    CAMERA,
    HUB_PORTALS,
    HUB_SCENE_SCALE,
    HUB_SCENE_URL,
    HUB_SPAWN,
    HUB_STANDS,
    STARTER_COLORS,
    type InteractZone,
} from "@battlebeasts/shared";
import { FixedFollowCamera } from "./FixedFollowCamera";
import { RemotePlayers } from "./RemotePlayers";
import { CharacterAvatar } from "./CharacterAvatar";
import { CombatFxMeshes, DamagePopups, Projectiles, WorldTargets, Decoys, Volcanoes, ProtectionBubbles, Shrooms, SpiritHusks } from "./CombatVfx";
import { SpellVfxBridge, VfxWorld } from "./vfx";
import { setGroundAim } from "./groundAimRuntime";
import { FollowSun } from "./FollowSun";
import { CollisionDebugOverlay } from "./CollisionDebugOverlay";
import { PlacementHelper } from "./PlacementHelper";
import { useGLTF } from "@react-three/drei";
import type { PredictedPose } from "./useBaseCityRoom";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { assetUrl } from "./assetUrl";
import { HubIntroCamera } from "./intro/HubIntroCamera";
import { getHubIntroSnapshot, subscribeHubIntro } from "./intro/hubIntroRuntime";

const HUB_GLB = assetUrl(HUB_SCENE_URL.replace(/^\//, ""));
useGLTF.preload(HUB_GLB);

/** Drop village so meadow under spawn sits on y=0 (player feet). */
function plantVillageAtSpawn(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    if (meshes.length === 0) return;
    const origin = new THREE.Vector3(HUB_SPAWN.x, 200, HUB_SPAWN.z);
    const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObjects(
        meshes,
        false,
    );
    const hit = hits[0];
    if (hit && Number.isFinite(hit.point.y)) {
        root.position.y -= hit.point.y;
    }
}

function VillageScene() {
    const gltf = useGLTF(HUB_GLB);
    const scene = useMemo(() => {
        const root = cloneSkinned(gltf.scene) as THREE.Object3D;
        root.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh) return;
            // Full village shadow-casting tanks the GPU (300+ meshes).
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            if (mesh.material) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const m of mats) {
                    // Avoid per-frame lights×maps cost on dense foliage kits
                    const std = m as THREE.MeshStandardMaterial;
                    if (std.isMeshStandardMaterial) {
                        std.envMapIntensity = 0;
                    }
                }
            }
        });
        root.scale.setScalar(HUB_SCENE_SCALE);
        plantVillageAtSpawn(root);
        root.userData.bbHubTerrain = true;
        return root;
    }, [gltf.scene]);
    return <primitive object={scene} />;
}

type Props = {
    room: Room | null;
    localSessionId: string | null;
    predictedRef: MutableRefObject<PredictedPose>;
};

function PortalMarker({
    x,
    z,
    halfX,
    halfZ,
    rotationY,
    color,
}: InteractZone & { color: string }) {
    return (
        <group position={[x, 0, z]}>
            <InteractZoneField
                x={0}
                z={0}
                halfX={halfX}
                halfZ={halfZ}
                rotationY={rotationY}
                color={color}
                profile="portal"
            />
        </group>
    );
}

/** Stand mote tints — a bit richer so they read on sunlit grass. */
const STAND_MARKER_COLOR: Record<string, string> = {
    shop: "#ffe08a",
    build: "#9ec5ff",
    customization: "#f0a8d0",
    talent: "#c4b0ff",
};

type ZoneMote = {
    lx: number;
    lz: number;
    y: number;
    phase: number;
    speed: number;
    sway: number;
    size: number;
    baseAlpha: number;
};

/** Soft circle atlas for mote quads (gl.POINTS are often 1px-capped on ANGLE). */
let _moteTex: THREE.CanvasTexture | null = null;
function getMoteTexture() {
    if (_moteTex) return _moteTex;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _moteTex = new THREE.CanvasTexture(canvas);
    _moteTex.colorSpace = THREE.SRGBColorSpace;
    return _moteTex;
}

const _zoneDummy = new THREE.Object3D();
const _zoneColor = new THREE.Color();

/**
 * Soft mote field filling an Empty-box footprint.
 * Camera-facing quads (not Points) so they stay visible on Windows/ANGLE.
 * `pad` = ankle-height stand dust; `portal` = taller, brighter column.
 */
function InteractZoneField({
    x,
    z,
    halfX,
    halfZ,
    rotationY,
    color,
    density = 1,
    profile = "pad",
}: InteractZone & { color: string; density?: number; profile?: "pad" | "portal" }) {
    const mesh = useRef<THREE.InstancedMesh>(null);
    const { camera } = useThree();
    const portal = profile === "portal";
    const area = Math.max(0.35, halfX * 2 * (halfZ * 2));
    const count = Math.round(
        THREE.MathUtils.clamp(area * (portal ? 10 : 4) * density, portal ? 22 : 12, portal ? 40 : 28),
    );
    const yMax = portal ? 2.35 : 0.32;

    const motes = useMemo(() => {
        const list: ZoneMote[] = [];
        for (let i = 0; i < count; i++) {
            list.push({
                lx: (Math.random() * 2 - 1) * halfX * 0.92,
                lz: (Math.random() * 2 - 1) * halfZ * 0.92,
                y: portal ? 0.12 + Math.random() * yMax * 0.85 : 0.04 + Math.random() * 0.22,
                phase: Math.random() * Math.PI * 2,
                speed: portal ? 0.28 + Math.random() * 0.35 : 0.06 + Math.random() * 0.08,
                sway: portal ? 0.08 + Math.random() * 0.1 : 0.04 + Math.random() * 0.06,
                size: portal ? 0.14 + Math.random() * 0.16 : 0.07 + Math.random() * 0.08,
                baseAlpha: portal ? 0.42 + Math.random() * 0.28 : 0.28 + Math.random() * 0.2,
            });
        }
        return list;
    }, [count, halfX, halfZ, portal, yMax]);

    const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
    const material = useMemo(
        () =>
            new THREE.MeshBasicMaterial({
                map: getMoteTexture(),
                color: new THREE.Color(0xffffff),
                transparent: true,
                opacity: portal ? 0.85 : 0.65,
                depthWrite: false,
                depthTest: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
                side: THREE.DoubleSide,
            }),
        [portal],
    );

    useEffect(() => {
        const inst = mesh.current;
        if (inst) {
            // Ensure per-instance colors exist before first paint.
            const buf = new Float32Array(count * 3);
            _zoneColor.set(color);
            for (let i = 0; i < count; i++) {
                buf[i * 3] = _zoneColor.r;
                buf[i * 3 + 1] = _zoneColor.g;
                buf[i * 3 + 2] = _zoneColor.b;
            }
            inst.instanceColor = new THREE.InstancedBufferAttribute(buf, 3);
        }
        return () => {
            geometry.dispose();
            material.dispose();
        };
    }, [geometry, material, count, color]);

    useFrame(({ clock }, dt) => {
        const inst = mesh.current;
        if (!inst) return;
        const t = clock.elapsedTime;
        const safeDt = Math.min(0.05, dt);
        const cosY = Math.cos(rotationY);
        const sinY = Math.sin(rotationY);

        for (let i = 0; i < count; i++) {
            const m = motes[i]!;
            m.y += m.speed * safeDt;
            if (m.y > yMax) {
                m.y = portal ? 0.08 + Math.random() * 0.2 : 0.03 + Math.random() * 0.06;
                m.lx = (Math.random() * 2 - 1) * halfX * 0.92;
                m.lz = (Math.random() * 2 - 1) * halfZ * 0.92;
            }

            const swayX = Math.sin(t * 0.7 + m.phase) * m.sway;
            const swayZ = Math.cos(t * 0.55 + m.phase * 1.3) * m.sway;
            const lx = m.lx + swayX;
            const lz = m.lz + swayZ;
            const wx = x + lx * cosY - lz * sinY;
            const wz = z + lx * sinY + lz * cosY;

            const hFade = portal
                ? THREE.MathUtils.clamp(1.05 - Math.abs(m.y / yMax - 0.45) * 0.9, 0.35, 1)
                : THREE.MathUtils.clamp(1 - (m.y / yMax) * 0.55, 0.4, 1);
            const breathe = 0.85 + 0.15 * Math.sin(t * 0.9 + m.phase);
            const s = m.size * (0.92 + 0.12 * breathe);
            const a = m.baseAlpha * hFade * breathe;

            _zoneDummy.position.set(wx, m.y, wz);
            _zoneDummy.quaternion.copy(camera.quaternion);
            _zoneDummy.scale.setScalar(s);
            _zoneDummy.updateMatrix();
            inst.setMatrixAt(i, _zoneDummy.matrix);

            _zoneColor.set(color).multiplyScalar(portal ? 0.45 + 0.65 * a : 0.32 + 0.55 * a);
            inst.setColorAt(i, _zoneColor);
        }

        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    });

    return (
        <instancedMesh
            ref={mesh}
            args={[geometry, material, count]}
            frustumCulled={false}
        />
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

export function BaseCityScene({ room, localSessionId, predictedRef }: Props) {
    const localPos = useRef(new THREE.Vector3(0, 0, 0));
    const aimNdc = useRef(new THREE.Vector2(0, 0));
    const aimReady = useRef(false);
    const { camera, gl } = useThree();
    const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const hit = useMemo(() => new THREE.Vector3(), []);
    const localColor =
        (localSessionId && room?.state?.players?.get(localSessionId)?.color) || STARTER_COLORS[0]!;
    const [followEnabled, setFollowEnabled] = useState(
        () => getHubIntroSnapshot().followCameraEnabled,
    );

    useEffect(() => {
        return subscribeHubIntro(() => {
            setFollowEnabled(getHubIntroSnapshot().followCameraEnabled);
        });
    }, []);

    useFrame(() => {
        const p = predictedRef.current;
        localPos.current.set(p.x, 0, p.z);

        // Keep ground aim fresh even when the cursor is still (cast clicks need it).
        if (!aimReady.current) return;
        // Don't fight intro face-cam with aim yaw.
        if (!getHubIntroSnapshot().followCameraEnabled) return;
        raycaster.setFromCamera(aimNdc.current, camera);
        if (raycaster.ray.intersectPlane(groundPlane, hit)) {
            const origin = predictedRef.current;
            const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
            setGroundAim(hit.x, hit.z);
            (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw?.(yaw);
        }
    });

    useEffect(() => {
        const el = gl.domElement;
        const onPointer = (e: PointerEvent) => {
            // Freeze aim / yaw during intro cinematic so the face-cam doesn't orbit.
            if (!getHubIntroSnapshot().followCameraEnabled) return;
            const rect = el.getBoundingClientRect();
            const ndc = aimNdc.current;
            ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            aimReady.current = true;
            raycaster.setFromCamera(ndc, camera);
            if (raycaster.ray.intersectPlane(groundPlane, hit)) {
                const origin = predictedRef.current;
                const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
                setGroundAim(hit.x, hit.z);
                (window as unknown as { __bbSetYaw?: (y: number) => void }).__bbSetYaw?.(yaw);
            }
        };
        el.addEventListener("pointermove", onPointer);
        el.addEventListener("pointerdown", onPointer);
        return () => {
            el.removeEventListener("pointermove", onPointer);
            el.removeEventListener("pointerdown", onPointer);
        };
    }, [camera, gl, groundPlane, hit, predictedRef, raycaster]);

    return (
        <>
            <ambientLight intensity={0.55} />
            <FollowSun follow={localPos} intensity={1.2} />

            <VillageScene />

            <CollisionDebugOverlay />
            <PlacementHelper />

            {HUB_STANDS.map((s) => (
                <InteractZoneField
                    key={s.id}
                    x={s.x}
                    z={s.z}
                    halfX={s.halfX}
                    halfZ={s.halfZ}
                    rotationY={s.rotationY}
                    color={STAND_MARKER_COLOR[s.kind] ?? "#94a3b8"}
                />
            ))}

            {HUB_PORTALS.map((p) => (
                <PortalMarker
                    key={p.id}
                    x={p.x}
                    z={p.z}
                    halfX={p.halfX}
                    halfZ={p.halfZ}
                    rotationY={p.rotationY}
                    color={p.kind === "pvp" ? "#ef4444" : "#22c55e"}
                />
            ))}

            <WorldTargets room={room} />
            <Decoys room={room} />
            <Volcanoes room={room} />
            <ProtectionBubbles room={room} />
            <Shrooms room={room} localSessionId={localSessionId} />
            <SpiritHusks
                room={room}
                localSessionId={localSessionId}
                predictedRef={predictedRef}
            />

            <LocalPlayerMesh
                predictedRef={predictedRef}
                room={room}
                localSessionId={localSessionId}
                color={localColor}
            />
            <RemotePlayers room={room} localSessionId={localSessionId} relation="ally" />
            <Projectiles room={room} />
            <CombatFxMeshes />
            <DamagePopups />
            <VfxWorld
                room={room}
                localSessionId={localSessionId}
                predictedRef={predictedRef}
            />
            <SpellVfxBridge room={room} />
            <HubIntroCamera predictedRef={predictedRef} />
            <FixedFollowCamera
                target={localPos}
                pitchDeg={CAMERA.pitchDeg}
                distance={CAMERA.distance}
                minDistance={CAMERA.minDistance}
                fov={CAMERA.fov}
                followLambda={CAMERA.followLambda}
                cursorLambda={CAMERA.cursorLambda}
                cursorInfluence={CAMERA.cursorInfluence}
                enabled={followEnabled}
            />
        </>
    );
}
