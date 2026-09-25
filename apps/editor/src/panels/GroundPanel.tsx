import {
  DEFAULT_GROUND_LAYERS,
  GROUND_MATERIALS,
  GROUND_MATERIAL_GROUP_ORDER,
  groundMaterial,
  groundMaterialsByGroup,
  groundResFor,
  MAX_GROUND_HEIGHT_SCALE,
  MAX_GROUND_LAYERS,
  type MapGround,
} from "@battlebeasts/shared";
import { useEffect, useMemo, useState } from "react";
import { groundUnusable, useGroundUnusableVersion } from "../ground/unusable";
import { docStore, useEditorSlice } from "../state/docStore";
import { terrain } from "../state/terrain";

/**
 * Ground setup: extent, materials and height range.
 *
 * Separate from the brush options because these are decisions you make once
 * per map, whereas the brush changes constantly. Resolution and size are
 * destructive to painted data, so they are confirmed rather than live-edited.
 */
type Painted = Extract<MapGround, { kind: "painted" }>;

/** Nine-way anchor, as [x, z] in -1..1. Reads like the grid it draws. */
const ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [0, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Width / depth editing, with an anchor deciding which edge holds still.
 *
 * The document always keeps the ground centred on the origin, so growing a map
 * moves both edges outward. Anchoring is therefore implemented by shifting
 * everything on the map the other way -- props, walls, elements and the
 * painted terrain all move together, so from the author's point of view the
 * map simply grew in the chosen direction.
 *
 * Applied on a button rather than live, because every keystroke would
 * otherwise re-grid the terrain.
 */
function ResizeControls({ ground }: { ground: Painted }) {
  const [w, setW] = useState(String(ground.sizeX));
  const [d, setD] = useState(String(ground.sizeZ));
  const [anchor, setAnchor] = useState(4);

  const nextX = Math.max(8, Math.round(Number(w) || ground.sizeX));
  const nextZ = Math.max(8, Math.round(Number(d) || ground.sizeZ));
  const changed = nextX !== ground.sizeX || nextZ !== ground.sizeZ;
  const res = groundResFor(nextX, nextZ);

  const apply = () => {
    if (!changed) return;
    const [ax, az] = ANCHORS[anchor]!;
    const shift = { x: (ax * (nextX - ground.sizeX)) / 2, z: (az * (nextZ - ground.sizeZ)) / 2 };

    terrain.resize({ sizeX: nextX, sizeZ: nextZ, ...res }, shift);

    docStore.edit((doc) => {
      doc.ground = { ...ground, sizeX: nextX, sizeZ: nextZ, ...res };
      if (shift.x === 0 && shift.z === 0) return;
      for (const p of doc.props) {
        p.x += shift.x;
        p.z += shift.z;
      }
      for (const e of doc.elements) {
        e.x += shift.x;
        e.z += shift.z;
      }
      for (const wall of doc.walls) {
        wall.points = wall.points.map(([px, pz]) => [px + shift.x, pz + shift.z]);
      }
    });
  };

  return (
    <>
      <div className="row">
        <label>Width</label>
        <input type="number" min={8} step={1} value={w} onChange={(e) => setW(e.target.value)} />
        <label style={{ marginLeft: 6 }}>Depth</label>
        <input type="number" min={8} step={1} value={d} onChange={(e) => setD(e.target.value)} />
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <label>Grow from</label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 18px)",
            gap: 2,
          }}
        >
          {ANCHORS.map(([ax, az], i) => (
            <button
              key={`${ax},${az}`}
              type="button"
              title={anchorLabel(ax, az)}
              onClick={() => setAnchor(i)}
              style={{
                width: 18,
                height: 18,
                padding: 0,
                minWidth: 0,
                opacity: anchor === i ? 1 : 0.4,
              }}
            >
              {anchor === i ? "•" : ""}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
          {res.resX}x{res.resZ} grid
        </span>
      </div>

      <div className="row">
        <button type="button" disabled={!changed} onClick={apply}>
          {changed ? `Resize to ${nextX} x ${nextZ} m` : `${ground.sizeX} x ${ground.sizeZ} m`}
        </button>
      </div>

      {changed && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Everything on the map shifts to keep the anchored side in place. Terrain paint is
          carried over; new ground starts on the base layer. This clears terrain undo.
        </div>
      )}
    </>
  );
}

function anchorLabel(ax: number, az: number): string {
  const z = az < 0 ? "north" : az > 0 ? "south" : "";
  const x = ax < 0 ? "west" : ax > 0 ? "east" : "";
  const name = [z, x].filter(Boolean).join("-");
  return name ? `Anchor ${name}` : "Anchor centre";
}

