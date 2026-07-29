import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const COUNTER_HOT = "#f5c542";
const COUNTER_SOFT = "#ffe08a";
const REVENGE_HOT = "#ef4444";
const REVENGE_SOFT = "#fca5a5";
const SPIRIT_HOT = "#818cf8";
const SPIRIT_SOFT = "#c7d2fe";

type StatusRow = { statusId: string; stacks?: number };

type MatOrig = {
  emissive: THREE.Color;
  intensity: number;
};

type Props = {
  characterRoot?: THREE.Object3D | null;
  getStatuses: () => StatusRow[];
};

function isGlowSurface(mesh: THREE.Mesh): boolean {
  const name = mesh.name.toLowerCase();
  return (
    mesh.name.startsWith("SM_Chr_") ||
    name.includes("surface") ||
    (mesh as THREE.SkinnedMesh).isSkinnedMesh === true
  );
}

/**
 * Counter armed = bright second-skin gold glow; after trigger = soft gold + ground.
 * Revenge armed = bright second-skin red glow (no post-buff phase yet).
 * Spirit Form = soft blue second-skin wrapper (character stays fully opaque).
 */
export function CounterStatusFx({ characterRoot, getStatuses }: Props) {
  const ground = useRef<THREE.Group>(null);
  const glowActive = useRef(false);
  const matOrig = useRef(new WeakMap<THREE.Material, MatOrig>());
  const overlays = useRef<THREE.SkinnedMesh[]>([]);
  /** 0 = off, 1 = full armed, ~0.28 = buffed soft, ~0.72 = spirit form. */
  const glowAmt = useRef(0);
  const groundAmt = useRef(0);

  const skinMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COUNTER_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.FrontSide,
        fog: false,
      }),
    [],
  );

  const groundCoreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COUNTER_HOT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const groundRingMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COUNTER_SOFT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const groundHaloMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COUNTER_SOFT,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Skinned additive overlays sharing the hero skeleton (mesh-conforming second skin).
  useEffect(() => {
    const root = characterRoot;
    if (!root) return;

    for (const m of overlays.current) {
      m.parent?.remove(m);
    }
    overlays.current = [];

    root.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.visible || !mesh.skeleton) return;
      if (!isGlowSurface(mesh)) return;

      const overlay = new THREE.SkinnedMesh(mesh.geometry, skinMat);
      overlay.bind(mesh.skeleton, mesh.bindMatrix);
      overlay.frustumCulled = false;
      overlay.renderOrder = 3;
      overlay.visible = false;
      overlay.position.copy(mesh.position);
      overlay.quaternion.copy(mesh.quaternion);
      overlay.scale.copy(mesh.scale).multiplyScalar(1.04);
      mesh.parent?.add(overlay);
      overlays.current.push(overlay);
    });

    return () => {
      for (const m of overlays.current) {
        m.parent?.remove(m);
      }
      overlays.current = [];
      clearEmissive(root, matOrig.current);
    };
  }, [characterRoot, skinMat]);

  useFrame(({ clock }, dt) => {
    const rows = getStatuses();
    const t = clock.elapsedTime;
    const safeDt = Math.min(0.05, dt);
    const has = (id: string) => rows.some((r) => r.statusId === id);
    const revengeArmed = has("revengeArmed");
    const counterArmed = has("counterArmed");
    const spiritFormed = has("spiritFormed");
    const armed = revengeArmed || counterArmed;
    const buffed =
      !revengeArmed && (has("counterEmpowered") || has("counterHaste"));
    const mode: "counter" | "revenge" | "spirit" = revengeArmed
      ? "revenge"
      : counterArmed || buffed
        ? "counter"
        : spiritFormed
          ? "spirit"
          : "counter";
    const hot =
      mode === "revenge" ? REVENGE_HOT : mode === "spirit" ? SPIRIT_HOT : COUNTER_HOT;
    const soft =
      mode === "revenge" ? REVENGE_SOFT : mode === "spirit" ? SPIRIT_SOFT : COUNTER_SOFT;

    const pulse = 0.55 + 0.45 * Math.sin(t * (mode === "spirit" ? 5.5 : 9));
    const softPulse = 0.7 + 0.3 * Math.sin(t * 3.2);
    const root = characterRoot ?? null;

    // Armed = full glow; buffed = soft + ground; spirit = blue wrapper; else fade.
    const glowTarget = armed ? 1 : buffed ? 0.28 : spiritFormed ? 0.72 : 0;
    const groundTarget = buffed ? 1 : 0;
    const glowOn = armed || buffed || spiritFormed;
    const glowLerp = 1 - Math.exp(-(glowOn ? 10 : 7) * safeDt);
    const groundLerp = 1 - Math.exp(-(buffed ? 8 : 5) * safeDt);
    glowAmt.current += (glowTarget - glowAmt.current) * glowLerp;
    groundAmt.current += (groundTarget - groundAmt.current) * groundLerp;

    const g = glowAmt.current;
    if (g > 0.01 && root) {
      const emissiveStrength = armed
        ? 0.95 + 0.55 * pulse
        : spiritFormed
          ? (0.35 + 0.2 * softPulse) * (g / 0.72)
          : (0.18 + 0.08 * softPulse) * (g / 0.28);
      applyEmissive(root, matOrig.current, Math.max(0, emissiveStrength), hot);
      glowActive.current = true;

      const skinOp = armed
        ? (0.28 + 0.16 * pulse) * g
        : spiritFormed
          ? (0.2 + 0.1 * softPulse) * (g / 0.72)
          : (0.08 + 0.04 * softPulse) * (g / 0.28);
      skinMat.opacity = Math.max(0, skinOp);
      skinMat.color.set(
        armed && pulse > 0.7 ? hot : spiritFormed ? (pulse > 0.65 ? hot : soft) : soft,
      );
      for (const m of overlays.current) {
        m.visible = skinMat.opacity > 0.01;
        m.scale.setScalar(
          1.03 +
            0.02 * g * (armed ? pulse : spiritFormed ? softPulse : softPulse),
        );
      }
    } else if (glowActive.current && root) {
      clearEmissive(root, matOrig.current);
      glowActive.current = false;
      skinMat.opacity = 0;
      for (const m of overlays.current) m.visible = false;
    } else {
      skinMat.opacity = 0;
      for (const m of overlays.current) m.visible = false;
    }

    const ga = groundAmt.current;
    if (ground.current) {
      ground.current.visible = ga > 0.02;
      if (ga > 0.02) {
        const breathe = 0.85 + 0.15 * Math.sin(t * 4.5);
        ground.current.rotation.y += safeDt * 0.55;
        ground.current.scale.setScalar(0.92 + 0.08 * breathe);
        groundCoreMat.color.set(hot);
        groundRingMat.color.set(soft);
        groundHaloMat.color.set(soft);
        groundCoreMat.opacity = ga * (0.38 + 0.12 * softPulse);
        groundRingMat.opacity = ga * (0.32 + 0.1 * softPulse);
        groundHaloMat.opacity = ga * (0.18 + 0.08 * softPulse);
      } else {
        groundCoreMat.opacity = 0;
        groundRingMat.opacity = 0;
        groundHaloMat.opacity = 0;
      }
    }
  });

  return (
    <group ref={ground} position={[0, 0.03, 0]} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 32]} />
        <primitive object={groundCoreMat} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[0.42, 0.68, 40]} />
        <primitive object={groundRingMat} attach="material" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 5]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.62, 0.92, 40]} />
        <primitive object={groundHaloMat} attach="material" />
      </mesh>
    </group>
  );
}

function applyEmissive(
  scene: THREE.Object3D,
  orig: WeakMap<THREE.Material, MatOrig>,
  intensity: number,
  color: string,
) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.visible) return;
    if (!isGlowSurface(mesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!("emissive" in std) || !std.emissive) continue;
      if (!orig.has(std)) {
        orig.set(std, {
          emissive: std.emissive.clone(),
          intensity: std.emissiveIntensity ?? 0,
        });
      }
      std.emissive.set(color);
      std.emissiveIntensity = intensity;
    }
  });
}

function clearEmissive(scene: THREE.Object3D, orig: WeakMap<THREE.Material, MatOrig>) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const saved = orig.get(m);
      if (!saved) continue;
      const std = m as THREE.MeshStandardMaterial;
      if ("emissive" in std && std.emissive) {
        std.emissive.copy(saved.emissive);
        std.emissiveIntensity = saved.intensity;
      }
      orig.delete(m);
    }
  });
}
