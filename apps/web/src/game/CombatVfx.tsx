import { useFrame, useThree } from "@react-three/fiber";
import { Html, useGLTF, Billboard } from "@react-three/drei";
import { CombatHpBarBillboard } from "./CombatHpBarBillboard";
import { Room } from "colyseus.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import {
  MOVE_SPEED,
  PLAYER_BASE_MAX_HP,
  PROP_TARGET_KIND,
  PVE_ZOMBIE_KIND,
  STARTER_COLORS,
  totalShieldAbsorb,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";
import { abilityVfxColor, BoltProjectileEffect, GraspProjectileEffect, ChainJumpProjectileEffect, PoisonDartProjectileEffect, hasCatalogProjectile, isOwnedByCastProjectile } from "./vfx";
import { CHARACTER_URL, prepareCharacterScene, setCharacterOpacity, tintCharacterSurface } from "./characterVisual";
import { CharacterAnimationController, heroAnimationConfig } from "./animation";
import { ZOMBIE_URL, zombieAnimationConfig } from "./zombieAsset";
import { StatusOrnaments, collectStatusRows, hasStatusId } from "./StatusOrnaments";
import {
  StatusHpBadgeStack,
  readBleedingBadge,
  readBurningBadge,
  readPoisonBadge,
  readRejuvenationBadge,
  readSilenceBadge,
  readHolyBadge,
  syncBleedingBadge,
  syncBurningBadge,
  syncPoisonBadge,
  syncRejuvenationBadge,
  syncSilenceBadge,
  syncHolyBadge,
  type StatusRowLite,
} from "./StatusHpBadgeStack";
import { syncAbilityCast } from "./syncPlayerCast";
import { AimIndicator, AIM_RELATION_COLORS } from "./AimIndicator";
import { combatOverlayRuntime } from "./combatOverlayRuntime";
import { playBoltCastSfx } from "./gameSfx";
import {
  useDecoyIds,
  useHubBallIds,
  useProjectileIds,
  useWorldTargetIds,
} from "./useColyseusMapKeys";
import { cosmeticsKey, equippedFromPlayer } from "./cosmeticAttach";
import { EquippedCosmetics } from "./EquippedCosmetics";

export { Volcanoes } from "./vfx/Volcanoes";
export { ProtectionBubbles } from "./vfx/ProtectionBubbles";
export { RiftPortals } from "./vfx/RiftPortals";
export { Shrooms } from "./vfx/Shrooms";
export { SpiritHusks } from "./vfx/SpiritHusks";

useGLTF.preload(CHARACTER_URL);
useGLTF.preload(ZOMBIE_URL);

const _zombieVel = new THREE.Vector3();
/** Same grey as hub practice dummies. */
const DUMMY_COLOR = "#9ca3af";

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

const PROJECTILE_RENDERERS: Record<
    string,
    (props: { room: Room; id: string }) => ReactNode
> = {
    grasp: ({ room, id }) => <GraspProjectileEffect room={room} id={id} />,
    chainJump: ({ room, id }) => <ChainJumpProjectileEffect room={room} id={id} />,
    poisonDart: ({ room, id }) => <PoisonDartProjectileEffect room={room} id={id} />,
    bolt: ({ room, id }) => <BoltProjectileEffect room={room} id={id} />,
};

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
    if (isOwnedByCastProjectile(abilityId)) {
        // Mesh owned by cast one-shot (charge → same mesh flight / stick).
        return null;
    }
    if (abilityId) {
        const render = PROJECTILE_RENDERERS[abilityId];
        if (render) return <>{render({ room, id })}</>;
        if (hasCatalogProjectile(abilityId)) {
            return <BoltProjectileEffect room={room} id={id} />;
        }
        if (import.meta.env.DEV) {
            console.warn(`[vfx] missing projectile renderer for abilityId=${abilityId}; using legacy sphere`);
        }
    }
    if (!room.state?.projectiles?.get(id)) return null;
    return <LegacyProjectileMesh room={room} id={id} />;
}

