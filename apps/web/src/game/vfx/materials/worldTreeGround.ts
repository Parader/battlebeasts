import * as THREE from "three";

/** Organic concentric life-rings under a World Tree. */
export function createWorldTreeGroundMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uColorCore: { value: new THREE.Color("#86EFAC") },
      uColorMid: { value: new THREE.Color("#22C55E") },
      uColorEdge: { value: new THREE.Color("#14532D") },
      uOpacity: { value: 0.4 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorCore;
      uniform vec3 uColorMid;
      uniform vec3 uColorEdge;
      uniform float uOpacity;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;

        float ang = atan(p.y, p.x);
        float n = noise(p * 5.0 + vec2(cos(ang) * 0.4, sin(ang) * 0.4) - vec2(uTime * 0.04));
        float n2 = noise(p * 11.0 + vec2(uTime * 0.03));
        float pattern = n * 0.65 + n2 * 0.35;
        float ringWaves = 0.5 + 0.5 * sin(r * 22.0 - uTime * 1.2);
        float rimFade = smoothstep(1.0, 0.72, r);
        float innerCore = smoothstep(0.9, 0.0, r);

        vec3 col = mix(uColorEdge, uColorMid, innerCore * 0.75 + pattern * 0.25);
        col = mix(col, uColorCore, pow(1.0 - r, 2.2) * 0.8 + ringWaves * 0.15);

        float alpha = uOpacity * rimFade * (0.35 + 0.35 * innerCore + 0.2 * pattern + 0.1 * ringWaves);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
