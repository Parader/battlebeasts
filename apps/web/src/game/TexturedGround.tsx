import { useLayoutEffect, useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

/** Poly Haven sandy_gravel_02 — https://polyhaven.com/a/sandy_gravel_02 */
const TEX = {
  diff: "/ground_textures/sandy_gravel_02_diff_2k.jpg",
  nor: "/ground_textures/sandy_gravel_02_nor_gl_2k.jpg",
  rough: "/ground_textures/sandy_gravel_02_rough_2k.jpg",
  ao: "/ground_textures/sandy_gravel_02_ao_2k.jpg",
} as const;

export const GROUND_TEXTURE_URLS = [TEX.diff, TEX.nor, TEX.rough, TEX.ao] as const;

/**
 * World meters per texture repeat. Larger = softer detail, fewer seams.
 * Poly Haven scan is 2.5m; we stretch for top-down readability.
 */
const TILE_METERS = 7;

type Props = {
  size?: number;
};

/**
 * Inigo Quilez-style no-tile: 4 random-offset samples blended across UV cells.
 * Hides the regular gravel grid that a single tiled sample always shows.
 */
function applyNoTile(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>

        vec2 bbHash22(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return fract(sin(p) * 43758.5453123);
        }

        // Sample map with randomized per-cell offsets (IQ texture repetition)
        vec4 bbNoTile(sampler2D samp, vec2 uv) {
          vec2 iuv = floor(uv);
          vec2 fuv = fract(uv);

          // Soft weights so cell borders don't hard-cut
          vec2 w = fuv * fuv * (3.0 - 2.0 * fuv);

          vec4 tot = vec4(0.0);
          for (int j = 0; j < 2; j++) {
            for (int i = 0; i < 2; i++) {
              vec2 cell = iuv + vec2(float(i), float(j));
              vec2 off = bbHash22(cell);
              // Rotate 0 / 90 / 180 / 270 from hash so pebbles don't align
              float ang = floor(off.x * 4.0) * 1.5707963;
              float s = sin(ang), c = cos(ang);
              vec2 ru = mat2(c, -s, s, c) * (uv + off * 17.0);
              vec4 smp = texture2D(samp, ru);
              float wt = (i == 0 ? 1.0 - w.x : w.x) * (j == 0 ? 1.0 - w.y : w.y);
              tot += smp * wt;
            }
          }
          return tot;
        }

        vec3 bbNoTileNormal(sampler2D samp, vec2 uv, vec2 scale) {
          vec2 iuv = floor(uv);
          vec2 fuv = fract(uv);
          vec2 w = fuv * fuv * (3.0 - 2.0 * fuv);
          vec3 tot = vec3(0.0);
          for (int j = 0; j < 2; j++) {
            for (int i = 0; i < 2; i++) {
              vec2 cell = iuv + vec2(float(i), float(j));
              vec2 off = bbHash22(cell);
              float ang = floor(off.x * 4.0) * 1.5707963;
              float s = sin(ang), c = cos(ang);
              mat2 R = mat2(c, -s, s, c);
              vec2 ru = R * (uv + off * 17.0);
              vec3 n = texture2D(samp, ru).xyz * 2.0 - 1.0;
              // Rotate tangent-space normal XY with the same UV rotation
              n.xy = R * n.xy;
              n.xy *= scale;
              float wt = (i == 0 ? 1.0 - w.x : w.x) * (j == 0 ? 1.0 - w.y : w.y);
              tot += n * wt;
            }
          }
          return normalize(tot);
        }
        `,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = bbNoTile(map, vMapUv);
          diffuseColor *= sampledDiffuseColor;
        #endif
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= bbNoTile(roughnessMap, vRoughnessMapUv).g;
        #endif
        `,
      )
      .replace(
        "#include <aomap_fragment>",
        /* glsl */ `
        #ifdef USE_AOMAP
          float ambientOcclusion = (bbNoTile(aoMap, vAoMapUv).r - 1.0) * aoMapIntensity + 1.0;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_CLEARCOAT )
            clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_SHEEN )
            sheenSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
        #endif
        `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #ifdef USE_NORMALMAP_OBJECTSPACE
          normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          #ifdef FLIP_SIDED
            normal = - normal;
          #endif
          #ifdef DOUBLE_SIDED
            normal = normal * faceDirection;
          #endif
          normal = normalize( normalMatrix * normal );
        #elif defined( USE_NORMALMAP_TANGENTSPACE )
          vec3 mapN = bbNoTileNormal(normalMap, vNormalMapUv, normalScale);
          normal = normalize( tbn * mapN );
        #elif defined( USE_BUMPMAP )
          normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
        #endif
        `,
      );
  };
  mat.customProgramCacheKey = () => "bb-iq-notile-ground-v2";
}

export function TexturedGround({ size = 60 }: Props) {
  const [map, normalMap, roughnessMap, aoMap] = useTexture([
    TEX.diff,
    TEX.nor,
    TEX.rough,
    TEX.ao,
  ]);

  const repeat = size / TILE_METERS;

  useLayoutEffect(() => {
    for (const tex of [map, normalMap, roughnessMap, aoMap]) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.repeat.set(repeat, repeat);
      tex.needsUpdate = true;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    normalMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.colorSpace = THREE.NoColorSpace;
    aoMap.colorSpace = THREE.NoColorSpace;
  }, [map, normalMap, roughnessMap, aoMap, repeat]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap,
      aoMap,
      aoMapIntensity: 0.7,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.7, 0.7),
    });
    applyNoTile(mat);
    return mat;
  }, [map, normalMap, roughnessMap, aoMap]);

  useLayoutEffect(() => () => material.dispose(), [material]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={material}>
      <planeGeometry
        args={[size, size]}
        onUpdate={(geo) => {
          const uv = geo.attributes.uv;
          if (uv && !geo.attributes.uv2) {
            geo.setAttribute("uv2", uv.clone());
          }
        }}
      />
    </mesh>
  );
}

useTexture.preload(TEX.diff);
useTexture.preload(TEX.nor);
useTexture.preload(TEX.rough);
useTexture.preload(TEX.ao);
