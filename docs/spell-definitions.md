# BattleBeasts — Spell Definition Sheet

**Purpose:** Share this document with designers / LLMs to author new spells that plug into the live game.  
**Code source of truth:** `packages/shared/src/abilities.ts` (`ABILITIES` record).  
**Last synced:** 35 player spells across 7 slot families.

---

## Quick rules

1. **Every spell has exactly one slot family** (`allowedSlots: ["m1"]` etc.). A player equips one spell per family. They cannot take two spells from the same family (e.g. Counter + Decoy both on Q).
2. **`id` must be camelCase**, unique, and stable (used in saves, VFX, animations).
3. **Damage/heal/shield numbers use `combatMag(n)`** — multiply authored `n` by **10** for in-game HP (`COMBAT_MAGNITUDE_SCALE = 10`). Example: `combatMag(11)` → **110 damage**. Player base HP ≈ `combatMag(200)` = **2000**.
4. **Do not put CC durations, radii, or % slows in `combatMag`** — only flat HP magnitudes (damage, heal, shield absorb, DoT tick damage).
5. **Prefer `effectKind: "standard"`** unless the spell needs a bespoke server path (see Effect kinds below). New bespoke kinds register **one handler** in `CombatSystem.effectKindFireHandlers()` — do not grow if/else ladders.
6. **Pick tags from the Tag Dictionary** — talents and future mods filter on these.
7. **Assign an animation** — reuse an existing Mixamo clip + `abilityAnimationBindings` entry, or add a new bake action in `tools/spell_cast_bake_actions.json`.
8. **Starter spells** — listed in `DEFAULT_ABILITY_BY_SLOT`; omit `unlockCostEssence` or set `0`. Non-starters typically cost **60–140 essence** (see existing spells).
9. **VFX preload** — any new texture/GLB must be listed on the ability’s VFX `profile.assets` (or in `spellVfxAssets.ts` core lists) so the loading gate fetches them before play.
### Slot families (loadout order)

| Slot id | Input | Role (typical) |
|---------|-------|----------------|
| `m1` | LMB | Primary damage |
| `m2` | RMB | Secondary damage / utility |
| `space` | Space | Mobility / buff |
| `q` | Q | Control / defense |
| `e` | E | Skill shot / line |
| `r` | R | Defensive / zone |
| `f` | F | Ultimate / channel |

**Default starter loadout:** `bolt`, `frostBall`, `surge`, `gust`, `spikes`, `barrier`, `fireball`

---

## Cast lifecycle

Every spell runs through four phases (synced to animation):

```
anticipation → cast → impact → recovery
```

| Phase | Meaning |
|-------|---------|
| **anticipation** | Wind-up. Usually cancelable. No gameplay effect yet. |
| **cast** | Committed forward motion. Effect may still not fire. |
| **impact** | **Effect resolves here** (projectile spawns, AoE hits, channel begins). |
| **recovery** | Return to idle. Cooldown often stamps at impact start. |

### Timing fields (`timing: AbilityTiming`)

| Field | Type | Description |
|-------|------|-------------|
| `anticipationMs` | number | Wind-up duration (ms). |
| `castMs` | number | Cast phase duration (ms). |
| `impactMs` | number | Impact hold / channel window (ms). |
| `recoveryMs` | number | Recovery duration (ms). |
| `anticipationMoveMul` | number? | Move speed during anticipation (1 = full). |
| `castMoveMul` | number? | Move speed during cast. |
| `impactMoveMul` | number? | Move speed during impact. |
| `recoveryMoveMul` | number? | Move speed during recovery. |
| `canCancelAnticipation` | boolean? | Legacy; prefer `cancelUntilPhase`. |
| `cancelUntilPhase` | `"anticipation"` \| `"cast"` \| `"impact"`? | Latest phase where **player cancel** (C / Esc) is allowed. |
| `blocksOtherCasts` | boolean? | Block starting other abilities until recovery (default true). |

