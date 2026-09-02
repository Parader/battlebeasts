# Energy & flex slots — design board

Scratchpad for a combat resource ("Energy") and three extra spell slots that spend it.
Nothing here is implemented yet. Promote to `packages/shared/` once the numbers settle.

**Related:** `packages/shared/src/abilities.ts` (SPELL_SLOTS, allowedSlots),
`packages/shared/src/talentKit.ts` (`resolveKit`), `docs/talent-tree-design.md`.

---

## Problem

Combat is cooldown-only. Every fight is "press the thing that is off cooldown", and the
build is locked in before the match starts. There is no in-fight resource decision.

Separately, the loadout is rigid. Each of the 36 abilities is locked to exactly one of
seven slot families, roughly five options each:

```
m1  m2  space  q  e  r  f
```

You pick one spell per family and can never take two from the same one. Players who want
Counter *and* Decoy (both `q`) simply cannot.

## Goal

One mechanic that solves both: a burst resource that buys **extra picks from families you
have already spent**, priced so it cannot be abused.

Explicit non-goal: a sustain resource. Mana/rage gate how much you can cast over time,
which means every spell needs a cost balanced against every possible kit, and a bad build
can lock itself out of playing. Energy is strictly additive — worst case you play your
normal kit. Keep it on that side of the line.

---

## Shape

Three **flex slots** bound to `1`, `2`, `3`. Any spell from any family may go in one,
including a second spell from a family already filled. Firing a flex slot costs Energy
**and** puts the spell on its normal cooldown.

Keeping the cooldown is the load-bearing decision. Two independent gates:

| Gate | Prevents |
| --- | --- |
| Cooldown | Casting the same flex spell twice in a row |
| Energy | Having three extra spells permanently available |

Because cooldowns are already tuned, the only genuinely new number per ability is its
Energy cost — and that can be derived rather than hand-authored.

### Readability

The flex pool is the *same 35 spells*, so no new animations, VFX, or counterplay patterns
enter the game. An opponent's possibility space widens but the vocabulary does not. This
is why three slots is acceptable here where a bar of brand-new spells would not be.

**Enemy Energy must be visible.** A hidden burst resource makes reads impossible in a 1v1
arena. Visible, a full bar becomes a threat in itself and holding it is a mind game.

---

## Numbers (first pass, all provisional)

Bar is `0..100`. Starts at **0 every round** — no carry between rounds. This gives a
pacing arc where openings are pure kit and late-round is where payoff moments happen.

### Generation

Player HP is `combatMag(200)` = **2000** (`packages/shared/src/combatMagnitude.ts`).

Rates are stated as **damage per pip**, so they scale with the 8-pip bar above.

| Source | Rate | As % of a health bar | Note |
| --- | --- | --- | --- |
| Damage dealt | 1 pip / 150 | 7.5% | |
| Damage taken | 1 pip / 120 | 6% | Richer — comeback pressure |
| Healing done | 1 pip / 150 | 7.5% | |

**Hard cap ~1 pip/sec.** Eight seconds of sustained pressure is the fastest anyone can
fill from empty. This is what kills the 1v1v1 exploit where a focused player farms Energy
off two attackers, and removes the incentive to deliberately eat chip damage.

**Target: 2–3 full bars per round.** Sanity check against a won 1v1 round where the winner
deals 2000 and takes ~1200:

```
dealt   2000 / 150  = 13.3 pips
taken   1200 / 120  = 10.0 pips
                      -----------
                      23.3 pips  ≈ 2.9 bars
```

So a round affords roughly three `f` casts, or six `q`/`e`, or some mix — a real but
bounded addition on top of the normal kit. Tune the divisors to move this target; they are
the single knob that controls how much Energy changes the game.

### Cost — priced by slot family

Cost is a flat rate per **slot family**, not per spell.

This is safe because **every ability has exactly one entry in `allowedSlots`** (verified:
no ability lists two). A spell's family is intrinsic to it, so "cost by family" and "cost
by spell" are the same statement. There is no rebinding exploit, because there is no
rebinding — you cannot move a `q` spell into the `f` family.

The bar is **8 pips**, which makes the intended fractions exact integers:

