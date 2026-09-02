import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ABILITIES,
  FLEX_COST_BY_FAMILY,
  FLEX_ROLES,
  FLEX_SLOT_COUNT,
  SPELL_SLOTS,
  abilitiesForSlot,
  abilityUnlockCostEssence,
  canAffordShopCost,
  canEquipInSlot,
  flexCost,
  flexSlotUnlockCost,
  kitCooldownMs,
  ownsAbility,
  resolveKit,
  rolesForAbility,
  type AbilityDef,
  type FlexLoadout,
  type FlexRoleId,
  type PlayerUnlocks,
  type SpellSlotId,
  type TalentBuild,
} from "@battlebeasts/shared";
import { talentModLines } from "./abilityTalentMods";
import { ArmouryStatRow, formatSpellTag, getArmouryHighlightStats } from "./armouryStats";
import { GemIcon } from "./CoinDisplay";
import { KeyGlyph, SpellSlotGlyph } from "./InputGlyph";
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
  /** Flex picks (keys 1-3), paid for in Energy rather than owned outright. */
  flexDraft: FlexLoadout;
  /** Which flex slot is being edited, or null when a main slot is selected. */
  selectedFlex: number | null;
  onSelectFlex: (index: number) => void;
  onEquipFlex: (abilityId: string | null) => void;
  /** Ask to buy the next flex slot. Only offered for the very next locked one. */
  onRequestFlexSlotUnlock: (toCount: number, cost: number) => void;
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

/**
 * One spell in the pool, for either the main bar or a flex slot.
 *
 * `blockedReason` covers the case a flex slot introduces and the main bar
 * cannot have: a spell that is legal here but pointless, because the same
 * spell elsewhere in the kit already shares its cooldown. Those stay visible
 * and greyed rather than filtered out -- a spell vanishing from the list with
 * no explanation reads as a bug, and the reason is the useful part.
 */
