import * as THREE from "three";
import { createGroundDecalMaterial } from "./materials/groundDecal";
import { createTrailMaterial } from "./materials/trailMaterial";
import { createEnergyBallMaterial, createEnergyRingMaterial } from "./materials/energyBall";
import { createLightningBoltMaterial } from "./materials/lightningBolt";
import { createCirclePointMaterial } from "./materials/circlePoint";
import { getSharedFireMaterial } from "./components/FireParticleField";
import { getLavaTexture } from "./components/LavaGroundStrip";
import { getChainTexture } from "./materials/chainTexture";
import { getSmokeTexture } from "./smokeTexture";
import { groundPresets } from "./presets/ground";

/**
 * Compile spell VFX shader programs once so the first cast doesn't hitch.
 * Materials are temporary — disposed after `gl.compile`.
 * Call after spell textures are primed so uMap samples are non-null.
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
  const sharedMaps = new Set<THREE.Texture>();

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

  // Bolt / crescent / frost energy + ice-lance explode shards
  addMesh(createEnergyBallMaterial("#93c5fd"));
  addMesh(createEnergyBallMaterial("#e0f2fe"));
  addMesh(createEnergyRingMaterial("#7dd3fc"));
  addMesh(createGroundDecalMaterial(groundPresets.iceFrost, "circle"));
  addMesh(
    new THREE.MeshBasicMaterial({
      color: "#e0f2fe",
      transparent: true,
      opacity: 0.01,
      depthWrite: false,
    }),
  );
  const iceOcta = new THREE.OctahedronGeometry(0.05, 0);
  const iceOctaMat = new THREE.MeshBasicMaterial({
    color: "#7dd3fc",
    transparent: true,
    opacity: 0.01,
    depthWrite: false,
  });
  toDispose.push(iceOctaMat);
  group.add(new THREE.Mesh(iceOcta, iceOctaMat));

  // Spikes bark (MeshStandard under scene lights)
  addMesh(
    new THREE.MeshStandardMaterial({
      color: "#03170c",
      roughness: 0.85,
      metalness: 0.05,
    }),
  );

  // Surge / status lightning
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

  // Firewall / volcano / fireball — shared fire program with real texture (do not dispose).
  const fireMat = getSharedFireMaterial();
  const fireGeo = new THREE.BufferGeometry();
  fireGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  fireGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([1]), 1));
  fireGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1]), 4));
  fireGeo.setAttribute("aAngle", new THREE.BufferAttribute(new Float32Array([0]), 1));
  group.add(new THREE.Points(fireGeo, fireMat));

  // Touch lava / smoke / chain maps so GPU uploads before first cast.
  const lava = getLavaTexture();
  const smoke = getSmokeTexture();
  const chain = getChainTexture();
  sharedMaps.add(lava);
  sharedMaps.add(smoke);
  sharedMaps.add(chain);
  addMesh(
    new THREE.MeshBasicMaterial({
      map: lava,
      transparent: true,
      opacity: 0.01,
      depthWrite: false,
    }),
  );
  addMesh(
    new THREE.MeshBasicMaterial({
      map: smoke,
      transparent: true,
      opacity: 0.01,
      depthWrite: false,
    }),
  );
  addMesh(
    new THREE.MeshBasicMaterial({
      map: chain,
      transparent: true,
      opacity: 0.01,
      depthWrite: false,
    }),
  );

  scene.add(group);
  try {
    gl.compile(scene, camera);
  } finally {
    scene.remove(group);
    plane.dispose();
    iceOcta.dispose();
    particleGeo.dispose();
    fireGeo.dispose();
    for (const mat of toDispose) {
      if (mat === fireMat || mat === particleMat) continue;
      const basic = mat as THREE.MeshBasicMaterial;
      if (basic.map && sharedMaps.has(basic.map)) basic.map = null;
      mat.dispose();
    }
    group.clear();
  }
}
