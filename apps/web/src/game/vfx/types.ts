export type SpellEffectId = "bolt" | "crescent" | "smash";

export type VfxPose = {
  x: number;
  z: number;
  y?: number;
  yaw?: number;
};

export type VfxSpawnOpts = {
  /** When set, cast FX tracks this player's live pose. */
  followOwnerId?: string;
  /** Forward offset from owner along yaw (ability spawnOffset). */
  followSpawnOffset?: number;
  /** Optional style index (e.g. crescent swing 0/1/2). */
  variant?: number;
  /** Override one-shot lifetime (ms). */
  lifeMs?: number;
  /**
   * Frost Ball: windup duration for the grow curve.
   * Full `lifeMs` covers charge + flight so the same shot can become the projectile.
   */
  chargeMs?: number;
  /** Effect radius / cone length (world units). */
  radius?: number;
  /** Frost mist: starting cone length before smooth grow. */
  startRadius?: number;
  /** Frost mist: ms to ease startRadius → radius. */
  growMs?: number;
  /** Optional secondary origin (e.g. volcano → rock land). */
  originX?: number;
  originZ?: number;
};

export type VfxHandle = {
  cancel: () => void;
};

export type OneShotKind = "cast" | "impact";

export type OneShotEffect = {
  key: number;
  kind: OneShotKind;
  abilityId: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  born: number;
  life: number;
  followOwnerId?: string;
  followSpawnOffset?: number;
  /** Frost Ball: ms used for charge grow (not full life). */
  chargeMs?: number;
  variant?: number;
  radius?: number;
  startRadius?: number;
  growMs?: number;
  originX?: number;
  originZ?: number;
};