function SpellCard({
  ability,
  owned,
  equipped,
  blockedReason,
  energyCost,
  stats,
  cdLabel,
  modLines,
  unlockCost,
  canAffordUnlock,
  onEquip,
  onRequestUnlock,
}: {
  ability: AbilityDef;
  owned: boolean;
  equipped: boolean;
  blockedReason: string | null;
  energyCost: number | null;
  stats: ReturnType<typeof getArmouryHighlightStats>;
  cdLabel: string;
  modLines: string[];
  unlockCost: number;
  canAffordUnlock: boolean;
  onEquip: () => void;
  onRequestUnlock: () => void;
}) {
  const tags = (ability.tags ?? []).slice(0, 4);

  const body = (
    <>
      <div className="bb-armoury-card__icon-wrap">
        <SpellIcon abilityId={ability.id} size={56} alt={ability.name} />
        {!owned ? (
          <span className="bb-armoury-card__badge bb-armoury-card__badge--locked">Locked</span>
        ) : equipped ? (
          <span className="bb-armoury-card__badge bb-armoury-card__badge--equipped">
            Equipped
          </span>
        ) : null}
      </div>
      <div className="bb-armoury-card__body">
        <p className="bb-armoury-card__name">
          {ability.name}
          {energyCost !== null ? (
            <span className="bb-armoury-card__energy" title={`${energyCost} Energy to cast`}>
              {energyCost} ⚡
            </span>
          ) : null}
        </p>
        {ability.description ? <TruncatedDescription text={ability.description} /> : null}
        <ArmouryStatRow stats={stats} />
        {blockedReason ? (
          <p className="bb-armoury-card__blocked">{blockedReason}</p>
        ) : tags.length ? (
          <div className="bb-armoury-card__tags">
            {tags.map((tag) => (
              <span key={tag} className="bb-tag">
                {formatSpellTag(tag)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );

  if (!owned) {
    return (
      <div className="bb-armoury-card bb-armoury-card--locked">
        {body}
        <div className="bb-armoury-card__buy-veil">
          <button
            type="button"
            className="bb-armoury-buy"
            disabled={!canAffordUnlock}
            onClick={onRequestUnlock}
          >
            Buy Spell for {unlockCost} Essence
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={Boolean(blockedReason)}
      onClick={onEquip}
      className={[
        "bb-armoury-card",
        equipped ? "bb-armoury-card--equipped" : "",
        blockedReason ? "bb-armoury-card--blocked" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {body}
      <SpellCardTooltip ability={ability} modLines={modLines} adjustedCdLabel={cdLabel} />
    </button>
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
  flexDraft,
  selectedFlex,
  onSelectFlex,
  onEquipFlex,
  onRequestFlexSlotUnlock,
}: Props) {
  const flexMode = selectedFlex !== null;
  const flexSlotCount = unlocks.flexSlotCount;
  const selectedSlotDef = SPELL_SLOTS[selectedSlot];

  const [familyFilter, setFamilyFilter] = useState<SpellSlotId | "all">("all");
  const [roleFilter, setRoleFilter] = useState<FlexRoleId | "all">("all");

  const slotPool = useMemo(
    () => (selectedSlotDef ? abilitiesForSlot(selectedSlotDef.id) : []),
    [selectedSlotDef],
  );

  /**
   * The flex pool is the whole catalogue, grouped by family. Family is the
   * price axis -- every spell in a family costs the same -- so grouping by it
   * means the cost is learned once per section instead of read off 35 cards.
   */
  const flexGroups = useMemo(() => {
    return SPELL_SLOTS.filter((s) => familyFilter === "all" || s.id === familyFilter)
      .map((s) => ({
        family: s,
        abilities: abilitiesForSlot(s.id).filter(
          (a) => roleFilter === "all" || rolesForAbility(a.id).includes(roleFilter),
        ),
      }))
      .filter((g) => g.abilities.length > 0);
  }, [familyFilter, roleFilter]);

  const kit = useMemo(
    () => resolveKit(draftLoadout.filter(Boolean).join(","), talentIds, talentBuild),
    [draftLoadout, talentIds, talentBuild],
  );

  const wallet = { copper: 0, silver: 0, gold: 0, essence, rubies: 0 };

  /** Why this spell would be dead weight in the flex slot being edited. */
  const flexBlockedReason = (abilityId: string): string | null => {
    if (!flexMode) return null;
    const otherFlex = flexDraft.findIndex((id, i) => id === abilityId && i !== selectedFlex);
    if (otherFlex >= 0) return `Already in flex ${otherFlex + 1} — they share a cooldown`;
    const onBar = draftLoadout.indexOf(abilityId);
    if (onBar >= 0) {
      return `Already on ${SPELL_SLOTS[onBar]?.label ?? "the bar"} — they share a cooldown`;
    }
    return null;
  };

  return (
    <div className="bb-armoury">
      <div className="bb-armoury__bar" role="listbox" aria-label="Equipped spells">
        {SPELL_SLOTS.map((slot, i) => {
          const id = draftLoadout[i];
          const ability = id ? ABILITIES[id] : undefined;
          const active = !flexMode && selectedSlot === i;
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

      <div className="bb-flex-row">
        <span className="bb-flex-row__label" title="Cast with 1, 2, 3 — costs Energy">
          Flex
        </span>
        <div className="bb-flex-row__slots" role="listbox" aria-label="Flex spells">
          {Array.from({ length: FLEX_SLOT_COUNT }, (_, i) => {
            const locked = i >= flexSlotCount;
            const id = locked ? null : flexDraft[i];
            const ability = id ? ABILITIES[id] : undefined;
            const active = selectedFlex === i;
            // Slots unlock in order, so only the first locked one is buyable.
            const buyable = locked && i === flexSlotCount;
            const slotCost = locked ? flexSlotUnlockCost(i + 1) : 0;
            return (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={active}
                disabled={locked && !buyable}
                title={
                  locked
                    ? buyable
                      ? `Unlock flex slot ${i + 1} for ${slotCost} essence`
                      : `Unlock flex slot ${i} first`
                    : undefined
                }
                className={[
                  "bb-flex-pick",
                  active ? "bb-flex-pick--on" : "",
                  !ability && !locked ? "bb-flex-pick--empty" : "",
                  locked ? "bb-flex-pick--locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() =>
                  locked
                    ? buyable && onRequestFlexSlotUnlock(i + 1, slotCost)
                    : onSelectFlex(i)
                }
              >
                <span className="bb-flex-pick__icon">
                  {ability ? (
                    <SpellIcon abilityId={ability.id} size={44} alt={ability.name} />
                  ) : (
                    <span className="bb-flex-pick__empty-mark" aria-hidden>
                      {locked ? "\u{1F512}" : "—"}
                    </span>
                  )}
                  <span className="bb-flex-pick__bind">
                    <KeyGlyph label={String(i + 1)} size={18} tone="light" />
                  </span>
                  {ability ? (
                    <span className="bb-flex-pick__cost">{flexCost(ability.id)}</span>
                  ) : null}
                </span>
                <span className="bb-flex-pick__name">
                  {locked
                    ? buyable
                      ? `${slotCost} essence`
                      : "Locked"
                    : (ability?.name ?? "Empty")}
                </span>
              </button>
            );
          })}
        </div>
        {flexMode && flexDraft[selectedFlex] ? (
          <button
            type="button"
            className="bb-flex-row__clear"
            onClick={() => onEquipFlex(null)}
          >
            Clear slot {selectedFlex + 1}
          </button>
        ) : null}
      </div>

      <section
        className="bb-armoury__pool"
        aria-label={
          flexMode ? `Flex slot ${selectedFlex + 1} spells` : `${selectedSlotDef?.label ?? "Slot"} spells`
        }
      >
        {!flexMode ? (
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
        ) : null}

        {flexMode ? (
          <div className="bb-flex-filters">
            <div className="bb-flex-filters__group" role="group" aria-label="Filter by cost">
              <span className="bb-flex-filters__legend">Cost</span>
              <button
                type="button"
                className={["bb-slot-chip", familyFilter === "all" ? "bb-slot-chip--on" : ""].join(" ")}
                onClick={() => setFamilyFilter("all")}
              >
                All
              </button>
              {SPELL_SLOTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={["bb-slot-chip", familyFilter === s.id ? "bb-slot-chip--on" : ""].join(" ")}
                  onClick={() => setFamilyFilter(s.id)}
                >
                  {s.label}
                  <span className="bb-flex-filters__pips">{FLEX_COST_BY_FAMILY[s.id]}</span>
                </button>
              ))}
            </div>
            <div className="bb-flex-filters__group" role="group" aria-label="Filter by role">
              <span className="bb-flex-filters__legend">Role</span>
              <button
                type="button"
                className={["bb-slot-chip", roleFilter === "all" ? "bb-slot-chip--on" : ""].join(" ")}
                onClick={() => setRoleFilter("all")}
              >
                All
              </button>
              {FLEX_ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={["bb-slot-chip", roleFilter === r.id ? "bb-slot-chip--on" : ""].join(" ")}
                  onClick={() => setRoleFilter(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {flexMode ? (
          flexGroups.length === 0 ? (
            <p className="bb-muted py-8 text-center">No spells match these filters.</p>
          ) : (
            <div className="bb-flex-groups">
              {flexGroups.map(({ family, abilities }) => (
                <section key={family.id} className="bb-flex-group">
                  <header className="bb-flex-group__header">
                    <span className="bb-flex-group__name">{family.label}</span>
                    <span className="bb-flex-group__cost">
                      {FLEX_COST_BY_FAMILY[family.id]} Energy
                    </span>
                  </header>
                  <ul className="bb-armoury__grid">
                    {abilities.map((a) => {
                      const owned = ownsAbility(unlocks.abilities, a.id);
                      const adjustedCd = kitCooldownMs(kit, a.id, a.cooldownMs);
                      const unlockCost = abilityUnlockCostEssence(a.id);
                      return (
                        <li key={a.id}>
                          <SpellCard
                            ability={a}
                            owned={owned}
                            equipped={flexDraft[selectedFlex] === a.id}
                            blockedReason={flexBlockedReason(a.id)}
                            energyCost={flexCost(a.id)}
                            stats={getArmouryHighlightStats(a)}
                            cdLabel={`CD ${(adjustedCd / 1000).toFixed(adjustedCd % 1000 === 0 ? 0 : 1)}s`}
                            modLines={talentModLines(a, kit)}
                            unlockCost={unlockCost}
                            canAffordUnlock={canAffordShopCost(wallet, {
                              kind: "essence",
                              amount: unlockCost,
                            })}
                            onEquip={() => onEquipFlex(a.id)}
                            onRequestUnlock={() => onRequestUnlock(a.id, a.name, unlockCost)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )
        ) : null}
        {flexMode ? null : slotPool.length === 0 ? (
          <p className="bb-muted py-8 text-center">No spells in this pool yet.</p>
        ) : (
          <ul className="bb-armoury__grid">
            {slotPool.map((a) => {
              const owned = ownsAbility(unlocks.abilities, a.id);
              const adjustedCd = kitCooldownMs(kit, a.id, a.cooldownMs);
              const unlockCost = abilityUnlockCostEssence(a.id);
              return (
                <li key={a.id}>
                  <SpellCard
                    ability={a}
                    owned={owned}
                    equipped={draftLoadout[selectedSlot] === a.id}
                    blockedReason={null}
                    energyCost={null}
                    stats={getArmouryHighlightStats(a)}
                    cdLabel={`CD ${(adjustedCd / 1000).toFixed(adjustedCd % 1000 === 0 ? 0 : 1)}s`}
                    modLines={talentModLines(a, kit)}
                    unlockCost={unlockCost}
                    canAffordUnlock={canAffordShopCost(wallet, {
                      kind: "essence",
                      amount: unlockCost,
                    })}
                    onEquip={() => {
                      if (!selectedSlotDef || !canEquipInSlot(a.id, selectedSlotDef.id)) return;
                      onEquip(a.id);
                    }}
                    onRequestUnlock={() => onRequestUnlock(a.id, a.name, unlockCost)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
