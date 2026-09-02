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
    id: "welcome",
    text: "Welcome to my experiment, clone.",
    holdMs: 3800,
  },
  {
    id: "purpose",
    text: "You were created as part of a test\nto discover the strongest magical path.",
    holdMs: 5200,
  },
  {
    id: "arena",
    text: "To prove your worth,\nbattle other mages in the Arena.",
    holdMs: 4500,
  },
  {
    id: "sanctum",
    text: "This is your Sanctum.\nHere, you can master new spells, customize your build, and invite your friends.",
    holdMs: 5800,
  },
  {
    id: "go",
    text: "Now go.\nShow me which path is truly the strongest.",
    holdMs: 4800,
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