**Global cast speed:** wall-clock phases are scaled by `CAST_EXECUTION_SCALE = 0.6` via `authoredForWallMs()` — anim lockouts feel ~40% faster than raw ms values.

### Channel / confirm variants

| Field | When to use |
|-------|-------------|
| `confirmOnRelease: true` | Hold key → release to fire (Fireball, Portal). |
| `holdChannel: true` | Impact phase runs until player cancels; CD starts on end (Life Leech). |
| `channelChargeMs` | Ms to reach max charge (Portal blink distance, Fireball size). |
| `channelCapGraceMs` | Ms after max charge before auto-cancel (Portal). |
| `channelMinRange` | Minimum effect on instant confirm (Portal). |

### Interrupt rules

| Field | Meaning |
|-------|---------|
| `interruptsOtherCasts: true` | Can cut another cast's phases (Surge, Dash). Already-fired projectiles stay. |
| `cutsAnyCast: true` | Also cuts `interruptible: false` channels (Counter). |
| `interruptible: false` | Surge/Dash cannot cut; only player cancel or stun (channels, Barrier, Fireball charge). |

---

## Full `AbilityDef` schema

Required fields are marked **R**. All others optional unless your spell needs them.

### Identity & UI

| Field | R | Type | Notes |
|-------|---|------|-------|
| `id` | ✓ | string | camelCase key (`"frostBall"`). |
| `name` | ✓ | string | Display name. |
| `description` | | string | Armoury / tooltip blurb. |
| `allowedSlots` | ✓ | `SpellSlotId[]` | Exactly one family per spell today. |
| `defaultSlot` | | `SpellSlotId` | Marks preferred slot in UI. |
| `unlockCostEssence` | | number | Essence to unlock in Spell Armoury. Omit = free starter. |
| `tags` | | `SpellTag[]` | Talent hooks — see Tag Dictionary. |

### Combat core

| Field | R | Type | Notes |
|-------|---|------|-------|
| `cooldownMs` | ✓ | number | Cooldown after cast commits (channels: often on end). |
| `range` | ✓ | number | Aim distance / travel cap (0 = self-centered). |
| `shape` | ✓ | `AbilityShape` | `projectile` \| `aoe` \| `dash` \| `melee` \| `buff` |
| `effectKind` | | `AbilityEffectKind` | Default `"standard"`. See Effect kinds. |
| `damage` | ✓ | number | Primary hit damage (`combatMag` scaled). Can be `0`. |
| `heal` | | number | Heal per pulse. |
| `healTicks` | | number | Number of heal pulses. |
| `radius` | | number | AoE radius, melee arc, projectile hit size, or aura disc. |
| `speed` | | number | Projectile speed (world units/sec). |
| `spawnOffset` | | number | Distance in front of caster to spawn projectile. |
| `timing` | ✓ | `AbilityTiming` | Phase durations — see above. |

### Hit delivery modifiers

| Field | Type | Notes |
|-------|------|-------|
| `knockback` | number | Radial push distance (world units). |
| `knockbackMs` | number | Knockback translate duration (default 220). |
| `pull` | number | Yank distance toward origin (or leap distance if `leapToTarget`). |
| `pullMs` | number | Pull translate duration (default 280). |
| `pullStopDistance` | number | Stop pull this far from origin (default 1.2). |
| `leapToTarget` | boolean | Caster leaps to target instead of pulling target (Chain Hook). |
| `executeBelowHpFrac` | number | 0–1; hit kills if target HP% ≤ this (Blood Rush: 0.25). |

### Projectile / aura / zone

| Field | Type | Notes |
|-------|------|-------|
| `aura` | boolean | Traveling disc: ticks `damage` in `radius`, applies `applyAuraSlow` in `slowRadius`. |
| `slowRadius` | number | Slow shell (defaults to `radius`). |
| `tickMs` | number | Aura or ground zone tick interval. |
| `zoneDurationMs` | number | Persistent ground zone lifetime (Firewall, Poison Cloud). |
| `applyAuraSlow` | `StatusApplication[]` | Refreshed each aura tick. |
| `detonate` | object | Sticky projectile secondary blast: `{ delayMs, damage, radius }`. |

