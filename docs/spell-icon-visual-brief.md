# Battle Beasts — Spell Icon Visual Brief

**Purpose:** Feed this document to **Flux Schnell** (and similar models) to generate a **matching World of Warcraft–style spell icon library**.  
**Code ids:** filenames must match `abilityId` in `packages/shared/src/abilities.ts`. Drop PNGs in `apps/web/public/icons/spells/{id}.png`.  
**Count:** 47 player spells.

Flux Schnell has **no negative prompt**. Everything below is written as **what to paint**, not what to avoid.

---

## How to generate (Flux Schnell)

1. One prompt per spell: **Master style lock** first, then the **Subject** line. Keep it in that order — Schnell weights the start of the prompt more.
2. Do **not** add “no text / no UI / no anime”. Schnell often ignores those and they waste tokens. The style lock already describes an unlabeled painted game icon.
3. Keep **guidance / CFG low** (typical Schnell: 1–3.5). High CFG makes it ignore the lock and invent extra objects.
4. Same **seed family** if the UI allows (e.g. 1000–1044) so lighting stays consistent. If not, generate `bolt` first and **img2img / style-ref** that icon at low strength (0.15–0.35) for the rest.
5. Square **1024×1024**, then downsample to **512×512**. Crop is the icon itself — empty dark void around the motif, not a screenshot of a hotbar.
6. Name files exactly: `{id}.png` (camelCase).

If a render comes back with letters, a full character, or a second object: **reroll the same prompt**. Do not append a list of bans.

---

## Master style lock (paste first in every prompt)

Keep this block **verbatim**. It is written for Schnell: short clauses, all positive, subject-first.

```
World of Warcraft spell icon, Blizzard painted game icon, square ability tile,
classic WoW UI icon painting, oil-and-digital fantasy illustration,
one centered motif filling the square, strong silhouette, high contrast, saturated color,
3/4 view from upper-right, frozen climax pose,
warm key light from upper-left, cool rim light on the right edge,
soft dark vignette, dark atmospheric void behind the subject,
thin dark stone inner bevel around the square,
unlabeled game asset, 256px icon
```

### Orientation / composition lock

| Rule | Do this |
|------|---------|
| Camera | Always **3/4 view**, object slightly turned so the **right-front** face is visible |
| Horizon | Subject floats in a **dark atmospheric void** or a **tight matching-color backdrop** |
| Scale | One hero motif. Hands only as a **gauntleted caster hand from the lower-left** |
| Lighting | Same as WoW: **rim-lit**, readable at 48px |
| Border | Same **thin dark bevel** on every icon |
| Motion | Frozen peak moment (cast climax), single still frame |

### Palette families (keep these distinct)

| Family | Hex anchors | Used by |
|--------|-------------|---------|
| Arcane cyan | `#38bdf8` `#67e8f9` | Bolt, Surge, Arc Thread, Orbiting Wisp |
| Ice | `#7dd3fc` `#a5f3fc` | Frost Ball, Ice Lance, Frost Mist, Runic Shard |
| Fire / magma | `#f97316` `#ea580c` | Fireball, Firewall, Volcano, Magma Orbs |
| Nature / venom | `#4ade80` `#84cc16` `#4d7c0f` | Shrooms, Spikes, Poison Dart, Poison Cloud |
| Holy / light | `#eab308` `#fde68a` | Holy Ground, Heal Beam |
| Harmony green | `#a9d978` `#6ee7b7` | Soul Relay, Groove |
| Shadow / void | `#3b1f54` `#8b2dce` `#a78bfa` `#6335A5` | Grasp, Void Disc, Soul Mark, Silence, Crushing Sigil, Gravity Well |
| Wind / steel | `#e2e8f0` `#94a3b8` | Push Back, Slipstream, Smoke Bomb, Dash |
| Blood | `#ef4444` `#f87171` | Life Leech, Revenge, Blood Rush |
| Earth / wood | `#a16207` `#8B5A2B` `#166534` | Jump Slam, Underground Pulse |
| Shield blue | `#60a5fa` `#7dd3fc` | Barrier, Hand Shield, Protection Bubble |
| Gold / stance | `#f5c542` | Counter |

