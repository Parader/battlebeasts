export type PatchNote = {
  /** Stable id — newest first in PATCH_NOTES. */
  id: string;
  /** Short headline for the release. */
  title: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  highlights: string[];
};

/**
 * Player-facing updates. Newest entries first.
 * Add a new object at the top when shipping a batch players should notice.
 */
export const PATCH_NOTES: readonly PatchNote[] = [
  {
    id: "2026-08-01-smoke-ranked-polish",
    title: "Smoke Bomb, ranked LP & combat polish",
    date: "2026-08-01",
    highlights: [
      "Smoke Bomb (Q): grey smoke at your feet — Weakened (−20% defense) on enemies; stay cloaked while you remain in the cloud",
      "Spell armory autosaves on equip (Save loadout removed); hotbar updates immediately",
      "Ranked: placement matches removed — league points apply from the first ranked finish",
      "Protection Bubble: more transparent dome; shield cap raised to 300",
      "Fireball projectile hitbox scales with charge size; cast plays slightly faster",
      "Balance: Frost Ball CD 7s; Decoy 14s; Counter/Revenge 12s; Gust stays 10s; Bolt damage up; spell unlock costs ×10; starter wallet + 1 talent point",
      "Talent UI: Points shows spendable only; spent/budget sits beside Trees",
      "Hub portals: torus “donuts” removed (interact pads remain)",
      "Ice Lance, admin no-cooldowns toggle, emote shop dances, and assorted VFX/UI fixes",
    ],
  },
  {
    id: "2026-07-29-spirit-shield-rewards",
    title: "Spirit Form, Hand Shield & rewards",
    date: "2026-07-29",
    highlights: [
      "Hand Shield (RMB): channel a blue disc that shatters enemy projectiles — cancel anytime; blocks through the drop animation",
      "Spirit Form (Space): leave a husk, rush forward with haste; the husk↔spirit link stuns enemies that cross it; recast or wait to snap back",
      "Revenge (Q): red Counter stance — deny the next direct hit, vanish, and blink behind the attacker",
      "Stun cancels in-progress casts (players and practice dummies)",
      "Projectiles that hit walls fizzle with a downward spray",
      "Spore Shrooms, Magma Orbs, Volcano, and Protection Bubble combat + VFX",
      "Quests, chests, friend codes, and match reward payouts (see recap when activity-scaled)",
      "Friends / party invites stacked in one prompt UI; hub roster and talent stand polish",
    ],
  },
  {
    id: "2026-07-26-spells-counter-dart",
    title: "Counter, Poison Dart & combat polish",
    date: "2026-07-26",
    highlights: [
      "Counter (Q): rooted gold-glow stance — deny the next melee/projectile hit, then +20% damage, +20% move, and 40% resistance for 3s (cuts other casts; cancel anytime)",
      "Poison Dart (RMB): right-hook throw with stacking poison (up to 3) and a poison icon on health bars",
      "Firewall (E/Q/F): lava-crack ground + vertical flame wall that ignites mid-cast (cancel before), draws center→edges, burns with a flame icon on health bars",
      "Barrier: self absorb bubble that charges through the cast",
      "Heal Beam: channelled ally heal line",
      "Critical hits: 5% chance for 1.5× damage or healing",
      "Ability bar cooldown sweep uses a lighter overlay so it stays readable",
    ],
  },
  {
    id: "2026-07-25-audio-loading",
    title: "Hub music, settings & loading",
    date: "2026-07-25",
    highlights: [
      "Village looping soundtrack on the hub",
      "Settings: master, music, and effects volume (effects ready for future SFX)",
      "Loading gate preloads hub/arena assets before the HUD appears",
      "Shop and PvE portal show only “In development” while locked",
      "Updates / patch notes on the home screen and in play (Settings too)",
    ],
  },
  {
    id: "2026-07-25-talents",
    title: "Talent trees & spell tags",
    date: "2026-07-25",
    highlights: [
      "WoW-style talent trees at the talent stand (catalog preview; combat wiring later)",
      "Abilities carry spell tags and effect kinds for future talent hooks",
      "Crescent damage raised; merchant UI locked for development",
    ],
  },
] as const;

const SEEN_KEY = "bb.patchNotes.seenId";

export function latestPatchNote(): PatchNote | undefined {
  return PATCH_NOTES[0];
}

export function getSeenPatchNoteId(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function markPatchNotesSeen(id?: string): void {
  const target = id ?? latestPatchNote()?.id;
  if (!target || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, target);
  } catch {
    // ignore
  }
}

export function hasUnseenPatchNotes(): boolean {
  const latest = latestPatchNote()?.id;
  if (!latest) return false;
  return getSeenPatchNoteId() !== latest;
}
