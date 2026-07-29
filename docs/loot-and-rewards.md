# Loot & rewards

Source of truth for match payouts, shop price bands, quests, chests, and admin grants. Code constants live in [`packages/shared/src/rewards.ts`](../packages/shared/src/rewards.ts) and [`shopCatalog.ts`](../packages/shared/src/shopCatalog.ts).

---

## Economy reset

One-shot migration zeros all `inventory` copper / silver / gold / essence. Unlocks, talents, and cosmetics are kept. Do **not** re-run after live play resumes.

---

## Progression spend

| Sink | Cost | Notes |
| --- | --- | --- |
| Talent point | **40 essence** (`ESSENCE_PER_TALENT_POINT`) | Remaining budget after starter ≈ 21 × 40 = **840** essence |
| Tree reset / respec | **10 essence per point** (`ESSENCE_PER_TALENT_REFUND`) | Charged on reset tree or save that removes/moves points |
| Spell unlocks | **6–14 essence** | Authored on abilities; full unlock path ~80–140 |

### Merchant (copper)

| Item | Cost |
| --- | --- |
| Health Tonic | 35 copper |
| Body color | 90 copper |
| Pattern ink | 70 copper |
| Pattern | 160 copper |
| Gear | 280 copper |
| Emote | 200 copper |
| Loadout preset slot | **80 silver** |
| Copper Pouch | 1 essence → +80 copper |

---

## PvP match payouts (before activity mul)

| Mode | Base essence | Win bonus | Loss copper | Win copper |
| --- | --- | --- | --- | --- |
| 1v1 | 8 | 8 | 5–12 | 18–28 |
| 2v2 | 10 | 10 | 8–16 | 22–32 |
| 3v3 | 12 | 12 | 10–20 | 28–40 |

- **Draw:** base essence only; copper mid win-band.
- **Leave early** (no finished match): 2–4 essence by mode, **no** copper / win bonus.
- **PvE return:** 5 essence + mid copper band.
- No silver/gold on match grants (v1).

### Activity (anti-AFK)

- `activityScore = moveTicks + castCount × 8`
- Thresholds: 1v1 **80**, 2v2 **100**, 3v3 **120**
- Mul: `≥ threshold → 1.0`, `≥ 40% → 0.5`, else `0.15`
- Shown on match recap when reduced.

### Ledger

`reward_grants` rows are idempotent on `(user_id, source, source_key)`. Match grants use `source = pvp_match` (or `pve_clear`). Hub join claims `pending` → wallet.

---

## Friend codes

Unique short code on `profiles.friend_code`. Redeem once per invitee; self blocked. Powers referral quests.

---

## Quests (v1)

| Id | Type | Target | Chest |
| --- | --- | --- | --- |
| `daily_win_3` | daily | 3 wins | **any** (rolled) |
| `daily_modes_3` | daily | 3 distinct modes | **any** (rolled) |
| `once_friend_code` | lifetime | 1 | blue |
| `once_first_pvp` | lifetime | 1 completed PvP | blue |
| `once_friends_5` | lifetime | 5 referrals | purple |
| `life_essence_*` | lifetime | 150→5,000 cumulative | green→legendary |
| `life_spells_*` | lifetime | 5→all spells (`QUEST_MAX_SPELLS`) | green→legendary |
| `life_talents_*` | lifetime | 5→full spend (`QUEST_MAX_TALENT_SPEND`) | green→legendary |
| `life_copper_*` | lifetime | 500→25,000 copper | green→legendary |

Daily `period_key` = UTC date; lifetime = `lifetime`.

Lifetime ladders are chained in `QUEST_CHAINS` (UI shows the next step only). Spell/talent caps track live catalog sizes (`ABILITIES`, talent budget − starter). Essence and copper have no wallet max — ladders end at long grinder thresholds.

Quest `chest` may be a fixed rarity (`green` / `blue` / `purple` / `legendary`) or **`any`**.  
`any` rolls with `ANY_CHEST_WEIGHTS` in `packages/shared/src/rewards.ts` (default: **5%** legendary, **15%** purple, **25%** blue, **55%** green).

---

## Chests

Guaranteed on every open: **essence + copper** (bands below). Extra unlock rolls are independent % checks; on a hit, one item is picked from the pool (weighted). Already-owned unlocks → duplicate copper instead.

### Guaranteed currency

| Quality | Essence | Copper | Dup compensation |
| --- | --- | --- | --- |
| Green | 3–6 | 15–30 | 15 copper |
| Blue | 6–11 | 30–50 | 35 copper |
| Purple | 10–16 | 50–85 | 80 copper |
| Legendary | 16–26 | 100–150 | 150 copper |

### Extra unlock rolls

| Quality | Roll | Chance | Pool (weights) |
| --- | --- | --- | --- |
| **Green** | 1 | **22%** | body tint **or** pattern ink (weight 2) |
| **Blue** | 1 | **28%** | tint, ink, **or** pattern (weight 2) |
| **Blue** | 2 | **10%** | non-starter emote (weight 2) |
| **Purple** | 1 | **26%** | pattern **or** emote (weight 2) |
| **Purple** | 2 | **10%** | gear cosmetic (weight 1) |
| **Legendary** | 1 | **100%** | any unlock (tint/ink/pattern/emote weight 2, **gear weight 1**) |
| **Legendary** | 2 | **15%** | emote, pattern, **or** gear |

Notes:

- Starter tints / inks / patterns are excluded from pools.
- Within a pool, pick is weighted (`salt % totalWeight`); same-weight entries are equal odds.
- Legendary guarantees **one** non-currency item, but **not** specifically gear.
- Rubies are **not** in chest loot yet (currency UI only).

Duplicates → copper (`DUPLICATE_COPPER`).

---

## Admin grants

Allowlist email `derick0232@gmail.com` (plus `ADMIN_EMAILS` env). Hub roster right-click → grant essence/coins. Audited as `reward_grants.source = admin_grant`.

---

## Anti-abuse

- Idempotent grant keys; rematch bumps grant key.
- Activity mul on match rewards.
- Server-authoritative quest bumps and chest opens.
- Guests: in-memory pending loot only; no quest progress.
