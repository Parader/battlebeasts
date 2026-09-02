/**
 * Tools for authoring against the game's fixed camera.
 *
 * The match camera never yaws: it sits on the +Z side of the player looking
 * toward -Z at a fixed pitch, so every map has one "front". A prop's back is
 * permanently hidden and a wall on the -Z side permanently occludes what is
 * behind it. The editor's orbit camera hides that -- you can happily decorate a
 * facade nobody will ever see -- so this module supplies both a snap to the
 * real angle and a compass that keeps it visible while orbiting.
 */

import { CAMERA } from "@battlebeasts/shared";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { docStore, useEditor } from "../state/docStore";

/** Where the game camera looks, on the ground plane. */
const GAME_LOOK = new THREE.Vector3(0, 0, -1);

/**
 * The compass needle, written to directly rather than through React.
 *
 * It updates every frame while the camera moves, and a per-frame `setState`
 * would re-render the whole viewport for what is one CSS transform.
 */
const needle: { el: HTMLElement | null } = { el: null };

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/**
 * Snaps the editor camera to the game's angle when asked.
 *
 * Distance is preserved rather than forced to the game's follow distance: the
 * question being answered is "which way round is this", and dropping to a
 * player's-eye 22m would throw away whatever framing you were working at. The
 * editor's field of view already matches the game's, so pitch and heading are
 * the only things that differ.
 */
export function GameViewSnap() {
  const { gameViewNonce } = useEditor();
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!gameViewNonce || !controls) return;
    const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    const dist = camera.position.distanceTo(controls.target);
    // Mirrors FixedFollowCamera's placement exactly: +Z side, pitched down.
    camera.position.set(
      controls.target.x,
      controls.target.y + Math.sin(pitch) * dist,
      controls.target.z + Math.cos(pitch) * dist,
    );
    controls.update();
  }, [gameViewNonce, camera, controls]);

  return null;
}

/**
 * Drives the compass needle from the live camera.
 *
 * Projects the game's view direction onto the editor camera's screen axes, so
 * the needle points wherever "into the player's screen" currently lies.
 */
export function OrientationProbe() {
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const el = needle.el;
    if (!el) return;

    const m = camera.matrixWorld.elements;
    _right.set(m[0]!, m[1]!, m[2]!).normalize();
    _up.set(m[4]!, m[5]!, m[6]!).normalize();

    const sx = GAME_LOOK.dot(_right);
    const sy = GAME_LOOK.dot(_up);
    // Screen Y grows downward in CSS, so up-screen is -sy; rotating an
    // upward-pointing needle clockwise by atan2(sx, sy) lands on (sx, -sy).
    const angle = Math.atan2(sx, sy);

    /*
     * Edge-on fade.
     *
     * Looking straight down the game's axis collapses the direction to a point,
     * where the needle's heading is meaningless noise. Its screen length is the
     * honest confidence measure, so it drives opacity.
     */
    const strength = Math.min(1, Math.hypot(sx, sy) * 1.4);
    el.style.transform = `rotate(${angle}rad)`;
    el.style.opacity = `${0.35 + strength * 0.65}`;
  });

  return null;
}

/**
 * Corner compass: which way the match camera faces, from here.
 *
 * Reads "the players are looking this way", so a needle pointing up-screen
 * means the editor view agrees with the game's and what you see is what they
 * will see.
 */
export function OrientationCompass() {
  return (
    <div className="compass" title="Direction the fixed match camera looks. Click to snap the view to it.">
      <button
        className="compass__dial"
        onClick={() => docStore.setUi({ gameViewNonce: Date.now() })}
        aria-label="Snap to game view"
      >
        <span
          className="compass__needle"
          ref={(el) => {
            needle.el = el;
          }}
        />
      </button>
      <span className="compass__label">player view</span>
    </div>
  );
}
