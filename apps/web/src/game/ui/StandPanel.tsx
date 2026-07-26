import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Room } from "colyseus.js";
import {
  ABILITIES,
  COSMETIC_COLORS,
  COSMETIC_PATTERN_COLORS,
  COSMETIC_PATTERNS,
  COSMETIC_SLOTS,
  COSMETIC_SLOT_LABELS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  LOADOUT_SIZE,
  SPELL_SLOTS,
  abilitiesForSlot,
  canEquipInSlot,
  cosmeticsEquippedFromFields,
  cosmeticsForSlot,
  cosmeticMeshName,
  formatAbilityArmoryStats,
  formatWallet,
  getCosmeticItem,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeCosmeticsEquipped,
  normalizeLoadout,
  type CosmeticSlot,
  type CosmeticsEquipped,
  type TalentBuild,
} from "@battlebeasts/shared";
import { SpellSlotGlyph } from "./InputGlyph";
import { AppearancePreview } from "./AppearancePreview";
import { GamePanelShell } from "./GamePanelShell";
import { TalentTreePanel } from "./TalentTreePanel";
import { getCreaturePatternTexture } from "../creaturePatterns";

type Kind = "customization" | "build" | "talent" | "shop";

type Economy = {
  copper: number;
  silver: number;
  gold: number;
  essence: number;
  talentPoints: number;
  talentBuild: TalentBuild;
  loadout: string[];
  talents: string[];
};

