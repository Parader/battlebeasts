import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type Props = {
    target: MutableRefObject<THREE.Vector3>;
    pitchDeg: number;
    distance: number;
};

/** Battlerite-style fixed POV: locked pitch/angle, follows local player. */
export function FixedFollowCamera({ target, pitchDeg, distance }: Props) {
    const desired = useRef(new THREE.Vector3());
    const look = useRef(new THREE.Vector3());
    const offset = useRef(new THREE.Vector3());

    useFrame(({ camera }) => {
        const pitch = THREE.MathUtils.degToRad(pitchDeg);
        offset.current.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance);
        desired.current.copy(target.current).add(offset.current);
        camera.position.lerp(desired.current, 0.35);
        look.current.set(target.current.x, target.current.y + 0.8, target.current.z);
        camera.lookAt(look.current);
    });

    return null;
}
