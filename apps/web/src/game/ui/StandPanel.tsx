import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Room } from "colyseus.js";
import {
  ABILITIES,
  COSMETIC_COLORS,
  COSMETIC_PATTERN_COLORS,
  COSMETIC_PATTERNS,
  DEFAULT_COSMETIC_PATTERN,
  DEFAULT_COSMETIC_PATTERN_COLOR,
  LOADOUT_SIZE,
  SHOP_ITEMS,
  SPELL_SLOTS,
  abilitiesForSlot,
  canEquipInSlot,
  formatAbilityArmoryStats,
  formatWallet,
  normalizeCosmeticPattern,
  normalizeCosmeticPatternColor,
  normalizeLoadout,
  type TalentBuild,
} from "@battlebeasts/shared";
import { SpellSlotGlyph } from "./InputGlyph";
import { AppearancePreview } from "./AppearancePreview";
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

function BookShell({
  title,
  subtitle,
  onClose,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
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
        className={[
          "bb-parchment bb-book-panel relative z-10 w-full",
          wide ? "max-w-4xl" : "max-w-lg",
        ].join(" ")}
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
  const me = localSessionId
    ? (room?.state?.players?.get(localSessionId) as
        | { color?: string; pattern?: string; patternColor?: string }
        | undefined)
    : undefined;
  const [color, setColor] = useState(me?.color ?? COSMETIC_COLORS[0]);
  const [pattern, setPattern] = useState(
    normalizeCosmeticPattern(me?.pattern ?? DEFAULT_COSMETIC_PATTERN),
  );
  const [patternColor, setPatternColor] = useState(
    normalizeCosmeticPatternColor(me?.patternColor ?? DEFAULT_COSMETIC_PATTERN_COLOR),
  );

  useEffect(() => {
    if (me?.color && (COSMETIC_COLORS as readonly string[]).includes(me.color)) {
      setColor(me.color);
    }
    if (me?.pattern) setPattern(normalizeCosmeticPattern(me.pattern));
    if (me?.patternColor) setPatternColor(normalizeCosmeticPatternColor(me.patternColor));
  }, [me?.color, me?.pattern, me?.patternColor]);

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] sm:items-start">
      <div className="space-y-4">
        <p className="text-xs text-[var(--bb-ink-soft)]">
          Changes save to your account when signed in, and load next time you join.
        </p>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--bb-ink-soft)]">
            Hide tint
          </p>
          <div className="flex flex-wrap gap-2">
            {COSMETIC_COLORS.map((c) => {
              const on = c === color;
              return (
                <button
                  key={c}
                  type="button"
                  className={[
                    "size-10 rounded-sm ring-2 transition",
                    on ? "ring-[var(--bb-brass)] scale-105" : "ring-[var(--bb-brass-dim)]",
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
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--bb-ink-soft)]">
            Pattern color
          </p>
          <div className="flex flex-wrap gap-2">
            {COSMETIC_PATTERN_COLORS.map((c) => {
              const on = c === patternColor;
              return (
                <button
                  key={c}
                  type="button"
                  className={[
                    "size-8 rounded-sm ring-2 transition",
                    on ? "ring-[var(--bb-brass)] scale-105" : "ring-[var(--bb-brass-dim)]",
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
            <p className="mt-1 text-[10px] text-[var(--bb-ink-soft)]">
              Pick a pattern first — plain hide has no markings.
            </p>
          ) : null}
        </div>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--bb-ink-soft)]">
            Creature pattern
          </p>
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
                  <span className="mb-1.5 block h-9 w-full overflow-hidden rounded-[2px] ring-1 ring-black/10">
                    <PatternSwatch patternId={p.id} patternColor={patternColor} />
                  </span>
                  <span
                    className="block text-xs font-semibold"
                    style={{ fontFamily: "var(--bb-font-display)" }}
                  >
                    {p.name}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-[var(--bb-ink-soft)]">
                    {p.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <AppearancePreview color={color} pattern={pattern} patternColor={patternColor} />
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

  return (
    <BookShell
      title={TITLES[kind]}
      subtitle={formatWallet(economy)}
      onClose={onClose}
      wide={kind === "customization" || kind === "talent"}
    >
      {kind === "customization" && (
        <AppearanceEditor room={room} localSessionId={localSessionId} />
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
                      {a.tags?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-sm bg-[var(--bb-ink)]/8 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--bb-ink-soft)]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
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
            className="bb-btn-brass w-full disabled:opacity-40"
            disabled={!loadoutReady}
            onClick={() => {
              if (!loadoutReady) return;
              room?.send("set_loadout", { abilityIds: draftLoadout });
            }}
          >
            Save loadout
          </button>
        </div>
      )}

      {kind === "talent" && (
        <TalentTreePanel
          room={room}
          essence={economy.essence}
          talentPoints={economy.talentPoints}
          talentBuild={economy.talentBuild}
        />
      )}

      {kind === "shop" && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--bb-ink-soft)]">
            The merchant is still in development — shopping is locked for now.
          </p>
          <ul className="space-y-2 opacity-55">
            {Object.values(SHOP_ITEMS).map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-[var(--bb-brass-dim)]/40 bg-[rgba(26,34,28,0.05)] px-3 py-2"
              >
                <span className="text-sm font-medium text-[var(--bb-ink)]">{item.name}</span>
                <button
                  type="button"
                  className="bb-btn-ink"
                  disabled
                  title="Still in development"
                >
                  Coming soon
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </BookShell>
  );
}
