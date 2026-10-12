import { groundMaterial, MAX_GROUND_LAYERS, type MapGround } from "@battlebeasts/shared";
import { useTexture } from "@react-three/drei";
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import * as THREE from "three";
import { assetUrl } from "./assetUrl";
import { GROUND_ARRAY_SIZE, packGroundPalette } from "./groundArray";

/**
 * Painted terrain: up to four ground materials blended by a splat texture,
 * over a mesh displaced by a height map.
 *
 * Used by both the editor and the game, which is why the splat and height
 * data are inputs rather than something this component loads. The editor
 * hands in a live canvas texture it mutates while you paint; the runtime
 * hands in textures loaded from the saved sidecars. Neither needs to know how
 * the other sources them.
 *
 * Height is baked into vertex positions rather than displaced on the GPU.
 * Collision is XZ-only and cursor aim raycasts a mathematical y=0 plane, so
 * the terrain has to stay visually bumpy without ever becoming traversable
 * geometry -- the document caps `heightScale` at half a metre for the same
 * reason.
 */

/**
 * Only colour and normal are sampled per layer.
 *
 * Four layers times four PBR maps overruns the 16 texture units WebGL
 * guarantees, once the splat, shadow and environment maps are counted.
 * Roughness and AO are the two worth losing: outdoor ground is uniformly rough
 * so a constant reads the same as the map, and ambient occlusion is already
 * baked into these scans' albedo. That buys the fourth material, which is far
 * more visible than either.
 */
export type GroundLayerTextures = {
  diff: THREE.Texture;
  nor: THREE.Texture;
  /** World metres per repeat. */
  tile: number;
};

// --- geometry ---------------------------------------------------------------

/**
 * Bilinear sample of a square height grid at normalised coordinates.
 *
 * The grid and the vertex lattice are deliberately different sizes: heights
 * are stored one per *cell* (`res * res`, matching the splat texture), while
 * the mesh needs one per *corner* (`res + 1` per side). Indexing one with the
 * other's stride shears the terrain diagonally and runs off the end of the
 * buffer, so the mapping has to go through UV space.
 */
function sampleHeight(
  heights: Float32Array,
  resX: number,
  resZ: number,
  u: number,
  v: number,
): number {
  // Half-texel inset: sample at cell centres, so the edges of the mesh land on
  // the outermost cells rather than half a cell outside the data.
  const x = Math.min(resX - 1, Math.max(0, u * resX - 0.5));
  const y = Math.min(resZ - 1, Math.max(0, v * resZ - 0.5));
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  const i1 = Math.min(resX - 1, i0 + 1);
  const j1 = Math.min(resZ - 1, j0 + 1);
  const fx = x - i0;
  const fy = y - j0;

  const h00 = heights[j0 * resX + i0] ?? 0.5;
  const h10 = heights[j0 * resX + i1] ?? 0.5;
  const h01 = heights[j1 * resX + i0] ?? 0.5;
  const h11 = heights[j1 * resX + i1] ?? 0.5;

  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fy;
}

/** The size and grid of a painted surface, the subset both halves care about. */
export type GroundExtent = { sizeX: number; sizeZ: number; resX: number; resZ: number };

/**
 * Height samples with their own dimensions.
 *
 * Carried alongside the data rather than read off the document, because a
 * sidecar saved before a resize still decodes at its original grid and should
 * stretch over the new extent instead of being sampled with the wrong stride.
 */
export type HeightGrid = { data: Float32Array; resX: number; resZ: number };

/**
 * A flat grid in the XZ plane, optionally displaced by `heights`.
 *
 * Built directly in world orientation instead of rotating a PlaneGeometry:
 * displacement then lands on Y without juggling the rotation, and the UVs stay
 * trivially aligned with the splat texture.
 */
/** Game runtime mesh density cap (editor uses full map resolution). */
export const GAME_GROUND_MESH_SEGS = 128;

/** Cap painted-ground segment count for runtime rendering. */
export function cappedGroundExtent(extent: GroundExtent, maxSegs = GAME_GROUND_MESH_SEGS): GroundExtent {
  return {
    ...extent,
    resX: Math.min(extent.resX, maxSegs),
    resZ: Math.min(extent.resZ, maxSegs),
  };
}