---

## Per-spell prompts

Each block = **Filename** + **Subject** (append after the master style lock).

---

### M1 — Primary

#### `bolt.png` — Bolt
Fast single-target magic poke.

**Subject:** A compact cyan-white lightning bolt / arcane dart frozen mid-flight, crackling core, short comet tail. Palette `#38bdf8`. Clean, iconic, starter spell.

#### `arcThread.png` — Arc Thread
Tether that discharges a second shock.

**Subject:** Two points of cyan electric light linked by a taut glowing **filament / thread**, a spark bursting at the far end. Palette `#67e8f9`. The hero is the thread.

#### `soulMark.png` — Soul Mark
Psychic projectile that stacks marks, then ruptures.

**Subject:** A smoky violet soul orb with a faint rune-eye inside, wisps of shadow curling off it. Palette `#a78bfa`. Soft smoke and psyche, organic wisps.

#### `voidDisc.png` — Void Disc
Throwing disc that flies out and returns.

**Subject:** A dark-violet chakram / circular void disc edge-on 3/4, purple inner glow, motion-implied return trail wrapping halfway. Palette `#8b2dce`. Round throwing weapon.

#### `runicShard.png` — Runic Shard
Slow crystal that shatters into fragments.

**Subject:** A pale cyan ice-crystal **shard** with etched runes, hairline cracks, tiny fragment chips breaking off. Palette `#6ee7ff`. Broken crystal chunk.

#### `orbitingWisp.png` — Orbiting Wisp
Small spirit that orbits the caster.

**Subject:** A small painterly will-o’-wisp, cyan core, trailing motes hinting at a circular orbit. Palette `#38bdf8`. Tiny spirit of light.

#### `shrooms.png` — Spore Shrooms
Planted mushrooms: heal allies, poison enemies.

**Subject:** A single plump fantasy mushroom, green cap with spore specks, faint dual aura (warm heal glow on one side, toxic haze on the other). Palette `#4ade80`. One toadstool filling the square.

#### `iceLance.png` — Ice Lance
Thrown ice spike that sticks then detonates.

**Subject:** A sharp ice spear / icicle lance, frost crystals along the shaft, frozen mist at the tip. Palette `#7dd3fc`. Long spike.

#### `crescent.png` — Crescent
Close-range three-hit slash combo.

**Subject:** A silver-white crescent slash of magic, blade-arc mid-swing, sparkle chips. Palette `#f8fafc`. Arc of a cut.

#### `lifeLeech.png` — Life Leech
Hold-channel drain beam, heal from damage.

**Subject:** A two-tone stream: red blood-energy pulling inward on the left, green vitality feeding a small heart-core on the right. Palette `#ef4444` + `#6ee7b7`. Drain and siphon.

---

### M2 — Secondary

#### `smash.png` — Jump Slam
Leap and slam the ground, stun.

**Subject:** A heavy stone fist or boot crashing into cracked earth, shock-ring dust, brown-gold impact. Palette `#a16207`. Ground slam.

#### `frostBall.png` — Frost Ball
Slow drifting frost orb with a chilling aura.

**Subject:** A large spherical snow-ice orb, swirling frost disc around it, slow and heavy. Palette `#7dd3fc`. Round orb.

#### `astralChain.png` — Astral Chain
Chain tether that limits enemy distance.

**Subject:** A glowing indigo spectral chain, heavy links, astral runes on a few links, taut between two faint points. Palette `#6954D8`. Spectral chain.

#### `undergroundPulse.png` — Underground Pulse
Vines burst from the ground, damage + slow.

**Subject:** Magical thorny vines erupting from cracked soil, earth-brown and root-green, burst from below. Palette `#8B5A2B`. Living vines.

#### `slipstream.png` — Slipstream
Wind lane that hastes you.

**Subject:** A rushing ribbon of pale wind, streaking feathers of air, silver-white motion. Palette `#e8eef5`. Directional wind corridor.

#### `soulRelay.png` — Soul Relay
Bind heal to self or ally; next hit heals them.

