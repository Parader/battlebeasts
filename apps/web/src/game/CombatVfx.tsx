import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { HUB_PRACTICE_DUMMIES, MOVE_SPEED, totalShieldAbsorb } from "@battlebeasts/shared";
import { abilityVfxColor, BoltProjectileEffect, FrostBallProjectileEffect, GraspProjectileEffect, hasCatalogProjectile } from "./vfx";
import { CHARACTER_URL, prepareCharacterScene, setCharacterOpacity, tintCharacterSurface } from "./characterVisual";
import { CharacterAnimationController, heroAnimationConfig } from "./animation";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import { syncAbilityCast } from "./syncPlayerCast";
import { AimIndicator, AIM_RELATION_COLORS } from "./AimIndicator";
import { combatOverlayRuntime } from "./combatOverlayRuntime";
import { playBoltCastSfx } from "./gameSfx";

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

function ProjectileRouter({
    room,
    id,
    knownAbilityId,
}: {
    room: Room;
    id: string;
    knownAbilityId?: string;
}) {
    const abilityId =
        (room.state?.projectiles?.get(id) as { abilityId?: string } | undefined)?.abilityId ??
        knownAbilityId;
    if (abilityId === "frostBall") {
        return <FrostBallProjectileEffect room={room} id={id} />;
    }
    if (abilityId === "grasp") {
        return <GraspProjectileEffect room={room} id={id} />;
    }
    if (hasCatalogProjectile(abilityId)) {
        return <BoltProjectileEffect room={room} id={id} />;
    }
    if (!room.state?.projectiles?.get(id)) return null;
    return <LegacyProjectileMesh room={room} id={id} />;
}

