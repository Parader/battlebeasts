/** Public plaza shards — walk-in fill, invite overfill, short display codes. */

export const PLAZA_WALK_IN_CAP = 10;
export const PLAZA_HARD_CAP = 16;

/** Colyseus filterBy key and public code prefix. `plaza-3` → display `P-3`. */
export const PLAZA_ID_PREFIX = "plaza-";

export function plazaDisplayCode(plazaId: string): string {
  const raw = plazaId.trim();
  const m = raw.match(/^(?:plaza-)?(\d+)$/i);
  if (m) return `P-${m[1]}`;
  return raw.toUpperCase().startsWith("P-") ? raw.toUpperCase() : `P-${raw}`;
}

export function parsePlazaId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const m = raw.match(/^(?:p-?|plaza-)?(\d+)$/i);
  if (m) return `${PLAZA_ID_PREFIX}${m[1]}`;
  if (/^plaza-\d+$/i.test(raw)) return raw.toLowerCase();
  return null;
}

export function nextPlazaId(existing: readonly string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = id.match(/^plaza-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${PLAZA_ID_PREFIX}${max + 1}`;
}

export type PlazaListing = {
  plazaId: string;
  code: string;
  clients: number;
  walkIns: number;
  walkInCap: number;
  maxClients: number;
  roomId: string;
};
