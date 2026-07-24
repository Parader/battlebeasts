import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { HUB_PRACTICE_DUMMIES, MOVE_SPEED } from "@battlebeasts/shared";
import { abilityVfxColor, BoltProjectileEffect, hasCatalogProjectile } from "./vfx";
import { CHARACTER_URL, prepareCharacterScene, tintCharacterSurface } from "./characterVisual";
import { CharacterAnimationController, heroAnimationConfig } from "./animation";

useGLTF.preload(CHARACTER_URL);

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
    return (
        <>
            {HUB_PRACTICE_DUMMIES.map((d) => (
                <PracticeDummyAvatar key={d.id} room={room} targetId={d.id} />
            ))}
        </>
    );
}

const DUMMY_COLOR = "#9ca3af";
const _down = new THREE.Vector3(0, -1, 0);
const _origin = new THREE.Vector3();
const _box = new THREE.Box3();
const _zeroVel = new THREE.Vector3();

function collectHubTerrainMeshes(root: THREE.Object3D): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o);
    });
    return meshes;
}

function findHubTerrainRoot(scene: THREE.Object3D): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    scene.traverse((o) => {
        if (found) return;
        if (o.userData?.bbHubTerrain) found = o;
    });
    return found;
}

/** Topmost terrain hit under (x,z) — prefer meadow/path names when present. */
function sampleTerrainY(
    world: THREE.Object3D,
    x: number,
    z: number,
    raycaster: THREE.Raycaster,
): number | null {
    const terrain = findHubTerrainRoot(world);
    const meshes = terrain
        ? collectHubTerrainMeshes(terrain)
        : (() => {
              const all: THREE.Object3D[] = [];
              world.traverse((o) => {
                  const m = o as THREE.Mesh;
                  if (!m.isMesh || !m.visible) return;
                  const n = m.name.toLowerCase();
                  if (n.includes("beta_") || n.includes("mixamorig") || n.startsWith("sm_chr")) {
                      return;
                  }
                  all.push(m);
              });
              return all;
          })();
    if (!meshes.length) return null;
    _origin.set(x, 80, z);
    raycaster.set(_origin, _down);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const named = hits.find((h) =>
        /meadow|path|floor|tile|flat|ground/i.test(h.object.name),
    );
    const hit = named ?? hits[0]!;
    return Number.isFinite(hit.point.y) ? hit.point.y : null;
}

function PracticeDummyAvatar({
    room,
    targetId,
}: {
    room: Room | null;
    targetId: string;
}) {
    const group = useRef<THREE.Group>(null);
    const controllerRef = useRef<CharacterAnimationController | null>(null);
    const groundY = useRef<number | null>(null);
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const { scene: world } = useThree();
    const gltf = useGLTF(CHARACTER_URL);
    const scene = useMemo(() => {
        const idle =
            gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
            gltf.animations[0] ??
            null;
        const root = prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
        root.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh || !mesh.material) return;
            mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map((m) => m.clone())
                : mesh.material.clone();
        });
        tintCharacterSurface(root, DUMMY_COLOR);
        return root;
    }, [gltf.scene, gltf.animations]);

    useEffect(() => {
        const controller = new CharacterAnimationController(
            scene,
            gltf.animations,
            heroAnimationConfig,
        );
        controller.setMovementFromYaw(_zeroVel, 0, MOVE_SPEED);
        controllerRef.current = controller;
        return () => {
            controller.dispose();
            controllerRef.current = null;
        };
    }, [scene, gltf.animations]);

    useFrame((_, dt) => {
        const safeDt = Math.min(0.05, Math.max(0, dt));
        const controller = controllerRef.current;
        if (controller) {
            controller.setMovementFromYaw(_zeroVel, 0, MOVE_SPEED);
            controller.update(safeDt);
        }

        const t = room?.state?.targets?.get(targetId) as
            | { x: number; z: number; hp: number; maxHp: number }
            | undefined;
        const g = group.current;
        if (!g) return;
        if (!t) {
            g.visible = false;
            return;
        }
        g.visible = true;

        if (groundY.current == null) {
            const y = sampleTerrainY(world, t.x, t.z, raycaster);
            if (y != null) groundY.current = y;
        }

        // Place, then snap soles to terrain (idle root Y can lift the mesh).
        const targetY = groundY.current ?? 0;
        g.position.set(t.x, targetY, t.z);
        g.updateMatrixWorld(true);
        _box.setFromObject(scene);
        if (Number.isFinite(_box.min.y)) {
            g.position.y += targetY - _box.min.y;
        }
    });

    return (
        <group ref={group} userData={{ bbSkipGround: true }}>
            <primitive object={scene} />
            <HpBillboard room={room} targetId={targetId} y={2.05} />
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
