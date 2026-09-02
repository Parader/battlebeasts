import { elementType, type MapDoc } from "@battlebeasts/shared";

/**
 * Human labels for entity ids.
 *
 * Validation works in ids because that is what it can reference stably, but
 * "p047" tells an author nothing about which object on screen is at fault.
 * Everything user-facing goes through here instead.
 */

/** `forest/PP_Fir_Tree_17` -> `Fir Tree 17`. */
export function prettyPropName(key: string): string {
  const base = key.split("/").pop() ?? key;
  return (
    base
      // Kit prefixes carry no meaning for the author.
      .replace(/^(PP|SM|SK)_/, "")
      .replace(/_/g, " ")
      .trim() || key
  );
}

export type EntityLabel = {
  /** Short name for inline display, e.g. `Fir Tree 17`. */
  label: string;
  /** Longer form for tooltips, including the id. */
  title: string;
  found: boolean;
};

export function describeEntity(doc: MapDoc, id: string): EntityLabel {
  const prop = doc.props.find((p) => p.id === id);
  if (prop) {
    const label = prettyPropName(prop.prop);
    return { label, title: `${label} — ${prop.prop} (${id})`, found: true };
  }

  const el = doc.elements.find((e) => e.id === id);
  if (el) {
    const def = elementType(el.type);
    const label = def?.label ?? el.type;
    return { label, title: `${label} (${id})`, found: true };
  }

  const wall = doc.walls.find((w) => w.id === id);
  if (wall) {
    const label = `Boundary (${wall.points.length} pts)`;
    return { label, title: `${label} (${id})`, found: true };
  }

  return { label: id, title: id, found: false };
}

/** `Fir Tree 17` and `Rock 03` -> `Fir Tree 17 ↔ Rock 03`. */
export function describeSubjects(doc: MapDoc, ids: string[]): string {
  if (!ids.length) return "";
  return ids.map((id) => describeEntity(doc, id).label).join(" ↔ ");
}