| Family | Cost | Fraction | Casts per full bar |
| --- | --- | --- | --- |
| `m1` LMB | 2 pips | ¼ | 4 |
| `m2` RMB | 4 pips | ½ | 2 |
| `q` / `e` | 6 pips | ¾ | 1 |
| `space` | 6 pips | ¾ | 1 |
| `r` | 6 pips | ¾ | 1 |
| `f` | 8 pips | full | 1 |

These rates were doubled from an earlier, gentler curve (⅛ / ¼ / ½ / ¾ / full). At those
prices a flex spell was cheap enough to fold into a normal rotation, which made it a
permanent extra button instead of the occasional burst it is meant to be. Everything from
`q` upward is now a once-per-bar decision, and only `m1` is repeatable within a fill.

A segmented bar also reads far better than a percentage at a glance, which matters for the
opponent-visibility mind game: "they have 6 pips, an `r` is live" is a read a player can
make in a fraction of a second.

**Per-spell overrides allowed for outliers.** Family rate is the default, not a law. The
one clear outlier today is **Rift Fissure** (`space`, 26 s cooldown — more than double the
other four `space` spells at 10–11 s); it is overridden to 8 pips rather than priced at
the family's 6.

Earlier drafts of this doc derived cost from `cooldownMs`. That produced nearly the same
curve — `m1` all clustered at one value, `q` at another, `f` at another, because cooldowns
were already authored per family tier. The flat family rate gets there directly and is far
easier to read, teach, and tune. The derived formula is kept only as a sanity check when
adding a new spell: if its cooldown is wildly out of step with its family, that is a
signal it needs an override.

---

## Map pickups

`pickup` is a map element type (see `packages/shared/src/maps/elements.ts`), so
placing one is authoring, not code. Params: effect, magnitude, buff duration,
respawn, and a first-spawn delay.

| Effect | Kind | Unit | Default |
| --- | --- | --- | --- |
| Heal | instant | hp | 300 |
| Energy | instant | pips | 2 |
| Absorb shield | instant | hp | 250 |
| Move speed | buff | × | 1.3 |
| Power | buff | × | 1.5 |
| Cooldown rate | buff | × | 1.25 |

**Pickups change what Energy is, and that is the point.** Combat-only
generation makes Energy a reward for fighting well. A contested pickup on the
map makes part of it a reward for *positioning* well — players have to leave a
favourable spot to take one, which is a real trade and exactly the kind of
decision the resource was added to create.

Two consequences worth holding on to:

1. **Pickups spend from the same budget.** The 2–3 bars per round target above
   is the total. A map with a 2-pip energy pickup on a 30 s respawn adds ~4
   pips a round, so roughly half a bar — meaningful, and it has to come out of
   the combat generation rates rather than on top of them, or Energy inflates
   and the flex slots stop being a considered choice.
2. **In 1v1v1 a pickup is a flashpoint.** Two players contesting one is a third
   player's opening. That is good design, not a bug, but it argues for a
   `firstSpawnMs` delay on the heaviest pickups so the round opens on position
   rather than on a scramble.

Walk-over radius defaults to 1.2 m rather than an area you stand in: a pickup
you can miss by a step is a skill expression, one you soak from three metres
away is not.

### Runtime, not yet built

Authoring works today; nothing consumes it. Still needed:

- Server-side pickup state per round (available / taken / respawning), replicated.
- Effect application in `CombatSystem`, with buffs as timed modifiers.
- Round reset returning every pickup to its `firstSpawnMs` schedule.
- A visible model and a respawn timer readout, since a contested pickup is only
  contestable if both players can see when it comes back.

---

## Talent hooks

Energy generation is a good talent surface because talents can change **which source**
matters, tying the resource to a playstyle instead of flatly boosting it.

| Working name | Effect | Side |
| --- | --- | --- |
| Bulwark | +50% from damage taken, −30% from damage dealt | Generation |
| Aggressor | Mirror of Bulwark | Generation |
| Mender | ×1.5 from healing done | Generation |
| Efficiency | −1 pip on `r` and `f` casts | Cost |
| Capacity | +2 max pips (bar of 10) | Capacity |