**Subject:** Two linked soul motes connected by a light-green life thread, small heal spark at the far mote. Palette `#a9d978`. Soul bond.

#### `crushingSigil.png` — Crushing Sigil
Delayed geometric rune that collapses and explodes.

**Subject:** A precise geometric violet rune on dark stone, collapsing inward, tiny white-violet core flash. Palette `#c176ff` `#32134A`. Hard-edged geometry.

#### `poisonDart.png` — Poison Dart
Fast venom dart, poison stacks.

**Subject:** A short fletched dart with dripping green venom on the needle tip. Palette `#4d7c0f`. Thrown dart.

#### `magmaOrbs.png` — Magma Orbs
Two magma orbs that arc and collide.

**Subject:** Two molten lava orbs close together, about to collide, orange fire spray. Palette `#f97316`. Twin orbs.

#### `handShield.png` — Hand Shield
Blue disc raised in front of the hand, blocks projectiles.

**Subject:** A gauntleted hand from the lower-left holding a round translucent blue energy disc, a projectile spark dying on the disc. Palette `#60a5fa`. Hand and disc.

---

### Space — Mobility

#### `surge.png` — Surge
Crackling self haste buff.

**Subject:** A burst of cyan lightning around a compact energy core, speed streaks. Palette `#67e8f9`. Self haste burst.

#### `spiritForm.png` — Spirit Form
Leave a husk, rush as a spirit.

**Subject:** A translucent pale-indigo spirit silhouette peeling away from a still stone-like husk. Palette `#a5b4fc`. Spirit leaving a husk.

#### `riftFissure.png` — Rift Fissure
Two linked walk-through portals.

**Subject:** Twin oval rift mouths, purple-black interiors, faint matching runes, a tiny figure-silhouette implying passage. Palette `#a78bfa`. Twin rifts.

#### `dash.png` — Dash
Dive forward with iframes.

**Subject:** A blurred green-white dive afterimage streak with motion lines. Palette `#a3e635`. Fast dash.

#### `portal.png` — Teleport
Charge a blink to a landing marker.

**Subject:** A swirling violet teleport glyph / circular portal underfoot, destination spark in the distance. Palette `#a78bfa`. Single blink circle.

---

### Q — Control / defense

#### `counter.png` — Counter
Dance stance; deny the next direct hit, then buff.

**Subject:** A golden mirrored stance emblem / crossed arms of light, gold glow, riposte spark. Palette `#f5c542`. Gold deny.

#### `revenge.png` — Revenge
Same stance; blink behind the attacker.

**Subject:** A crimson afterimage of a dancer vanishing, red silhouette appearing behind a faint foe-shadow. Palette `#ef4444`. Red teleport-riposte.

#### `decoy.png` — Decoy
Clone + cloak.

**Subject:** Two identical hooded silhouettes, one solid, one translucent ghost, grey-blue stealth haze. Palette `#94a3b8`. Duplicate.

#### `gust.png` — Push Back
Circular knockback nova at feet.

**Subject:** A radial wind shockwave from the center, dust and pale air rings expanding. Palette `#e2e8f0`. Omni nova.

#### `smokeBomb.png` — Smoke Bomb
Grey smoke at feet, cloak while inside.

**Subject:** A round iron bomb bursting into thick grey smoke, stealth haze. Palette `#94a3b8`. Bomb and grey smoke.

---

### E — Skill shots / lines

#### `grasp.png` — Grasp
Dark stretching hand yank.

**Subject:** A shadowy clawed hand reaching from lower-left, grasping, void-purple. Palette `#3b1f54`. Hand pull, not a chain.

#### `chainJump.png` — Chain Hook
Hook flies out; you leap to the target.

**Subject:** A heavy iron grappling hook with chain, mid-flight, metallic grey. Palette `#a8a8b0`. Hook head visible — distinct from Astral Chain.

#### `spikes.png` — Spikes
Venomous spikes erupt in a line.

**Subject:** Several green-black thorn spikes bursting from dirt in a short row. Palette `#166534`. Ground spikes.

