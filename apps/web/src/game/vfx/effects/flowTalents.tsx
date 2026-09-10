import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Room } from "colyseus.js";
import {
  MOVE_SPEED,
  STARTER_COLORS,
  type CosmeticsEquipped,
} from "@battlebeasts/shared";
import type { OneShotEffect } from "../types";
import { softEnvelope } from "../easing";
import { CharacterAnimationController, heroAnimationConfig } from "../../animation";
import {
  CHARACTER_URL,
  disposeCharacterMaterials,
  prepareCharacterScene,
  setCharacterOpacity,
  tintCharacterSurface,
} from "../../characterVisual";
import { cosmeticsKey, equippedFromPlayer } from "../../cosmeticAttach";
import { EquippedCosmetics } from "../../EquippedCosmetics";
import { VesselBody } from "../../VesselBody";

type Follow = { room: Room | null };

type OwnerLook = {
  color?: string;
  pattern?: string;
  patternColor?: string;
  vessel?: string;
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
};

const _vel = new THREE.Vector3();
const _zeroVel = new THREE.Vector3();

useGLTF.preload(CHARACTER_URL);

/**
 * Untargetable Flow afterimage — same hero clone as Decoy (Q), no HP bar.
 * Static (v0), trajectory (v1), or moving phantom (v2).
 * Destination is `originX/originZ` (combat fx x2/z2).
 */
export function AfterimageEffect({
  shot,
  follow,
}: {
  shot: OneShotEffect;
  follow: Follow;
}) {
  const group = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const lastPos = useRef(new THREE.Vector3(shot.x, 0, shot.z));
  const lastOpacity = useRef(-1);
  const colorRef = useRef<string>(STARTER_COLORS[0]!);
  const patternRef = useRef("plain");
  const patternColorRef = useRef("#1f2937");
  const cosmeticsKeyRef = useRef("");
  const [equipped, setEquipped] = useState<CosmeticsEquipped>({});
  const [vessel, setVessel] = useState("female");

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
    setCharacterOpacity(scene, 1);
    return () => {
      controller.dispose();
      controllerRef.current = null;
      disposeCharacterMaterials(scene);
    };
  }, [scene, gltf.animations]);

  const fromX = shot.x;
  const fromZ = shot.z;
  const toX = shot.originX ?? shot.x;
  const toZ = shot.originZ ?? shot.z;
  const variant = shot.variant ?? 0;
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const len = Math.hypot(dx, dz);
  const hx = len > 1e-4 ? dx / len : Math.sin(shot.yaw);
  const hz = len > 1e-4 ? dz / len : Math.cos(shot.yaw);

  useFrame((_, dt) => {
    const g = group.current;
    const controller = controllerRef.current;
    if (!g || !controller) return;

    const t = Math.max(0, Math.min(1, (performance.now() - shot.born) / Math.max(16, shot.life)));
    const fade = softEnvelope(t, 0.08, 0.18);
    if (Math.abs(fade - lastOpacity.current) > 0.01) {
      lastOpacity.current = fade;
      setCharacterOpacity(scene, fade);
    }
    g.visible = fade > 0.02;
    if (!g.visible) return;

    const owner = shot.followOwnerId
      ? (follow.room?.state?.players?.get(shot.followOwnerId) as OwnerLook | undefined)
      : undefined;
    const color = owner?.color || shot.color || STARTER_COLORS[0]!;
    const pattern = owner?.pattern ?? "plain";
    const patternColor = owner?.patternColor ?? "#1f2937";
    if (
      color !== colorRef.current ||
      pattern !== patternRef.current ||
      patternColor !== patternColorRef.current
    ) {
      colorRef.current = color;
      patternRef.current = pattern;
      patternColorRef.current = patternColor;
      tintCharacterSurface(scene, color, pattern, patternColor);
      lastOpacity.current = -1;
    }

    const nextVessel = owner?.vessel ?? "female";
    if (nextVessel !== vessel) setVessel(nextVessel);

    const nextCosmetics = cosmeticsKey(owner);
    if (nextCosmetics !== cosmeticsKeyRef.current) {
      cosmeticsKeyRef.current = nextCosmetics;
      setEquipped(equippedFromPlayer(owner));
    }

    let x = fromX;
    let z = fromZ;
    if (variant === 1) {
      const u = Math.min(1, t / 0.85);
      x = fromX + dx * u;
      z = fromZ + dz * u;
    } else if (variant === 2) {
      const dist = (len > 0.2 ? len : 4.5) * (0.35 + t * 1.15);
      x = fromX + hx * dist;
      z = fromZ + hz * dist;
    }

    const safeDt = Math.max(1e-4, Math.min(0.05, dt));
    const vx = (x - lastPos.current.x) / safeDt;
    const vz = (z - lastPos.current.z) / safeDt;
    lastPos.current.set(x, 0, z);

    const speed = Math.hypot(vx, vz);
    const yaw = speed > 0.08 ? Math.atan2(vx, vz) : shot.yaw;

    g.position.set(x, 0, z);
    if (bodyRef.current) bodyRef.current.rotation.y = yaw;

    _vel.set(vx, 0, vz);
    controller.setMovement({
      worldVelocity: speed > 0.08 ? _vel : _zeroVel,
      facingYaw: yaw,
      maximumSpeed: MOVE_SPEED,
    });
    controller.update(safeDt);
  });

  return (
    <group ref={group} position={[fromX, 0, fromZ]}>
      <group ref={bodyRef} rotation={[0, shot.yaw, 0]}>
        <primitive object={scene} />
        <VesselBody characterRoot={scene} body={vessel} color={colorRef.current} />
        <EquippedCosmetics characterRoot={scene} equipped={equipped} body={vessel} />
      </group>
    </group>
  );
}
