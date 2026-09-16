/** Wearable cosmetics — embedded hero.glb meshes and external bone-attached GLBs. */

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

/** Playable Mixamo vessel. `female` = current hero, `male` = Y Bot. */
export const COSMETIC_BODIES = ["female", "male"] as const;
export type CosmeticBodyId = (typeof COSMETIC_BODIES)[number];
export type CosmeticBodyFit = "any" | CosmeticBodyId;
export const DEFAULT_COSMETIC_BODY: CosmeticBodyId = "female";

export function normalizeCosmeticBody(raw: string | null | undefined): CosmeticBodyId {
  const id = (raw ?? "").trim().toLowerCase();
  if (id === "male" || id === "y" || id === "ybot") return "male";
  return "female";
}

/** True only after an explicit Female / Male pick — empty and unknown stay unset. */
export function isCosmeticBodyChosen(raw: string | null | undefined): boolean {
  const id = (raw ?? "").trim().toLowerCase();
  return id === "male" || id === "female" || id === "y" || id === "ybot";
}

export function cosmeticBodyFitOf(def: { body?: CosmeticBodyFit }): CosmeticBodyFit {
  return def.body ?? "any";
}

export function cosmeticFitsBody(
  def: { body?: CosmeticBodyFit },
  body: CosmeticBodyId,
): boolean {
  const tag = cosmeticBodyFitOf(def);
  return tag === "any" || tag === body;
}

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
  /**
   * External GLB under `public/cosmetics/` (bone-attached skins).
   * Keep meshName(s) so leftover hero.glb meshes stay hidden.
   */
  file?: string;
  /**
   * Optional male cut of the same shop SKU. Runtime picks this when the
   * vessel is Y Bot. Omit and use `body: "male"` for a male-only piece.
   */
  fileMale?: string;
  /** Single-piece Mixamo bone (`Head`, `Spine2`). Multi-mesh files infer bones from object names / extras. */
  bone?: string;
  /** Known bones in a set GLB (labels + fallback). Prefer naming objects after the bone. */
  bones?: string[];
  /** Bone-local (rigid) or character-root (skinned) translation, in meters. */
  offset?: { x?: number; y?: number; z?: number };
  /** Euler degrees, same space as offset. Tweak in the stand Fit panel. */
  rotation?: { x?: number; y?: number; z?: number };
  /** Uniform or per-axis scale on top of the exported mesh. */
  scale?: number | { x?: number; y?: number; z?: number };
  /**
   * `skinned` = deform with the live Mixamo skeleton.
   * Default `rigid` is leftover — every shipped GLB is skinned.
   */
  rig?: "rigid" | "skinned";
  /**
   * Who this piece is cut for. Default `any`.
   * `male` / `female` hide it on the other vessel (Y Bot / current hero).
   */
  body?: "any" | "male" | "female";
  /**
   * Rest-pose outward push in meters. Default 0 — UV-chip garments read as
   * separate plates if inflated.
   */
  inflate?: number;
};

export type CosmeticFit = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
};

const FIT_ZERO = { x: 0, y: 0, z: 0 };
const FIT_ONE = { x: 1, y: 1, z: 1 };

function vec3(v: { x?: number; y?: number; z?: number } | undefined, fallback: { x: number; y: number; z: number }) {
  return {
    x: v?.x ?? fallback.x,
    y: v?.y ?? fallback.y,
    z: v?.z ?? fallback.z,
  };
}

