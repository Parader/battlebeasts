import * as THREE from "three";
import {
  type CharacterAnimationConfig,
  character1AnimationConfig,
} from "./animationConfig";
import {
  createCastBodyClip,
  createLegsOnlyClip,
  createLowerBodyClip,
  createUpperBodyClip,
  getHipsStartY,
  plantHipsRootMotion,
  reportMissingClips,
  resolveClip,
  stripHorizontalRootMotion,
} from "./clipUtils";
import {
  computeLocoTargets,
  dampWeights,
  ZERO_LOCO_WEIGHTS,
  type LocoDir,
  type LocoWeights,
  type MovementParams,
} from "./locomotionBlend";

export type UpperBodyActionOptions = {
  desiredDuration?: number;
  fadeIn?: number;
  fadeOut?: number;
  onComplete?: () => void;
};

export type FullBodyActionOptions = {
  desiredDuration?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Default true. Death should pass false. */
  restoreLayers?: boolean;
  onComplete?: () => void;
};

export type CharacterAnimationState = {
  locomotion: "idle" | "moving";
  upperBody: "idle" | "casting";
  fullBody: "none" | "override";
  activeUpperName: string | null;
  activeFullBodyName: string | null;
};

export type AnimDebugSnapshot = {
  state: CharacterAnimationState;
  locoCurrent: LocoWeights;
  locoTarget: LocoWeights;
  normalizedSpeed: number;
  lowerWeights: Partial<Record<LocoDir, number>>;
  upperLocoWeights: Partial<Record<LocoDir, number>>;
  upperCastWeight: number;
  fullBodyWeight: number;
  layerMulLower: number;
  layerMulUpper: number;
};

const UPPER_CAST_FADE_OUT = 0.12;
const LAYER_DAMP = 14;

type LocoSlot = LocoDir;

/**
 * Layered Mixamo animation driver with procedural locomotion blending.
 *
 * Layers (priority high → low):
 *   1. Full-body override
 *   2. Upper cast + lower loco blend
 *   3. Upper loco blend + lower loco blend
 *
 * Lower + upper locomotion keep five masked clips playing and only update
 * weights — never reset/crossFade on direction changes.
 */
export class CharacterAnimationController {
  readonly mixer: THREE.AnimationMixer;

  private readonly config: CharacterAnimationConfig;
  private readonly sourceClips: readonly THREE.AnimationClip[];

  private readonly lowerActions = new Map<LocoSlot, THREE.AnimationAction>();
  /** Legs without hips — active while a cast owns Mixamo hip aim twist. */
  private readonly legsOnlyActions = new Map<LocoSlot, THREE.AnimationAction>();
  private readonly upperLocoActions = new Map<LocoSlot, THREE.AnimationAction>();
  private readonly upperCastByName = new Map<string, THREE.AnimationAction>();
  private readonly fullBodyClips = new Map<string, THREE.AnimationClip>();

  private locoCurrent: LocoWeights = { ...ZERO_LOCO_WEIGHTS };
  private locoTarget: LocoWeights = { ...ZERO_LOCO_WEIGHTS };
  private normalizedSpeed = 0;

  private layerMulLower = 1;
  private layerMulUpper = 1;
  private layerMulLowerTarget = 1;
  private layerMulUpperTarget = 1;

  private casting = false;
  private castWeight = 0;
  private castWeightTarget = 0;
  private activeCast: THREE.AnimationAction | null = null;
  private activeCastName: string | null = null;
  private upperGen = 0;
  private castOnComplete: (() => void) | null = null;

  private overrideAction: THREE.AnimationAction | null = null;
  private overrideActive = false;
  private overrideName: string | null = null;
  private overrideGen = 0;
  private overrideWeight = 0;
  private overrideWeightTarget = 0;
  private restoreAfterOverride = true;

  private readonly listeners: Array<{
    target: THREE.AnimationMixer;
    type: string;
    fn: (e: unknown) => void;
  }> = [];

