import type { FxBurst } from "../CombatVfx";

export type CombatFxMessage = {
  kind: "aoe" | "melee" | "dash" | "hit" | "cast_phase" | "portal";
  abilityId: string;
  x: number;
  z: number;
  y?: number;
  x2?: number;
  z2?: number;
  radius?: number;
  yaw?: number;
  ownerId?: string;
  targetId?: string;
  damage?: number;
  crit?: boolean;
  phase?: string;
  phaseEndsAt?: number;
  cooldownMs?: number;
  comboHit?: number;
  variant?: number;
};

export type CombatFxDispatchCtx = {
  localSessionId: string | null;
  localYaw: number;
  predicted: { x: number; z: number };
  getOwner: (ownerId: string) => { x?: number; z?: number; yaw?: number } | undefined;
  pushBurst: (burst: FxBurst) => void;
  nextFxKey: () => number;
  fxColors: Record<"aoe" | "melee" | "dash" | "hit", string>;
};
