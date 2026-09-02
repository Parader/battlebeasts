import {
  defaultElementParams,
  elementType,
  emptyMapDoc,
  type MapDoc,
  type MapElementParams,
} from "@battlebeasts/shared";
import { useSyncExternalStore } from "react";
import type { StickyCollider } from "../props/collider";
import { DEFAULT_BRUSH, type BrushSettings } from "./terrain";

/**
 * Editor state. The document is plain JSON, which is what makes undo a
 * snapshot stack instead of a command pattern -- every mutation clones the
 * previous document and pushes it.
 */

export type Tool = "select" | "place" | "scatter" | "wall" | "element" | "paint";

/** Gizmo mode for the current selection, mirroring the usual W/E/R bindings. */
export type GizmoMode = "translate" | "rotate" | "scale";

export type EditorState = {
  doc: MapDoc;
  /**
   * Primary selection -- the last thing clicked, and the one the inspector
   * edits. Null when nothing is selected.
   */
  selectedId: string | null;
  /**
   * The whole selection, primary included.
   *
   * Kept beside `selectedId` rather than replacing it so that the inspector,
   * the per-entity gizmos and every existing `setUi({ selectedId })` call keep
   * their single-entity meaning. `setUi` maintains the invariant that writing
   * `selectedId` alone collapses the selection to just that entity, so the two
   * can never drift apart.
   */
  selectedIds: string[];
  tool: Tool;
  gizmo: GizmoMode;
  /** Manifest key armed for placement. */
  brushProp: string | null;
  /** Unsaved changes since the last successful save. */
  dirty: boolean;
  /** Snap increments; 0 disables. */
  gridSnap: number;
  angleSnap: number;
  showColliders: boolean;
  showScaleRef: boolean;
  /**
   * In-progress wall polyline, in world XZ. Ephemeral and deliberately outside
   * the document: an unfinished wall should not land in undo history or be
   * saveable, and it only becomes a `MapWall` when committed.
   */
  wallDraft: Array<[number, number]> | null;
  /** Ground point under the cursor, for the rubber-band segment. */
  wallCursor: [number, number] | null;

  /** Catalog type the element tool places, e.g. `player_spawn`. */
  elementType: string;
  /**
   * Params the next placed element gets, seeded from the catalog defaults when
   * the type changes. Held here rather than read off the last placement so
   * that placing five team-B spawns in a row does not need five edits.
   */
  elementParams: MapElementParams;

  /** Terrain brush settings. The pixels themselves live in `terrain.ts`. */
  brush: BrushSettings;
  /**
   * Set while a brush stroke is in flight so the camera stops competing for
   * left-drag. Ephemeral UI state, never saved.
   */
  orbitLocked: boolean;

  /**
   * Pending "frame this entity" request from a panel. Carries a timestamp so
   * clicking the same warning twice re-frames instead of being deduped away.
   */
  focusRequest: { id: string; at: number } | null;

  /**
   * Bumped to ask the viewport to swing round to the match camera's angle.
   *
   * A timestamp rather than a boolean so asking twice in a row works; 0 means
   * "never asked", which keeps the initial framing alone on mount.
   */
  gameViewNonce: number;

  /**
   * Facing the next placed prop will get.
   *
   * Rolled when a prop is armed and again after each placement, rather than at
   * the moment of the click. Placement used to randomise on click while the
   * ghost drew at yaw 0, so the preview could never match what you got --
   * committing the value up front is what makes the ghost truthful.
   */
  ghostYaw: number;

  /**
   * Collision choice to reuse for the next placement.
   *
   * Laying out a row of roof pieces or a hedge means making the same call
   * about collision over and over, so the last one made carries forward.
   * Shape only -- extents always come from the new model's own fitted default,
   * since a radius from the previous prop would mean nothing on this one.
   */
  stickyCollider: StickyCollider | null;
};

/** Random facing, quantised to the angle snap so it still lines up with a grid. */
export function rollYaw(angleSnap: number): number {
  const raw = Math.random() * Math.PI * 2;
  return angleSnap > 0 ? Math.round(raw / angleSnap) * angleSnap : raw;
}

const UNDO_LIMIT = 50;

function initialState(): EditorState {
  return {
    doc: emptyMapDoc("untitled", "Untitled Map"),
    selectedId: null,
    selectedIds: [],
    tool: "select",
    gizmo: "translate",
    brushProp: null,
    dirty: false,
    gridSnap: 0.25,
    angleSnap: Math.PI / 12,
    showColliders: false,
    showScaleRef: true,
    wallDraft: null,
    wallCursor: null,
    elementType: "player_spawn",
    elementParams: defaultElementParams(elementType("player_spawn")!),
    brush: { ...DEFAULT_BRUSH },
    orbitLocked: false,
    focusRequest: null,
    gameViewNonce: 0,
    ghostYaw: 0,
    stickyCollider: null,
  };
}

