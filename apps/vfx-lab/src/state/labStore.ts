import { useSyncExternalStore } from "react";
import { ABILITIES, type AbilityDef, type CastPhaseId } from "@battlebeasts/shared";

export type LightingPreset = "outdoor" | "dungeon";
export type CameraMode = "follow" | "orbit";
export type TargetMode = "dummy" | "ground" | "self";
export type RelationMode = "self" | "ally" | "enemy";

export type TimingOverrides = {
  anticipationMs?: number;
  castMs?: number;
  impactMs?: number;
  recoveryMs?: number;
  leadMs?: number;
};

export type LabUiState = {
  abilityId: string;
  lighting: LightingPreset;
  camera: CameraMode;
  targetMode: TargetMode;
  relation: RelationMode;
  looping: boolean;
  allowOverlap: boolean;
  playing: boolean;
  paused: boolean;
  timing: TimingOverrides;
  shotCount: number;
  shotWarn: boolean;
  dummyCount: number;
  casterCount: number;
  search: string;
  shapeFilter: string;
  effectKindFilter: string;
  gameViewNonce: number;
  /** Bumped when dummy XZ is committed (drag end / preset / typed). */
  targetEpoch: number;
};

const listeners = new Set<() => void>();

function firstAbilityId(): string {
  return ABILITIES.bolt?.id ?? Object.keys(ABILITIES)[0] ?? "bolt";
}

let state: LabUiState = {
  abilityId: firstAbilityId(),
  lighting: "outdoor",
  camera: "follow",
  targetMode: "dummy",
  relation: "enemy",
  looping: true,
  allowOverlap: false,
  playing: false,
  paused: false,
  timing: {},
  shotCount: 0,
  shotWarn: false,
  dummyCount: 1,
  casterCount: 1,
  search: "",
  shapeFilter: "",
  effectKindFilter: "",
  gameViewNonce: 0,
  targetEpoch: 0,
};

function emit(): void {
  for (const fn of listeners) fn();
}

export const labStore = {
  get(): LabUiState {
    return state;
  },
  set(patch: Partial<LabUiState>): void {
    state = { ...state, ...patch };
    emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useLabStore<T>(select: (s: LabUiState) => T): T {
  return useSyncExternalStore(
    labStore.subscribe,
    () => select(labStore.get()),
    () => select(labStore.get()),
  );
}

export function currentAbility(): AbilityDef | undefined {
  return ABILITIES[labStore.get().abilityId];
}

export const PHASES: CastPhaseId[] = ["anticipation", "cast", "impact", "recovery"];
