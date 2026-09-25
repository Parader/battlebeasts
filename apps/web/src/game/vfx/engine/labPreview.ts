import { useSyncExternalStore } from "react";
import type { ElementId } from "./elementGallery";
import type { ShapeId } from "./shapeKinds";

export type LabVfxFocus = ElementId | "gallery" | null;

type LabPreviewState = {
  telegraph: boolean;
  focus: LabVfxFocus;
  shape: ShapeId;
};

let state: LabPreviewState = {
  telegraph: false,
  focus: null,
  shape: "emitter",
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function getLabPreview(): LabPreviewState {
  return state;
}

export function setLabPreview(partial: Partial<LabPreviewState>): void {
  const next: LabPreviewState = { ...state, ...partial };
  if (partial.shape === "telegraph" || partial.telegraph === true) {
    next.telegraph = true;
    next.shape = "telegraph";
  } else if (partial.shape !== undefined) {
    next.telegraph = false;
  } else if (partial.telegraph === false) {
    next.telegraph = false;
    if (state.shape === "telegraph") next.shape = "emitter";
  }
  state = next;
  emit();
}

export function subscribeLabPreview(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useLabPreview(): LabPreviewState {
  return useSyncExternalStore(subscribeLabPreview, getLabPreview, getLabPreview);
}
