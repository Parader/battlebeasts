import type { AbilityDef, AbilityEffectKind, CombatBody } from "@battlebeasts/shared";
import type { PlayerState } from "../schema/BaseCityState";

/**
 * Bespoke `effectKind` fire paths — register here instead of growing the
 * if/else ladder in `CombatSystem.fireEffect`.
 *
 * `standard` is omitted: shape (projectile / melee / aoe) handles it.
 * `fireball` is also omitted: it uses the projectile shape + charge stamp.
 * `decoy` is handled as an early return in `fireEffect` (cast-begin commit).
 */

export type EffectKindFireArgs = {
  sessionId: string;
  player: PlayerState;
  ownerBody: CombatBody;
  def: AbilityDef;
  now: number;
};

export type EffectKindFireHandlers = Partial<
  Record<AbilityEffectKind, (args: EffectKindFireArgs) => void>
>;

/** True when this kind owns fire (skip shape fallback). Decoy always owns. */
export function effectKindOwnsFire(kind: AbilityEffectKind): boolean {
  return kind !== "standard" && kind !== "fireball";
}

/**
 * Run a registered bespoke handler when not deferring to travel landing.
 * Returns whether the kind is bespoke (shape path must be skipped).
 */
export function runEffectKindFire(
  kind: AbilityEffectKind,
  deferHit: boolean,
  handlers: EffectKindFireHandlers,
  args: EffectKindFireArgs,
): boolean {
  if (kind === "decoy") return true;
  if (!effectKindOwnsFire(kind)) return false;
  if (!deferHit) {
    const handler = handlers[kind];
    if (handler) handler(args);
  }
  return true;
}
