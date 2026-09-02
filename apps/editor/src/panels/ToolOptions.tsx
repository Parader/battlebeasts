import {
  ELEMENT_GROUPS,
  ELEMENT_TYPES,
  elementType,
  groundMaterial,
  MAX_GROUND_LAYERS,
  paramString,
  type MapTeam,
} from "@battlebeasts/shared";
import { TEAM_COLOR } from "../scene/Elements";
import { docStore, setElementType, useEditor } from "../state/docStore";
import type { BrushMode } from "../state/terrain";
import { ParamFields } from "./ElementParams";

/**
 * What the next placed prop will do about collision.
 *
 * Only rendered once a choice has been carried forward. Sticky state that
 * silently overrides each model's fitted collider would be maddening to debug
 * from the map alone, so while it is in effect it says so and offers a way
 * back to per-model fitting.
 */
function PlaceOptions() {
  const { stickyCollider } = useEditor();
  if (!stickyCollider) return null;

  const { mode, blocksProjectiles } = stickyCollider;
  return (
    <div className="section">
      <h3>New props</h3>
      <div className="muted" style={{ fontSize: 11 }}>
        {mode === "none"
          ? "Placed with no collision."
          : `Placed as ${mode}, sized to each model` +
            (blocksProjectiles ? "." : ", low cover.")}
      </div>
      <button
        style={{ marginTop: 6, width: "100%" }}
        onClick={() => docStore.setUi({ stickyCollider: null })}
      >
        Use each model's fitted default
      </button>
    </div>
  );
}

/**
 * Settings for whichever placement tool is active. Shown above the palette so
 * the thing you are about to place is configured in the same place you click
 * to place it.
 */
export function ToolOptions() {
  const { tool, doc, elementType: typeId, elementParams } = useEditor();

  if (tool === "paint") return <PaintOptions />;
  if (tool === "place") return <PlaceOptions />;
  if (tool !== "element") return null;

  const def = elementType(typeId);

  return (
    <div className="section">
      <h3>Element</h3>

      <div className="row">
        <label>Type</label>
        <select value={typeId} onChange={(e) => setElementType(e.target.value)}>
          {ELEMENT_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {ELEMENT_TYPES.filter((t) => t.group === group).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {def && (
        <ParamFields
          def={def}
          params={elementParams}
          onChange={(key, value) =>
            docStore.setUi({ elementParams: { ...elementParams, [key]: value } })
          }
        />
      )}

      {/* Team spawn counts, the one thing worth surfacing without selecting. */}
      {typeId === "player_spawn" && (
        <div className="toolbar" style={{ marginTop: 6 }}>
          {(["a", "b", "c"] as const).map((team) => {
            const n = doc.elements.filter(
              (e) => e.type === "player_spawn" && paramString(e, "team", "a") === team,
            ).length;
            const active = elementParams.team === team;
            return (
              <button
                key={team}
                className={active ? "active" : undefined}
                onClick={() =>
                  docStore.setUi({ elementParams: { ...elementParams, team: team as MapTeam } })
                }
                style={
                  active
                    ? { background: TEAM_COLOR[team], borderColor: TEAM_COLOR[team] }
                    : { borderColor: TEAM_COLOR[team] }
                }
              >
                {team.toUpperCase()} ({n})
              </button>
            );
          })}
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Click the ground to place. Facing defaults toward the middle of the map and is
        editable after.
      </div>
    </div>
  );
}

const BRUSH_MODES: { id: BrushMode; label: string }[] = [
  { id: "paint", label: "Paint" },
  { id: "raise", label: "Raise" },
  { id: "lower", label: "Lower" },
  { id: "smooth", label: "Smooth" },
  { id: "flatten", label: "Flatten" },
];

/** Terrain brush: material painting and height sculpting share one tool. */
function PaintOptions() {
  const { doc, brush } = useEditor();
  const g = doc.ground;

  if (g.kind !== "painted") {
    return (
      <div className="section">
        <h3>Terrain</h3>
        <div className="muted" style={{ fontSize: 11 }}>
          This map uses {g.kind === "mesh" ? "a Blender mesh" : "a flat plane"}. Convert it to
          painted ground in the Map panel to paint and sculpt.
        </div>
      </div>
    );
  }

  const set = (patch: Partial<typeof brush>) => docStore.setUi({ brush: { ...brush, ...patch } });
  const sculpting = brush.mode !== "paint";

  return (
    <div className="section">
      <h3>Terrain</h3>

      <div className="toolbar">
        {BRUSH_MODES.map((m) => (
          <button
            key={m.id}
            className={brush.mode === m.id ? "active" : undefined}
            onClick={() => set({ mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {brush.mode === "paint" && (
        <div style={{ marginTop: 6 }}>
          <label>Material</label>
          <div className="toolbar">
            {g.layers.slice(0, MAX_GROUND_LAYERS).map((id, i) => {
              const mat = groundMaterial(id);
              return (
                <button
                  key={`${id}-${i}`}
                  className={brush.layer === i ? "active" : undefined}
                  onClick={() => set({ layer: i })}
                  title={mat ? mat.label : `Unknown material "${id}"`}
                >
                  {mat ? mat.label : id}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {sculpting && g.heightScale <= 0 && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Height is currently 0 m, so sculpting will not show. Raise the terrain height in the
          Map panel first.
        </div>
      )}

      {sculpting && g.heightScale > 0 && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Sculpting is capped at ±{g.heightScale.toFixed(2)} m by the Map panel&rsquo;s terrain
          height. The brush eases off as it nears the limit, so it cannot flatten into a
          plateau.
        </div>
      )}

      <Slider label="Size" value={brush.radius} min={0.5} max={20} step={0.5} suffix=" m"
        onChange={(v) => set({ radius: v })} />
      <Slider label="Strength" value={brush.strength} min={0.05} max={1} step={0.05}
        onChange={(v) => set({ strength: v })} />
      <Slider label="Softness" value={1 - brush.hardness} min={0} max={1} step={0.05}
        onChange={(v) => set({ hardness: 1 - v })} />

      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Left-drag the ground to {brush.mode === "paint" ? "paint" : "sculpt"}. Middle or
        right-drag still moves the camera. Ctrl+Z undoes a whole stroke.
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="row" style={{ marginTop: 4 }}>
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span className="muted" style={{ fontSize: 11, width: 44, textAlign: "right" }}>
        {value.toFixed(2).replace(/\.00$/, "")}
        {suffix}
      </span>
    </div>
  );
}
