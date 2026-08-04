import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Room } from "colyseus.js";
import {
  COSMETIC_COLORS,
  COSMETIC_PATTERN_COLORS,
  COSMETIC_PATTERNS,
  COSMETIC_SLOTS,
  COSMETIC_SLOT_LABELS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  EMOTES,
  SPELL_SLOTS,
  canEquipInSlot,
  cosmeticsEquippedFromFields,
  cosmeticsForSlot,
  cosmeticColorName,
  cosmeticMeshName,
  cosmeticPatternColorName,
  emptyPlayerUnlocks,
  getCosmeticItem,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeCosmeticsEquipped,
  normalizeEmoteSlots,
  normalizeLoadout,
  ownsAbility,
  ownsColor,
  ownsCosmetic,
  ownsEmote,
  ownsPattern,
  ownsPatternColor,
  type CosmeticSlot,
  type CosmeticsEquipped,
  type PlayerUnlocks,
  type TalentBuild,
} from "@battlebeasts/shared";
import { AppearancePreview } from "./AppearancePreview";
import { EmotePieEditor } from "./EmotePieHud";
import { GameIcon } from "./GameIcon";
import { GEAR_SLOT_ICONS } from "./gameIcons";
import { GamePanelShell } from "./GamePanelShell";
import { ConfirmDialog } from "./ConfirmDialog";
import { appearanceFromPlayer, MerchantPanel } from "./MerchantShop";
import { WalletDisplay } from "./CoinDisplay";
import { SpellArmoury, SpellArmouryHeaderExtras } from "./SpellArmoury";
import { TalentTreePanel } from "./TalentTreePanel";
import { loadStandMenuMemory, saveStandMenuMemory } from "../standMenuMemory";
import { getCreaturePatternTexture } from "../creaturePatterns";

type Kind = "customization" | "build" | "talent" | "shop";

type LoadoutPreset = {
  slotIndex: number;
  name: string;
  abilityIds: string[];
  talentBuild?: TalentBuild;
};

type Economy = {
  copper: number;
  silver: number;
  gold: number;
  essence: number;
  rubies: number;
  talentPoints: number;
  talentBuild: TalentBuild;
  loadout: string[];
  talents: string[];
  unlocks: PlayerUnlocks | null;
  loadoutPresets: LoadoutPreset[];
  activeLoadoutSlot: number;
};

type Props = {
  kind: Kind;
  onClose: () => void;
  room: Room | null;
  economy: Economy;
  localSessionId?: string | null;
  /** Optimistic hotbar update when a spell is equipped (autosave). */
  onLoadoutChange?: (abilityIds: string[]) => void;
};

const TITLES: Record<Kind, string> = {
  customization: "Appearance",
  build: "Spell Armoury",
  talent: "Talents",
  shop: "Merchant",
};

function PatternSwatch({
  patternId,
  patternColor,
}: {
  patternId: string;
  patternColor: string;
}) {
  const url = useMemo(() => {
    if (patternId === "plain") return null;
    const tex = getCreaturePatternTexture(patternId, patternColor, "#d1d5db");
    const img = tex?.image as HTMLCanvasElement | undefined;
    return img?.toDataURL?.() ?? null;
  }, [patternId, patternColor]);

  if (!url) {
    return (
      <span
        className="block size-full rounded-[2px]"
        style={{ background: "linear-gradient(135deg,#e5e7eb,#9ca3af)" }}
      />
    );
  }
  return (
    <span
      className="block size-full rounded-[2px] bg-cover bg-center"
      style={{ backgroundImage: `url(${url})` }}
    />
  );
}