### Line / cone / spike specials

| Field | Type | Notes |
|-------|------|-------|
| `spikeCount` | number | Number of hits along line (Spikes, Firewall segments). |
| `spikeStaggerMs` | number | Delay between line pops. |
| `spikeStart` | number | Distance from caster to first pop. |
| `coneHalfAngle` | number | Half-angle in **radians** (cone spells). |
| `mistStartRange` | number | Frost Mist starting cone length. |
| `mistTicks` | number | Frost Mist damage ticks. |
| `mistGrowMs` | number | Ms to grow cone to full `range`. |
| `sweepMs` | number | Silence blade travel time across cone. |
| `sweepBladeHalfAngle` | number | Thin leading edge half-angle (Silence). |

### Travel (dash / leap)

| Field | Type | Notes |
|-------|------|-------|
| `travel.mode` | `"none"` \| `"instant"` \| `"translate"` | Displacement type. |
| `travel.distance` | number | World units (defaults to `range`). |
| `travel.durationMs` | number | Translate duration (defaults to `impactMs`). |
| `travel.takeoffDelayMs` | number | Delay before leaving ground (Jump Slam). |
| `travel.effectOnArrive` | boolean | Defer damage until translate ends (Jump Slam). |
| `travel.progressEase` | `"linear"` \| `"leap"` | Arc easing. |
| `travel.hitAlongPath` | boolean | Damage enemies crossed during dash (Blood Rush). |

### I-frames

| Field | Type | Notes |
|-------|------|-------|
| `iFrames.startMs` | number | Offset from cast start. |
| `iFrames.durationMs` | number | Invulnerability window length. |

### Combo (multi-hit M1)

| Field | Type | Notes |
|-------|------|-------|
| `combo.hits` | number | Swings before cooldown (> 1). |
| `combo.continueWindowMs` | number | Gap to chain next swing. |
| `combo.moveMul` | number | Move speed during chain. |
| `combo.damageByHit` | number[] | Per-swing damage override. |

### Status application

```ts
interface StatusApplication {
  statusId: string;      // key in STATUSES catalog
  durationMs?: number;   // override catalog default
  stacks?: number;
  chance?: number;       // 0–1, default 1
}
```

| Field | Type | Notes |
|-------|------|-------|
| `applyOnHit` | `StatusApplication[]` | On enemies hit by effect. |
| `applyOnSelf` | `StatusApplication[]` | On caster when effect fires. |

---

## `AbilityShape` → standard combat behavior

| Shape | Standard behavior |
|-------|-------------------|
| `projectile` | Spawns projectile at impact toward aim. Contact damage + `applyOnHit`. |
| `melee` | Short-range frontal arc at impact. Supports `combo`. |
| `aoe` | Instant or ground-targeted area at impact / along aim line. |
| `dash` | `travel` displacement; may deal damage on path or arrival. |
| `buff` | Self or aura buff; often `damage: 0` + `applyOnSelf`. |

---

## `AbilityEffectKind` — when to use each

