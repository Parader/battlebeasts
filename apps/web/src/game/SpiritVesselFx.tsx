import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  COSMETIC_AURA_TINTS,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  mixAuraColor,
  normalizeCosmeticAura,
  normalizeCosmeticPatternColor,
  resolveHideTint,
  type CosmeticAuraId,
} from "@battlebeasts/shared";
import { CHARACTER_TARGET_HEIGHT } from "./characterVisual";
import { createChakraVeilGeometry, createChakraVeilMaterial } from "./vfx/auraChakraVeil";
import { createAuraEyeMaterial, getAuraEyesTexture } from "./vfx/auraEyesTexture";
import { getAuraWispMaterial, setAuraWispProjection } from "./vfx/auraWispTextures";
import { findHandBone, findMixamoBone } from "./vfx/attach";

const OVERLAY_NAME = "bbSpiritVessel";
const ORB_NAME = "bbSpiritJoint";
const MOTE_NAME = "bbSpiritAuraMotes";
const EYE_NAME = "bbSpiritAuraEyes";
const VEIL_NAME = "bbSpiritChakraVeil";
/** Strip height vs character height (width comes from the wrap arc). */
const EYE_HEIGHT_FRAC = 0.038;
/** Head → HeadTop_End local Y. Eyes sit below the crown. */
const EYE_UP_ALONG_CROWN = 0.4;
/** Cylinder radius vs skull height — sits on the face, not inside it. */
const EYE_RADIUS_ALONG_CROWN = 0.54;
/** Face wrap in radians, centered on Head +Z. */
const EYE_ARC = 1.08;
const BASE_OPACITY = 0.11;
const PULSE_OPACITY = 0.035;
const AURA_SHELL_BOOST = 0.08;
const ORB_OPACITY = 0.28;
const ORB_WHITE = new THREE.Color("#ffffff");
const CLUSTER_COUNT = 8;
const MAX_WISPS = 48;
/** Authored `maxSize` center — sprite diameter as a fraction of character height. */
const WISP_SIZE_REF = 0.1;
const WISP_HEIGHT_FRAC = 0.155;
/** Travel envelope vs a 1.7 m body. */
const WISP_SPREAD = 2.0;
const WISP_SPEED = 0.95;
/** Push body-cluster wisps outside armor, in meters at 1.7 m height. */
const BODY_OUTSET = 0.1;
const _world = new THREE.Vector3();
const _palm = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _hips = new THREE.Vector3();
const _sole = new THREE.Vector3();
/** Wrist (Hand) → middle-knuckle blend so plumes sit in the palm, not the wrist. */
const HAND_PALM_BLEND = 0.62;
/** Neck → shoulder so the collar plume wraps outside hats, chest, and pads. */
const NECK_COLLAR_BLEND = 0.3;
/** World meters: sit above the clavicle / in front of the throat. */
const NECK_UP_M = 0.04;
const NECK_FORWARD_M = 0.055;
const _hot = new THREE.Color();
const _mid = new THREE.Color();
const _cool = new THREE.Color();
const _tint = new THREE.Color();

function bead(frac: number): [number, number, number] {
  const r = CHARACTER_TARGET_HEIGHT * frac;
  return [r, r, r];
}

const JOINT_ORBS: ReadonlyArray<{
  bone: string;
  radius: readonly [number, number, number];
  offset?: readonly [number, number, number];
}> = [
  { bone: "Spine1", radius: bead(0.016), offset: [0, -7.12, 0.26] },
  { bone: "Neck", radius: bead(0.015) },
  { bone: "LeftShoulder", radius: bead(0.014) },
  { bone: "RightShoulder", radius: bead(0.014) },
  { bone: "LeftArm", radius: bead(0.016) },
  { bone: "RightArm", radius: bead(0.016) },
  { bone: "LeftForeArm", radius: bead(0.012) },
  { bone: "RightForeArm", radius: bead(0.012) },
  { bone: "LeftUpLeg", radius: bead(0.017) },
  { bone: "RightUpLeg", radius: bead(0.017) },
  { bone: "LeftLeg", radius: bead(0.012) },
  { bone: "RightLeg", radius: bead(0.012) },
];

type Motion = "rise" | "fall" | "orbit" | "inward" | "sparkle";

type AuraStyle = {
  motion: Motion;
  rise: number;
  swirl: number;
  spread: number;
  maxLife: number;
  maxSize: number;
  rate: number;
};

