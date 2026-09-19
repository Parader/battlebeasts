import { useMemo, useState } from "react";
import {
  ABILITIES,
  SPELL_SLOTS,
  type AbilityDef,
  type AbilityShape,
  type SpellSlotId,
} from "@battlebeasts/shared";

export type LabSpawnKind = "dummy" | "copy" | "enemy" | "chaser";

type Props = {
  open: boolean;
  onClose: () => void;
  loadout: string[];
  adminNoCooldown: boolean;
  onToggleNoCooldown: (enabled: boolean) => void;
  onGrantAll: () => void;
  onEquip: (abilityId: string) => void;
  onSpawn: (kind: LabSpawnKind) => void;
  onClear: (scope?: "enemy") => void;
};

const SHAPES: AbilityShape[] = ["projectile", "aoe", "dash", "melee", "buff"];

const ABILITY_LIST = Object.values(ABILITIES)
  .filter((d): d is AbilityDef => Boolean(d?.id && d.name))
  .sort((a, b) => a.name.localeCompare(b.name));

function slotLabelFor(def: AbilityDef): string {
  const preferred =
    def.defaultSlot && def.allowedSlots.includes(def.defaultSlot)
      ? SPELL_SLOTS.find((s) => s.id === def.defaultSlot)
      : undefined;
  if (preferred) return preferred.label;
  const first = SPELL_SLOTS.find((s) => def.allowedSlots.includes(s.id));
  return first?.label ?? "?";
}

function matchesSlot(def: AbilityDef, slot: SpellSlotId): boolean {
  return def.allowedSlots.includes(slot) || def.defaultSlot === slot;
}

/** Live-game spell sandbox: swap loadout, spawn bodies, keep HUD and keybinds. */
export function SpellLabPanel({
  open,
  onClose,
  loadout,
  adminNoCooldown,
  onToggleNoCooldown,
  onGrantAll,
  onEquip,
  onSpawn,
  onClear,
}: Props) {
  const [search, setSearch] = useState("");
  const [shape, setShape] = useState<AbilityShape | "">("");
  const [slot, setSlot] = useState<SpellSlotId | "">("");
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      ABILITY_LIST.filter((d) => {
        if (shape && d.shape !== shape) return false;
        if (slot && !matchesSlot(d, slot)) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q)
        );
      }),
    [q, shape, slot],
  );

  if (!open) return null;

  return (
    <div
      data-ui-overlay
      className="pointer-events-auto fixed top-14 right-3 z-30 flex w-[min(42rem,54vw)] max-h-[min(86dvh,820px)] flex-col"
    >
      <div className="bb-parchment bb-book-panel flex min-h-0 flex-1 flex-col">
        <header className="bb-panel-header shrink-0">
          <div className="bb-panel-header__lead">
            <div className="bb-panel-title-row">
              <h2 className="bb-panel-title">Spell lab</h2>
            </div>
            <div className="bb-panel-sub">
              Real combat. Mimics recast with you. Click a spell onto its key.
            </div>
          </div>
          <div className="bb-panel-header__actions">
            <button type="button" className="bb-btn-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </header>
        <div className="bb-panel-body min-h-0 flex-1 overflow-y-auto">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="bb-btn-brass" onClick={onGrantAll}>
                Unlock all
              </button>
              <button
                type="button"
                className={adminNoCooldown ? "bb-btn-brass" : "bb-btn-ink"}
                onClick={() => onToggleNoCooldown(!adminNoCooldown)}
              >
                {adminNoCooldown ? "Cooldowns off" : "No cooldowns"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="bb-btn-ink" onClick={() => onSpawn("dummy")}>
                Dummy
              </button>
              <button type="button" className="bb-btn-ink" onClick={() => onSpawn("copy")}>
                Mimic
              </button>
              <button type="button" className="bb-btn-ink" onClick={() => onSpawn("enemy")}>
                Enemy
              </button>
              <button type="button" className="bb-btn-ink" onClick={() => onSpawn("chaser")}>
                Moving enemy
              </button>
              <button type="button" className="bb-btn-ink" onClick={() => onClear("enemy")}>
                Clear enemies
              </button>
              <button type="button" className="bb-btn-ink" onClick={() => onClear()}>
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {SPELL_SLOTS.map((s, i) => {
                const id = loadout[i] ?? "";
                const name = id ? (ABILITIES[id]?.name ?? id) : "—";
                return (
                  <span key={s.id}>
                    <span className="opacity-60">{s.label}</span> {name}
                  </span>
                );
              })}
            </div>
          </section>
          <section className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="bb-input min-w-[10rem] flex-1"
                placeholder="Search spells"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="bb-input"
                value={shape}
                aria-label="Shape"
                onChange={(e) => setShape(e.target.value as AbilityShape | "")}
              >
                <option value="">All shapes</option>
                {SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by key">
              <button
                type="button"
                className={slot === "" ? "bb-btn-brass" : "bb-btn-ink"}
                onClick={() => setSlot("")}
              >
                All keys
              </button>
              {SPELL_SLOTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={slot === s.id ? "bb-btn-brass" : "bb-btn-ink"}
                  onClick={() => setSlot(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="max-h-[min(58dvh,520px)] overflow-y-auto">
              {rows.map((def) => {
                const equipped = loadout.includes(def.id);
                return (
                  <button
                    key={def.id}
                    type="button"
                    className={`bb-list-row mb-1 flex w-full items-start justify-between gap-3 text-left ${
                      equipped ? "bb-list-row--active" : ""
                    }`}
                    onClick={() => onEquip(def.id)}
                    title={def.description}
                  >
                    <span>
                      <span className="font-medium">{def.name}</span>
                      <span className="ml-2 opacity-50">{def.shape}</span>
                    </span>
                    <span className="shrink-0 opacity-60">{slotLabelFor(def)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