| effectKind | Use for | Server notes |
|------------|---------|--------------|
| `standard` | **Default.** Projectiles, melee, simple AoE, knockback, pull, buffs, auras, detonate. | Shape + fields drive behavior. |
| `spikeWave` | Staggered ground spikes along aim (Spikes). | Needs `spikeCount`, `spikeStaggerMs`, `spikeStart`. |
| `coneChannel` | Expanding frost cone while channeling (Frost Mist). | `mistTicks`, `mistGrowMs`, `coneHalfAngle`. |
| `silenceSweep` | Blade sweeps across cone (Silence). | `sweepMs`, `sweepBladeHalfAngle`. |
| `pulseHeal` | Self-centered heal pulses (Groove). | `heal`, `healTicks`, `radius`. |
| `healBeam` | Forward narrow heal beam channel. | `coneHalfAngle` as beam width. |
| `lifeLeech` | Drain beam: damage + self heal (%). | `holdChannel: true`. |
| `decoy` | Spawn clone + cloak. | Clone walks to aim. |
| `firewall` | Line wall zone perpendicular to aim. | Reuses spike line fields for segments. |
| `volcano` | Placed erupting obstacle + rock rain. | Blocks movement. |
| `poisonCloud` | Lingering poison zone (no direct damage). | Status-only ticks. |
| `smokeBomb` | Self-centered weaken cloud + cloak. | Cloak tied to zone presence. |
| `holyGround` | Ally buff zone at feet. | Refreshes `holyBlessed`. |
| `magmaOrbs` | Twin arcing orbs to meet point. | Custom flight + dual blast. |
| `protectionBubble` | Dome blocks inbound projectiles. | Locked cast at origin. |
| `shrooms` | Plant up to 3 mushrooms (ally heal / enemy poison). | Stage-based traps. |
| `spiritForm` | Husk + spirit split + link stun. | Recast snaps back. |
| `riftFissure` | Two linked walk-through portals. | Two-step placement. |
| `fireball` | Charge-scaled projectile + burn zone. | `confirmOnRelease`, charge lerp. |

**Adding a new `effectKind` requires:** handler in `apps/game-server/src/combat/CombatSystem.ts`, optional VFX in `apps/web/src/game/vfx/`, and telegraph rules in `castAimPreview.ts`.

---

## Tag Dictionary (`SpellTag`)

Use a subset that honestly describes the spell. Talents match via `abilityHasTags`.

`Projectile`, `Explosion`, `Area`, `Nova`, `Cone`, `Line`, `Melee`, `Dash`, `Blink`, `Channel`, `Instant`, `Cast`, `Damage`, `Healing`, `HealOverTime`, `Shield`, `Self`, `Ally`, `SingleTarget`, `MultiHit`, `DamageOverTime`, `Debuff`, `Control`, `CrowdControl`, `Stun`, `Root`, `Silence`, `Fear`, `Slow`, `Knockback`, `Pull`, `Knockup`, `Movement`, `Haste`, `Defense`, `Defensive`, `Barrier`, `Summon`, `Obstacle`, `Wall`, `GroundEffect`, `Combo`, `Cooldown`, `Utility`, `Stealth`, `Reveal`, `Counter`, `Reflect`, `Pierce`, `Homing`, `Chain`, `Trap`, `Persistent`, `Buff`, `Cleanse`, `Purge`, `Interrupt`, `Resource`, `SpellSlot`

---

## Status catalog (apply via `statusId`)

