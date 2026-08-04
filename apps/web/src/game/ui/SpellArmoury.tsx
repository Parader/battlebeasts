import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ABILITIES,
  SPELL_SLOTS,
  abilitiesForSlot,
  abilityUnlockCostEssence,
  canAffordShopCost,
  canEquipInSlot,
  kitCooldownMs,
  normalizeLoadout,
  ownsAbility,
  resolveKit,
  type AbilityDef,
  type PlayerUnlocks,
  type TalentBuild,
} from "@battlebeasts/shared";
import { talentModLines } from "./abilityTalentMods";
import { ArmouryStatRow, formatSpellTag, getArmouryHighlightStats } from "./armouryStats";
import { GemIcon } from "./CoinDisplay";
import { SpellSlotGlyph } from "./InputGlyph";
import { SpellIcon } from "./SpellIcon";

type LoadoutPreset = {
  slotIndex: number;
  name: string;
  abilityIds: string[];
  talentBuild?: TalentBuild;
};

type Props = {
  draftLoadout: string[];
  selectedSlot: number;
  onSelectSlot: (index: number) => void;
  onEquip: (abilityId: string) => void;
  onRequestUnlock: (abilityId: string, name: string, cost: number) => void;
  unlocks: PlayerUnlocks;
  essence: number;
  talentIds: string[];
  talentBuild: TalentBuild;
};

function TruncatedDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text]);

  return (
    <p
      ref={ref}
      className="bb-armoury-card__desc"
      title={truncated ? text : undefined}
    >
      {text}
    </p>
  );
}

