import { useMemo, useState, type ReactNode } from "react";
import { Room } from "colyseus.js";
import {
  ABILITIES,
  COSMETIC_COLORS,
  LOADOUT_SIZE,
  MAX_TALENTS,
  SHOP_ITEMS,
  SPELL_SLOTS,
  TALENTS,
  abilitiesForSlot,
  canAffordCoins,
  canEquipInSlot,
  formatAbilityArmoryStats,
  formatShopCost,
  formatWallet,
  normalizeLoadout,
} from "@battlebeasts/shared";
import { SpellSlotGlyph } from "./InputGlyph";

type Kind = "customization" | "build" | "talent" | "shop";

type Economy = {
  copper: number;
  silver: number;
  gold: number;
  essence: number;
  loadout: string[];
  talents: string[];
};

type Props = {
  kind: Kind;
  onClose: () => void;
  room: Room | null;
  economy: Economy;
};

const TITLES: Record<Kind, string> = {
  customization: "Appearance",
  build: "Spell Armoury",
  talent: "Talents",
  shop: "Merchant",
};

function BookShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="bb-overlay-dim fixed inset-0 z-40 flex items-center justify-center p-4"
      data-ui-overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="bb-parchment bb-book-panel relative z-10 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="bb-title text-lg">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-[var(--bb-ink-soft)]">{subtitle}</p> : null}
          </div>
          <button type="button" className="bb-btn-ink !px-2 !py-1 text-[10px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="bb-brass-rule mb-4" />
        {children}
      </div>
    </div>
  );
}

export function StandPanel({ kind, onClose, room, economy }: Props) {
  const [draftLoadout, setDraftLoadout] = useState(() => normalizeLoadout(economy.loadout));
  const [draftTalents, setDraftTalents] = useState(() => economy.talents);
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

  const toggleTalent = (id: string) => {
    setDraftTalents((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TALENTS) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const loadoutReady =
    draftLoadout.length === LOADOUT_SIZE && new Set(draftLoadout).size === LOADOUT_SIZE;

  return (
    <BookShell title={TITLES[kind]} subtitle={formatWallet(economy)} onClose={onClose}>
      {kind === "customization" && (
        <div className="flex flex-wrap gap-2">
          {COSMETIC_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="size-10 rounded-sm ring-2 ring-[var(--bb-brass-dim)]"
              style={{ backgroundColor: color }}
              onClick={() => room?.send("set_color", { color })}
              aria-label={`Color ${color}`}
            />
          ))}
        </div>
      )}

      {kind === "build" && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--bb-ink-soft)]">
            Each hotbar slot has its own spell pool. Equip one spell per binding.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SPELL_SLOTS.map((slot, i) => {
              const id = draftLoadout[i];
              const ability = id ? ABILITIES[id] : undefined;
              const active = selectedSlot === i;
              return (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setSelectedSlot(i)}
                  className={["bb-slot-chip", active ? "bb-slot-chip--on" : ""].join(" ")}
                >
                  <SpellSlotGlyph slot={slot} size={slot.input === "space" ? 16 : 18} />
                  <span className="text-[10px] font-semibold text-[var(--bb-ink)]">
                    {ability?.name ?? "Empty"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--bb-ink-soft)]">
            {selectedSlotDef ? <SpellSlotGlyph slot={selectedSlotDef} size={18} /> : null}
            <span>
              {selectedSlotDef?.hint} pool — {slotPool.length} available
            </span>
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {slotPool.length === 0 ? (
              <li className="text-sm text-[var(--bb-ink-soft)]">No spells in this pool yet.</li>
            ) : (
              slotPool.map((a) => {
                const equipped = draftLoadout[selectedSlot] === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => assignAbility(a.id)}
                      className={["bb-choice", equipped ? "bb-choice--on" : ""].join(" ")}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                          {a.name}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-[var(--bb-ink-soft)]">
                          {a.shape}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium leading-snug text-[var(--bb-ink)]">
                        {formatAbilityArmoryStats(a)}
                      </p>
                      {a.description ? (
                        <p className="mt-1 text-xs leading-snug text-[var(--bb-ink-soft)]">
                          {a.description}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <button
            type="button"
            className="bb-btn-brass"
            disabled={!loadoutReady}
            onClick={() => room?.send("set_loadout", { abilityIds: draftLoadout })}
          >
            Inscribe loadout
          </button>
        </div>
      )}

      {kind === "talent" && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--bb-ink-soft)]">
            Up to {MAX_TALENTS} talents ({draftTalents.length}/{MAX_TALENTS})
          </p>
          <ul className="space-y-2">
            {Object.values(TALENTS).map((t) => {
              const on = draftTalents.includes(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={["bb-choice", on ? "bb-choice--on" : ""].join(" ")}
                    onClick={() => toggleTalent(t.id)}
                  >
                    <span className="font-semibold" style={{ fontFamily: "var(--bb-font-display)" }}>
                      {t.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--bb-ink-soft)]">{t.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="bb-btn-brass"
            onClick={() => room?.send("set_talents", { talentIds: draftTalents })}
          >
            Save talents
          </button>
        </div>
      )}

      {kind === "shop" && (
        <ul className="space-y-2">
          {Object.values(SHOP_ITEMS).map((item) => {
            const canBuy =
              item.cost.kind === "coins"
                ? canAffordCoins(economy, item.cost.copper)
                : economy.essence >= item.cost.amount;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-[var(--bb-brass-dim)]/40 bg-[rgba(26,34,28,0.05)] px-3 py-2"
              >
                <span className="text-sm font-medium text-[var(--bb-ink)]">{item.name}</span>
                <button
                  type="button"
                  className={canBuy ? "bb-btn-brass" : "bb-btn-ink"}
                  disabled={!canBuy}
                  onClick={() => room?.send("shop_buy", { itemId: item.id })}
                >
                  {formatShopCost(item.cost)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </BookShell>
  );
}
