import {
  elementType,
  type MapColliderSpec,
  type MapElement,
  type MapElementParamValue,
  type MapElementShape,
  type MapPropPlacement,
  type MapWall,
  propTargetRadius,
} from "@battlebeasts/shared";
import { colliderWithMode, stickyOf } from "../props/collider";
import { usePropIndex } from "../props/manifest";
import { colliderOverrides, useColliderOverrideVersion } from "../props/overrides";
import {
  deleteSelected,
  docStore,
  duplicateSelected,
  groupSelected,
  ungroupSelected,
  useEditor,
} from "../state/docStore";
import { ParamFields } from "./ElementParams";

/** Copy the selection. Offered next to Delete on every kind of entity. */
function DuplicateButton() {
  return (
    <button
      style={{ marginTop: 8, width: "100%" }}
      title="Place a copy one grid step to the +X side (Ctrl+D)"
      onClick={() => duplicateSelected()}
    >
      Duplicate (Ctrl+D)
    </button>
  );
}

/** Numeric field that only commits finite values, so typing "-" is not fatal. */
function Num({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="row">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}

function ColliderEditor({ prop }: { prop: MapPropPlacement }) {
  const { index } = usePropIndex();
  const { doc } = useEditor();
  // Subscribes to corrections so the "saved for this model" note is live.
  useColliderOverrideVersion();
  const entry = index?.byKey.get(prop.prop);
  const c = prop.collider;
  const corrected = colliderOverrides.has(prop.prop);

  /**
   * Correcting a collider corrects the model, not just this copy.
   *
   * The fitted default is a guess, so an edit here is really "that guess was
   * wrong for this model" -- which is equally true of the other thirty copies
   * already placed and of every one placed later. So the edit applies to all
   * copies in this map, is saved against the model for future placements and
   * other maps, and arms the next placement.
   *
   * All one undo step, because it was one action.
   */
  const set = (collider: MapColliderSpec) => {
    docStore.edit((d) => {
      for (const p of d.props) {
        if (p.prop === prop.prop) p.collider = structuredClone(collider);
      }
    });
    colliderOverrides.set(prop.prop, collider);
    docStore.setUi({ stickyCollider: stickyOf(collider) });
  };

  /** Copies of this model that the edit will also change. */
  const siblings = doc.props.reduce((n, p) => (p.prop === prop.prop ? n + 1 : n), 0) - 1;

  const changeMode = (mode: MapColliderSpec["mode"]) => {
    if (mode === c.mode) return;
    set(colliderWithMode(c, mode, entry));
  };

  const differsFromDefault =
    entry != null && JSON.stringify(entry.defaultCollider) !== JSON.stringify(c);

  return (
    <div className="section">
      <h3>Collision</h3>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        {(["none", "circle", "box"] as const).map((m) => (
          <button key={m} className={c.mode === m ? "active" : undefined} onClick={() => changeMode(m)}>
            {m}
          </button>
        ))}
      </div>

      {c.mode === "circle" && (
        <Num label="radius" value={c.radius} step={0.05} onChange={(radius) => set({ ...c, radius })} />
      )}
      {c.mode === "box" && (
        <>
          <Num label="half X" value={c.halfX} step={0.05} onChange={(halfX) => set({ ...c, halfX })} />
          <Num label="half Z" value={c.halfZ} step={0.05} onChange={(halfZ) => set({ ...c, halfZ })} />
          <Num
            label="yaw°"
            value={((c.yaw ?? 0) * 180) / Math.PI}
            step={5}
            onChange={(deg) => set({ ...c, yaw: (deg * Math.PI) / 180 })}
          />
        </>
      )}

      {/* Most kit models are not built around their own pivot, so placement
          bakes the model's own offset out of the stored position and the
          collider carries it back. The fitted value is right for almost
          everything; these are here for the cases where the base slice is a
          poor guide, such as an archway measured at its two feet. */}
      {c.mode !== "none" && (
        <>
          <Num
            label="offset X"
            value={c.offsetX ?? 0}
            step={0.05}
            onChange={(offsetX) => set({ ...c, offsetX: offsetX || undefined })}
          />
          <Num
            label="offset Z"
            value={c.offsetZ ?? 0}
            step={0.05}
            onChange={(offsetZ) => set({ ...c, offsetZ: offsetZ || undefined })}
          />

          <label className="check" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={c.blocksProjectiles !== false}
              onChange={(e) =>
                set(
                  e.target.checked
                    ? { ...c, blocksProjectiles: undefined }
                    : { ...c, blocksProjectiles: false },
                )
              }
            />
            Blocks projectiles
          </label>
          <div className="muted" style={{ fontSize: 11 }}>
            {c.blocksProjectiles === false
              ? "Low cover: walk around it, shoot over it."
              : "Stops shots, beams and aimed telegraphs as well as movement."}
          </div>
        </>
      )}

      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Effective radius scales with the placement ({prop.scale.toFixed(2)}×).
      </div>

      {/* Editing here is not a local change, and finding that out by accident
          would be unpleasant -- so say so before the click, not after. */}
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        {corrected ? "Saved for this model" : "Edits apply to this model"}
        {siblings > 0 && ` · ${siblings} other cop${siblings === 1 ? "y" : "ies"} on this map`}
        {corrected && " · and to future placements"}
      </div>

      {(differsFromDefault || corrected) && entry && (
        <button
          style={{ marginTop: 6, width: "100%" }}
          onClick={() => {
            // Drops the saved correction as well, or the model would silently
            // go back to being corrected on the next placement.
            colliderOverrides.clear(prop.prop);
            docStore.edit((d) => {
              for (const p of d.props) {
                if (p.prop === prop.prop) {
                  p.collider = structuredClone(entry.defaultCollider) as MapColliderSpec;
                }
              }
            });
            docStore.setUi({ stickyCollider: null });
          }}
        >
          Reset to fitted default
        </button>
      )}
    </div>
  );
}

function WallInspector({ wall }: { wall: MapWall }) {
  const length = wall.points.reduce((sum, p, i) => {
    if (i === 0 && !wall.closed) return 0;
    const prev = wall.points[(i - 1 + wall.points.length) % wall.points.length]!;
    return sum + Math.hypot(p[0] - prev[0], p[1] - prev[1]);
  }, 0);

  return (
    <div className="section">
      <h3>Boundary</h3>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {wall.id} · {wall.points.length} points · {length.toFixed(1)} m
        <br />
        Blocks movement but is invisible in game.
        <br />
        <br />
        Drag a blue point to move it, click a green midpoint to insert one, Alt-click a point to
        remove it.
      </div>

      <div className="row">
        <label>Closed</label>
        <button
          className={wall.closed ? "active" : undefined}
          onClick={() =>
            docStore.edit((d) => {
              const w = d.walls.find((x) => x.id === wall.id);
              if (w) w.closed = !w.closed;
            })
          }
        >
          {wall.closed ? "Closed loop" : "Open line"}
        </button>
      </div>

      <label className="check" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={wall.blocksProjectiles !== false}
          onChange={(e) => {
            const blocks = e.target.checked;
            docStore.edit((d) => {
              const w = d.walls.find((x) => x.id === wall.id);
              if (!w) return;
              if (blocks) delete w.blocksProjectiles;
              else w.blocksProjectiles = false;
            });
          }}
        />
        Blocks projectiles
      </label>
      <div className="muted" style={{ fontSize: 11 }}>
        {wall.blocksProjectiles === false
          ? "Low cover: walk around it, shoot over it."
          : "Stops shots, beams and aimed telegraphs as well as movement."}
      </div>

      <DuplicateButton />
      <button
        style={{ marginTop: 8, width: "100%", borderColor: "var(--danger)", color: "var(--danger)" }}
        onClick={() => {
          docStore.edit((d) => {
            d.walls = d.walls.filter((w) => w.id !== wall.id);
          });
          docStore.setUi({ selectedId: null });
        }}
      >
        Delete (Del)
      </button>
    </div>
  );
}

function ElementInspector({ el }: { el: MapElement }) {
  const def = elementType(el.type);

  const set = (patch: Partial<MapElement>, coalesce?: string) =>
    docStore.edit((d) => {
      const t = d.elements.find((x) => x.id === el.id);
      if (t) Object.assign(t, patch);
    }, coalesce);

  const setParam = (key: string, value: MapElementParamValue) =>
    docStore.edit((d) => {
      const t = d.elements.find((x) => x.id === el.id);
      if (t) t.params = { ...t.params, [key]: value };
    }, `param:${el.id}:${key}`);

  const setShape = (shape: MapElementShape | undefined, coalesce?: string) =>
    docStore.edit((d) => {
      const t = d.elements.find((x) => x.id === el.id);
      if (t) t.shape = shape;
    }, coalesce);

  const remove = () => {
    docStore.edit((d) => {
      d.elements = d.elements.filter((x) => x.id !== el.id);
    });
    docStore.setUi({ selectedId: null });
  };

  const shape = el.shape;

  return (
    <div className="section">
      <h3>{def?.label ?? el.type}</h3>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {el.id} · {el.type}
        {!def && " · unknown type"}
      </div>

      {def && <ParamFields def={def} params={el.params} onChange={setParam} />}

      <Num label="X" value={el.x} onChange={(x) => set({ x }, `el:${el.id}`)} />
      <Num label="Z" value={el.z} onChange={(z) => set({ z }, `el:${el.id}`)} />
      <Num
        label="Facing°"
        value={(el.yaw * 180) / Math.PI}
        step={15}
        onChange={(deg) => set({ yaw: (deg * Math.PI) / 180 }, `el:${el.id}`)}
      />

      {/* Trigger volume. Any element may carry one, so this is not gated on
          the catalog default -- a spawn can be given a radius if a mode ever
          needs one. */}
      <div className="row">
        <label>Volume</label>
        <div className="toolbar">
          <button className={!shape ? "active" : undefined} onClick={() => setShape(undefined)}>
            none
          </button>
          <button
            className={shape?.kind === "circle" ? "active" : undefined}
            onClick={() =>
              setShape({
                kind: "circle",
                radius: shape?.kind === "box" ? Math.max(shape.halfX, shape.halfZ) : 3,
              })
            }
          >
            circle
          </button>
          <button
            className={shape?.kind === "box" ? "active" : undefined}
            onClick={() => {
              const r = shape?.kind === "circle" ? shape.radius : 2;
              setShape({ kind: "box", halfX: r, halfZ: r });
            }}
          >
            box
          </button>
        </div>
      </div>

      {shape?.kind === "circle" && (
        <Num
          label="Radius"
          value={shape.radius}
          step={0.5}
          onChange={(radius) =>
            radius > 0 && setShape({ kind: "circle", radius }, `shape:${el.id}`)
          }
        />
      )}
      {shape?.kind === "box" && (
        <>
          <Num
            label="Half X"
            value={shape.halfX}
            step={0.5}
            onChange={(halfX) =>
              halfX > 0 && setShape({ ...shape, halfX }, `shape:${el.id}`)
            }
          />
          <Num
            label="Half Z"
            value={shape.halfZ}
            step={0.5}
            onChange={(halfZ) =>
              halfZ > 0 && setShape({ ...shape, halfZ }, `shape:${el.id}`)
            }
          />
        </>
      )}

      <DuplicateButton />
      <button
        style={{ marginTop: 8, width: "100%", borderColor: "var(--danger)", color: "var(--danger)" }}
        onClick={remove}
      >
        Delete (Del)
      </button>
    </div>
  );
}

/** Sensible starting health, roughly the hub practice dummy's. */
const DEFAULT_PROP_HP = 200;

/**
 * Turns a prop into something players can attack.
 *
 * Health is the only switch: a prop with any is a target, one without is
 * scenery. The hit radius is shown rather than edited because it comes from
 * the collider -- an attackable prop with no collider would be a floating
 * hitbox, so the panel says so instead of silently inventing one.
 */
function AttackableFields({
  prop,
  set,
}: {
  prop: MapPropPlacement;
  set: (patch: Partial<MapPropPlacement>, coalesce?: string) => void;
}) {
  const on = (prop.hp ?? 0) > 0;

  return (
    <>
      <label className="row" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => set({ hp: e.target.checked ? DEFAULT_PROP_HP : undefined })}
        />
        <span>Attackable</span>
      </label>
      {on && (
        <>
          <Num
            label="HP"
            value={prop.hp ?? DEFAULT_PROP_HP}
            step={25}
            onChange={(hp) => hp > 0 && set({ hp: Math.round(hp) }, `hp:${prop.id}`)}
          />
          <div className="muted" style={{ fontSize: 11 }}>
            {prop.collider.mode === "none"
              ? "No collider — hit size falls back to body width. Give it one for a fair target."
              : `Hit radius ${propTargetRadius(prop).toFixed(2)} m, from its collider.`}
            <br />
            Refills when killed, so it works as a training dummy.
          </div>
        </>
      )}
    </>
  );
}

