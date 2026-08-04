import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Room } from "colyseus.js";
import {
  COSMETIC_SLOTS,
  COSMETIC_SLOT_LABELS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  SHOP_CATEGORY_LABELS,
  SHOP_UI_CATEGORIES,
  canAffordShopCost,
  cosmeticsEquippedFromFields,
  getCosmeticItem,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeCosmeticsEquipped,
  ownsColor,
  ownsCosmetic,
  ownsEmote,
  ownsPattern,
  ownsPatternColor,
  STARTER_COLORS,
  shopItemsForCategory,
  type CosmeticSlot,
  type CosmeticsEquipped,
  type PlayerUnlocks,
  type ShopCategory,
  type ShopItemDef,
} from "@battlebeasts/shared";
import { AppearancePreview } from "./AppearancePreview";
import { ShopCostDisplay } from "./CoinDisplay";
import { ShopItemThumb } from "./ShopGrantThumb";
import { GameIcon } from "./GameIcon";
import {
  COSMETIC_GROUP_ICONS,
  GEAR_SLOT_ICONS,
  SHOP_CATEGORY_ICONS,
} from "./gameIcons";

const HOLD_BUY_MS = 900;

function ownsShopItem(
  unlocks: PlayerUnlocks,
  item: ShopItemDef,
  beachBallCount = 0,
): boolean {
  const grant = item.grant;
  switch (grant.kind) {
    case "color":
      return ownsColor(unlocks.colors, grant.hex);
    case "pattern":
      return ownsPattern(unlocks.patterns, grant.patternId);
    case "pattern_color":
      return ownsPatternColor(unlocks.patternColors, grant.hex);
    case "cosmetic":
      return ownsCosmetic(unlocks.cosmetics, grant.itemId);
    case "emote":
      return ownsEmote(unlocks.emotes, grant.emoteId);
    case "loadout_slot":
      return unlocks.loadoutSlotCount >= grant.toCount;
    case "lobby_beach_ball":
      return beachBallCount >= grant.toCount;
    default:
      return false;
  }
}

type ShopOwnership = { total: number; owned: number; available: number };

function ShopCatStats({ stats }: { stats: ShopOwnership }) {
  if (stats.total <= 0) {
    return <span className="bb-shop__cat-stats bb-meta">No items</span>;
  }
  if (stats.available <= 0) {
    return (
      <span className="bb-shop__cat-stats bb-meta">
        <span className="bb-shop__cat-stats__owned">
          {stats.owned}/{stats.total} owned
        </span>
        <span className="bb-shop__cat-stats__done">Complete</span>
      </span>
    );
  }
  return (
    <span className="bb-shop__cat-stats bb-meta">
      <span className="bb-shop__cat-stats__owned">
        {stats.owned}/{stats.total} owned
      </span>
      <span className="bb-shop__cat-stats__left">{stats.available} available</span>
    </span>
  );
}

export type AppearanceLooks = {
  color: string;
  pattern: string;
  patternColor: string;
  cosmeticsEquipped: CosmeticsEquipped;
};

export function appearanceFromPlayer(me: {
  color?: string;
  pattern?: string;
  patternColor?: string;
  cosmeticHat?: string;
  cosmeticShoulders?: string;
  cosmeticChest?: string;
  cosmeticGloves?: string;
  cosmeticBelt?: string;
  cosmeticLegs?: string;
  cosmeticShoes?: string;
} | null | undefined): AppearanceLooks {
  return {
    color: me?.color ?? STARTER_COLORS[0]!,
    pattern: normalizeCosmeticPattern(me?.pattern ?? DEFAULT_COSMETIC_PATTERN),
    patternColor: normalizeCosmeticPatternColor(
      me?.patternColor ?? DEFAULT_COSMETIC_PATTERN_COLOR,
    ),
    cosmeticsEquipped: cosmeticsEquippedFromFields(me ?? {}),
  };
}

/** Overlay a single shop grant onto the player's live look — never stacks. */
function previewLooksFromBase(
  base: AppearanceLooks,
  item: ShopItemDef | null,
): AppearanceLooks {
  if (!item) return base;
  const cosmeticsEquipped = { ...normalizeCosmeticsEquipped(base.cosmeticsEquipped) };
  const grant = item.grant;
  if (grant.kind === "color") {
    return { ...base, color: grant.hex, cosmeticsEquipped };
  }
  if (grant.kind === "pattern") {
    return { ...base, pattern: grant.patternId, cosmeticsEquipped };
  }
  if (grant.kind === "pattern_color") {
    const pattern = base.pattern === "plain" ? "scales" : base.pattern;
    return { ...base, pattern, patternColor: grant.hex, cosmeticsEquipped };
  }
  if (grant.kind === "cosmetic") {
    const def = getCosmeticItem(grant.itemId);
    if (def) cosmeticsEquipped[def.slot] = def.id;
    return { ...base, cosmeticsEquipped };
  }
  return { ...base, cosmeticsEquipped };
}

