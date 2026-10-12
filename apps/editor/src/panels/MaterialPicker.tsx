import {
  GROUND_MATERIAL_GROUP_ORDER,
  groundMaterial,
  groundMaterialsByGroup,
  type GroundMaterialGroup,
} from "@battlebeasts/shared";
import { useEffect, useMemo, useState } from "react";
import { groundUnusable, useGroundUnusableVersion } from "../ground/unusable";
import { terrain } from "../state/terrain";

/**
 * Pick any ground material and paint it. The swatch is the colour map itself,
 * so a toon pack and a photo scan are obvious before they hit the terrain.
 */
export function MaterialPicker({
  selected,
  onSelect,
  label = "Material",
  hint,
  touchPalette = true,
}: {
  selected: string;
  onSelect: (id: string) => void;
  label?: string;
  hint?: string;
  /** Brush picks register the material with the live shader. The base material does not. */
  touchPalette?: boolean;
}) {
  const marksVersion = useGroundUnusableVersion();
  const [group, setGroup] = useState<GroundMaterialGroup | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void groundUnusable.load();
  }, []);

  const groups = useMemo(() => {
    void marksVersion;
    const q = query.trim().toLowerCase();
    return groundMaterialsByGroup({ excludeIds: groundUnusable.asSet() })
      .filter((entry) => group === "all" || entry.group === group)
      .map((entry) => ({
        ...entry,
        items: entry.items.filter((material) => {
          if (!q) return true;
          return (
            material.label.toLowerCase().includes(q) ||
            material.id.toLowerCase().includes(q) ||
            entry.group.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [marksVersion, group, query]);

  const current = groundMaterial(selected);

  return (
    <div style={{ marginTop: 6 }}>
      <label>{label}</label>
      <div className="muted" style={{ fontSize: 11, margin: "2px 0 6px" }}>
        {current ? `${current.group} · ${current.label}. ` : ""}
        {hint ?? "A stroke blends with whatever is already showing, so a map can mix the whole library."}
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <select
          value={group}
          onChange={(event) => setGroup(event.target.value as GroundMaterialGroup | "all")}
          style={{ flex: 1 }}
        >
          <option value="all">All materials</option>
          {GROUND_MATERIAL_GROUP_ORDER.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div
        style={{
          maxHeight: 280,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {groups.map(({ group: name, items }) => (
          <div key={name}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{name}</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, 56px)",
                gap: 4,
              }}
            >
              {items.map((material) => {
                const active = material.id === selected;
                return (
                  <button
                    key={material.id}
                    type="button"
                    title={`${material.group} · ${material.label}`}
                    onClick={() => {
                      if (touchPalette) terrain.ensureMaterial(material.id);
                      onSelect(material.id);
                    }}
                    style={{
                      width: 56,
                      height: 56,
                      padding: 0,
                      minWidth: 0,
                      borderRadius: 4,
                      border: active ? "2px solid var(--accent, #d7b15a)" : "1px solid var(--line, #444)",
                      overflow: "hidden",
                      background: "#222",
                    }}
                  >
                    <img
                      src={`${import.meta.env.BASE_URL}${material.diff}`}
                      alt={material.label}
                      draggable={false}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="muted" style={{ fontSize: 11 }}>
            No materials match.
          </div>
        )}
      </div>
    </div>
  );
}
