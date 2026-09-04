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
const _wardWorld = new THREE.Vector3();
const HAND_LIGHT = "#93c5fd";
const BULWARK_LIGHT = "#94a3b8";

/**
 * Hand Shield VFX — half-cylinder force-shield shader.
 * Also draws a much smaller forward ward while `bulwarkCharging` is active.
 */
export function HandShieldFx({ characterRoot, getStatuses }: Props) {
  const anchor = useRef<THREE.Group>(null);
  const handShield = useRef<THREE.Group>(null);
  const bulwarkWard = useRef<THREE.Group>(null);
  const leftLight = useSpellLight();
  const rightLight = useSpellLight();
  const leftHandRef = useRef<THREE.Object3D | null>(null);
  const rightHandRef = useRef<THREE.Object3D | null>(null);
  const handAppear = useRef(0);
  const bulwarkAppear = useRef(0);

  const handGeo = useMemo(
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
  /** Compact forward disc for Bulwark Charge — same material language, much smaller. */
  const bulwarkGeo = useMemo(
    () =>
      new THREE.CylinderGeometry(
        0.42,
        0.42,
        0.85,
        24,
        1,
        true,
        -Math.PI * 0.42,
        Math.PI * 0.84,
      ),
    [],
  );
  const handMat = useMemo(() => createHandShieldMaterial(), []);
  const bulwarkMat = useMemo(() => createHandShieldMaterial(), []);

  useEffect(() => {
    return () => {
      handGeo.dispose();
      bulwarkGeo.dispose();
      handMat.dispose();
      bulwarkMat.dispose();
    };
  }, [handGeo, bulwarkGeo, handMat, bulwarkMat]);

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
    const handG = handShield.current;
    const wardG = bulwarkWard.current;
    if (!aRoot || !handG || !wardG) return;

    const statuses = getStatuses();
    const handArmed = statuses.some((r) => r.statusId === "handShielding");
    const bulwarkArmed = statuses.some((r) => r.statusId === "bulwarkCharging");

    handAppear.current +=
      ((handArmed ? 1 : 0) - handAppear.current) *
      (1 - Math.exp(-(handArmed ? 16 : 28) * dt));
    bulwarkAppear.current +=
      ((bulwarkArmed ? 1 : 0) - bulwarkAppear.current) *
      (1 - Math.exp(-(bulwarkArmed ? 16 : 28) * dt));

    const hA = handAppear.current;
    const bA = bulwarkAppear.current;
    const showHand = hA > 0.02;
    const showBulwark = bA > 0.02;
    aRoot.visible = showHand || showBulwark;

    handMat.uniforms.uOpacity.value = hA;
    handMat.uniforms.uTime.value = clock.elapsedTime;
    bulwarkMat.uniforms.uOpacity.value = bA * 0.9;
    bulwarkMat.uniforms.uTime.value = clock.elapsedTime;

    const pulse = 0.97 + 0.03 * Math.sin(clock.elapsedTime * 3.2);
    const handGlow = hA * (1.2 + 0.3 * Math.sin(clock.elapsedTime * 5.5));
    const wardGlow = bA * (1.0 + 0.25 * Math.sin(clock.elapsedTime * 6.2));

    const placeHandLight = (bone: THREE.Object3D | null, light: SpellLight) => {
      if (!showHand || !bone) {
        light.off();
        return;
      }
      bone.getWorldPosition(_handWorld);
      light.emit(_handWorld.x, _handWorld.y, _handWorld.z, HAND_LIGHT, handGlow * 2.6, 1.9);
    };
    placeHandLight(leftHandRef.current, leftLight);
    if (showHand) {
      placeHandLight(rightHandRef.current, rightLight);
    } else if (showBulwark) {
      _wardWorld.set(0, 1.05, 0.55);
      aRoot.localToWorld(_wardWorld);
      rightLight.emit(
        _wardWorld.x,
        _wardWorld.y,
        _wardWorld.z,
        BULWARK_LIGHT,
        wardGlow * 1.5,
        1.15,
      );
    } else {
      rightLight.off();
    }

    handG.visible = showHand;
    if (showHand) {
      const hand = leftHandRef.current ?? rightHandRef.current;
      if (hand) {
        hand.getWorldPosition(_handWorld);
        _localPos.copy(_handWorld);
        aRoot.worldToLocal(_localPos);
        handG.position.set(
          THREE.MathUtils.clamp(_localPos.x * 0.2, -0.15, 0.15),
          Math.max(0.9, _localPos.y * 0.3 + 1.0),
          Math.max(0.06, _localPos.z * 0.1 + 0.08),
        );
        handG.rotation.set(0, 0, 0);
      }
      handG.scale.setScalar((0.96 + 0.05 * hA) * pulse);
    }

    wardG.visible = showBulwark;
    if (showBulwark) {
      // Fixed forward ward at chest — resists what's thrown ahead.
      wardG.position.set(0, 1.05, 0.55);
      wardG.rotation.set(0, 0, 0);
      wardG.scale.setScalar((0.95 + 0.08 * bA) * pulse);
    }
  });

  return (
    <group ref={anchor} visible={false}>
      <group ref={handShield} renderOrder={5} visible={false}>
        <mesh geometry={handGeo} material={handMat} renderOrder={5} />
      </group>
      <group ref={bulwarkWard} renderOrder={5} visible={false}>
        <mesh geometry={bulwarkGeo} material={bulwarkMat} renderOrder={5} />
      </group>
    </group>
  );
}
