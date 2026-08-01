import {
  HUB_INTRO_FADE_IN_MS,
  HUB_INTRO_FADE_OUT_MS,
  HUB_INTRO_HANDOFF_FADE_IN_MS,
  HUB_INTRO_HANDOFF_FADE_OUT_MS,
  HUB_INTRO_HANDOFF_HOLD_MS,
  HUB_INTRO_LINES,
  HUB_INTRO_OBJECTIVE,
} from "./hubIntroScript";

export type HubIntroPhase = "idle" | "playing" | "handingOff" | "done";

export type HubIntroSnapshot = {
  phase: HubIntroPhase;
  /** 0 = clear, 1 = full black */
  fade: number;
  caption: string;
  lineIndex: number;
  followCameraEnabled: boolean;
  objectiveVisible: boolean;
  objectiveText: string;
  /** Playing, handoff, or still fading into gameplay. */
  inputLocked: boolean;
};

type Listener = () => void;

let phase: HubIntroPhase = "idle";
let fade = 0;
let caption = "";
let lineIndex = -1;
let followCameraEnabled = true;
let objectiveVisible = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let fadeRaf = 0;
let onCompleteCb: (() => void) | null = null;
let onBeginPoseCb: (() => void) | null = null;

const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn();
}

function clearTimer() {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (fadeRaf) {
    cancelAnimationFrame(fadeRaf);
    fadeRaf = 0;
  }
}

function animateFade(from: number, to: number, ms: number, then?: () => void) {
  const t0 = performance.now();
  const tick = (now: number) => {
    const u = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
    const eased = u * u * (3 - 2 * u);
    fade = from + (to - from) * eased;
    emit();
    if (u < 1) {
      fadeRaf = requestAnimationFrame(tick);
      return;
    }
    fade = to;
    emit();
    then?.();
  };
  fadeRaf = requestAnimationFrame(tick);
}

function showLine(index: number) {
  if (index >= HUB_INTRO_LINES.length) {
    beginHandoff();
    return;
  }
  lineIndex = index;
  caption = HUB_INTRO_LINES[index]!.text;
  emit();
  const hold = HUB_INTRO_LINES[index]!.holdMs;
  clearTimeout(timer as ReturnType<typeof setTimeout>);
  timer = setTimeout(() => showLine(index + 1), hold);
}

/**
 * End cinematic: fade to black → enable gameplay cam → fade in.
 * No mid-air camera lerp (avoids the blue/sky flash).
 */
function beginHandoff() {
  phase = "handingOff";
  caption = "";
  followCameraEnabled = false;
  emit();
  clearTimer();

  animateFade(fade, 1, HUB_INTRO_HANDOFF_FADE_OUT_MS, () => {
    // Under full black: switch to follow cam.
    followCameraEnabled = true;
    emit();
    timer = setTimeout(() => {
      phase = "done";
      objectiveVisible = true;
      fade = 1;
      emit();
      onCompleteCb?.();
      animateFade(1, 0, HUB_INTRO_HANDOFF_FADE_IN_MS);
    }, HUB_INTRO_HANDOFF_HOLD_MS);
  });
}

export function getHubIntroSnapshot(): HubIntroSnapshot {
  return {
    phase,
    fade,
    caption,
    lineIndex,
    followCameraEnabled,
    objectiveVisible,
    objectiveText: HUB_INTRO_OBJECTIVE,
    inputLocked:
      phase === "playing" || phase === "handingOff" || (phase === "done" && fade > 0.04),
  };
}

export function subscribeHubIntro(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setHubIntroBeginPoseHandler(fn: (() => void) | null) {
  onBeginPoseCb = fn;
}

export function setHubIntroCompleteHandler(fn: (() => void) | null) {
  onCompleteCb = fn;
}

/** Start cinematic (fade → lines → handoff). Idempotent while already playing. */
export function startHubIntro() {
  if (phase === "playing" || phase === "handingOff") return;
  clearTimer();
  phase = "playing";
  followCameraEnabled = false;
  objectiveVisible = false;
  caption = "";
  lineIndex = -1;
  fade = 1;
  emit();
  onBeginPoseCb?.();

  // Hold black briefly, then fade out and start lines.
  timer = setTimeout(() => {
    animateFade(1, 0, HUB_INTRO_FADE_OUT_MS, () => showLine(0));
  }, HUB_INTRO_FADE_IN_MS * 0.35);
}

/** Skip remaining narration and hand off to playable camera. */
export function skipHubIntro() {
  if (phase !== "playing" && phase !== "handingOff") return;
  if (phase === "handingOff") return; // already transitioning
  clearTimer();
  beginHandoff();
}

/** Force idle (e.g. left hub). Does not mark complete. */
export function resetHubIntroRuntime() {
  clearTimer();
  phase = "idle";
  fade = 0;
  caption = "";
  lineIndex = -1;
  followCameraEnabled = true;
  objectiveVisible = false;
  emit();
}

/** Hide objective chip after player engages portal / dismiss. */
export function dismissHubIntroObjective() {
  objectiveVisible = false;
  emit();
}
