type Listener = () => void;

/** How local cast aim should tint — for testing ally/enemy telegraph looks. */
export type CastAimRelationPreview = "self" | "ally" | "enemy";

/** Shared LoL / Battlerite-style aim telegraph tint (local / self). */
export const CAST_AIM_COLOR = "#3ec6ff";
export const CAST_AIM_HOT = "#c8f4ff";

/** Ally telegraph tint (team green — matches lab telegraphFriendly). */
export const CAST_AIM_ALLY_COLOR = "#22c55e";
export const CAST_AIM_ALLY_HOT = "#bbf7d0";

/** Enemy telegraph tint (hostile red — matches lab telegraphEnemy). */
export const CAST_AIM_ENEMY_COLOR = "#ef4444";
export const CAST_AIM_ENEMY_HOT = "#fecaca";

export function castAimColorsFor(
  relation: CastAimRelationPreview,
): { color: string; hot: string } {
  if (relation === "ally") return { color: CAST_AIM_ALLY_COLOR, hot: CAST_AIM_ALLY_HOT };
  if (relation === "enemy") return { color: CAST_AIM_ENEMY_COLOR, hot: CAST_AIM_ENEMY_HOT };
  return { color: CAST_AIM_COLOR, hot: CAST_AIM_HOT };
}

/**
 * Optimistic local cast bus — useBaseCityRoom writes ability/phase so
 * CastAimTelegraph can show on the same frame as cast queue (before schema).
 */
class CastAimRuntime {
  abilityId: string | null = null;
  phase = "";
  /** 1-based combo swing; previews only for the first hit (≤1). */
  comboHit = 1;
  /**
   * Preview cast-aim as self / ally / enemy tint (Spell Lab toggle).
   * Does not change gameplay — only telegraph colors.
   */
  relationPreview: CastAimRelationPreview = "self";
  /**
   * After cancel/clear, ignore schema fallback until the next intentional cast
   * so a stale castPhase can't resurrect the ghost.
   */
  private suppressed = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  set(abilityId: string | null, phase: string, comboHit = 1): void {
    const nextId = abilityId || null;
    const nextPhase = phase || "";
    const nextCombo = Math.max(0, Math.floor(comboHit));
    if (
      nextId &&
      (nextPhase === "anticipation" ||
        nextPhase === "cast" ||
        (nextPhase === "impact" && nextId === "fireball"))
    ) {
      this.suppressed = false;
    }
    if (
      this.abilityId === nextId &&
      this.phase === nextPhase &&
      this.comboHit === nextCombo
    ) {
      return;
    }
    this.abilityId = nextId;
    this.phase = nextPhase;
    this.comboHit = nextCombo;
    this.emit();
  }

  setRelationPreview(relation: CastAimRelationPreview): void {
    if (this.relationPreview === relation) return;
    this.relationPreview = relation;
    this.emit();
  }

  colors(): { color: string; hot: string } {
    return castAimColorsFor(this.relationPreview);
  }

  clear(): void {
    this.suppressed = true;
    if (this.abilityId == null && this.phase === "" && this.comboHit === 1) {
      return;
    }
    this.abilityId = null;
    this.phase = "";
    this.comboHit = 1;
    this.emit();
  }

  /** Schema may still show the cancelled cast — don't resurrect from it. */
  isSchemaFallbackAllowed(): boolean {
    return !this.suppressed;
  }

  /** True while caster-only ground preview should stay up. */
  isAimPreviewActive(): boolean {
    if (this.suppressed || !this.abilityId) return false;
    // Combo melee (crescent): ghost only before the first swing.
    if (this.comboHit > 1) return false;
    // Shrooms plant lands after anticipation — drop the aim ghost then.
    if (this.abilityId === "shrooms" && this.phase !== "anticipation") {
      return false;
    }
    // Life leech beam particles start at impact — drop the aim ghost then.
    if (this.abilityId === "lifeLeech" && this.phase === "impact") {
      return false;
    }
    if (this.phase === "anticipation" || this.phase === "cast") return true;
    // Fireball charges in impact — keep the fixed skillshot ghost while aiming.
    if (this.phase === "impact" && this.abilityId === "fireball") return true;
    return false;
  }

  private emit(): void {
    // Sync — deferred rAF delayed React mount and amplified schema clear/set flicker.
    for (const fn of this.listeners) fn();
  }
}

export const castAimRuntime = new CastAimRuntime();