  private disposed = false;
  private readonly refClipDuration: number;
  /** Idle hips height — cast clips plant here so Mixamo crouches don't sink feet. */
  private readonly plantHipsY: number;

  constructor(
    character: THREE.Object3D,
    clips: THREE.AnimationClip[],
    config: CharacterAnimationConfig = character1AnimationConfig,
  ) {
    this.mixer = new THREE.AnimationMixer(character);
    this.config = config;
    this.sourceClips = clips;

    reportMissingClips(clips, {
      idle: config.idle,
      runForward: config.runForward,
      runBackward: config.runBackward,
      strafeLeft: config.strafeLeft,
      strafeRight: config.strafeRight,
      castPrimary: config.castPrimary,
      castAoE: config.castAoE,
      castMelee: config.castMelee,
      dash: config.dash,
      hit: config.hit,
      death: config.death,
      heavyCast: config.heavyCast,
    });

    const idleSrc = resolveClip(clips, config.idle);
    const plantSrc = idleSrc ?? resolveClip(clips, config.runForward);
    this.plantHipsY = (plantSrc && getHipsStartY(plantSrc)) ?? 100;
    const locoMap: Array<{ slot: LocoSlot; name: string }> = [
      { slot: "idle", name: config.idle },
      { slot: "forward", name: config.runForward },
      { slot: "backward", name: config.runBackward },
      { slot: "left", name: config.strafeLeft },
      { slot: "right", name: config.strafeRight },
    ];

    const forwardSrc = resolveClip(clips, config.runForward);
    const refDur = Math.max(1e-4, forwardSrc?.duration ?? 0.7);
    this.refClipDuration = refDur;

    for (const { slot, name } of locoMap) {
      const src = resolveClip(clips, name);
      if (!src) continue;
      const noRoot = stripHorizontalRootMotion(src);

      const lowerClip = createLowerBodyClip(noRoot);
      if (lowerClip.tracks.length === 0) {
        console.warn(`[CharacterAnimation] lower clip empty after mask: ${name}`);
      } else {
        const lower = this.mixer.clipAction(lowerClip);
        lower.enabled = true;
        lower.setEffectiveWeight(slot === "idle" ? 1 : 0);
        lower.setLoop(THREE.LoopRepeat, Infinity);
        lower.timeScale = slot === "idle" ? 1 : refDur / Math.max(1e-4, src.duration);
        lower.time = 0;
        lower.play();
        this.lowerActions.set(slot, lower);
      }

      const legsClip = createLegsOnlyClip(noRoot);
      if (legsClip.tracks.length === 0) {
        console.warn(`[CharacterAnimation] legs-only clip empty after mask: ${name}`);
      } else {
        const legs = this.mixer.clipAction(legsClip);
        legs.enabled = true;
        legs.setEffectiveWeight(0);
        legs.setLoop(THREE.LoopRepeat, Infinity);
        legs.timeScale = slot === "idle" ? 1 : refDur / Math.max(1e-4, src.duration);
        legs.time = 0;
        legs.play();
        this.legsOnlyActions.set(slot, legs);
      }

      const upperClip = createUpperBodyClip(noRoot);
      if (upperClip.tracks.length === 0) {
        console.warn(`[CharacterAnimation] upper loco clip empty after mask: ${name}`);
      } else {
        const upper = this.mixer.clipAction(upperClip);
        upper.enabled = true;
        upper.setEffectiveWeight(slot === "idle" ? 1 : 0);
        upper.setLoop(THREE.LoopRepeat, Infinity);
        upper.timeScale = slot === "idle" ? 1 : refDur / Math.max(1e-4, src.duration);
        upper.time = 0;
        upper.play();
        this.upperLocoActions.set(slot, upper);
      }
    }

    this.registerUpperCast("castPrimary", config.castPrimary);
    if (config.castAoE) this.registerUpperCast("castAoE", config.castAoE);
    if (config.castMelee) this.registerUpperCast("castMelee", config.castMelee);
    if (config.heavyCast) this.registerUpperCast("heavyCast", config.heavyCast);

    for (const key of ["dash", "hit", "death", "heavyCast"] as const) {
      const name = config[key];
      if (!name) continue;
      const src = resolveClip(clips, name);
      if (!src) continue;
      // Keep Mixamo hips Y (strip XZ only). Idle-height plant floated the dive;
      // natural dive Y drops the body through the roll.
      const prepared = stripHorizontalRootMotion(src);
      this.fullBodyClips.set(key, prepared);
      this.fullBodyClips.set(name, prepared);
      this.fullBodyClips.set(src.name, prepared);
    }
  }

