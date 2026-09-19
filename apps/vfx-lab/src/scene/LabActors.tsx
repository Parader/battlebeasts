import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CHARACTER_URL, prepareCharacterScene } from "@web/game/characterVisual";
import { CharacterAnimationController, heroAnimationConfig } from "@web/game/animation";
import { registerCharacterRoot } from "@web/game/characterRoots";
import { syncAbilityCast } from "@web/game/syncPlayerCast";
import { ASCENDANT_FORM_CAST } from "@battlebeasts/shared";
import { CASTER_ID, CROWD_PREFIX, EXTRA_DUMMY_PREFIX, TARGET_ID, labSim, type LabActor } from "../sim/labSim";
import { labStore, useLabStore } from "../state/labStore";

useGLTF.preload(CHARACTER_URL);

const _zeroVel = new THREE.Vector3();
const _moveVel = new THREE.Vector3();

function LabBody({
  actorId,
  color,
  getActor,
}: {
  actorId: string;
  color: string;
  getActor: () => LabActor;
}) {
  const group = useRef<THREE.Group>(null);
  const lastCastId = useRef("");
  const controllerRef = useRef<CharacterAnimationController | null>(null);
  const gltfRaw = useGLTF(CHARACTER_URL);
  const gltf = Array.isArray(gltfRaw) ? gltfRaw[0]! : gltfRaw;
  const scene = useMemo(() => {
    const idle =
      gltf.animations.find((c: { name: string }) => c.name === heroAnimationConfig.idle) ??
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
    registerCharacterRoot(actorId, scene);
    return () => {
      registerCharacterRoot(actorId, null);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scene, gltf.animations, actorId]);

  useFrame((_, dt) => {
    const actor = getActor();
    const g = group.current;
    const controller = controllerRef.current;
    if (!actor || !g || !controller) return;
    g.position.set(actor.x, 0, actor.z);
    g.rotation.y = actor.yaw;
    syncAbilityCast(controller, actor, lastCastId, undefined, actorId);
    const moving = Math.abs(actor.vx) + Math.abs(actor.vz) > 0.04;
    _moveVel.set(actor.vx, 0, actor.vz);
    controller.setMovementFromYaw(moving ? _moveVel : _zeroVel, actor.yaw, 1);
    controller.update(dt);
    if (actorId === CASTER_ID) {
      const targetScale =
        labSim.ascendantUntil > performance.now() ? ASCENDANT_FORM_CAST.modelScaleMul : 1;
      g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, targetScale, 10, dt));
    }
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <ringGeometry args={[0.42, 0.52, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </group>
  );
}

function DragPlane({ onMove }: { onMove: (x: number, z: number) => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.01, 0]}
      onPointerMove={(e) => {
        e.stopPropagation();
        onMove(e.point.x, e.point.z);
      }}
    >
      <planeGeometry args={[4000, 4000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function MovableTarget() {
  const [dragging, setDragging] = useState(false);
  const pick = useRef<THREE.Mesh>(null);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  useEffect(() => {
    if (!controls || !dragging) return;
    controls.enabled = false;
    return () => {
      controls.enabled = true;
    };
  }, [controls, dragging]);

  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      setDragging(false);
      document.body.style.cursor = "";
      labStore.set({ targetEpoch: labStore.get().targetEpoch + 1 });
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging]);

  useFrame(() => {
    const m = pick.current;
    if (!m) return;
    const t = labSim.target();
    m.position.set(t.x, 0.9, t.z);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setDragging(true);
    document.body.style.cursor = "grabbing";
    labSim.setTargetPos(e.point.x, e.point.z);
  };

  return (
    <group>
      <LabBody actorId={TARGET_ID} color="#f87171" getActor={() => labSim.target()} />
      <mesh
        ref={pick}
        onPointerDown={onDown}
        onPointerOver={() => {
          document.body.style.cursor = "grab";
        }}
        onPointerOut={() => {
          if (!dragging) document.body.style.cursor = "";
        }}
      >
        <cylinderGeometry args={[0.55, 0.55, 1.8, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {dragging ? <DragPlane onMove={(x, z) => labSim.setTargetPos(x, z)} /> : null}
    </group>
  );
}

export function LabActors() {
  const dummyCount = useLabStore((s) => s.dummyCount);
  const casterCount = useLabStore((s) => s.casterCount);
  const extraDummies = Array.from({ length: Math.max(0, dummyCount - 1) }, (_, i) => `${EXTRA_DUMMY_PREFIX}${i}`);
  const crowd = Array.from({ length: Math.max(0, casterCount - 1) }, (_, i) => `${CROWD_PREFIX}${i}`);
  return (
    <>
      <LabBody actorId={CASTER_ID} color="#5fd08a" getActor={() => labSim.caster()} />
      <MovableTarget />
      {extraDummies.map((id) => (
        <LabBody
          key={id}
          actorId={id}
          color="#fb7185"
          getActor={() => labSim.targets.get(id) ?? labSim.target()}
        />
      ))}
      {crowd.map((id) => (
        <LabBody
          key={id}
          actorId={id}
          color="#93c5fd"
          getActor={() => labSim.players.get(id) ?? labSim.caster()}
        />
      ))}
    </>
  );
}
