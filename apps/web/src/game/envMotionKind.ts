/** Which pack prop should move, based on its library key and material name. */

export type EnvMotionKind = "falls" | "water" | "fire" | "cloth" | "foliage";

export type ParticleKind = "sparks" | "mist";

/** Campfires throw sparks. Waterfalls throw mist. Everything else is still. */
export function particleKind(propKey: string): ParticleKind | null {
  const prop = propKey.toLowerCase();
  if (/camp_?fire|torch/.test(prop)) return "sparks";
  if (/waterfall/.test(prop) && !/lily|plant|vegetation/.test(prop)) return "mist";
  return null;
}

const SHEET = /ripple|foam|splash|stream|water[_ ]?disk|water_1/;

/** Tree cards, including palms. Does not match a street lamp. */
export function isTreeProp(propKey: string): boolean {
  return /\btree/.test(propKey.toLowerCase());
}

/**
 * These kits store a wind mask in vertex color: a few tips are bright green
 * and every other vertex is black. Multiplying that mask paints the atlas
 * black. Trees already drop it. Grass and the other ground plants use the
 * same mask and need the same treatment. A real tint, and water crests, stay.
 */
export function vertexColorIsWindMask(propKey: string): boolean {
  const prop = propKey.toLowerCase();
  if (/pot|plot|plantation/.test(prop)) return false;
  if (/waterfall|water[_ ]?ripple|water[_ ]?disk/.test(prop) && !/lily|plant|vegetation/.test(prop)) return false;
  if (isTreeProp(propKey)) return true;
  return /grass|leaves|leaf|fern|flower|vine|bush|palm|foliage|plant/.test(prop);
}

/**
 * Water, fire, cloth, and foliage from the kits. Matched on the prop key first
 * so a cloth atlas used on a wooden wall does not start waving.
 *
 * Waterfall and ripple meshes use a toon water color. Their UVs were
 * authored for that shader, not for a slot on the pack atlas.
 */
export function envMotionKind(propKey: string, materialName = "", meshName = ""): EnvMotionKind | null {
  const prop = propKey.toLowerCase();
  const label = `${materialName} ${meshName}`.toLowerCase();

  const waterShape = /waterfall|water[_ ]?ripple|water[_ ]?disk/.test(prop);
  if (waterShape && !/lily|plant|tank|underwater|vegetation/.test(prop)) {
    if (SHEET.test(label)) return /waterfall/.test(prop) ? "falls" : "water";
    if (/waterfall/.test(label)) return "falls";
    if (/water[_ ]?ripple|water[_ ]?disk/.test(prop)) return "water";
    return null;
  }

  // Campfires are one mesh: logs and flame share the atlas. The flame is
  // picked out in the shader from the texel color, not from a second material.
  if (/camp_?fire|torch/.test(prop)) return "fire";

  // Flag poles are the same mesh as the cloth. The wave grows with distance
  // from the pole, so the name "pole" must not drop the whole prop.
  if (/flag|banner|sail/.test(prop)) return "cloth";

  // `\btree` matches Tree_01 and Palm_Tree. It does not match "street".
  // A trunk on the pack atlas stays still. Only the leaf card gets the lift,
  // because that lift is what stops a dark vegetation sheet reading as black.
  // A dry tree is bare wood. The leaf wave would bend the dead crown.
  if (/\btree/.test(prop) && /\bdry\b/.test(prop)) return null;
  if (/grass|leaves|leaf|fern|flower|vine|bush|palm|foliage|plant|\btree/.test(prop) && !/pot|plot|plantation/.test(prop)) {
    if (/\btree/.test(prop)) {
      const leaf = /vegetation|leaf|leaves|palm|fern|grass|flower|foliage|tree|pine|bush/;
      if (materialName && !leaf.test(materialName.toLowerCase())) return null;
    }
    return "foliage";
  }

  if (SHEET.test(label)) return /waterfall/.test(label) ? "falls" : "water";

  return null;
}
