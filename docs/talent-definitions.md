# BattleBeasts — Talent Tree Definition Sheet

**Purpose:** Share this document with designers / LLMs to author new talents that fit the existing classless talent system.  
**Code source of truth:** `packages/shared/src/talentCatalog.ts` (catalog) + `packages/shared/src/talentKit.ts` (combat bake).  
**Companion:** [`docs/spell-definitions.md`](./spell-definitions.md) for spell tags and loadout slots.

---

## Quick rules

1. **Classless build** — five trees, no classes. Players invest **owned talent points** across trees up to global and per-tree caps.
2. **Catalog vs combat** — 100 talents exist in `TALENT_CATALOG`. Only entries with `implemented: true` affect combat via `resolveKit`. Others appear in the hub tree as **WIP** previews.
3. **Bake on change** — loadout + `talentBuild` + legacy stub talents resolve into `CombatSessionKit` on join / save. The 30 Hz combat tick reads the kit, never scans talent lists.
4. **Tag matching** — `affectedTags` use the same `SpellTag` vocabulary as spells (`docs/spell-definitions.md`). Future live mods filter abilities with `abilityHasTags`.
5. **Id format** — `TREE_##` where tree prefix is `DES` | `GUA` | `CON` | `FLO` | `HAR`.
6. **Do not invent new tags** without adding them to `SpellTag` in `abilities.ts` first.

### Five trees

| Tree id | Theme | Accent role |
|---------|-------|-------------|
| `Destruction` | Offense | Projectiles, crits, burst, elements |
| `Guardian` | Defense | Shields, DR, survivability, ally protection |
| `Control` | Lockdown | CC, debuffs, zones, interrupts |
| `Flow` | Tempo | Movement, cooldown rhythm, resource flow |
| `Harmony` | Support | Healing, overheal, ally buffs |

---

## Economy & build caps

Defined in `packages/shared/src/talentTrees.ts`:

| Constant | Value | Meaning |
|----------|-------|---------|
| `TALENT_POINT_BUDGET` | **31** | Max points investable in one build |
| `TALENT_TREE_CAP` | **18** | Max points in a single tree |
| `ESSENCE_PER_TALENT_POINT` | **40** | Essence to buy 1 owned point |
| `ESSENCE_PER_TALENT_REFUND` | **10** | Essence per point **removed** when reshaping / resetting |
| `STARTER_TALENT_POINTS` | **1** | New players start with 1 owned point |

### Tier gates (points already invested **in that tree**)

| Tier | Default `requiredPoints` | Notes |
|------|--------------------------|-------|
| 1 | 0 | Foundations — always reachable |
| 2 | 4 | Destruction tier 2 uses **3** via per-talent override |
| 3 | 8 | Mid talents |
| 4 | 12 | Keystones (`pointCost` usually 3) |

Keystone reachability: effective gate = `min(requiredPoints, TALENT_TREE_CAP - pointCost)`.

### Multi-rank defaults

| Rule | Value |
|------|-------|
| `pointCost` | Cost **per rank** invested |
| Default `maxRank` | Tier 1 + `pointCost === 1` → **3 ranks**; else **1** |
| Tooltip scaling | Percent effects show per-rank step (rank 0 shows rank-1 value) |

### Progression loop

1. Play matches → earn **essence** (wins pay more; see `docs/loot-and-rewards.md`).
2. Talent stand → **Buy 1 / Buy 5** points (`buy_talent_points`). Owned points cap at `TALENT_POINT_BUDGET`.
3. Left-click node → invest rank (if legal). Right-click → refund one rank (WoW-style: cannot break remaining gates).
4. **Save build** → `set_talent_build` persists `talent_build` JSON on active loadout preset.
5. Removing points costs `pointsRemoved × ESSENCE_PER_TALENT_REFUND` essence. Adding points is free.
6. **Reset tree** clears one tree after confirm; same per-point respec fee.

Owned points are a **ceiling**, not consumed when investing.

---

## `CatalogTalentDef` schema

Every catalog entry in `TALENT_CATALOG`:

