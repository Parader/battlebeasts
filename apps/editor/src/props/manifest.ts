import { useEffect, useState } from "react";

/** Offset of the collider from the model's centre, in prop-local metres. */
type ColliderOffset = { offsetX?: number; offsetZ?: number };

export type PropCollider =
  | { mode: "none" }
  | ({ mode: "circle"; radius: number } & ColliderOffset)
  | ({ mode: "box"; halfX: number; halfZ: number; yaw: number } & ColliderOffset);

export type PropEntry = {
  key: string;
  url: string;
  biome: string;
  family: string;
  label: string;
  variant: number;
  bounds: {
    /** Full-model half extents and height, in metres. */
    hx: number;
    hz: number;
    height: number;
    /** Distance from the model origin down to its lowest vertex. */
    baseY: number;
    /** Half extents of the base slice -- the trunk, not the canopy. */
    baseHx: number;
    baseHz: number;
    /**
     * Offset from the origin to the centre of the whole model. Nonzero for
     * models not built around their own pivot, which is common in kit assets;
     * a few hundred still carry their position from the authoring level and
     * read as hundreds of metres here.
     */
    centreX?: number;
    centreZ?: number;
    /** Centre of the base slice, from the same origin. */
    baseCx?: number;
    baseCz?: number;
  };
  defaultCollider: PropCollider;
  hidden: boolean;
};

export type PropManifest = {
  version: number;
  generatedAt: string;
  sourceHash: string;
  props: PropEntry[];
};

export type PropIndex = {
  all: PropEntry[];
  byKey: Map<string, PropEntry>;
  biomes: string[];
  /** `biome/family` -> variants, sorted by variant number. */
  families: Map<string, PropEntry[]>;
};

function buildIndex(manifest: PropManifest): PropIndex {
  const all = manifest.props.filter((p) => !p.hidden);
  const byKey = new Map(manifest.props.map((p) => [p.key, p]));
  const families = new Map<string, PropEntry[]>();
  for (const p of all) {
    const id = `${p.biome}/${p.family}`;
    const list = families.get(id);
    if (list) list.push(p);
    else families.set(id, [p]);
  }
  for (const list of families.values()) list.sort((a, b) => a.variant - b.variant);
  const biomes = [...new Set(all.map((p) => p.biome))].sort();
  return { all, byKey, biomes, families };
}

let cache: Promise<PropIndex> | null = null;

export function loadPropIndex(): Promise<PropIndex> {
  cache ??= fetch("/api/props")
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `props manifest request failed (${res.status})`);
      }
      return buildIndex(await res.json());
    })
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}

export function usePropIndex(): { index: PropIndex | null; error: string | null } {
  const [index, setIndex] = useState<PropIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadPropIndex().then(
      (i) => alive && setIndex(i),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { index, error };
}

/** Name shown in the palette — uses the manifest label when set. */
export function propDisplayName(p: PropEntry): string {
  return p.label?.trim() || p.family.replace(/_/g, " ");
}

/** Ranks search hits so an exact family match beats an incidental substring. */
export function searchProps(index: PropIndex, query: string, biome: string | null): PropEntry[] {
  const pool = biome ? index.all.filter((p) => p.biome === biome) : index.all;
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const terms = q.split(/\s+/);
  const scored: Array<{ p: PropEntry; score: number }> = [];
  for (const p of pool) {
    const hay = `${p.biome} ${p.family} ${p.label}`.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const at = hay.indexOf(t);
      if (at < 0) {
        ok = false;
        break;
      }
      if (p.family.toLowerCase() === t) score += 100;
      else if (p.family.toLowerCase().startsWith(t)) score += 50;
      else score += Math.max(0, 20 - at);
    }
    if (ok) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.key.localeCompare(b.p.key));
  return scored.map((s) => s.p);
}
