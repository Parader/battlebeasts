import {
  ABILITIES,
  isFlowMovementAbility,
  isFlowOffensiveConsume,
  isFlowQuickRecoveryConsume,
  isRepeatableFlowMovement,
} from "@battlebeasts/shared";

export type AbilitySlotGlow = "recast" | "boost";

export function resolveAbilitySlotGlow(
  abilityId: string | undefined,
  statusIds: ReadonlySet<string>,
  lastFlowMoveId: string | null,
  riftArming: boolean,
): AbilitySlotGlow | null {
  if (!abilityId) return null;
  const def = ABILITIES[abilityId];
  if (!def) return null;

  if (statusIds.has("spiritFormed") && abilityId === "spiritForm") return "recast";
  if (statusIds.has("tripleBlinkReady") && abilityId === "tripleBlink") return "recast";
  if (riftArming && abilityId === "riftFissure") return "recast";
  if (
    statusIds.has("movementRepeatReady") &&
    isRepeatableFlowMovement(def) &&
    lastFlowMoveId === abilityId
  ) {
    return "recast";
  }

  if (
    statusIds.has("motionEcho") &&
    isFlowMovementAbility(def) &&
    lastFlowMoveId !== abilityId
  ) {
    return "boost";
  }
  if (
    (statusIds.has("combatFlow") || statusIds.has("followThrough")) &&
    isFlowOffensiveConsume(def)
  ) {
    return "boost";
  }
  if (statusIds.has("quickRecovery") && isFlowQuickRecoveryConsume(def)) {
    return "boost";
  }
  return null;
}

export function statusIdsNeedSlotTick(statusIds: ReadonlySet<string>): boolean {
  return (
    statusIds.has("movementRepeatReady") ||
    statusIds.has("tripleBlinkReady") ||
    statusIds.has("spiritFormed") ||
    statusIds.has("motionEcho") ||
    statusIds.has("combatFlow") ||
    statusIds.has("followThrough") ||
    statusIds.has("quickRecovery")
  );
}