```ts
type CatalogTalentDef = {
  id: string;                    // e.g. "DES_08"
  tree: TalentTreeId;            // Destruction | Guardian | Control | Flow | Harmony
  tier: number;                  // 1–4
  requiredPoints: number;        // In-tree points before first rank (tier gate)
  name: string;
  pointCost: number;             // Points per rank (1 = foundation, 2–3 = mid/keystone)
  maxRank?: number;              // Override default max ranks
  layoutOrder?: number;          // Grid sort within tier (lower = left/first)
  requires?: readonly string[];  // Extra parent ids beyond visual tree link
  affectedTags: readonly SpellTag[];
  exactEffect: string;           // Player-facing effect at max rank
  balanceNote: string;           // Designer notes / per-rank breakdown
  status: "catalog";
  implemented?: boolean;         // true = combat-live via resolveKit
  hidden?: boolean;              // Omit from UI + builds (retired / duplicate)
};
```

### Prerequisites

- **Visual links:** `talentTreeLinks()` connects each node to the nearest parent in the row above (4-column grid).
- **Authored links:** `requires: ["DES_11"]` adds extra parents (same-row gates, etc.).
- **First rank** needs every parent at ≥1 rank + tier gate met.

### Validation helpers

| Function | Purpose |
|----------|---------|
| `canInvestTalent(build, id, ownedPoints)` | Can add one rank? |
| `canRefundTalent(build, id)` | Can remove one rank without breaking gates? |
| `isTalentBuildValid(build, ownedPoints)` | Full build legality |
| `totalPointsSpent(build)` | Sum of `pointCost × rank` |
| `treePointsSpent(build, tree)` | Per-tree spend |

---

## Combat integration

### Legacy live stubs (`TALENTS` in `stands.ts`)

Separate from the catalog — max **2** equipped via `set_talents` (older path, still baked):

| id | Effect |
|----|--------|
| `tough` | `+combatMag(10)` max HP (+100 HP) |
| `swift` | `×1.08` move speed |
| `focused` | `×0.9` cooldown on all loadout abilities |

```ts
type TalentMod =
  | { kind: "maxHp"; amount: number }
  | { kind: "moveSpeedMul"; mul: number }
  | { kind: "cooldownMul"; mul: number; tags?: readonly SpellTag[] };
```

### `CombatSessionKit` (baked fields)

```ts
type CombatSessionKit = {
  loadoutIds: Set<string>;
  talentIds: readonly string[];       // legacy stubs
  moveSpeedMul: number;
  maxHpBonus: number;
  critChance: number;                 // base + Critical Focus
  critDamageBonus: number;            // Unstable Magic
  secondaryEffectMul: number;         // Intensified Elements (DoT/slow potency)
  cooldownMulByAbility: Map<string, number>;  // focused + Elemental Quickness
  openingSalvoDmgBonus: number;       // 0–0.08
  protectiveInstinctReducePct: number; // 0 / 2 / 4 / 6
  opportunistDmgBonus: number;        // 0–0.06
  overflowConvertFrac: number;        // overheal → shield
  overflowCapFrac: number;            // shield cap % max HP
  fifthSpellDmgBonus: number;         // 0 or 0.15
  elementalAoeRadiusMul: number;      // 1 or 1.1
};
```

`resolveKit(loadoutCsv, talentIds, talentBuild)` merges stubs + implemented catalog ranks.

### Promoting a catalog talent to live combat

1. Set `implemented: true` on the catalog entry.
2. Add bake logic in `resolveKit` (or helper like `bakeOpeningSalvoBonus`).
3. Apply behavior in combat hot path (`applyRawDamage`, `applyHealAmount`, cast begin, etc.).
4. Call `syncSessionKit` on join, loadout change, talent save.
5. Mark UI: implemented nodes hide **WIP** badge.

---

## Live talents (combat-ready today)

### Destruction (7 live)

