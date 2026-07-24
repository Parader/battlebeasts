export type SpellEffectId = "bolt" | "crescent";

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
  variant?: number;
};