**Percentages work on generation but not on cost.** Generation accumulates internally as a
float, so `+50%` is meaningful there. Cost is an integer pip count, so `−15% cost` rounds
to nothing on cheap spells and is invisible on the rest. Cost talents have to move whole
pips — hence Efficiency being scoped to `r`/`f`, where one pip is a real discount without
making `m2` spells free.

Capacity at +2 pips is narrow but pointed: a 10-pip bar is the only way to bank an `f`
(8) and still have anything left, or to hold `r` + `m2`.

**Avoid flat `+% generation`.** It compounds with the entire kit and becomes a mandatory
pick, which is the failure mode called out in `docs/talent-tree-design.md`. The talents
above all redirect *which source* matters rather than raising the total.

---

## Keybindings

Lives in this doc because the flex slots are what forces it: `1`/`2`/`3` would otherwise
become a fourth set of hardcoded keys, and untangling them later costs more than doing it
once. Players have also asked for it independently.

**Scope: gameplay actions except movement.** The seven spell slots, the three flex slots,
cancel cast, interact, and emote. WASD stays fixed — it is the one binding nobody has
asked to change, and leaving it out keeps the conflict surface small.

### Storage: `profiles.keybindings`

Account-synced, not localStorage. A `jsonb` column on `profiles`, following the
`cosmetics_equipped` precedent already there (RLS is enabled on the table). Bindings
follow the player to another machine, which is the whole point of asking for them.

Shape is action id → input token, sparse: only bindings that differ from the default are
stored, so adding a new action later does not require backfilling every row.

```json
{ "slot.q": "KeyZ", "flex.1": "KeyX", "cast.cancel": "KeyG" }
```

### Three constraints found in the current code

1. **Two keys are contextual and must not become free-standing actions.** `Space` is slot
   3 *and* the interact key when `nearInteractRef` is a stand or dummy
   (`useBaseCityRoom.ts` ~1734). `F` is slot 7 *and* the confirm for a held fireball
   (~1713). Both stay welded to their slot; rebinding the slot moves the contextual use
   with it. Exposing them separately produces a state where you can interact but not cast.

2. **Keep `e.code`, fix the display.** The handler switches on `e.code`, which is physical
   position — so WASD already lands on ZQSD for an AZERTY keyboard with no remapping at
   all. That is correct and should not change. What is wrong is showing "W" to someone
   whose key is labelled Z: the settings UI should resolve labels through
   `navigator.keyboard.getLayoutMap()` and fall back to the raw code when unavailable.

3. **Conflict detection is not optional.** With this many bound keys, a silent overwrite
   means a player rebinds one thing and loses another without being told. Rebinding shows
   what currently holds the key and requires a confirm to steal it.

### Where the code changes

The input surface is far smaller than it looks — nearly all of it is one file.

- `useBaseCityRoom.ts` ~1670–1817: the `switch (e.code)` keyboard handler becomes a lookup
  from `e.code` to an action id. This is the main change.
- `useBaseCityRoom.ts` ~1820–1925: same for `e.button` in the mouse handler.
- `MOVE_KEY_CODES` (~76) is a literal set today; derive it from the movement bindings so
  the emote-cancel check cannot drift out of sync.
- Spell slots are already matched by an input *string* through `slotIndexForInput`
  (`abilities.ts` ~3098), so the slot path needs no change below the handler.
- New `keybindings.ts` store shaped like `audioSettings.ts` (module value, pub/sub,
  `normalize()` for defaults), but persisting to Supabase instead of localStorage.
- New Controls section in `ui/SettingsPanel.tsx`, reusing `KeyGlyph` / `MouseGlyph` from
  `ui/InputGlyph.tsx`.

---

## Open questions

1. ~~**`m1` at 1 pip is 8 casts per bar — is that too many?**~~ Settled: `m1` is 2 pips,
   4 casts per bar. A timed-window price (pay once, keep the spell for N seconds) is still
   the fallback if per-cast turns out to read badly on a 300 ms cooldown like Bolt.
2. **Life Leech has a 0 ms cooldown and is a channel.** "Per cast" is undefined for it.
   Either exclude it from flex slots or bill it per tick / per second of channel. Note the
   separate fix already in place: flex spells generate no Energy for the caster, which is
   what stopped Life Leech paying for itself.
