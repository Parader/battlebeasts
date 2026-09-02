import { useEffect, useMemo, useState } from "react";
import { docStore, useEditor } from "../state/docStore";
import { CATEGORY_LABELS, CATEGORY_ORDER, categorize } from "./categories";
import { propDisplayName, searchProps, usePropIndex, type PropEntry } from "./manifest";
import { colliderOverrides } from "./overrides";
import { unusable, useUnusableVersion } from "./unusable";

/**
 * Prop palette: a two-level accordion of Category > Family, with variants as
 * chips inside a family.
 *
 * A flat list is unusable at this size (3800+ props in 900+ families), and
 * biome alone does not help -- `kingdom` is 578 families on its own. Searching
 * auto-expands whatever matched, so the tree never hides a hit.
 */

function dims(p: PropEntry): string {
  const { height, baseHx, baseHz } = p.bounds;
  return `${height.toFixed(1)} m tall · ${(baseHx * 2).toFixed(1)}×${(baseHz * 2).toFixed(1)} base`;
}

function colliderBadge(p: PropEntry): { text: string; color: string } {
  switch (p.defaultCollider.mode) {
    case "circle":
      return { text: `◯ ${p.defaultCollider.radius.toFixed(2)}`, color: "var(--ok)" };
    case "box":
      return { text: `▭ ${p.defaultCollider.halfX.toFixed(2)}×${p.defaultCollider.halfZ.toFixed(2)}`, color: "var(--ok)" };
    default:
      return { text: "no collision", color: "var(--muted)" };
  }
}

type Tree = Array<{
  id: string;
  label: string;
  count: number;
  families: Array<{ key: string; family: PropEntry[] }>;
}>;

