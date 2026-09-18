import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { CHARACTER_URL, prepareCharacterScene, setCharacterOpacity } from "./characterVisual";
import { cloneFittedRockPile, ROCK_WALL_GLB_URL } from "./vfx/rockWallAsset";
import {
  cloneFittedShroom,
  getShroomTemplates,
  SHROOM_GREEN_GLB_URL,
  SHROOM_RED_GLB_URL,
} from "./vfx/shroomAsset";
import {
  cloneFittedTemplate,
  pickVolcanoTemplate,
  VOLCANO_GLB_URL,
  VOLCANO_TARGET_SIZE,
} from "./vfx/volcanoAsset";
import { ZOMBIE_URL, zombieAnimationConfig } from "./zombieAsset";

const PARK = [0, -500, 0] as const;

/**
 * Hidden live meshes whose programs only appear on first cast / first wave.
 * Invisible in gameplay; compileLiveScene flashes the group for the compile pass.
 */
export function GpuWarmDummies({ includeZombie }: { includeZombie: boolean }) {
  return (
    <group name="GpuWarmDummies" position={PARK} visible={false}>
      <SpellGlbDummies />
      <OverlaySkinDummy />
      <GhostCharacterDummy />
      {includeZombie ? <ZombieDummy /> : null}
    </group>
  );
}

function SpellGlbDummies() {
  const rock = useGLTF(ROCK_WALL_GLB_URL);
  const green = useGLTF(SHROOM_GREEN_GLB_URL);
  const red = useGLTF(SHROOM_RED_GLB_URL);
  const volcano = useGLTF(VOLCANO_GLB_URL);

  const root = useMemo(() => {
    const g = new THREE.Group();
    g.add(cloneFittedRockPile(rock.scene));
    const shrooms = getShroomTemplates(green.scene, red.scene);
    const greenT = shrooms.green[0];
    const redT = shrooms.red[0];
    if (greenT) g.add(cloneFittedShroom(greenT));
    if (redT) g.add(cloneFittedShroom(redT));
    const volcanoT = pickVolcanoTemplate(volcano.scene);
    if (volcanoT) {
      g.add(
        cloneFittedTemplate(volcanoT, VOLCANO_TARGET_SIZE, {
          uprightVolcano: true,
          cloneMats: true,
        }),
      );
    }
    return g;
  }, [rock.scene, green.scene, red.scene, volcano.scene]);

  return <primitive object={root} />;
}

/**
 * Live MeshStandard + skinning + shadows with transparent=true.
 * OverlaySkinDummy swaps in MeshBasic (counter/spirit overlay) — that is a
 * different program, so the first Teleport Slam / cloak fade still compiled
 * the real ghosted hero on first use. Keep this parented so map warmup
 * compileAsync picks it up.
 */
function GhostCharacterDummy() {
  const gltf = useGLTF(CHARACTER_URL);
  const root = useMemo(() => {
    const idle = gltf.animations[0] ?? null;
    const scene = prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
    setCharacterOpacity(scene, 0.32);
    return scene;
  }, [gltf.scene, gltf.animations]);

  return <primitive object={root} />;
}

function OverlaySkinDummy() {
  const gltf = useGLTF(CHARACTER_URL);
  const root = useMemo(() => {
    const idle = gltf.animations[0] ?? null;
    const scene = prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
    const overlay = new THREE.MeshBasicMaterial({
      color: "#f5c542",
      transparent: true,
      opacity: 0.01,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.FrontSide,
      fog: false,
    });
    scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.material) return;
      mesh.material = overlay;
    });
    return scene;
  }, [gltf.scene, gltf.animations]);

  return <primitive object={root} />;
}

function ZombieDummy() {
  const gltf = useGLTF(ZOMBIE_URL);
  const root = useMemo(() => {
    const idle =
      gltf.animations.find((c) => c.name === zombieAnimationConfig.idle) ??
      gltf.animations[0] ??
      null;
    return prepareCharacterScene(gltf.scene, { restClip: idle, upAxis: "y" });
  }, [gltf.scene, gltf.animations]);

  return <primitive object={root} />;
}