| id | name | ranks | Effect (summary) | Combat hook |
|----|------|-------|------------------|-------------|
| `DES_08` | Opening Salvo | 3 | +8% damage when **initiating** combat; 8s CD; lost if hit first or already fighting | `openingSalvoDmgBonus` in `applyRawDamage`; engage linger 8s |
| `DES_01` | Unstable Magic | 3 | Crits deal +3/6/9% more damage | `critDamageBonus` on crit |
| `DES_02` | Intensified Elements | 3 | Elemental secondary effects +5/10/15% (burn/poison/bleed/slow duration & potency) | `secondaryEffectMul` on status apply |
| `DES_09` | Fifth Cadence | 1 | Every 5th damaging spell +15% damage | `fifthSpellCadence` status tracker above spellbar |
| `DES_10` | Critical Focus | 3 | +2/4/6% crit chance | `critChance` additive |
| `DES_11` | Elemental Quickness | 3 | Elemental spell CDs −5/10/15% | per-ability `cooldownMulByAbility` |
| `DES_12` | Widened Elements | 1 | Elemental AoE radius +10%; **requires DES_11** | `kitRadiusMul` for elemental AoE |

**Elemental spells** (for DES_02/11/12): frostBall, frostMist, iceLance, poisonDart, poisonCloud, spikes, magmaOrbs, firewall, fireball, volcano, shrooms — or any spell applying burn/poison/bleed/slow/chill statuses.

### Guardian (1 live)

| id | name | ranks | Effect | Combat hook |
|----|------|-------|--------|-------------|
| `GUA_08` | Protective Instinct | 3 | On **Defense**-tagged cast: nearest ally (else self) gains 2/4/6% DR for 3s; 6s ICD | `protectiveInstinct` status on proc |

Defense-tagged spells include: Barrier, Hand Shield, Counter, Revenge, Dash, Protection Bubble, Groove, etc. (`abilityCanProcProtectiveInstinct`).

### Control (1 live)

| id | name | ranks | Effect | Combat hook |
|----|------|-------|--------|-------------|
| `CON_03` | Opportunist | 3 | +2/4/6% damage vs enemies under **your** hard CC (stun/root/silence) | `opportunistDmgBonus` in `applyRawDamage` |

Hard CC = status mechanic `stun` | `root` | `silence` with `sourceId` = you. Slows/DoTs do not count.

### Flow (1 live)

| id | name | ranks | Effect | Combat hook |
|----|------|-------|--------|-------------|
| `FLO_01` | Sprinter | 3 | +2/4/6% movement speed (passive) | multiplies `moveSpeedMul` in kit |

### Harmony (1 live)

| id | name | ranks | Effect | Combat hook |
|----|------|-------|--------|-------------|
| `HAR_01` | Overflow | 3 | Overheal from heals/HoTs → shield: 13.3/26.7/40% convert, cap 2.7/5.3/8% max HP, 5s | `overflowShield` status in `applyHealAmount` |

---

## Authoring checklist (new catalog talent)

1. Pick **tree**, **tier**, **pointCost**, **affectedTags** (subset of `SpellTag`).
2. Write **exactEffect** at **max rank** (UI shows per-rank steps for multi-rank % talents).
3. Add **balanceNote** with per-rank numbers, ICDs, exclusions.
4. Set **layoutOrder** if it should appear first in tier row (foundations use `0`).
5. Add **requires** for explicit parents (optional).
6. Add entry to `TALENT_CATALOG` in `talentCatalog.ts`.
7. Regenerate extract: `node scripts/extract-talent-catalog.mjs` → `tools/talent-extract.json`.
8. Regenerate catalog tables: `node scripts/gen-talent-definitions-md.mjs`.
9. When ready for combat: `implemented: true` + bake in `talentKit.ts` + combat hooks.

### Design constraints (from workbook)

- **Match power is capped** — talents modify %s and procs, not unbounded scaling.
- **Keystones** cost 3 points, tier 4, often trade-offs (see Glass Cannon, Living Fortress).
- **Mutual exclusives** (e.g. Heavy Projectiles vs Needlecast) are noted in balance but **not enforced in code yet**.
- **Proc talents** should specify ICD, per-target CD, and what counts (direct hit vs AoE tick, etc.).
- Prefer hooking **tags** over naming specific spell ids.

---

## Talent templates

### Tier-1 foundation (3 ranks, 1 pt/rank)

