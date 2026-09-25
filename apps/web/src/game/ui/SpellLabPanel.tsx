import { useMemo, useState, useSyncExternalStore, type MutableRefObject } from "react";
import {
  ABILITIES,
  SPELL_SLOTS,
  type AbilityDef,
  type AbilityShape,
  type SpellSlotId,
} from "@battlebeasts/shared";
import {
  castAimRuntime,
  type CastAimRelationPreview,
} from "@/game/castAimRuntime";
import {
  ELEMENT_GALLERY,
  SHAPE_GALLERY,
  getElementSettings,
  getParticleWorld,
  killAllEmitters,
  killAllLightningClusters,
  lightningSettings,
  patchElementSettings,
  patchLightningSettings,
  resetElementSettings,
  resetLightningSettings,
  setLabPreview,
  spawnElementGallery,
  spawnShapeShowcase,
  spawnShapeGallery,
  spawnStressCones,
  useLabPreview,
  type ElementId,
  type ElementSettings,
  type LightningSettings,
  type ShapeId,
} from "@/game/vfx/engine";

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
  predictedRef?: MutableRefObject<{ x: number; z: number }>;
};

const SHAPES: AbilityShape[] = ["projectile", "aoe", "dash", "melee", "buff"];

const ABILITY_LIST = Object.values(ABILITIES)
  .filter((d): d is AbilityDef => Boolean(d?.id && d.name))
  .sort((a, b) => a.name.localeCompare(b.name));

function matchesSlot(d: AbilityDef, slot: SpellSlotId): boolean {
  return d.allowedSlots.includes(slot);
}

function slotLabelFor(def: AbilityDef): string {
  const preferred =
    def.defaultSlot && def.allowedSlots.includes(def.defaultSlot)
      ? SPELL_SLOTS.find((s) => s.id === def.defaultSlot)
      : undefined;
  if (preferred) return preferred.label;
  const first = SPELL_SLOTS.find((s) => def.allowedSlots.includes(s.id));
  return first?.label ?? "?";
}

function withParticleWorld(
  predictedRef: MutableRefObject<{ x: number; z: number }> | undefined,
  run: (
    world: NonNullable<ReturnType<typeof getParticleWorld>>,
    origin: { x: number; y: number; z: number },
  ) => void,
): void {
  const trySpawn = (left: number) => {
    const world = getParticleWorld();
    if (!world) {
      if (left > 0) requestAnimationFrame(() => trySpawn(left - 1));
      return;
    }
    run(world, {
      x: predictedRef?.current.x ?? 0,
      y: 1.1,
      z: predictedRef?.current.z ?? 0,
    });
  };
  trySpawn(12);
}

function clearVfxPreview(): void {
  killAllEmitters();
  killAllLightningClusters();
  setLabPreview({ telegraph: false, focus: null, shape: "emitter" });
}

function spawnLabCones(
  count: number,
  spacing: number,
  predictedRef?: MutableRefObject<{ x: number; z: number }>,
): void {
  setLabPreview({ telegraph: false, focus: null, shape: "emitter" });
  withParticleWorld(predictedRef, (world, origin) => {
    world.killAll();
    killAllLightningClusters();
    spawnStressCones(world, count, spacing, origin);
  });
}

function spawnLabElementGallery(
  predictedRef?: MutableRefObject<{ x: number; z: number }>,
  shape: ShapeId = "emitter",
): void {
  if (shape === "telegraph") {
    killAllEmitters();
    killAllLightningClusters();
    setLabPreview({ telegraph: true, focus: "gallery", shape: "telegraph" });
    return;
  }
  setLabPreview({ telegraph: false, focus: "gallery", shape });
  withParticleWorld(predictedRef, (world, origin) => {
    if (shape === "emitter") {
      spawnElementGallery(world, origin, 2.4);
    } else {
      spawnShapeGallery(
        world,
        shape,
        origin,
        ELEMENT_GALLERY.map((e) => e.id),
      );
    }
  });
}

