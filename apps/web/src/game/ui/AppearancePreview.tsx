import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CosmeticsEquipped } from "@battlebeasts/shared";
import { heroAnimationConfig } from "../animation";
import {
  CHARACTER_URL,
  prepareCharacterScene,
  tintCharacterSurface,
} from "../characterVisual";
import { EquippedCosmetics } from "../EquippedCosmetics";

useGLTF.preload(CHARACTER_URL);

type PreviewProps = {
  color: string;
  pattern: string;
  patternColor: string;
  cosmeticsEquipped?: CosmeticsEquipped;
};

function PreviewAvatar({ color, pattern, patternColor, cosmeticsEquipped }: PreviewProps) {
  const group = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const framedRef = useRef(false);
  const { camera, size: viewSize } = useThree();
  const gltf = useGLTF(CHARACTER_URL);

  const idleClip = useMemo(
    () =>
      gltf.animations.find((c) => c.name === heroAnimationConfig.idle) ??
      gltf.animations[0] ??
      null,
    [gltf.animations],
  );

  const scene = useMemo(() => {
    return prepareCharacterScene(gltf.scene, { restClip: idleClip, upAxis: "y" });
  }, [gltf.scene, idleClip]);

  useEffect(() => {
    if (!idleClip) return;
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(idleClip);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    mixer.update(0);
    mixerRef.current = mixer;
    framedRef.current = false;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
    };
  }, [scene, idleClip]);

  useLayoutEffect(() => {
    framedRef.current = false;
  }, [scene, viewSize.width, viewSize.height, cosmeticsEquipped]);

  useFrame((_, dt) => {
    mixerRef.current?.update(dt);

    const g = group.current;
    if (g) g.rotation.y += dt * 0.35;

    if (framedRef.current) return;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const dims = box.getSize(new THREE.Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.updateMatrixWorld(true);

    const fitted = new THREE.Box3().setFromObject(scene);
    const height = Math.max(fitted.getSize(new THREE.Vector3()).y, 1.2);
    const midY = fitted.min.y + height * 0.48;

    const persp = camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(persp.fov);
    const fitH = height * 1.18;
    const dist = Math.max((fitH * 0.5) / Math.tan(fovRad * 0.5), dims.x * 1.35, 2.6);

    persp.position.set(dist * 0.28, midY + height * 0.02, dist);
    persp.lookAt(0, midY, 0);
    persp.updateProjectionMatrix();
    framedRef.current = true;
  });

  useEffect(() => {
    tintCharacterSurface(scene, color, pattern, patternColor);
  }, [scene, color, pattern, patternColor]);

  return (
    <group ref={group}>
      <primitive object={scene} />
      <EquippedCosmetics characterRoot={scene} equipped={cosmeticsEquipped} />
    </group>
  );
}

/** Tall orbiting hero for the Appearance stand panel. */
export function AppearancePreview({
  color,
  pattern,
  patternColor,
  cosmeticsEquipped,
}: PreviewProps) {
  return (
    <div className="bb-appearance-preview relative w-full overflow-hidden rounded-sm border border-[var(--bb-panel-line)] bg-[#061220]">
      <Canvas
        camera={{ position: [0.8, 1.0, 3.4], fov: 32, near: 0.1, far: 40 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <color attach="background" args={["#0a1628"]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[2.8, 4.2, 2.2]} intensity={1.25} />
        <directionalLight position={[-2.2, 1.8, -1.2]} intensity={0.45} />
        <Suspense fallback={null}>
          <PreviewAvatar
            color={color}
            pattern={pattern}
            patternColor={patternColor}
            cosmeticsEquipped={cosmeticsEquipped}
          />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 py-1.5 text-[10px] text-white/80">
        Live preview
      </div>
    </div>
  );
}
