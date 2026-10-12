import {
  GROUND_MATERIALS,
  groundMaterial,
  groundMaterialsByGroup,
  groundResFor,
  groundTileLayout,
  MAX_GROUND_HEIGHT_SCALE,
  MAX_ZONE_M,
  paintedBaseId,
  type MapGround,
} from "@battlebeasts/shared";
import { useEffect, useMemo, useState } from "react";
import { groundUnusable, useGroundUnusableVersion } from "../ground/unusable";
import { docStore, useEditorSlice } from "../state/docStore";
import { terrain } from "../state/terrain";
import { MaterialPicker } from "./MaterialPicker";

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

  const nextX = Math.max(8, Math.min(MAX_ZONE_M, Math.round(Number(w) || ground.sizeX)));
  const nextZ = Math.max(8, Math.min(MAX_ZONE_M, Math.round(Number(d) || ground.sizeZ)));
  const changed = nextX !== ground.sizeX || nextZ !== ground.sizeZ;
  const layout = groundTileLayout(nextX, nextZ);

  const apply = () => {
    if (!changed) return;
    const [ax, az] = ANCHORS[anchor]!;
    const shift = { x: (ax * (nextX - ground.sizeX)) / 2, z: (az * (nextZ - ground.sizeZ)) / 2 };

    terrain.resize(
      {
        sizeX: nextX,
        sizeZ: nextZ,
        resX: layout.resX,
        resZ: layout.resZ,
        tilesX: layout.tilesX,
        tilesZ: layout.tilesZ,
      },
      shift,
    );

    docStore.edit((doc) => {
      const { tilesX: _tilesX, tilesZ: _tilesZ, ...rest } = ground;
      doc.ground = {
        ...rest,
        sizeX: nextX,
        sizeZ: nextZ,
        resX: layout.resX,
        resZ: layout.resZ,
        ...(layout.tiled ? { tilesX: layout.tilesX, tilesZ: layout.tilesZ } : {}),
      };
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
          {layout.tiled
            ? `${layout.tilesX}×${layout.tilesZ} tiles, ${layout.resX}×${layout.resZ} each`
            : `${layout.resX}x${layout.resZ} grid`}
        </span>
      </div>

      <div className="row">
        <button type="button" disabled={!changed} onClick={apply}>
          {changed ? `Resize to ${nextX} x ${nextZ} m` : `${ground.sizeX} x ${ground.sizeZ} m`}
        </button>
      </div>

      {changed && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Everything on the map shifts to keep the anchored side in place. Painted tiles are
          carried over; new ground stays the base material and is not stored until you paint
          it. This clears terrain undo.
          {layout.tiled
            ? " Past 160 m the ground is stored as tiles, so paint stays sharp and the game only draws the area around you."
            : ""}
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

/** Library cull, so unused textures stay out of the paint picker. */
function MaterialPickers() {
  const [manageOpen, setManageOpen] = useState(false);

  useEffect(() => {
    void groundUnusable.load();
  }, []);

  return (
    <>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Pick a material on the Terrain brush and paint it. Each spot blends that material with
        whatever is already there, so a transition can use more than four.
      </div>
      <div className="row" style={{ marginTop: 4, gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setManageOpen((v) => !v)}>
          {manageOpen ? "Close library" : "Manage library"}
        </button>
      </div>
      {manageOpen && <MaterialLibraryManager />}
    </>
  );
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
        Hide textures you do not want in the paint picker. Hidden ones stay available to maps that
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
                <img
                  src={`${import.meta.env.BASE_URL}${m.diff}`}
                  alt=""
                  style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 2, flex: "none" }}
                />
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
            const base = g.kind === "plane" && groundMaterial(g.material) ? g.material : "grass";
            const next: MapGround = {
              kind: "painted",
              sizeX,
              sizeZ,
              ...groundResFor(sizeX, sizeZ),
              base,
              layers: [base],
              paint: "index",
              heightScale: 0.25,
            };
            setGround(next);
            terrain.load({ ...doc, ground: next });
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

      <MaterialPicker
        label="Base material"
        selected={paintedBaseId(g)}
        touchPalette={false}
        hint="Unpainted ground uses this, and it is not stored per texel. A large map stays light until a brush touches it. Changing it recolors only ground that still shows the old base."
        onSelect={(id) => {
          terrain.setBase(id);
          setGround({ ...g, base: id });
        }}
      />

      <MaterialPickers />

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
