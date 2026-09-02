import { parseMapDoc, validateMapDoc, type MapDoc, type MapWarning } from "@battlebeasts/shared";
import type { SidecarPayload } from "../state/terrain";

/** Public URLs the runtime loads painted-ground sidecars from. */
export const splatUrlFor = (id: string) => `assets/maps/${id}.splat.png`;
export const heightUrlFor = (id: string) => `assets/maps/${id}.height.png`;

export type MapListEntry = { id: string; name: string };

/**
 * Turn a display name into a map id: "Village Square" -> "village_square".
 *
 * Must agree with `SAFE_ID` in the editor API and in `gen-map-index.mjs`, since
 * the id ends up as both a filename and a generated identifier. Accents are
 * stripped rather than dropped, so "Forêt" becomes "foret" and not "for_t".
 *
 * Returns "" for a name with nothing usable in it; callers report that rather
 * than inventing an id.
 */
export function slugifyMapId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    // A leading digit is fine, a leading separator is not.
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

async function asJson(res: Response): Promise<unknown> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

export async function listMaps(): Promise<MapListEntry[]> {
  return (await asJson(await fetch("/api/maps"))) as MapListEntry[];
}

/** Loads and parses a map, surfacing recoverable parse problems to the caller. */
export async function loadMap(id: string): Promise<{ doc: MapDoc; errors: string[] }> {
  const raw = await asJson(await fetch(`/api/maps/${encodeURIComponent(id)}`));
  const { doc, errors } = parseMapDoc(raw);
  if (!doc) throw new Error(`"${id}" could not be parsed: ${errors.join("; ")}`);
  return { doc, errors };
}

export type SaveResult = { written: string[]; warnings: MapWarning[]; indexError?: string | null };

/** Removes a map document and its sidecars. Used by rename's second half. */
export async function deleteMap(id: string): Promise<void> {
  await asJson(await fetch(`/api/maps/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

/**
 * Saves the document. Validation warnings are returned rather than thrown --
 * a half-finished map should still be saveable, you just want to know.
 */
export async function saveMap(
  doc: MapDoc,
  sidecars?: { splat?: SidecarPayload; height?: SidecarPayload },
): Promise<SaveResult> {
  const warnings = validateMapDoc(doc).filter((w) => !w.suppressed);
  const body = await asJson(
    await fetch(`/api/maps/${encodeURIComponent(doc.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc, ...sidecars }),
    }),
  );
  const { written, indexError } = body as { written?: string[]; indexError?: string | null };
  return { written: written ?? [], warnings, indexError };
}
