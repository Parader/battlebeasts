import { emptyMapDoc, type MapDoc } from "@battlebeasts/shared";
import { useCallback, useEffect, useState } from "react";
import {
  deleteMap,
  heightUrlFor,
  listMaps,
  loadMap,
  saveMap,
  slugifyMapId,
  splatUrlFor,
  type MapListEntry,
} from "./io/maps";
import { GroundPanel } from "./panels/GroundPanel";
import { Inspector } from "./panels/Inspector";
import { ToolOptions } from "./panels/ToolOptions";
import { Validation } from "./panels/Validation";
import { Palette } from "./props/Palette";
import { Viewport } from "./scene/Viewport";
import {
  commitWall,
  deleteSelected,
  docStore,
  duplicateSelected,
  groupSelected,
  ungroupSelected,
  useEditor,
} from "./state/docStore";
import { loadSidecar, terrain } from "./state/terrain";

/** Size splat/height buffers from the document so the viewport can render immediately. */
function primeTerrain(doc: MapDoc): void {
  terrain.load(doc, null, null);
}

/**
 * Pull saved terrain PNGs into the live buffers.
 *
 * Missing sidecars are normal rather than an error: a map that has never been
 * painted just starts as base material over flat ground.
 */
async function loadTerrainSidecars(doc: MapDoc): Promise<void> {
  if (doc.ground.kind !== "painted") return;
  const [splat, height] = await Promise.all([
    doc.ground.splatUrl ? loadSidecar(doc.ground.splatUrl) : Promise.resolve(null),
    doc.ground.heightUrl ? loadSidecar(doc.ground.heightUrl) : Promise.resolve(null),
  ]);
  terrain.load(doc, splat, height);
}

async function loadTerrainFor(doc: MapDoc): Promise<void> {
  primeTerrain(doc);
  await loadTerrainSidecars(doc);
}

function useMapList() {
  const [maps, setMaps] = useState<MapListEntry[]>([]);
  const refresh = useCallback(() => {
    listMaps().then(setMaps, () => setMaps([]));
  }, []);
  useEffect(refresh, [refresh]);
  return { maps, refresh };
}