/** Ember’s wrap — every aura sits on this plate; only the PNG changes. */
const EYE_RADIUS_MUL = 1.05;
const EYE_HEIGHT_MUL = 1.2;
const EYE_NOD = -0.05;

function auraStyle(id: CosmeticAuraId): AuraStyle | null {
  switch (id) {
    case "ember":
      return { motion: "rise", rise: 0.2, swirl: 0.48, spread: 0.042, maxLife: 0.62, maxSize: 0.1, rate: 18 };
    case "frost":
      return { motion: "fall", rise: 0.11, swirl: 0.25, spread: 0.044, maxLife: 0.66, maxSize: 0.102, rate: 16 };
    case "venom":
      return { motion: "orbit", rise: 0.09, swirl: 1.4, spread: 0.046, maxLife: 0.64, maxSize: 0.098, rate: 17 };
    case "void":
      return { motion: "inward", rise: 0.07, swirl: -0.78, spread: 0.05, maxLife: 0.6, maxSize: 0.1, rate: 17 };
    case "gold":
      return { motion: "sparkle", rise: 0.14, swirl: 0.6, spread: 0.04, maxLife: 0.5, maxSize: 0.094, rate: 20 };
    default:
      return null;
  }
}

type Wisp = {
  alive: boolean;
  cluster: number;
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  rotationRate: number;
};

function wispAlpha(t: number): number {
  if (t < 0.12) return t / 0.12;
  if (t < 0.55) return 1;
  return Math.max(0, 1 - (t - 0.55) / 0.45);
}

function wispSize(t: number): number {
  return 0.82 + 0.45 * Math.min(1, t * 1.15);
}

type StatusRow = { statusId: string };

type OrbBinding = {
  mesh: THREE.Mesh;
  bone: THREE.Object3D;
  radius: THREE.Vector3;
};

type EyeBinding = {
  mesh: THREE.Mesh;
  head: THREE.Object3D;
  headTop: THREE.Object3D | null;
};

type ClusterKind = "hand" | "foot" | "neck" | "body";

type ClusterAnchor = {
  bone: THREE.Object3D;
  kind: ClusterKind;
  /** Hand: middle knuckle. Neck: Left/RightShoulder for a collar wrap. */
  palm: THREE.Object3D | null;
};

function isAuraHost(mesh: THREE.Mesh): boolean {
  if (mesh.name.startsWith("bb")) return false;
  const name = mesh.name.toLowerCase();
  return mesh.name.startsWith("SM_Chr_") || name.includes("surface");
}

type Props = {
  characterRoot?: THREE.Object3D | null;
  getColor: () => string;
  getAura?: () => string;
  getAuraColor?: () => string;
  opacity?: number;
  getOpacity?: () => number;
  getStatuses?: () => StatusRow[];
  /** Preview is head-on, so eyes skip depth test; world keeps them on the skull. */
  stage?: "world" | "preview";
};

function collectAuraHosts(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const hosts: THREE.SkinnedMesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible || !mesh.skeleton) return;
    if (!isAuraHost(mesh)) return;
    hosts.push(mesh);
  });
  return hosts;
}

function attachAuraOverlay(
  mesh: THREE.SkinnedMesh,
  mat: THREE.Material,
): THREE.SkinnedMesh {
  const overlay = new THREE.SkinnedMesh(mesh.geometry, mat);
  overlay.name = OVERLAY_NAME;
  overlay.userData.bbAuraHost = mesh;
  overlay.bind(mesh.skeleton, mesh.bindMatrix);
  overlay.frustumCulled = false;
  overlay.renderOrder = 2;
  overlay.position.copy(mesh.position);
  overlay.quaternion.copy(mesh.quaternion);
  overlay.scale.copy(mesh.scale);
  mesh.parent?.add(overlay);
  return overlay;
}

function hostKey(hosts: THREE.SkinnedMesh[]): string {
  return hosts.map((m) => m.uuid).join(",");
}

function combatGlowActive(rows: StatusRow[]): boolean {
  return rows.some(
    (r) =>
      r.statusId === "counterArmed" ||
      r.statusId === "revengeArmed" ||
      r.statusId === "spiritFormed",
  );
}