/**
 * Stand-in for a group selection.
 *
 * Per-field editing is deliberately absent: the fields differ by entity kind,
 * and a mixed selection has no shared shape to present. What a group is for is
 * moving, copying and deleting together, so those are what it offers.
 */
function GroupInspector({ ids }: { ids: string[] }) {
  const { doc } = useEditor();
  const has = new Set(ids);
  const props = doc.props.filter((p) => has.has(p.id)).length;
  const walls = doc.walls.filter((w) => has.has(w.id)).length;
  const elements = doc.elements.filter((e) => has.has(e.id)).length;

  const parts = [
    props && `${props} prop${props === 1 ? "" : "s"}`,
    walls && `${walls} boundar${walls === 1 ? "y" : "ies"}`,
    elements && `${elements} element${elements === 1 ? "" : "s"}`,
  ].filter(Boolean);

  // A selection is "a group" only when everything in it shares one id, which is
  // exactly the case where ungrouping is the obvious next action.
  const groups = new Set(
    [...doc.props, ...doc.walls, ...doc.elements]
      .filter((e) => has.has(e.id))
      .map((e) => e.group),
  );
  const grouped = groups.size === 1 && !groups.has(undefined);

  return (
    <div className="section">
      <h3>
        {ids.length} selected{grouped ? " (group)" : ""}
      </h3>
      <span className="muted">{parts.join(" · ")}</span>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        {grouped
          ? "Clicking any member selects the group. Alt-click to reach one piece."
          : "Drag the gizmo to move them together. Shift-click to add or remove one."}
      </div>
      {grouped ? (
        <button style={{ marginTop: 8, width: "100%" }} onClick={() => ungroupSelected()}>
          Ungroup (Ctrl+Alt+G)
        </button>
      ) : (
        <button
          style={{ marginTop: 8, width: "100%" }}
          title="Bind these into one selection that moves as a unit"
          onClick={() => groupSelected()}
        >
          Group (Ctrl+G)
        </button>
      )}
      <DuplicateButton />
      <button
        style={{ marginTop: 8, width: "100%", borderColor: "var(--danger)", color: "var(--danger)" }}
        onClick={() => deleteSelected()}
      >
        Delete all (Del)
      </button>
    </div>
  );
}

