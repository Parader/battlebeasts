/**
 * Hub first-join intro narration.
 * Edit lines here — keep each beat short (≤2 lines on screen).
 */

export type HubIntroLine = {
  id: string;
  /** Main caption (1–2 short sentences). */
  text: string;
  /** How long to hold this beat before advancing (ms). */
  holdMs: number;
};

/** ~25° left — applied to character facing at intro pose. */
export const HUB_INTRO_CHARACTER_YAW_OFFSET = (-25 * Math.PI) / 180;

export const HUB_INTRO_LINES: readonly HubIntroLine[] = [
  {
    id: "awake",
    text: "Awake, clone.\nYour awakening is complete.",
    holdMs: 4000,
  },
  {
    id: "architect",
    text: "I am the Architect.\nI do not seek a perfect mage — I seek proof.",
    holdMs: 4800,
  },
  {
    id: "purpose",
    text: "I forge clones to test every possibility.\nTo find which combinations become champions.",
    holdMs: 5200,
  },
  {
    id: "sanctuary",
    text: "This sanctuary is yours.\nRest. Learn. Prepare.",
    holdMs: 4200,
  },
  {
    id: "path",
    text: "Master more skills than the rest.\nDiscover the loadouts no one has dared.",
    holdMs: 5000,
  },
  {
    id: "legend",
    text: "Become the legendary magician —\nthe clone who found the best combinations.",
    holdMs: 5200,
  },
  {
    id: "go",
    text: "The arena is waiting.\nShow me what you can become.",
    holdMs: 4500,
  },
] as const;

export const HUB_INTRO_OBJECTIVE = "Enter the arena";

/** Hold on black at intro start (ms). */
export const HUB_INTRO_FADE_IN_MS = 900;
/** Fade out black into face-cam (ms). */
export const HUB_INTRO_FADE_OUT_MS = 1400;
/** Fade to black at end of cinematic (ms). */
export const HUB_INTRO_HANDOFF_FADE_OUT_MS = 900;
/** Hold black while swapping to gameplay cam (ms). */
export const HUB_INTRO_HANDOFF_HOLD_MS = 220;
/** Fade in from black into gameplay view (ms). */
export const HUB_INTRO_HANDOFF_FADE_IN_MS = 1200;
/** @deprecated use HANDOFF_FADE_* — kept for any old imports */
export const HUB_INTRO_HANDOFF_MS =
  HUB_INTRO_HANDOFF_FADE_OUT_MS + HUB_INTRO_HANDOFF_HOLD_MS + HUB_INTRO_HANDOFF_FADE_IN_MS;
/** Face-cam distance from character. */
export const HUB_INTRO_FACE_DIST = 3.4;
/** Look-at height on character. */
export const HUB_INTRO_LOOK_Y = 1.15;
/**
 * Orbit bias (radians) added to character yaw for the face cam.
 * ~−15° so the face stays centered and the House still reads behind.
 */
export const HUB_INTRO_ORBIT_BIAS = (-15 * Math.PI) / 180;
