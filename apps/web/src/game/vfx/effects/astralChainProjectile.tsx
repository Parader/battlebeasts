import { useFrame } from "@react-three/fiber";
import { Room } from "colyseus.js";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GEO_PLANE_1 } from "../sharedGeo";

const PATH_W = 1.45;

/**
 * One dark strip. Falloff is across the width only, so the shadow
 * reaches both ends instead of pooling in the middle like a void disc.
 */
const STRIP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STRIP_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uOpacity;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float side = smoothstep(1.0, 0.15, abs(p.x));
    float cap = smoothstep(1.0, 0.9, abs(p.y));
    float a = side * cap * uOpacity;
    if (a < 0.02) discard;
    vec3 col = mix(uEdge, uColor, smoothstep(0.85, 0.0, abs(p.x)));
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Astral Chain hook — one dark shadow from the caster to the projectile.
 * Gone once the projectile is removed (the tether does not keep it).
 */
export function AstralChainProjectileEffect({ room, id }: { room: Room; id: string }) {
  const mesh = useRef<THREE.Mesh>(null);
  const right = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3(0, 1, 0));
  const basis = useRef(new THREE.Matrix4());
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color("#1a0a28") },
          uEdge: { value: new THREE.Color("#050308") },
          uOpacity: { value: 0.92 },
        },
        vertexShader: STRIP_VERT,
        fragmentShader: STRIP_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      mat.dispose();
    };
  }, [mat]);

  useFrame(() => {
    const m = mesh.current;
    const p = room.state?.projectiles?.get(id) as
      | { x?: number; z?: number; ownerSessionId?: string }
      | undefined;
    if (!m) return;
    if (!p) {
      m.visible = false;
      return;
    }
    const x = p.x ?? 0;
    const z = p.z ?? 0;
    const owner = p.ownerSessionId
      ? (room.state?.players?.get(p.ownerSessionId) as { x?: number; z?: number } | undefined)
      : undefined;
    if (!owner || typeof owner.x !== "number" || typeof owner.z !== "number") {
      m.visible = false;
      return;
    }
    const dx = x - owner.x;
    const dz = z - owner.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) {
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.set((owner.x + x) * 0.5, 0.02, (owner.z + z) * 0.5);
    const inv = 1 / dist;
    forward.current.set(dx * inv, 0, dz * inv);
    // forward × up. The opposite cross mirrors the basis and turns the strip sideways.
    right.current.set(-forward.current.z, 0, forward.current.x);
    basis.current.makeBasis(right.current, forward.current, up.current);
    m.quaternion.setFromRotationMatrix(basis.current);
    m.scale.set(PATH_W, dist + 0.55, 1);
  });

  return (
    <mesh ref={mesh} geometry={GEO_PLANE_1} material={mat} renderOrder={3} frustumCulled={false} />
  );
}
