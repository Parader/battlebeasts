import * as THREE from "three";

/** Vertical fade column for Ascendant Form. */
export function createAscendantColumnMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color("#FDE68A") },
      uOpacity: { value: 0.18 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        float verticalFade = pow(1.0 - vUv.y, 2.2);
        float shimmer = 0.82 + 0.18 * sin(vUv.x * 6.28318 * 4.0 + uTime * 2.5);
        float alpha = uOpacity * verticalFade * shimmer;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}