/** Switch the armed element type, resetting its params to the catalog defaults. */
export function setElementType(id: string): void {
  const def = elementType(id);
  docStore.setUi({
    elementType: id,
    elementParams: def ? defaultElementParams(def) : {},
    tool: "element",
  });
}

class DocStore {
  private state: EditorState = initialState();
  private undoStack: MapDoc[] = [];
  private redoStack: MapDoc[] = [];
  private listeners = new Set<() => void>();
  /** Coalesces rapid same-kind edits (e.g. a drag) into one undo entry. */
  private lastCoalesceKey: string | null = null;
  private lastCoalesceAt = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EditorState => this.state;

  private emit() {
    this.state = { ...this.state };
    for (const fn of this.listeners) fn();
  }

  /** Change UI state without touching the document (never undoable). */
  setUi(patch: Partial<Omit<EditorState, "doc">>) {
    /*
     * Writing `selectedId` on its own means "select only this".
     *
     * Every caller that predates multi-select says exactly that, so deriving
     * the list here keeps them all correct instead of needing each one updated
     * -- and makes it impossible to leave a stale multi-selection behind by
     * forgetting one. Additive selection passes both fields explicitly.
     */
    if ("selectedId" in patch && !("selectedIds" in patch)) {
      patch = { ...patch, selectedIds: patch.selectedId ? [patch.selectedId] : [] };
    }
    Object.assign(this.state, patch);
    this.emit();
  }

  /**
   * Mutate the document. Pass `coalesce` with a stable key (e.g. `move:p001`)
   * so a continuous drag collapses into a single undo entry rather than one
   * per frame.
   */
  edit(recipe: (doc: MapDoc) => void, coalesce?: string) {
    const now = Date.now();
    const merging =
      coalesce != null &&
      coalesce === this.lastCoalesceKey &&
      now - this.lastCoalesceAt < 600;

    if (!merging) {
      this.undoStack.push(structuredClone(this.state.doc));
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack.length = 0;
    }
    this.lastCoalesceKey = coalesce ?? null;
    this.lastCoalesceAt = now;

    const next = structuredClone(this.state.doc);
    recipe(next);
    this.state.doc = next;
    this.state.dirty = true;
    this.emit();
  }

  /** Replace the document wholesale (load / new). Clears history. */
  replace(doc: MapDoc) {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastCoalesceKey = null;
    this.state.doc = doc;
    this.state.selectedId = null;
    this.state.selectedIds = [];
    this.state.dirty = false;
    this.emit();
  }

  markSaved() {
    this.state.dirty = false;
    this.emit();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.state.doc));
    this.state.doc = prev;
    this.state.dirty = true;
    this.lastCoalesceKey = null;
    this.pruneSelection();
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.state.doc));
    this.state.doc = next;
    this.state.dirty = true;
    this.lastCoalesceKey = null;
    this.pruneSelection();
    this.emit();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /** Drop a selection that history just removed, so panels don't dangle. */
  private pruneSelection() {
    if (!this.state.selectedIds.length) return;
    const doc = this.state.doc;
    const exists = (id: string) =>
      doc.props.some((p) => p.id === id) ||
      doc.walls.some((w) => w.id === id) ||
      doc.elements.some((e) => e.id === id);

    const kept = this.state.selectedIds.filter(exists);
    if (kept.length !== this.state.selectedIds.length) this.state.selectedIds = kept;
    // Undoing a delete of the primary can leave the rest of a group selected,
    // so promote instead of clearing the lot.
    if (this.state.selectedId && !exists(this.state.selectedId)) {
      this.state.selectedId = kept[kept.length - 1] ?? null;
    }
  }
}

export const docStore = new DocStore();

export function useEditor(): EditorState {
  return useSyncExternalStore(docStore.subscribe, docStore.getSnapshot);
}

/** Monotonic ids scoped per document prefix, e.g. `p`, `w`, `e`. */
export function nextId(doc: MapDoc, prefix: string): string {
  const used = new Set<string>([
    ...doc.props.map((p) => p.id),
    ...doc.walls.map((w) => w.id),
    ...doc.elements.map((e) => e.id),
  ]);
  let n = 1;
  let id = `${prefix}${String(n).padStart(3, "0")}`;
  while (used.has(id)) {
    n++;
    id = `${prefix}${String(n).padStart(3, "0")}`;
  }
  return id;
}

