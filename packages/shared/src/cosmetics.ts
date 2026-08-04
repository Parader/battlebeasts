/** Wearable cosmetics — meshes embedded in hero.glb, hidden until equipped. */

export const COSMETIC_SLOTS = [
  "hat",
  "shoulders",
  "chest",
  "gloves",
  "belt",
  "legs",
  "shoes",
] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/**
 * Object/mesh names treated as wearable gear inside hero.glb.
 * Prefer `cosmetic_<id>` for new pieces; existing names can be listed via meshName(s).
 */
export const COSMETIC_MESH_PREFIX = "cosmetic_";

export type CosmeticItemDef = {
  id: string;
  slot: CosmeticSlot;
  name: string;
  /**
   * Exact object or mesh name in hero.glb (case-insensitive).
   * Defaults to `cosmetic_${id}` when omitted and meshNames is empty.
   */
  meshName?: string;
  /**
   * Multiple object names that make up one gear item (e.g. L/R shoulder pads).
   * When set, takes precedence over meshName.
   */
  meshNames?: string[];
};

export type CosmeticsEquipped = Partial<Record<CosmeticSlot, string | null>>;

/**
 * Add items as you parent them under the Mixamo skeleton in hero.glb.
 * Hidden by default; shown when that catalog id is equipped.
 */
export const COSMETIC_CATALOG: Record<string, CosmeticItemDef> = {
  hat_wizard: {
    id: "hat_wizard",
    slot: "hat",
    name: "Wizard Hat",
    meshName: "WizardHat",
  },
  shoulders_set_1: {
    id: "shoulders_set_1",
    slot: "shoulders",
    name: "Shoulder Set 1",
    meshNames: ["Shoulder set 1 - 1", "Shoulder set 1 - 2"],
  },
  chest_set_1: {
    id: "chest_set_1",
    slot: "chest",
    name: "Chest Set 1",
    meshName: "Chest Set 1",
  },
  /**
   * Boots → Set 1: one skinned mesh per foot.
   */
  shoes_set_1: {
    id: "shoes_set_1",
    slot: "shoes",
    name: "Boot Set 1",
    meshNames: ["Boot1", "Boot2"],
  },
  /**
   * Bracers → Set 1: single skinned mesh covering both forearms.
   */
  bracers_set_1: {
    id: "bracers_set_1",
    slot: "gloves",
    name: "Bracer Set 1",
    meshName: "Bracers set 1",
  },
};

export const COSMETIC_SLOT_LABELS: Record<CosmeticSlot, string> = {
  hat: "Hat",
  shoulders: "Shoulders",
  chest: "Chest",
  gloves: "Bracers",
  belt: "Belt",
  legs: "Legs",
  shoes: "Boots",
};

/** All object/mesh names for a catalog item. */
export function cosmeticMeshNames(def: CosmeticItemDef): string[] {
  if (def.meshNames && def.meshNames.length > 0) return [...def.meshNames];
  return [def.meshName || `${COSMETIC_MESH_PREFIX}${def.id}`];
}

/**
 * Compare Blender/glTF names to Three.js runtime names.
 * GLTFLoader replaces spaces / punctuation with underscores
 * (e.g. "Shoulder set 1 - 1" → "Shoulder_set_1_-_1").
 */
export function cosmeticNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Primary name for UI labels. */
export function cosmeticMeshName(def: CosmeticItemDef): string {
  return cosmeticMeshNames(def)[0]!;
}

/** All known gear object/mesh name keys from the catalog. */
let _catalogMeshKeys: Set<string> | null = null;
export function catalogCosmeticMeshNames(): Set<string> {
  if (_catalogMeshKeys) return _catalogMeshKeys;
  const names = new Set<string>();
  for (const def of Object.values(COSMETIC_CATALOG)) {
    for (const n of cosmeticMeshNames(def)) names.add(cosmeticNameKey(n));
  }
  _catalogMeshKeys = names;
  return names;
}

export function isCosmeticMeshName(name: string): boolean {
  const key = cosmeticNameKey(name);
  if (key.startsWith(COSMETIC_MESH_PREFIX) || name.toLowerCase().startsWith(COSMETIC_MESH_PREFIX)) {
    return true;
  }
  return catalogCosmeticMeshNames().has(key);
}

export function isCosmeticSlot(value: string): value is CosmeticSlot {
  return (COSMETIC_SLOTS as readonly string[]).includes(value);
}

export function getCosmeticItem(id: string | null | undefined): CosmeticItemDef | undefined {
  if (!id) return undefined;
  return COSMETIC_CATALOG[id];
}

export function cosmeticsForSlot(slot: CosmeticSlot): CosmeticItemDef[] {
  return Object.values(COSMETIC_CATALOG).filter((item) => item.slot === slot);
}

/** Lean starter: no free gear — buy from Merchant. */
export function starterCosmeticIds(): string[] {
  return [];
}

export function ownsCosmetic(owned: string[] | null | undefined, itemId: string): boolean {
  if (!COSMETIC_CATALOG[itemId]) return false;
  return Boolean(owned?.includes(itemId));
}

export function emptyCosmeticsEquipped(): CosmeticsEquipped {
  return {
    hat: null,
    shoulders: null,
    chest: null,
    gloves: null,
    belt: null,
    legs: null,
    shoes: null,
  };
}

export function normalizeCosmeticsEquipped(raw: unknown): CosmeticsEquipped {
  const out = emptyCosmeticsEquipped();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const slot of COSMETIC_SLOTS) {
    const id = obj[slot];
    if (id == null || id === "") {
      out[slot] = null;
      continue;
    }
    if (typeof id !== "string") {
      out[slot] = null;
      continue;
    }
    const def = COSMETIC_CATALOG[id];
    out[slot] = def && def.slot === slot ? id : null;
  }
  return out;
}

export type CosmeticSlotFields = {
  cosmeticHat: string;
  cosmeticShoulders: string;
  cosmeticChest: string;
  cosmeticGloves: string;
  cosmeticBelt: string;
  cosmeticLegs: string;
  cosmeticShoes: string;
};

export function cosmeticsEquippedToFields(eq: CosmeticsEquipped): CosmeticSlotFields {
  return {
    cosmeticHat: eq.hat ?? "",
    cosmeticShoulders: eq.shoulders ?? "",
    cosmeticChest: eq.chest ?? "",
    cosmeticGloves: eq.gloves ?? "",
    cosmeticBelt: eq.belt ?? "",
    cosmeticLegs: eq.legs ?? "",
    cosmeticShoes: eq.shoes ?? "",
  };
}

export function cosmeticsEquippedFromFields(fields: {
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
}): CosmeticsEquipped {
  return normalizeCosmeticsEquipped({
    hat: fields.cosmeticHat || null,
    shoulders: fields.cosmeticShoulders || null,
    chest: fields.cosmeticChest || null,
    gloves: fields.cosmeticGloves || null,
    belt: fields.cosmeticBelt || null,
    legs: fields.cosmeticLegs || null,
    shoes: fields.cosmeticShoes || null,
  });
}

export function applyCosmeticEquip(
  current: CosmeticsEquipped,
  slot: CosmeticSlot,
  itemId: string | null,
  owned: string[] | null | undefined = null,
): CosmeticsEquipped | null {
  if (itemId == null || itemId === "") {
    return { ...normalizeCosmeticsEquipped(current), [slot]: null };
  }
  const def = COSMETIC_CATALOG[itemId];
  if (!def || def.slot !== slot) return null;
  if (!ownsCosmetic(owned, itemId)) return null;
  return { ...normalizeCosmeticsEquipped(current), [slot]: itemId };
}