function roundFit(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Catalog pose for a piece. Live stand overrides layer on top of this. */
export function catalogCosmeticFit(def: CosmeticItemDef): CosmeticFit {
  const raw = def.scale;
  let scale = { ...FIT_ONE };
  if (typeof raw === "number") scale = { x: raw, y: raw, z: raw };
  else if (raw) scale = vec3(raw, FIT_ONE);
  return {
    position: vec3(def.offset, FIT_ZERO),
    rotation: vec3(def.rotation, FIT_ZERO),
    scale,
  };
}

export function identityCosmeticFit(): CosmeticFit {
  return { position: { ...FIT_ZERO }, rotation: { ...FIT_ZERO }, scale: { ...FIT_ONE } };
}

/** Fields to paste into COSMETIC_CATALOG after using the stand Fit panel. */
export function formatCosmeticFitSnippet(fit: CosmeticFit, body?: CosmeticBodyFit): string {
  const p = fit.position;
  const r = fit.rotation;
  const s = fit.scale;
  const lines: string[] = [];
  if (body && body !== "any") {
    lines.push(`    body: "${body}",`);
  }
  if (p.x || p.y || p.z) {
    lines.push(`    offset: { x: ${roundFit(p.x)}, y: ${roundFit(p.y)}, z: ${roundFit(p.z)} },`);
  }
  if (r.x || r.y || r.z) {
    lines.push(`    rotation: { x: ${roundFit(r.x)}, y: ${roundFit(r.y)}, z: ${roundFit(r.z)} },`);
  }
  if (s.x === s.y && s.y === s.z) {
    if (s.x !== 1) lines.push(`    scale: ${roundFit(s.x)},`);
  } else {
    lines.push(`    scale: { x: ${roundFit(s.x)}, y: ${roundFit(s.y)}, z: ${roundFit(s.z)} },`);
  }
  return lines.join("\n") || "    // identity — no offset / rotation / scale needed";
}

export function cosmeticRelPath(file: string): string {
  const name = file.replace(/^\/+/, "").replace(/^cosmetics\//, "");
  return `cosmetics/${name}`;
}

export function isSkinnedCosmetic(def: CosmeticItemDef): boolean {
  return Boolean((def.file || def.fileMale) && def.rig === "skinned");
}

/** Outward rest-pose inflate. Off unless a catalog item sets `inflate`. */
export function cosmeticInflateMeters(def: CosmeticItemDef): number {
  if (typeof def.inflate === "number") return Math.max(0, def.inflate);
  return 0;
}

/** Rigid skin shipped as its own GLB and parented to Mixamo bones at runtime. */
export function isBoneSkin(def: CosmeticItemDef): boolean {
  return Boolean(def.file || def.fileMale);
}

export function isRigidBoneSkin(def: CosmeticItemDef): boolean {
  return isBoneSkin(def) && !isSkinnedCosmetic(def);
}

/** Public path for a bone-skin GLB (`cosmetics/hat_foo.glb`). */
export function cosmeticFilePath(def: CosmeticItemDef, body?: CosmeticBodyId): string | null {
  if (body === "male" && def.fileMale) return cosmeticRelPath(def.fileMale);
  if (def.file) return cosmeticRelPath(def.file);
  if (def.fileMale) return cosmeticRelPath(def.fileMale);
  return null;
}

export function cosmeticSkinBones(def: CosmeticItemDef): string[] {
  if (def.bones && def.bones.length > 0) return [...def.bones];
  if (def.bone) return [def.bone];
  return [];
}

export type CosmeticsEquipped = Partial<Record<CosmeticSlot, string | null>>;

/**
 * Embedded pieces stay in hero.glb. New skins: `file` + `bone` and a GLB in
 * `apps/web/public/cosmetics/` (tools/blender_export_skin.py). Do not add
 * those meshes to the master hero Blend.
 */
export const COSMETIC_CATALOG: Record<string, CosmeticItemDef> = {
  hat_wizard: {
    id: "hat_wizard",
    slot: "hat",
    name: "Wizard Hat",
    meshName: "WizardHat",
    file: "hat_wizard.glb",
    bone: "Head",
    rig: "skinned",
  },
  head_set_2: {
    id: "head_set_2",
    slot: "hat",
    name: "Head Set 2",
    meshName: "Head set 2",
    file: "head_set_2.glb",
    bone: "Head",
    rig: "skinned",
  },
  head_set_3: {
    id: "head_set_3",
    slot: "hat",
    name: "Head Set 3",
    meshName: "Head set 3",
    file: "head_set_3.glb",
    bone: "Head",
    rig: "skinned",
  },
  head_set_4: {
    id: "head_set_4",
    slot: "hat",
    name: "Head Set 4",
    meshName: "Head Set 4",
    file: "head_set_4.glb",
    bone: "Head",
    rig: "skinned",
  },
  head_set_5: {
    id: "head_set_5",
    slot: "hat",
    name: "Head Set 5",
    meshName: "Head Set 5",
    file: "head_set_5.glb",
    bone: "Head",
    rig: "skinned",
  },
  head_set_6: {
    id: "head_set_6",
    slot: "hat",
    name: "Head Set 6",
    meshName: "Head set 6",
    file: "head_set_6.glb",
    rig: "skinned",
    bones: ["Head"],
  },
  shoulders_set_1: {
    id: "shoulders_set_1",
    slot: "shoulders",
    name: "Shoulder Set 1",
    meshName: "Shoulder set 1",
    meshNames: ["Shoulder set 1 - 1", "Shoulder set 1 - 2", "Shoulder set 1"],
    file: "shoulders_set_1.glb",
    fileMale: "shoulders_set_1_male.glb",
    rig: "skinned",
    bones: ["LeftShoulder", "RightShoulder"],
  },
  shoulders_set_2: {
    id: "shoulders_set_2",
    slot: "shoulders",
    name: "Shoulder Set 2",
    meshName: "Shoulder set 2",
    file: "shoulders_set_2.glb",
    fileMale: "shoulders_set_2_male.glb",
    rig: "skinned",
    bones: ["LeftShoulder", "RightShoulder", "Spine1", "Spine2"],
  },
  chest_set_1: {
    id: "chest_set_1",
    slot: "chest",
    name: "Chest Set 1",
    meshName: "Chest Set 1",
    meshNames: ["Chest Set 1", "ChestProxy"],
    file: "chest_set_1.glb",
    fileMale: "chest_set_1_male.glb",
    rig: "skinned",
    bones: ["Spine", "Spine1", "Spine2"],
  },
  chest_set_2: {
    id: "chest_set_2",
    slot: "chest",
    name: "Chest Set 2",
    meshName: "Chest Set 2",
    file: "chest_set_2.glb",
    fileMale: "chest_set_2_male.glb",
    rig: "skinned",
    bones: ["Spine", "Spine1", "Spine2"],
  },
  chest_set_3: {
    id: "chest_set_3",
    slot: "chest",
    name: "Chest Set 3",
    meshName: "Chest Set 3",
    file: "chest_set_3.glb",
    fileMale: "chest_set_3_male.glb",
    rig: "skinned",
    bones: ["Spine", "Spine1", "Spine2"],
  },
  chest_set_4: {
    id: "chest_set_4",
    slot: "chest",
    name: "Chest Set 4",
    meshName: "Chest Set 4",
    file: "chest_set_4.glb",
    fileMale: "chest_set_4_male.glb",
    rig: "skinned",
    bones: ["Spine", "Spine1", "Spine2"],
  },
  chest_set_5: {
    id: "chest_set_5",
    slot: "chest",
    name: "Chest Set 5",
    meshName: "Chest Set 5",
    file: "chest_set_5.glb",
    fileMale: "chest_set_5_male.glb",
    rig: "skinned",
    bones: ["Spine", "Spine1", "Spine2"],
  },
  chest_set_6: {
    id: "chest_set_6",
    slot: "chest",
    name: "Chest Set 6",
    meshName: "Chest Set 6",
    file: "chest_set_6.glb",
    rig: "skinned",
    bones: ["Spine", "Spine1", "Spine2"],
  },
  pants_set_1: {
    id: "pants_set_1",
    slot: "legs",
    name: "Pants Set 1",
    meshName: "Pants Set 1",
    file: "pants_set_1.glb",
    fileMale: "pants_set_1_male.glb",
    rig: "skinned",
    bones: ["Hips", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"],
  },
  pants_set_2: {
    id: "pants_set_2",
    slot: "legs",
    name: "Pants Set 2",
    meshName: "Pants Set 2",
    file: "pants_set_2.glb",
    rig: "skinned",
    bones: ["Hips", "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"],
  },
  shoes_set_1: {
    id: "shoes_set_1",
    slot: "shoes",
    name: "Boot Set 1",
    meshName: "Boot Set 1",
    // Leftover hero.glb rigid boots — hide unless the skinned GLB is equipped.
    meshNames: ["Boot Set 1", "Boot1", "Boot2"],
    file: "shoes_set_1.glb",
    fileMale: "shoes_set_1_male.glb",
    rig: "skinned",
    bones: ["LeftLeg", "LeftFoot", "LeftToeBase", "RightLeg", "RightFoot", "RightToeBase"],
  },
  bracers_set_1: {
    id: "bracers_set_1",
    slot: "gloves",
    name: "Bracer Set 1",
    meshName: "Bracers set 1",
    file: "bracers_set_1.glb",
    rig: "skinned",
    bones: ["LeftForeArm", "RightForeArm"],
  },
  bracers_set_2: {
    id: "bracers_set_2",
    slot: "gloves",
    name: "Bracers Set 2",
    meshName: "Bracers Set 2",
    file: "bracers_set_2.glb",
    fileMale: "bracers_set_2_male.glb",
    rig: "skinned",
    bones: ["LeftForeArm", "RightForeArm"],
  },

  boots_set_2: {
    id: "boots_set_2",
    slot: "shoes",
    name: "Boots Set 2",
    meshName: "Boots Set 2",
    file: "boots_set_2.glb",
    rig: "skinned",
    bones: ["LeftLeg", "LeftFoot", "LeftToeBase", "RightLeg", "RightFoot", "RightToeBase"],
  },

  shoulder_set_3: {
    id: "shoulder_set_3",
    slot: "shoulders",
    name: "Shoulder Set 3",
    meshName: "Shoulder set 3",
    file: "shoulder_set_3.glb",
    rig: "skinned",
    bones: ["LeftShoulder", "RightShoulder"],
  },
  shoulder_set_4: {
    id: "shoulder_set_4",
    slot: "shoulders",
    name: "Shoulder Set 4",
    meshName: "Shoulders Set 4",
    file: "shoulder_set_4.glb",
    rig: "skinned",
    bones: ["LeftShoulder", "RightShoulder"],
  },
  shoulder_set_5: {
    id: "shoulder_set_5",
    slot: "shoulders",
    name: "Shoulder Set 5",
    meshName: "Shoulders Set 5",
    file: "shoulder_set_5.glb",
    rig: "skinned",
    bones: ["LeftShoulder", "RightShoulder"],
  },

  belt_set_1: {
    id: "belt_set_1",
    slot: "belt",
    name: "Belt Set 1",
    meshName: "Belt set 1",
    file: "belt_set_1.glb",
    bone: "Hips",
    rig: "skinned",
  },

};

/** Relative public paths for every bone-skin in the catalog (preload). */
export function catalogBoneSkinRelPaths(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const def of Object.values(COSMETIC_CATALOG)) {
    for (const file of [def.file, def.fileMale]) {
      if (!file) continue;
      const rel = cosmeticRelPath(file);
      if (seen.has(rel)) continue;
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

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

/** UI / debug: where this piece lives. */
export function cosmeticSourceLabel(def: CosmeticItemDef): string {
  const files = [def.file, def.fileMale].filter(Boolean).join(" / ");
  if (!files) return `${cosmeticMeshName(def)} in hero.glb`;
  if (isSkinnedCosmetic(def)) {
    const bones = cosmeticSkinBones(def);
    return bones.length > 0
      ? `${files} → skinned (${bones.join(", ")})`
      : `${files} → skinned Mixamo`;
  }
  const bones = cosmeticSkinBones(def);
  if (bones.length === 0) return files;
  return `${files} → ${bones.join(", ")}`;
}

/** All known gear object/mesh name keys from the catalog (including hidden leftovers in hero.glb). */
let _catalogMeshKeys: Set<string> | null = null;
export function catalogCosmeticMeshNames(): Set<string> {
  if (_catalogMeshKeys) return _catalogMeshKeys;
  const names = new Set<string>();
  for (const def of Object.values(COSMETIC_CATALOG)) {
    if (isBoneSkin(def)) {
      if (def.meshNames?.length) {
        for (const n of def.meshNames) names.add(cosmeticNameKey(n));
      } else if (def.meshName) {
        names.add(cosmeticNameKey(def.meshName));
      }
      continue;
    }
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

export function cosmeticsForSlot(
  slot: CosmeticSlot,
  body?: CosmeticBodyId,
): CosmeticItemDef[] {
  const all = Object.values(COSMETIC_CATALOG).filter((item) => item.slot === slot);
  if (!body) return all;
  return all.filter((item) => cosmeticFitsBody(item, body));
}

export function stripCosmeticsForBody(
  equipped: CosmeticsEquipped,
  body: CosmeticBodyId,
): CosmeticsEquipped {
  const next = normalizeCosmeticsEquipped(equipped);
  for (const slot of COSMETIC_SLOTS) {
    const id = next[slot];
    if (!id) continue;
    const def = COSMETIC_CATALOG[id];
    if (def && !cosmeticFitsBody(def, body)) next[slot] = null;
  }
  return next;
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
  body: CosmeticBodyId = DEFAULT_COSMETIC_BODY,
): CosmeticsEquipped | null {
  if (itemId == null || itemId === "") {
    return { ...normalizeCosmeticsEquipped(current), [slot]: null };
  }
  const def = COSMETIC_CATALOG[itemId];
  if (!def || def.slot !== slot) return null;
  if (!ownsCosmetic(owned, itemId)) return null;
  if (!cosmeticFitsBody(def, body)) return null;
  return { ...normalizeCosmeticsEquipped(current), [slot]: itemId };
}