export function Projectiles({ room }: { room: Room | null }) {
    const [ids, setIds] = useState<string[]>([]);
    const keyRef = useRef("");
    /** Frost balls held after server despawn so the client can coast + fade. */
    const fading = useRef(new Map<string, number>());
    const abilityById = useRef(new Map<string, string>());
    const prevLive = useRef(new Set<string>());

    useFrame(() => {
        if (!room?.state?.projectiles) return;
        const now = performance.now();
        const live: string[] = [];
        room.state.projectiles.forEach(
            (p: { abilityId?: string; ownerSessionId?: string }, id: string) => {
            live.push(id);
            if (p.abilityId) abilityById.current.set(id, p.abilityId);
            // Bolt cast SFX when the projectile first appears in the world.
            if (!prevLive.current.has(id) && p.abilityId === "bolt") {
                playBoltCastSfx(p.ownerSessionId || id);
            }
        },
        );
        live.sort();

        for (const id of prevLive.current) {
            if (!live.includes(id) && abilityById.current.get(id) === "frostBall") {
                fading.current.set(id, now + 480);
            }
        }
        prevLive.current = new Set(live);

        for (const [id, until] of [...fading.current.entries()]) {
            if (now >= until || live.includes(id)) {
                fading.current.delete(id);
                if (!live.includes(id)) abilityById.current.delete(id);
            }
        }

        const next = [...live, ...fading.current.keys()].sort();
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
                <ProjectileRouter
                    key={id}
                    room={room}
                    id={id}
                    knownAbilityId={abilityById.current.get(id)}
                />
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

export function CombatFxMeshes() {
    const [bursts, setBursts] = useState<readonly FxBurst[]>(() => combatOverlayRuntime.getBursts());

    useEffect(() => {
        return combatOverlayRuntime.subscribe(() => {
            setBursts(combatOverlayRuntime.getBursts().slice());
        });
    }, []);

    useFrame(() => {
        combatOverlayRuntime.prune();
    });

    return (
        <>
            {bursts.map((b) => (
                <FxRing key={b.key} burst={b} />
            ))}
        </>
    );
}

export type DamagePopup = {
    key: number;
    amount: number;
    /** Heal popups render green `+N`; damage stays red. */
    kind?: "damage" | "heal";
    x: number;
    z: number;
    /** World Y start (chest / head). */
    y: number;
    born: number;
    life: number;
    /** Lateral drift so stacked hits fan out. */
    driftX: number;
    driftZ: number;
};

function DamagePopupMesh({ popup }: { popup: DamagePopup }) {
    const group = useRef<THREE.Group>(null);
    const el = useRef<HTMLDivElement>(null);
    const isHeal = popup.kind === "heal";

    useFrame(() => {
        const g = group.current;
        const node = el.current;
        if (!g || !node) return;
        const age = (performance.now() - popup.born) / popup.life;
        if (age >= 1) {
            g.visible = false;
            node.style.opacity = "0";
            return;
        }
        g.visible = true;
        const rise = age * 1.6;
        const pop = 1 - Math.pow(1 - Math.min(1, age / 0.12), 3);
        const fade = age < 0.5 ? 1 : Math.max(0, 1 - (age - 0.5) / 0.5);
        g.position.set(
            popup.x + popup.driftX * age,
            popup.y + rise,
            popup.z + popup.driftZ * age,
        );
        const scale = 0.9 + pop * 0.35;
        node.style.opacity = String(fade);
        node.style.transform = `scale(${scale})`;
    });

    return (
        <group ref={group} position={[popup.x, popup.y, popup.z]}>
            <Html center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
                <div
                    ref={el}
                    style={{
                        color: isHeal ? "#bbf7d0" : "#fecaca",
                        fontWeight: 600,
                        fontSize: "18px",
                        fontFamily: "ui-sans-serif, system-ui, sans-serif",
                        letterSpacing: "0.02em",
                        textShadow: isHeal
                            ? "0 1px 0 #14532d, 0 0 8px rgba(22,101,52,0.85)"
                            : "0 1px 0 #450a0a, 0 0 8px rgba(127,29,29,0.85)",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        willChange: "transform, opacity",
                    }}
                >
                    {isHeal ? `+${Math.round(popup.amount)}` : Math.round(popup.amount)}
                </div>
            </Html>
        </group>
    );
}

export function DamagePopups() {
    const [popups, setPopups] = useState<readonly DamagePopup[]>(() => combatOverlayRuntime.getPopups());

    useEffect(() => {
        return combatOverlayRuntime.subscribe(() => {
            setPopups(combatOverlayRuntime.getPopups().slice());
        });
    }, []);

    return (
        <>
            {popups.map((p) => (
                <DamagePopupMesh key={p.key} popup={p} />
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

type DecoyNet = {
    x: number;
    z: number;
    yaw: number;
    vx: number;
    vz: number;
    color: string;
    pattern?: string;
    patternColor?: string;
    expiresAt: number;
};

function DecoyAvatar({ room, decoyId }: { room: Room; decoyId: string }) {
    const group = useRef<THREE.Group>(null);
    const controllerRef = useRef<CharacterAnimationController | null>(null);
    const renderPos = useRef(new THREE.Vector3());
    const renderYaw = useRef(0);
    const vel = useRef(new THREE.Vector3());
    const colorRef = useRef("#4ade80");
    const patternRef = useRef("plain");
    const patternColorRef = useRef("#1f2937");
    const seeded = useRef(false);
    const gltf = useGLTF(CHARACTER_URL);
    const scene = useMemo(() => {
        const idle =
            gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
            gltf.animations[0] ??
            null;
        return prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
    }, [gltf.scene, gltf.animations]);

    useEffect(() => {
        const controller = new CharacterAnimationController(
            scene,
            gltf.animations,
            heroAnimationConfig,
        );
        controllerRef.current = controller;
        return () => {
            controller.dispose();
            controllerRef.current = null;
        };
    }, [scene, gltf.animations]);

    useFrame((_, dt) => {
        const d = room.state?.decoys?.get(decoyId) as DecoyNet | undefined;
        const g = group.current;
        const controller = controllerRef.current;
        if (!d || !g || !controller) {
            if (g) g.visible = false;
            seeded.current = false;
            return;
        }
        g.visible = true;
        const safeDt = Math.max(1e-4, Math.min(0.05, dt));

        if (!seeded.current) {
            renderPos.current.set(d.x, 0, d.z);
            renderYaw.current = d.yaw;
            seeded.current = true;
            colorRef.current = d.color;
            patternRef.current = d.pattern ?? "plain";
            patternColorRef.current = d.patternColor ?? "#1f2937";
            tintCharacterSurface(
                scene,
                d.color,
                patternRef.current,
                patternColorRef.current,
            );
            setCharacterOpacity(scene, 1);
        }
        if (
            d.color !== colorRef.current ||
            (d.pattern ?? "plain") !== patternRef.current ||
            (d.patternColor ?? "#1f2937") !== patternColorRef.current
        ) {
            colorRef.current = d.color;
            patternRef.current = d.pattern ?? "plain";
            patternColorRef.current = d.patternColor ?? "#1f2937";
            tintCharacterSurface(
                scene,
                d.color,
                patternRef.current,
                patternColorRef.current,
            );
        }

        // Coast with server velocity between patches, soft-correct to authority.
        renderPos.current.x += d.vx * safeDt;
        renderPos.current.z += d.vz * safeDt;
        const blend = 1 - Math.exp(-14 * safeDt);
        renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, d.x, blend);
        renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, d.z, blend);
        renderYaw.current = THREE.MathUtils.lerp(renderYaw.current, d.yaw, blend);

        g.position.set(renderPos.current.x, 0, renderPos.current.z);
        g.rotation.y = renderYaw.current;

        vel.current.set(d.vx, 0, d.vz);
        const speed = Math.hypot(d.vx, d.vz);
        controller.setMovement({
            worldVelocity: speed > 0.08 ? vel.current : _zeroVel,
            facingYaw: renderYaw.current,
            maximumSpeed: MOVE_SPEED,
        });
        controller.update(safeDt);
    });

    return (
        <group ref={group}>
            <primitive object={scene} />
        </group>
    );
}

/** Visual clones from Decoy (Q). */
export function Decoys({ room }: { room: Room | null }) {
    const [ids, setIds] = useState<string[]>([]);
    const prevKey = useRef("");

    useFrame(() => {
        if (!room?.state?.decoys) return;
        const next: string[] = [];
        room.state.decoys.forEach((_d: unknown, id: string) => next.push(id));
        next.sort();
        const key = next.join("|");
        if (key !== prevKey.current) {
            prevKey.current = key;
            setIds(next);
        }
    });

    if (!room) return null;
    return (
        <>
            {ids.map((id) => (
                <DecoyAvatar key={id} room={room} decoyId={id} />
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
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const aimRef = useRef<THREE.Group>(null);
    const controllerRef = useRef<CharacterAnimationController | null>(null);
    const lastCastId = useRef("");
    const groundY = useRef<number | null>(null);
    const lastXZ = useRef({ x: 0, z: 0 });
    const lastXZSeeded = useRef(false);
    /** Cached sole lift so we don't Box3.setFromObject every frame. */
    const footLift = useRef<number | null>(null);
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const { scene: world } = useThree();
    const gltf = useGLTF(CHARACTER_URL);
    const scene = useMemo(() => {
        const idle =
            gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
            gltf.animations[0] ??
            null;
        const rootScene = prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
        rootScene.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (!mesh.isMesh || !mesh.material) return;
            mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map((m) => m.clone())
                : mesh.material.clone();
        });
        tintCharacterSurface(rootScene, DUMMY_COLOR);
        return rootScene;
    }, [gltf.scene, gltf.animations]);

    useEffect(() => {
        footLift.current = null;
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
        const t = room?.state?.targets?.get(targetId) as
            | {
                  x: number;
                  z: number;
                  yaw?: number;
                  hp: number;
                  maxHp: number;
                  castAbilityId?: string;
                  castPhase?: string;
                  castLockUntil?: number;
                  statuses?: Parameters<typeof hasStatusId>[0];
              }
            | undefined;
        if (controller) {
            const yaw = t?.yaw ?? 0;
            controller.setStunned(hasStatusId(t?.statuses, "stunned"));
            controller.setMovementFromYaw(_zeroVel, yaw, MOVE_SPEED);
            syncAbilityCast(controller, t, lastCastId);
            controller.update(safeDt);
        }

        const g = root.current;
        const b = body.current;
        if (!g) return;
        if (!t) {
            g.visible = false;
            return;
        }
        g.visible = true;
        const yaw = t.yaw ?? 0;
        if (b) b.rotation.y = yaw;
        const aim = aimRef.current;
        if (aim) aim.rotation.y = yaw;

        const movedFar =
            lastXZSeeded.current &&
            Math.hypot(t.x - lastXZ.current.x, t.z - lastXZ.current.z) > 1.5;
        if (groundY.current == null || movedFar) {
            const y = sampleTerrainY(world, t.x, t.z, raycaster);
            if (y != null) groundY.current = y;
        }
        lastXZ.current.x = t.x;
        lastXZ.current.z = t.z;
        lastXZSeeded.current = true;

        // Place soles on terrain; measure foot lift once (model local extent is fixed).
        const targetY = groundY.current ?? 0;
        if (footLift.current == null) {
            g.position.set(t.x, targetY, t.z);
            g.updateMatrixWorld(true);
            _box.setFromObject(scene);
            footLift.current = Number.isFinite(_box.min.y) ? targetY - _box.min.y : 0;
        }
        g.position.set(t.x, targetY + footLift.current, t.z);
    });

    return (
        <group ref={root} userData={{ bbSkipGround: true }}>
            <group ref={body}>
                <primitive object={scene} />
                <StatusOrnaments
                    headY={2.2}
                    getStatuses={() => {
                        const t = room?.state?.targets?.get(targetId) as
                            | { statuses?: Parameters<typeof collectStatusRows>[0] }
                            | undefined;
                        return collectStatusRows(t?.statuses);
                    }}
                />
            </group>
            <group ref={aimRef}>
                <AimIndicator color={AIM_RELATION_COLORS.neutral} />
            </group>
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
    const shield = useRef<THREE.Mesh>(null);
    useFrame(() => {
        const t = room?.state?.targets?.get(targetId) as
            | {
                  hp: number;
                  maxHp: number;
                  statuses?: { forEach: (cb: (row: { statusId?: string; stacks?: number }) => void) => void };
              }
            | undefined;
        const m = fill.current;
        const s = shield.current;
        if (!m || !t) return;
        const maxHp = Math.max(1, t.maxHp);
        const ratio = Math.max(0, Math.min(1, t.hp / maxHp));
        m.scale.x = Math.max(0.001, ratio);
        m.position.x = -0.5 * (1 - ratio);

        if (s) {
            const rows: { statusId?: string; stacks?: number }[] = [];
            t.statuses?.forEach((row) => {
                if (row?.statusId) rows.push(row);
            });
            const shieldRatio = Math.max(0, Math.min(1, totalShieldAbsorb(rows) / maxHp));
            if (shieldRatio <= 0) {
                s.visible = false;
            } else {
                s.visible = true;
                s.scale.x = Math.max(0.001, shieldRatio);
                const left = Math.min(ratio, Math.max(0, 1 - shieldRatio));
                s.position.x = -0.5 + left + shieldRatio * 0.5;
            }
        }
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
            <mesh ref={shield} position={[0, 0, 0.02]} visible={false}>
                <planeGeometry args={[1, 0.1]} />
                <meshBasicMaterial color="#60a5fa" />
            </mesh>
        </group>
    );
}