```ts
"DES_XX": {
  id: "DES_XX",
  tree: "Destruction",
  tier: 1,
  requiredPoints: 0,
  layoutOrder: 2,
  name: "Example Foundation",
  pointCost: 1,
  affectedTags: ["Damage", "Projectile"] as const,
  exactEffect: "Projectiles deal +9% damage.",
  balanceNote: "3 / 6 / 9% across ranks.",
  status: "catalog",
  // implemented: true,  // when combat-ready
},
```

### Tier-2 mid (2 pts, single rank)

```ts
"GUA_XX": {
  id: "GUA_XX",
  tree: "Guardian",
  tier: 2,
  requiredPoints: 4,
  name: "Example Mid",
  pointCost: 2,
  maxRank: 1,
  affectedTags: ["Shield"] as const,
  exactEffect: "Shield strength +14%.",
  balanceNote: "Applies to self and ally shields.",
  status: "catalog",
},
```

### Tier-4 keystone (3 pts, single rank)

```ts
"CON_XX": {
  id: "CON_XX",
  tree: "Control",
  tier: 4,
  requiredPoints: 12,
  name: "Example Keystone",
  pointCost: 3,
  maxRank: 1,
  affectedTags: ["CrowdControl", "Area"] as const,
  exactEffect: "Applying 3 different CC categories within 8s creates a slowing field for 3s.",
  balanceNote: "18s cooldown. Keystone.",
  status: "catalog",
},
```

### Gated same-row talent

```ts
"DES_XX": {
  // ...
  requires: ["DES_11"] as const,
  exactEffect: "Requires Elemental Quickness.",
},
```

---

## Hub messages & persistence

| Message | Payload | Effect |
|---------|---------|--------|
| `buy_talent_points` | `{ count?: number }` | Spend essence → owned points |
| `set_talent_build` | `{ build: Record<id, rank> }` | Save build; respec fee on point removal |
| `reset_talent_tree` | `{ tree: TalentTreeId }` | Clear tree; respec fee |
| `set_talents` | `{ talentIds: string[] }` | Legacy stubs only (max 2) |

**Persistence:** `talents.talent_build` + per-loadout-preset `talent_build` in Supabase. Each loadout preset = spells + talents together.

---

## Related files

| Area | Path |
|------|------|
| Catalog data | `packages/shared/src/talentCatalog.ts` |
| Tree rules / validation | `packages/shared/src/talentTrees.ts` |
| Combat bake | `packages/shared/src/talentKit.ts` |
| Legacy stubs | `packages/shared/src/stands.ts` |
| Combat application | `apps/game-server/src/combat/CombatSystem.ts` |
| Tree UI | `apps/web/src/game/ui/TalentTreePanel.tsx` |
| Spell tags | `packages/shared/src/abilities.ts` |
| Design notes | `docs/talents-and-progression.md` |
| Catalog extract (machine) | `tools/talent-extract.json` |
| Regen catalog tables | `node scripts/gen-talent-definitions-md.mjs` |

---

## Prompt snippet for ChatGPT

Copy everything above, then add:

> Design a new **tier 2 Control** talent that rewards **Silence** spells.  
> Return a complete `CatalogTalentDef` object with id `CON_XX`, affectedTags, exactEffect at max rank,  
> balanceNote with ICDs, and a short note on how you would implement it in `resolveKit` / `CombatSystem`.

---

<!-- CATALOG:AUTO -->

## Full catalog (visible talents)

**93** talents shown in the tree UI (**7** hidden design entries omitted). **11** are combat-live today.

### Destruction (13 visible, 7 live)

