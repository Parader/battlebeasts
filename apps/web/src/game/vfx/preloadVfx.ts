import * as THREE from "three";
import { CAST_AIM_COLOR, CAST_AIM_HOT } from "../castAimRuntime";
import { createGroundDecalMaterial } from "./materials/groundDecal";
import { createTrailMaterial } from "./materials/trailMaterial";
import {
  acquireEnergyBallMaterial,
  acquireEnergyRingMaterial,
} from "./materials/energyBall";
import { createLightningBoltMaterial } from "./materials/lightningBolt";
import { createCirclePointMaterial } from "./materials/circlePoint";
import { createRuneMaterial } from "./materials/rune";
import { createAoeRimMarkerMaterial } from "./materials/aoeRimMarker";
import { createCastAimSkillshotMaterial } from "./materials/castAimSkillshot";
import { createDissolveMaterial } from "./materials/dissolve";
import { createFresnelGlowMaterial } from "./materials/fresnelGlow";
import { createScrollNoiseMaterial } from "./materials/scrollNoise";
import { createHandShieldMaterial } from "./materials/handShield";
import { createRiftArmRingMaterial } from "./effects/riftArmRing";
import { createCooldownRingMaterial } from "./SpiritHusks";
import { getSharedFireMaterial } from "./components/FireParticleField";
import { createLavaStripMaterial, getLavaTexture } from "./components/LavaGroundStrip";
import { getChainTexture } from "./materials/chainTexture";
import { getSmokeTexture } from "./smokeTexture";
import { groundPresets } from "./presets/ground";
import {
  GEO_LANCE_SHAFT,
  GEO_LANCE_TIP,
  GEO_OCTA,
  GEO_RING_IMPACT,
  GEO_SPHERE_HI,
  GEO_SPHERE_MD,
  GEO_SPIKE_STALK,
} from "./sharedGeo";

type WarmHandle = {
  group: THREE.Group;
  disposables: THREE.Material[];
  geos: THREE.BufferGeometry[];
  sharedMaps: Set<THREE.Texture>;
  skipDispose: Set<THREE.Material>;
};

let activeWarm: WarmHandle | null = null;

function teardownWarm(handle: WarmHandle): void {
  handle.group.removeFromParent();
  for (const geo of handle.geos) geo.dispose();
  for (const mat of handle.disposables) {
    if (handle.skipDispose.has(mat)) continue;
    const basic = mat as THREE.MeshBasicMaterial;
    if (basic.map && handle.sharedMaps.has(basic.map)) basic.map = null;
    mat.dispose();
  }
  handle.group.clear();
}

/**
 * Compile spell VFX shader programs under the live scene lights/fog.
 * Keeps a hidden warm group parented in the scene so programs stay alive —
 * do not dispose after `gl.compile`. Re-call on hub↔content transfer.
 */
