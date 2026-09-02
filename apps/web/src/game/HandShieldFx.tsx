import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { findHandBone } from "./vfx/attach";
import { createHandShieldMaterial } from "./vfx/materials/handShield";
import { useSpellLight, type SpellLight } from "./vfx/spellLights";
import type { StatusRowLite } from "./StatusOrnaments";

type Props = {
  characterRoot?: THREE.Object3D | null;
  getStatuses: () => StatusRowLite[];
};

const _handWorld = new THREE.Vector3();
const _localPos = new THREE.Vector3();
const HAND_LIGHT = "#93c5fd";

/**
 * Hand Shield VFX — single half-cylinder + lightweight force-shield shader
 * (fresnel / soft hex / cheap flow), inspired by cortiz2894/flow-shield-effect
 * without hit rings, dissolve, or extra post-process cost.
 */
export function HandShieldFx({ characterRoot, getStatuses }: Props) {
  const anchor = useRef<THREE.Group>(null);
  const shield = useRef<THREE.Group>(null);
  const leftLight = useSpellLight();
  const rightLight = useSpellLight();
  const leftHandRef = useRef<THREE.Object3D | null>(null);
  const rightHandRef = useRef<THREE.Object3D | null>(null);
  const appear = useRef(0);

  const geo = useMemo(
    () =>
      new THREE.CylinderGeometry(
        1.45,
        1.45,
        2.15,
        36,
        1,
        true,
        -Math.PI * 0.38,
        Math.PI * 0.76,
      ),
    [],
  );
  const mat = useMemo(() => createHandShieldMaterial(), []);

  useEffect(() => {
    return () => {
      geo.dispose();
      mat.dispose();
    };
  }, [geo, mat]);

  useEffect(() => {
    if (!characterRoot) {
      leftHandRef.current = null;
      rightHandRef.current = null;
      return;
    }
    leftHandRef.current = findHandBone(characterRoot, "left");
    rightHandRef.current = findHandBone(characterRoot, "right");
  }, [characterRoot]);

  useFrame(({ clock }, dt) => {
    const aRoot = anchor.current;
    const s = shield.current;
    if (!aRoot || !s) return;

    const armed = getStatuses().some((r) => r.statusId === "handShielding");
    const target = armed ? 1 : 0;
    // Snap off with the status so the fade doesn't outlive protection.
    appear.current += (target - appear.current) * (1 - Math.exp(-(armed ? 16 : 28) * dt));
    const a = appear.current;
    const show = a > 0.02;
    aRoot.visible = show;
    mat.uniforms.uOpacity.value = a;
    mat.uniforms.uTime.value = clock.elapsedTime;

    const pulse = 0.97 + 0.03 * Math.sin(clock.elapsedTime * 3.2);
    const handGlow = a * (1.2 + 0.3 * Math.sin(clock.elapsedTime * 5.5));

    const placeHandLight = (bone: THREE.Object3D | null, light: SpellLight) => {
      if (!show || !bone) {
        light.off();
        return;
      }
      // Pool lights live at the scene root, so world space directly — no need
      // to convert into the avatar's local frame as the nested lights did.
      bone.getWorldPosition(_handWorld);
      light.emit(_handWorld.x, _handWorld.y, _handWorld.z, HAND_LIGHT, handGlow * 2.6, 1.9);
    };
    placeHandLight(leftHandRef.current, leftLight);
    placeHandLight(rightHandRef.current, rightLight);

    if (!show) return;

    const hand = leftHandRef.current ?? rightHandRef.current;
    if (hand) {
      hand.getWorldPosition(_handWorld);
      _localPos.copy(_handWorld);
      aRoot.worldToLocal(_localPos);
      s.position.set(
        THREE.MathUtils.clamp(_localPos.x * 0.2, -0.15, 0.15),
        Math.max(0.9, _localPos.y * 0.3 + 1.0),
        Math.max(0.06, _localPos.z * 0.1 + 0.08),
      );
      s.rotation.set(0, 0, 0);
    }

    s.scale.setScalar((0.96 + 0.05 * a) * pulse);
  });

  return (
    <group ref={anchor} visible={false}>
      <group ref={shield} renderOrder={5}>
        <mesh geometry={geo} material={mat} renderOrder={5} />
      </group>
    </group>
  );
}
