import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { getEmote, type CosmeticsEquipped } from "@battlebeasts/shared";
import { emoteAnimationClips, heroAnimationConfig } from "../animation";
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
  /** When set, loop this emote clip instead of idle. */
  previewEmoteId?: string | null;
};

function resolveEmoteClipName(emoteId: string | null | undefined): string | null {
  if (!emoteId) return null;
  const def = getEmote(emoteId);
  if (!def) return null;
  return emoteAnimationClips[emoteId] ?? def.animClip;
}

function PreviewAvatar({
  color,
  pattern,
  patternColor,
  cosmeticsEquipped,
  previewEmoteId,
}: PreviewProps) {
  const spinRef = useRef<THREE.Group>(null);
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

  const emoteClipName = resolveEmoteClipName(previewEmoteId);
  const emoteClip = useMemo(() => {
    if (!emoteClipName) return null;
    return (
      gltf.animations.find((c) => c.name === emoteClipName) ??
      gltf.animations.find((c) => c.name.toLowerCase() === emoteClipName.toLowerCase()) ??
      null
    );
  }, [gltf.animations, emoteClipName]);

  const scene = useMemo(() => {
    return prepareCharacterScene(gltf.scene, { restClip: idleClip, upAxis: "y" });
  }, [gltf.scene, idleClip]);

  useEffect(() => {
    const clip = emoteClip ?? idleClip;
    if (!clip) return;
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.timeScale = 1;
    action.play();
    mixer.update(0);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
    };
  }, [scene, idleClip, emoteClip]);

  // Frame once per model / viewport — never on cosmetic swaps (that drifted the avatar).
  useLayoutEffect(() => {
    framedRef.current = false;
  }, [scene, viewSize.width, viewSize.height]);

  useFrame((_, dt) => {
    mixerRef.current?.update(dt);

    const spin = spinRef.current;
    if (spin) spin.rotation.y += dt * (emoteClip ? 0.12 : 0.35);

    if (framedRef.current) return;

    const savedYaw = spin?.rotation.y ?? 0;
    if (spin) spin.rotation.y = 0;

    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.y)) {
      if (spin) spin.rotation.y = savedYaw;
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const dims = box.getSize(new THREE.Vector3());
    if (!Number.isFinite(center.x) || !Number.isFinite(dims.y)) {
      if (spin) spin.rotation.y = savedYaw;
      return;
    }

    scene.position.set(-center.x, 0, -center.z);
    scene.updateMatrixWorld(true);

    const fitted = new THREE.Box3().setFromObject(scene);
    const height = Math.max(fitted.getSize(new THREE.Vector3()).y, 1.2);
    const midY = fitted.min.y + height * 0.48;
    if (!Number.isFinite(height) || !Number.isFinite(midY)) {
      if (spin) spin.rotation.y = savedYaw;
      return;
    }

    const persp = camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(persp.fov);
    const fitH = height * 1.18;
    const dist = Math.max((fitH * 0.5) / Math.tan(fovRad * 0.5), dims.x * 1.35, 2.6);

    persp.position.set(dist * 0.28, midY + height * 0.02, dist);
    persp.lookAt(0, midY, 0);
    persp.updateProjectionMatrix();

    if (spin) spin.rotation.y = savedYaw;
    framedRef.current = true;
  });

  useEffect(() => {
    tintCharacterSurface(scene, color, pattern, patternColor);
  }, [scene, color, pattern, patternColor]);

  return (
    <group ref={spinRef}>
      <primitive object={scene} />
      <EquippedCosmetics characterRoot={scene} equipped={cosmeticsEquipped} />
    </group>
  );
}

/** Tall orbiting hero for the Appearance stand panel / Merchant preview. */
export function AppearancePreview({
  color,
  pattern,
  patternColor,
  cosmeticsEquipped,
  previewEmoteId,
}: PreviewProps) {
  return (
    <div className="bb-appearance-preview relative w-full overflow-hidden rounded-sm border border-[var(--bb-panel-line)] bg-[#061220]">
      <Canvas
        camera={{ position: [0.8, 1.0, 3.4], fov: 32, near: 0.1, far: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
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
            previewEmoteId={previewEmoteId}
          />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 py-1.5 text-[10px] text-white/80">
        {previewEmoteId ? "Emote preview" : "Live preview"}
      </div>
    </div>
  );
}
