import * as THREE from "three";

/** compile() skips invisible objects — flash these parked groups on for the compile pass. */
const WARMUP_GROUP_NAMES = new Set(["VfxWarmup", "GpuWarmDummies", "OpacityWarmDummy"]);

const TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "lightMap",
  "envMap",
  "specularMap",
] as const;

function uploadTextures(gl: THREE.WebGLRenderer, material: THREE.Material, seenSources: Set<THREE.Source>): void {
  const mat = material as THREE.MeshStandardMaterial & Record<string, unknown>;
  for (const key of TEXTURE_KEYS) {
    const tex = mat[key] as THREE.Texture | undefined;
    if (tex && tex.isTexture) {
      if (tex.source && seenSources.has(tex.source)) continue;
      if (tex.source) seenSources.add(tex.source);
      try {
        gl.initTexture(tex);
      } catch {
        // Missing/disposed maps are fine — skip.
      }
    }
  }
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (!uniforms) return;
  for (const u of Object.values(uniforms)) {
    const value = u?.value as THREE.Texture | undefined;
    if (value && value.isTexture) {
      if (value.source && seenSources.has(value.source)) continue;
      if (value.source) seenSources.add(value.source);
      try {
        gl.initTexture(value);
      } catch {
        // Same as above.
      }
    }
  }
}

/**
 * Force-compile every mesh program currently in the live scene under the same
 * cache keys gameplay uses (Bloom linear target + canvas), and upload material
 * textures so the first walk into a cluster does not hitch on either.
 */
export async function compileLiveScene(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<void> {
  const seenSources = new Set<THREE.Source>();
  const hidden = new Set<THREE.Object3D>();
  scene.traverse((object) => {
    if (WARMUP_GROUP_NAMES.has(object.name) && !object.visible) {
      object.visible = true;
      hidden.add(object);
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) uploadTextures(gl, mat, seenSources);
  });

  /*
   * Three puts the output colour space in the program cache key. Bare canvas
   * is `srgb`; Bloom's EffectComposer is working-space (`srgb-linear`). Warm
   * both — same lesson as warmSpellMaterials.
   */
  const probe = new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = gl.getRenderTarget();
  try {
    // Sync compile only. compileAsync in three 0.175 throws
    // `currentProgram is undefined` from a rAF after materials dispose or
    // skip a program, and that error is not a rejected promise.
    gl.setRenderTarget(probe);
    gl.compile(scene, camera);
    gl.setRenderTarget(null);
    gl.compile(scene, camera);
  } catch {
    // Best-effort — a missed warm costs an in-game hitch, not correctness.
  } finally {
    for (const obj of hidden) obj.visible = false;
    gl.setRenderTarget(previousTarget);
    probe.dispose();
  }
}
