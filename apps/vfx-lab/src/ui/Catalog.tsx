import { ABILITIES, type AbilityDef, type AbilityShape } from "@battlebeasts/shared";
import { useState } from "react";
import { labStop } from "../sim/labDirector";
import { labStore, useLabStore } from "../state/labStore";

const SHAPES: AbilityShape[] = ["projectile", "aoe", "dash", "melee", "buff"];

const ABILITY_LIST = Object.values(ABILITIES)
  .filter((d) => d?.id && d.name)
  .sort((a, b) => a.name.localeCompare(b.name));

const EFFECT_KINDS = Array.from(
  new Set(ABILITY_LIST.map((d) => d.effectKind ?? "standard")),
).sort();

type Tip = { def: AbilityDef; top: number; left: number };

export function Catalog() {
  const abilityId = useLabStore((s) => s.abilityId);
  const search = useLabStore((s) => s.search);
  const shapeFilter = useLabStore((s) => s.shapeFilter);
  const effectKindFilter = useLabStore((s) => s.effectKindFilter);
  const [tip, setTip] = useState<Tip | null>(null);

  const showTip = (def: AbilityDef, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const maxTop = window.innerHeight - 140;
    setTip({
      def,
      top: Math.max(8, Math.min(maxTop, r.top)),
      left: r.right + 8,
    });
  };
  const q = search.trim().toLowerCase();
  const rows = ABILITY_LIST.filter((d) => {
    if (shapeFilter && d.shape !== shapeFilter) return false;
    if (effectKindFilter && (d.effectKind ?? "standard") !== effectKindFilter) return false;
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q) ||
      (d.effectKind ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="left">
      <div className="section">
        <h3>Spells</h3>
        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => labStore.set({ search: e.target.value })}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <label>Shape</label>
          <select
            value={shapeFilter}
            onChange={(e) => labStore.set({ shapeFilter: e.target.value })}
          >
            <option value="">All</option>
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <label>Kind</label>
          <select
            value={effectKindFilter}
            onChange={(e) => labStore.set({ effectKindFilter: e.target.value })}
          >
            <option value="">All</option>
            {EFFECT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="catalog-list">
        {rows.map((d) => (
          <button
            key={d.id}
            className={`tree-row ${d.id === abilityId ? "current" : ""}`}
            onPointerEnter={(e) => showTip(d, e.currentTarget)}
            onPointerLeave={() => setTip(null)}
            onFocus={(e) => showTip(d, e.currentTarget)}
            onBlur={() => setTip(null)}
            onClick={() => {
              if (d.id === abilityId) return;
              labStop();
              labStore.set({ abilityId: d.id, timing: {} });
            }}
          >
            <span className="catalog-name">{d.name}</span>
            <span className="catalog-meta">{d.effectKind && d.effectKind !== "standard" ? d.effectKind : d.shape}</span>
          </button>
        ))}
      </div>
      {tip ? (
        <div className="catalog-tip" style={{ top: tip.top, left: tip.left }}>
          <div className="catalog-tip__name">{tip.def.name}</div>
          <div className="catalog-tip__meta">
            {tip.def.shape}
            {tip.def.effectKind && tip.def.effectKind !== "standard" ? ` · ${tip.def.effectKind}` : ""}
          </div>
          <div className="catalog-tip__body">
            {tip.def.description?.trim() || "No description."}
          </div>
        </div>
      ) : null}
    </div>
  );
}