/** Layer dropdowns + a cull list so unused textures stay out of the way. */
function MaterialPickers({ ground, onChange }: { ground: Painted; onChange: (g: Painted) => void }) {
  const marksVersion = useGroundUnusableVersion();
  const [showHidden, setShowHidden] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    void groundUnusable.load();
  }, []);

  const selectedKey = ground.layers.slice(0, MAX_GROUND_LAYERS).join("|");

  const groups = useMemo(() => {
    void marksVersion;
    const selected = new Set(selectedKey.split("|").filter(Boolean));
    const exclude = showHidden ? undefined : groundUnusable.asSet();
    const base = groundMaterialsByGroup({ excludeIds: exclude });

    // Currently-selected layers must stay in the dropdown even if hidden, or
    // the <select> value would point at a missing option.
    if (showHidden || selected.size === 0) return base;

    const byGroup = new Map(base.map((g) => [g.group, g.items.slice()]));
    for (const id of selected) {
      if (!exclude?.has(id)) continue;
      const m = groundMaterial(id);
      if (!m) continue;
      const list = byGroup.get(m.group) ?? [];
      if (!list.some((x) => x.id === id)) list.push(m);
      byGroup.set(m.group, list);
    }

    return GROUND_MATERIAL_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
      group,
      items: (byGroup.get(group) ?? []).slice().sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [marksVersion, showHidden, selectedKey]);

  return (
    <>
      <label style={{ marginTop: 6, display: "block" }}>Materials</label>
      {Array.from({ length: MAX_GROUND_LAYERS }, (_, i) => (
        <div className="row" key={i}>
          <label style={{ width: 18 }}>{i + 1}</label>
          <select
            value={gLayer(ground, i)}
            onChange={(e) => {
              const layers = [...ground.layers];
              while (layers.length < MAX_GROUND_LAYERS) layers.push(DEFAULT_GROUND_LAYERS[layers.length]!);
              layers[i] = e.target.value;
              onChange({ ...ground, layers });
            }}
            style={{ flex: 1 }}
          >
            {groups.map(({ group, items }) => (
              <optgroup key={group} label={group}>
                {items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {groundUnusable.has(m.id) ? " (hidden)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      ))}

      <div className="row" style={{ marginTop: 4, gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setManageOpen((v) => !v)}>
          {manageOpen ? "Close library" : "Manage library"}
        </button>
        {groundUnusable.size > 0 && (
          <label className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden ({groundUnusable.size})
          </label>
        )}
      </div>

      {manageOpen && <MaterialLibraryManager />}
    </>
  );
}

function gLayer(ground: Painted, i: number): string {
  return ground.layers[i] ?? "";
}

/**
 * Full catalog with hide / restore. Mirrors the prop "unusable" cull: one
 * click removes a texture from every layer dropdown without deleting files.
 */
function MaterialLibraryManager() {
  const marksVersion = useGroundUnusableVersion();
  const [query, setQuery] = useState("");
  const [onlyHidden, setOnlyHidden] = useState(false);

  void marksVersion;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groundMaterialsByGroup().map(({ group, items }) => ({
      group,
      items: items.filter((m) => {
        if (onlyHidden && !groundUnusable.has(m.id)) return false;
        if (!q) return true;
        return m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || group.toLowerCase().includes(q);
      }),
    })).filter((g) => g.items.length > 0);
  }, [query, onlyHidden, marksVersion]);

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        maxHeight: 280,
        overflow: "auto",
      }}
    >
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        Hide textures you do not want in the layer lists. Hidden ones stay available to maps that
        already use them; restore anytime. {GROUND_MATERIALS.length} in catalog, {groundUnusable.size}{" "}
        hidden.
      </div>
      <div className="row" style={{ marginBottom: 6, gap: 6 }}>
        <input
          type="search"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <label className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={onlyHidden} onChange={(e) => setOnlyHidden(e.target.checked)} />
          Hidden only
        </label>
      </div>
      {groups.map(({ group, items }) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{group}</div>
          {items.map((m) => {
            const hidden = groundUnusable.has(m.id);
            return (
              <div
                key={m.id}
                className="row"
                style={{
                  gap: 6,
                  opacity: hidden ? 0.55 : 1,
                  marginBottom: 2,
                }}
              >
                <span style={{ flex: 1, fontSize: 12 }}>{m.label}</span>
                <button
                  type="button"
                  title={hidden ? "Restore to picker" : "Hide from picker"}
                  onClick={() => groundUnusable.toggle(m.id)}
                  style={{ fontSize: 11, padding: "2px 6px", minWidth: 56 }}
                >
                  {hidden ? "Restore" : "Hide"}
                </button>
              </div>
            );
          })}
        </div>
      ))}
      {groups.length === 0 && (
        <div className="muted" style={{ fontSize: 11 }}>
          No materials match.
        </div>
      )}
    </div>
  );
}

export function GroundPanel() {
  const doc = useEditorSlice((s) => s.doc);
  const g = doc.ground;

  const setGround = (next: MapGround) => docStore.edit((d) => void (d.ground = next));

  if (g.kind !== "painted") {
    return (
      <div className="section">
        <h3>Ground</h3>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          {g.kind === "mesh"
            ? "This map uses a Blender mesh. Converting replaces it with painted terrain."
            : "This map uses a flat plane."}
        </div>
        <button
          onClick={() => {
            if (!window.confirm("Convert to painted terrain? The current ground is replaced.")) return;
            const sizeX = g.kind === "plane" ? g.sizeX : 80;
            const sizeZ = g.kind === "plane" ? g.sizeZ : 80;
            const next: MapGround = {
              kind: "painted",
              sizeX,
              sizeZ,
              ...groundResFor(sizeX, sizeZ),
              layers: [...DEFAULT_GROUND_LAYERS],
              heightScale: 0.25,
            };
            setGround(next);
            terrain.load({ ...doc, ground: next }, null, null);
          }}
        >
          Convert to painted terrain
        </button>
      </div>
    );
  }

  return (
    <div className="section">
      <h3>Ground</h3>

      <ResizeControls ground={g} />

      <MaterialPickers ground={g} onChange={setGround} />

      <div className="row" style={{ marginTop: 6 }}>
        <label>Height</label>
        <input
          type="range"
          min={0}
          max={MAX_GROUND_HEIGHT_SCALE}
          step={0.05}
          value={g.heightScale}
          onChange={(e) => setGround({ ...g, heightScale: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span className="muted" style={{ fontSize: 11, width: 44, textAlign: "right" }}>
          {g.heightScale.toFixed(2)} m
        </span>
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Height is capped at {MAX_GROUND_HEIGHT_SCALE} m on purpose. Collision is flat, so terrain
        can look uneven but must never be something you can climb or get stuck on.
      </div>
    </div>
  );
}