export function Projectiles({ room }: { room: Room | null }) {
    const onBoltCast = useCallback((ownerSessionId: string) => {
        playBoltCastSfx(ownerSessionId);
    }, []);
    const ids = useProjectileIds(room, onBoltCast);

    if (!room) return null;
    return (
        <>
            {ids.map((id) => (
                <ProjectileRouter
                    key={id}
                    room={room}
                    id={id}
                    knownAbilityId={
                        (room.state?.projectiles?.get(id) as { abilityId?: string } | undefined)
                            ?.abilityId
                    }
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
    /** Critical hit/heal — larger, accented popup. */
    crit?: boolean;
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
    const isCrit = popup.crit === true;

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
        const rise = age * (isCrit ? 1.85 : 1.6);
        const pop = 1 - Math.pow(1 - Math.min(1, age / 0.12), 3);
        const fade = age < 0.5 ? 1 : Math.max(0, 1 - (age - 0.5) / 0.5);
        g.position.set(
            popup.x + popup.driftX * age,
            popup.y + rise,
            popup.z + popup.driftZ * age,
        );
        const scale = (isCrit ? 1.15 : 0.9) + pop * (isCrit ? 0.55 : 0.35);
        node.style.opacity = String(fade);
        node.style.transform = `scale(${scale})`;
    });

    const color = isHeal
        ? isCrit
            ? "#4ade80"
            : "#22c55e"
        : isCrit
          ? "#f87171"
          : "#fecaca";
    const shadow = isHeal
        ? isCrit
            ? "0 1px 0 #14532d, 0 0 14px rgba(74,222,128,0.95)"
            : "0 1px 0 #14532d, 0 0 10px rgba(34,197,94,0.9)"
        : isCrit
          ? "0 1px 0 #7f1d1d, 0 0 14px rgba(239,68,68,0.95)"
          : "0 1px 0 #450a0a, 0 0 8px rgba(127,29,29,0.85)";

    return (
        <group ref={group} position={[popup.x, popup.y, popup.z]}>
            <Html center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
                <div
                    ref={el}
                    style={{
                        color,
                        fontWeight: 600,
                        fontSize: isCrit ? "26px" : "18px",
                        fontFamily: "ui-sans-serif, system-ui, sans-serif",
                        letterSpacing: "0.02em",
                        textShadow: shadow,
                        whiteSpace: "nowrap",
                        userSelect: "none",
                        willChange: "transform, opacity",
                    }}
                >
                    {isHeal ? `+${Math.round(popup.amount)}` : Math.round(popup.amount)}
                    {isCrit ? "!" : ""}
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
  const ids = useWorldTargetIds(room);

  return (
    <>
      {ids.map((id) => {
        const kind =
          (room?.state?.targets?.get(id) as { kind?: string } | undefined)?.kind ?? "dummy";
        if (kind === PVE_ZOMBIE_KIND) {
          return <ZombieAvatar key={id} room={room} targetId={id} />;
        }
        if (kind === PROP_TARGET_KIND) {
          return <PropTargetBar key={id} room={room} targetId={id} />;
        }
        return <PracticeDummyAvatar key={id} room={room} targetId={id} />;
      })}
    </>
  );
}

/**
 * Health bar over an attackable map prop.
 *
 * No avatar: the prop is already on screen, drawn by the instanced map mesh
 * like any other piece of scenery. All that is missing is the readout, and
 * since these refill rather than break, the model never has to react.
 *
 * The bar floats above the prop's own footprint. Radius is the only size the
 * server knows about, so it stands in for height -- exact for the round things
 * these tend to be (posts, barrels, dummies), and clamped so a wide-but-flat
 * prop does not put its bar in the sky.
 */
function PropTargetBar({ room, targetId }: { room: Room | null; targetId: string }) {
    const root = useRef<THREE.Group>(null);

    useFrame(() => {
        const t = room?.state?.targets?.get(targetId) as
            | { x: number; z: number; y?: number; radius?: number }
            | undefined;
        const g = root.current;
        if (!g || !t) return;
        g.position.set(t.x, t.y ?? 0, t.z);
    });

    return (
        <group ref={root}>
            <HpBillboard room={room} targetId={targetId} y={3} />
        </group>
    );
}

function ZombieHpBar({ frac, y = 2.05 }: { frac: number; y?: number }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <Billboard position={[0, y, 0]} follow lockX={false} lockY={false} lockZ={false}>
      <mesh position={[0, 0, 0.01]} renderOrder={40}>
        <planeGeometry args={[0.9, 0.1]} />
        <meshBasicMaterial
          color="#1f2937"
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.85}
        />
      </mesh>
      <mesh position={[-(0.88 * (1 - f)) / 2, 0, 0.02]} renderOrder={41}>
        <planeGeometry args={[Math.max(0.001, 0.88 * f), 0.06]} />
        <meshBasicMaterial color="#86efac" depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

function ZombieAvatar({ room, targetId }: { room: Room | null; targetId: string }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const lastXZ = useRef({ x: 0, z: 0 });
  const seeded = useRef(false);
  const lastAttackKey = useRef("");
  const hpFrac = useRef(1);
  const [barFrac, setBarFrac] = useState(1);
  const gltf = useGLTF(ZOMBIE_URL);
  const scene = useMemo(() => {
    const idle =
      gltf.animations.find((c) => c.name === zombieAnimationConfig.idle) ??
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
    const controller = new CharacterAnimationController(
      scene,
      gltf.animations,
      zombieAnimationConfig,
    );
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scene, gltf.animations]);

  useFrame((_, dt) => {
    const paused = Boolean((room?.state as { paused?: boolean } | undefined)?.paused);
    const t = room?.state?.targets?.get(targetId) as
      | {
          x: number;
          z: number;
          yaw?: number;
          hp: number;
          maxHp: number;
          castAbilityId?: string;
          castPhase?: string;
        }
      | undefined;
    const g = root.current;
    if (!t || !g) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(t.x, 0, t.z);
    const yaw = t.yaw ?? 0;
    if (body.current) body.current.rotation.y = yaw;

    // Match paused: hold pose + animation clock (server also freezes AI).
    if (paused) {
      const nextFrac = t.maxHp > 0 ? t.hp / t.maxHp : 1;
      if (Math.abs(nextFrac - hpFrac.current) > 0.01) {
        hpFrac.current = nextFrac;
        setBarFrac(nextFrac);
      }
      return;
    }

    let moving = false;
    if (!seeded.current) {
      lastXZ.current = { x: t.x, z: t.z };
      seeded.current = true;
    } else {
      const dx = t.x - lastXZ.current.x;
      const dz = t.z - lastXZ.current.z;
      moving = dx * dx + dz * dz > 0.00005;
      lastXZ.current = { x: t.x, z: t.z };
    }

    const controller = controllerRef.current;
    if (controller) {
      const attacking = t.castAbilityId === "zombie_melee" && t.castPhase === "impact";
      const attackKey = attacking ? `${targetId}:${t.castAbilityId}:${t.castPhase}` : "";
      if (attacking && attackKey !== lastAttackKey.current) {
        lastAttackKey.current = attackKey;
        // Full-body Mixamo attack — upper-body mask is for the hero skeleton.
        const played =
          controller.playFullBodyAction("attack", { fadeIn: 0.1 }) ||
          controller.playUpperBodyAction("castMelee", { fadeIn: 0.1 });
        if (!played) {
          controller.playFullBodyAction("castMelee", { fadeIn: 0.1 });
        }
      } else if (!attacking) {
        lastAttackKey.current = "";
      }

      if (!attacking) {
        if (moving) {
          _zombieVel.set(Math.sin(yaw), 0, Math.cos(yaw));
          controller.setMovementFromYaw(_zombieVel, yaw, MOVE_SPEED);
        } else {
          _zombieVel.set(0, 0, 0);
          controller.setMovementFromYaw(_zombieVel, yaw, MOVE_SPEED);
        }
      }
      controller.update(Math.min(0.05, Math.max(0, dt)));
    }

    const nextFrac = t.maxHp > 0 ? t.hp / t.maxHp : 1;
    if (Math.abs(nextFrac - hpFrac.current) > 0.01) {
      hpFrac.current = nextFrac;
      setBarFrac(nextFrac);
    }
  });

  return (
    <group ref={root}>
      <group ref={body}>
        <primitive object={scene} />
      </group>
      <ZombieHpBar frac={barFrac} />
    </group>
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
    ownerSessionId?: string;
    hp?: number;
    maxHp?: number;
    expiresAt: number;
};

/** Same geometry/colors as PlayerHpBillboard — driven by decoy.hp/maxHp. */
function DecoyHpBillboard({
    room,
    decoyId,
    y = 2.2,
}: {
    room: Room;
    decoyId: string;
    y?: number;
}) {
    const ratioRef = useRef(0);
    const visibleRef = useRef(false);

    useFrame(() => {
        const d = room.state?.decoys?.get(decoyId) as DecoyNet | undefined;
        if (!d || typeof d.hp !== "number" || d.hp <= 0) {
            visibleRef.current = false;
            ratioRef.current = 0;
            return;
        }
        const maxHp = Math.max(1, d.maxHp ?? PLAYER_BASE_MAX_HP);
        visibleRef.current = true;
        ratioRef.current = Math.max(0, Math.min(1, d.hp / maxHp));
    });

    return (
        <CombatHpBarBillboard
            y={y}
            ratioRef={ratioRef}
            visibleRef={visibleRef}
            fillColor="#4ade80"
        />
    );
}

function DecoyAvatar({ room, decoyId }: { room: Room; decoyId: string }) {
    const group = useRef<THREE.Group>(null);
    const bodyRef = useRef<THREE.Group>(null);
    const controllerRef = useRef<CharacterAnimationController | null>(null);
    const renderPos = useRef(new THREE.Vector3());
    const renderYaw = useRef(0);
    const vel = useRef(new THREE.Vector3());
    const colorRef = useRef(STARTER_COLORS[0]!);
    const patternRef = useRef("plain");
    const patternColorRef = useRef("#1f2937");
    const cosmeticsKeyRef = useRef("");
    const [equipped, setEquipped] = useState<CosmeticsEquipped>({});
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

        const owner = d.ownerSessionId
            ? (room.state?.players?.get(d.ownerSessionId) as
                  | {
                        cosmeticHat?: string;
                        cosmeticShoulders?: string;
                        cosmeticChest?: string;
                        cosmeticGloves?: string;
                        cosmeticBelt?: string;
                        cosmeticLegs?: string;
                        cosmeticShoes?: string;
                    }
                  | undefined)
            : undefined;

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
            cosmeticsKeyRef.current = cosmeticsKey(owner);
            setEquipped(equippedFromPlayer(owner));
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

        const nextCosmetics = cosmeticsKey(owner);
        if (nextCosmetics !== cosmeticsKeyRef.current) {
            cosmeticsKeyRef.current = nextCosmetics;
            setEquipped(equippedFromPlayer(owner));
        }

        // Coast with server velocity between patches, soft-correct to authority.
        renderPos.current.x += d.vx * safeDt;
        renderPos.current.z += d.vz * safeDt;
        const blend = 1 - Math.exp(-14 * safeDt);
        renderPos.current.x = THREE.MathUtils.lerp(renderPos.current.x, d.x, blend);
        renderPos.current.z = THREE.MathUtils.lerp(renderPos.current.z, d.z, blend);
        renderYaw.current = THREE.MathUtils.lerp(renderYaw.current, d.yaw, blend);

        g.position.set(renderPos.current.x, 0, renderPos.current.z);
        if (bodyRef.current) bodyRef.current.rotation.y = renderYaw.current;

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
            <group ref={bodyRef}>
                <primitive object={scene} />
                <EquippedCosmetics characterRoot={scene} equipped={equipped} />
            </group>
            {/* Same HP bar as players — tracks decoy.hp until cloak ends / HP depleted. */}
            <DecoyHpBillboard room={room} decoyId={decoyId} />
        </group>
    );
}

/** Visual clones from Decoy (Q). */
export function Decoys({ room }: { room: Room | null }) {
    const ids = useDecoyIds(room);

    if (!room) return null;
    return (
        <>
            {ids.map((id) => (
                <DecoyAvatar key={id} room={room} decoyId={id} />
            ))}
        </>
    );
}

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
                    characterRoot={scene}
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
    const poisonBadge = useRef<HTMLDivElement>(null);
    const poisonStacksEl = useRef<HTMLSpanElement>(null);
    const poisonRing = useRef<SVGCircleElement>(null);
    const burningBadge = useRef<HTMLDivElement>(null);
    const burningRing = useRef<SVGCircleElement>(null);
    const bleedingBadge = useRef<HTMLDivElement>(null);
    const bleedingStacksEl = useRef<HTMLSpanElement>(null);
    const bleedingRing = useRef<SVGCircleElement>(null);
    const rejuvenationBadge = useRef<HTMLDivElement>(null);
    const rejuvenationStacksEl = useRef<HTMLSpanElement>(null);
    const rejuvenationRing = useRef<SVGCircleElement>(null);
    const silenceBadge = useRef<HTMLDivElement>(null);
    const silenceRing = useRef<SVGCircleElement>(null);
    const holyBadge = useRef<HTMLDivElement>(null);
    const holyRing = useRef<SVGCircleElement>(null);
    const lastPoisonStacks = useRef(0);
    const lastBleedingStacks = useRef(0);
    const lastRejuvenationStacks = useRef(0);
    useFrame(() => {
        const t = room?.state?.targets?.get(targetId) as
            | {
                  hp: number;
                  maxHp: number;
                  statuses?: { forEach: (cb: (row: StatusRowLite) => void) => void };
              }
            | undefined;
        const m = fill.current;
        const s = shield.current;
        if (!m || !t) {
            syncPoisonBadge(
                poisonBadge.current,
                poisonStacksEl.current,
                poisonRing.current,
                { stacks: 0, expiresAt: 0 },
                lastPoisonStacks,
            );
            syncBurningBadge(burningBadge.current, burningRing.current, {
                stacks: 0,
                expiresAt: 0,
            });
            syncBleedingBadge(
                bleedingBadge.current,
                bleedingStacksEl.current,
                bleedingRing.current,
                { stacks: 0, expiresAt: 0 },
                lastBleedingStacks,
            );
            syncRejuvenationBadge(
                rejuvenationBadge.current,
                rejuvenationStacksEl.current,
                rejuvenationRing.current,
                { stacks: 0, expiresAt: 0 },
                lastRejuvenationStacks,
            );
            syncSilenceBadge(silenceBadge.current, silenceRing.current, {
                stacks: 0,
                expiresAt: 0,
            });
            syncHolyBadge(holyBadge.current, holyRing.current, {
                stacks: 0,
                expiresAt: 0,
            });
            return;
        }
        const maxHp = Math.max(1, t.maxHp);
        const ratio = Math.max(0, Math.min(1, t.hp / maxHp));
        m.scale.x = Math.max(0.001, ratio);
        m.position.x = -0.5 * (1 - ratio);

        const rows: StatusRowLite[] = [];
        t.statuses?.forEach((row) => {
            if (row?.statusId) rows.push(row);
        });
        if (s) {
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
        syncPoisonBadge(
            poisonBadge.current,
            poisonStacksEl.current,
            poisonRing.current,
            readPoisonBadge(rows),
            lastPoisonStacks,
        );
        syncBurningBadge(burningBadge.current, burningRing.current, readBurningBadge(rows));
        syncBleedingBadge(
            bleedingBadge.current,
            bleedingStacksEl.current,
            bleedingRing.current,
            readBleedingBadge(rows),
            lastBleedingStacks,
        );
        syncRejuvenationBadge(
            rejuvenationBadge.current,
            rejuvenationStacksEl.current,
            rejuvenationRing.current,
            readRejuvenationBadge(rows),
            lastRejuvenationStacks,
        );
        syncSilenceBadge(silenceBadge.current, silenceRing.current, readSilenceBadge(rows));
        syncHolyBadge(holyBadge.current, holyRing.current, readHolyBadge(rows));
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
            <StatusHpBadgeStack
                poisonBadgeRef={poisonBadge}
                poisonStacksRef={poisonStacksEl}
                poisonRingRef={poisonRing}
                burningBadgeRef={burningBadge}
                burningRingRef={burningRing}
                bleedingBadgeRef={bleedingBadge}
                bleedingStacksRef={bleedingStacksEl}
                bleedingRingRef={bleedingRing}
                rejuvenationBadgeRef={rejuvenationBadge}
                rejuvenationStacksRef={rejuvenationStacksEl}
                rejuvenationRingRef={rejuvenationRing}
                silenceBadgeRef={silenceBadge}
                silenceRingRef={silenceRing}
                holyBadgeRef={holyBadge}
                holyRingRef={holyRing}
            />
        </group>
    );
}