| id | tier | cost/rank | max ranks | tier gate | live | requires | affectedTags | exactEffect |
|----|------|-----------|-----------|-----------|------|----------|--------------|-------------|
| `DES_08` | 1 | 1 | 3 (default) | 0 | ✓ | — | Damage | When you initiate combat, damaging spells deal +8% damage (8s cooldown). Being hit first or while already in combat withholds the bonus until you leave combat. |
| `DES_01` | 1 | 1 | 3 (default) | 0 | ✓ | — | Damage | Critical strikes deal +9% more damage. |
| `DES_02` | 1 | 1 | 3 (default) | 0 | ✓ | — | Damage, DamageOverTime | Elemental secondary effects are 15% stronger (longer burns, poisons, and bleeds; harder slows). |
| `DES_09` | 2 | 1 | 1 | 3 | ✓ | — | Damage | Every 5th damaging spell deals +15% damage. |
| `DES_10` | 2 | 1 | 3 | 3 | ✓ | — | Damage | Critical strike chance increased by 6%. |
| `DES_11` | 2 | 1 | 3 | 3 | ✓ | — | Damage, DamageOverTime | Elemental spell cooldowns reduced by 15%. |
| `DES_12` | 2 | 1 | 1 | 3 | ✓ | DES_11 | Area, Nova, Cone, Explosion | Elemental area spells have 10% larger radius. |
| `DES_15` | 3 | 2 | 1 (default) | 8 |  | — | — | Every fourth projectile cast creates a second projectile dealing 60% damage. |
| `DES_16` | 3 | 2 | 1 (default) | 8 |  | — | Damage | Deal +10% damage to enemies below 25% health. |
| `DES_17` | 3 | 2 | 1 (default) | 8 |  | — | Damage, Combo | After casting 3 different damaging spell slots within 5s, gain 12% haste for 3s. |
| `DES_18` | 3 | 2 | 1 (default) | 8 |  | — | Debuff, Damage | Damaging an enemy with 3 different mechanics applies Vulnerable: +7% damage taken for 3s. |
| `DES_19` | 4 | 3 | 1 (default) | 12 |  | — | Damage | Damage dealt +15%; maximum health -12%; healing received -8%. |
| `DES_20` | 4 | 3 | 1 (default) | 12 |  | — | Explosion, Area | Every 18s, your next Explosion or Area damage spell gains +25% radius and +12% damage. |

### Guardian (20 visible, 1 live)

| id | tier | cost/rank | max ranks | tier gate | live | requires | affectedTags | exactEffect |
|----|------|-----------|-----------|-----------|------|----------|--------------|-------------|
| `GUA_08` | 1 | 1 | 3 (default) | 0 | ✓ | — | Defense, Ally | Using a Defense spell grants the nearest ally 6% damage reduction for 3s (6s cooldown). Alone, the buff applies to you. |
| `GUA_01` | 1 | 1 | 3 (default) | 0 |  | — | DamageOverTime, Defense | Damage-over-time damage taken -15%. |
| `GUA_02` | 1 | 1 | 3 (default) | 0 |  | — | Knockback, Pull, Knockup | Displacement distance received -25%. |
| `GUA_03` | 1 | 1 | 3 (default) | 0 |  | — | Healing, Self | After 5s without taking damage, regenerate 1.25% max health per second. |
| `GUA_04` | 1 | 1 | 3 (default) | 0 |  | — | Cast, Channel | Take 8% less damage while casting or channeling. |
| `GUA_05` | 1 | 1 | 3 (default) | 0 |  | — | Shield | Shields on you last 25% longer. |
| `GUA_06` | 1 | 1 | 3 (default) | 0 |  | — | Defense | While above 70% health, gain 5% damage reduction. |
| `GUA_07` | 1 | 1 | 3 (default) | 0 |  | — | Movement, Defense | Using a movement spell below 35% health grants a shield equal to 5% max health for 3s. |
| `GUA_09` | 2 | 2 | 1 (default) | 4 |  | — | Shield | Shield strength +14%. |
| `GUA_10` | 2 | 2 | 1 (default) | 4 |  | — | Stun, Root, Silence, Fear | The first hard CC received every 18s has 35% shorter duration. |
| `GUA_11` | 2 | 2 | 1 (default) | 4 |  | — | Shield, Damage | When one of your shields is fully destroyed, deal damage equal to 20% of its original value in 3m. |
| `GUA_12` | 2 | 2 | 1 (default) | 4 |  | — | Defense | 20% of direct damage taken is delayed over 3s. |
| `GUA_13` | 2 | 2 | 1 (default) | 4 |  | — | Defense, Damage | After blocking, absorbing, or becoming immune to damage, your next damaging spell within 4s deals +8%. |
| `GUA_14` | 2 | 2 | 1 (default) | 4 |  | — | GroundEffect, Defense | While inside one of your persistent areas, take 7% less damage. |
| `GUA_15` | 3 | 2 | 1 (default) | 8 |  | — | Defense | Below 30% health, gain 12% damage reduction until above 45%. |
| `GUA_16` | 3 | 2 | 1 (default) | 8 |  | — | Defense, Cooldown | Taking damage equal to 20% max health within 3s reduces Defensive-slot cooldown by 12%. |
| `GUA_17` | 3 | 2 | 1 (default) | 8 |  | — | Shield, Ally | 15% of shields you grant yourself are also granted to the nearest ally. |
| `GUA_18` | 3 | 2 | 1 (default) | 8 |  | — | Debuff, Ally | Damaging an enemy marks them for 4s; they deal 6% less damage to your allies. |
| `GUA_19` | 4 | 3 | 1 (default) | 12 |  | — | Defense | After standing still for 1.5s: +12% damage reduction, +20% displacement resistance, +10% shield power. Ends on movement. |
| `GUA_20` | 4 | 3 | 1 (default) | 12 |  | — | Defense | Lethal damage instead leaves you at 1 health and grants 20% max-health shield for 2s. |