type CosmeticSub = null | "tints" | "inks" | "patterns" | "gear" | CosmeticSlot;

function cosmeticSubItems(sub: Exclude<CosmeticSub, null>): ShopItemDef[] {
  const all = shopItemsForCategory("cosmetics");
  if (sub === "tints") return all.filter((i) => i.grant.kind === "color");
  if (sub === "inks") return all.filter((i) => i.grant.kind === "pattern_color");
  if (sub === "patterns") return all.filter((i) => i.grant.kind === "pattern");
  if (sub === "gear") return all.filter((i) => i.grant.kind === "cosmetic");
  return all.filter(
    (i) => i.grant.kind === "cosmetic" && getCosmeticItem(i.grant.itemId)?.slot === sub,
  );
}

export function MerchantPanel({
  room,
  unlocks,
  wallet,
  appearanceBase,
  hideOwned = false,
}: {
  room: Room | null;
  unlocks: PlayerUnlocks;
  wallet: { copper: number; silver: number; gold: number; essence: number; rubies: number };
  appearanceBase: AppearanceLooks;
  hideOwned?: boolean;
}) {
  const [category, setCategory] = useState<ShopCategory>(SHOP_UI_CATEGORIES[0]!);
  const [cosmeticSub, setCosmeticSub] = useState<CosmeticSub>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [holdBuyFrac, setHoldBuyFrac] = useState(0);
  const [holdBuyUiId, setHoldBuyUiId] = useState<string | null>(null);
  const [beachBallCount, setBeachBallCount] = useState(0);
  const [isOwnLobby, setIsOwnLobby] = useState(true);
  const holdBuyRaf = useRef<number | null>(null);
  const holdBuyStart = useRef(0);
  const holdBuyItemId = useRef<string | null>(null);

  useEffect(() => {
    setCosmeticSub(null);
    setSelectedId(null);
  }, [category]);

  useEffect(() => {
    setSelectedId(null);
  }, [cosmeticSub]);

  useEffect(() => {
    if (!room) {
      setBeachBallCount(0);
      setIsOwnLobby(true);
      return;
    }
    const sync = () => {
      const st = room.state as
        | {
            beachBallCount?: number;
            hubOwnerUserId?: string;
            players?: { get: (id: string) => { id?: string } | undefined };
          }
        | undefined;
      setBeachBallCount(Math.max(0, Math.floor(st?.beachBallCount ?? 0)));
      const ownerId = st?.hubOwnerUserId ?? "";
      const me = room.sessionId ? st?.players?.get(room.sessionId) : undefined;
      setIsOwnLobby(!ownerId || Boolean(me?.id && me.id === ownerId));
    };
    sync();
    const id = window.setInterval(sync, 250);
    return () => window.clearInterval(id);
  }, [room]);

  const clearHoldBuy = () => {
    if (holdBuyRaf.current != null) {
      cancelAnimationFrame(holdBuyRaf.current);
      holdBuyRaf.current = null;
    }
    holdBuyStart.current = 0;
    holdBuyItemId.current = null;
    setHoldBuyUiId(null);
    setHoldBuyFrac(0);
  };

  useEffect(() => () => clearHoldBuy(), []);

  // Stable end handler — avoid clearing mid-hold when React re-renders on select.
  const endHoldBuy = () => {
    if (holdBuyItemId.current == null) return;
    clearHoldBuy();
  };

  const topItems = useMemo(() => shopItemsForCategory(category), [category]);

  const browseItems = useMemo(() => {
    let items: ShopItemDef[];
    if (category === "cosmetics") {
      if (!cosmeticSub || cosmeticSub === "gear") items = [];
      else items = cosmeticSubItems(cosmeticSub);
    } else {
      items = topItems;
    }
    if (hideOwned) items = items.filter((item) => !ownsShopItem(unlocks, item, beachBallCount));
    return items;
  }, [category, cosmeticSub, topItems, hideOwned, unlocks, beachBallCount]);

  useEffect(() => {
    if (!selectedId) return;
    if (!browseItems.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [browseItems, selectedId]);

  const ownershipOf = (items: ShopItemDef[]) => {
    let owned = 0;
    for (const item of items) {
      if (ownsShopItem(unlocks, item, beachBallCount)) owned += 1;
    }
    const total = items.length;
    return { total, owned, available: total - owned };
  };

  const subOwnership = (sub: Exclude<CosmeticSub, null>) =>
    ownershipOf(cosmeticSubItems(sub));

  const categoryOwnership = useMemo(() => {
    if (category === "cosmetics" || category === "consumables") return null;
    return ownershipOf(topItems);
  }, [category, topItems, unlocks, beachBallCount]);

  const gearSlotsWithItems = useMemo(() => {
    const slots = new Set<CosmeticSlot>();
    for (const item of shopItemsForCategory("cosmetics")) {
      if (item.grant.kind !== "cosmetic") continue;
      const def = getCosmeticItem(item.grant.itemId);
      if (def) slots.add(def.slot);
    }
    return COSMETIC_SLOTS.filter((s) => slots.has(s));
  }, []);

  const selectedItem = useMemo(
    () => (selectedId ? browseItems.find((i) => i.id === selectedId) ?? null : null),
    [browseItems, selectedId],
  );

  const previewLooks = useMemo(
    () => previewLooksFromBase(appearanceBase, selectedItem),
    [appearanceBase, selectedItem],
  );
  const previewEmoteId =
    selectedItem?.grant.kind === "emote" ? selectedItem.grant.emoteId : null;

  const showCharacterPreview = category === "cosmetics" || category === "emotes";
  const inCosmeticOverview = category === "cosmetics" && cosmeticSub === null;
  const inGearOverview = category === "cosmetics" && cosmeticSub === "gear";
  const showItemList =
    (category === "cosmetics" && cosmeticSub != null && cosmeticSub !== "gear") ||
    category === "emotes" ||
    category === "loadouts" ||
    category === "lobby" ||
    category === "consumables";

  const selectedOwned = selectedItem
    ? ownsShopItem(unlocks, selectedItem, beachBallCount)
    : false;
  const selectedNeedsOwnLobby =
    selectedItem?.grant.kind === "lobby_beach_ball" && !isOwnLobby;
  const canBuySelected =
    selectedItem != null &&
    !selectedOwned &&
    !selectedNeedsOwnLobby &&
    canAffordShopCost(wallet, selectedItem.cost);
  const selectedCosmetic =
    selectedItem?.grant.kind === "cosmetic" ? getCosmeticItem(selectedItem.grant.itemId) : undefined;
  const selectedCosmeticEquipped =
    selectedCosmetic != null &&
    appearanceBase.cosmeticsEquipped[selectedCosmetic.slot] === selectedCosmetic.id;
  const gearSlotBrowse =
    category === "cosmetics" &&
    cosmeticSub != null &&
    COSMETIC_SLOTS.includes(cosmeticSub as CosmeticSlot)
      ? (cosmeticSub as CosmeticSlot)
      : null;

  const canHoldBuyItem = (item: ShopItemDef) =>
    canAffordShopCost(wallet, item.cost) &&
    !ownsShopItem(unlocks, item, beachBallCount) &&
    !(item.grant.kind === "lobby_beach_ball" && !isOwnLobby);

  const commitShopBuy = (item: ShopItemDef) => {
    room?.send("shop_buy", { itemId: item.id });
    clearHoldBuy();
  };

  const beginHoldBuy = (item: ShopItemDef, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (!canHoldBuyItem(item)) return;
    e.preventDefault();
    clearHoldBuy();
    holdBuyItemId.current = item.id;
    holdBuyStart.current = performance.now();
    setHoldBuyUiId(item.id);
    setHoldBuyFrac(0);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore — capture is optional; pointerup still ends the hold */
    }
    const tick = (now: number) => {
      if (holdBuyItemId.current !== item.id) return;
      const frac = Math.min(1, (now - holdBuyStart.current) / HOLD_BUY_MS);
      setHoldBuyFrac(frac);
      if (frac >= 1) {
        commitShopBuy(item);
        return;
      }
      holdBuyRaf.current = requestAnimationFrame(tick);
    };
    holdBuyRaf.current = requestAnimationFrame(tick);
  };

  const equipSelectedCosmetic = () => {
    if (!selectedCosmetic) return;
    if (selectedCosmeticEquipped) {
      room?.send("set_cosmetic", { slot: selectedCosmetic.slot, itemId: null });
    } else {
      room?.send("set_cosmetic", { slot: selectedCosmetic.slot, itemId: selectedCosmetic.id });
    }
  };

  return (
    <div className={["bb-shop", showCharacterPreview ? "bb-shop--preview" : ""].join(" ")}>
      <div className="bb-appearance-tabs" role="tablist" aria-label="Merchant categories">
        {SHOP_UI_CATEGORIES.map((cat) => {
          const on = cat === category;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={on}
              className={["bb-appearance-tab", on ? "bb-appearance-tab--on" : ""].join(" ")}
              onClick={() => setCategory(cat)}
            >
              {cat in SHOP_CATEGORY_ICONS ? (
                <GameIcon
                  id={SHOP_CATEGORY_ICONS[cat as keyof typeof SHOP_CATEGORY_ICONS]}
                  size={15}
                  gray={on ? 0.95 : 0.7}
                  className="bb-appearance-tab__icon"
                />
              ) : null}
              {SHOP_CATEGORY_LABELS[cat]}
            </button>
          );
        })}
      </div>

      <div className="bb-shop__body">
        <div className="bb-shop__browse">
          {inCosmeticOverview ? (
            <div className="bb-shop__overview" role="navigation" aria-label="Cosmetic groups">
              <p className="bb-muted mb-2">Choose a group to browse.</p>
              <div className="bb-shop__cat-grid">
                {(
                  [
                    ["tints", "Body Colors"],
                    ["inks", "Pattern Inks"],
                    ["patterns", "Patterns"],
                    ["gear", "Gear"],
                  ] as const
                ).map(([id, label]) => {
                  const stats = subOwnership(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className="bb-shop__cat-btn"
                      onClick={() => setCosmeticSub(id)}
                    >
                      <span className="bb-shop__cat-btn__row">
                        <GameIcon id={COSMETIC_GROUP_ICONS[id]} size={26} gray={0.85} />
                        <span className="bb-shop__cat-btn__label">{label}</span>
                      </span>
                      <ShopCatStats stats={stats} />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {inGearOverview ? (
            <div className="bb-shop__overview">
              <button type="button" className="bb-shop__back" onClick={() => setCosmeticSub(null)}>
                ← Cosmetics
              </button>
              <p className="bb-muted mb-2">Pick a gear slot.</p>
              <div className="bb-shop__cat-grid">
                {gearSlotsWithItems.map((slot) => {
                  const stats = subOwnership(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      className="bb-shop__cat-btn"
                      onClick={() => setCosmeticSub(slot)}
                    >
                      <span className="bb-shop__cat-btn__row">
                        <GameIcon id={GEAR_SLOT_ICONS[slot]} size={26} gray={0.85} />
                        <span className="bb-shop__cat-btn__label">{COSMETIC_SLOT_LABELS[slot]}</span>
                      </span>
                      <ShopCatStats stats={stats} />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showItemList ? (
            <>
              {category === "cosmetics" && cosmeticSub && cosmeticSub !== "gear" ? (
                <button
                  type="button"
                  className="bb-shop__back"
                  onClick={() =>
                    setCosmeticSub(gearSlotBrowse ? "gear" : null)
                  }
                >
                  ← {gearSlotBrowse ? "Gear" : "Cosmetics"}
                </button>
              ) : null}

              {gearSlotBrowse ? (
                <div className="bb-shop__slot-head">
                  <GameIcon id={GEAR_SLOT_ICONS[gearSlotBrowse]} size={28} gray={0.9} />
                  <span className="bb-shop__slot-head__label">
                    {COSMETIC_SLOT_LABELS[gearSlotBrowse]}
                  </span>
                  <ShopCatStats stats={subOwnership(gearSlotBrowse)} />
                </div>
              ) : category !== "cosmetics" && categoryOwnership ? (
                <div className="bb-shop__slot-head bb-shop__slot-head--stats-only">
                  <ShopCatStats stats={categoryOwnership} />
                </div>
              ) : cosmeticSub && cosmeticSub !== "gear" ? (
                <div className="bb-shop__slot-head bb-shop__slot-head--stats-only">
                  <ShopCatStats stats={subOwnership(cosmeticSub)} />
                </div>
              ) : null}

              <ul className="bb-shop__list" role="listbox" aria-label="Shop items">
                {browseItems.length === 0 ? (
                  <li className="bb-muted py-8 text-center">
                    {hideOwned ? "You own everything here." : "Nothing here yet."}
                  </li>
                ) : (
                  browseItems.map((item) => {
                    const owned = ownsShopItem(unlocks, item, beachBallCount);
                    const selected = selectedItem?.id === item.id;
                    const holding = holdBuyUiId === item.id;
                    const buyable = canHoldBuyItem(item);
                    const needsOwnLobby =
                      item.grant.kind === "lobby_beach_ball" && !isOwnLobby;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          aria-label={item.name}
                          className={[
                            "bb-loadout-card bb-shop__card bb-shop__card--select",
                            owned ? "bb-loadout-card--on" : "",
                            selected ? "bb-shop__card--focus" : "",
                            holding ? "bb-shop__card--holding" : "",
                            buyable ? "bb-shop__card--buyable" : "",
                          ].join(" ")}
                          onPointerDown={(e) => {
                            setSelectedId(item.id);
                            beginHoldBuy(item, e);
                          }}
                          onPointerUp={endHoldBuy}
                          onPointerCancel={endHoldBuy}
                          onContextMenu={(e) => e.preventDefault()}
                        >
                          <span
                            className="bb-shop__card__hold-fill"
                            style={{
                              transform: `scaleX(${holding ? holdBuyFrac : 0})`,
                            }}
                            aria-hidden
                          />
                          <ShopItemThumb item={item} />
                          <div className="bb-loadout-card__main">
                            <div className="bb-loadout-card__top">
                              <span className="bb-loadout-card__name">{item.name}</span>
                              <span className="bb-loadout-card__shape">
                                {owned ? (
                                  "Owned"
                                ) : needsOwnLobby ? (
                                  "Own lobby"
                                ) : (
                                  <ShopCostDisplay cost={item.cost} />
                                )}
                              </span>
                            </div>
                            {item.description ? (
                              <p className="bb-loadout-card__desc">{item.description}</p>
                            ) : null}
                            {!owned && buyable ? (
                              <p className="bb-shop__card__hold-hint">Hold to buy</p>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          ) : null}
        </div>

        {showCharacterPreview ? (
          <div className="bb-shop__preview-col">
            <AppearancePreview
              color={previewLooks.color}
              pattern={previewLooks.pattern}
              patternColor={previewLooks.patternColor}
              cosmeticsEquipped={previewLooks.cosmeticsEquipped}
              previewEmoteId={previewEmoteId}
            />
            <p className="bb-meta mt-2 text-center">
              {selectedItem
                ? selectedItem.name
                : inCosmeticOverview || inGearOverview
                  ? "Your look — open a group, then click an item to preview"
                  : "Click an item to preview (one at a time)"}
            </p>
            {selectedItem ? (
              <div className="bb-shop__buy-row">
                {selectedOwned ? (
                  selectedCosmetic ? (
                    <button
                      type="button"
                      className="bb-btn-brass w-full"
                      onClick={equipSelectedCosmetic}
                    >
                      {selectedCosmeticEquipped ? "Unequip" : "Equip"}
                    </button>
                  ) : (
                    <span className="bb-loadout-card__action">Owned</span>
                  )
                ) : selectedNeedsOwnLobby ? (
                  <p className="bb-meta text-center">Buy beach balls in your own lobby.</p>
                ) : (
                  <button
                    type="button"
                    className="bb-btn-brass w-full disabled:opacity-40"
                    disabled={!canBuySelected}
                    onClick={() => commitShopBuy(selectedItem)}
                  >
                    Buy · <ShopCostDisplay cost={selectedItem.cost} />
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {!showCharacterPreview && selectedItem && selectedOwned ? (
          <div className="bb-shop__buy-row bb-shop__buy-row--solo">
            <span className="bb-loadout-card__action">Owned</span>
          </div>
        ) : null}

        {!showCharacterPreview && selectedItem && !selectedOwned ? (
          <div className="bb-shop__buy-row bb-shop__buy-row--solo">
            {selectedNeedsOwnLobby ? (
              <p className="bb-meta text-center">Buy beach balls in your own lobby.</p>
            ) : (
              <button
                type="button"
                className="bb-btn-brass w-full disabled:opacity-40"
                disabled={!canBuySelected}
                onClick={() => commitShopBuy(selectedItem)}
              >
                Buy {selectedItem.name} · <ShopCostDisplay cost={selectedItem.cost} />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
