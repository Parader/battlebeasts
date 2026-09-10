import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Room } from "colyseus.js";
import * as THREE from "three";
import { WORLD_TREE_CAST } from "@battlebeasts/shared";
import { createWorldTreeGroundMaterial } from "./materials/worldTreeGround";

type WorldTreeSchema = {
  id: string;
  ownerSessionId: string;
  x: number;
  z: number;
  healRadius?: number;
  durability?: number;
  maxDurability?: number;
  expiresAt?: number;
};

const SPAWN_GROW_MS = 450;

function WorldTreeEntity({ room, id }: { room: Room; id: string }) {
  const root = useRef<THREE.Group>(null);
  const canopy = useRef<THREE.Group>(null);
  const born = useRef(performance.now());

  const trunkMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2E1A0C",
        roughness: 0.85,
        metalness: 0.1,
      }),
    [],
  );

  const foliageMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2D6A4F",
        emissive: "#1B4332",
        emissiveIntensity: 0.35,
        roughness: 0.65,
      }),
    [],
  );

  const foliageLightMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#52B788",
        emissive: "#2D6A4F",
        emissiveIntensity: 0.25,
        roughness: 0.6,
      }),
    [],
  );

  const seedMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#FDE68A",
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const boundaryMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#4ADE80",
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const groundShaderMat = useMemo(() => createWorldTreeGroundMaterial(), []);

  const pipActiveMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#4ADE80",
        depthTest: false,
      }),
    [],
  );

  const pipEmptyMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#1F2937",
        depthTest: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      trunkMat.dispose();
      foliageMat.dispose();
      foliageLightMat.dispose();
      seedMat.dispose();
      boundaryMat.dispose();
      groundShaderMat.dispose();
      pipActiveMat.dispose();
      pipEmptyMat.dispose();
    };
  }, [
    trunkMat,
    foliageMat,
    foliageLightMat,
    seedMat,
    boundaryMat,
    groundShaderMat,
    pipActiveMat,
    pipEmptyMat,
  ]);

  const seedsRef = useRef<THREE.Mesh[]>([]);

  useFrame(() => {
    const tree = room.state?.worldTrees?.get(id) as WorldTreeSchema | undefined;
    const g = root.current;
    if (!tree || !g || (tree.durability ?? 0) <= 0) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(tree.x, 0, tree.z);

    const now = performance.now();
    const age = now - born.current;
    const grow = Math.min(1, age / SPAWN_GROW_MS);
    const easeGrow = 1 - (1 - grow) * (1 - grow);
    g.scale.set(easeGrow, easeGrow, easeGrow);

    // Subtle wind sway on canopy
    if (canopy.current) {
      const t = now * 0.0015;
      canopy.current.rotation.y = Math.sin(t * 0.5) * 0.08;
      canopy.current.rotation.z = Math.sin(t * 0.7) * 0.04;
    }

    // Orbiting golden seeds around the canopy
    const tSeed = now * 0.002;
    seedsRef.current.forEach((m, idx) => {
      if (!m) return;
      const ang = tSeed + (idx / 4) * Math.PI * 2;
      const r = 1.35 + Math.sin(tSeed * 2 + idx) * 0.15;
      m.position.set(Math.cos(ang) * r, 2.6 + Math.sin(tSeed * 1.5 + idx) * 0.25, Math.sin(ang) * r);
    });

    // Pulse heal radius boundary & ground shader
    boundaryMat.opacity = 0.28 + 0.12 * Math.sin(now * 0.0025);
    groundShaderMat.uniforms.uTime.value = now * 0.001;
    groundShaderMat.uniforms.uOpacity.value = 0.35 + 0.08 * Math.sin(now * 0.002);
  });

  const tree = room.state?.worldTrees?.get(id) as WorldTreeSchema | undefined;
  const maxDurability = tree?.maxDurability ?? WORLD_TREE_CAST.structureDurability;
  const currentDurability = tree?.durability ?? maxDurability;
  const healRadius = tree?.healRadius ?? WORLD_TREE_CAST.healRadius;

  return (
    <group ref={root} visible={false}>
      {/* 7.0m Ground Healing Textured Area Fill */}
      <mesh rotation={[-Math.PI * 0.5, 0, 0]} position={[0, 0.02, 0]} renderOrder={29}>
        <circleGeometry args={[healRadius, 64]} />
        <primitive object={groundShaderMat} attach="material" />
      </mesh>
      {/* 7.0m Outer Laser Boundary Ring */}
      <mesh rotation={[-Math.PI * 0.5, 0, 0]} position={[0, 0.025, 0]} renderOrder={30}>
        <ringGeometry args={[healRadius * 0.985, healRadius, 64]} />
        <primitive object={boundaryMat} attach="material" />
      </mesh>

      {/* Stylized Trunk */}
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow renderOrder={32}>
        <cylinderGeometry args={[0.32, 0.65, 2.2, 8]} />
        <primitive object={trunkMat} attach="material" />
      </mesh>
      {/* Branch flares */}
      <mesh position={[0.3, 1.8, 0.15]} rotation={[0.35, 0, 0.4]} renderOrder={32}>
        <cylinderGeometry args={[0.18, 0.28, 1.2, 6]} />
        <primitive object={trunkMat} attach="material" />
      </mesh>
      <mesh position={[-0.25, 1.9, -0.2]} rotation={[-0.3, 0.5, -0.45]} renderOrder={32}>
        <cylinderGeometry args={[0.16, 0.26, 1.1, 6]} />
        <primitive object={trunkMat} attach="material" />
      </mesh>

      {/* Foliage Canopy Clusters — organic multi-faceted low-poly foliage */}
      <group ref={canopy}>
        <mesh position={[0, 2.6, 0]} renderOrder={33}>
          <dodecahedronGeometry args={[1.35, 1]} />
          <primitive object={foliageMat} attach="material" />
        </mesh>
        <mesh position={[0.55, 2.8, 0.45]} renderOrder={34}>
          <dodecahedronGeometry args={[0.85, 1]} />
          <primitive object={foliageLightMat} attach="material" />
        </mesh>
        <mesh position={[-0.55, 2.7, -0.35]} renderOrder={34}>
          <dodecahedronGeometry args={[0.9, 1]} />
          <primitive object={foliageLightMat} attach="material" />
        </mesh>
        <mesh position={[0, 3.25, 0]} renderOrder={34}>
          <dodecahedronGeometry args={[0.75, 1]} />
          <primitive object={foliageLightMat} attach="material" />
        </mesh>
        <mesh position={[0.35, 2.4, -0.4]} renderOrder={34}>
          <dodecahedronGeometry args={[0.65, 1]} />
          <primitive object={foliageMat} attach="material" />
        </mesh>

        {/* 4 Orbiting Golden Life Seeds */}
        {[0, 1, 2, 3].map((idx) => (
          <mesh
            key={idx}
            ref={(el) => {
              if (el) seedsRef.current[idx] = el;
            }}
            renderOrder={36}
          >
            <sphereGeometry args={[0.14, 8, 8]} />
            <primitive object={seedMat} attach="material" />
          </mesh>
        ))}
      </group>

      {/* Durability Billboard floating above tree */}
      <Billboard position={[0, 3.85, 0]} follow renderOrder={1000}>
        <group>
          {/* Background bar */}
          <mesh position={[0, 0, -0.01]}>
            <planeGeometry args={[1.1, 0.14]} />
            <meshBasicMaterial color="#111827" depthTest={false} />
          </mesh>
          {/* 5 durability pips */}
          {Array.from({ length: maxDurability }).map((_, idx) => {
            const pipWidth = 0.95 / maxDurability;
            const px = (idx - (maxDurability - 1) * 0.5) * pipWidth;
            const isFilled = idx < currentDurability;
            return (
              <mesh key={idx} position={[px, 0, 0.01]}>
                <planeGeometry args={[pipWidth * 0.85, 0.08]} />
                <primitive object={isFilled ? pipActiveMat : pipEmptyMat} attach="material" />
              </mesh>
            );
          })}
        </group>
      </Billboard>
    </group>
  );
}

function WorldTreesInner({ room }: { room: Room }) {
  const [ids, setIds] = useState<string[]>([]);
  const prevKey = useRef("");

  useFrame(() => {
    if (!room.state?.worldTrees) return;
    const next: string[] = [];
    room.state.worldTrees.forEach((_d: unknown, id: string) => next.push(id));
    next.sort();
    const key = next.join("|");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setIds(next);
    }
  });

  return (
    <>
      {ids.map((id) => (
        <WorldTreeEntity key={id} room={room} id={id} />
      ))}
    </>
  );
}

/**
 * Schema-synced World Trees — persistent smart healing entity.
 */
export function WorldTrees({ room }: { room: Room | null }) {
  if (!room) return null;
  return (
    <Suspense fallback={null}>
      <WorldTreesInner room={room} />
    </Suspense>
  );
}