/** Cosmetic aura yields to spell status so those FX stay readable. */
function auraStatusMul(rows: StatusRow[] | undefined): number {
  if (!rows?.length) return 1;
  if (combatGlowActive(rows)) return 0.12;
  return 0.5;
}

function characterWorldHeight(root: THREE.Object3D, scratch: THREE.Vector3): number {
  root.getWorldScale(scratch);
  const localY = Math.max(Math.abs(root.scale.y), 1e-8);
  return CHARACTER_TARGET_HEIGHT * (Math.abs(scratch.y) / localY);
}

function headCrownLocalY(head: THREE.Object3D, headTop: THREE.Object3D | null): number {
  if (!headTop) return 0;
  if (headTop.parent === head) return headTop.position.y;
  headTop.getWorldPosition(_palm);
  head.worldToLocal(_palm);
  return _palm.y;
}

function fitAuraEyes(
  mesh: THREE.Mesh,
  head: THREE.Object3D,
  headTop: THREE.Object3D | null,
  heightM: number,
  scratch: THREE.Vector3,
  preview: boolean,
): void {
  head.getWorldScale(scratch);
  const sy = Math.max(Math.abs(scratch.y), 1e-8);
  const heightLocal = (heightM * EYE_HEIGHT_FRAC * EYE_HEIGHT_MUL) / sy;
  const crown = headCrownLocalY(head, headTop);
  const radiusMul = EYE_RADIUS_MUL * (preview ? 1.16 : 1);
  if (Math.abs(crown) > 1e-5) {
    const r = Math.abs(crown) * EYE_RADIUS_ALONG_CROWN * radiusMul;
    mesh.scale.set(r, heightLocal, r);
    mesh.position.set(0, crown * EYE_UP_ALONG_CROWN, 0);
  } else {
    const r = (heightM * 0.05 * radiusMul) / Math.max(Math.abs(scratch.x), 1e-8);
    mesh.scale.set(r, heightLocal, r);
    mesh.position.set(0, (heightM * 0.032) / sy, 0);
  }
  mesh.quaternion.identity();
  mesh.rotateX(EYE_NOD);
}

function fitOrbToWorld(
  mesh: THREE.Mesh,
  bone: THREE.Object3D,
  radius: THREE.Vector3,
  scratch: THREE.Vector3,
  bodyMul = 1,
): void {
  bone.getWorldScale(scratch);
  mesh.scale.set(
    (radius.x * bodyMul) / Math.max(Math.abs(scratch.x), 1e-8),
    (radius.y * bodyMul) / Math.max(Math.abs(scratch.y), 1e-8),
    (radius.z * bodyMul) / Math.max(Math.abs(scratch.z), 1e-8),
  );
}

function makeWispPool(): Wisp[] {
  const out: Wisp[] = [];
  for (let i = 0; i < MAX_WISPS; i++) {
    out.push({
      alive: false,
      cluster: 0,
      ox: 0,
      oy: 0,
      oz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      size: 0.1,
      rotation: 0,
      rotationRate: 0,
    });
  }
  return out;
}

/** Ink is the color. Signature only stains temperature so ember stays warmer than frost. */
function dyeAura(ink: THREE.Color, signature: THREE.Color, out: THREE.Color): void {
  out.set(mixAuraColor(`#${signature.getHexString()}`, `#${ink.getHexString()}`));
}

/** Same stops in stand and world — exposure-only, no hue remix. */
function paintWispStops(fx: THREE.Color, hot: THREE.Color, mid: THREE.Color, cool: THREE.Color): void {
  hot.copy(fx).lerp(ORB_WHITE, 0.02);
  mid.copy(fx);
  cool.copy(fx).multiplyScalar(0.82);
}

/**
 * Bound-spirit vessel: hide-color rim on body and gear, joint beads,
 * a chakra veil outside the silhouette, and organic plumes at the limbs
 * and torso. Equipped aura dyes the field; ink is the color.
 */