| id | name | mechanic | Default duration | Key effect |
|----|------|----------|------------------|------------|
| `stunned` | Stunned | stun | 800ms | No move, no cast |
| `rooted` | Rooted | root | 1200ms | No move |
| `chained` | Chained | root | 500ms | Chain Jump bind |
| `silenced` | Silenced | silence | 1500ms | No cast |
| `slowed` | Slowed | slow | 2000ms | 45% slow (`moveMul: 0.55`) |
| `poisonMiasma` | Miasma | slow | 1800ms | 20% slow in poison cloud |
| `hasted` | Hasted | haste | 3000ms | +25% move |
| `surged` | Surged | haste | 3000ms | +60% move (Surge) |
| `spiritFormed` | Spirit Form | haste | 3500ms | +35% move |
| `cloaked` | Cloaked | stealth | 2000ms | Invisible to enemies |
| `weakened` | Weakened | resist | 3500ms | +20% damage taken |
| `burning` | Burning | dot | 3000ms | `combatMag(4)` / 500ms tick |
| `poisoned` | Poisoned | dot | 5000ms | `combatMag(2)` / 700ms, stacks ×3 |
| `rejuvenated` | Rejuvenation | hot | 8000ms | `combatMag(2)` heal/tick, stacks ×3 |
| `bleeding` | Bleeding | dot | 4000ms | `combatMag(3)` / 500ms tick |
| `frostChill` | Frost Chill | slow | 3000ms | Stacking chill → root at max |
| `grooveGuard` | Groove Guard | resist | 8000ms | DR while Groove channel |
| `grooveShield` | Groove Shield | shield | 8000ms | Absorb from lonely pulse |
| `handShielding` | Hand Shield | — | channel | Blocks projectiles |
| `protectiveInstinct` | Protective Instinct | — | — | Counter riposte resist |
| `overflowShield` | Overflow Shield | shield | — | Talent overflow |
| `fifthSpellCadence` | Fifth Cadence | empower | permanent | Talent tracker |
| `barrier` | Barrier | shield | 3000ms | Absorb bubble |
| `bubbleShield` | Bubble Shield | shield | zone | Protection Bubble absorb |
| `counterArmed` | Counter Ready | — | 1200ms | Armed counter stance |
| `revengeArmed` | Revenge Ready | — | 1200ms | Armed revenge stance |
| `revengePhased` | Revenge Phase | — | brief | Teleport behind attacker |
| `counterHaste` | Counter Haste | haste | 3000ms | +20% move after counter |
| `counterEmpowered` | Counter Power | empower | 3000ms | +20% damage dealt |
| `holyBlessed` | Holy Blessed | resist+empower | refreshed in zone | +60% resist, +30% damage dealt |

**New statuses** require an entry in `packages/shared/src/statuses.ts` plus server tick rules if non-standard.

---

## Animation mapping

Spells need a clip from `hero.glb` (Mixamo). Configure in `apps/web/src/game/animation/animationConfig.ts` → `abilityAnimationBindings`.

| Mixamo / logical clip | Example spells |
|-----------------------|----------------|
| `magic_1h` (Standing 1H Magic Attack 01) | bolt, grasp, chainJump, surge |
| Standing 1H Magic Attack 02 | frostBall |
| Standing 1H Cast Spell 01 | barrier, shrooms, riftFissure |
| Standing 1H Magic Attack 03 | spikes |
| Standing 2H Magic Attack 03 | frostMist, lifeLeech |
| Casting Spell | fireball (charge + throw) |
| Standing 2H Magic Attack 04 | healBeam |
| Standing 2H Magic Area Attack 01 | firewall, holyGround, volcano, protectionBubble |
| Standing 2H Magic Attack 05 | magmaOrbs |
| Right Hook | poisonDart, silenceSweep |
| Baseball Pitching | iceLance |
| magic_aoe | gust (Push Back) |
| Standing Melee Attack Downward | poisonCloud, smokeBomb, crescent |
| Dual Weapon Combo | crescent combo chain |
| Jump Attack | smash (Jump Slam) |
| dive | dash |
| Female Dance Pose | counter, revenge |
| Standing Block Start/Idle/End | handShield |
| praying | portal (Teleport) |
| Standing To Crouched / Crouched To Sprinting | decoy, bloodRush |
| Jazz Dancing | groove |

Bake list: `tools/spell_cast_bake_actions.json`

---

## Authoring checklist (new spell)

1. Pick **slot family** and check no duplicate role conflict with siblings in that family.
2. Write **id**, **name**, **description**, **tags**, **unlockCostEssence**.
3. Choose **shape** + **effectKind** (default `standard` if possible).
4. Set **cooldownMs**, **range**, **damage**/`heal` using `combatMag()` for HP values.
5. Define **timing** phases; set `cancelUntilPhase` and `interruptible`.
6. Add **applyOnHit** / **applyOnSelf** referencing existing `statusId`s.
7. Add special fields (knockback, travel, combo, zone, channel…) as needed.
8. Register in `ABILITIES` in `packages/shared/src/abilities.ts`.
9. Add **animation binding** + VFX catalog entry if new visuals needed.
10. If non-standard behavior, implement **CombatSystem** handler for new `effectKind`.
11. Update `DEFAULT_ABILITY_BY_SLOT` only if this becomes a starter spell.