3. ~~**`space` is unresolved.**~~ Settled: priced with `q`/`e`/`r` at 6 pips rather than
   below them, since a second escape is at least as strong as a second nuke. Rift Fissure
   still overrides to 8.
4. **Duplicate-family burst.** Two `r` spells or two `f` spells is the intended headline
   feature, but it is also the biggest burst spike in the game. Needs playtesting before
   deciding whether same-family pairs need a surcharge.
5. **Interaction with Counter / Revenge.** A flex-slotted Counter means two counter
   windows in one fight. Probably fine, worth watching.
6. **Do flex slots need to be unlocked?** `MAX_LOADOUT_SLOTS` / `MAX_COIN_LOADOUT_SLOTS`
   in `playerUnlocks.ts` suggests loadout breadth is already progression-gated; flex slots
   could follow the same pattern rather than all three being free.
7. **Do pickups grant Energy past the per-second cap?** The cap exists to stop
   damage farming, but a pickup is a discrete event, not a rate. Probably it
   should bypass the cap and simply add; worth confirming it cannot be chained.
8. **Buff stacking.** Two Power pickups taken back to back: refresh the
   duration, or multiply to ×2.25? Refresh is the safer default.
9. **Do flex slots default to `1`/`2`/`3` at all?** Those keys are a stretch from WASD
   during a fight. `Shift`+`Q`/`E`/`R` or the side mouse buttons may be reachable enough
   to matter — worth trying before the defaults calcify, since rebinding is opt-in and
   most players never touch it.
10. **PvE tuning.** Generation rates are derived from PvP damage throughput. Wave content
   with many low-HP zombies may generate far faster and needs its own check.

---

## Build order (not started)

Energy touches server state, replication, the damage and heal paths, the HUD, key
bindings, the loadout UI, persistence, talents and pickups. Building all of that before
playing any of it is the failure mode: if the fill rate turns out wrong, retuning means
touching every layer at once.

**The riskiest number cannot be settled on paper.** The generation divisors were derived
from a hypothetical 2000-damage round — that is arithmetic, not playtesting. So the order
below front-loads that question and keeps every phase independently playable.

### Phase 1 — generation only, nothing spends it

- `energy` on player state as a float `0..maxPips`, server-authoritative, replicated for
  self *and* opponents. Float internally so generation percentages stay meaningful; only
  spending deals in whole pips.
- Generation hooks in `CombatSystem` where damage and heal are already applied, behind
  the per-second cap.
- Reset to 0 on round start.
- 8-segment HUD bar, plus the opponent's pips on the target frame.

*Exit criteria:* play several rounds and confirm the bar fills 2–3 times. If it does not,
fix a divisor — at this point nothing else depends on it.

### Phase 2 — one flex slot on `1`

- `FLEX_COST_BY_FAMILY: Record<SpellSlotId, number>` plus a per-ability override map
  (Rift Fissure → 8). The family table *is* the source of truth; nothing is derived.
- Spend on cast, and put the spell on its normal cooldown as well.
- Slot greys out when unaffordable.

*Exit criteria:* one extra spell at a real price is fun. The whole mechanic is present in
miniature here — if it does not work with one slot, three will not save it, and almost
nothing has been spent finding out.

### Phase 3 — keybindings

`profiles.keybindings` migration, the `keybindings.ts` store, the handler rewrite from
`switch (e.code)` to an action lookup, and a Controls section in `SettingsPanel`. See the
Keybindings section above.

Placed here deliberately: after one flex slot exists to prove the concept, but *before*
slots 2 and 3 are added. That way exactly one flex key is ever hardcoded, and the two new
ones arrive already bindable.

### Phase 4 — widen to three slots

Loadout UI for slotting `1`/`2`/`3`, persistence, and validation. Mostly interface work
with no remaining design risk once Phase 2 lands.

### Phase 5 — talents

`resolveKit` picks up the modifiers alongside the existing ones. Deliberately after
tuning: a talent that redirects generation is meaningless until generation feels right.

### Phase 6 — pickup runtime

Per-round pickup state, effect application, round reset, respawn timer readout. Last
because pickups have to fit inside a generation budget that is already settled — see the
Map pickups section.