export function SpiritVesselFx({
  characterRoot,
  getColor,
  getAura,
  getAuraColor,
  opacity = 1,
  getOpacity,
  getStatuses,
  stage = "world",
}: Props) {
  const overlays = useRef<THREE.SkinnedMesh[]>([]);
  const overlayKey = useRef("");
  const bindings = useRef<OrbBinding[]>([]);
  const eyeBinding = useRef<EyeBinding | null>(null);
  const wisps = useRef<Wisp[]>(makeWispPool());
  const motePoints = useRef<THREE.Points | null>(null);
  const veilMesh = useRef<THREE.Mesh | null>(null);
  const hipsBone = useRef<THREE.Object3D | null>(null);
  const footBones = useRef<{ left: THREE.Object3D | null; right: THREE.Object3D | null }>({
    left: null,
    right: null,
  });
  const clusterBones = useRef<Array<ClusterAnchor | null>>([]);
  const emitAcc = useRef(0);
  const emitLimb = useRef(0);
  const living = useRef(0);
  const colorRef = useRef(new THREE.Color("#ffffff"));
  const auraTint = useRef(new THREE.Color("#ffffff"));
  const inkRef = useRef(new THREE.Color("#ffffff"));
  const fxColor = useRef(new THREE.Color("#ffffff"));
  const orbTint = useRef(new THREE.Color("#ffffff"));
  const worldScale = useRef(new THREE.Vector3());
  const burst = useRef(0);
  const lastAura = useRef<CosmeticAuraId>("plain");
  const gain = 1.25;

  const skinMat = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.FrontSide,
      fog: false,
    });
    mat.customProgramCacheKey = () => "spiritVesselFresnel";
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vVesselNormal;
varying vec3 vVesselView;`,
        )
        .replace(
          "#include <fog_vertex>",
          `#include <fog_vertex>