---

## Spell templates

### Fast projectile (Bolt-like)

```ts
myBolt: {
  id: "myBolt",
  name: "My Bolt",
  description: "Short description.",
  cooldownMs: 800,
  range: 12,
  shape: "projectile",
  effectKind: "standard",
  tags: ["Projectile", "Damage", "SingleTarget", "Cast"],
  damage: combatMag(10),
  speed: 22,
  spawnOffset: 0.5,
  allowedSlots: ["m1"],
  unlockCostEssence: 80,
  timing: {
    anticipationMs: 80,
    castMs: 120,
    impactMs: 80,
    recoveryMs: 100,
    cancelUntilPhase: "cast",
  },
  applyOnHit: [{ statusId: "slowed", durationMs: 1000 }],
},
```

### Self buff (Surge-like)

```ts
myBuff: {
  id: "myBuff",
  name: "My Buff",
  description: "Short description.",
  cooldownMs: 12000,
  range: 0,
  shape: "buff",
  tags: ["Buff", "Self", "Haste", "Instant"],
  damage: 0,
  allowedSlots: ["space"],
  unlockCostEssence: 90,
  timing: { anticipationMs: 70, castMs: 90, impactMs: 60, recoveryMs: 100 },
  applyOnSelf: [{ statusId: "hasted", durationMs: 3000 }],
  interruptsOtherCasts: true,
},
```

### Ground line (Spikes-like)

```ts
mySpikes: {
  id: "mySpikes",
  name: "My Spikes",
  description: "Short description.",
  cooldownMs: 5000,
  range: 10,
  shape: "aoe",
  effectKind: "spikeWave",
  tags: ["Line", "GroundEffect", "Damage", "MultiHit", "Cast"],
  damage: combatMag(4),
  radius: 0.55,
  spikeCount: 7,
  spikeStaggerMs: 40,
  spikeStart: 0.85,
  allowedSlots: ["e"],
  unlockCostEssence: 100,
  timing: { anticipationMs: 70, castMs: 150, impactMs: 220, recoveryMs: 140, cancelUntilPhase: "cast" },
  applyOnHit: [{ statusId: "poisoned" }],
},
```

### Channeled cone (Frost Mist-like)

```ts
mySpray: {
  id: "mySpray",
  name: "My Spray",
  description: "Short description.",
  cooldownMs: 14000,
  range: 10,
  shape: "aoe",
  effectKind: "coneChannel",
  tags: ["Cone", "Channel", "Damage", "Debuff", "Control"],
  damage: combatMag(3),
  coneHalfAngle: 0.65,
  mistStartRange: 3,
  mistTicks: 8,
  mistGrowMs: 600,
  tickMs: 200,
  allowedSlots: ["r"],
  unlockCostEssence: 120,
  timing: {
    anticipationMs: 90,
    castMs: 120,
    impactMs: 1600,
    recoveryMs: 160,
    cancelUntilPhase: "impact",
  },
  interruptible: false,
  applyOnHit: [{ statusId: "frostChill", stacks: 1 }],
},
```

---

## Complete spell catalog (35 spells)

Damage/heal shown as **in-game HP** (after `combatMag` ×10). Essence `0` = starter / free with default loadout.

### M1 — LMB (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `bolt` | Bolt | 0.3s | 12 | 110 | 0 | standard | Fast poke projectile |
| `shrooms` | Spore Shrooms | 8s | 10 | 0 | 120 | shrooms | Plant 3 traps; ally heal / enemy poison burst |
| `iceLance` | Ice Lance | 0.75s | 14 | 120 + 100 blast | 80 | standard | Sticky spike; 1.4s detonate r2 |
| `crescent` | Crescent | 0.55s | 2.2 | 70/70/110 combo | 80 | standard | 3-hit melee chain |
| `lifeLeech` | Life Leech | 0* | 9 | tick | 100 | lifeLeech | Hold channel; heal 40% of damage |