  registerUpperCast(logicalName: string, clipName: string): void {
    const src = resolveClip(this.sourceClips, clipName);
    if (!src) {
      console.warn(`[CharacterAnimation] cannot register upper cast "${logicalName}" → "${clipName}"`);
      return;
    }
    // Include hips so Mixamo aim twist stays with the cast (upper-only looked sideways).
    // Plant hips Y to idle height — Mixamo casts crouch hard and drive feet through the floor.
    const castClip = createCastBodyClip(plantHipsRootMotion(src, this.plantHipsY));
    if (castClip.tracks.length === 0) {
      console.warn(`[CharacterAnimation] cast clip has no tracks after mask: ${clipName}`);
      return;
    }
    const action = this.mixer.clipAction(castClip);
    action.enabled = true;
    action.setEffectiveWeight(0);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.stop();
    this.upperCastByName.set(logicalName, action);
    this.upperCastByName.set(src.name, action);
    this.upperCastByName.set(clipName, action);
  }

  setMovement(params: MovementParams): void {
    if (this.disposed) return;
    const { targets, normalizedSpeed } = computeLocoTargets(params);
    this.locoTarget = targets;
    this.normalizedSpeed = normalizedSpeed;
  }

  setMovementFromYaw(
    worldVelocity: THREE.Vector3,
    facingYaw: number,
    maximumSpeed: number,
  ): void {
    this.setMovement({ worldVelocity, facingYaw, maximumSpeed });
  }

  update(delta: number): void {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(0.1, delta));

    const moveResp = this.config.locomotionBlendResponsiveness ?? 12;
    const idleResp = this.config.idleBlendResponsiveness ?? 10;
    const resp = this.normalizedSpeed < 0.08 ? idleResp : moveResp;
    this.locoCurrent = dampWeights(this.locoCurrent, this.locoTarget, resp, dt);

    this.layerMulLower +=
      (this.layerMulLowerTarget - this.layerMulLower) * (1 - Math.exp(-LAYER_DAMP * dt));
    this.layerMulUpper +=
      (this.layerMulUpperTarget - this.layerMulUpper) * (1 - Math.exp(-LAYER_DAMP * dt));

    // Cast weight is driven explicitly so fadeIn can't fight per-frame loco writes
    const castFade = this.casting ? 18 : 14;
    this.castWeight += (this.castWeightTarget - this.castWeight) * (1 - Math.exp(-castFade * dt));
    if (!this.casting && this.castWeight < 0.01) this.castWeight = 0;

    const tMin = this.config.locoTimeScaleMin ?? 0.75;
    const tMax = this.config.locoTimeScaleMax ?? 1.35;
    const speedScale = THREE.MathUtils.clamp(
      this.normalizedSpeed < 1e-3 ? 1 : this.normalizedSpeed,
      tMin,
      tMax,
    );

    const locoUpperMul = this.layerMulUpper * (1 - this.castWeight);
    // While casting, legs-only loco so cast hips own Mixamo aim twist
    const hipsLocoMul = this.layerMulLower * (1 - this.castWeight);
    const legsLocoMul = this.layerMulLower * this.castWeight;

