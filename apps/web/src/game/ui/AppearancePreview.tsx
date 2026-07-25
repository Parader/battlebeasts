import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { heroAnimationConfig } from "../animation";
import {
  CHARACTER_URL,
  prepareCharacterScene,
  tintCharacterSurface,
} from "../characterVisual";

useGLTF.preload(CHARACTER_URL);

type PreviewProps = {
  color: string;
  pattern: string;
  patternColor: string;
};

function PreviewAvatar({ color, pattern, patternColor }: PreviewProps) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const gltf = useGLTF(CHARACTER_URL);
  const scene = useMemo(() => {
    const idle =
      gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
      gltf.animations[0] ??
      null;
    return prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
  }, [gltf.scene, gltf.animations]);

  useLayoutEffect(() => {
    // Center the mesh on the group origin so framing stays stable while spinning.
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    scene.position.set(-center.x, -center.y, -center.z);

    const halfH = Math.max(size.y * 0.5, 0.6);
    const dist = Math.max(size.y * 1.55, size.x * 2.1, 2.4);
    camera.position.set(0, halfH * 0.08, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [scene, camera]);

  useEffect(() => {
    tintCharacterSurface(scene, color, pattern, patternColor);
  }, [scene, color, pattern, patternColor]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y += dt * 0.5;
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

/** Large orbiting hero for the Appearance stand panel. */
export function AppearancePreview({ color, pattern, patternColor }: PreviewProps) {
  return (
    <div className="bb-appearance-preview relative h-72 w-full min-h-[18rem] overflow-hidden rounded-sm border border-[var(--bb-brass-dim)] bg-[#1a1520] sm:h-[22rem]">
      <Canvas
        camera={{ position: [0, 0.1, 2.8], fov: 30, near: 0.1, far: 40 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={["#1a1520"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2.5, 4, 2]} intensity={1.2} />
        <directionalLight position={[-2, 1.5, -1]} intensity={0.4} />
        <Suspense fallback={null}>
          <PreviewAvatar color={color} pattern={pattern} patternColor={patternColor} />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5 text-[10px] text-white/80">
        Live preview
      </div>
    </div>
  );
}