\*Life Leech CD starts on channel end.

### M2 — RMB (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `smash` | Jump Slam | 9s | 4 | 120 | 0 | standard | Leap slam; stun 1s; iframes |
| `frostBall` | Frost Ball | 7s | 12.5 | 30/tick aura | 0† | standard | Slow orb; aura r3.9; slow |
| `poisonDart` | Poison Dart | 4.5s | 11 | 40 | 80 | standard | Fast dart; poison stack |
| `magmaOrbs` | Magma Orbs | 14s | 12 | 260 blast | 120 | magmaOrbs | Twin arcing fire orbs |
| `handShield` | Hand Shield | 12s | 0 | 0 | 100 | standard | 3.5s channel; block projectiles |

†Frost Ball is starter via default loadout (`unlockCostEssence: 100` in def, but starters cost 0 to equip).

### Space (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `surge` | Surge | 10s | 0 | 0 | 0 | standard | +60% move 3s; cuts casts |
| `spiritForm` | Spirit Form | 16s | 5 | 0 | 120 | spiritForm | Husk + spirit dash; link stun |
| `riftFissure` | Rift Fissure | 18s | 10 | 0 | 120 | riftFissure | Two linked portals 10s |
| `dash` | Dash | 10s | 5 | 0 | 60 | standard | Dive + iframes + haste |
| `portal` | Teleport | 11s | 10 | 0 | 120 | standard | Hold-charge blink |

### Q (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `gust` | Push Back | 10s | 0 | 120 | 0 | standard | Nova r5; knockback 9.5; slow |
| `counter` | Counter | 12s | 0 | 0 | 80 | standard | 1.2s stance; deny direct hit → buffs |
| `revenge` | Revenge | 12s | 0 | 0 | 100 | standard | Counter but blink behind |
| `decoy` | Decoy | 14s | 0 | 0 | 100 | decoy | Clone + 2s cloak |
| `smokeBomb` | Smoke Bomb | 14s | 0 | 0 | 100 | smokeBomb | Weaken cloud + cloak in smoke |

### E (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `spikes` | Spikes | 4s | 10 | 40 ×9 | 0 | spikeWave | Line poison spikes |
| `grasp` | Grasp | 10s | 12 | 50 | 80 | standard | Pull enemy; slow |
| `chainJump` | Chain Hook | 10s | 12 | 50 | 100 | standard | Leap to target; root 0.5s |
| `poisonCloud` | Poison Cloud | 10s | 9 | 0 | 100 | poisonCloud | Zone poison + miasma slow |
| `silenceSweep` | Silence | 12s | 8 | 0 | 100 | silenceSweep | Cone sweep; silence |

### R (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `barrier` | Barrier | 14s | 0 | 0 | 0 | standard | Shield bubble 300 HP / 3s |
| `frostMist` | Frost Mist | 14s | 11 | 30/tick | 120 | coneChannel | Chill stacks → root |
| `firewall` | Firewall | 14s | 13 | 40/tick | 120 | firewall | Line fire wall |
| `holyGround` | Holy Ground | 16s | 0 | 0 | 120 | holyGround | Ally +60% resist +30% dmg |
| `groove` | Groove | 17s | 0 | heal | 100 | pulseHeal | Jazz heal pulse r5.2; DR 40% |

### F (5 spells)

| id | name | CD | range | dmg | essence | effectKind | notes |
|----|------|-----|-------|-----|---------|------------|-------|
| `fireball` | Fireball | 8s | 14 | charge-scaled | 0‡ | fireball | Charge throw; burn zone |
| `healBeam` | Heal Beam | 20s | 11 | heal/tick | 0 | healBeam | Forward heal channel |
| `bloodRush` | Blood Rush | 14s | 8 | 80 + bleed | 100 | standard | Charge 1s; dash execute ≤25% HP |
| `volcano` | Volcano | 20s | 10 | 140/rock | 140 | volcano | Obstacle + rock rain |
| `protectionBubble` | Protection Bubble | 18s | 0 | 0 | 120 | protectionBubble | Dome blocks inbound shots |