function spawnLabElementShape(
  id: ElementId,
  shape: ShapeId,
  predictedRef?: MutableRefObject<{ x: number; z: number }>,
): void {
  if (shape === "telegraph") {
    killAllEmitters();
    killAllLightningClusters();
    setLabPreview({ telegraph: true, focus: id, shape: "telegraph" });
    return;
  }
  setLabPreview({ telegraph: false, focus: id, shape });
  withParticleWorld(predictedRef, (world, origin) => {
    spawnShapeShowcase(world, id, shape, origin.x, origin.y, origin.z);
  });
}

function FilamentPanel() {
  const [, bump] = useState(0);
  const set = (key: keyof LightningSettings, value: number) => {
    patchLightningSettings({ [key]: value });
    bump((n) => n + 1);
  };
  const s = lightningSettings;
  const row = (
    label: string,
    key: keyof LightningSettings,
    min: number,
    max: number,
    step: number,
  ) => (
    <label
      key={key}
      className="mb-1 grid grid-cols-[1fr_5.5rem] items-center gap-2 text-sm"
    >
      <span className="opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(s[key])}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <div className="mt-2 rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium opacity-80">Lightning filaments</span>
        <button
          type="button"
          className="bb-btn-ink"
          onClick={() => {
            resetLightningSettings();
            bump((n) => n + 1);
          }}
        >
          Reset
        </button>
      </div>
      <div className="max-h-40 overflow-y-auto pr-1">
        {row("Length", "length", 1, 5, 0.05)}
        {row("Strands", "strands", 1, 16, 1)}
        {row("Spread", "spread", 0.05, 1.2, 0.01)}
        {row("Jitter", "jitter", 0, 0.8, 0.01)}
        {row("Crawl", "crawl", 0, 8, 0.1)}
        {row("Width", "width", 0.01, 0.08, 0.001)}
        {row("Restrike", "restrike", 4, 40, 1)}
      </div>
    </div>
  );
}

