import { mapNpcs, type MapDoc, type NpcPlacement } from "@battlebeasts/shared";
import { Html, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { assetUrl } from "./assetUrl";
import {
  createNpcAnimationController,
  prepareNpcCharacterScene,
} from "./npcScene";
import { subscribeTalkingNpc, talkingNpcId } from "./npcRuntime";

function Npc({ npc }: { npc: NpcPlacement }) {
  const gltf = useGLTF(assetUrl(npc.model.file));
  const controllerRef = useRef<ReturnType<typeof createNpcAnimationController> | null>(null);
  const talking = useRef(false);

  const scene = useMemo(
    () => prepareNpcCharacterScene(gltf.scene, gltf.animations, npc.model),
    [gltf.scene, gltf.animations, npc.model],
  );

  const applyTalkGesture = (want: boolean) => {
    const controller = controllerRef.current;
    if (!controller) return false;
    if (want === talking.current) return true;
    talking.current = want;
    if (want) {
      // castPrimary resolves to the model's talk clip; upper-body keeps idle legs planted.
      controller.playUpperBodyAction("castPrimary", { loop: true });
    } else {
      controller.cancelUpperBodyAction();
    }
    return true;
  };

  useEffect(() => {
    const controller = createNpcAnimationController(scene, gltf.animations, npc.model);
    controllerRef.current = controller;
    applyTalkGesture(talkingNpcId() === npc.id);
    return () => {
      controller.dispose();
      controllerRef.current = null;
      talking.current = false;
    };
  }, [scene, gltf.animations, npc.model]);

  useEffect(() => {
    const sync = () => {
      applyTalkGesture(talkingNpcId() === npc.id);
    };
    sync();
    return subscribeTalkingNpc(sync);
  }, [npc.id]);

  useFrame((_, dt) => {
    controllerRef.current?.update(Math.min(0.05, Math.max(0, dt)));
  });

  return (
    <group position={[npc.x, npc.y, npc.z]}>
      <group rotation={[0, npc.yaw, 0]}>
        <primitive object={scene} />
      </group>
      <Html position={[0, 2.1, 0]} center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
        <div className="bb-nameplate">{npc.name}</div>
      </Html>
    </group>
  );
}

export function DocNpcs({ doc }: { doc: MapDoc }) {
  const npcs = useMemo(() => mapNpcs(doc), [doc]);
  return (
    <>
      {npcs.map((npc) => (
        <Npc key={npc.id} npc={npc} />
      ))}
    </>
  );
}
