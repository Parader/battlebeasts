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

  scene.add(group);
  try {
    gl.compile(scene, camera);
  } finally {
    scene.remove(group);
    plane.dispose();
    particleGeo.dispose();
    for (const mat of toDispose) mat.dispose();
    group.clear();
  }
}