vVesselView = normalize(-mvPosition.xyz);
vVesselNormal = normalize(transformedNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vVesselNormal;
varying vec3 vVesselView;`,
        )
        .replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>
float ndv = abs(dot(normalize(vVesselNormal), normalize(vVesselView)));
float fres = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.35);
gl_FragColor.a *= mix(0.07, 1.0, fres);`,
        );
    };
    return mat;
  }, []);

  const veilMat = useMemo(() => createChakraVeilMaterial(), []);
  const veilGeo = useMemo(() => createChakraVeilGeometry(), []);

  const orbMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    [],
  );

  const orbGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const eyeGeo = useMemo(() => {
    const half = EYE_ARC * 0.5;
    return new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, -half, EYE_ARC);
  }, []);
  const eyeMat = useMemo(() => createAuraEyeMaterial(), []);
  const wispPositions = useMemo(() => new Float32Array(MAX_WISPS * 3), []);
  const wispSizes = useMemo(() => new Float32Array(MAX_WISPS), []);
  const wispColors = useMemo(() => new Float32Array(MAX_WISPS * 4), []);
  const wispAngles = useMemo(() => new Float32Array(MAX_WISPS), []);
  const wispGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(wispPositions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(wispSizes, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(wispColors, 4));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(wispAngles, 1));
    geo.setDrawRange(0, 0);
    return geo;
  }, [wispPositions, wispSizes, wispColors, wispAngles]);

  useEffect(() => {
    const root = characterRoot;
    if (!root) return;

    for (const m of overlays.current) m.parent?.remove(m);
    overlays.current = [];
    for (const b of bindings.current) b.mesh.parent?.remove(b.mesh);
    bindings.current = [];
    if (eyeBinding.current) eyeBinding.current.mesh.parent?.remove(eyeBinding.current.mesh);
    eyeBinding.current = null;
    motePoints.current?.parent?.remove(motePoints.current);
    motePoints.current = null;

    root.updateMatrixWorld(true);
    overlayKey.current = "";
    const hosts = collectAuraHosts(root);
    overlayKey.current = hostKey(hosts);
    for (const mesh of hosts) {
      overlays.current.push(attachAuraOverlay(mesh, skinMat));
    }

    const next: OrbBinding[] = [];
    for (const spec of JOINT_ORBS) {
      const bone = findMixamoBone(root, spec.bone);
      if (!bone) continue;
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.name = `${ORB_NAME}_${spec.bone}`;
      orb.renderOrder = 3;
      orb.frustumCulled = false;
      bone.add(orb);
      orb.quaternion.identity();
      orb.position.set(
        spec.offset?.[0] ?? 0,
        spec.offset?.[1] ?? 0,
        spec.offset?.[2] ?? 0,
      );
      const radius = new THREE.Vector3(spec.radius[0], spec.radius[1], spec.radius[2]);
      fitOrbToWorld(orb, bone, radius, worldScale.current);
      next.push({ mesh: orb, bone, radius });
    }
    bindings.current = next;

    const headBone = findMixamoBone(root, "Head");
    const headTop = findMixamoBone(root, "HeadTop_End");
    if (headBone) {
      const eyes = new THREE.Mesh(eyeGeo, eyeMat);
      eyes.name = EYE_NAME;
      eyes.renderOrder = 5;
      eyes.frustumCulled = false;
      eyes.visible = false;
      headBone.add(eyes);
      eyes.quaternion.identity();
      eyeBinding.current = { mesh: eyes, head: headBone, headTop };
    }

    const leftHand = findHandBone(root, "left");
    const rightHand = findHandBone(root, "right");
    const leftFoot = findMixamoBone(root, "LeftToeBase") ?? findMixamoBone(root, "LeftFoot");
    const rightFoot = findMixamoBone(root, "RightToeBase") ?? findMixamoBone(root, "RightFoot");
    const leftShoulder = findMixamoBone(root, "LeftShoulder");
    const rightShoulder = findMixamoBone(root, "RightShoulder");
    const spine = findMixamoBone(root, "Spine1") ?? findMixamoBone(root, "Spine");
    const hips = findMixamoBone(root, "Hips");
    hipsBone.current = hips;
    footBones.current = { left: leftFoot, right: rightFoot };
    clusterBones.current = [
      leftHand
        ? { bone: leftHand, kind: "hand", palm: findMixamoBone(root, "LeftHandMiddle1") }
        : null,
      rightHand
        ? { bone: rightHand, kind: "hand", palm: findMixamoBone(root, "RightHandMiddle1") }
        : null,
      leftFoot ? { bone: leftFoot, kind: "foot", palm: null } : null,
      rightFoot ? { bone: rightFoot, kind: "foot", palm: null } : null,
      leftShoulder ? { bone: leftShoulder, kind: "body", palm: null } : null,
      rightShoulder ? { bone: rightShoulder, kind: "body", palm: null } : null,
      spine ? { bone: spine, kind: "body", palm: null } : null,
      hips ? { bone: hips, kind: "body", palm: null } : null,
    ];

    const pts = new THREE.Points(wispGeo, getAuraWispMaterial("ember"));
    pts.name = MOTE_NAME;
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    pts.visible = false;
    root.add(pts);
    motePoints.current = pts;

    const veil = new THREE.Mesh(veilGeo, veilMat);
    veil.name = VEIL_NAME;
    veil.frustumCulled = false;
    veil.renderOrder = 1;
    veil.visible = false;
    root.add(veil);
    veilMesh.current = veil;

    return () => {
      for (const m of overlays.current) m.parent?.remove(m);
      overlays.current = [];
      overlayKey.current = "";
      for (const b of bindings.current) b.mesh.parent?.remove(b.mesh);
      bindings.current = [];
      if (eyeBinding.current) eyeBinding.current.mesh.parent?.remove(eyeBinding.current.mesh);
      eyeBinding.current = null;
      pts.parent?.remove(pts);
      motePoints.current = null;
      veil.parent?.remove(veil);
      veilMesh.current = null;
      hipsBone.current = null;
      footBones.current = { left: null, right: null };
    };
  }, [characterRoot, skinMat, orbMat, orbGeo, eyeGeo, eyeMat, wispGeo, veilGeo, veilMat]);

  useEffect(() => {
    return () => {
      skinMat.dispose();
      orbMat.dispose();
      orbGeo.dispose();
      eyeMat.dispose();
      eyeGeo.dispose();
      wispGeo.dispose();
      veilMat.dispose();
      veilGeo.dispose();
    };
  }, [skinMat, orbMat, orbGeo, eyeMat, eyeGeo, wispGeo, veilMat, veilGeo]);

  useFrame(({ clock, camera, gl }, dt) => {
    const hex = getColor();
    if (hex) colorRef.current.set(resolveHideTint(hex).a);
    const auraId = normalizeCosmeticAura(getAura?.() ?? "plain");
    const ink = normalizeCosmeticPatternColor(getAuraColor?.() ?? DEFAULT_COSMETIC_PATTERN_COLOR);
    inkRef.current.set(ink);
    auraTint.current.set(COSMETIC_AURA_TINTS[auraId]);
    dyeAura(inkRef.current, auraTint.current, fxColor.current);

    if (lastAura.current !== auraId) {
      lastAura.current = auraId;
      burst.current = 1;
      emitAcc.current = 0;
      living.current = 0;
      for (const w of wisps.current) w.alive = false;
    }
    burst.current = Math.max(0, burst.current - Math.min(0.05, dt) * 1.65);

    const styled = auraId !== "plain";
    skinMat.color.copy(colorRef.current);
    if (styled) skinMat.color.lerp(fxColor.current, 0.58);
    orbTint.current.copy(colorRef.current);
    if (styled) orbTint.current.lerp(fxColor.current, 0.58);
    else orbTint.current.lerp(ORB_WHITE, 0.08);
    orbMat.color.copy(orbTint.current);

    const vis = Math.max(0, getOpacity ? getOpacity() : opacity);
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * (styled ? 0.85 : 1.35));
    const statusMul = auraStatusMul(getStatuses?.());
    const rimBoost = styled ? AURA_SHELL_BOOST : 0;
    const next =
      vis *
      (BASE_OPACITY + rimBoost + PULSE_OPACITY * pulse + burst.current * 0.1) *
      gain *
      statusMul;
    skinMat.opacity = next;
    orbMat.opacity = vis * (ORB_OPACITY + (styled ? 0.12 : 0.08) * pulse) * gain * statusMul;

    const show = next > 0.008;
    const scratch = worldScale.current;
    const root = characterRoot;
    if (root) {
      const hosts = collectAuraHosts(root);
      const key = hostKey(hosts);
      if (key !== overlayKey.current) {
        overlayKey.current = key;
        const keep = new Set(hosts);
        overlays.current = overlays.current.filter((o) => {
          const host = o.userData.bbAuraHost as THREE.SkinnedMesh | undefined;
          if (host && keep.has(host) && host.parent) return true;
          o.parent?.remove(o);
          return false;
        });
        const bound = new Set(
          overlays.current.map((o) => o.userData.bbAuraHost as THREE.SkinnedMesh),
        );
        for (const mesh of hosts) {
          if (bound.has(mesh)) continue;
          overlays.current.push(attachAuraOverlay(mesh, skinMat));
        }
      }
    }
    for (const m of overlays.current) m.visible = show;
    const showOrbs = orbMat.opacity > 0.02;
    const heightM = root
      ? THREE.MathUtils.clamp(characterWorldHeight(root, scratch), 1.2, 2.4)
      : CHARACTER_TARGET_HEIGHT;
    const bodyMul = THREE.MathUtils.clamp(heightM / CHARACTER_TARGET_HEIGHT, 0.7, 1.45);
    const spreadMul = bodyMul * WISP_SPREAD;
    const speedMul = bodyMul * WISP_SPEED;
    const orbMul = bodyMul * (styled ? 1.22 : 1);
    for (const b of bindings.current) {
      b.mesh.visible = showOrbs;
      if (showOrbs) fitOrbToWorld(b.mesh, b.bone, b.radius, scratch, orbMul);
    }

    const veil = veilMesh.current;
    if (veil && root) {
      const showVeil = styled && vis > 0.05 && statusMul > 0.4;
      veil.visible = showVeil;
      if (showVeil) {
        const hips = hipsBone.current;
        const { left: leftFoot, right: rightFoot } = footBones.current;
        if (hips) {
          hips.getWorldPosition(_hips);
          root.worldToLocal(_hips);
        } else {
          _hips.set(0, 0, 0);
        }
        let soleY = Number.POSITIVE_INFINITY;
        for (const foot of [leftFoot, rightFoot]) {
          if (!foot) continue;
          foot.getWorldPosition(_sole);
          root.worldToLocal(_sole);
          if (_sole.y < soleY) soleY = _sole.y;
        }
        root.getWorldScale(scratch);
        const sy = Math.max(Math.abs(scratch.y), 1e-8);
        const sx = Math.max(Math.abs(scratch.x), 1e-8);
        if (!Number.isFinite(soleY)) soleY = _hips.y - (0.52 * heightM) / sy;
        soleY -= 0.035 / sy;
        const halfH = THREE.MathUtils.clamp((heightM * 0.24) / sy, 0.01, 80);
        const radius = THREE.MathUtils.clamp((0.26 * bodyMul) / sx, 0.008, 40);
        veil.position.set(_hips.x, soleY + halfH, _hips.z);
        veil.scale.set(radius, halfH, radius);
        veilMat.uniforms.uColor.value.copy(fxColor.current);
        veilMat.uniforms.uOpacity.value =
          vis * (0.11 + 0.03 * pulse + burst.current * 0.04) * statusMul;
        veilMat.uniforms.uTime.value = clock.elapsedTime;
      }
    }

    const eyes = eyeBinding.current;
    if (eyes) {
      const showEyes = styled && vis > 0.04;
      eyes.mesh.visible = showEyes;
      eyeMat.depthTest = stage !== "preview";
      if (showEyes) {
        fitAuraEyes(eyes.mesh, eyes.head, eyes.headTop, heightM, scratch, stage === "preview");
        const uColor = eyeMat.uniforms.uColor?.value as THREE.Color | undefined;
        const uOpacity = eyeMat.uniforms.uOpacity;
        const uMap = eyeMat.uniforms.uMap;
        if (uMap) uMap.value = getAuraEyesTexture(auraId);
        if (uColor) {
          uColor.copy(fxColor.current);
          const lum = uColor.r * 0.3 + uColor.g * 0.59 + uColor.b * 0.11;
          if (lum < 0.28) uColor.multiplyScalar(0.28 / Math.max(lum, 0.04));
        }
        if (uOpacity) {
          uOpacity.value = vis * (1.35 + 0.2 * pulse) * statusMul;
        }
      }
    }

    const style = auraStyle(auraId);
    const pts = motePoints.current;
    if (!pts || !style || !styled || !root) {
      if (pts) {
        pts.visible = false;
        wispGeo.setDrawRange(0, 0);
      }
      return;
    }

    const mat = getAuraWispMaterial(auraId);
    if (pts.material !== mat) pts.material = mat;
    setAuraWispProjection(mat, camera, gl);

    const safeDt = Math.min(0.05, dt);
    const burstScale = 1 + burst.current * 0.18;
    const opacityMul = vis * 1.12 * (0.92 + 0.1 * pulse + burst.current * 0.12) * statusMul;
    const rate = style.rate * Math.max(0.4, opacityMul);

    paintWispStops(fxColor.current, _hot, _mid, _cool);

    if (living.current < MAX_WISPS && opacityMul > 0.04) {
      emitAcc.current += safeDt * rate;
      let n = Math.floor(emitAcc.current);
      emitAcc.current -= n;
      while (n > 0 && living.current < MAX_WISPS) {
        n--;
        let slot = -1;
        for (let i = 0; i < MAX_WISPS; i++) {
          if (!wisps.current[i]!.alive) {
            slot = i;
            break;
          }
        }
        if (slot < 0) break;
        const cluster = emitLimb.current % CLUSTER_COUNT;
        emitLimb.current++;
        const anchor = clusterBones.current[cluster];
        if (!anchor) continue;
        const p = wisps.current[slot]!;
        const life = (0.75 + Math.random() * 0.35) * style.maxLife;
        const ang = Math.random() * Math.PI * 2;
        const bodyish = anchor.kind === "body" || anchor.kind === "neck";
        const ring = bodyish ? 0.45 + Math.random() * 0.55 : Math.random();
        const rad = ring * style.spread * spreadMul * (bodyish ? 1.45 : 1);
        p.alive = true;
        p.cluster = cluster;
        p.ox = Math.cos(ang) * rad;
        p.oy = (anchor.kind === "foot" ? 0.02 : bodyish ? 0.01 : 0) * spreadMul;
        p.oz = Math.sin(ang) * rad;
        const sway = (0.03 + Math.random() * 0.05) * speedMul;
        if (style.motion === "fall") {
          p.vx = Math.cos(ang) * sway * 0.28;
          p.vy = -style.rise * speedMul * (0.65 + Math.random() * 0.4);
          p.vz = Math.sin(ang) * sway * 0.28;
        } else if (style.motion === "inward") {
          p.vx = Math.cos(ang) * (0.04 + Math.random() * 0.04) * speedMul;
          p.vy = style.rise * speedMul * (0.4 + Math.random() * 0.35);
          p.vz = Math.sin(ang) * (0.04 + Math.random() * 0.04) * speedMul;
        } else if (style.motion === "orbit") {
          p.vx = 0;
          p.vy = style.rise * speedMul * (0.5 + Math.random() * 0.35);
          p.vz = 0;
        } else {
          p.vx = Math.cos(ang) * sway * 0.32;
          p.vy = style.rise * speedMul * (0.7 + Math.random() * 0.35);
          p.vz = Math.sin(ang) * sway * 0.32;
        }
        p.life = life;
        p.maxLife = life;
        p.size = (0.7 + Math.random() * 0.4) * style.maxSize * burstScale;
        p.rotation = Math.random() * Math.PI * 2;
        p.rotationRate = (Math.random() - 0.5) * 1.8;
        living.current++;
      }
    }

    const hips = hipsBone.current;
    let write = 0;
    let aliveCount = 0;
    for (let i = 0; i < MAX_WISPS; i++) {
      const p = wisps.current[i]!;
      if (!p.alive) continue;
      p.life -= safeDt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const anchor = clusterBones.current[p.cluster];
      if (!anchor) {
        p.alive = false;
        continue;
      }
      aliveCount++;
      p.rotation += p.rotationRate * safeDt;
      const curl = Math.sin(p.life * 3.4 + p.rotation) * 0.022 * speedMul * safeDt;
      if (style.motion === "inward") {
        p.ox *= 1 - 1.6 * safeDt;
        p.oz *= 1 - 1.6 * safeDt;
      } else if (style.motion === "orbit") {
        const spin = style.swirl * 0.55 * safeDt;
        const nx = p.ox * Math.cos(spin) - p.oz * Math.sin(spin);
        const nz = p.ox * Math.sin(spin) + p.oz * Math.cos(spin);
        p.ox = nx;
        p.oz = nz;
      } else {
        p.ox += p.vx * safeDt + curl;
        p.oz += p.vz * safeDt;
      }
      p.oy += p.vy * safeDt;
      p.vx *= 1 - 1.35 * safeDt;
      p.vz *= 1 - 1.35 * safeDt;

      anchor.bone.getWorldPosition(_world);
      if (anchor.palm) {
        anchor.palm.getWorldPosition(_palm);
        _world.lerp(
          _palm,
          anchor.kind === "neck" ? NECK_COLLAR_BLEND : HAND_PALM_BLEND,
        );
      }
      if (anchor.kind === "neck") {
        _fwd.set(0, 1, 0).transformDirection(anchor.bone.matrixWorld).normalize();
        _world.addScaledVector(_fwd, NECK_UP_M);
        _fwd.set(0, 0, 1).transformDirection(anchor.bone.matrixWorld).normalize();
        _world.addScaledVector(_fwd, NECK_FORWARD_M);
      } else if (anchor.kind === "body" && hips) {
        hips.getWorldPosition(_hips);
        _fwd.copy(_world).sub(_hips);
        _fwd.y *= 0.15;
        const xz = Math.hypot(_fwd.x, _fwd.z);
        if (xz < 1e-4) {
          _fwd.set(_world.x - _hips.x + 0.04, 0, _world.z - _hips.z);
        }
        const push = BODY_OUTSET * bodyMul;
        const scale = (xz + push) / Math.max(xz, 1e-4);
        _world.x = _hips.x + _fwd.x * scale;
        _world.z = _hips.z + _fwd.z * scale;
      }
      root.worldToLocal(_world);

      const u = 1 - p.life / p.maxLife;
      if (u < 0.35) _tint.copy(_hot).lerp(_mid, u / 0.35);
      else _tint.copy(_mid).lerp(_cool, (u - 0.35) / 0.65);

      wispPositions[write * 3] = _world.x + p.ox;
      wispPositions[write * 3 + 1] = _world.y + p.oy;
      wispPositions[write * 3 + 2] = _world.z + p.oz;
      wispSizes[write] =
        p.size * wispSize(u) * (WISP_HEIGHT_FRAC / WISP_SIZE_REF) * heightM;
      wispColors[write * 4] = _tint.r;
      wispColors[write * 4 + 1] = _tint.g;
      wispColors[write * 4 + 2] = _tint.b;
      wispColors[write * 4 + 3] = wispAlpha(u) * opacityMul;
      wispAngles[write] = p.rotation;
      write++;
    }
    living.current = aliveCount;
    wispGeo.setDrawRange(0, write);
    wispGeo.attributes.position!.needsUpdate = true;
    wispGeo.attributes.aSize!.needsUpdate = true;
    wispGeo.attributes.aColor!.needsUpdate = true;
    wispGeo.attributes.aAngle!.needsUpdate = true;
    pts.visible = write > 0 && opacityMul > 0.03;
  });

  return null;
}