/**
 * Turn the in-progress polyline into a real wall. A draft under two points has
 * no segments, so it is discarded rather than saved as an empty wall.
 */
export function commitWall(points: ReadonlyArray<readonly [number, number]>, closed: boolean): void {
  if (points.length < 2) {
    docStore.setUi({ wallDraft: null, wallCursor: null });
    return;
  }
  const id = nextId(docStore.getSnapshot().doc, "w");
  docStore.edit((d) => {
    d.walls.push({ id, closed, points: points.map((p) => [p[0], p[1]] as [number, number]) });
  });
  docStore.setUi({ wallDraft: null, wallCursor: null, selectedId: id });
}

/** Every entity in the document, as a flat list of the fields grouping needs. */
function allEntities(doc: MapDoc): Array<{ id: string; group?: string }> {
  return [...doc.props, ...doc.walls, ...doc.elements];
}

/** The group an entity belongs to, or null when it stands alone. */
export function groupOf(doc: MapDoc, id: string): string | null {
  return allEntities(doc).find((e) => e.id === id)?.group ?? null;
}

/**
 * What clicking `id` actually selects: the whole group, or just the entity.
 *
 * A group only earns its keep if clicking any part of it grabs the lot --
 * otherwise it is a label, not a group.
 */
export function membersOf(doc: MapDoc, id: string): string[] {
  const g = groupOf(doc, id);
  if (!g) return [id];
  const members = allEntities(doc)
    .filter((e) => e.group === g)
    .map((e) => e.id);
  // A group of one is a group whose last sibling was deleted; treat it as loose
  // rather than letting the empty case fall through.
  return members.length ? members : [id];
}

/**
 * Select an entity, or extend the selection when `additive`.
 *
 * Additive re-clicks toggle, which is what shift-click means everywhere else,
 * and the last survivor becomes primary so the inspector always has something
 * coherent to show. `isolate` (alt-click) reaches past a group to the single
 * entity under the cursor, for fixing one fence post without dissolving the
 * fence.
 */
export function selectEntity(
  id: string | null,
  opts: { additive?: boolean; tool?: Tool; isolate?: boolean } = {},
): void {
  const patch: Partial<Omit<EditorState, "doc">> = opts.tool ? { tool: opts.tool } : {};

  if (!id) {
    docStore.setUi({ ...patch, selectedId: null, selectedIds: [] });
    return;
  }

  const { doc, selectedIds } = docStore.getSnapshot();
  const targets = opts.isolate ? [id] : membersOf(doc, id);

  if (!opts.additive) {
    docStore.setUi({ ...patch, selectedId: id, selectedIds: targets });
    return;
  }

  // Shift-clicking a group adds or removes it whole, so the toggle hinges on
  // whether the group is already entirely in the selection.
  const inSelection = new Set(selectedIds);
  const alreadyIn = targets.every((t) => inSelection.has(t));
  const rest = selectedIds.filter((s) => !targets.includes(s));
  const next = alreadyIn ? rest : [...rest, ...targets];

  docStore.setUi({
    ...patch,
    selectedId: alreadyIn ? (next[next.length - 1] ?? null) : id,
    selectedIds: next,
  });
}

/**
 * Bind the selection into one group.
 *
 * Any groups caught in the selection are absorbed rather than nested, and
 * their members outside the selection come along -- you cannot half-group a
 * group, since clicking either half would then select the other.
 */
export function groupSelected(): number {
  const { doc, selectedIds } = docStore.getSnapshot();
  if (selectedIds.length < 2) return 0;

  const ids = new Set(selectedIds.flatMap((id) => membersOf(doc, id)));
  const used = new Set(allEntities(doc).map((e) => e.group));
  let n = 1;
  while (used.has(`g${n}`)) n++;
  const group = `g${n}`;

  docStore.edit((d) => {
    for (const e of allEntities(d)) if (ids.has(e.id)) e.group = group;
  });
  docStore.setUi({ selectedId: selectedIds[selectedIds.length - 1]!, selectedIds: [...ids] });
  return ids.size;
}

/** Dissolve the groups the selection belongs to. Returns how many were freed. */
export function ungroupSelected(): number {
  const { doc, selectedIds } = docStore.getSnapshot();
  const ids = new Set(selectedIds.flatMap((id) => membersOf(doc, id)));
  const freed = allEntities(doc).filter((e) => ids.has(e.id) && e.group).length;
  if (!freed) return 0;

  docStore.edit((d) => {
    for (const e of allEntities(d)) if (ids.has(e.id)) delete e.group;
  });
  docStore.setUi({ selectedId: selectedIds[selectedIds.length - 1]!, selectedIds: [...ids] });
  return freed;
}

