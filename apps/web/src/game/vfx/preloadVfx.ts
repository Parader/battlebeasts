import * as THREE from "three";
import { createGroundDecalMaterial } from "./materials/groundDecal";
import { createTrailMaterial } from "./materials/trailMaterial";
import { createEnergyBallMaterial, createEnergyRingMaterial } from "./materials/energyBall";
import { createLightningBoltMaterial } from "./materials/lightningBolt";
import { createCirclePointMaterial } from "./materials/circlePoint";
import { groundPresets } from "./presets/ground";

/**
 * Compile spell VFX shader programs once so the first cast doesn't hitch.
 * Materials are temporary — disposed after `gl.compile`.
 */
export function warmSpellMaterials(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  const group = new THREE.Group();
  group.name = "VfxWarmup";
  group.position.set(0, -500, 0);

  const plane = new THREE.PlaneGeometry(0.2, 0.2);
  const toDispose: THREE.Material[] = [];

  const addMesh = (mat: THREE.Material) => {
    toDispose.push(mat);
    group.add(new THREE.Mesh(plane, mat));
  };

  // GroundDecal: normal + additive (shape/style are uniforms — program variants by blend).
  addMesh(createGroundDecalMaterial(groundPresets.earthSlam, "circle"));
  addMesh(createGroundDecalMaterial(groundPresets.frostBallAura, "circle"));
  addMesh(createGroundDecalMaterial(groundPresets.fireWallAura, "rect"));
  addMesh(createGroundDecalMaterial(groundPresets.windSmoke, "circle"));
  addMesh(
    createGroundDecalMaterial(
      { ...groundPresets.iceFrost, shape: "cone", additive: true, halfAngle: 0.7 },
      "cone",
    ),
  );

  // Trails (frost mist / gust)
  addMesh(createTrailMaterial("#e0f2fe", { opacity: 0.85, head: 0.22 }));

  // Bolt / crescent / frost energy
  addMesh(createEnergyBallMaterial("#93c5fd"));
  addMesh(createEnergyRingMaterial("#7dd3fc"));

  // Spikes bark (MeshStandard under scene lights)
  addMesh(
    new THREE.MeshStandardMaterial({
      color: "#03170c",
      roughness: 0.85,
      metalness: 0.05,
    }),
  );

  // Surge / status lightning (cheap to include)
  addMesh(createLightningBoltMaterial("#67e8f9"));

  // Soft circle.png point sprites (AdditiveParticleBurst)
  const particleMat = createCirclePointMaterial("#e0f2fe");
  toDispose.push(particleMat);
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3),
  );
  particleGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([1]), 1));
  particleGeo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([1]), 1));
  group.add(new THREE.Points(particleGeo, particleMat));

  // Firewall / volcano fire field (shared ShaderMaterial program)
  const fireMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: null } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aAngle; attribute vec4 aColor;
      varying vec4 vColor; varying vec2 vAngle;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(aSize * (160.0 / max(-mv.z, 0.6)), 64.0);
        vAngle = vec2(cos(aAngle), sin(aAngle));
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying vec4 vColor; varying vec2 vAngle;
      void main() {
        vec2 coords = (gl_PointCoord - 0.5) * mat2(vAngle.x, vAngle.y, -vAngle.y, vAngle.x) + 0.5;
        vec4 col = texture2D(uMap, coords) * vColor;
        if (col.a < 0.03) discard;
        gl_FragColor = col;
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  toDispose.push(fireMat);
  const fireGeo = new THREE.BufferGeometry();
  fireGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  fireGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([1]), 1));
  fireGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1]), 4));
  fireGeo.setAttribute("aAngle", new THREE.BufferAttribute(new Float32Array([0]), 1));
  group.add(new THREE.Points(fireGeo, fireMat));

  scene.add(group);
  try {
    gl.compile(scene, camera);
  } finally {
    scene.remove(group);
    plane.dispose();
    particleGeo.dispose();
    fireGeo.dispose();
    for (const mat of toDispose) mat.dispose();
    group.clear();
  }
}
