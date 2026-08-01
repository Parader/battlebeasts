import { useMemo, useState } from "react";
import { filterQuestRowsForDisplay } from "@battlebeasts/shared";
import { GamePanelShell } from "./GamePanelShell";
import { GameIcon } from "./GameIcon";

export type HubQuestRow = {
  id: string;
  label: string;
  type: string;
  target: number;
  chest: string;
  progress: number;
  completed: boolean;
};

export type HubChestRow = {
  id: string;
  quality: string;
  source: string;
  created_at?: string;
};

type ChestQuality = "green" | "blue" | "purple" | "legendary";

type Props = {
  open: boolean;
  onClose: () => void;
  quests: HubQuestRow[];
  chests: HubChestRow[];
  isAdmin?: boolean;
  onOpenChest: (chestId: string) => void;
  pendingChestOpenId?: string | null;
  onSpawnChest?: (quality: ChestQuality) => void;
  onReplayIntro?: () => void;
  onSoftResetCharacter?: () => void;
  /** Admin hub practice — skip ability cooldowns. */
  adminNoCooldown?: boolean;
  onToggleAdminNoCooldown?: (enabled: boolean) => void;
};

const ADMIN_QUALITIES: readonly ChestQuality[] = ["green", "blue", "purple", "legendary"];

/** Hub quests + closed chests (mystery until open). */
export function QuestsPanel({
  open,
  onClose,
  quests,
  chests,
  isAdmin,
  onOpenChest,
  pendingChestOpenId = null,
  onSpawnChest,
  onReplayIntro,
  onSoftResetCharacter,
  adminNoCooldown = false,
  onToggleAdminNoCooldown,
}: Props) {
  const [spawnQuality, setSpawnQuality] = useState<ChestQuality>("blue");

  const visible = useMemo(() => filterQuestRowsForDisplay(quests), [quests]);
  const daily = visible.filter((q) => q.type === "daily");
  const season = visible.filter((q) => q.type === "season");
  const lifetime = visible.filter((q) => q.type === "lifetime");

  if (!open) return null;

  return (
    <GamePanelShell
      title="Quests & chests"
      subtitle="Daily goals and account milestones"
      onClose={onClose}
      maxHeightClass="max-h-[min(80dvh,640px)]"
    >
      {isAdmin &&
      (onSpawnChest || onReplayIntro || onSoftResetCharacter || onToggleAdminNoCooldown) ? (
        <section className="mb-5 space-y-2">
          <h3 className="bb-section-label">Admin</h3>
          {onSpawnChest ? (
            <div className="bb-list-row flex flex-wrap items-center gap-2">
              <select
                className="bb-input"
                value={spawnQuality}
                aria-label="Chest rarity"
                onChange={(e) => setSpawnQuality(e.target.value as ChestQuality)}
              >
                {ADMIN_QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="bb-btn-brass"
                onClick={() => onSpawnChest(spawnQuality)}
              >
                Get chest
              </button>
            </div>
          ) : null}
          <div className="bb-list-row flex flex-wrap items-center gap-2">
            {onToggleAdminNoCooldown ? (
              <button
                type="button"
                className={adminNoCooldown ? "bb-btn-brass" : "bb-btn-ink"}
                onClick={() => onToggleAdminNoCooldown(!adminNoCooldown)}
              >
                {adminNoCooldown ? "Cooldowns OFF" : "Disable cooldowns"}
              </button>
            ) : null}
            {onReplayIntro ? (
              <button type="button" className="bb-btn-ink" onClick={onReplayIntro}>
                Replay intro
              </button>
            ) : null}
            {onSoftResetCharacter ? (
              <button type="button" className="bb-btn-ink" onClick={onSoftResetCharacter}>
                Soft reset character
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mb-5 space-y-2">
        <h3 className="bb-section-label">Chests</h3>
        {chests.length === 0 ? (
          <p className="bb-muted text-sm">No closed chests yet. Complete quests to earn them.</p>
        ) : (
          <ul className="space-y-2">
            {chests.map((c) => (
              <li key={c.id} className="bb-list-row flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm text-[var(--bb-ink)]">
                  <GameIcon id="locked-chest" size={22} gray={0.9} title="Chest" />
                  Chest
                </span>
                <button
                  type="button"
                  className="bb-btn-brass disabled:opacity-40"
                  disabled={Boolean(pendingChestOpenId)}
                  onClick={() => onOpenChest(c.id)}
                >
                  {pendingChestOpenId === c.id ? "Opening…" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-5 space-y-2">
        <h3 className="bb-section-label">Daily</h3>
        {daily.map((q) => (
          <div key={q.id} className="bb-list-row bb-list-row--stack">
            <p className="text-sm text-[var(--bb-ink)]">{q.label}</p>
            <p className="bb-meta flex items-center gap-1.5 tabular-nums">
              <span>
                {Math.min(q.progress, q.target)}/{q.target}
                {q.completed ? " · done" : ""}
              </span>
              <span className="inline-flex items-center gap-1" title="Chest reward">
                · <GameIcon id="locked-chest" size={14} gray={0.85} />
              </span>
            </p>
          </div>
        ))}
      </section>

      {season.length > 0 ? (
        <section className="mb-5 space-y-2">
          <h3 className="bb-section-label">Season</h3>
          {season.map((q) => (
            <div key={q.id} className="bb-list-row bb-list-row--stack">
              <p className="text-sm text-[var(--bb-ink)]">{q.label}</p>
              <p className="bb-meta flex items-center gap-1.5 tabular-nums">
                <span>
                  {Math.min(q.progress, q.target)}/{q.target}
                  {q.completed ? " · done" : ""}
                </span>
                <span className="inline-flex items-center gap-1" title="Chest reward">
                  · <GameIcon id="locked-chest" size={14} gray={0.85} />
                </span>
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="bb-section-label">Lifetime</h3>
        {lifetime.map((q) => (
          <div key={q.id} className="bb-list-row bb-list-row--stack">
            <p className="text-sm text-[var(--bb-ink)]">{q.label}</p>
            <p className="bb-meta flex items-center gap-1.5 tabular-nums">
              <span>
                {Math.min(q.progress, q.target)}/{q.target}
                {q.completed ? " · done" : ""}
              </span>
              <span className="inline-flex items-center gap-1" title="Chest reward">
                · <GameIcon id="locked-chest" size={14} gray={0.85} />
              </span>
            </p>
          </div>
        ))}
      </section>
    </GamePanelShell>
  );
}