export function buildGroundGeometry(
  extent: GroundExtent,
  heights: HeightGrid | null,
  heightScale: number,
): THREE.BufferGeometry {
  const segsX = Math.max(1, Math.floor(extent.resX));
  const segsZ = Math.max(1, Math.floor(extent.resZ));
  const vertsX = segsX + 1;
  const vertsZ = segsZ + 1;
  const halfX = extent.sizeX / 2;
  const halfZ = extent.sizeZ / 2;
  const stepX = extent.sizeX / segsX;
  const stepZ = extent.sizeZ / segsZ;

  const count = vertsX * vertsZ;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices: number[] = [];

  for (let j = 0; j < vertsZ; j++) {
    for (let i = 0; i < vertsX; i++) {
      const n = j * vertsX + i;
      const u = i / segsX;
      const v = j / segsZ;

      let y = 0;
      if (heights) {
        // Stored 0..1 with 0.5 as neutral, so a brush can dig as well as raise.
        const h = sampleHeight(heights.data, heights.resX, heights.resZ, u, v);
        y = (h - 0.5) * 2 * heightScale;
      }

      positions[n * 3] = -halfX + i * stepX;
      positions[n * 3 + 1] = y;
      positions[n * 3 + 2] = -halfZ + j * stepZ;
      uvs[n * 2] = u;
      uvs[n * 2 + 1] = v;
    }
  }

  for (let j = 0; j < segsZ; j++) {
    for (let i = 0; i < segsX; i++) {
      const a = j * vertsX + i;
      const b = a + 1;
      const c = a + vertsX;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Rewrite the Y column of an existing ground geometry.
 *
 * The editor's sculpt brushes change only height, and only inside the brush,
 * but the lattice, UVs and index buffer are identical before and after.
 * Rebuilding the geometry for each dab reallocated all of that and re-uploaded
 * the index buffer to the GPU every frame of a drag, which is what made the
 * raise/lower/smooth brushes crawl on a large map. Mutating in place leaves
 * only the two things that actually changed: positions and normals.
 */
export function updateGroundHeights(
  geo: THREE.BufferGeometry,
  extent: GroundExtent,
  heights: HeightGrid | null,
  heightScale: number,
  opts?: { normals?: boolean },
): void {
  const attr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!attr) return;

  const segsX = Math.max(1, Math.floor(extent.resX));
  const segsZ = Math.max(1, Math.floor(extent.resZ));
  const vertsX = segsX + 1;
  const vertsZ = segsZ + 1;
  // A resize routes through a full rebuild; bail rather than write past the end.
  if (attr.count !== vertsX * vertsZ) return;

  const positions = attr.array as Float32Array;
  for (let j = 0; j < vertsZ; j++) {
    for (let i = 0; i < vertsX; i++) {
      const n = j * vertsX + i;
      let y = 0;
      if (heights) {
        const h = sampleHeight(heights.data, heights.resX, heights.resZ, i / segsX, j / segsZ);
        y = (h - 0.5) * 2 * heightScale;
      }
      positions[n * 3 + 1] = y;
    }
  }

  attr.needsUpdate = true;
  // Normals are the expensive half of a sculpt frame on a large lattice.
  // The editor skips them mid-stroke and computes once when the drag ends.
  if (opts?.normals !== false) geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

// --- material ---------------------------------------------------------------

/**
 * Shared prologue for every patched chunk.
 *
 * Reads `vMapUv` rather than `vUv`: three only declares `vUv` under USE_UV,
 * but the per-map varying is guaranteed here because the material assigns
 * `map`.
 *
 * Only three layer weights are stored. The fourth is whatever is left over,
 * because the splat has to survive a round trip through a 2D canvas when the
 * editor reloads a saved map, and a canvas premultiplies alpha -- any texel
 * with a transparent fourth weight would come back with its other three
 * channels crushed to zero. Keeping alpha opaque sidesteps that entirely, and
 * since the weights are normalised anyway, the fourth carries no less
 * information for being implied.
 */
const SPLAT_CHUNK = /* glsl */ `
  vec3 bbRgb = texture2D(uSplat, vMapUv).rgb;
  float bbSum = bbRgb.r + bbRgb.g + bbRgb.b;
  vec4 bbW = vec4(bbRgb, max(0.0, 1.0 - bbSum));
  float bbTotal = bbW.r + bbW.g + bbW.b + bbW.a;
  bbW = bbTotal > 0.001 ? bbW / bbTotal : vec4(1.0, 0.0, 0.0, 0.0);
  // Repeats are counted per axis. UV runs 0..1 across the ground whatever its
  // shape, so a single scalar would stretch the texture on a non-square map.
  vec2 bbUv0 = vMapUv * vec2(uTileX.x, uTileZ.x);
  vec2 bbUv1 = vMapUv * vec2(uTileX.y, uTileZ.y);
  vec2 bbUv2 = vMapUv * vec2(uTileX.z, uTileZ.z);
  vec2 bbUv3 = vMapUv * vec2(uTileX.w, uTileZ.w);
`;

/**
 * Weighted sum of one map across the four layers.
 *
 * Layer 0 reads three's own `map` / `normalMap` rather than a uniform of our
 * own. Those samplers are bound regardless -- assigning them is what switches
 * on the UV varying and the tangent-space normal path -- so reusing them
 * instead of duplicating saves two texture units for nothing.
 */
function blend4(samplers: [string, string, string, string]): string {
  const s = (i: number) => `texture2D(${samplers[i]!}, bbUv${i})`;
  return `(${s(0)} * bbW.r + ${s(1)} * bbW.g + ${s(2)} * bbW.b + ${s(3)} * bbW.a)`;
}

const DIFF_SAMPLERS: [string, string, string, string] = ["map", "uDiff1", "uDiff2", "uDiff3"];
const NOR_SAMPLERS: [string, string, string, string] = ["normalMap", "uNor1", "uNor2", "uNor3"];

/**
 * A MeshStandardMaterial with its texture lookups replaced by a weighted blend
 * of four materials.
 *
 * Patched via onBeforeCompile rather than written as a ShaderMaterial so the
 * terrain keeps three's real lighting, shadows, fog and tone mapping — all of
 * which the rest of the scene depends on matching.
 */
export function createPaintedGroundMaterial(
  layers: GroundLayerTextures[],
  splat: THREE.Texture,
  sizeX: number,
  sizeZ: number,
): THREE.MeshStandardMaterial {
  const padded = [...layers];
  while (padded.length < MAX_GROUND_LAYERS) padded.push(layers[0]!);

  for (const l of padded) {
    for (const t of [l.diff, l.nor]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
    }
    /*
     * Colour space is set here rather than decoded in the shader. Three
     * uploads an sRGB-tagged texture with an sRGB internal format, so the GPU
     * linearises on sample -- doing it again in GLSL would darken the ground.
     * Normals are data, not colour, and must stay linear.
     */
    l.diff.colorSpace = THREE.SRGBColorSpace;
    l.nor.colorSpace = THREE.NoColorSpace;
  }

  // Weights, not colour: linearising the splat would skew every blend.
  splat.colorSpace = THREE.NoColorSpace;
  // Row 0 is -Z in our buffer/PNG layout. DataTexture defaults flipY=false;
  // TextureLoader defaults flipY=true and would mirror paint vs the editor.
  splat.flipY = false;
  splat.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    // Assigning the first layer's maps switches on the UV varying and the
    // tangent-space normal path; the injected code then blends all four
    // layers through these same samplers.
    map: padded[0]!.diff,
    normalMap: padded[0]!.nor,
    metalness: 0,
    roughness: 1,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: splat };
    const repeats = (axis: number) =>
      new THREE.Vector4(
        axis / padded[0]!.tile,
        axis / padded[1]!.tile,
        axis / padded[2]!.tile,
        axis / padded[3]!.tile,
      );
    shader.uniforms.uTileX = { value: repeats(sizeX) };
    shader.uniforms.uTileZ = { value: repeats(sizeZ) };
    // From 1: layer 0 rides three's own map / normalMap bindings.
    for (let i = 1; i < MAX_GROUND_LAYERS; i++) {
      shader.uniforms[`uDiff${i}`] = { value: padded[i]!.diff };
      shader.uniforms[`uNor${i}`] = { value: padded[i]!.nor };
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform sampler2D uSplat;
        uniform vec4 uTileX;
        uniform vec4 uTileZ;
        uniform sampler2D uDiff1; uniform sampler2D uDiff2; uniform sampler2D uDiff3;
        uniform sampler2D uNor1;  uniform sampler2D uNor2;  uniform sampler2D uNor3;
        `,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        ${SPLAT_CHUNK}
        diffuseColor *= ${blend4(DIFF_SAMPLERS)};
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        vec3 bbMapN = ${blend4(NOR_SAMPLERS)}.xyz * 2.0 - 1.0;
        bbMapN.xy *= normalScale;
        normal = normalize(tbn * bbMapN);
        `,
      );
  };

  // Force a recompile if the material is reused across layer changes.
  mat.customProgramCacheKey = () => `bb-painted-${layers.map((l) => l.tile).join(",")}`;
  return mat;
}

const INDEX_DIFF = /* glsl */ `
  vec4 bbCtrl = texture2D(uSplat, vMapUv);
  float bbIdA = floor(bbCtrl.r * 255.0 + 0.5);
  float bbIdB = floor(bbCtrl.g * 255.0 + 0.5);
  float bbWB = bbCtrl.b;
  vec2 bbWorld = vMapUv * uSize;
  vec2 bbInfoA = texture2D(uInfo, vec2((bbIdA + 0.5) / 256.0, 0.5)).rg;
  vec2 bbInfoB = texture2D(uInfo, vec2((bbIdB + 0.5) / 256.0, 0.5)).rg;
  float bbLayerA = floor(bbInfoA.r * 255.0 + 0.5);
  float bbLayerB = floor(bbInfoB.r * 255.0 + 0.5);
  float bbTileA = max(0.25, floor(bbInfoA.g * 255.0 + 0.5) / 4.0);
  float bbTileB = max(0.25, floor(bbInfoB.g * 255.0 + 0.5) / 4.0);
  vec3 bbAlbedo = mix(
    texture2D(uDiff, vec3(bbWorld / bbTileA, bbLayerA)).rgb,
    texture2D(uDiff, vec3(bbWorld / bbTileB, bbLayerB)).rgb,
    bbWB
  );
  diffuseColor *= vec4(bbAlbedo, 1.0);
`;

const INDEX_NOR = /* glsl */ `
  vec3 bbMapN = mix(
    texture2D(uNor, vec3(bbWorld / bbTileA, bbLayerA)).xyz,
    texture2D(uNor, vec3(bbWorld / bbTileB, bbLayerB)).xyz,
    bbWB
  );
  bbMapN = bbMapN * 2.0 - 1.0;
  bbMapN.xy *= normalScale;
  normal = normalize(tbn * bbMapN);
`;

type GpuPalette = {
  key: string;
  diff: THREE.DataArrayTexture;
  nor: THREE.DataArrayTexture;
  info: THREE.DataTexture;
};

let gpuPalette: GpuPalette | null = null;
let retiredPalette: GpuPalette | null = null;
let paletteFlight: { key: string; promise: Promise<GpuPalette> } | null = null;

function disposePalette(palette: GpuPalette | null) {
  palette?.diff.dispose();
  palette?.nor.dispose();
  palette?.info.dispose();
}

function makeArrayTexture(data: Uint8Array, depth: number, srgb: boolean): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(data, GROUND_ARRAY_SIZE, GROUND_ARRAY_SIZE, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** One uploaded catalog for every ground tile. Rebuilt when the id list changes. */
function indexedGroundPalette(ids: readonly string[]): Promise<GpuPalette> {
  const key = ids.join("|");
  if (gpuPalette?.key === key) return Promise.resolve(gpuPalette);
  if (paletteFlight?.key === key) return paletteFlight.promise;
  const promise = packGroundPalette(ids).then((packed) => {
    const info = new THREE.DataTexture(packed.info, 256, 1, THREE.RGBAFormat);
    info.colorSpace = THREE.NoColorSpace;
    info.magFilter = THREE.NearestFilter;
    info.minFilter = THREE.NearestFilter;
    info.generateMipmaps = false;
    info.wrapS = THREE.ClampToEdgeWrapping;
    info.wrapT = THREE.ClampToEdgeWrapping;
    info.needsUpdate = true;
    const next: GpuPalette = {
      key,
      diff: makeArrayTexture(packed.diff, packed.depth, true),
      nor: makeArrayTexture(packed.nor, packed.depth, false),
      info,
    };
    disposePalette(retiredPalette);
    retiredPalette = gpuPalette;
    gpuPalette = next;
    return next;
  });
  paletteFlight = { key, promise };
  return promise;
}

function createIndexedGroundMaterial(
  gpu: GpuPalette,
  splat: THREE.Texture,
  sizeX: number,
  sizeZ: number,
): THREE.MeshStandardMaterial {
  splat.colorSpace = THREE.NoColorSpace;
  splat.magFilter = THREE.NearestFilter;
  splat.minFilter = THREE.NearestFilter;
  splat.generateMipmaps = false;
  splat.flipY = false;
  splat.needsUpdate = true;

  const dummyDiff = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  dummyDiff.colorSpace = THREE.SRGBColorSpace;
  dummyDiff.needsUpdate = true;
  const dummyNor = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  dummyNor.colorSpace = THREE.NoColorSpace;
  dummyNor.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    map: dummyDiff,
    normalMap: dummyNor,
    metalness: 0,
    roughness: 1,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: splat };
    shader.uniforms.uInfo = { value: gpu.info };
    shader.uniforms.uDiff = { value: gpu.diff };
    shader.uniforms.uNor = { value: gpu.nor };
    shader.uniforms.uSize = { value: new THREE.Vector2(sizeX, sizeZ) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform sampler2D uSplat;
        uniform sampler2D uInfo;
        uniform sampler2DArray uDiff;
        uniform sampler2DArray uNor;
        uniform vec2 uSize;
        `,
      )
      .replace("#include <map_fragment>", INDEX_DIFF)
      .replace("#include <normal_fragment_maps>", INDEX_NOR);
  };
  mat.customProgramCacheKey = () => "bb-indexed-ground-1";
  return mat;
}

// --- component --------------------------------------------------------------

type Props = {
  ground: Extract<MapGround, { kind: "painted" }>;
  /** RGBA layer weights. The editor passes a live canvas texture. */
  splat: THREE.Texture;
  /** Height samples, 0..1 with 0.5 neutral. Null renders flat. */
  heights?: HeightGrid | null;
  name?: string;
  /** Lower segment count for runtime (default: full document resolution). */
  maxMeshSegs?: number;
  /**
   * Skip vertex normals this frame. Editor sculpt brushes set this while a
   * stroke is in flight so a 160² lattice is not renormalised on every dab.
   */
  skipNormals?: boolean;
  /** World XZ of the mesh centre. Tiles are centred on themselves, not the zone. */
  offset?: readonly [number, number];
  /**
   * `index` blends any catalog material, two per texel. `weights` is the
   * legacy four-slot splat. The editor always passes `index`.
   */
  splatMode?: "index" | "weights";
  /** Material ids to upload for `index` mode. */
  palette?: readonly string[];
};

/** Loads the four PBR maps for one layer id. */
function useLayerTextures(layerIds: string[]): GroundLayerTextures[] {
  const defs = layerIds
    .slice(0, MAX_GROUND_LAYERS)
    .map((id) => groundMaterial(id))
    .filter((d): d is NonNullable<typeof d> => !!d);

  const urls = defs.flatMap((d) => [assetUrl(d.diff), assetUrl(d.nor)]);
  const loaded = useTexture(urls) as THREE.Texture[];

  return useMemo(
    () =>
      defs.map((d, i) => ({
        diff: loaded[i * 2]!,
        nor: loaded[i * 2 + 1]!,
        tile: d.tile,
      })),
    [defs, loaded],
  );
}

const WeightPaintedGround = forwardRef<THREE.Mesh, Props>(function WeightPaintedGround(
  { ground, splat, heights = null, name, maxMeshSegs, skipNormals = false, offset },
  ref,
) {
  const layers = useLayerTextures([...ground.layers]);

  const { sizeX, sizeZ, resX, resZ, heightScale } = ground;
  const meshExtent = useMemo(
    () =>
      maxMeshSegs != null
        ? cappedGroundExtent({ sizeX, sizeZ, resX, resZ }, maxMeshSegs)
        : { sizeX, sizeZ, resX, resZ },
    [sizeX, sizeZ, resX, resZ, maxMeshSegs],
  );

  // Keyed on the lattice only. Height changes are applied in place below, so a
  // sculpt brush does not reallocate positions, UVs and indices on every dab.
  const geometry = useMemo(
    () => buildGroundGeometry(meshExtent, null, 0),
    [meshExtent],
  );

  const material = useMemo(
    () => (layers.length ? createPaintedGroundMaterial(layers, splat, sizeX, sizeZ) : null),
    [layers, splat, sizeX, sizeZ],
  );

  // Layout effect so the displaced surface is in place before the first paint;
  // a flat frame would otherwise flash through on load and on every resize.
  useLayoutEffect(() => {
    updateGroundHeights(geometry, meshExtent, heights, heightScale, { normals: !skipNormals });
  }, [geometry, meshExtent, heights, heightScale, skipNormals]);

  useLayoutEffect(() => {
    return () => {
      geometry.dispose();
      material?.dispose();
    };
  }, [geometry, material]);

  if (!material) return null;

  return (
    <mesh
      ref={ref}
      name={name}
      geometry={geometry}
      material={material}
      receiveShadow
      position={[offset?.[0] ?? 0, -0.002, offset?.[1] ?? 0]}
    />
  );
});

const IndexedPaintedGround = forwardRef<THREE.Mesh, Props>(function IndexedPaintedGround(
  { ground, splat, heights = null, name, maxMeshSegs, skipNormals = false, offset, palette },
  ref,
) {
  const ids = palette?.length ? palette : ground.layers.length ? ground.layers : ["grass"];
  const key = ids.join("|");
  const [material, setMaterial] = useState<THREE.MeshStandardMaterial | null>(null);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);

  const { sizeX, sizeZ, resX, resZ, heightScale } = ground;
  const meshExtent = useMemo(
    () =>
      maxMeshSegs != null
        ? cappedGroundExtent({ sizeX, sizeZ, resX, resZ }, maxMeshSegs)
        : { sizeX, sizeZ, resX, resZ },
    [sizeX, sizeZ, resX, resZ, maxMeshSegs],
  );
  const geometry = useMemo(() => buildGroundGeometry(meshExtent, null, 0), [meshExtent]);
  const fallback = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#6a7354", roughness: 1, metalness: 0 }),
    [],
  );

  useEffect(() => {
    let dead = false;
    void indexedGroundPalette(ids).then((gpu) => {
      if (dead) return;
      const next = createIndexedGroundMaterial(gpu, splat, sizeX, sizeZ);
      matRef.current?.dispose();
      matRef.current = next;
      setMaterial(next);
    });
    return () => {
      dead = true;
    };
    // ids is represented by key; the array identity changes every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, splat, sizeX, sizeZ]);

  useEffect(() => {
    return () => {
      matRef.current?.dispose();
      matRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    updateGroundHeights(geometry, meshExtent, heights, heightScale, { normals: !skipNormals });
  }, [geometry, meshExtent, heights, heightScale, skipNormals]);

  useLayoutEffect(() => {
    return () => {
      geometry.dispose();
      fallback.dispose();
    };
  }, [geometry, fallback]);

  return (
    <mesh
      ref={ref}
      name={name}
      geometry={geometry}
      material={material ?? fallback}
      receiveShadow
      position={[offset?.[0] ?? 0, -0.002, offset?.[1] ?? 0]}
    />
  );
});

export const PaintedGround = forwardRef<THREE.Mesh, Props>(function PaintedGround(props, ref) {
  if (props.splatMode === "index") return <IndexedPaintedGround {...props} ref={ref} />;
  return <WeightPaintedGround {...props} ref={ref} />;
});