export function warmSpellMaterials(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  if (activeWarm) {
    teardownWarm(activeWarm);
    activeWarm = null;
  }

  const group = new THREE.Group();
  group.name = "VfxWarmup";
  group.visible = false;
  group.position.set(0, -500, 0);

  const plane = new THREE.PlaneGeometry(0.2, 0.2);
  const toDispose: THREE.Material[] = [];
  const ownedGeos: THREE.BufferGeometry[] = [plane];
  const sharedMaps = new Set<THREE.Texture>();
  const skipDispose = new Set<THREE.Material>();

  const addMesh = (mat: THREE.Material) => {
    toDispose.push(mat);
    group.add(new THREE.Mesh(plane, mat));
  };

  // Upload shared spell geos once (ice lance / bolt / spikes) before first cast.
  const warmGeoMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.01,
    depthWrite: false,
  });
  toDispose.push(warmGeoMat);
  for (const geo of [
    GEO_LANCE_TIP,
    GEO_LANCE_SHAFT,
    GEO_OCTA,
    GEO_SPHERE_HI,
    GEO_SPHERE_MD,
    GEO_RING_IMPACT,
    GEO_SPIKE_STALK,
  ]) {
    group.add(new THREE.Mesh(geo, warmGeoMat));
  }
  /*
   * No light is added here on purpose. Spell lights now come from the fixed
   * SpellLightPool, which is already in the scene by the time this runs, so
   * the light count is correct without help. Adding one more would compile
   * every material against a count that never occurs in play, and gameplay
   * would relink the lot on the first frame.
   */

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

  // Bolt / crescent / frost energy + ice-lance colors (acquire warm prototypes)
  addMesh(acquireEnergyBallMaterial("#93c5fd", 0.01));
  addMesh(acquireEnergyBallMaterial("#e0f2fe", 0.01));
  addMesh(acquireEnergyBallMaterial("#7dd3fc", 0.01));
  addMesh(acquireEnergyBallMaterial("#f97316", 0.01)); // magma / fireball
  addMesh(acquireEnergyBallMaterial("#4ade80", 0.01)); // life leech / heal
  addMesh(acquireEnergyBallMaterial("#84cc16", 0.01)); // poison dart
  addMesh(acquireEnergyRingMaterial("#7dd3fc", 0.01));
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
  ownedGeos.push(iceOcta);
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

  // Rune (bolt GroundMagicCircle / cast aim reticle)
  addMesh(createRuneMaterial("#93c5fd", { opacity: 0.01, spokes: 6 }));
  addMesh(createRuneMaterial(CAST_AIM_COLOR, { opacity: 0.01, spokes: 8 }));

  // Cast-aim skillshot + AoE rim (telegraph shaders)
  addMesh(
    createCastAimSkillshotMaterial({ color: CAST_AIM_COLOR, hotColor: CAST_AIM_HOT }),
  );
  addMesh(
    createAoeRimMarkerMaterial({
      color: CAST_AIM_COLOR,
      hotColor: CAST_AIM_HOT,
      shape: "circle",
    }),
  );
  addMesh(
    createAoeRimMarkerMaterial({
      color: "#f97316",
      shape: "cone",
      halfAngle: 0.7,
    }),
  );
  addMesh(
    createAoeRimMarkerMaterial({
      color: "#84cc16",
      shape: "capsule",
      aspect: 2,
    }),
  );

  // Soft circle.png point sprites (AdditiveParticleBurst)
  const particleMat = createCirclePointMaterial("#e0f2fe");
  toDispose.push(particleMat);
  const particleGeo = new THREE.BufferGeometry();
  ownedGeos.push(particleGeo);
  particleGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3),
  );
  particleGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([1]), 1));
  particleGeo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([1]), 1));
  group.add(new THREE.Points(particleGeo, particleMat));

  // Firewall / volcano / fireball — shared fire program with real texture (do not dispose).
  const fireMat = getSharedFireMaterial();
  skipDispose.add(fireMat);
  const fireGeo = new THREE.BufferGeometry();
  ownedGeos.push(fireGeo);
  fireGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  fireGeo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([1]), 1));
  fireGeo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1]), 4));
  fireGeo.setAttribute("aAngle", new THREE.BufferAttribute(new Float32Array([0]), 1));
  group.add(new THREE.Points(fireGeo, fireMat));

  /*
   * Programs reached by hits, buffs and status rings rather than by casting.
   * These were missing from the list above, so they each paid a compile the
   * first time a spell actually landed on something.
   */
  addMesh(createDissolveMaterial("#e0f2fe", { opacity: 0.01 }));
  addMesh(createFresnelGlowMaterial("#3b82f6", { opacity: 0.01 }));
  addMesh(createScrollNoiseMaterial("#3b82f6", { opacity: 0.01 }));
  addMesh(createHandShieldMaterial());
  addMesh(createRiftArmRingMaterial());
  addMesh(createCooldownRingMaterial("#ddd6fe", "#4c1d95"));

  // Firewall corridor — same program regardless of strip length.
  addMesh(createLavaStripMaterial());

  // Chain-jump link + spike bark share one lit program under the scene lights.
  addMesh(
    new THREE.MeshStandardMaterial({
      color: "#9ca3af",
      roughness: 0.4,
      metalness: 0.8,
    }),
  );

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

  /*
   * Compile with a render target bound, because that is what the game renders
   * into.
   *
   * Three puts the output colour space in the program cache key. With no
   * target bound it resolves to the canvas (`srgb`); through the Bloom
   * EffectComposer it resolves to the working space (`srgb-linear`). Those are
   * two different programs for the same material, so compiling bare here
   * warmed a variant that never renders, and every material paid its link cost
   * on first real use anyway -- measured as the leftover hitch after the spell
   * lights were pooled.
   *
   * The target only has to exist to shift the cache key; nothing is drawn into
   * it, so 1x1 is enough.
   */
  const probe = new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = gl.getRenderTarget();
  try {
    gl.setRenderTarget(probe);
    gl.compile(scene, camera);
    // And the direct-to-canvas variant, for any path that bypasses post.
    gl.setRenderTarget(null);
    gl.compile(scene, camera);
  } catch {
    // Best-effort — leave group parented so a partial warm still sticks.
  } finally {
    gl.setRenderTarget(previousTarget);
    probe.dispose();
  }
  // Keep hidden group in the live scene so compiled programs stay resident.
  activeWarm = {
    group,
    disposables: toDispose,
    geos: ownedGeos,
    sharedMaps,
    skipDispose,
  };
}