function ElementKnobsPanel({
  elementId,
  onRespawn,
}: {
  elementId: ElementId;
  onRespawn: () => void;
}) {
  const [, bump] = useState(0);
  const s = getElementSettings(elementId);
  const set = (key: keyof ElementSettings, value: number) => {
    patchElementSettings(elementId, { [key]: value });
    bump((n) => n + 1);
    onRespawn();
  };
  const row = (
    label: string,
    key: keyof ElementSettings,
    min: number,
    max: number,
    step: number,
  ) => (
    <label
      key={key}
      className="mb-1 grid grid-cols-[1fr_5.5rem] items-center gap-2 text-sm"
    >
      <span className="opacity-70">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(s[key])}
        onChange={(e) => set(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <div className="mt-2 rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium opacity-80">
          {elementId} knobs
        </span>
        <button
          type="button"
          className="bb-btn-ink"
          onClick={() => {
            resetElementSettings(elementId);
            bump((n) => n + 1);
            onRespawn();
          }}
        >
          Reset
        </button>
      </div>
      <div className="max-h-40 overflow-y-auto pr-1">
        {row("Rate", "rate", 0, 120, 1)}
        {row("Size", "size", 0.1, 2, 0.05)}
        {row("Size end", "sizeEnd", 0.02, 3, 0.05)}
        {row("Life", "life", 0.2, 3, 0.05)}
        {row("Opacity", "opacity", 0.02, 1, 0.01)}
        {row("Rise", "rise", 0, 4, 0.05)}
        {row("Spread", "spread", 0.05, 1.5, 0.01)}
        {row("Noise", "noise", 0, 2, 0.05)}
        {row("Drag", "drag", 0, 2, 0.05)}
        {row("Burst", "burst", 0, 40, 1)}
      </div>
    </div>
  );
}

/** Live-game spell sandbox: element × shape gallery + knobs. */
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
  predictedRef,
}: Props) {
  const [search, setSearch] = useState("");
  const [shapeFilter, setShapeFilter] = useState<AbilityShape | "">("");
  const [slot, setSlot] = useState<SpellSlotId | "">("");
  const labPreview = useLabPreview();
  const castAimRelation = useSyncExternalStore(
    (onStoreChange) => castAimRuntime.subscribe(onStoreChange),
    () => castAimRuntime.relationPreview,
    () => castAimRuntime.relationPreview as CastAimRelationPreview,
  );
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      ABILITY_LIST.filter((d) => {
        if (shapeFilter && d.shape !== shapeFilter) return false;
        if (slot && !matchesSlot(d, slot)) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q)
        );
      }),
    [q, shapeFilter, slot],
  );

  if (!open) return null;

  const focusEl =
    labPreview.focus && labPreview.focus !== "gallery" ? labPreview.focus : null;
  const activeShape = labPreview.shape;
  const showFilaments = focusEl === "lightning";
  const showElementKnobs = Boolean(focusEl) && activeShape !== "telegraph";

  const respawn = () => {
    if (labPreview.focus === "gallery") {
      spawnLabElementGallery(predictedRef, activeShape);
      return;
    }
    if (!focusEl) return;
    spawnLabElementShape(focusEl, activeShape, predictedRef);
  };

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
              Element × shape. Beam = hand orb + channel. Ground = floor
              decal. Telegraph = look at the ground ahead of you.
            </div>
          </div>
          <div className="bb-panel-header__actions">
            <button
              type="button"
              className="bb-btn-close"
              onClick={() => {
                clearVfxPreview();
                onClose();
              }}
              aria-label="Close"
            >
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

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium opacity-70">Cast aim as</span>
              {(
                [
                  { id: "self", label: "Self" },
                  { id: "ally", label: "Ally" },
                  { id: "enemy", label: "Enemy" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={
                    castAimRelation === opt.id ? "bb-btn-brass" : "bb-btn-ink"
                  }
                  onClick={() => castAimRuntime.setRelationPreview(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="text-sm font-medium opacity-70">Element</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={labPreview.focus === "gallery" ? "bb-btn-brass" : "bb-btn-ink"}
                onClick={() => spawnLabElementGallery(predictedRef, activeShape)}
              >
                All
              </button>
              {ELEMENT_GALLERY.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  className={focusEl === el.id ? "bb-btn-brass" : "bb-btn-ink"}
                  onClick={() =>
                    spawnLabElementShape(
                      el.id,
                      activeShape === "telegraph" ? "emitter" : activeShape,
                      predictedRef,
                    )
                  }
                >
                  {el.label}
                </button>
              ))}
            </div>

            <div className="text-sm font-medium opacity-70">Shape</div>
            <div className="flex flex-wrap items-center gap-2">
              {SHAPE_GALLERY.map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  className={activeShape === sh.id ? "bb-btn-brass" : "bb-btn-ink"}
                  onClick={() => {
                    if (sh.id === "telegraph") {
                      killAllEmitters();
                      killAllLightningClusters();
                      setLabPreview({
                        telegraph: true,
                        focus: labPreview.focus ?? "gallery",
                        shape: "telegraph",
                      });
                      return;
                    }
                    if (labPreview.focus === "gallery") {
                      spawnLabElementGallery(predictedRef, sh.id);
                    } else if (focusEl) {
                      spawnLabElementShape(focusEl, sh.id, predictedRef);
                    } else {
                      setLabPreview({ shape: sh.id, telegraph: false, focus: "gallery" });
                      spawnLabElementGallery(predictedRef, sh.id);
                    }
                  }}
                >
                  {sh.label}
                </button>
              ))}
              <button type="button" className="bb-btn-ink" onClick={() => clearVfxPreview()}>
                Clear VFX
              </button>
            </div>

            {labPreview.telegraph ? (
              <p className="text-sm opacity-80">
                Telegraph is ~3.5m ahead of where you face. Use &quot;Cast aim
                as&quot; above to preview friendly (green) or enemy (red) team
                tints — also recolors live cast-aim when you cast a spell. Self
                shows the comparison row. Fill pulses from the center (charge
                telegraph).
              </p>
            ) : null}
            {showFilaments ? <FilamentPanel /> : null}
            {showElementKnobs && focusEl ? (
              <ElementKnobsPanel elementId={focusEl} onRespawn={respawn} />
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="bb-btn-ink"
                onClick={() => spawnLabCones(16, 2.2, predictedRef)}
              >
                Stress 16
              </button>
              <button
                type="button"
                className="bb-btn-ink"
                onClick={() => spawnLabCones(48, 1.8, predictedRef)}
              >
                Stress 48
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
                value={shapeFilter}
                aria-label="Shape"
                onChange={(e) => setShapeFilter(e.target.value as AbilityShape | "")}
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
            <div className="max-h-[min(40dvh,360px)] overflow-y-auto">
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