/**
 * Copy everything selected and select the copies.
 *
 * Offset by one grid step rather than dropped in place: an exact overlap is
 * indistinguishable from nothing having happened, and it leaves two props
 * fighting for the same click. Offsetting along world +X keeps copies on the
 * grid and in the same orientation, so a row of fence posts is a matter of
 * repeating the shortcut -- and duplicating a group preserves its shape,
 * because every member takes the same offset.
 *
 * Returns the new ids, empty when nothing was selected.
 */
export function duplicateSelected(): string[] {
  const { selectedIds, gridSnap } = docStore.getSnapshot();
  if (!selectedIds.length) return [];

  const step = gridSnap > 0 ? gridSnap : 1;
  const created: string[] = [];

  docStore.edit((d) => {
    /*
     * Copies get fresh group ids.
     *
     * Reusing the source's would fuse the copy into the original, so clicking
     * the new stall would grab the old one too -- and duplicating a group is
     * precisely how you make a *second* stall.
     */
    let nextGroup = 1;
    const regroup = new Map<string, string>();
    const groupFor = (from: string | undefined): string | undefined => {
      if (!from) return undefined;
      const seen = regroup.get(from);
      if (seen) return seen;
      const used = new Set([...d.props, ...d.walls, ...d.elements].map((e) => e.group));
      while (used.has(`g${nextGroup}`)) nextGroup++;
      const fresh = `g${nextGroup++}`;
      regroup.set(from, fresh);
      return fresh;
    };

    for (const id of selectedIds) {
      // Ids come from the working copy, so each one accounts for the copies
      // already pushed in this same edit.
      const prop = d.props.find((p) => p.id === id);
      if (prop) {
        const nid = nextId(d, "p");
        d.props.push({
          ...structuredClone(prop),
          id: nid,
          x: prop.x + step,
          group: groupFor(prop.group),
        });
        created.push(nid);
        continue;
      }

      const wall = d.walls.find((w) => w.id === id);
      if (wall) {
        const nid = nextId(d, "w");
        d.walls.push({
          ...structuredClone(wall),
          id: nid,
          points: wall.points.map((p) => [p[0] + step, p[1]] as [number, number]),
          group: groupFor(wall.group),
        });
        created.push(nid);
        continue;
      }

      const element = d.elements.find((e) => e.id === id);
      if (element) {
        const nid = nextId(d, "e");
        d.elements.push({
          ...structuredClone(element),
          id: nid,
          x: element.x + step,
          group: groupFor(element.group),
        });
        created.push(nid);
      }
    }
  });

  if (created.length) {
    docStore.setUi({
      selectedId: created[created.length - 1]!,
      selectedIds: created,
      tool: "select",
    });
  }
  return created;
}

/** Remove everything selected. Returns how many entities went. */
export function deleteSelected(): number {
  const { selectedIds } = docStore.getSnapshot();
  if (!selectedIds.length) return 0;

  const kill = new Set(selectedIds);
  docStore.edit((d) => {
    d.props = d.props.filter((p) => !kill.has(p.id));
    d.walls = d.walls.filter((w) => !kill.has(w.id));
    d.elements = d.elements.filter((e) => !kill.has(e.id));
  });
  docStore.setUi({ selectedId: null });
  return kill.size;
}

export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Mute a playability warning for this map, by `mapWarningKey`. */
export function dismissWarning(key: string): void {
  docStore.edit((d) => {
    const list = d.suppressedWarnings ?? [];
    if (!list.includes(key)) d.suppressedWarnings = [...list, key];
  });
}

/** Un-mute one warning, or all of them when `key` is omitted. */
export function restoreWarning(key?: string): void {
  docStore.edit((d) => {
    if (!key) {
      d.suppressedWarnings = undefined;
      return;
    }
    const next = (d.suppressedWarnings ?? []).filter((k) => k !== key);
    d.suppressedWarnings = next.length ? next : undefined;
  });
}

/**
 * Select an entity and ask the viewport to frame it.
 *
 * Framing has to happen inside the Canvas where the camera lives, so this
 * leaves a request the viewport consumes and clears rather than reaching for
 * the controls from a panel.
 */
export function revealEntity(id: string): void {
  docStore.setUi({ selectedId: id, tool: "select", focusRequest: { id, at: Date.now() } });
}