    for (const [slot, action] of this.lowerActions) {
      action.setEffectiveWeight(this.locoCurrent[slot] * hipsLocoMul);
      if (slot === "idle") action.timeScale = 1;
      else {
        action.timeScale =
          (this.refClipDuration / Math.max(1e-4, action.getClip().duration)) * speedScale;
      }
    }

    for (const [slot, action] of this.legsOnlyActions) {
      const w = this.locoCurrent[slot] * legsLocoMul;
      action.setEffectiveWeight(w);
      if (slot === "idle") action.timeScale = 1;
      else {
        action.timeScale =
          (this.refClipDuration / Math.max(1e-4, action.getClip().duration)) * speedScale;
      }
      // Keep legs in phase with the hips+legs loco clip
      const withHips = this.lowerActions.get(slot);
      if (withHips && this.locoCurrent[slot] > 0.05) {
        action.time = withHips.time;
      }
    }

    for (const [slot, action] of this.upperLocoActions) {
      action.setEffectiveWeight(this.locoCurrent[slot] * locoUpperMul);
      if (slot === "idle") action.timeScale = 1;
      else {
        action.timeScale =
          (this.refClipDuration / Math.max(1e-4, action.getClip().duration)) * speedScale;
      }
    }

    // Sync gait phase between lower/upper of the same slot (avoid arm/leg desync)
    for (const slot of this.lowerActions.keys()) {
      const lower = this.lowerActions.get(slot);
      const upper = this.upperLocoActions.get(slot);
      if (!lower || !upper) continue;
      if (this.locoCurrent[slot] > 0.05) {
        upper.time = lower.time;
      }
    }

    if (this.activeCast) {
      this.activeCast.enabled = true;
      if (!this.activeCast.isRunning() && this.casting) {
        this.activeCast.play();
      }
      this.activeCast.setEffectiveWeight(this.castWeight * this.layerMulUpper);
      if (!this.casting && this.castWeight < 0.01) {
        this.activeCast.stop();
        this.activeCast = null;
      }
    }

    // Full-body override weight (same pattern as cast — don't rely on fadeIn alone)
    const ovFade = this.overrideActive ? 20 : 14;
    this.overrideWeight +=
      (this.overrideWeightTarget - this.overrideWeight) * (1 - Math.exp(-ovFade * dt));
    if (!this.overrideActive && this.overrideWeight < 0.01) {
      this.overrideWeight = 0;
      if (this.overrideAction) {
        this.overrideAction.stop();
        this.overrideAction = null;
      }
    }
    if (this.overrideAction) {
      this.overrideAction.enabled = true;
      if (!this.overrideAction.isRunning() && this.overrideActive) {
        this.overrideAction.play();
      }
      this.overrideAction.setEffectiveWeight(this.overrideWeight);
    }

