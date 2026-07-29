import { LOADOUT_SIZE, TALENT_TREE_IDS, type TalentTreeId } from "@battlebeasts/shared";

const STORAGE_KEY = "bb_stand_menu_v1";

export type StandMenuMemory = {
  /** Last talent-tree rail tab. */
  talentTree: TalentTreeId;
  /** Last Spell Armoury slot index (0 … LOADOUT_SIZE-1). */
  spellSlot: number;
};

const DEFAULTS: StandMenuMemory = {
  talentTree: "Destruction",
  spellSlot: 0,
};

function isTalentTreeId(v: unknown): v is TalentTreeId {
  return typeof v === "string" && (TALENT_TREE_IDS as readonly string[]).includes(v);
}

function normalize(partial: Partial<StandMenuMemory> | null | undefined): StandMenuMemory {
  const spellRaw = typeof partial?.spellSlot === "number" ? Math.floor(partial.spellSlot) : 0;
  return {
    talentTree: isTalentTreeId(partial?.talentTree) ? partial.talentTree : DEFAULTS.talentTree,
    spellSlot: Math.max(0, Math.min(LOADOUT_SIZE - 1, spellRaw)),
  };
}

export function loadStandMenuMemory(): StandMenuMemory {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return normalize(JSON.parse(raw) as Partial<StandMenuMemory>);
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveStandMenuMemory(patch: Partial<StandMenuMemory>): StandMenuMemory {
  const next = normalize({ ...loadStandMenuMemory(), ...patch });
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Quota / private mode — keep callers working with the returned value.
  }
  return next;
}
