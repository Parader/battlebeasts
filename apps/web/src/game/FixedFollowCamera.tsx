import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

type Props = {
    /** Live player ground position. */
    target: MutableRefObject<THREE.Vector3>;
    pitchDeg: number;
    /** Default / max follow distance. */
    distance: number;
    /** Closest zoom via scroll (defaults to ~55% of max). */
    minDistance?: number;
    fov: number;
    followLambda: number;
    cursorLambda: number;
    cursorInfluence: number;
};

/**
 * Battlerite-style camera:
 * - Fixed world yaw/pitch (never spins with the mouse)
 * - Soft-follows the player so quick back/forth barely shakes the view
 * - Cursor pulls the look-at so the character can sit up to ~cursorInfluence of half-screen opposite the cursor
 * - Scroll wheel zooms between minDistance and distance
 */
export function FixedFollowCamera({
    target,
    pitchDeg,
    distance,
    minDistance,
    fov,
    followLambda,
    cursorLambda,
    cursorInfluence,
}: Props) {
    const { gl } = useThree();
    const softPlayer = useRef(new THREE.Vector3());
    const softCursor = useRef(new THREE.Vector2(0, 0));
    const focus = useRef(new THREE.Vector3());
    const desiredCam = useRef(new THREE.Vector3());
    const seeded = useRef(false);
    const liveDist = useRef(distance);
    const zoomMin = minDistance ?? distance * 0.55;
    const zoomMax = distance;

    useEffect(() => {
        liveDist.current = THREE.MathUtils.clamp(liveDist.current, zoomMin, zoomMax);
    }, [zoomMin, zoomMax]);

    useEffect(() => {
        const el = gl.domElement;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            // Scroll up → closer; scroll down → farther (capped at max).
            const step = Math.sign(e.deltaY) * Math.min(1.8, 0.55 + Math.abs(e.deltaY) * 0.012);
            liveDist.current = THREE.MathUtils.clamp(
                liveDist.current + step,
                zoomMin,
                zoomMax,
            );
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [gl, zoomMin, zoomMax]);

    useFrame((state, dt) => {
        const { camera, size, pointer } = state;
        const t = target.current;
        if (!t) return;

        // R3F keeps pointer in NDC (−1…1); fall back to center if unavailable
        const px = typeof pointer?.x === "number" ? pointer.x : 0;
        const py = typeof pointer?.y === "number" ? pointer.y : 0;
        const safeDt = Math.min(0.05, Math.max(0, dt));
        const dist = liveDist.current;

        if (!seeded.current) {
            softPlayer.current.set(t.x, t.y, t.z);
            softCursor.current.set(px, py);
            seeded.current = true;
        }

        // Heavy damping on player → rapid strafe barely moves the frame
        const followA = 1 - Math.exp(-followLambda * safeDt);
        softPlayer.current.x += (t.x - softPlayer.current.x) * followA;
        softPlayer.current.y += (t.y - softPlayer.current.y) * followA;
        softPlayer.current.z += (t.z - softPlayer.current.z) * followA;

        // Cursor look-ahead a bit snappier than player follow
        const cursorA = 1 - Math.exp(-cursorLambda * safeDt);
        softCursor.current.x += (px - softCursor.current.x) * cursorA;
        softCursor.current.y += (py - softCursor.current.y) * cursorA;

        const cx = THREE.MathUtils.clamp(softCursor.current.x, -1, 1);
        const cy = THREE.MathUtils.clamp(softCursor.current.y, -1, 1);

        const aspect = size.width / Math.max(1, size.height);
        const vFov =
            camera instanceof THREE.PerspectiveCamera
                ? THREE.MathUtils.degToRad(camera.fov)
                : THREE.MathUtils.degToRad(fov);
        const halfH = Math.tan(vFov * 0.5) * dist;
        const halfW = halfH * aspect;
        const pitch = THREE.MathUtils.degToRad(pitchDeg);
        // Pitched view stretches ground depth relative to screen Y
        const groundZScale = 1 / Math.max(0.4, Math.sin(pitch));

        const maxX = halfW * cursorInfluence;
        const maxZ = halfH * cursorInfluence * groundZScale;

        // Fixed POV: camera always sits on +Z side of focus; screen-up → −Z
        focus.current.set(softPlayer.current.x + cx * maxX, softPlayer.current.y, softPlayer.current.z - cy * maxZ);

        desiredCam.current.set(
            focus.current.x,
            focus.current.y + Math.sin(pitch) * dist,
            focus.current.z + Math.cos(pitch) * dist,
        );
        camera.position.copy(desiredCam.current);
        camera.lookAt(focus.current.x, focus.current.y + 0.8, focus.current.z);
    });

    return null;
}