type Props = {
  kind: Kind;
  onClose: () => void;
  room: Room | null;
  economy: Economy;
  localSessionId?: string | null;
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
}: {
  room: Room | null;
  localSessionId?: string | null;
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

  type AppearanceTab = "hide" | "gear";

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

  const slotPool = useMemo(() => cosmeticsForSlot(gearSlot), [gearSlot]);

  const setCosmetic = (slot: CosmeticSlot, itemId: string | null) => {
    setEquipped((prev) => normalizeCosmeticsEquipped({ ...prev, [slot]: itemId }));
    room?.send("set_cosmetic", { slot, itemId });
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
            Hide
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
            Gear
          </button>
        </div>

        {tab === "hide" ? (
          <div className="bb-appearance__pane" role="tabpanel">
            <p className="bb-muted">
              Changes save to your account when signed in.
            </p>

            <div>
              <p className="bb-section-label">Hide tint</p>
              <div className="flex flex-wrap gap-2">
                {COSMETIC_COLORS.map((c) => {
                  const on = c === color;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={[
                        "size-9 rounded-sm ring-2 transition",
                        on ? "ring-[var(--bb-brass)] scale-105" : "ring-[var(--bb-panel-line)]",
                      ].join(" ")}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setColor(c);
                        room?.send("set_color", { color: c });
                      }}
                      aria-label={`Hide tint ${c}`}
                      aria-pressed={on}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <p className="bb-section-label">Pattern color</p>
              <div className="flex flex-wrap gap-2">
                {COSMETIC_PATTERN_COLORS.map((c) => {
                  const on = c === patternColor;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={[
                        "size-7 rounded-sm ring-2 transition",
                        on ? "ring-[var(--bb-brass)] scale-105" : "ring-[var(--bb-panel-line)]",
                      ].join(" ")}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setPatternColor(c);
                        room?.send("set_pattern_color", { patternColor: c });
                      }}
                      aria-label={`Pattern color ${c}`}
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
                {COSMETIC_PATTERNS.map((p) => {
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
        ) : (
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
                        <span className="bb-loadout-slot__meta" style={{ gridColumn: "1 / -1" }}>
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
                      {slotPool.length
                        ? "Click to equip · click equipped to clear"
                        : "No items in this slot yet"}
                    </p>
                  </div>
                </header>
                {slotPool.length === 0 ? (
                  <p className="bb-muted px-1 py-6 text-center">
                    Parent gear under the Mixamo skeleton in <code className="bb-meta">hero.glb</code>
                    , then register the object name in the catalog (hidden until equipped).
                  </p>
                ) : (
                  <ul className="bb-loadout__pool-list">
                    {slotPool.map((item) => {
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
        )}
      </div>

      <div className="bb-appearance__preview-col">
        <AppearancePreview
          color={color}
          pattern={pattern}
          patternColor={patternColor}
          cosmeticsEquipped={equipped}
        />
      </div>
    </div>
  );
}

export function StandPanel({ kind, onClose, room, economy, localSessionId }: Props) {
  const [draftLoadout, setDraftLoadout] = useState(() => normalizeLoadout(economy.loadout));
  const [selectedSlot, setSelectedSlot] = useState(0);

  const selectedSlotDef = SPELL_SLOTS[selectedSlot];
  const slotPool = useMemo(
    () => (selectedSlotDef ? abilitiesForSlot(selectedSlotDef.id) : []),
    [selectedSlotDef],
  );

  const assignAbility = (abilityId: string) => {
    const slot = SPELL_SLOTS[selectedSlot];
    if (!slot || !canEquipInSlot(abilityId, slot.id)) return;
    setDraftLoadout((prev) => {
      const next = [...prev];
      next[selectedSlot] = abilityId;
      return normalizeLoadout(next);
    });
  };

  const loadoutReady =
    draftLoadout.length === LOADOUT_SIZE && new Set(draftLoadout).size === LOADOUT_SIZE;

  let body: ReactNode = null;
  let footer: ReactNode = null;

  if (kind === "customization") {
    body = <AppearanceEditor room={room} localSessionId={localSessionId} />;
  } else if (kind === "build") {
    body = (
      <div className="bb-loadout">
        <aside className="bb-loadout__rail">
          <div className="bb-loadout__rail-head">
            <p className="bb-section-label mb-0">Loadout</p>
            <span className="bb-meta">
              {draftLoadout.filter(Boolean).length}/{LOADOUT_SIZE}
            </span>
          </div>
          <div className="bb-loadout__slots" role="listbox" aria-label="Spell slots">
            {SPELL_SLOTS.map((slot, i) => {
              const id = draftLoadout[i];
              const ability = id ? ABILITIES[id] : undefined;
              const active = selectedSlot === i;
              const empty = !ability;
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedSlot(i)}
                  className={[
                    "bb-loadout-slot",
                    active ? "bb-loadout-slot--on" : "",
                    empty ? "bb-loadout-slot--empty" : "",
                  ].join(" ")}
                >
                  <span className="bb-loadout-slot__bind">
                    <SpellSlotGlyph slot={slot} size={slot.input === "space" ? 22 : 28} />
                  </span>
                  <span className="bb-loadout-slot__meta">
                    <p className="bb-loadout-slot__key">{slot.label}</p>
                    <p className="bb-loadout-slot__name">{ability?.name ?? "Empty"}</p>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="bb-loadout__pool" aria-label="Spell pool">
          <header className="bb-loadout__pool-head">
            {selectedSlotDef ? (
              <SpellSlotGlyph
                slot={selectedSlotDef}
                size={selectedSlotDef.input === "space" ? 22 : 26}
              />
            ) : null}
            <div>
              <h3 className="bb-loadout__pool-title">
                {selectedSlotDef?.label ?? "Slot"} spells
              </h3>
              <p className="bb-meta mt-1">
                {selectedSlotDef?.hint} · {slotPool.length} available — click to equip
              </p>
            </div>
          </header>

          <ul className="bb-loadout__pool-list">
            {slotPool.length === 0 ? (
              <li className="bb-muted py-8 text-center">No spells in this pool yet.</li>
            ) : (
              slotPool.map((a) => {
                const equipped = draftLoadout[selectedSlot] === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => assignAbility(a.id)}
                      className={[
                        "bb-loadout-card",
                        equipped ? "bb-loadout-card--on" : "",
                      ].join(" ")}
                    >
                      <div className="bb-loadout-card__main">
                        <div className="bb-loadout-card__top">
                          <span className="bb-loadout-card__name">{a.name}</span>
                          <span className="bb-loadout-card__shape">{a.shape}</span>
                        </div>
                        <p className="bb-loadout-card__stats">{formatAbilityArmoryStats(a)}</p>
                        {a.description ? (
                          <p className="bb-loadout-card__desc">{a.description}</p>
                        ) : null}
                        {a.tags?.length ? (
                          <div className="bb-loadout-card__tags">
                            {a.tags.slice(0, 6).map((tag) => (
                              <span key={tag} className="bb-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <span className="bb-loadout-card__action">
                        {equipped ? "Equipped" : "Equip"}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </div>
    );
    footer = (
      <button
        type="button"
        className="bb-btn-brass min-w-[12rem] disabled:opacity-40"
        disabled={!loadoutReady}
        onClick={() => {
          if (!loadoutReady) return;
          room?.send("set_loadout", { abilityIds: draftLoadout });
          onClose();
        }}
      >
        Save loadout
      </button>
    );
  } else if (kind === "talent") {
    body = (
      <TalentTreePanel
        room={room}
        essence={economy.essence}
        talentPoints={economy.talentPoints}
        talentBuild={economy.talentBuild}
      />
    );
  } else if (kind === "shop") {
    body = (
      <p className="bb-section-label py-10 text-center tracking-[0.2em]">In development</p>
    );
  }

  return (
    <GamePanelShell
      title={TITLES[kind]}
      subtitle={formatWallet(economy)}
      onClose={onClose}
      wide={kind === "customization" || kind === "talent" || kind === "build"}
      maxWidthClass={
        kind === "build" || kind === "talent" || kind === "customization"
          ? "max-w-5xl"
          : undefined
      }
      maxHeightClass={
        kind === "talent" || kind === "customization"
          ? "h-[min(94dvh,58rem)] max-h-[min(94dvh,58rem)]"
          : "max-h-[min(92dvh,54rem)]"
      }
      footer={footer}
    >
      {body}
    </GamePanelShell>
  );
}