### Control (20 visible, 1 live)

| id | tier | cost/rank | max ranks | tier gate | live | requires | affectedTags | exactEffect |
|----|------|-----------|-----------|-----------|------|----------|--------------|-------------|
| `CON_03` | 1 | 1 | 3 (default) | 0 | ✓ | — | Control, CrowdControl, Damage | Damaging spells deal +6% damage to enemies currently stunned, rooted, or silenced by you. |
| `CON_01` | 1 | 1 | 3 (default) | 0 |  | — | Control, Slow | Slow duration +20%. |
| `CON_02` | 1 | 1 | 3 (default) | 0 |  | — | Control, CrowdControl, Reveal | Enemies you control remain revealed for 2s after the effect ends. |
| `CON_04` | 1 | 1 | 3 (default) | 0 |  | — | Control, GroundEffect, Persistent | Non-damaging ground effects last 15% longer. |
| `CON_05` | 1 | 1 | 3 (default) | 0 |  | — | Control, Debuff | Debuffs you apply last 12% longer. |
| `CON_06` | 1 | 1 | 3 (default) | 0 |  | — | Control, Wall, Obstacle | Walls and obstacles last 15% longer and gain 12% health. |
| `CON_07` | 1 | 1 | 3 (default) | 0 |  | — | Control, Slow, Movement | Slowed enemies receive 10% less movement from movement-speed bonuses. |
| `CON_08` | 1 | 1 | 3 (default) | 0 |  | — | Control, Interrupt | Successful interrupts reveal the target and their cooldown indicators for 3s. |
| `CON_09` | 2 | 2 | 1 (default) | 4 |  | — | Control, Root, Slow | When your root ends, apply a 25% slow for 1.5s. |
| `CON_10` | 2 | 2 | 1 (default) | 4 |  | — | Control, Knockback, Knockup | Displacement applies a 20% slow for 1.25s. |
| `CON_11` | 2 | 2 | 1 (default) | 4 |  | — | Control, Area, GroundEffect | Area control spells leave a 2s zone that slows by 15%. |
| `CON_12` | 2 | 2 | 1 (default) | 4 |  | — | Control, Interrupt, Silence | Interrupting a spell silences the target for 0.5s. |
| `CON_13` | 2 | 2 | 1 (default) | 4 |  | — | Control, CrowdControl, Movement | Enemies using a movement spell while affected by your slow or debuff are slowed by 30% for 1s afterward. |
| `CON_14` | 2 | 2 | 1 (default) | 4 |  | — | Control, CrowdControl, Combo | Applying a different CC category within 3s increases the second effect's duration by 12%. |
| `CON_15` | 3 | 2 | 1 (default) | 8 |  | — | Control, CrowdControl, Movement | Controlling two different enemies within 4s reduces Movement-slot cooldown by 15%. |
| `CON_16` | 3 | 2 | 1 (default) | 8 |  | — | Control, Interrupt, Resource | Successful interrupts restore 10% maximum resource. |
| `CON_17` | 3 | 2 | 1 (default) | 8 |  | — | Control, Area, Persistent | Persistent control areas gain +12% radius but deal 8% less damage. |
| `CON_18` | 3 | 2 | 1 (default) | 8 |  | — | Control, Debuff | Enemies affected by 2+ of your debuffs deal 7% less damage to you. |
| `CON_19` | 4 | 3 | 1 (default) | 12 |  | — | Control, CrowdControl, Combo | Applying 3 different CC categories within 8s creates a 3.5m field for 3s: enemies are slowed 25% and deal 8% less damage. |
| `CON_20` | 4 | 3 | 1 (default) | 12 |  | — | Control, Cooldown, Debuff | Every 20s, your next hard CC pauses 25% of the target's current basic cooldown recovery for 2s. |