function AppearanceEditor({
  room,
  localSessionId,
  unlocks,
}: {
  room: Room | null;
  localSessionId?: string | null;
  unlocks: PlayerUnlocks;
}) {
  type PlayerAppearance = {
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
  };

  type AppearanceTab = "hide" | "gear" | "emotes";

  const me = localSessionId
    ? (room?.state?.players?.get(localSessionId) as PlayerAppearance | undefined)
    : undefined;
  const [tab, setTab] = useState<AppearanceTab>("hide");
  const [color, setColor] = useState(me?.color ?? COSMETIC_COLORS[0]);
  const [pattern, setPattern] = useState(
    normalizeCosmeticPattern(me?.pattern ?? DEFAULT_COSMETIC_PATTERN),
  );
  const [patternColor, setPatternColor] = useState(
    normalizeCosmeticPatternColor(me?.patternColor ?? DEFAULT_COSMETIC_PATTERN_COLOR),
  );
  const [gearSlot, setGearSlot] = useState<CosmeticSlot>("hat");
  const [equipped, setEquipped] = useState<CosmeticsEquipped>(() =>
    cosmeticsEquippedFromFields(me ?? {}),
  );
  const [selectedEmoteId, setSelectedEmoteId] = useState<string | null>(null);
  const [previewEmoteId, setPreviewEmoteId] = useState<string | null>(null);
  const [emoteSlots, setEmoteSlots] = useState<(string | null)[]>(() =>
    normalizeEmoteSlots(unlocks.emoteSlots, unlocks.emotes),
  );

  useEffect(() => {
    if (me?.color && (COSMETIC_COLORS as readonly string[]).includes(me.color)) {
      setColor(me.color);
    }
    if (me?.pattern) setPattern(normalizeCosmeticPattern(me.pattern));
    if (me?.patternColor) setPatternColor(normalizeCosmeticPatternColor(me.patternColor));
    setEquipped(cosmeticsEquippedFromFields(me ?? {}));
  }, [
    me?.color,
    me?.pattern,
    me?.patternColor,
    me?.cosmeticHat,
    me?.cosmeticShoulders,
    me?.cosmeticChest,
    me?.cosmeticGloves,
    me?.cosmeticBelt,
    me?.cosmeticLegs,
    me?.cosmeticShoes,
  ]);

  useEffect(() => {
    setEmoteSlots(normalizeEmoteSlots(unlocks.emoteSlots, unlocks.emotes));
  }, [unlocks.emoteSlots, unlocks.emotes]);

  const allSlotPool = useMemo(() => cosmeticsForSlot(gearSlot), [gearSlot]);
  const ownedSlotPool = useMemo(
    () => allSlotPool.filter((item) => ownsCosmetic(unlocks.cosmetics, item.id)),
    [allSlotPool, unlocks.cosmetics],
  );
  const ownedColors = useMemo(
    () => COSMETIC_COLORS.filter((c) => ownsColor(unlocks.colors, c)),
    [unlocks.colors],
  );
  const ownedPatternColors = useMemo(
    () => COSMETIC_PATTERN_COLORS.filter((c) => ownsPatternColor(unlocks.patternColors, c)),
    [unlocks.patternColors],
  );
  const ownedPatterns = useMemo(
    () => COSMETIC_PATTERNS.filter((p) => ownsPattern(unlocks.patterns, p.id)),
    [unlocks.patterns],
  );

  const ownedEmotes = useMemo(
    () => Object.values(EMOTES).filter((e) => ownsEmote(unlocks.emotes, e.id)),
    [unlocks.emotes],
  );
  const setCosmetic = (slot: CosmeticSlot, itemId: string | null) => {
    setEquipped((prev) => normalizeCosmeticsEquipped({ ...prev, [slot]: itemId }));
    room?.send("set_cosmetic", { slot, itemId });
  };

  const commitEmoteSlots = (next: (string | null)[]) => {
    setEmoteSlots(next);
    room?.send("set_emote_loadout", { emoteSlots: next });
  };

  const placeEmoteInSlot = (i: number, emoteId: string) => {
    const next = [...emoteSlots];
    next[i] = emoteId;
    commitEmoteSlots(next);
    setSelectedEmoteId(null);
    setPreviewEmoteId(emoteId);
  };

  const clearEmoteSlot = (i: number) => {
    const removed = emoteSlots[i];
    const next = [...emoteSlots];
    next[i] = null;
    commitEmoteSlots(next);
    if (removed) {
      setPreviewEmoteId((cur) => (cur === removed ? null : cur));
    }
  };

  const handleEmoteSlotClick = (i: number) => {
    if (selectedEmoteId) {
      placeEmoteInSlot(i, selectedEmoteId);
      return;
    }
    const id = emoteSlots[i];
    if (id) setPreviewEmoteId(id);
  };

  const handleEmoteSlotDrop = (i: number, emoteId: string, fromSlot?: number) => {
    const next = [...emoteSlots];
    if (typeof fromSlot === "number" && fromSlot !== i) {
      next[fromSlot] = next[i] ?? null;
    }
    next[i] = emoteId;
    commitEmoteSlots(next);
    setSelectedEmoteId(null);
    setPreviewEmoteId(emoteId);
  };

  return (
    <div className="bb-appearance">
      <div className="bb-appearance__controls">
        <div className="bb-appearance-tabs" role="tablist" aria-label="Appearance sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "hide"}
            className={["bb-appearance-tab", tab === "hide" ? "bb-appearance-tab--on" : ""].join(
              " ",
            )}
            onClick={() => setTab("hide")}
          >
            <GameIcon id="animal-hide" size={15} gray={tab === "hide" ? 0.95 : 0.7} />
            Body
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "gear"}
            className={["bb-appearance-tab", tab === "gear" ? "bb-appearance-tab--on" : ""].join(
              " ",
            )}
            onClick={() => setTab("gear")}
          >
            <GameIcon id="chest-armor" size={15} gray={tab === "gear" ? 0.95 : 0.7} />
            Gear
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "emotes"}
            className={[
              "bb-appearance-tab",
              tab === "emotes" ? "bb-appearance-tab--on" : "",
            ].join(" ")}
            onClick={() => setTab("emotes")}
          >
            <GameIcon id="drama-masks" size={15} gray={tab === "emotes" ? 0.95 : 0.7} />
            Emotes
          </button>
        </div>

        {tab === "hide" ? (
          <div className="bb-appearance__pane" role="tabpanel">
            <p className="bb-muted">
              Changes save to your account when signed in.
            </p>

            <div>
              <p className="bb-section-label">Body color</p>
              <div className="bb-appearance-swatches">
                {ownedColors.map((c) => {
                  const on = c === color;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={["bb-appearance-swatch", on ? "bb-appearance-swatch--on" : ""].join(
                        " ",
                      )}
                      style={{ backgroundColor: c }}
                      title={cosmeticColorName(c)}
                      onClick={() => {
                        setColor(c);
                        room?.send("set_color", { color: c });
                      }}
                      aria-label={`Body color ${cosmeticColorName(c)}`}
                      aria-pressed={on}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <p className="bb-section-label">Pattern color</p>
              <div className="bb-appearance-swatches">
                {ownedPatternColors.map((c) => {
                  const on = c === patternColor;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={["bb-appearance-swatch", on ? "bb-appearance-swatch--on" : ""].join(
                        " ",
                      )}
                      style={{ backgroundColor: c }}
                      title={cosmeticPatternColorName(c)}
                      onClick={() => {
                        setPatternColor(c);
                        room?.send("set_pattern_color", { patternColor: c });
                      }}
                      aria-label={`Pattern color ${cosmeticPatternColorName(c)}`}
                      aria-pressed={on}
                      disabled={pattern === "plain"}
                    />
                  );
                })}
              </div>
              {pattern === "plain" ? (
                <p className="bb-meta mt-2">Pick a pattern first — plain hide has no markings.</p>
              ) : null}
            </div>

            <div>
              <p className="bb-section-label">Creature pattern</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ownedPatterns.map((p) => {
                  const on = p.id === pattern;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={["bb-choice !p-2 text-left", on ? "bb-choice--on" : ""].join(" ")}
                      onClick={() => {
                        setPattern(p.id);
                        room?.send("set_pattern", { pattern: p.id, patternColor });
                      }}
                      aria-pressed={on}
                    >
                      <span className="mb-1.5 block h-7 w-full overflow-hidden rounded-[2px] ring-1 ring-black/20">
                        <PatternSwatch patternId={p.id} patternColor={patternColor} />
                      </span>
                      <span
                        className="block text-sm font-semibold"
                        style={{ fontFamily: "var(--bb-font-display)" }}
                      >
                        {p.name}
                      </span>
                      <span className="bb-meta mt-0.5 block leading-snug">{p.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : tab === "gear" ? (
          <div className="bb-appearance__pane bb-appearance__pane--gear" role="tabpanel">
            <div className="bb-appearance-gear">
              <aside className="bb-loadout__rail">
                <div className="bb-loadout__rail-head">
                  <p className="bb-section-label mb-0">Slots</p>
                </div>
                <div className="bb-loadout__slots" role="listbox" aria-label="Cosmetic slots">
                  {COSMETIC_SLOTS.map((slot) => {
                    const id = equipped[slot];
                    const item = id ? getCosmeticItem(id) : undefined;
                    const active = gearSlot === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => setGearSlot(slot)}
                        className={[
                          "bb-loadout-slot !min-h-[3.1rem]",
                          active ? "bb-loadout-slot--on" : "",
                          !item ? "bb-loadout-slot--empty" : "",
                        ].join(" ")}
                      >
                        <span className="bb-loadout-slot__icon" aria-hidden>
                          <GameIcon id={GEAR_SLOT_ICONS[slot]} size={20} gray={active ? 0.95 : 0.72} />
                        </span>
                        <span className="bb-loadout-slot__meta">
                          <p className="bb-loadout-slot__key">{COSMETIC_SLOT_LABELS[slot]}</p>
                          <p className="bb-loadout-slot__name">{item?.name ?? "Empty"}</p>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="bb-loadout__pool" aria-label="Gear for slot">
                <header className="bb-loadout__pool-head">
                  <div>
                    <h3 className="bb-loadout__pool-title">{COSMETIC_SLOT_LABELS[gearSlot]}</h3>
                    <p className="bb-meta mt-1">
                      {ownedSlotPool.length
                        ? "Click to equip · click equipped to clear"
                        : "No owned gear in this slot — buy more at the Merchant"}
                    </p>
                  </div>
                </header>
                {ownedSlotPool.length === 0 ? (
                  <p className="bb-muted px-1 py-6 text-center">
                    {allSlotPool.length === 0
                      ? "No gear registered for this slot yet."
                      : "Visit the Merchant to unlock gear for this slot."}
                  </p>
                ) : (
                  <ul className="bb-loadout__pool-list">
                    {ownedSlotPool.map((item) => {
                      const on = equipped[gearSlot] === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={[
                              "bb-loadout-card",
                              on ? "bb-loadout-card--on" : "",
                            ].join(" ")}
                            onClick={() => setCosmetic(gearSlot, on ? null : item.id)}
                          >
                            <div className="bb-loadout-card__main">
                              <div className="bb-loadout-card__top">
                                <span className="bb-loadout-card__name">{item.name}</span>
                                <span className="bb-loadout-card__shape">{item.slot}</span>
                              </div>
                              <p className="bb-loadout-card__desc">
                                Object <code>{cosmeticMeshName(item)}</code> in hero.glb
                              </p>
                            </div>
                            <span className="bb-loadout-card__action">
                              {on ? "Equipped" : "Equip"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="bb-appearance__pane bb-appearance__pane--emotes" role="tabpanel">
            <p className="bb-muted">
              Select or drag an emote onto the wheel. Click a filled wedge to preview it;
              right-click to clear.
            </p>

            <div>
              <p className="bb-section-label">Your emotes</p>
              {ownedEmotes.length === 0 ? (
                <p className="bb-muted">No emotes unlocked yet — visit the Merchant.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ownedEmotes.map((e) => {
                    const on = e.id === selectedEmoteId;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        draggable
                        className={[
                          "bb-choice bb-emote-chip !w-auto !p-2 text-sm",
                          on ? "bb-choice--on" : "",
                        ].join(" ")}
                        onClick={() => {
                          setSelectedEmoteId((prev) => (prev === e.id ? null : e.id));
                          setPreviewEmoteId(e.id);
                        }}
                        onDragStart={(ev) => {
                          ev.dataTransfer.setData("application/x-bb-emote", e.id);
                          ev.dataTransfer.effectAllowed = "copyMove";
                          setSelectedEmoteId(e.id);
                        }}
                        aria-pressed={on}
                      >
                        {e.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <p className="bb-section-label">Emote wheel</p>
              <EmotePieEditor
                slots={emoteSlots}
                selectedEmoteId={selectedEmoteId}
                onSlotClick={handleEmoteSlotClick}
                onSlotClear={clearEmoteSlot}
                onSlotDrop={handleEmoteSlotDrop}
              />
            </div>
          </div>
        )}
      </div>

      <div className="bb-appearance__preview-col">
        <AppearancePreview
          color={color}
          pattern={pattern}
          patternColor={patternColor}
          cosmeticsEquipped={equipped}
          previewEmoteId={tab === "emotes" ? previewEmoteId : null}
        />
      </div>
    </div>
  );
}

export function StandPanel({ kind, onClose, room, economy, localSessionId, onLoadoutChange }: Props) {
  const unlocks = economy.unlocks ?? emptyPlayerUnlocks();
  const wallet = {
    copper: economy.copper,
    silver: economy.silver,
    gold: economy.gold,
    essence: economy.essence,
    rubies: economy.rubies,
  };

  const [draftLoadout, setDraftLoadout] = useState(() => normalizeLoadout(economy.loadout));
  const [selectedSlot, setSelectedSlot] = useState(() => loadStandMenuMemory().spellSlot);
  const [hideOwnedShopItems, setHideOwnedShopItems] = useState(false);
  const [talentHeaderActions, setTalentHeaderActions] = useState<ReactNode>(null);
  const [unlockConfirm, setUnlockConfirm] = useState<{
    abilityId: string;
    name: string;
    cost: number;
  } | null>(null);

  const serverLoadoutKey = normalizeLoadout(economy.loadout).join(",");
  useEffect(() => {
    setDraftLoadout(normalizeLoadout(economy.loadout));
    // Only re-sync when the server loadout / active preset actually changes — not on
    // every new array reference from schema currency ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional key-based sync
  }, [serverLoadoutKey, economy.activeLoadoutSlot]);

  const assignAbility = (abilityId: string) => {
    const slot = SPELL_SLOTS[selectedSlot];
    if (!slot || !canEquipInSlot(abilityId, slot.id)) return;
    if (!ownsAbility(unlocks.abilities, abilityId)) return;
    if (draftLoadout[selectedSlot] === abilityId) return;
    const next = [...draftLoadout];
    next[selectedSlot] = abilityId;
    const cleaned = normalizeLoadout(next);
    setDraftLoadout(cleaned);
    onLoadoutChange?.(cleaned);
    room?.send("set_loadout", { abilityIds: cleaned });
  };

  const selectPreset = (slotIndex: number) => {
    room?.send("select_loadout_preset", { slotIndex });
    const preset = economy.loadoutPresets.find((p) => p.slotIndex === slotIndex);
    if (preset) setDraftLoadout(normalizeLoadout(preset.abilityIds));
  };

  const armouryHeader =
    kind === "build"
      ? SpellArmouryHeaderExtras({
          essence: economy.essence,
          loadoutPresets: economy.loadoutPresets,
          activeLoadoutSlot: economy.activeLoadoutSlot,
          loadoutSlotCount: unlocks.loadoutSlotCount,
          onSelectPreset: selectPreset,
        })
      : null;

  let body: ReactNode = null;
  let footer: ReactNode = null;

  if (kind === "customization") {
    body = <AppearanceEditor room={room} localSessionId={localSessionId} unlocks={unlocks} />;
  } else if (kind === "build") {
    body = (
      <SpellArmoury
        draftLoadout={draftLoadout}
        selectedSlot={selectedSlot}
        onSelectSlot={(i) => {
          setSelectedSlot(i);
          saveStandMenuMemory({ spellSlot: i });
        }}
        onEquip={assignAbility}
        onRequestUnlock={(abilityId, name, cost) =>
          setUnlockConfirm({ abilityId, name, cost })
        }
        unlocks={unlocks}
        essence={economy.essence}
        talentIds={economy.talents}
        talentBuild={economy.talentBuild}
      />
    );
  } else if (kind === "talent") {
    body = (
      <TalentTreePanel
        room={room}
        essence={economy.essence}
        talentPoints={economy.talentPoints}
        talentBuild={economy.talentBuild}
        loadoutPresets={economy.loadoutPresets}
        activeLoadoutSlot={economy.activeLoadoutSlot}
        loadoutSlotCount={unlocks.loadoutSlotCount}
        onSelectPreset={selectPreset}
        onHeaderActions={setTalentHeaderActions}
      />
    );
  } else if (kind === "shop") {
    const me = localSessionId
      ? (room?.state?.players?.get(localSessionId) as Parameters<
          typeof appearanceFromPlayer
        >[0])
      : undefined;
    body = (
      <MerchantPanel
        room={room}
        unlocks={unlocks}
        wallet={wallet}
        appearanceBase={appearanceFromPlayer(me)}
        hideOwned={hideOwnedShopItems}
      />
    );
  }

  return (
    <>
      <ConfirmDialog
        open={Boolean(unlockConfirm)}
        title="Unlock spell?"
        message={
          unlockConfirm ? (
            <>
              Unlock <strong>{unlockConfirm.name}</strong> for{" "}
              <strong>{unlockConfirm.cost} essence</strong>?
            </>
          ) : null
        }
        confirmLabel={unlockConfirm ? `Unlock (−${unlockConfirm.cost})` : "Unlock"}
        onConfirm={() => {
          if (!unlockConfirm) return;
          room?.send("unlock_ability", { abilityId: unlockConfirm.abilityId });
          setUnlockConfirm(null);
        }}
        onCancel={() => setUnlockConfirm(null)}
      />
      <GamePanelShell
      title={TITLES[kind]}
      subtitle={kind === "build" ? undefined : <WalletDisplay wallet={economy} />}
      onClose={onClose}
      floatingHeader={kind === "build"}
      titleAside={
        kind === "talent"
          ? talentHeaderActions
          : kind === "build"
            ? armouryHeader?.titleAside
            : undefined
      }
      headerActions={
        kind === "shop" ? (
          <label className="bb-shop__hide-owned">
            <input
              type="checkbox"
              checked={hideOwnedShopItems}
              onChange={(e) => setHideOwnedShopItems(e.target.checked)}
            />
            Hide owned
          </label>
        ) : kind === "build" ? (
          armouryHeader?.headerActions
        ) : undefined
      }
      wide={
        kind === "customization" || kind === "talent" || kind === "build" || kind === "shop"
      }
      maxWidthClass={
        kind === "talent"
          ? "max-w-6xl"
          : kind === "build"
            ? "max-w-6xl"
            : kind === "customization"
              ? "max-w-5xl"
              : kind === "shop"
                ? "max-w-5xl"
                : undefined
      }
      maxHeightClass={
        kind === "talent"
          ? "h-[min(96dvh,62rem)] max-h-[min(96dvh,62rem)]"
          : kind === "build"
            ? "h-[min(88dvh,52rem)] max-h-[min(88dvh,52rem)]"
            : kind === "customization"
              ? "h-[min(94dvh,58rem)] max-h-[min(94dvh,58rem)]"
              : "max-h-[min(92dvh,54rem)]"
      }
      footer={footer}
    >
      {body}
    </GamePanelShell>
    </>
  );
}
