import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { VFX_LAVA_URL } from "../vfxUrls";

export { VFX_LAVA_URL };

let lavaTex: THREE.Texture | null = null;

function configureLavaTex(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function getLavaTexture(): THREE.Texture {
  if (!lavaTex) {
    lavaTex = configureLavaTex(new THREE.TextureLoader().load(VFX_LAVA_URL));
  }
  return lavaTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setLavaTexture(tex: THREE.Texture): void {
  lavaTex = configureLavaTex(tex);
}

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FS = /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uProgress;
uniform float uSideFade;
uniform float uEndFade;
uniform vec2 uRepeat;
varying vec2 vUv;

void main() {
  // Grow from center along length (u)
  float along = abs(vUv.x - 0.5) * 2.0;
  if (along > uProgress + 0.02) discard;
  float growEdge = 1.0 - smoothstep(uProgress - 0.08, uProgress + 0.02, along);

  // Soft fade on the long sides (v) and ends (u)
  float side =
    smoothstep(0.0, uSideFade, vUv.y) *
    smoothstep(0.0, uSideFade, 1.0 - vUv.y);
  float ends =
    smoothstep(0.0, uEndFade, vUv.x) *
    smoothstep(0.0, uEndFade, 1.0 - vUv.x);

  vec2 uv = vUv * uRepeat;
  vec4 tex = texture2D(uMap, uv);

  // Dark rock mostly transparent; hot cracks/flow stay opaque
  float heat = max(tex.r, max(tex.g * 0.55, tex.b * 0.25));
  heat = smoothstep(0.08, 0.55, heat);

  float a = heat * side * ends * growEdge * uOpacity;
  if (a < 0.02) discard;

  vec3 col = tex.rgb * (0.85 + heat * 0.55);
  gl_FragColor = vec4(col, a);
}
`;

export type LavaGroundStripProps = {
  length: number;
  width: number;
  y?: number;
  progressRef?: { current: number };
  opacityMulRef?: { current: number };
  /** UV fade width on each long edge (0..0.5). */
  sideFade?: number;
  /** UV fade on each end (0..0.5). */
  endFade?: number;
};

/**
 * Textured lava corridor — replaces procedural frost-style ground decal.
 * Fades on the long sides; grows from center with progress.
 */
export function LavaGroundStrip({
  length,
  width,
  y = 0.036,
  progressRef,
  opacityMulRef,
  sideFade = 0.28,
  endFade = 0.06,
}: LavaGroundStripProps) {
  const mesh = useRef<THREE.Mesh>(null);

  const material = useMemo(() => {
    const map = getLavaTexture();
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uOpacity: { value: 0 },
        uProgress: { value: 0 },
        uSideFade: { value: sideFade },
        uEndFade: { value: endFade },
        uRepeat: { value: new THREE.Vector2(Math.max(1, length / Math.max(width, 0.01)), 1) },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }, [sideFade, endFade, length, width]);

  useEffect(() => {
    material.uniforms.uSideFade!.value = sideFade;
    material.uniforms.uEndFade!.value = endFade;
    (material.uniforms.uRepeat!.value as THREE.Vector2).set(
      Math.max(1, length / Math.max(width, 0.01)),
      1,
    );
  }, [material, sideFade, endFade, length, width]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const progress = progressRef?.current ?? 1;
    const opacity = opacityMulRef?.current ?? 1;
    material.uniforms.uProgress!.value = progress;
    material.uniforms.uOpacity!.value = opacity * 0.92;
    m.visible = opacity > 0.02 && progress > 0.02;
  });

  return (
    <mesh
      ref={mesh}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y, 0]}
      scale={[length, width, 1]}
      material={material}
      visible={false}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
