import * as THREE from "three";

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

function uploadTextures(gl: THREE.WebGLRenderer, material: THREE.Material): void {
  const mat = material as THREE.MeshStandardMaterial & Record<string, unknown>;
  for (const key of TEXTURE_KEYS) {
    const tex = mat[key];
    if (tex && (tex as THREE.Texture).isTexture) {
      try {
        gl.initTexture(tex as THREE.Texture);
      } catch {
        // Missing/disposed maps are fine — skip.
      }
    }
  }
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (!uniforms) return;
  for (const u of Object.values(uniforms)) {
    const value = u?.value;
    if (value && (value as THREE.Texture).isTexture) {
      try {
        gl.initTexture(value as THREE.Texture);
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
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) uploadTextures(gl, mat);
  });

  /*
   * Three puts the output colour space in the program cache key. Bare canvas
   * is `srgb`; Bloom's EffectComposer is working-space (`srgb-linear`). Warm
   * both — same lesson as warmSpellMaterials.
   */
  const probe = new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = gl.getRenderTarget();
  try {
    gl.setRenderTarget(probe);
    await gl.compileAsync(scene, camera);
    gl.setRenderTarget(null);
    await gl.compileAsync(scene, camera);
  } catch {
    // Best-effort — a missed warm costs an in-game hitch, not correctness.
  } finally {
    gl.setRenderTarget(previousTarget);
    probe.dispose();
  }
}
