/**
 * Sky presets extracted from the SICS packs.
 *
 * Data-only, like the ground library: the server can import this module
 * without pulling in a renderer. `scripts/import-sics-skies.py` regenerates
 * the list.
 */

import { SKYBOXES, type SkyboxDef } from "./skies.generated";

export { SKYBOXES, type SkyboxDef };

const BY_ID = new Map(SKYBOXES.map((sky) => [sky.id, sky]));

export function skyboxById(id: string | undefined): SkyboxDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Packs in catalog order, each with its skies. */
export function skyboxesByPack(): { pack: string; items: SkyboxDef[] }[] {
  const groups: { pack: string; items: SkyboxDef[] }[] = [];
  for (const sky of SKYBOXES) {
    const last = groups[groups.length - 1];
    if (last && last.pack === sky.pack) last.items.push(sky);
    else groups.push({ pack: sky.pack, items: [sky] });
  }
  return groups;
}
