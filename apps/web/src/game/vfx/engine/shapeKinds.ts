/**
 * Lab VFX shape kinds — element skin × these shapes.
 * `emitter` = upright cone showcase (legacy gallery).
 */
export type ShapeId =
  | "emitter"
  | "caster"
  | "impact"
  | "beam"
  | "ground"
  | "shield"
  | "telegraph";

export const SHAPE_GALLERY: readonly { id: ShapeId; label: string }[] = [
  { id: "emitter", label: "Emitter" },
  { id: "caster", label: "Caster blow" },
  { id: "impact", label: "Impact" },
  { id: "beam", label: "Beam" },
  { id: "ground", label: "Ground" },
  { id: "shield", label: "Shield" },
  { id: "telegraph", label: "Telegraph" },
] as const;