function SpellCardTooltip({
  ability,
  modLines,
  adjustedCdLabel,
}: {
  ability: AbilityDef;
  modLines: string[];
  adjustedCdLabel: string;
}) {
  return (
    <div className="bb-armoury-card__tooltip" role="tooltip">
      <p className="bb-armoury-card__tooltip-name">{ability.name}</p>
      {ability.description ? (
        <p className="bb-armoury-card__tooltip-desc">{ability.description}</p>
      ) : null}
      <p className="bb-armoury-card__tooltip-stats">{adjustedCdLabel}</p>
      {modLines.length > 0 ? (
        <ul className="bb-armoury-card__tooltip-mods">
          {modLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SpellArmouryHeaderExtras({
  essence,
  loadoutPresets,
  activeLoadoutSlot,
  loadoutSlotCount,
  onSelectPreset,
}: {
  essence: number;
  loadoutPresets: LoadoutPreset[];
  activeLoadoutSlot: number;
  loadoutSlotCount: number;
  onSelectPreset: (slotIndex: number) => void;
}): { titleAside: ReactNode; headerActions: ReactNode } {
  return {
    titleAside: (
      <div className="bb-loadout-presets bb-loadout-presets--inline" role="tablist" aria-label="Loadout presets">
        {Array.from({ length: loadoutSlotCount }, (_, i) => i).map((i) => {
          const preset = loadoutPresets.find((p) => p.slotIndex === i);
          const active = activeLoadoutSlot === i;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              className={["bb-slot-chip", active ? "bb-slot-chip--on" : ""].join(" ")}
              onClick={() => onSelectPreset(i)}
            >
              {preset?.name ?? `Loadout ${i + 1}`}
            </button>
          );
        })}
      </div>
    ),
    headerActions: (
      <span className="bb-armoury-essence" title="Essence">
        <GemIcon kind="essence" size={16} />
        <span>{essence} essence</span>
      </span>
    ),
  };
}

export function SpellArmoury({
  draftLoadout,
  selectedSlot,
  onSelectSlot,
  onEquip,
  onRequestUnlock,
  unlocks,
  essence,
  talentIds,
  talentBuild,
}: Props) {
  const selectedSlotDef = SPELL_SLOTS[selectedSlot];
  const slotPool = useMemo(
    () => (selectedSlotDef ? abilitiesForSlot(selectedSlotDef.id) : []),
    [selectedSlotDef],
  );

  const kit = useMemo(
    () => resolveKit(draftLoadout.filter(Boolean).join(","), talentIds, talentBuild),
    [draftLoadout, talentIds, talentBuild],
  );

  const wallet = { copper: 0, silver: 0, gold: 0, essence, rubies: 0 };

  return (
    <div className="bb-armoury">
      <div className="bb-armoury__bar" role="listbox" aria-label="Equipped spells">
        {SPELL_SLOTS.map((slot, i) => {
          const id = draftLoadout[i];
          const ability = id ? ABILITIES[id] : undefined;
          const active = selectedSlot === i;
          return (
            <button
              key={slot.id}
              type="button"
              role="option"
              aria-selected={active}
              className={[
                "bb-armoury-slot",
                active ? "bb-armoury-slot--on" : "",
                !ability ? "bb-armoury-slot--empty" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelectSlot(i)}
            >
              <span className="bb-armoury-slot__name">{ability?.name ?? "Empty"}</span>
              <span className="bb-armoury-slot__icon">
                {ability ? (
                  <SpellIcon abilityId={ability.id} size={72} alt={ability.name} />
                ) : (
                  <span className="bb-armoury-slot__empty-mark" aria-hidden>
                    —
                  </span>
                )}
                <span className="bb-armoury-slot__bind">
                  <SpellSlotGlyph
                    slot={slot}
                    size={slot.input === "space" ? 20 : 24}
                    tone="light"
                  />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <section
        className="bb-armoury__pool"
        aria-label={`${selectedSlotDef?.label ?? "Slot"} spells`}
      >
        <div className="bb-armoury__pool-caret-track" aria-hidden>
          {SPELL_SLOTS.map((slot, i) => (
            <span
              key={slot.id}
              className={[
                "bb-armoury__pool-caret",
                i === selectedSlot ? "bb-armoury__pool-caret--on" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
        {slotPool.length === 0 ? (
          <p className="bb-muted py-8 text-center">No spells in this pool yet.</p>
        ) : (
          <ul className="bb-armoury__grid">
            {slotPool.map((a) => {
              const owned = ownsAbility(unlocks.abilities, a.id);
              const equipped = draftLoadout[selectedSlot] === a.id;
              const stats = getArmouryHighlightStats(a);
              const adjustedCd = kitCooldownMs(kit, a.id, a.cooldownMs);
              const cdLabel = `CD ${(adjustedCd / 1000).toFixed(adjustedCd % 1000 === 0 ? 0 : 1)}s`;
              const modLines = talentModLines(a, kit);
              const tags = (a.tags ?? []).slice(0, 4);

              if (!owned) {
                const cost = abilityUnlockCostEssence(a.id);
                const afford = canAffordShopCost(wallet, { kind: "essence", amount: cost });
                return (
                  <li key={a.id}>
                    <div className="bb-armoury-card bb-armoury-card--locked">
                      <div className="bb-armoury-card__icon-wrap">
                        <SpellIcon abilityId={a.id} size={56} alt={a.name} />
                        <span className="bb-armoury-card__badge bb-armoury-card__badge--locked">
                          Locked
                        </span>
                      </div>
                      <div className="bb-armoury-card__body">
                        <p className="bb-armoury-card__name">{a.name}</p>
                        {a.description ? <TruncatedDescription text={a.description} /> : null}
                        <ArmouryStatRow stats={stats} />
                        {tags.length ? (
                          <div className="bb-armoury-card__tags">
                            {tags.map((tag) => (
                              <span key={tag} className="bb-tag">
                                {formatSpellTag(tag)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="bb-armoury-card__buy-veil">
                        <button
                          type="button"
                          className="bb-armoury-buy"
                          disabled={!afford}
                          onClick={() => onRequestUnlock(a.id, a.name, cost)}
                        >
                          Buy Spell for {cost} Essence
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }

              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canEquipInSlot(a.id, selectedSlotDef!.id)) return;
                      onEquip(a.id);
                    }}
                    className={[
                      "bb-armoury-card",
                      equipped ? "bb-armoury-card--equipped" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="bb-armoury-card__icon-wrap">
                      <SpellIcon abilityId={a.id} size={56} alt={a.name} />
                      {equipped ? (
                        <span className="bb-armoury-card__badge bb-armoury-card__badge--equipped">
                          Equipped
                        </span>
                      ) : null}
                    </div>
                    <div className="bb-armoury-card__body">
                      <p className="bb-armoury-card__name">{a.name}</p>
                      {a.description ? <TruncatedDescription text={a.description} /> : null}
                      <ArmouryStatRow stats={stats} />
                      {tags.length ? (
                        <div className="bb-armoury-card__tags">
                          {tags.map((tag) => (
                            <span key={tag} className="bb-tag">
                              {formatSpellTag(tag)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <SpellCardTooltip
                      ability={a}
                      modLines={modLines}
                      adjustedCdLabel={cdLabel}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
