import * as THREE from "three";
import { VFX_CIRCLE_URL } from "../vfxUrls";

export { VFX_CIRCLE_URL };

let circleTex: THREE.Texture | null = null;

/** Shared soft-circle map for additive point sprites. */
export function getVfxCircleTexture(): THREE.Texture {
  if (!circleTex) {
    circleTex = new THREE.TextureLoader().load(VFX_CIRCLE_URL);
    circleTex.colorSpace = THREE.SRGBColorSpace;
    circleTex.needsUpdate = true;
  }
  return circleTex;
}

/** Install a fully-decoded texture from the loading gate. */
export function setCircleTexture(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  circleTex = tex;
}

const VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * (110.0 / max(-mv.z, 0.5)), 36.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FS = /* glsl */ `
uniform vec3 uColor;
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.a * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor * tex.rgb, a);
}
`;

/** Shared program proto — clones share the compiled shader. */
let circlePointProto: THREE.ShaderMaterial | null = null;

function getCirclePointProto(): THREE.ShaderMaterial {
  if (!circlePointProto) {
    circlePointProto = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#e0f2fe") },
        uMap: { value: getVfxCircleTexture() },
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }
  return circlePointProto;
}

/**
 * Soft additive point-sprite material (circle.png × uColor × aAlpha).
 * Cloned from a warm proto so first cast doesn't recompile the program.
 */
export function createCirclePointMaterial(color = "#e0f2fe"): THREE.ShaderMaterial {
  const mat = getCirclePointProto().clone();
  const u = mat.uniforms.uColor?.value as THREE.Color | undefined;
  u?.set(color);
  if (mat.uniforms.uMap) mat.uniforms.uMap.value = getVfxCircleTexture();
  return mat;
}

/** Dark smoke motes — normal blend for contrast against additive glow. */
export function createSmokePointMaterial(color = "#100914"): THREE.ShaderMaterial {
  const mat = createCirclePointMaterial(color);
  mat.blending = THREE.NormalBlending;
  return mat;
}