export function Inspector() {
  const { doc, selectedId, selectedIds } = useEditor();
  const { index } = usePropIndex();
  const prop = doc.props.find((p) => p.id === selectedId);
  const wall = doc.walls.find((w) => w.id === selectedId);
  const element = doc.elements.find((e) => e.id === selectedId);

  if (selectedIds.length > 1) return <GroupInspector ids={selectedIds} />;
  if (wall) return <WallInspector wall={wall} />;
  if (element) return <ElementInspector el={element} />;

  if (!prop) {
    return (
      <div className="section">
        <h3>Inspector</h3>
        <span className="muted">Nothing selected.</span>
      </div>
    );
  }

  const entry = index?.byKey.get(prop.prop);
  const set = (patch: Partial<MapPropPlacement>, coalesce?: string) =>
    docStore.edit((d) => {
      const p = d.props.find((x) => x.id === prop.id);
      if (p) Object.assign(p, patch);
    }, coalesce);

  return (
    <>
      <div className="section">
        <h3>{entry?.family.replace(/_/g, " ") ?? "Prop"}</h3>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {prop.id} · {prop.prop}
          {entry && (
            <>
              <br />
              {(entry.bounds.height * prop.scale).toFixed(2)} m tall
            </>
          )}
        </div>

        <Num label="X" value={prop.x} onChange={(x) => set({ x }, `move:${prop.id}`)} />
        <Num label="Y" value={prop.y} onChange={(y) => set({ y }, `move:${prop.id}`)} />
        <Num label="Z" value={prop.z} onChange={(z) => set({ z }, `move:${prop.id}`)} />
        <Num
          label="Yaw°"
          value={(prop.yaw * 180) / Math.PI}
          step={5}
          onChange={(deg) => set({ yaw: (deg * Math.PI) / 180 }, `yaw:${prop.id}`)}
        />
        <Num
          label="Pitch°"
          value={((prop.pitch ?? 0) * 180) / Math.PI}
          step={5}
          onChange={(deg) => set({ pitch: (deg * Math.PI) / 180 }, `pitch:${prop.id}`)}
        />
        <Num
          label="Roll°"
          value={((prop.roll ?? 0) * 180) / Math.PI}
          step={5}
          onChange={(deg) => set({ roll: (deg * Math.PI) / 180 }, `roll:${prop.id}`)}
        />
        {(prop.pitch || prop.roll) && (
          <button style={{ width: "100%" }} onClick={() => set({ pitch: 0, roll: 0 })}>
            Stand upright
          </button>
        )}
        <Num
          label="Scale"
          value={prop.scale}
          step={0.05}
          onChange={(scale) => scale > 0 && set({ scale }, `scale:${prop.id}`)}
        />

        <AttackableFields prop={prop} set={set} />

        <DuplicateButton />
        <button
          style={{ marginTop: 8, width: "100%", borderColor: "var(--danger)", color: "var(--danger)" }}
          onClick={() => {
            docStore.edit((d) => {
              d.props = d.props.filter((p) => p.id !== prop.id);
            });
            docStore.setUi({ selectedId: null });
          }}
        >
          Delete (Del)
        </button>
      </div>

      <ColliderEditor prop={prop} />
    </>
  );
}