#### `poisonCloud.png` — Poison Cloud
Thrown vial → lingering toxic cloud.

**Subject:** A glass vial shattering, billowing lime-green toxic cloud. Palette `#84cc16`. Cloud and vial.

#### `silenceSweep.png` — Silence
Cursed shadow crescent that silences.

**Subject:** A violet-black crescent of cursed shadow, a sealed rune mouth motif in the curve. Palette `#a78bfa`. Silence crescent.

#### `gravityWell.png` — Gravity Well
Delayed singularity that snaps enemies inward.

**Subject:** A compact dark-violet gravity core on cracked stone, thin bright edge ring contracting inward, violet-white flash at the center, inward-streaking dust. Palette `#120B1D` `#6335A5` `#A78BFA`. Soft spatial distortion, hard-edged rune reserved for Crushing Sigil.

#### `prismLance.png` — Prism Lance
Razor-thin pierce lance; farther travel means harder hit.

**Subject:** A long thin white prismatic spear tip-on 3/4, cyan and violet edge refraction, short geometric trail, no ice crystals. Palette `#F4F7FF` `#67E8F9` `#A78BFA`. Precision beam-spear, Baseball Pitching / Ice Lance look reserved for Ice Lance.

#### `soulSever.png` — Soul Sever
Spectral blade that severs a soul imprint; snap damage scales with how far the target moved from the strike point.

**Subject:** A thin curved violet-white spectral blade with bright edge and near-black core, faint smoky trail, optional ghostly humanoid imprint behind it connected by an intermittent thread. Palette `#120817` `#2D123D` `#7040A8` `#B880EA` `#ECDFFF`. Separation / afterimage look — not Soul Mark’s accumulating rune corruption.

#### `arcBlade.png` — Arc Blade
Fast 360° magical spin; three consecutive hits.

**Subject:** A luminous cyan-white crescent energy blade tracing a circular cut, bright outer tip, translucent tapered inner body, motion blur ribbon of the spin, no explosion. Palette `#173B55` `#38BDF8` `#A5F3FC` `#F0FDFF`. Magical melee spin — not Crescent’s silver combo flourishes.

#### `bloomingpath.png` — Blooming Path
Slow ground vine that leaves a heal corridor you and allies can stand in.

**Subject:** A living luminous vine tip racing along stone with a short dissolving trail of leaves and tiny blossoms, warm harmony greens, white core glow, no thorns or soil burst. Palette `#315B3D` `#6EE7B7` `#A9D978` `#E8F5B2` `#F5FFE8`. Benevolent nature line — not Underground Pulse’s roots/thorns.

#### `verdantleap.png` — Verdant Leap
Ally leap with shared heal bloom.

**Subject:** A mage mid-leap toward a teammate silhouette, green-gold leaf trail and dual heal blooms at feet, Harmony palette `#315B3D` `#A9D978` `#6EE7B7` `#E8F5B2`. Support mobility — not a damage dash.

#### `bulwarkcharge.png` — Bulwark Charge
Heavy defensive charge into a personal ward.

**Subject:** Armored caster charging forward inside a compact blue-stone shield shell, dust kick, wedge of ward energy ahead. Palette `#64748b` `#94a3b8` `#60a5fa` `#e2e8f0`. Committed tank charge — not a green Dash streak.

#### `predatorstep.png` — Predator Step
Shadow rush into brief invisibility.

**Subject:** Low red-violet afterimage streak dissolving into a cloaked silhouette near an enemy outline. Palette `#1A101C` `#5C1B28` `#EF4444` `#8B5CF6`. Predatory setup — not Smoke Bomb cloud.

#### `rebound.png` — Rebound
Frontal force peel with self recoil.

**Subject:** Tight silver-white cone shockwave blasting forward while a caster silhouette is thrown backward with a short air trail. Palette `#F8FAFC` `#CBD5E1` `#94A3B8` `#BAE6FD`. Two-way spacing — not Gust’s full nova.

#### `teleportslam.png` — Teleport Slam
Ground slam then short blink.

