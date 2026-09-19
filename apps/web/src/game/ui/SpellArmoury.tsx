import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ABILITIES,
  FLEX_COST_BY_FAMILY,
  FLEX_ROLES,
  FLEX_SLOT_COUNT,
  SPELL_SLOTS,
  abilitiesForSlot,
  abilityUnlockCostForPlayer,
  canAffordShopCost,
  hasFirstUnlockVoucher,
  flexCost,
  flexSlotUnlockCost,
  kitCooldownMs,
  ownsAbility,
  resolveKit,
  rolesForAbility,
  TALENT_CATALOG,
  type AbilityDef,
  type FlexLoadout,
  type FlexRoleId,
  type PlayerUnlocks,
  type SpellSlotId,
  type TalentBuild,
} from "@battlebeasts/shared";
import { talentModsForSpell, type TalentSpellMod } from "./abilityTalentMods";
import { ArmouryStatRow, formatSpellTag, getArmouryHighlightStats } from "./armouryStats";
import { GemIcon } from "./CoinDisplay";
import { KeyGlyph, SpellSlotGlyph } from "./InputGlyph";
import { LoadoutPresetTabs } from "./LoadoutPresetTabs";
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
  open,
  anchor,
  ability,
  mods,
  adjustedCdLabel,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  ability: AbilityDef;
  mods: TalentSpellMod[];
  adjustedCdLabel: string;
}) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const el = tipRef.current;
      if (!el) return;
      const card = anchor.getBoundingClientRect();
      const tip = el.getBoundingClientRect();
      const gap = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = card.left;
      left = Math.max(10, Math.min(left, vw - tip.width - 10));
      const below = card.bottom + gap;
      const above = card.top - tip.height - gap;
      let top = below + tip.height <= vh - 10 ? below : above;
      if (top < 10) top = 10;
      if (top + tip.height > vh - 10) top = Math.max(10, vh - tip.height - 10);
      setPos({
        position: "fixed",
        left,
        top,
        visibility: "visible",
        zIndex: 80,
      });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, ability.id, mods.length, adjustedCdLabel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div ref={tipRef} className="bb-armoury-card__tooltip" role="tooltip" style={pos}>
      <p className="bb-armoury-card__tooltip-name">{ability.name}</p>
      {ability.description ? (
        <p className="bb-armoury-card__tooltip-desc">{ability.description}</p>
      ) : null}
      <p className="bb-armoury-card__tooltip-stats">{adjustedCdLabel}</p>
      {mods.length > 0 ? (
        <>
          <p className="bb-armoury-card__tooltip-talents-label">Talents</p>
          <ul className="bb-armoury-card__tooltip-mods">
            {mods.map((mod) => (
              <li key={`${mod.talentId}:${mod.effect}`}>
                <strong>{mod.name}.</strong> {mod.effect}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>,
    document.body,
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
  mods,
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
  mods: TalentSpellMod[];
  unlockCost: number;
  canAffordUnlock: boolean;
  onEquip: () => void;
  onRequestUnlock: () => void;
}) {
  const tags = (ability.tags ?? []).slice(0, 4);
  const cardRef = useRef<HTMLButtonElement>(null);
  const [tipOpen, setTipOpen] = useState(false);

  const tooltip = (
    <SpellCardTooltip
      open={tipOpen}
      anchor={cardRef.current}
      ability={ability}
      mods={mods}
      adjustedCdLabel={cdLabel}
    />
  );

  const body = (
    <>
      <div className="bb-armoury-card__icon-wrap">
        <SpellIcon abilityId={ability.id} size={56} alt={ability.name} />
        {!owned ? (
          <span className="bb-armoury-card__badge bb-armoury-card__badge--locked">
            {ability.talentTreeUnlock ? "Talent Locked" : "Locked"}
          </span>
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
        {ability.talentTreeUnlock ? (
          <div className="bb-armoury-card__talent-badge" style={{ marginBottom: "0.25rem" }}>
            <span
              className="bb-tag bb-tag--talent"
              style={{
                background: "rgba(245, 158, 11, 0.2)",
                color: "#fbbf24",
                border: "1px solid rgba(245, 158, 11, 0.45)",
                fontWeight: 600,
                fontSize: "0.72rem",
              }}
            >
              Unlockable in {ability.talentTreeUnlock.tree} talent tree
            </span>
          </div>
        ) : null}
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
          {ability.talentTreeUnlock ? (
            <div
              className="bb-armoury-talent-req"
              style={{
                padding: "0.55rem 0.85rem",
                borderRadius: "4px",
                background: "rgba(180, 83, 9, 0.9)",
                color: "#fef3c7",
                fontSize: "0.8rem",
                fontWeight: 700,
                textAlign: "center",
                lineHeight: 1.3,
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(245, 158, 11, 0.5)",
              }}
            >
              Requires {TALENT_CATALOG[ability.talentTreeUnlock.talentId]?.name ?? "Talent"} in {ability.talentTreeUnlock.tree} Talent Tree (Tier {ability.talentTreeUnlock.tier})
            </div>
          ) : (
            <button
              type="button"
              className="bb-armoury-buy"
              disabled={!canAffordUnlock}
              onClick={onRequestUnlock}
            >
              {unlockCost <= 0 ? "Claim first pick" : `Buy Spell for ${unlockCost} Essence`}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      ref={cardRef}
      type="button"
      disabled={Boolean(blockedReason)}
      onClick={onEquip}
      onPointerEnter={() => setTipOpen(true)}
      onPointerLeave={() => setTipOpen(false)}
      onFocus={() => setTipOpen(true)}
      onBlur={() => setTipOpen(false)}
      className={[
        "bb-armoury-card",
        equipped ? "bb-armoury-card--equipped" : "",
        blockedReason ? "bb-armoury-card--blocked" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {body}
      {tooltip}
    </button>
  );
}

export function SpellArmouryHeaderExtras({
  essence,
  loadoutPresets,
  activeLoadoutSlot,
  loadoutSlotCount,
  onSelectPreset,
  onRenamePreset,
  disabled,
}: {
  essence: number;
  loadoutPresets: LoadoutPreset[];
  activeLoadoutSlot: number;
  loadoutSlotCount: number;
  onSelectPreset: (slotIndex: number) => void;
  onRenamePreset: (slotIndex: number, name: string) => void;
  disabled?: boolean;
}): { titleAside: ReactNode; headerActions: ReactNode } {
  return {
    titleAside: (
      <LoadoutPresetTabs
        className="bb-loadout-presets--inline"
        loadoutPresets={loadoutPresets}
        activeLoadoutSlot={activeLoadoutSlot}
        loadoutSlotCount={loadoutSlotCount}
        onSelectPreset={onSelectPreset}
        onRenamePreset={onRenamePreset}
        disabled={disabled}
      />
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
                      const owned = ownsAbility(unlocks.abilities, a.id, talentBuild);
                      const adjustedCd = kitCooldownMs(kit, a.id, a.cooldownMs);
                      const unlockCost = abilityUnlockCostForPlayer(a.id, unlocks.abilities);
                      const voucher = hasFirstUnlockVoucher(unlocks.abilities, a.id);
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
                            mods={talentModsForSpell(a, kit)}
                            unlockCost={unlockCost}
                            canAffordUnlock={
                              voucher ||
                              canAffordShopCost(wallet, {
                                kind: "essence",
                                amount: unlockCost,
                              })
                            }
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
              const owned = ownsAbility(unlocks.abilities, a.id, talentBuild);
              const adjustedCd = kitCooldownMs(kit, a.id, a.cooldownMs);
              const unlockCost = abilityUnlockCostForPlayer(a.id, unlocks.abilities);
              const voucher = hasFirstUnlockVoucher(unlocks.abilities, a.id);
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
                    mods={talentModsForSpell(a, kit)}
                    unlockCost={unlockCost}
                    canAffordUnlock={
                      voucher ||
                      canAffordShopCost(wallet, {
                        kind: "essence",
                        amount: unlockCost,
                      })
                    }
                    onEquip={() => onEquip(a.id)}
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