    this.mixer.update(dt);
  }

  playUpperBodyAction(animationName: string, options: UpperBodyActionOptions = {}): boolean {
    if (this.disposed || this.overrideActive) return false;

    const action = this.resolveUpperCast(animationName);
    if (!action) {
      console.warn(`[CharacterAnimation] upper cast not found: "${animationName}"`);
      return false;
    }

    if (this.casting && this.activeCast === action && action.isRunning()) {
      return true;
    }

    const gen = ++this.upperGen;
    this.castOnComplete = options.onComplete ?? null;

    // Mute previous cast if switching abilities
    if (this.activeCast && this.activeCast !== action) {
      this.activeCast.setEffectiveWeight(0);
      this.activeCast.stop();
    }

    const clip = action.getClip();
    if (options.desiredDuration && options.desiredDuration > 0 && clip.duration > 0) {
      action.timeScale = clip.duration / options.desiredDuration;
    } else {
      action.timeScale = 1;
    }

    action.reset();
    action.enabled = true;
    action.paused = false;
    action.setEffectiveWeight(0);
    action.play();

    this.casting = true;
    this.activeCast = action;
    this.activeCastName = animationName;
    this.castWeightTarget = 1;
    // Small kick so the first frame isn't fully loco-upper
    this.castWeight = Math.max(this.castWeight, 0.15);

    const onFinished = (e: unknown) => {
      const evt = e as { action?: THREE.AnimationAction };
      if (evt.action !== action) return;
      this.unlisten(this.mixer, "finished", onFinished);
      if (gen !== this.upperGen || this.activeCast !== action) return;
      // Hold the last frame via clamp; gameplay cancel restores loco.
      // If gameplay is still casting, keep clamp pose until cancelUpperBodyAction.
      this.castOnComplete?.();
      this.castOnComplete = null;
    };
    this.listen(this.mixer, "finished", onFinished);
    return true;
  }

  playUpperBodyCast(animationName: string, desiredDuration?: number): void {
    this.playUpperBodyAction(animationName, { desiredDuration });
  }

  cancelUpperBodyAction(_fadeDuration = UPPER_CAST_FADE_OUT): void {
    if (this.disposed) return;
    if (!this.casting && this.castWeight < 0.01 && !this.activeCast) return;

    this.upperGen++;
    this.casting = false;
    this.castWeightTarget = 0;
    this.castOnComplete = null;
    this.activeCastName = null;
    // activeCast kept until weight hits 0 so update can fade it out
    if (this.overrideActive) {
      if (this.activeCast) {
        this.activeCast.setEffectiveWeight(0);
        this.activeCast.stop();
        this.activeCast = null;
      }
      this.castWeight = 0;
    }
  }

  playFullBodyAction(animationName: string, options: FullBodyActionOptions = {}): boolean {
    if (this.disposed) return false;

    const clip =
      this.fullBodyClips.get(animationName) ??
      (() => {
        const src = resolveClip(this.sourceClips, animationName);
        return src ? stripHorizontalRootMotion(src) : null;
      })();

    if (!clip) {
      console.warn(`[CharacterAnimation] full-body clip not found: "${animationName}"`);
      return false;
    }

    const gen = ++this.overrideGen;
    this.upperGen++;
    this.casting = false;
    this.castWeightTarget = 0;
    this.castWeight = 0;
    this.activeCastName = null;
    if (this.activeCast) {
      this.activeCast.setEffectiveWeight(0);
      this.activeCast.stop();
      this.activeCast = null;
    }

    this.restoreAfterOverride = options.restoreLayers !== false;

    // Snap loco layers off so Jump isn't averaged with run/strafe weights
    this.layerMulLower = 0;
    this.layerMulUpper = 0;
    this.layerMulLowerTarget = 0;
    this.layerMulUpperTarget = 0;
    for (const action of this.lowerActions.values()) action.setEffectiveWeight(0);
    for (const action of this.legsOnlyActions.values()) action.setEffectiveWeight(0);
    for (const action of this.upperLocoActions.values()) action.setEffectiveWeight(0);

    if (this.overrideAction) {
      this.overrideAction.setEffectiveWeight(0);
      this.overrideAction.stop();
      this.overrideAction = null;
    }

    const action = this.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    if (options.desiredDuration && options.desiredDuration > 0 && clip.duration > 0) {
      action.timeScale = clip.duration / options.desiredDuration;
    } else {
      action.timeScale = 1;
    }
    action.setEffectiveWeight(0);
    action.play();

    this.overrideAction = action;
    this.overrideActive = true;
    this.overrideName = animationName;
    this.overrideWeightTarget = 1;
    this.overrideWeight = Math.max(this.overrideWeight, 0.35);

    const onFinished = (e: unknown) => {
      const evt = e as { action?: THREE.AnimationAction };
      if (evt.action !== action) return;
      this.unlisten(this.mixer, "finished", onFinished);
      if (gen !== this.overrideGen || this.overrideAction !== action) return;

      // Hold clamp pose until gameplay clears the ability (cancelFullBodyAction),
      // or restore immediately if this was a fire-and-forget one-shot.
      if (!this.restoreAfterOverride) {
        this.overrideActive = false;
        this.overrideWeightTarget = 0;
        options.onComplete?.();
        return;
      }
      // Keep overrideActive until explicit cancel so a short dash doesn't
      // restore loco under a still-traveling character mid-jump pose.
      options.onComplete?.();
    };
    this.listen(this.mixer, "finished", onFinished);
    return true;
  }

  /** End dash / hit override and restore loco layers. */
  cancelFullBodyAction(): void {
    if (this.disposed) return;
    if (!this.overrideActive && this.overrideWeight < 0.01) return;

    this.overrideGen++;
    this.overrideActive = false;
    this.overrideName = null;
    this.overrideWeightTarget = 0;

    if (this.restoreAfterOverride) {
      this.layerMulLowerTarget = 1;
      this.layerMulUpperTarget = 1;
    }
  }

  /** End whatever ability visual is playing (upper cast or full-body). */
  cancelAbilityAnimation(): void {
    this.cancelUpperBodyAction();
    this.cancelFullBodyAction();
  }

  playFullBodyAnimation(animationName: string, options: FullBodyActionOptions = {}): void {
    this.playFullBodyAction(animationName, options);
  }

  getState(): Readonly<CharacterAnimationState> {
    const moving =
      this.locoCurrent.forward +
        this.locoCurrent.backward +
        this.locoCurrent.left +
        this.locoCurrent.right >
      0.08;
    return {
      locomotion: moving ? "moving" : "idle",
      upperBody: this.casting || this.castWeight > 0.05 ? "casting" : "idle",
      fullBody: this.overrideActive ? "override" : "none",
      activeUpperName: this.activeCastName,
      activeFullBodyName: this.overrideName,
    };
  }

  getDebugSnapshot(): AnimDebugSnapshot {
    const lowerWeights: Partial<Record<LocoDir, number>> = {};
    const upperLocoWeights: Partial<Record<LocoDir, number>> = {};
    for (const [slot, action] of this.lowerActions) {
      lowerWeights[slot] = action.getEffectiveWeight();
    }
    for (const [slot, action] of this.upperLocoActions) {
      upperLocoWeights[slot] = action.getEffectiveWeight();
    }
    return {
      state: this.getState(),
      locoCurrent: { ...this.locoCurrent },
      locoTarget: { ...this.locoTarget },
      normalizedSpeed: this.normalizedSpeed,
      lowerWeights,
      upperLocoWeights,
      upperCastWeight: this.activeCast?.getEffectiveWeight() ?? 0,
      fullBodyWeight: this.overrideAction?.getEffectiveWeight() ?? 0,
      layerMulLower: this.layerMulLower,
      layerMulUpper: this.layerMulUpper,
    };
  }

  debugAnimations(): void {
    console.log("[CharacterAnimation]", this.getDebugSnapshot());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.upperGen++;
    this.overrideGen++;
    for (const { target, type, fn } of this.listeners) {
      target.removeEventListener(type, fn as never);
    }
    this.listeners.length = 0;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  private resolveUpperCast(animationName: string): THREE.AnimationAction | null {
    const existing = this.upperCastByName.get(animationName);
    if (existing) return existing;
    const src = resolveClip(this.sourceClips, animationName);
    if (!src) return null;
    this.registerUpperCast(animationName, src.name);
    return this.upperCastByName.get(animationName) ?? this.upperCastByName.get(src.name) ?? null;
  }

  private listen(
    target: THREE.AnimationMixer,
    type: string,
    fn: (e: unknown) => void,
  ): void {
    target.addEventListener(type, fn as never);
    this.listeners.push({ target, type, fn });
  }

  private unlisten(
    target: THREE.AnimationMixer,
    type: string,
    fn: (e: unknown) => void,
  ): void {
    target.removeEventListener(type, fn as never);
    const idx = this.listeners.findIndex((l) => l.target === target && l.type === type && l.fn === fn);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }
}