### Flow (20 visible, 1 live)

| id | tier | cost/rank | max ranks | tier gate | live | requires | affectedTags | exactEffect |
|----|------|-----------|-----------|-----------|------|----------|--------------|-------------|
| `FLO_01` | 1 | 1 | 3 (default) | 0 | ✓ | — | Movement | Movement speed +6%. |
| `FLO_02` | 1 | 1 | 3 (default) | 0 |  | — | Combo, SpellSlot | Casting 3 different spell slots within 5s grants 8% movement speed for 3s. |
| `FLO_03` | 1 | 1 | 3 (default) | 0 |  | — | Movement, Resource | Movement-slot spells restore 6% maximum resource. |
| `FLO_04` | 1 | 1 | 3 (default) | 0 |  | — | Cast, Movement | Moving during a cast reduces the movement penalty by 25%. |
| `FLO_05` | 1 | 1 | 3 (default) | 0 |  | — | Cooldown | Missing an aimed spell refunds 5% of its base cooldown. |
| `FLO_06` | 1 | 1 | 3 (default) | 0 |  | — | Damage, Movement | Damaging an enemy over 8m away grants 8% movement speed toward them for 2s. |
| `FLO_07` | 1 | 1 | 3 (default) | 0 |  | — | Movement, Defense | For 1s after a movement spell, take 6% less damage. |
| `FLO_08` | 1 | 1 | 3 (default) | 0 |  | — | Combo, Resource | Casting two different spell slots consecutively reduces the second spell's resource cost by 8%. |
| `FLO_09` | 2 | 2 | 1 (default) | 4 |  | — | Movement, Explosion | Movement spells leave an afterimage that explodes after 0.65s for 450 base damage in 2.25m. |
| `FLO_10` | 2 | 2 | 1 (default) | 4 |  | — | Combo, Cooldown | Casting Movement ΓåÆ Primary ΓåÆ Secondary within 5s reduces remaining non-ultimate cooldowns by 7%. |
| `FLO_11` | 2 | 2 | 1 (default) | 4 |  | — | Damage, Movement | Gain 12% movement speed while moving toward an enemy you damaged in the last 2s. |
| `FLO_12` | 2 | 2 | 1 (default) | 4 |  | — | Movement, Ally | Passing within 2m of an ally after a movement spell grants both 8% movement speed for 2s. |
| `FLO_13` | 2 | 2 | 1 (default) | 4 |  | — | SpellSlot, Cooldown | After casting a spell slot, the next different slot gains 8% cooldown recovery for 3s. |
| `FLO_14` | 2 | 2 | 1 (default) | 4 |  | — | Resource, Shield | Resource gained above maximum becomes a shield at 50% efficiency, capped at 6% max health. |
| `FLO_15` | 3 | 2 | 1 (default) | 8 |  | — | Combo, Haste | Casting 4 spells within 6s grants 12% haste for 3s. |
| `FLO_16` | 3 | 2 | 1 (default) | 8 |  | — | Movement, Cleanse | Movement-slot spells remove slows and grant slow immunity for 0.75s. |
| `FLO_17` | 3 | 2 | 1 (default) | 8 |  | — | Cooldown, Combo | Casting a spell with 8s+ base cooldown reduces the next spell below 8s by 10%. |
| `FLO_18` | 3 | 2 | 1 (default) | 8 |  | — | SpellSlot, Combo | Casting without repeating a spell slot grants 1 Momentum; at 4, restore 8% resource and reduce cooldowns by 5%. |
| `FLO_19` | 4 | 3 | 1 (default) | 12 |  | — | SpellSlot, Haste | Each different spell slot cast grants 2% haste for 5s, max 5 stacks. Repeating a slot removes all stacks. |
| `FLO_20` | 4 | 3 | 1 (default) | 12 |  | — | Movement, Defense | After casting 3 different slots within 4s, become untargetable by homing effects and gain 15% movement speed for 1.5s. |

