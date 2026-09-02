import {
  DEFAULT_GROUND_LAYERS,
  groundMaterialsByGroup,
  groundResFor,
  MAX_GROUND_HEIGHT_SCALE,
  MAX_GROUND_LAYERS,
  type MapGround,
} from "@battlebeasts/shared";
import { useState } from "react";
import { docStore, useEditor } from "../state/docStore";
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

export function GroundPanel() {
  const { doc } = useEditor();
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

      <label style={{ marginTop: 6, display: "block" }}>Materials</label>
      {Array.from({ length: MAX_GROUND_LAYERS }, (_, i) => (
        <div className="row" key={i}>
          <label style={{ width: 18 }}>{i + 1}</label>
          <select
            value={g.layers[i] ?? ""}
            onChange={(e) => {
              const layers = [...g.layers];
              while (layers.length < MAX_GROUND_LAYERS) layers.push(DEFAULT_GROUND_LAYERS[layers.length]!);
              layers[i] = e.target.value;
              setGround({ ...g, layers });
            }}
            style={{ flex: 1 }}
          >
            {groundMaterialsByGroup().map(({ group, items }) => (
              <optgroup key={group} label={group}>
                {items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      ))}

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