function ToolButtons() {
  const { tool, brushProp } = useEditor();
  const tools = [
    { id: "select", label: "Select", hint: "Click anything to select it" },
    { id: "place", label: "Place", hint: "Click the ground to plant the armed prop" },
    { id: "wall", label: "Boundary", hint: "Draw a collision boundary on the ground (B)" },
    { id: "element", label: "Element", hint: "Place a spawn, stand, portal or objective" },
    { id: "paint", label: "Terrain", hint: "Paint ground materials and sculpt height (T)" },
  ] as const;
  return (
    <div className="toolbar">
      {tools.map((t) => (
        <button
          key={t.id}
          className={tool === t.id ? "active" : undefined}
          disabled={t.id === "place" && !brushProp}
          title={t.hint}
          onClick={() =>
            // Leaving the wall tool must not strand a half-drawn polyline.
            docStore.setUi({ tool: t.id, wallDraft: null, wallCursor: null })
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ViewButtons() {
  const { showColliders, showScaleRef } = useEditor();
  return (
    <div className="toolbar">
      <button
        className={showColliders ? "active" : undefined}
        title="Show collision footprints and player reach (C)"
        onClick={() => docStore.setUi({ showColliders: !showColliders })}
      >
        Collision
      </button>
      <button
        className={showScaleRef ? "active" : undefined}
        title="Show the player character at true scale (H)"
        onClick={() => docStore.setUi({ showScaleRef: !showScaleRef })}
      >
        Scale
      </button>
      <button
        title="Look from the match camera's fixed angle (G)"
        onClick={() => docStore.setUi({ gameViewNonce: Date.now() })}
      >
        Game view
      </button>
    </div>
  );
}

function GizmoModeButtons() {
  const { gizmo, selectedId } = useEditor();
  const modes = [
    { id: "translate", label: "Move", key: "W" },
    { id: "rotate", label: "Rotate", key: "E" },
    { id: "scale", label: "Scale", key: "R" },
  ] as const;
  return (
    <div className="toolbar">
      {modes.map((m) => (
        <button
          key={m.id}
          className={gizmo === m.id ? "active" : undefined}
          disabled={!selectedId}
          title={`${m.label} (${m.key})`}
          onClick={() => docStore.setUi({ gizmo: m.id })}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function TopBar({ onStatus }: { onStatus: (s: string) => void }) {
  const { doc, dirty } = useEditor();
  const { maps, refresh } = useMapList();
  const [busy, setBusy] = useState(false);

  const confirmDiscard = () =>
    !dirty || window.confirm("Discard unsaved changes?");

  const onLoad = async (id: string) => {
    // Re-picking the open map is a no-op, and for an unsaved one it would be a
    // fetch for a file that does not exist yet.
    if (!id || id === doc.id || !confirmDiscard()) return;
    setBusy(true);
    try {
      const { doc: loaded, errors } = await loadMap(id);
      primeTerrain(loaded);
      docStore.replace(loaded);
      onStatus(errors.length ? `Loaded ${id} with ${errors.length} issue(s): ${errors[0]}` : `Loaded ${id}`);
      void loadTerrainSidecars(loaded);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ask for a map name and derive its id.
   *
   * Ids become filenames and generated identifiers, so they are restricted to
   * lowercase, digits, `_` and `-`. Asking for the id directly meant a perfectly
   * reasonable answer like "Village" was rejected, so the name is what is asked
   * for and the id is slugged from it.
   *
   * Returns null when the user cancels or gives something unusable. Problems go
   * through `alert` rather than the status bar: this is a modal flow, and a line
   * of text at the bottom of the screen is too easy to miss when a dialog just
   * closed.
   */
  const askName = (
    title: string,
    fallback: string,
    /** Id the caller already owns, so a rename that only retitles is allowed. */
    allowId?: string,
  ): { id: string; name: string } | null => {
    const name = window.prompt(title, fallback)?.trim();
    if (!name) return null;

    const id = slugifyMapId(name);
    if (!id) {
      window.alert(`"${name}" has no letters or digits to make an id from.`);
      return null;
    }
    if (id !== allowId && maps.some((m) => m.id === id)) {
      window.alert(`A map with the id "${id}" already exists.\n\nPick another name, or open it from the list.`);
      return null;
    }
    return { id, name };
  };

  /**
   * Write the current document to disk.
   *
   * Painted maps save the terrain buffers alongside the document and record
   * where they landed. The URLs are derived from the id rather than being
   * user-editable, so a map can never point at another map's terrain -- which
   * also means a rename repoints them for free.
   */
  const persist = async () => {
    const current = docStore.getSnapshot().doc;
    let toSave = current;
    let sidecars: ReturnType<typeof terrain.sidecars> = null;
    if (current.ground.kind === "painted") {
      // Skip encoding half-megabyte base64 payloads when buffers still match
      // the sidecars on disk — the expensive part of creating a new map.
      if (terrain.dirty) sidecars = terrain.sidecars();
      toSave = {
        ...current,
        ground: {
          ...current.ground,
          splatUrl: splatUrlFor(current.id),
          heightUrl: current.ground.heightScale > 0 ? heightUrlFor(current.id) : undefined,
        },
      };
    }
    const result = await saveMap(toSave, sidecars ?? undefined);
    docStore.markSaved();
    if (sidecars) terrain.markClean();
    refresh();
    return result;
  };

  /** Turn a save result into one line of feedback. */
  const savedMessage = ({ written, warnings, indexError }: Awaited<ReturnType<typeof persist>>) => {
    const errors = warnings.filter((w) => w.severity === "error").length;
    const counts = warnings.length
      ? ` — ${errors} error(s), ${warnings.length - errors} warning(s)`
      : "";
    // A failed index rebuild is worth shouting about: the file is on disk but
    // the game will not see it.
    const index = indexError ? ` — map index not rebuilt (${indexError}), run \`pnpm gen:maps\`` : "";
    return `Saved ${written[0]}${counts}${index}`;
  };

  /*
   * New writes immediately rather than leaving an in-memory document.
   *
   * Creating a map that exists nowhere was indistinguishable from the button
   * doing nothing: the list is read from disk, so an unsaved map could not
   * appear in it.
   */
  const onNew = () => {
    if (!confirmDiscard()) return;
    const picked = askName("Name the new map", "New Map");
    if (!picked) return;

    const fresh = emptyMapDoc(picked.id, picked.name);
    primeTerrain(fresh);
    docStore.replace(fresh);
    onStatus(`Created "${picked.name}" (${picked.id}) — saving…`);
    void (async () => {
      try {
        await persist();
        onStatus(`Created "${picked.name}" (${picked.id})`);
      } catch (err) {
        onStatus(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  /*
   * Rename is save-as-then-delete, because the id is the filename.
   *
   * Writing the new file first means an interrupted rename leaves a duplicate
   * rather than nothing at all.
   */
  const onRename = async () => {
    const from = doc.id;
    const onDisk = maps.some((m) => m.id === from);
    const to = askName(`Rename "${doc.name}"`, doc.name, from);
    if (!to) return;

    setBusy(true);
    try {
      docStore.edit((d) => {
        d.id = to.id;
        d.name = to.name;
      });
      await persist();
      // Only a changed id moves the file; retitling in place leaves nothing to
      // clean up.
      if (onDisk && to.id !== from) await deleteMap(from);
      refresh();
      onStatus(
        to.id === from
          ? `Renamed to "${to.name}"`
          : `Renamed to "${to.name}" (${from} → ${to.id})`,
      );
    } catch (err) {
      onStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    setBusy(true);
    try {
      onStatus(savedMessage(await persist()));
    } catch (err) {
      onStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="topbar">
      <span className="title">Map Editor</span>

      <select
        value={doc.id}
        onChange={(e) => void onLoad(e.target.value)}
        style={{ width: 190 }}
      >
        <option value="">— open map —</option>
        {/*
          A new map exists only in memory until it is saved, so it is absent
          from the list. Without an option of its own the select would fall
          back to the placeholder and New would look like it did nothing.
        */}
        {!maps.some((m) => m.id === doc.id) && (
          <option value={doc.id}>{doc.name} (unsaved)</option>
        )}
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.id})
          </option>
        ))}
      </select>

      <button onClick={() => void onNew()} disabled={busy}>
        New
      </button>
      <button onClick={() => void onRename()} disabled={busy} title="Change the map's id and filename">
        Rename
      </button>
      <button onClick={() => void onSave()} disabled={busy}>
        Save
      </button>

      <ToolButtons />

      <span className="spacer" />

      <ViewButtons />
      <GizmoModeButtons />

      <button onClick={() => docStore.undo()} disabled={!docStore.canUndo()} title="Ctrl+Z">
        Undo
      </button>
      <button onClick={() => docStore.redo()} disabled={!docStore.canRedo()} title="Ctrl+Shift+Z">
        Redo
      </button>

      <span className="muted">
        {doc.name} {dirty && <span className="dot" title="Unsaved changes" />}
      </span>
    </div>
  );
}

function statusHint(tool: string, hasDraft: boolean, armed: boolean): string {
  if (tool === "wall") {
    return hasDraft
      ? "Click to add points · click the start ring to close · Enter finishes open · Backspace undoes a point · Esc cancels"
      : "Click the ground to start a boundary";
  }
  if (tool === "paint") {
    return "Left-drag to paint or sculpt · middle-drag orbits · right-drag pans · Ctrl+Z undoes a stroke";
  }
  if (tool === "place" && armed)
    return "Click the ground to plant · ←/→ swaps model · Esc to cancel";
  if (tool === "element") return "Pick a type on the left, then click the ground to place it";
  return "Click to select · Shift-click adds · Ctrl+G groups, Ctrl+Alt+G ungroups · Alt-click one piece · Ctrl+D duplicates · Del removes";
}

export function App() {
  const { doc, tool, brushProp, wallDraft } = useEditor();
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        // Ctrl+D is "bookmark" in every browser, so it has to be claimed.
        e.preventDefault();
        const copies = duplicateSelected();
        if (!copies.length) setStatus("Nothing selected to duplicate");
        else if (copies.length > 1) setStatus(`Duplicated ${copies.length} entities`);
        return;
      }

      /*
       * Grouping, keyed off `code` rather than `key`.
       *
       * Ctrl+Alt is AltGr on a lot of layouts, which rewrites `key` into
       * whatever glyph that combination produces -- `code` is the physical key
       * and says "G" regardless. Alt is checked first because Ctrl+Alt+G also
       * satisfies the plain Ctrl+G test.
       */
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyG") {
        e.preventDefault();
        if (e.altKey) {
          const freed = ungroupSelected();
          setStatus(freed ? `Ungrouped ${freed} entities` : "Nothing grouped in the selection");
        } else {
          const size = groupSelected();
          setStatus(size ? `Grouped ${size} entities` : "Select at least two things to group");
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        /*
         * Terrain keeps its own history because its buffers are far too large
         * to snapshot into the document's undo stack. While the brush is the
         * active tool, undo means "undo a stroke"; the document stack is
         * untouched and still there when you switch back.
         */
        if (docStore.getSnapshot().tool === "paint") {
          if (e.shiftKey) terrain.redo();
          else terrain.undo();
          return;
        }
        if (e.shiftKey) docStore.redo();
        else docStore.undo();
        return;
      }

      // Wall drawing owns Enter/Backspace/Escape while a draft is open.
      const { wallDraft } = docStore.getSnapshot();
      if (wallDraft) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitWall(wallDraft, false);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          const next = wallDraft.slice(0, -1);
          docStore.setUi({ wallDraft: next.length ? next : null });
          return;
        }
        if (e.key === "Escape") {
          docStore.setUi({ wallDraft: null, wallCursor: null });
          return;
        }
      }

      // W/E/R gizmo modes, the near-universal DCC binding.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const mode = { w: "translate", e: "rotate", r: "scale" } as const;
        const next = mode[e.key.toLowerCase() as keyof typeof mode];
        if (next) {
          docStore.setUi({ gizmo: next });
          return;
        }
      }

      if (e.key === "Escape") {
        // One key backs out of both "armed to place" and "something selected".
        docStore.setUi({ tool: "select", brushProp: null, selectedId: null });
        return;
      }

      if (e.key.toLowerCase() === "b") {
        docStore.setUi({ tool: "wall", selectedId: null });
        return;
      }

      if (e.key.toLowerCase() === "t") {
        docStore.setUi({ tool: "paint", selectedId: null });
        return;
      }

      if (e.key.toLowerCase() === "g") {
        docStore.setUi({ gameViewNonce: Date.now() });
        return;
      }

      const ui = docStore.getSnapshot();
      if (e.key.toLowerCase() === "c") {
        docStore.setUi({ showColliders: !ui.showColliders });
        return;
      }
      if (e.key.toLowerCase() === "h") {
        docStore.setUi({ showScaleRef: !ui.showScaleRef });
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!docStore.getSnapshot().selectedIds.length) return;
        e.preventDefault();
        const gone = deleteSelected();
        if (gone > 1) setStatus(`Deleted ${gone} entities`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Terrain buffers are sized from the document, so the initial map needs them
  // allocated before the first brush stroke or render.
  useEffect(() => {
    const initial = docStore.getSnapshot().doc;
    primeTerrain(initial);
    void loadTerrainSidecars(initial);
  }, []);

  // Browsers ignore custom text here, but the prompt itself is the point.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (docStore.getSnapshot().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <TopBar onStatus={setStatus} />

      <div className="left">
        <ToolOptions />
        <Palette />
      </div>

      <div className="view">
        <Viewport />
      </div>

      <div className="right">
        <Inspector />
        <GroundPanel />
        <Validation />
      </div>

      <div className="statusbar">
        <span>{status}</span>
        <span className="spacer" />
        <span>{statusHint(tool, !!wallDraft, !!brushProp)}</span>
        <span>
          {doc.props.length} props · {doc.walls.length} boundaries · {doc.elements.length} elements
        </span>
      </div>
    </div>
  );
}