### Harmony (20 visible, 1 live)

| id | tier | cost/rank | max ranks | tier gate | live | requires | affectedTags | exactEffect |
|----|------|-----------|-----------|-----------|------|----------|--------------|-------------|
| `HAR_01` | 1 | 1 | 3 (default) | 0 | ✓ | — | Healing, HealOverTime, Shield | 40% of overhealing (including HoTs) becomes a shield lasting 5s, capped at 8% target max health. |
| `HAR_02` | 1 | 1 | 3 (default) | 0 |  | — | Healing, Ally | Healing an ally grants them 10% movement speed for 2s. |
| `HAR_03` | 1 | 1 | 3 (default) | 0 |  | — | Shield, Ally | Granting an ally a shield also shields you for 15% of that amount. |
| `HAR_04` | 1 | 1 | 3 (default) | 0 |  | — | Healing, Resource | Healing an ally restores 3% maximum resource. |
| `HAR_05` | 1 | 1 | 3 (default) | 0 |  | — | HealOverTime, Buff | Heal-over-time and beneficial buff durations +15%. |
| `HAR_06` | 1 | 1 | 3 (default) | 0 |  | — | Healing | Healing projectiles gain +20% speed and +10% size. |
| `HAR_07` | 1 | 1 | 3 (default) | 0 |  | — | Ally, Healing | When an ally heals or shields you, your next support spell within 4s is 6% stronger. |
| `HAR_08` | 1 | 1 | 3 (default) | 0 |  | — | Healing | Healing allies who took damage in the last 2s is increased by 6%. |
| `HAR_09` | 2 | 2 | 1 (default) | 4 |  | — | Healing, Ally | Healing allies below 30% health is increased by 18%. |
| `HAR_10` | 2 | 2 | 1 (default) | 4 |  | — | Cleanse, Buff | Cleansing an ally grants 20% slow resistance and 10% movement speed for 2s. |
| `HAR_11` | 2 | 2 | 1 (default) | 4 |  | — | Healing, Combo | Healing two different allies within 4s empowers your next heal by 12%. |
| `HAR_12` | 2 | 2 | 1 (default) | 4 |  | — | Shield, Area | When an ally shield expires naturally, nearby allies receive 12% of its original amount. |
| `HAR_13` | 2 | 2 | 1 (default) | 4 |  | — | Buff, Cooldown | Applying a beneficial buff to an ally reduces your longest non-ultimate cooldown by 5%. |
| `HAR_14` | 2 | 2 | 1 (default) | 4 |  | — | Healing, Ally | 20% of self-healing also heals the lowest-health ally within 8m. |
| `HAR_15` | 3 | 2 | 1 (default) | 8 |  | — | Healing, Area | Directly healing yourself emits a heal equal to 15% of the amount to allies within 4m. |
| `HAR_16` | 3 | 2 | 1 (default) | 8 |  | — | Healing, Buff | Healing an ally grants them 5% damage reduction for 2s. |
| `HAR_17` | 3 | 2 | 1 (default) | 8 |  | — | Cleanse, Cooldown | Successful cleanse reduces Movement-slot cooldown by 15%. |
| `HAR_18` | 3 | 2 | 1 (default) | 8 |  | — | Healing, Shield | After dealing damage with 2 different spell slots, your next heal or shield is 15% stronger. |
| `HAR_19` | 4 | 3 | 1 (default) | 12 |  | — | Healing, Shield | Heals and shields grant Resonance, max 5. At 5, next support spell is 30% stronger, costs no resource, and gains 15% range. |
| `HAR_20` | 4 | 3 | 1 (default) | 12 |  | — | Healing, Damage | Every 18s, dealing damage stores 20% of damage dealt, capped at 10% max health; your next ally heal adds the stored amount. |


<!-- /CATALOG:AUTO -->