**Subject:** Compact circular ground fracture under a crouched caster, violet rematerialize streak beside it (no airborne leap). Palette `#8B5A2B` `#312E81` `#7C3AED` `#F5F3FF`. Slam-then-vanish — not Jump Slam’s aerial arc.

---

### R — Defensive / zones

#### `barrier.png` — Barrier
Personal absorb bubble.

**Subject:** A tight personal blue shield bubble around a tiny core, hex facets. Palette `#60a5fa`. Small self-shield, not a huge dome.

#### `holyGround.png` — Holy Ground
Consecrated circle; resist + damage buff.

**Subject:** A golden consecrated circle on stone, holy rays, warm gold. Palette `#eab308`. Ground blessing, not a heal beam.

#### `firewall.png` — Firewall
Raised wall of flame.

**Subject:** A short wall of roaring fire in a line, cracked earth at the base. Palette `#f97316`. Linear wall, not a volcano mountain.

#### `frostMist.png` — Frost Mist
Expanding frost spray cone that chills to a root.

**Subject:** A cone of icy mist blasting from a frozen breath / staff-tip, frost crystals forming. Palette `#7dd3fc`. Spray cone, not a ball.

#### `groove.png` — Groove
Jazz dance heal pulses.

**Subject:** Musical golden-green notes and a pulsing heal ring, festive but still WoW-icon serious (no cartoon saxophone). Palette `#6ee7b7`. Music + heal, not a beam.

---

### F — Ultimates / channels

#### `fireball.png` — Fireball
Charged exploding fireball, lingering burn.

**Subject:** A classic large fireball, molten core, flame wreath. Palette `#f97316`. Single sphere, not twin magma orbs.

#### `volcano.png` — Volcano
Placed volcano raining flaming rocks.

**Subject:** A miniature erupting volcano, lava fountain, flying cinders. Palette `#ea580c`. Mountain, not a fire wall.

#### `protectionBubble.png` — Protection Bubble
Large dome that blocks inbound projectiles.

**Subject:** A large translucent ice-blue dome, arrows/bolts shattering on the outside. Palette `#7dd3fc`. Huge ward, not a hand disc.

#### `bloodRush.png` — Blood Rush
Crouch then sprint; clip enemies, bleed, execute.

**Subject:** A low crimson sprint streak, blood droplets, a faint claw slash. Palette `#f87171`. Blood dash, not a green dash.

#### `healBeam.png` — Heal Beam
Narrow holy heal channel.

**Subject:** A focused beam of gold-green healing light, clean and sacred. Palette `#6ee7b7` + gold. Beam, not a drain (Life Leech is red/green split).

---

## Filename checklist

```
bolt.png
arcThread.png
soulMark.png
voidDisc.png
runicShard.png
orbitingWisp.png
shrooms.png
iceLance.png
crescent.png
lifeLeech.png
smash.png
frostBall.png
astralChain.png
undergroundPulse.png
slipstream.png
soulRelay.png
crushingSigil.png
poisonDart.png
magmaOrbs.png
handShield.png
surge.png
spiritForm.png
riftFissure.png
dash.png
portal.png
counter.png
revenge.png
decoy.png
gust.png
smokeBomb.png
grasp.png
chainJump.png
spikes.png
poisonCloud.png
silenceSweep.png
gravityWell.png
prismLance.png
soulSever.png
arcBlade.png
bloomingpath.png
barrier.png
holyGround.png
firewall.png
frostMist.png
groove.png
fireball.png
volcano.png
protectionBubble.png
bloodRush.png
healBeam.png
```

## Example full prompt (copy pattern)

```
World of Warcraft classic spell icon, Blizzard entertainment icon art, square game ability icon,
painted fantasy illustration, slightly painterly oil-and-digital hybrid,
strong readable silhouette, high contrast, rich saturated color,
subject fills 75–85% of the frame, slight 3/4 view from upper-right,
dramatic rim light, warm key light from upper-left,
no text, no letters, no numbers, no watermark,
[PASTE SUBJECT FROM THE SPELL BLOCK],
palette [hex], game asset icon, 512x512
```
