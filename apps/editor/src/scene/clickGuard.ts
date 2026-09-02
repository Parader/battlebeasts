/**
 * Distinguishes a click from a camera drag.
 *
 * Left-drag orbits and left-click places, so without this every placement that
 * nudges the mouse also spins the camera. Rebinding the camera to another
 * mouse button was the alternative, but left-drag-to-orbit is the muscle
 * memory people bring from every other 3D tool -- so instead, tools act on
 * pointer *up* and bail if the pointer travelled far enough to be a drag.
 *
 * Listeners are capture-phase on window so they always run before R3F's
 * canvas handlers, whatever the event ends up hitting.
 */

/** Pixels of travel before a press counts as a drag rather than a click. */
const DRAG_SLOP_PX = 5;

let downX = 0;
let downY = 0;
let dragged = false;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      downX = e.clientX;
      downY = e.clientY;
      dragged = false;
    },
    { capture: true },
  );

  window.addEventListener(
    "pointermove",
    (e) => {
      if (dragged) return;
      if (Math.abs(e.clientX - downX) > DRAG_SLOP_PX || Math.abs(e.clientY - downY) > DRAG_SLOP_PX) {
        dragged = true;
      }
    },
    { capture: true },
  );
}

/** True if the gesture ending now moved far enough to be a camera drag. */
export function wasDragged(): boolean {
  return dragged;
}