export function Palette() {
  const { index, error } = usePropIndex();
  const { brushProp, tool } = useEditor();
  const marksVersion = useUnusableVersion();
  const [query, setQuery] = useState("");
  const [biome, setBiome] = useState<string | null>(null);
  const [showUnusable, setShowUnusable] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openFams, setOpenFams] = useState<Set<string>>(new Set());

  useEffect(() => {
    void unusable.load();
    // Loaded here rather than at first use: a placement made before the
    // corrections arrive would silently get the fitted default instead.
    void colliderOverrides.load();
  }, []);

  const tree: Tree = useMemo(() => {
    if (!index) return [];
    const all = searchProps(index, query, biome);
    const hits = showUnusable ? all : all.filter((p) => !unusable.has(p.key));

    // category -> "biome/Family" -> variants
    const byCat = new Map<string, Map<string, PropEntry[]>>();
    for (const p of hits) {
      const cat = categorize(p.family);
      const famKey = `${p.biome}/${p.family}`;
      const fams = byCat.get(cat) ?? byCat.set(cat, new Map()).get(cat)!;
      const list = fams.get(famKey);
      if (list) list.push(p);
      else fams.set(famKey, [p]);
    }

    return CATEGORY_ORDER.filter((id) => byCat.has(id)).map((id) => {
      const fams = byCat.get(id)!;
      let count = 0;
      for (const list of fams.values()) {
        list.sort((a, b) => a.variant - b.variant);
        count += list.length;
      }
      return {
        id,
        label: CATEGORY_LABELS.get(id) ?? id,
        count,
        families: [...fams.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, family]) => ({ key, family })),
      };
    });
  }, [index, query, biome, showUnusable, marksVersion]);

  const searching = query.trim().length > 0;
  // While searching, show everything that matched rather than making the user
  // expand a tree to discover whether their term hit anything.
  /*
   * Category and family revealed by arrow-key cycling.
   *
   * Kept apart from the manually opened sets rather than written into them, so
   * stepping onto a family reveals it and stepping off closes it again without
   * disturbing whatever the user expanded by hand. Any manual toggle clears
   * it, so clicking always wins over the automatic reveal.
   */
  const [autoOpen, setAutoOpen] = useState<{ cat: string; fam: string } | null>(null);

  const isCatOpen = (id: string) => searching || openCats.has(id) || autoOpen?.cat === id;
  const isFamOpen = (key: string) => openFams.has(key) || autoOpen?.fam === key;

  const toggle = (set: Set<string>, id: string, apply: (s: Set<string>) => void) => {
    setAutoOpen(null);
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    apply(next);
  };

  const arm = (key: string) => docStore.setUi({ brushProp: key, tool: "place" });

  // Flattened in display order, so the arrow keys walk exactly what is on
  // screen -- current search and biome filter included.
  const ordered = useMemo(
    () => tree.flatMap((c) => c.families.flatMap((f) => f.family.map((p) => p.key))),
    [tree],
  );

  /*
   * Left/right cycle the armed prop, for quickly comparing similar models.
   * Scoped to the place tool so the other tools keep the arrow keys, and it
   * pairs with search: narrow to "barrel", then flick through the matches.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (tool !== "place" || !ordered.length) return;

      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      const at = brushProp ? ordered.indexOf(brushProp) : -1;
      // Wraps; nothing armed (or armed something now filtered out) enters the
      // list from whichever end you came from.
      const next =
        at < 0
          ? step > 0
            ? 0
            : ordered.length - 1
          : (at + step + ordered.length) % ordered.length;
      const key = ordered[next]!;
      arm(key);

      // Reveal where we landed, so the highlighted variant is actually on
      // screen. Replacing the value closes whatever the last step opened.
      const entry = index?.byKey.get(key);
      if (entry) {
        setAutoOpen({ cat: categorize(entry.family), fam: `${entry.biome}/${entry.family}` });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, brushProp, tool, index]);

  if (error) return <div className="banner error">{error}</div>;
  if (!index) {
    return (
      <div className="section">
        <span className="muted">Loading prop manifest…</span>
      </div>
    );
  }

  const total = tree.reduce((n, c) => n + c.count, 0);

  return (
    <>
      <div className="section">
        <h3>Palette</h3>
        <div className="row">
          <input placeholder="Search props…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="row">
          <select value={biome ?? ""} onChange={(e) => setBiome(e.target.value || null)}>
            <option value="">All biomes ({index.all.length})</option>
            {index.biomes.map((b) => (
              <option key={b} value={b}>
                {b} ({index.all.filter((p) => p.biome === b).length})
              </option>
            ))}
          </select>
        </div>
        <label className="check" style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={showUnusable}
            onChange={(e) => setShowUnusable(e.target.checked)}
          />
          Show unusable ({unusable.size})
        </label>

        <div className="muted" style={{ fontSize: 11, display: "flex", gap: 6 }}>
          <span>
            {total} props · {tree.length} categories
          </span>
          <span className="spacer" />
          {!searching && openCats.size > 0 && (
            <button
              style={{ padding: "1px 6px", fontSize: 10 }}
              onClick={() => {
                setOpenCats(new Set());
                setOpenFams(new Set());
              }}
            >
              collapse all
            </button>
          )}
        </div>
        {brushProp && tool === "place" && (
          <div style={{ fontSize: 11, marginTop: 6 }}>
            armed:{" "}
            <span style={{ color: "var(--accent)" }}>
              {index.byKey.get(brushProp) ? propDisplayName(index.byKey.get(brushProp)!) : brushProp}
            </span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {tree.map((cat) => {
          const open = isCatOpen(cat.id);
          return (
            <div key={cat.id}>
              <button
                className="tree-row tree-cat"
                onClick={() => toggle(openCats, cat.id, setOpenCats)}
              >
                <span className="caret">{open ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 600 }}>{cat.label}</span>
                <span className="spacer" />
                <span className="muted" style={{ fontSize: 10 }}>
                  {cat.count}
                </span>
              </button>

              {open &&
                cat.families.map(({ key, family }) => {
                  const first = family[0]!;
                  const famOpen = isFamOpen(key);
                  const badge = colliderBadge(first);
                  const single = family.length === 1;
                  const famKeys = family.map((v) => v.key);
                  const allMarked = famKeys.every((k) => unusable.has(k));
                  return (
                    <div key={key}>
                      <div className={`tree-row tree-fam${allMarked ? " tree-row--unusable" : ""}`}>
                        <button
                          className="tree-row__main"
                          onClick={() =>
                            single ? arm(first.key) : toggle(openFams, key, setOpenFams)
                          }
                          title={single ? `${first.key}\n${dims(first)}` : undefined}
                        >
                          <span className="caret">{single ? "·" : famOpen ? "▾" : "▸"}</span>
                          <span
                            style={{
                              color: brushProp === first.key && single ? "var(--accent)" : undefined,
                            }}
                          >
                            {propDisplayName(first)}
                          </span>
                          {!single && (
                            <span className="muted" style={{ fontSize: 10 }}>
                              ×{family.length}
                            </span>
                          )}
                          <span className="spacer" />
                          <span style={{ fontSize: 10, color: badge.color }}>{badge.text}</span>
                        </button>
                        <button
                          className="mark-btn"
                          title={
                            allMarked
                              ? `Restore ${single ? "this prop" : "all variants"}`
                              : `Mark ${single ? "this prop" : "all variants"} unusable`
                          }
                          onClick={() => unusable.set(famKeys, !allMarked)}
                        >
                          {allMarked ? "↺" : "⊘"}
                        </button>
                      </div>

                      {famOpen && !single && (
                        <div className="variant-strip">
                          <div className="muted" style={{ fontSize: 10, width: "100%", marginBottom: 2 }}>
                            {first.biome} · {dims(first)} · alt-click a variant to mark it unusable
                          </div>
                          {family.map((v) => {
                            const marked = unusable.has(v.key);
                            return (
                              <button
                                key={v.key}
                                className={[
                                  brushProp === v.key ? "active" : "",
                                  marked ? "chip--unusable" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                // Alt-click marks rather than arms: variants are
                                // numbered chips with no room for a second button.
                                onClick={(e) => {
                                  if (e.altKey) unusable.toggle(v.key);
                                  else arm(v.key);
                                }}
                                title={`${v.key}\n${dims(v)}${marked ? "\nMarked unusable" : ""}`}
                                style={{ padding: "2px 8px", fontSize: 11 }}
                              >
                                {v.variant}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}

        {!tree.length && (
          <div className="section">
            <span className="muted">No props match “{query}”.</span>
          </div>
        )}
      </div>
    </>
  );
}