‡Fireball starter via default loadout.

---

## Balance reference

| Knob | Typical range |
|------|----------------|
| M1 cooldown | 0.3s – 1s (combo up to ~2s chain) |
| M2 cooldown | 4s – 9s |
| Space cooldown | 10s – 18s |
| Q / E cooldown | 4s – 14s |
| R cooldown | 14s – 17s |
| F cooldown | 8s – 20s |
| M1 damage | `combatMag(7–12)` per hit |
| Burst / ult damage | `combatMag(12–26)` |
| DoT tick | `combatMag(2–4)` |
| Unlock cost | 60 (dash) – 140 (volcano) |

---

## Files to touch when adding a spell

### A. Bolt-like / reuse existing kit (`effectKind: "standard"`)

| Layer | Path | What to do |
|-------|------|------------|
| Definition | `packages/shared/src/abilities.ts` | Add `AbilityDef` to `ABILITIES` |
| VFX profile | `apps/web/src/game/vfx/profiles/registry.ts` | Clone an existing profile (muzzle / charge / bridged) |
| Color / icon / anim | `vfx/colors.ts`, `SpellIcon.tsx`, `abilityAnimationBindings` | Tint + art + clip |
| Preload | profile `assets?: { textures, glbs }` | **Only if** the spell brings new files |

No server combat change. No new if-chains.

### B. New mechanic (`effectKind` bespoke)

| Layer | Path | What to do |
|-------|------|------------|
| `AbilityEffectKind` union | `packages/shared/src/abilities.ts` | Add the kind string |
| Server handler | `CombatSystem.effectKindFireHandlers()` | **One map entry** → schedule/commit method |
| Schedule impl | `CombatSystem.ts` | New private `scheduleX` / `commitX` |
| VFX profile | `profiles/registry.ts` | `combatFx.onAoe` / `onHit` / `onDash` + `skipLegacyBurst` |
| AoE FX spawn | `vfx/aoeCombatFxHandlers.ts` | **One map entry** if new `onAoe` mode |
| Impact/cast renderer | `vfx/catalog.tsx` + `effects/*` | Only if new mesh/shader |
| Preload | `profile.assets` or `vfx/spellVfxAssets.ts` CORE lists | New textures/GLBs |

### Preload rule (no first-cast lag)

1. Put new texture/GLB URLs on the ability’s `AbilityVfxProfile.assets`, **or** append shared atlases to `CORE_SPELL_VFX_*` in `spellVfxAssets.ts`.
2. Hub/arena loading already calls `collectSpellVfxAssets()` — do not hardcode URLs in `prepareGameAssets`.
3. New **shader programs** (unique materials/blend modes): add a warm mesh in `warmSpellMaterials` (`preloadVfx.ts`) so `VfxWarmup` compiles them under the loading gate.

### Do not

- Add `if (abilityId === "mySpell")` ladders in `combatFxDispatch` or `fireEffect`.
- Ship a new GLB/texture without declaring it in the asset manifest.
- Grow `SpellLightPool` casually (every slot costs every lit material every frame).

---

## Prompt snippet for ChatGPT

Copy everything above this line, then add:

> Design a new spell for slot family **`e`** with theme **lightning chain**.  
> Return a complete `AbilityDef` object in TypeScript using `combatMag()` for damage,  
> reusing existing statuses where possible, `effectKind: "standard"` unless bespoke behavior is required,  
> and list which animation clip to reuse from the Animation mapping table.  
> If bespoke, also list: new `effectKind` name, which VFX profile to clone, and any new texture/GLB paths to put on `profile.assets`.
