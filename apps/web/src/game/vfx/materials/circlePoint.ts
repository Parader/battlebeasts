import * as THREE from "three";

/** Soft disc from bobbyroe Simple-Particle-Effects (MIT). */
export const VFX_CIRCLE_URL = "/assets/vfx/circle.png";

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

/**
 * Soft additive point-sprite material (circle.png × uColor × aAlpha).
 * Matches AdditiveParticleBurst.
 */
export function createCirclePointMaterial(color = "#e0f2fe"): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uMap: { value: getVfxCircleTexture() },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(aSize * (110.0 / max(-mv.z, 0.5)), 36.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        float a = tex.a * vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(uColor * tex.rgb, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}
